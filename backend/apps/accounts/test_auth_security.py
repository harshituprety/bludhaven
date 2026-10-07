"""Login, refresh/logout, current user and token-security behaviour."""

from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.core.testing import PASSWORD, ApiTestCase, make_user
from apps.core.throttling import AuthRateThrottle

from .models import Role, User

LOGIN, REFRESH, BLACKLIST, ME = "/api/auth/token/", "/api/auth/token/refresh/", "/api/auth/token/blacklist/", "/api/auth/me/"


def expired(token_cls, user):
    token = token_cls.for_user(user)
    token.set_exp(from_time=timezone.now() - timedelta(hours=2), lifetime=timedelta(minutes=1))
    return str(token)


class LoginTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.HOST, email="host@example.com")

    def login(self, **body):
        return self.client.post(LOGIN, {"email": "host@example.com", "password": PASSWORD, **body}, format="json")

    def test_valid_credentials_return_an_access_token_a_refresh_cookie_and_a_safe_user(self):
        r = self.login()
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertEqual(set(data), {"access", "user"})
        self.assertEqual(set(data["user"]), {"id", "email", "full_name", "role", "is_email_verified", "date_joined"})
        self.assertEqual(data["user"]["role"], Role.HOST)
        self.assertNotIn(PASSWORD, r.content.decode())

    def test_bad_password_and_unknown_email_are_the_same_401(self):
        wrong = self.login(password="wrong-password-1")
        unknown = self.login(email="nobody@example.com")
        self.assertEqual((wrong.status_code, unknown.status_code), (401, 401))
        self.assertEqual(wrong.json(), unknown.json())  # does not reveal which emails exist
        self.assertEqual(self.error(wrong)["code"], "no_active_account")

    def test_inactive_user_is_rejected_with_the_correct_password(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        r = self.login()
        self.assertEqual(r.status_code, 401)
        self.assertNotIn("access", r.json())

    def test_a_role_sent_by_the_client_is_ignored(self):
        r = self.login(role=Role.SUPER_ADMIN)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["user"]["role"], Role.HOST)
        self.assertEqual(AccessToken(r.json()["access"])["role"], Role.HOST)
        self.authenticate_with(r.json()["access"])
        self.assertEqual(self.client.get(ME).json()["role"], Role.HOST)

    def authenticate_with(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def test_missing_or_blank_credentials_are_400(self):
        for body in ({}, {"email": "host@example.com"}, {"password": PASSWORD}, {"email": "", "password": ""}):
            with self.subTest(body=body):
                r = self.client.post(LOGIN, body, format="json")
                self.assertEqual(r.status_code, 400)
                self.assertEqual(self.error(r)["code"], "validation_error")

    def test_login_is_rate_limited(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"auth": "3/min"}):
            for _ in range(3):
                self.assertEqual(self.login(password="wrong-password-1").status_code, 401)
            r = self.login()  # even the right password is refused once the limit is hit
            self.assertEqual(r.status_code, 429)
            self.assertEqual(self.error(r)["code"], "throttled")
            self.assertIn("retry_after", self.error(r)["details"])

    def test_a_forged_forwarded_for_header_does_not_escape_the_limit(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"auth": "2/min"}):
            for i in range(2):
                self.client.post(LOGIN, {"email": "x@example.com", "password": "p"}, format="json", HTTP_X_FORWARDED_FOR=f"10.0.0.{i}")
            r = self.client.post(LOGIN, {"email": "x@example.com", "password": "p"}, format="json", HTTP_X_FORWARDED_FOR="10.9.9.9")
            self.assertEqual(r.status_code, 429)

    def test_failed_login_is_logged_without_the_email_or_password(self):
        with self.assertLogs("apps.accounts.views", level="WARNING") as logs:
            self.login(password="wrong-password-1")
        text = "\n".join(logs.output)
        self.assertIn("Failed login attempt", text)
        self.assertNotIn("host@example.com", text)
        self.assertNotIn("wrong-password-1", text)


