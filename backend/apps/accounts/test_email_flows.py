"""Email verification and password reset."""

import re
import time
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core import mail, signing
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from apps.core.testing import PASSWORD, ApiTestCase, make_user
from apps.core.throttling import AuthRateThrottle, PasswordResetRateThrottle

from . import tokens
from .models import Role, User

REGISTER, VERIFY = "/api/auth/register/", "/api/auth/verify-email/"
RESET, RESET_CONFIRM, LOGIN, ME = "/api/auth/password-reset/", "/api/auth/password-reset/confirm/", "/api/auth/token/", "/api/auth/me/"
NEW_PASSWORD = "a-brand-new-Passw0rd!"
SIGNUP = {"email": "Ada@Example.com", "full_name": "Ada Guest", "password": "correct-horse-battery-9"}


def link_params(message):
    """Query parameters of the one link in an email body."""
    url = re.search(r"https?://\S+", message.body).group(0)
    return urlparse(url), {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


class VerificationTests(ApiTestCase):
    def register(self):
        r = self.client.post(REGISTER, SIGNUP, format="json")
        self.assertEqual(r.status_code, 201)
        return User.objects.get(pk=r.json()["id"]), r

    def token_for_new_user(self):
        user, _ = self.register()
        _, params = link_params(mail.outbox[0])
        return user, params["token"]

    # --- the email -----------------------------------------------------------

    def test_registration_sends_one_verification_email_and_the_account_starts_unverified(self):
        user, r = self.register()
        self.assertFalse(r.json()["is_email_verified"])
        self.assertFalse(user.is_email_verified)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["ada@example.com"])
        self.assertEqual(message.from_email, settings.DEFAULT_FROM_EMAIL)
        url, params = link_params(message)
        self.assertEqual(f"{url.scheme}://{url.netloc}{url.path}", f"{settings.FRONTEND_URL}/verify-email")
        self.assertEqual(set(params), {"token"})
        self.assertNotIn(SIGNUP["password"], message.body)

    def test_a_failed_sign_up_sends_nothing(self):
        self.client.post(REGISTER, {**SIGNUP, "password": "password123"}, format="json")
        self.assertEqual(len(mail.outbox), 0)

    def test_an_email_outage_does_not_break_registration(self):
        with patch("apps.accounts.emails.send_mail", side_effect=OSError("smtp down")), self.assertLogs("apps.accounts.emails", "ERROR") as logs:
            r = self.client.post(REGISTER, SIGNUP, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertTrue(User.objects.filter(email="ada@example.com").exists())
        self.assertNotIn("ada@example.com", "\n".join(logs.output).replace("user id=", ""))  # logged by id only

    # --- verifying -----------------------------------------------------------

    def test_valid_token_verifies_the_account(self):
        user, token = self.token_for_new_user()
        r = self.client.post(VERIFY, {"token": token}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"detail": "Email verified.", "already_verified": False})
        user.refresh_from_db()
        self.assertTrue(user.is_email_verified)
        self.authenticate(user)
        self.assertTrue(self.client.get(ME).json()["is_email_verified"])

    def test_the_response_exposes_nothing_sensitive(self):
        user, token = self.token_for_new_user()
        r = self.client.post(VERIFY, {"token": token}, format="json")
        text = r.content.decode()
        for secret in (user.email, token, str(user.pk), user.full_name, user.password):
            self.assertNotIn(secret, text)
        self.assertEqual(set(r.json()), {"detail", "already_verified"})

    def test_verifying_works_without_being_signed_in_and_ignores_a_stale_token(self):
        _, token = self.token_for_new_user()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 200)

    def test_an_already_verified_account_is_a_harmless_success(self):
        user, token = self.token_for_new_user()
        self.client.post(VERIFY, {"token": token}, format="json")
        user.refresh_from_db()
        first = user.email_verified_at
        r = self.client.post(VERIFY, {"token": token}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"detail": "Email is already verified.", "already_verified": True})
        user.refresh_from_db()
        self.assertEqual(user.email_verified_at, first)  # not re-stamped

    def test_invalid_tokens_are_rejected_with_one_generic_error(self):
        user, token = self.token_for_new_user()
        wrong_salt = signing.dumps({"uid": user.pk, "email": user.email}, salt="something-else")
        other_purpose = tokens.make_reset_credentials(user)[1]
        cases = {
            "garbage": "garbage",
            "tampered": token[:-3] + ("AAA" if not token.endswith("AAA") else "BBB"),
            "truncated": token[:10],
            "different salt": wrong_salt,
            "a password-reset token": other_purpose,
            "unknown user": signing.dumps({"uid": 999999, "email": "x@example.com"}, salt=tokens.VERIFY_SALT),
            "missing keys": signing.dumps({"nope": 1}, salt=tokens.VERIFY_SALT),
        }
        for label, bad in cases.items():
            with self.subTest(label):
                r = self.client.post(VERIFY, {"token": bad}, format="json")
                self.assertEqual(r.status_code, 400)
                self.assertEqual(self.error(r)["code"], "invalid_token")
        user.refresh_from_db()
        self.assertFalse(user.is_email_verified)

    def test_a_missing_token_is_a_validation_error(self):
        for body in ({}, {"token": ""}):
            r = self.client.post(VERIFY, body, format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_an_expired_token_is_rejected(self):
        user, token = self.token_for_new_user()
        later = time.time() + settings.EMAIL_VERIFICATION_TIMEOUT + 60
        with patch("django.core.signing.time.time", return_value=later):
            r = self.client.post(VERIFY, {"token": token}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "invalid_token"))
        user.refresh_from_db()
        self.assertFalse(user.is_email_verified)
        # still fine just before the deadline
        with patch("django.core.signing.time.time", return_value=time.time() + settings.EMAIL_VERIFICATION_TIMEOUT - 60):
            self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 200)

    def test_a_link_stops_working_if_the_email_address_changed(self):
        user, token = self.token_for_new_user()
        User.objects.filter(pk=user.pk).update(email="changed@example.com")
        self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 400)

    def test_deactivated_users_cannot_verify(self):
        user, token = self.token_for_new_user()
        User.objects.filter(pk=user.pk).update(is_active=False)
        self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 400)

    def test_only_post_is_allowed(self):
        _, token = self.token_for_new_user()
        r = self.client.get(f"{VERIFY}?token={token}")
        self.assertEqual(r.status_code, 405)  # a mail scanner opening the link cannot verify

    # --- the client can never mark itself verified -----------------------------

    def test_the_client_cannot_set_verified_state(self):
        for extra in ({"is_email_verified": True}, {"email_verified_at": "2020-01-01T00:00:00Z"}):
            r = self.client.post(REGISTER, {**SIGNUP, **extra}, format="json")
            self.assertEqual(r.status_code, 400)
        self.assertEqual(User.objects.count(), 0)
        user = make_user(Role.END_USER)
        self.authenticate(user)
        for method in ("post", "put"):
            self.assertEqual(getattr(self.client, method)(ME, {"is_email_verified": True}, format="json").status_code, 405)
        self.assertEqual(self.client.patch(ME, {"is_email_verified": True}, format="json").status_code, 400)  # refused, not ignored
        user.refresh_from_db()
        self.assertFalse(user.is_email_verified)

    def test_server_created_super_admins_are_verified_and_end_users_are_not(self):
        self.assertTrue(make_user(Role.SUPER_ADMIN).is_email_verified)
        self.assertFalse(make_user(Role.END_USER).is_email_verified)
        self.assertFalse(make_user(Role.HOST).is_email_verified)

    def login(self, password=None, email="ada@example.com"):
        return self.client.post(LOGIN, {"email": email, "password": password or SIGNUP["password"]}, format="json")

    def test_an_unverified_account_cannot_log_in_and_gets_no_tokens(self):
        user, _ = self.register()
        r = self.login()
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["error"]["code"], "email_not_verified")
        body = r.content.decode().lower()
        for secret in ("access", "refresh", "token"):
            self.assertNotIn(f'"{secret}"', body)
        self.assertNotIn(settings.REFRESH_COOKIE_NAME, r.cookies)
        # Nothing was minted, and a refused login is not a login.
        self.assertFalse(OutstandingToken.objects.filter(user=user).exists())
        user.refresh_from_db()
        self.assertIsNone(user.last_login)

    def test_a_wrong_password_never_reveals_whether_the_account_is_verified(self):
        self.register()
        r = self.login(password="not-the-password")
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (401, "no_active_account"))
        unknown = self.login(email="nobody@example.com")
        self.assertEqual((unknown.status_code, unknown.json()["error"]["code"]), (401, "no_active_account"))

    def test_the_account_can_log_in_once_the_emailed_link_has_been_used(self):
        _, token = self.token_for_new_user()
        self.assertEqual(self.login().status_code, 403)
        self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 200)
        r = self.login()
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["user"]["is_email_verified"])
        self.assertIn(settings.REFRESH_COOKIE_NAME, r.cookies)

    def test_an_expired_link_leaves_the_account_locked_until_a_new_one_is_used(self):
        user, token = self.token_for_new_user()
        with patch.object(settings, "EMAIL_VERIFICATION_TIMEOUT", -1):
            self.assertEqual(self.client.post(VERIFY, {"token": token}, format="json").status_code, 400)
        self.assertEqual(self.login().status_code, 403)
        self.client.post("/api/auth/resend-verification/", {"email": SIGNUP["email"]}, format="json")
        _, params = link_params(mail.outbox[-1])
        self.assertEqual(self.client.post(VERIFY, {"token": params["token"]}, format="json").status_code, 200)
        self.assertEqual(self.login().status_code, 200)

    def test_a_link_for_one_account_cannot_verify_another(self):
        _, token = self.token_for_new_user()
        other = make_user(Role.END_USER, email="other@example.com")
        self.client.post(VERIFY, {"token": token}, format="json")
        other.refresh_from_db()
        self.assertFalse(other.is_email_verified)
        self.assertEqual(self.login(password=PASSWORD, email="other@example.com").status_code, 403)

    def test_super_admins_created_on_the_server_can_log_in(self):
        make_user(Role.SUPER_ADMIN, email="root@example.com")
        self.assertEqual(self.login(password=PASSWORD, email="root@example.com").status_code, 200)

    def test_the_verification_email_is_sent_for_host_sign_ups_too(self):
        r = self.client.post("/api/auth/register-host/", SIGNUP, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(len(mail.outbox), 1)
        self.assertFalse(r.json()["is_email_verified"])
        self.assertEqual(self.login().status_code, 403)

    # --- logging -----------------------------------------------------------------

    def test_logs_never_contain_tokens_or_addresses(self):
        with self.assertLogs("apps", "INFO") as logs:
            _, token = self.token_for_new_user()
            self.client.post(VERIFY, {"token": token}, format="json")
        text = "\n".join(logs.output)
        self.assertIn("Email verified", text)
        self.assertNotIn(token, text)
        self.assertNotIn("ada@example.com", text.lower())
        self.assertNotIn(SIGNUP["password"], text)

    def test_verification_is_rate_limited(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"auth": "2/min"}):
            for _ in range(2):
                self.client.post(VERIFY, {"token": "x"}, format="json")
            self.assertEqual(self.client.post(VERIFY, {"token": "x"}, format="json").status_code, 429)


class PasswordResetRequestTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, verified=True, email="guest@example.com")

    def request(self, email="guest@example.com"):
        return self.client.post(RESET, {"email": email}, format="json")

    def test_a_known_address_gets_one_reset_email(self):
        r = self.request()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["guest@example.com"])
        url, params = link_params(message)
        self.assertEqual(f"{url.scheme}://{url.netloc}{url.path}", f"{settings.FRONTEND_URL}/reset-password")
        self.assertEqual(set(params), {"uid", "token"})
        self.assertTrue(tokens.user_from_reset_credentials(params["uid"], params["token"]))
        self.assertNotIn(PASSWORD, message.body)
        self.assertNotIn(self.user.password, message.body)

    def test_the_address_is_matched_case_insensitively(self):
        self.request("GUEST@Example.COM")
        self.assertEqual(len(mail.outbox), 1)

    def test_an_unknown_address_gets_the_same_answer_and_no_email(self):
        known, unknown = self.request(), self.request("nobody@example.com")
        self.assertEqual((known.status_code, unknown.status_code), (200, 200))
        self.assertEqual(known.json(), unknown.json())  # nothing reveals which addresses have accounts
        self.assertEqual(len(mail.outbox), 1)  # only the known one

    def test_a_deactivated_account_looks_like_an_unknown_one(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        r = self.request()
        self.assertEqual((r.status_code, r.json()), (200, self.request("nobody@example.com").json()))
        self.assertEqual(len(mail.outbox), 0)

    def test_malformed_input_is_a_validation_error(self):
        for body in ({}, {"email": ""}, {"email": "not-an-email"}):
            r = self.client.post(RESET, body, format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
        self.assertEqual(len(mail.outbox), 0)

    def test_it_works_without_signing_in(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.request().status_code, 200)

    def test_an_email_outage_still_gives_the_generic_answer(self):
        with patch("apps.accounts.emails.send_mail", side_effect=OSError("smtp down")), self.assertLogs("apps.accounts.emails", "ERROR"):
            self.assertEqual(self.request().status_code, 200)

    def test_requests_are_rate_limited_whatever_the_address(self):
        with patch.dict(PasswordResetRateThrottle.THROTTLE_RATES, {"password_reset": "2/min"}):
            self.assertEqual(self.request().status_code, 200)
            self.assertEqual(self.request("other@example.com").status_code, 200)
            r = self.request("third@example.com")
        self.assertEqual((r.status_code, self.error(r)["code"]), (429, "throttled"))
        self.assertIn("Retry-After", r)
        self.assertEqual(len(mail.outbox), 1)

    def test_the_reset_throttle_is_separate_from_the_login_throttle(self):
        with patch.dict(PasswordResetRateThrottle.THROTTLE_RATES, {"password_reset": "1/min", "auth": "50/min"}):
            self.request()
            self.assertEqual(self.request().status_code, 429)
            self.assertEqual(self.client.post(LOGIN, {"email": "guest@example.com", "password": PASSWORD}, format="json").status_code, 200)

    def test_logs_never_contain_the_address_or_token(self):
        with self.assertLogs("apps", "INFO") as logs:
            self.request()
            self.request("nobody@example.com")
        text = "\n".join(logs.output).lower()
        _, params = link_params(mail.outbox[0])
        self.assertNotIn("guest@example.com", text)
        self.assertNotIn("nobody@example.com", text)
        self.assertNotIn(params["token"].lower(), text)


class PasswordResetConfirmTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.HOST, verified=True, email="host@example.com")
        self.uid, self.token = tokens.make_reset_credentials(self.user)

    def confirm(self, uid=None, token=None, new_password=NEW_PASSWORD):
        return self.client.post(
            RESET_CONFIRM,
            {"uid": uid or self.uid, "token": token or self.token, "new_password": new_password},
            format="json",
        )

    def password_is(self, password):
        """Check the stored password directly: signing in would change last_login, which (by design
        in Django's token generator) also retires any outstanding reset token."""
        return User.objects.get(pk=self.user.pk).check_password(password)

    def login(self, password):
        return self.client.post(LOGIN, {"email": "host@example.com", "password": password}, format="json").status_code

    def test_a_valid_link_sets_the_new_password(self):
        r = self.confirm()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()), {"detail"})
        self.assertEqual(self.login(NEW_PASSWORD), 200)
        self.assertEqual(self.login(PASSWORD), 401)

    def test_the_whole_flow_through_the_emailed_link(self):
        self.client.post(RESET, {"email": "host@example.com"}, format="json")
        _, params = link_params(mail.outbox[0])
        self.assertEqual(self.confirm(params["uid"], params["token"]).status_code, 200)
        self.assertEqual(self.login(NEW_PASSWORD), 200)

    def test_a_used_token_cannot_be_used_again(self):
        self.assertEqual(self.confirm().status_code, 200)
        r = self.confirm(new_password="another-Passw0rd-again!")
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "invalid_token"))
        self.assertEqual(self.login(NEW_PASSWORD), 200)  # the second attempt changed nothing
        self.assertEqual(self.login("another-Passw0rd-again!"), 401)

    def test_a_new_request_gives_a_fresh_working_token(self):
        self.confirm()
        uid, token = tokens.make_reset_credentials(User.objects.get(pk=self.user.pk))
        self.assertEqual(self.confirm(uid, token, "third-Passw0rd-here!").status_code, 200)

    def test_invalid_tokens_and_uids_are_rejected_generically(self):
        other = make_user(Role.END_USER)
        other_uid, other_token = tokens.make_reset_credentials(other)
        cases = {
            "garbage token": dict(token="garbage"),
            "tampered token": dict(token=self.token[:-4] + "aaaa"),
            "garbage uid": dict(uid="!!!"),
            "unknown uid": dict(uid="OTk5OTk5"),  # base64 of 999999
            "another user's token": dict(token=other_token),
            "another user's uid": dict(uid=other_uid),
        }
        for label, override in cases.items():
            with self.subTest(label):
                r = self.confirm(**override)
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "invalid_token"))
        self.assertTrue(self.password_is(PASSWORD))  # password untouched

    def test_missing_fields_are_validation_errors(self):
        for body in ({}, {"uid": self.uid}, {"uid": self.uid, "token": self.token}, {"token": self.token, "new_password": NEW_PASSWORD}):
            r = self.client.post(RESET_CONFIRM, body, format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_an_expired_token_is_rejected(self):
        timeout = timedelta(seconds=settings.PASSWORD_RESET_TIMEOUT)
        with patch.object(PasswordResetTokenGenerator, "_now", return_value=_now() + timeout + timedelta(seconds=5)):
            r = self.confirm()
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "invalid_token"))
        self.assertTrue(self.password_is(PASSWORD))
        with patch.object(PasswordResetTokenGenerator, "_now", return_value=_now() + timeout - timedelta(minutes=2)):
            self.assertEqual(self.confirm().status_code, 200)  # not expired yet

    def test_the_new_password_goes_through_djangos_validators(self):
        weak = {
            "too short": "Ab1!xyz",
            "common": "password123",
            "all numeric": "83920174659203",
            "similar to the email": "host@example.com",
        }
        for label, pw in weak.items():
            with self.subTest(label):
                r = self.confirm(new_password=pw)
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
                self.assertIn("new_password", self.error(r)["details"])
        self.assertTrue(self.password_is(PASSWORD))  # nothing changed
        self.assertEqual(self.confirm().status_code, 200)  # and the token was not used up by the failures

    def test_the_new_password_is_stored_hashed(self):
        self.confirm()
        stored = User.objects.get(pk=self.user.pk).password
        self.assertTrue(stored.startswith("pbkdf2_sha256$"))
        self.assertNotIn(NEW_PASSWORD, stored)

    def test_resetting_ends_every_existing_session(self):
        self.client.post(LOGIN, {"email": "host@example.com", "password": PASSWORD}, format="json")
        refresh = self.refresh_cookie()
        # signing in changes last_login, which also retires reset tokens issued before it
        uid, token = tokens.make_reset_credentials(User.objects.get(pk=self.user.pk))
        self.assertEqual(self.confirm(uid, token).status_code, 200)
        self.set_refresh_cookie(refresh)  # a session that was signed in before the reset
        r = self.client.post("/api/auth/token/refresh/")
        self.assertEqual(r.status_code, 401)

    def test_works_without_signing_in_and_ignores_a_stale_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.confirm().status_code, 200)

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get(RESET_CONFIRM).status_code, 405)

    def test_confirmation_attempts_are_rate_limited(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"auth": "3/min"}):
            for _ in range(3):
                self.confirm(token="guess")
            r = self.confirm()
        self.assertEqual(r.status_code, 429)
        self.assertEqual(self.login(PASSWORD), 200)

    def test_logs_never_contain_passwords_tokens_or_addresses(self):
        with self.assertLogs("apps", "INFO") as logs:
            self.confirm(new_password="Ab1!xyz")
            self.confirm()
        text = "\n".join(logs.output)
        self.assertIn("Password reset completed", text)
        for secret in (self.token, self.uid, NEW_PASSWORD, "Ab1!xyz", "host@example.com"):
            self.assertNotIn(secret, text)


