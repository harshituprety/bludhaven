from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from apps.core.testing import PASSWORD, ApiTestCase, make_property, make_user

from .models import Role, User
from .permissions import HasRole, IsEndUser, IsHost, IsHostOrSuperAdmin, IsOwnerOrSuperAdmin, IsSuperAdmin


class UserModelTests(TestCase):
    def test_create_user_defaults_to_end_user_and_lowercases_email(self):
        u = User.objects.create_user("  Mixed.Case@Example.COM ", PASSWORD, full_name="X")
        self.assertEqual(u.email, "mixed.case@example.com")
        self.assertEqual(u.role, Role.END_USER)
        self.assertFalse(u.is_staff or u.is_superuser)
        self.assertTrue(u.check_password(PASSWORD))

    def test_email_is_required_and_unique_case_insensitively(self):
        with self.assertRaises(ValueError):
            User.objects.create_user("", PASSWORD)
        User.objects.create_user("a@example.com", PASSWORD, full_name="A")
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user("A@example.com", PASSWORD, full_name="B")

    def test_create_user_can_never_make_staff_or_super_admin(self):
        with self.assertRaises(ValueError):
            User.objects.create_user("s@example.com", PASSWORD, full_name="S", role=Role.SUPER_ADMIN)
        u = User.objects.create_user("t@example.com", PASSWORD, full_name="T", is_staff=True, is_superuser=True)
        self.assertFalse(u.is_staff or u.is_superuser)

    def test_create_superuser_forces_super_admin_role(self):
        u = User.objects.create_superuser("root@example.com", PASSWORD, full_name="Root")
        self.assertEqual(u.role, Role.SUPER_ADMIN)
        self.assertTrue(u.is_staff and u.is_superuser and u.is_super_admin)

    def test_database_rejects_a_non_super_admin_staff_user(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create(email="h@example.com", full_name="H", role=Role.HOST, is_staff=True)

    def test_unknown_role_is_not_a_valid_choice(self):
        u = User(email="r@example.com", full_name="R", role="ROOT")
        with self.assertRaises(Exception):
            u.full_clean()


class AuthApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.HOST, email="host@example.com")

    def login(self, email="host@example.com", password=PASSWORD):
        return self.client.post("/api/auth/token/", {"email": email, "password": password}, format="json")

    def test_login_by_email_returns_tokens_and_user(self):
        r = self.login("HOST@example.com")  # case-insensitive
        self.assertEqual(r.status_code, 200)
        self.assertEqual({"access", "user"}, set(r.data))  # the refresh token travels only in the httpOnly cookie
        self.assertEqual(r.data["user"]["role"], Role.HOST)
        self.assertNotIn("password", r.data["user"])

    def test_wrong_password_unknown_user_and_inactive_user_are_401(self):
        self.assertEqual(self.login(password="nope").status_code, 401)
        self.assertEqual(self.login(email="ghost@example.com").status_code, 401)
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 401)

    def test_missing_fields_are_400(self):
        self.assertEqual(self.client.post("/api/auth/token/", {}, format="json").status_code, 400)

    def test_me_requires_a_valid_token(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        access = self.login().data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        r = self.client.get("/api/auth/me/")
        self.assertEqual((r.status_code, r.data["email"], r.data["role"]), (200, "host@example.com", Role.HOST))

    def test_refresh_rotates_and_blacklists_the_old_refresh_token(self):
        self.login()
        old = self.refresh_cookie()
        r = self.client.post("/api/auth/token/refresh/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()), {"access"})
        self.assertNotEqual(self.refresh_cookie(), old)
        self.set_refresh_cookie(old)  # replaying the rotated-out token
        self.assertEqual(self.client.post("/api/auth/token/refresh/").status_code, 401)

    def test_logout_revokes_the_refresh_token_and_clears_the_cookie(self):
        self.login()
        token = self.refresh_cookie()
        r = self.client.post("/api/auth/token/blacklist/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.cookies["bludhaven_refresh"].value, "")
        self.set_refresh_cookie(token)
        self.assertEqual(self.client.post("/api/auth/token/refresh/").status_code, 401)

    def test_health_stays_public_even_with_a_bad_token(self):
        self.assertEqual(self.client.get("/api/health/").status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer garbage")
        r = self.client.get("/api/health/")
        self.assertEqual((r.status_code, r.data), (200, {"status": "ok"}))

    def test_role_is_read_from_the_database_not_the_token(self):
        access = self.login().data["access"]
        User.objects.filter(pk=self.user.pk).update(role=Role.END_USER)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(self.client.get("/api/auth/me/").data["role"], Role.END_USER)


class PermissionClassTests(TestCase):
    def setUp(self):
        self.rf = APIRequestFactory()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.other_host = make_user(Role.HOST)
        self.end_user = make_user(Role.END_USER)

    def allowed(self, perm_cls, user):
        request = self.rf.get("/")
        request.user = user
        return perm_cls().has_permission(request, None)

    def test_role_permissions_matrix(self):
        matrix = {
            IsSuperAdmin: (True, False, False),
            IsHost: (False, True, False),
            IsEndUser: (False, False, True),
            IsHostOrSuperAdmin: (True, True, False),
        }
        for perm, (a, h, e) in matrix.items():
            with self.subTest(perm=perm.__name__):
                self.assertEqual(self.allowed(perm, self.admin), a)
                self.assertEqual(self.allowed(perm, self.host), h)
                self.assertEqual(self.allowed(perm, self.end_user), e)

    def test_anonymous_and_inactive_users_are_denied(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertFalse(self.allowed(IsSuperAdmin, AnonymousUser()))
        self.host.is_active = False
        self.assertFalse(self.allowed(IsHost, self.host))

    def test_has_role_base_class_denies_when_no_roles_given(self):
        self.assertFalse(self.allowed(HasRole, self.admin))

    def _object_allowed(self, user, obj, owner_field=None):
        class View:
            pass

        view = View()
        if owner_field:
            view.owner_field = owner_field
        request = self.rf.get("/")
        request.user = user
        return IsOwnerOrSuperAdmin().has_object_permission(request, view, obj)

    def test_host_can_only_touch_their_own_objects(self):
        prop = make_property(owner=self.host)
        self.assertTrue(self._object_allowed(self.host, prop))
        self.assertFalse(self._object_allowed(self.other_host, prop))
        self.assertFalse(self._object_allowed(self.end_user, prop))

    def test_super_admin_can_touch_any_object(self):
        self.assertTrue(self._object_allowed(self.admin, make_property(owner=self.host)))

    def test_dotted_owner_field_and_missing_owner(self):
        from apps.bookings.models import Booking
        from apps.core.testing import dates

        prop = make_property(owner=self.host)
        ci, co = dates()
        booking = Booking.objects.create(guest=self.end_user, property=prop, check_in=ci, check_out=co, guests_count=2, total_price=9000)
        self.assertTrue(self._object_allowed(self.host, booking, owner_field="property.owner"))
        self.assertFalse(self._object_allowed(self.other_host, booking, owner_field="property.owner"))
        self.assertTrue(self._object_allowed(self.end_user, booking, owner_field="guest"))
        self.assertFalse(self._object_allowed(self.host, booking, owner_field="no_such_field"))
