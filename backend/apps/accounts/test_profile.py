"""PATCH /api/auth/me/ and POST /api/auth/change-password/."""

from unittest.mock import patch

from django.conf import settings
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.testing import PASSWORD, ApiTestCase, make_user
from apps.core.throttling import AuthRateThrottle

from .models import Role, User

ME, CHANGE, LOGIN, REFRESH = "/api/auth/me/", "/api/auth/change-password/", "/api/auth/token/", "/api/auth/token/refresh/"
NEW = "a-Different-Str0ng-pass-9"


class ProfileUpdateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.HOST, email="host@example.com", full_name="Old Name")
        self.authenticate(self.user)

    def test_full_name_can_be_changed_and_is_trimmed(self):
        r = self.client.patch(ME, {"full_name": "  New Name "}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["full_name"], "New Name")
        self.assertEqual(set(r.json()), {"id", "email", "full_name", "role", "is_email_verified", "date_joined"})
        self.user.refresh_from_db()
        self.assertEqual(self.user.full_name, "New Name")

    def test_requires_authentication(self):
        self.logout()
        self.assertEqual(self.client.patch(ME, {"full_name": "X"}, format="json").status_code, 401)

    def test_blank_or_missing_or_too_long_names_are_rejected(self):
        for body in ({"full_name": ""}, {"full_name": "   "}, {"full_name": "x" * 151}, {}):
            with self.subTest(body=body):
                r = self.client.patch(ME, body, format="json")
                self.assertEqual(r.status_code, 400)
                self.assertEqual(self.error(r)["code"], "validation_error")
        self.user.refresh_from_db()
        self.assertEqual(self.user.full_name, "Old Name")

    def test_no_privileged_or_identity_field_can_be_changed(self):
        original = User.objects.values().get(pk=self.user.pk)
        for field, value in {
            "role": Role.SUPER_ADMIN, "is_staff": True, "is_superuser": True, "is_active": False, "email": "evil@example.com",
            "email_verified_at": "2030-01-01T00:00:00Z", "is_email_verified": True, "password": "x", "id": 999,
            "subscription": 1, "owner": 1, "date_joined": "2000-01-01T00:00:00Z",
        }.items():
            with self.subTest(field=field):
                r = self.client.patch(ME, {"full_name": "Fine Name", field: value}, format="json")
                self.assertEqual(r.status_code, 400)
                self.assertIn(field, self.error(r)["details"])
        self.assertEqual(User.objects.values().get(pk=self.user.pk), original)  # nothing was saved, not even the name

    def test_one_user_cannot_change_another(self):
        other = make_user(Role.END_USER, full_name="Other")
        self.client.patch(ME, {"full_name": "Hijack"}, format="json")
        other.refresh_from_db()
        self.assertEqual(other.full_name, "Other")

    def test_every_role_can_edit_its_own_name_but_stays_in_its_role(self):
        for role in (Role.END_USER, Role.HOST, Role.SUPER_ADMIN):
            with self.subTest(role=role):
                user = make_user(role)
                self.authenticate(user)
                self.assertEqual(self.client.patch(ME, {"full_name": f"Renamed {role}"}, format="json").status_code, 200)
                user.refresh_from_db()
                self.assertEqual((user.role, user.full_name), (role, f"Renamed {role}"))


class ChangePasswordTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, email="guest@example.com")
        self.authenticate(self.user)

    def change(self, current=PASSWORD, new=NEW):
        return self.client.post(CHANGE, {"current_password": current, "new_password": new}, format="json")

    def test_success_changes_the_password(self):
        r = self.change()
        self.assertEqual(r.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW))
        self.assertFalse(self.user.check_password(PASSWORD))
        self.assertNotIn(NEW, r.content.decode())
        self.assertNotIn(PASSWORD, r.content.decode())

    def test_login_works_with_the_new_password_only(self):
        self.change()
        self.logout()
        self.assertEqual(self.client.post(LOGIN, {"email": "guest@example.com", "password": PASSWORD}, format="json").status_code, 401)
        self.assertEqual(self.client.post(LOGIN, {"email": "guest@example.com", "password": NEW}, format="json").status_code, 200)

    def test_requires_authentication(self):
        self.logout()
        self.assertEqual(self.change().status_code, 401)

    def test_wrong_current_password_is_a_400_on_that_field_and_changes_nothing(self):
        r = self.change(current="not-the-password-1")
        self.assertEqual(r.status_code, 400)
        self.assertIn("current_password", self.error(r)["details"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_missing_fields_are_rejected(self):
        for body in ({}, {"current_password": PASSWORD}, {"new_password": NEW}):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(CHANGE, body, format="json").status_code, 400)

    def test_the_old_password_cannot_be_reused(self):
        r = self.change(new=PASSWORD)
        self.assertEqual(r.status_code, 400)
        self.assertIn("new_password", self.error(r)["details"])

    def test_new_password_must_pass_the_django_validators(self):
        for weak in ("short1", "password", "12345678901", "guest@example.com"):
            with self.subTest(weak=weak):
                r = self.change(new=weak)
                self.assertEqual(r.status_code, 400)
                self.assertIn("new_password", self.error(r)["details"])
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_all_refresh_tokens_are_revoked_and_the_cookie_cleared(self):
        tokens = [RefreshToken.for_user(self.user) for _ in range(3)]  # three devices
        r = self.change()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.cookies[settings.REFRESH_COOKIE_NAME].value, "")
        self.assertEqual(BlacklistedToken.objects.filter(token__user=self.user).count(), 3)
        for token in tokens:
            self.set_refresh_cookie(token)
            self.assertEqual(self.client.post(REFRESH).status_code, 401)

    def test_other_users_sessions_are_untouched(self):
        other = make_user(Role.HOST)
        token = RefreshToken.for_user(other)
        self.change()
        self.set_refresh_cookie(token)
        self.assertEqual(self.client.post(REFRESH).status_code, 200)

    def test_a_failed_change_does_not_revoke_sessions(self):
        token = RefreshToken.for_user(self.user)
        self.change(current="wrong-password-1")
        self.assertFalse(BlacklistedToken.objects.filter(token__user=self.user).exists())
        self.set_refresh_cookie(token)
        self.assertEqual(self.client.post(REFRESH).status_code, 200)

    def test_an_access_token_issued_earlier_keeps_working_until_it_expires_like_after_a_reset(self):
        self.change()
        self.assertEqual(self.client.get(ME).status_code, 200)

    def test_passwords_are_never_logged(self):
        with self.assertLogs("apps.accounts.views", level="INFO") as logs:
            self.change(new=NEW)
            self.change(current="wrong-password-1", new="another-Str0ng-pass-7")
        text = "\n".join(logs.output)
        for secret in (PASSWORD, NEW, "wrong-password-1", "another-Str0ng-pass-7"):
            self.assertNotIn(secret, text)
        self.assertIn(f"id={self.user.pk}", text)

    def test_attempts_are_rate_limited_per_user(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"password_change": "3/hour"}):
            for _ in range(3):
                self.assertEqual(self.change(current="wrong-password-1").status_code, 400)
            r = self.change()  # even the right password is refused now
            self.assertEqual((r.status_code, self.error(r)["code"]), (429, "throttled"))
            self.user.refresh_from_db()
            self.assertTrue(self.user.check_password(PASSWORD))
            other = make_user(Role.END_USER)
            self.authenticate(other)
            self.assertEqual(self.change().status_code, 200)  # another user has their own allowance

    def test_a_host_invited_without_a_password_cannot_use_it(self):
        invited = make_user(Role.HOST, password="!unusable")
        self.authenticate(invited)
        self.assertEqual(self.change(current="").status_code, 400)