class RefreshAndLogoutTests(ApiTestCase):
    """The refresh token only ever travels in an httpOnly cookie; its body is empty."""

    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, email="guest@example.com")

    def refresh(self, token=None, path=REFRESH):
        if token is not None:
            self.set_refresh_cookie(token)
        return self.client.post(path)

    def new_token(self):
        return str(RefreshToken.for_user(self.user))

    def test_login_sets_a_locked_down_cookie(self):
        r = self.client.post(LOGIN, {"email": "guest@example.com", "password": PASSWORD}, format="json")
        cookie = r.cookies[settings.REFRESH_COOKIE_NAME]
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["path"], "/api/auth/")
        self.assertEqual(cookie["samesite"], settings.REFRESH_COOKIE_SAMESITE)
        self.assertEqual(bool(cookie["secure"]), settings.REFRESH_COOKIE_SECURE)
        self.assertEqual(int(cookie["max-age"]), int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()))
        self.assertNotIn(cookie.value, r.content.decode())  # never in the body
        self.assertIn("no-store", r["Cache-Control"])

    def test_refresh_returns_only_an_access_token_and_rotates_the_cookie(self):
        old = self.new_token()
        r = self.refresh(old)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()), {"access"})
        new = r.cookies[settings.REFRESH_COOKIE_NAME]
        self.assertTrue(new["httponly"])
        self.assertNotEqual(new.value, old)
        self.assertNotIn(new.value, r.content.decode())
        self.assertEqual(self.client.post(REFRESH).status_code, 200)  # the jar now holds the new token, which works
        self.assertEqual(AccessToken(r.json()["access"])["user_id"], str(self.user.pk))

    def test_a_rotated_out_refresh_token_cannot_be_reused(self):
        old = self.new_token()
        self.assertEqual(self.refresh(old).status_code, 200)
        r = self.refresh(old)
        self.assertEqual((r.status_code, self.error(r)["code"]), (401, "token_not_valid"))
        self.assertEqual(r.cookies[settings.REFRESH_COOKIE_NAME].value, "")  # the dead cookie is cleared

    def test_a_refresh_token_in_the_body_is_ignored(self):
        r = self.client.post(REFRESH, {"refresh": self.new_token()}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (401, "refresh_token_missing"))

    def test_no_cookie_is_a_401(self):
        r = self.client.post(REFRESH)
        self.assertEqual((r.status_code, self.error(r)["code"]), (401, "refresh_token_missing"))

    def test_logout_blacklists_the_token_and_clears_the_cookie(self):
        token = self.new_token()
        r = self.refresh(token, BLACKLIST)
        self.assertEqual((r.status_code, r.json()), (200, {"detail": "Signed out."}))
        self.assertEqual(r.cookies[settings.REFRESH_COOKIE_NAME].value, "")
        self.assertEqual(self.refresh(token).status_code, 401)  # the revoked token is dead even if replayed

    def test_logout_never_fails_for_the_caller(self):
        self.assertEqual(self.client.post(BLACKLIST).status_code, 200)  # no cookie
        token = self.new_token()
        self.refresh(token, BLACKLIST)
        self.assertEqual(self.refresh(token, BLACKLIST).status_code, 200)  # already revoked
        self.assertEqual(self.refresh("garbage", BLACKLIST).status_code, 200)

    def test_logout_of_one_session_leaves_other_sessions_alone(self):
        a, b = self.new_token(), self.new_token()
        self.refresh(a, BLACKLIST)
        self.assertEqual(self.refresh(b).status_code, 200)

    def test_expired_refresh_token_is_rejected(self):
        r = self.refresh(expired(RefreshToken, self.user))
        self.assertEqual((r.status_code, self.error(r)["code"]), (401, "token_not_valid"))

    def test_malformed_and_wrong_kind_of_tokens_are_rejected(self):
        for bad in ("garbage", "a.b.c", str(AccessToken.for_user(self.user))):
            with self.subTest(token=bad[:12]):
                self.assertEqual(self.refresh(bad).status_code, 401)

    def test_token_signed_with_another_key_is_rejected(self):
        import jwt

        payload = dict(RefreshToken.for_user(self.user).payload)
        bad = jwt.encode(payload, "some-other-secret-key-that-is-long-enough-0123456789", algorithm="HS256")
        self.assertEqual(self.refresh(bad).status_code, 401)

    def test_refresh_for_a_deactivated_user_is_rejected(self):
        token = self.new_token()
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.refresh(token).status_code, 401)

    def test_refresh_is_rate_limited(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"refresh": "2/min"}):
            for _ in range(2):
                self.refresh("garbage")
            self.assertEqual(self.refresh("garbage").status_code, 429)

    def test_logout_is_rate_limited_in_its_own_bucket(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"logout": "2/min"}):
            for _ in range(2):
                self.refresh("garbage", BLACKLIST)
            self.assertEqual(self.refresh("garbage", BLACKLIST).status_code, 429)
            self.assertEqual(self.refresh("garbage").status_code, 401)  # refresh is a different bucket


