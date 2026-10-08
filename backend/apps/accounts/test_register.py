import json
from django.utils import timezone

from apps.core.testing import PASSWORD, ApiTestCase
from apps.core.throttling import RegisterRateThrottle
from unittest.mock import patch

from .models import Role, User

URL = "/api/auth/register/"
VALID = {"email": "New.Guest@Example.com", "full_name": "New Guest", "password": "correct-horse-battery-9"}


class RegisterApiTests(ApiTestCase):
    def register(self, **overrides):
        body = {**VALID, **overrides}
        body = {k: v for k, v in body.items() if v is not None}
        return self.client.post(URL, body, format="json")

    # --- success -----------------------------------------------------------

    def test_valid_registration_creates_an_end_user(self):
        r = self.register()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(set(r.json()), {"id", "email", "full_name", "role", "is_email_verified", "date_joined"})
        self.assertEqual(r.json()["email"], "new.guest@example.com")  # normalised
        self.assertEqual(r.json()["role"], Role.END_USER)
        user = User.objects.get(email="new.guest@example.com")
        self.assertEqual((user.role, user.is_staff, user.is_superuser, user.is_active), (Role.END_USER, False, False, True))

    def test_password_is_hashed_and_never_returned(self):
        r = self.register()
        self.assertNotIn(VALID["password"], r.content.decode())
        self.assertNotIn("password", r.json())
        user = User.objects.get(pk=r.json()["id"])
        self.assertNotEqual(user.password, VALID["password"])
        self.assertTrue(user.password.startswith("pbkdf2_sha256$"))
        self.assertTrue(user.check_password(VALID["password"]))

    def test_new_user_can_log_in_once_verified_and_is_an_end_user(self):
        self.register()
        User.objects.filter(email="new.guest@example.com").update(email_verified_at=timezone.now())
        r = self.client.post("/api/auth/token/", {"email": "new.guest@example.com", "password": VALID["password"]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["user"]["role"], Role.END_USER)

    def test_registration_is_public_even_with_a_stale_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.register().status_code, 201)

    # --- validation --------------------------------------------------------

    def test_duplicate_email_is_rejected_case_insensitively(self):
        self.assertEqual(self.register().status_code, 201)
        for email in ("new.guest@example.com", "NEW.GUEST@EXAMPLE.COM"):
            r = self.register(email=email)
            self.assertEqual(r.status_code, 400)
            self.assertEqual(self.error(r)["code"], "validation_error")
            self.assertIn("email", self.error(r)["details"])
        self.assertEqual(User.objects.count(), 1)

    def test_invalid_email_is_rejected(self):
        for bad in ("not-an-email", "a@", "@example.com", "a b@example.com", ""):
            with self.subTest(email=bad):
                r = self.register(email=bad)
                self.assertEqual(r.status_code, 400)
                self.assertIn("email", self.error(r)["details"])
        self.assertEqual(User.objects.count(), 0)

    def test_each_required_field_is_required(self):
        for field in ("email", "full_name", "password"):
            with self.subTest(missing=field):
                r = self.register(**{field: None})
                self.assertEqual(r.status_code, 400)
                self.assertIn(field, self.error(r)["details"])
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)
        self.assertEqual(self.register(full_name="").status_code, 400)
        self.assertEqual(self.register(full_name="   ").status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    def test_overlong_fields_are_rejected(self):
        self.assertEqual(self.register(full_name="x" * 151).status_code, 400)
        self.assertEqual(self.register(email="a" * 250 + "@example.com").status_code, 400)

    def test_weak_passwords_are_rejected_by_django_validators(self):
        weak = {
            "too short": "Ab1!xyz",
            "common": "password123",
            "all numeric": "83920174659203",
            "similar to email": "new.guest@example.com",
        }
        for label, pw in weak.items():
            with self.subTest(label):
                r = self.register(password=pw)
                self.assertEqual(r.status_code, 400)
                self.assertIn("password", self.error(r)["details"])
        self.assertEqual(User.objects.count(), 0)

    def test_malformed_json_is_a_400(self):
        r = self.client.post(URL, data="{not json", content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.error(r)["code"], "parse_error")

    def test_json_that_is_not_an_object_is_a_400(self):
        for payload in ("[]", '"text"', "123", "null"):
            with self.subTest(payload=payload):
                r = self.client.post(URL, data=payload, content_type="application/json")
                self.assertEqual(r.status_code, 400)

    def test_non_json_content_type_is_a_415(self):
        r = self.client.post(URL, data="email=a@example.com", content_type="application/x-www-form-urlencoded")
        self.assertEqual(r.status_code, 415)
        self.assertEqual(self.error(r)["code"], "unsupported_media_type")

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)

    # --- the role can never be chosen by the caller ------------------------

    def test_an_unexpected_role_field_is_rejected_and_creates_nothing(self):
        for role in (Role.END_USER, "end_user", "", 7):
            with self.subTest(role=role):
                r = self.register(role=role)
                self.assertEqual(r.status_code, 400)
                self.assertIn("role", self.error(r)["details"])
        r = self.client.post(URL, {**VALID, "role": None}, format="json")  # explicit null
        self.assertEqual(r.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    def test_creating_a_super_admin_is_impossible(self):
        for extra in ({"role": Role.SUPER_ADMIN}, {"is_superuser": True}, {"is_staff": True}, {"role": Role.SUPER_ADMIN, "is_staff": True, "is_superuser": True}):
            with self.subTest(extra=extra):
                r = self.register(**extra)
                self.assertEqual(r.status_code, 400)
        self.assertEqual(User.objects.count(), 0)
        self.assertFalse(User.objects.filter(role=Role.SUPER_ADMIN).exists())

    def test_creating_a_host_is_impossible(self):
        for extra in ({"role": Role.HOST}, {"role": "host"}, {"is_host": True}):
            with self.subTest(extra=extra):
                self.assertEqual(self.register(**extra).status_code, 400)
        self.assertEqual(User.objects.count(), 0)
        self.assertFalse(User.objects.filter(role=Role.HOST).exists())

    def test_other_model_fields_cannot_be_set(self):
        for extra in ({"is_active": False}, {"is_email_verified": True}, {"email_verified_at": "2020-01-01T00:00:00Z"}, {"id": 1}, {"date_joined": "2000-01-01T00:00:00Z"}, {"groups": [1]}):
            with self.subTest(extra=extra):
                self.assertEqual(self.register(**extra).status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    # --- abuse protection --------------------------------------------------

    def test_registration_is_rate_limited_per_client(self):
        with patch.dict(RegisterRateThrottle.THROTTLE_RATES, {"register": "2/min"}):
            for i in range(2):
                self.assertEqual(self.register(email=f"u{i}@example.com").status_code, 201)
            r = self.register(email="u2@example.com")
            self.assertEqual(r.status_code, 429)
            self.assertEqual(self.error(r)["code"], "throttled")
            self.assertIn("Retry-After", r)
        self.assertEqual(User.objects.count(), 2)
