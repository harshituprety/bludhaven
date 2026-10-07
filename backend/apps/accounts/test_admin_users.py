"""Super Admin user management (/api/users/): invitations, role/active changes, guards."""

from django.core import mail

from apps.billing.models import Subscription
from apps.core.testing import ApiTestCase, make_booking, make_property, make_user, subscribe
from apps.bookings.models import Booking

from .models import Role, User

U = "/api/users/"


class UserAdminTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER)
        self.authenticate(self.admin)

    def invite(self, **body):
        return self.client.post(U, {"email": "New.Host@Example.com", "full_name": "New Host", "role": "HOST", **body}, format="json")

    def test_only_super_admin_can_use_it(self):
        for user, code in ((self.host, 403), (self.guest, 403), (None, 401)):
            self.logout()
            if user:
                self.authenticate(user)
            self.assertEqual(self.client.get(U).status_code, code)
            self.assertEqual(self.client.post(U, {}, format="json").status_code, code)
            self.assertEqual(self.client.patch(f"{U}{self.guest.pk}/", {"is_active": False}, format="json").status_code, code)
            self.assertEqual(self.client.post(f"{U}{self.guest.pk}/send-password-reset/").status_code, code)

    def test_inviting_a_host_creates_an_unusable_password_and_emails_a_reset_link(self):
        r = self.invite()
        self.assertEqual(r.status_code, 201, r.content)
        d = r.json()
        self.assertEqual((d["email"], d["role"], d["invitation_pending"], d["is_email_verified"], d["invitation_sent"]), ("new.host@example.com", "HOST", True, False, True))
        self.assertNotIn("password", r.content.decode().lower().replace("invitation", ""))
        user = User.objects.get(pk=d["id"])
        self.assertFalse(user.has_usable_password())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("/reset-password?uid=", mail.outbox[0].body)

    def test_the_invited_person_sets_a_password_through_the_emailed_link_and_becomes_verified(self):
        import re

        self.invite()
        m = re.search(r"uid=([^&\s]+)&token=([^\s]+)", mail.outbox[0].body)
        self.logout()
        r = self.client.post("/api/auth/password-reset/confirm/", {"uid": m[1], "token": m[2], "new_password": "Sup3r-secret-pass!"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        user = User.objects.get(email="new.host@example.com")
        self.assertTrue(user.is_email_verified)
        login = self.client.post("/api/auth/token/", {"email": user.email, "password": "Sup3r-secret-pass!"}, format="json")
        self.assertEqual(login.status_code, 200)

    def test_invitation_validation(self):
        self.assertEqual(self.invite(role="SUPER_ADMIN").status_code, 400)
        self.assertEqual(self.invite(role="NOPE").status_code, 400)
        self.assertEqual(self.invite(email="bad").status_code, 400)
        self.assertEqual(self.invite(email=self.guest.email.upper()).status_code, 400)
        self.assertEqual(self.invite(full_name="").status_code, 400)
        r = self.invite(is_staff=True, is_superuser=True, password="x")  # ignored: cannot grant staff or set a password
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(pk=r.json()["id"])
        self.assertEqual((user.is_staff, user.is_superuser, user.has_usable_password()), (False, False, False))

    def test_invitation_succeeds_even_if_email_fails(self):
        from unittest.mock import patch

        with patch("apps.accounts.emails.send_mail", side_effect=OSError("smtp down")):
            r = self.invite()
        self.assertEqual((r.status_code, r.json()["invitation_sent"]), (201, False))

    def test_list_filter_search_and_detail(self):
        r = self.client.get(U)
        self.assertEqual(r.json()["count"], 3)
        self.assertEqual({u["id"] for u in self.client.get(U + "?role=HOST").json()["results"]}, {self.host.pk})
        self.assertEqual({u["id"] for u in self.client.get(U + "?email_verified=true").json()["results"]}, {self.admin.pk})
        self.assertEqual({u["id"] for u in self.client.get(f"{U}?search={self.guest.email}").json()["results"]}, {self.guest.pk})
        d = self.client.get(f"{U}{self.host.pk}/").json()
        self.assertEqual(set(d), {"id", "email", "full_name", "role", "is_active", "is_email_verified", "invitation_pending", "date_joined"})
        self.assertEqual(self.client.get(U + "?role=BOGUS").status_code, 400)

    def test_update_name_and_deactivate_ends_sessions_and_blocks_login(self):
        from rest_framework_simplejwt.tokens import RefreshToken

        refresh = RefreshToken.for_user(self.guest)
        r = self.client.patch(f"{U}{self.guest.pk}/", {"full_name": "Renamed", "is_active": False}, format="json")
        self.assertEqual((r.status_code, r.json()["full_name"], r.json()["is_active"]), (200, "Renamed", False))
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        self.assertTrue(BlacklistedToken.objects.filter(token__jti=refresh["jti"]).exists())
        self.logout()
        r = self.client.post("/api/auth/token/", {"email": self.guest.email, "password": "irrelevant"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_unknown_and_read_only_fields_cannot_be_changed(self):
        self.client.patch(f"{U}{self.guest.pk}/", {"email": "x@example.com", "is_staff": True, "is_superuser": True, "email_verified_at": "2020-01-01T00:00:00Z"}, format="json")
        self.guest.refresh_from_db()
        self.assertFalse(self.guest.is_staff or self.guest.is_superuser or self.guest.is_email_verified)
        self.assertNotEqual(self.guest.email, "x@example.com")

    def test_guards_for_super_admins_and_self(self):
        other_admin = make_user(Role.SUPER_ADMIN)
        for target, body in ((other_admin, {"is_active": False}), (other_admin, {"role": "HOST"}), (self.admin, {"role": "HOST"}), (self.admin, {"is_active": False})):
            r = self.client.patch(f"{U}{target.pk}/", body, format="json")
            self.assertEqual(r.status_code, 409, (target, body))
        self.assertEqual(self.client.patch(f"{U}{self.guest.pk}/", {"role": "SUPER_ADMIN"}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"{U}{self.admin.pk}/", {"full_name": "Boss"}, format="json").status_code, 200)

    def test_role_changes_respect_data_the_user_owns(self):
        make_property(owner=self.host)
        r = self.client.patch(f"{U}{self.host.pk}/", {"role": "END_USER"}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "in_use"))
        empty_host = make_user(Role.HOST)
        sub = subscribe(empty_host)
        self.assertEqual(self.client.patch(f"{U}{empty_host.pk}/", {"role": "END_USER"}, format="json").status_code, 409)
        Subscription.objects.filter(pk=sub.pk).update(status="CANCELLED")
        self.assertEqual(self.client.patch(f"{U}{empty_host.pk}/", {"role": "END_USER"}, format="json").json()["role"], "END_USER")
        booker = make_user(Role.END_USER)
        make_booking(guest=booker, prop=make_property(), status=Booking.Status.CONFIRMED)
        self.assertEqual(self.client.patch(f"{U}{booker.pk}/", {"role": "HOST"}, format="json").status_code, 409)
        self.assertEqual(self.client.patch(f"{U}{self.guest.pk}/", {"role": "HOST"}, format="json").json()["role"], "HOST")

    def test_no_delete_or_put(self):
        self.assertEqual(self.client.delete(f"{U}{self.guest.pk}/").status_code, 405)
        self.assertEqual(self.client.put(f"{U}{self.guest.pk}/", {}, format="json").status_code, 405)
        self.assertTrue(User.objects.filter(pk=self.guest.pk).exists())

    def test_send_password_reset(self):
        r = self.client.post(f"{U}{self.guest.pk}/send-password-reset/")
        self.assertEqual((r.status_code, r.json()), (200, {"sent": True}))
        self.assertEqual(mail.outbox[-1].to, [self.guest.email])
        self.guest.is_active = False
        self.guest.save()
        self.assertEqual(self.client.post(f"{U}{self.guest.pk}/send-password-reset/").status_code, 409)
        self.assertEqual(self.client.post(f"{U}999999/send-password-reset/").status_code, 404)