class CsrfAndCorsTests(ApiTestCase):
    """The cookie is sent automatically by browsers, so refresh/logout also demand a CSRF token."""

    ORIGIN = "http://localhost:5173"

    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, email="guest@example.com")
        self.strict = APIClient(enforce_csrf_checks=True)
        self.strict.cookies[settings.REFRESH_COOKIE_NAME] = str(RefreshToken.for_user(self.user))

    def csrf_token(self):
        r = self.strict.get("/api/auth/csrf/", HTTP_ORIGIN=self.ORIGIN)
        self.assertEqual(r.status_code, 200)
        return r, r.json()["csrfToken"]

    def test_the_csrf_endpoint_returns_a_token_and_an_httponly_cookie(self):
        r, token = self.csrf_token()
        self.assertTrue(token)
        self.assertTrue(r.cookies[settings.CSRF_COOKIE_NAME]["httponly"])
        self.assertIn("no-store", r["Cache-Control"])

    def test_refresh_without_a_csrf_token_is_refused(self):
        for path in (REFRESH, BLACKLIST):
            r = self.strict.post(path, HTTP_ORIGIN=self.ORIGIN)
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "csrf_failed"), path)
        self.assertTrue(RefreshToken(self.strict.cookies[settings.REFRESH_COOKIE_NAME].value))  # untouched, not revoked

    def test_refresh_with_a_valid_csrf_token_works(self):
        _, token = self.csrf_token()
        r = self.strict.post(REFRESH, HTTP_ORIGIN=self.ORIGIN, HTTP_X_CSRFTOKEN=token)
        self.assertEqual((r.status_code, set(r.json())), (200, {"access"}))
        _, token = self.csrf_token()
        self.assertEqual(self.strict.post(BLACKLIST, HTTP_ORIGIN=self.ORIGIN, HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_a_wrong_csrf_token_or_a_foreign_origin_is_refused(self):
        _, token = self.csrf_token()
        wrong = self.strict.post(REFRESH, HTTP_ORIGIN=self.ORIGIN, HTTP_X_CSRFTOKEN="x" * 64)
        self.assertEqual(wrong.status_code, 403)
        foreign = self.strict.post(REFRESH, HTTP_ORIGIN="https://evil.example", HTTP_X_CSRFTOKEN=token)
        self.assertEqual((foreign.status_code, self.error(foreign)["code"]), (403, "csrf_failed"))

    def test_login_and_other_public_posts_do_not_need_a_csrf_token(self):
        r = self.strict.post(LOGIN, {"email": "guest@example.com", "password": PASSWORD}, format="json", HTTP_ORIGIN=self.ORIGIN)
        self.assertEqual(r.status_code, 200)

    def test_cors_allows_the_frontend_with_credentials_and_nobody_else(self):
        ok = self.client.options(REFRESH, HTTP_ORIGIN=self.ORIGIN, HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST", HTTP_ACCESS_CONTROL_REQUEST_HEADERS="x-csrftoken")
        self.assertEqual(ok["Access-Control-Allow-Origin"], self.ORIGIN)
        self.assertEqual(ok["Access-Control-Allow-Credentials"], "true")
        self.assertIn("x-csrftoken", ok["Access-Control-Allow-Headers"])
        evil = self.client.options(REFRESH, HTTP_ORIGIN="https://evil.example", HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST")
        self.assertNotIn("Access-Control-Allow-Origin", evil)
        actual = self.client.get("/api/health/", HTTP_ORIGIN=self.ORIGIN)
        self.assertEqual((actual["Access-Control-Allow-Origin"], actual["Access-Control-Allow-Credentials"]), (self.ORIGIN, "true"))

    def test_the_access_token_is_never_a_cookie(self):
        r = self.client.post(LOGIN, {"email": "guest@example.com", "password": PASSWORD}, format="json")
        self.assertEqual(set(r.cookies), {settings.REFRESH_COOKIE_NAME})


class CurrentUserAndTokenTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.HOST, email="host@example.com")

    def test_me_without_a_token_is_401(self):
        r = self.client.get(ME)
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.error(r)["code"], "not_authenticated")

    def test_me_returns_the_current_user_without_a_password(self):
        self.authenticate(self.user)
        r = self.client.get(ME)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["email"], "host@example.com")
        self.assertEqual(r.json()["role"], Role.HOST)
        self.assertNotIn("password", r.json())
        self.assertNotIn(self.user.password, r.content.decode())

    def test_me_only_allows_get_and_a_restricted_patch(self):
        self.authenticate(self.user)
        for method in ("post", "put", "delete"):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.client, method)(ME, {"role": Role.SUPER_ADMIN}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(ME, {"role": Role.SUPER_ADMIN}, format="json").status_code, 400)  # refused, not ignored
        self.user.refresh_from_db()
        self.assertEqual(self.user.role, Role.HOST)

    def test_role_changes_in_the_database_apply_immediately(self):
        self.authenticate(self.user)
        User.objects.filter(pk=self.user.pk).update(role=Role.END_USER)
        self.assertEqual(self.client.get(ME).json()["role"], Role.END_USER)

    def test_invalid_expired_and_refresh_tokens_are_rejected_as_access_tokens(self):
        cases = {
            "garbage": "garbage",
            "empty": "",
            "expired": expired(AccessToken, self.user),
            "refresh token used as access": str(RefreshToken.for_user(self.user)),
        }
        for label, token in cases.items():
            with self.subTest(label):
                self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
                r = self.client.get(ME)
                self.assertEqual(r.status_code, 401)
                self.assertIn(self.error(r)["code"], {"token_not_valid", "not_authenticated", "authentication_failed"})

    def test_wrong_authorization_scheme_is_401(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {AccessToken.for_user(self.user)}")
        self.assertEqual(self.client.get(ME).status_code, 401)

    def test_a_token_signed_with_another_key_or_none_is_rejected(self):
        import jwt

        payload = dict(AccessToken.for_user(self.user).payload)
        for label, token in {
            "other key": jwt.encode(payload, "some-other-secret-key-that-is-long-enough-0123456789", algorithm="HS256"),
            "alg none": jwt.encode(payload, None, algorithm="none"),
        }.items():
            with self.subTest(label):
                self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
                self.assertEqual(self.client.get(ME).status_code, 401)

    def test_a_deactivated_users_still_valid_access_token_stops_working(self):
        self.authenticate(self.user)
        self.assertEqual(self.client.get(ME).status_code, 200)
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.client.get(ME).status_code, 401)

    def test_a_deleted_users_token_stops_working(self):
        self.authenticate(self.user)
        User.objects.filter(pk=self.user.pk).delete()
        self.assertEqual(self.client.get(ME).status_code, 401)

    def test_authenticated_requests_are_rate_limited_per_user(self):
        from rest_framework.throttling import UserRateThrottle

        self.authenticate(self.user)
        with patch.dict(UserRateThrottle.THROTTLE_RATES, {"user": "2/min"}):
            self.assertEqual(self.client.get(ME).status_code, 200)
            self.assertEqual(self.client.get(ME).status_code, 200)
            self.assertEqual(self.client.get(ME).status_code, 429)
            other = make_user(Role.END_USER)
            self.authenticate(other)  # another user has their own allowance
            self.assertEqual(self.client.get(ME).status_code, 200)

    def test_anonymous_requests_are_rate_limited(self):
        from rest_framework.throttling import AnonRateThrottle

        with patch.dict(AnonRateThrottle.THROTTLE_RATES, {"anon": "2/min"}):
            self.assertEqual(self.client.get("/api/health/").status_code, 200)
            self.assertEqual(self.client.get("/api/health/").status_code, 200)
            self.assertEqual(self.client.get("/api/health/").status_code, 429)