def _now():
    from datetime import datetime

    return datetime.now()


RESEND = "/api/auth/resend-verification/"


class ResendVerificationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, email="guest@example.com", verified=False)

    def resend(self, email="guest@example.com"):
        return self.client.post(RESEND, {"email": email}, format="json")

    def test_an_unverified_account_gets_a_new_working_link(self):
        r = self.resend()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["guest@example.com"])
        url, params = link_params(mail.outbox[0])
        self.assertEqual(f"{url.scheme}://{url.netloc}{url.path}", f"{settings.FRONTEND_URL}/verify-email")
        self.assertEqual(self.client.post(VERIFY, {"token": params["token"]}, format="json").status_code, 200)
        self.assertTrue(User.objects.get(pk=self.user.pk).is_email_verified)

    def test_same_mechanism_and_expiry_as_the_first_email(self):
        self.resend()
        token = link_params(mail.outbox[0])[1]["token"]
        self.assertEqual(tokens.user_from_verification_token(token).pk, self.user.pk)
        with patch("django.core.signing.time.time", return_value=time.time() + settings.EMAIL_VERIFICATION_TIMEOUT + 60):
            self.assertIsNone(tokens.user_from_verification_token(token))

    def test_the_address_is_matched_case_insensitively(self):
        self.resend("GUEST@Example.COM")
        self.assertEqual(len(mail.outbox), 1)

    def test_no_email_is_sent_for_a_verified_unknown_or_deactivated_account(self):
        make_user(Role.END_USER, email="done@example.com", verified=True)
        make_user(Role.END_USER, email="off@example.com", verified=False, is_active=False)
        for email in ("done@example.com", "nobody@example.com", "off@example.com"):
            with self.subTest(email=email):
                self.assertEqual(self.resend(email).status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_the_answer_is_identical_whether_or_not_an_email_is_sent(self):
        make_user(Role.END_USER, email="done@example.com", verified=True)
        bodies = {str(self.resend(e).json()) for e in ("guest@example.com", "done@example.com", "nobody@example.com")}
        self.assertEqual(len(bodies), 1)

    def test_malformed_input_is_a_validation_error(self):
        for body in ({}, {"email": ""}, {"email": "nope"}):
            r = self.client.post(RESEND, body, format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_it_is_public_and_ignores_a_stale_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.resend().status_code, 200)

    def test_it_is_throttled(self):
        from apps.core.throttling import ResendVerificationRateThrottle

        with patch.dict(ResendVerificationRateThrottle.THROTTLE_RATES, {"resend_verification": "2/min"}):
            self.assertEqual(self.resend().status_code, 200)
            self.assertEqual(self.resend("other@example.com").status_code, 200)
            r = self.resend()
        self.assertEqual((r.status_code, self.error(r)["code"]), (429, "throttled"))
        self.assertEqual(len(mail.outbox), 1)

    def test_an_email_outage_still_gives_the_generic_answer(self):
        with patch("apps.accounts.emails.send_mail", side_effect=OSError("smtp down")), self.assertLogs("apps.accounts.emails", "ERROR"):
            self.assertEqual(self.resend().status_code, 200)

    def test_logs_contain_no_address_or_token(self):
        with self.assertLogs("apps", "INFO") as logs:
            self.resend()
        text = "\n".join(logs.output).lower()
        self.assertNotIn("guest@example.com", text)
        self.assertNotIn(link_params(mail.outbox[0])[1]["token"].lower(), text)
