"""Plans, subscriptions, billing profiles and plan-limit enforcement through the HTTP API."""

from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.utils import timezone

from apps.accounts.models import Role
from apps.catalog.models import PropertyImage
from apps.core.testing import (
    ApiTestCase, FakeStorage, image_bytes, make_destination, make_plan, make_property, make_user, subscribe,
)
from django.core.files.uploadedfile import SimpleUploadedFile

from .models import BillingProfile, Subscription, SubscriptionPlan

PLANS, SUBS, BP, BPS = "/api/plans/", "/api/subscriptions/", "/api/billing-profile/", "/api/billing-profiles/"


class BillingTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.other_host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER, verified=True)

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client


class PlanApiTests(BillingTestCase):
    payload = {"name": "Starter", "price": "1500.00", "duration_days": 30, "features": {"max_properties": 2, "max_images_per_property": 5}}

    def test_super_admin_crud(self):
        r = self.as_(self.admin).post(PLANS, self.payload, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        pid = r.json()["id"]
        r = self.client.patch(f"{PLANS}{pid}/", {"price": "1800.00", "is_active": False}, format="json")
        self.assertEqual((r.status_code, r.json()["price"], r.json()["is_active"]), (200, "1800.00", False))
        self.assertEqual(self.client.delete(f"{PLANS}{pid}/").status_code, 204)

    def test_only_super_admin_writes(self):
        for user, code in ((self.host, 403), (self.guest, 403), (None, 401)):
            self.assertEqual(self.as_(user).post(PLANS, self.payload, format="json").status_code, code)
        plan = make_plan()
        for user, code in ((self.host, 403), (self.guest, 403), (None, 401)):
            self.as_(user)
            self.assertEqual(self.client.patch(f"{PLANS}{plan.pk}/", {"price": "1"}, format="json").status_code, code)
            self.assertEqual(self.client.delete(f"{PLANS}{plan.pk}/").status_code, code)

    def test_plans_are_public_and_only_the_admin_sees_inactive_ones(self):
        live, hidden = make_plan(), make_plan(is_active=False)
        ids = lambda u: {p["id"] for p in self.as_(u).get(PLANS).json()["results"]}
        for user in (None, self.guest, self.host):
            self.assertEqual(ids(user), {live.pk})
            self.assertEqual(self.as_(user).get(f"{PLANS}{hidden.pk}/").status_code, 404)
            self.assertEqual(self.as_(user).get(f"{PLANS}{live.pk}/").status_code, 200)
        self.assertEqual(ids(self.admin), {live.pk, hidden.pk})
        self.assertEqual(self.as_(self.admin).get(f"{PLANS}{hidden.pk}/").status_code, 200)

    def test_public_plan_output_exposes_only_plan_facts(self):
        make_plan(features={"max_properties": 2})
        item = self.as_(None).get(PLANS).json()["results"][0]
        self.assertEqual(set(item), {"id", "name", "description", "price", "duration_days", "features", "is_active", "is_trial", "display_order", "created_at", "updated_at"})

    def test_validation(self):
        self.as_(self.admin)
        bad = [
            {"price": "-1"}, {"duration_days": 0}, {"name": ""}, {"features": {"max_properties": -1}},
            {"features": {"max_properties": "5"}}, {"features": {"max_properties": True}}, {"features": {"free_pony": 1}},
            {"features": [1]},
        ]
        for change in bad:
            with self.subTest(change):
                r = self.client.post(PLANS, {**self.payload, **change}, format="json")
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
        self.assertEqual(self.client.post(PLANS, self.payload, format="json").status_code, 201)
        self.assertEqual(self.client.post(PLANS, self.payload, format="json").status_code, 400)  # duplicate name
        self.assertEqual(SubscriptionPlan.objects.count(), 1)

    def test_a_plan_with_subscriptions_cannot_be_deleted(self):
        plan = make_plan()
        subscribe(self.host, plan)
        r = self.as_(self.admin).delete(f"{PLANS}{plan.pk}/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "in_use"))


class SubscriptionApiTests(BillingTestCase):
    def setUp(self):
        super().setUp()
        self.plan = make_plan(price="1200.00", duration_days=30)

    def assign(self, **body):
        return self.as_(self.admin).post(SUBS, {"user": self.host.pk, "plan": self.plan.pk, **body}, format="json")

    def test_assigning_a_plan_computes_expiry_and_snapshots_the_price(self):
        r = self.assign(start_date="2030-01-01")
        self.assertEqual(r.status_code, 201, r.content)
        d = r.json()
        self.assertEqual((d["start_date"], d["expiry_date"], d["amount"]), ("2030-01-01", "2030-01-31", "1200.00"))
        self.assertEqual((d["status"], d["payment_status"], d["is_current"]), ("ACTIVE", "PENDING", False))
        self.plan.price = 5000
        self.plan.save()
        self.assertEqual(Subscription.objects.get().amount, 1200)

    def test_default_start_is_today(self):
        d = self.assign().json()
        self.assertEqual(d["start_date"], timezone.localdate().isoformat())
        self.assertTrue(d["is_current"])

    def test_only_active_plans_and_active_hosts_can_be_assigned(self):
        inactive = make_plan(is_active=False)
        self.assertEqual(self.assign(plan=inactive.pk).status_code, 400)
        self.assertEqual(self.assign(user=self.guest.pk).status_code, 400)
        self.assertEqual(self.assign(user=self.admin.pk).status_code, 400)
        self.host.is_active = False
        self.host.save()
        self.assertEqual(self.assign().status_code, 400)
        self.assertEqual(Subscription.objects.count(), 0)

    def test_overlapping_active_subscriptions_are_refused(self):
        self.assertEqual(self.assign(start_date="2030-01-01").status_code, 201)
        r = self.assign(start_date="2030-01-15")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "subscription_overlap"))
        self.assertEqual(self.assign(start_date="2030-01-31").status_code, 201)  # starts the day the first expires
        self.assertEqual(self.assign(user=self.other_host.pk, start_date="2030-01-15").status_code, 201)

    def test_only_super_admin_assigns_or_updates(self):
        sub = subscribe(self.host)
        for user, code in ((self.host, 403), (self.guest, 403), (None, 401)):
            self.assertEqual(self.as_(user).post(SUBS, {"user": self.host.pk, "plan": self.plan.pk}, format="json").status_code, code)
            self.assertEqual(self.client.patch(f"{SUBS}{sub.pk}/", {"payment_status": "PAID"}, format="json").status_code, code)

    def test_status_and_payment_updates(self):
        sub = subscribe(self.host)
        self.as_(self.admin)
        r = self.client.patch(f"{SUBS}{sub.pk}/", {"payment_status": "PAID"}, format="json")
        self.assertEqual((r.status_code, r.json()["payment_status"]), (200, "PAID"))
        r = self.client.patch(f"{SUBS}{sub.pk}/", {"status": "CANCELLED"}, format="json")
        self.assertEqual((r.status_code, r.json()["status"], r.json()["is_current"]), (200, "CANCELLED", False))
        r = self.client.patch(f"{SUBS}{sub.pk}/", {"status": "EXPIRED"}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_transition"))
        self.assertEqual(self.client.patch(f"{SUBS}{sub.pk}/", {"status": "ACTIVE"}, format="json").status_code, 409)  # a cancelled subscription stays cancelled
        self.assertEqual(self.client.patch(f"{SUBS}{sub.pk}/", {"payment_status": "LOL"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"{SUBS}{sub.pk}/").status_code, 405)
        self.assertEqual(self.client.put(f"{SUBS}{sub.pk}/", {}, format="json").status_code, 405)

    def test_amount_dates_user_and_plan_cannot_be_edited(self):
        sub = subscribe(self.host, self.plan)
        self.as_(self.admin).patch(f"{SUBS}{sub.pk}/", {"amount": "1", "expiry_date": "2099-01-01", "user": self.other_host.pk, "plan": make_plan().pk}, format="json")
        after = Subscription.objects.get(pk=sub.pk)
        self.assertEqual((after.amount, after.expiry_date, after.user_id, after.plan_id), (sub.amount, sub.expiry_date, self.host.pk, self.plan.pk))

    def test_visibility_host_sees_only_their_own(self):
        mine, theirs = subscribe(self.host), subscribe(self.other_host)
        ids = lambda u, q="": {s["id"] for s in self.as_(u).get(SUBS + q).json()["results"]}
        self.assertEqual(ids(self.host), {mine.pk})
        self.assertEqual(ids(self.admin), {mine.pk, theirs.pk})
        self.assertEqual(ids(self.admin, f"?user={self.other_host.pk}"), {theirs.pk})
        self.assertEqual(ids(self.admin, "?status=CANCELLED"), set())
        self.assertEqual(self.as_(self.host).get(f"{SUBS}{theirs.pk}/").status_code, 404)
        self.assertEqual(self.as_(self.guest).get(SUBS).status_code, 403)
        self.assertEqual(self.as_(None).get(SUBS).status_code, 401)

    def test_current_shows_the_entitling_subscription_and_usage(self):
        r = self.as_(self.host).get(SUBS + "current/")
        self.assertEqual(r.json()["subscription"], None)
        subscribe(self.host, make_plan(features={"max_properties": 3, "max_images_per_property": 7}))
        make_property(owner=self.host)
        d = self.client.get(SUBS + "current/").json()
        self.assertEqual(d["subscription"]["plan"]["features"]["max_properties"], 3)
        self.assertEqual(d["usage"], {"properties": {"used": 1, "limit": 3}, "max_images_per_property": 7, "status": "ACTIVE"})
        self.assertEqual(self.as_(self.admin).get(SUBS + "current/").status_code, 403)

    def test_expired_and_cancelled_subscriptions_do_not_entitle(self):
        today = timezone.localdate()
        subscribe(self.host, start_date=today - timedelta(days=40))  # ran out yesterday-ish (30 days)
        subscribe(self.host, start_date=today, status=Subscription.Status.CANCELLED)
        self.assertIsNone(self.as_(self.host).get(SUBS + "current/").json()["subscription"])

    def test_expire_command(self):
        old = subscribe(self.host, start_date=timezone.localdate() - timedelta(days=40))
        fresh = subscribe(self.other_host)
        out = StringIO()
        call_command("expire_subscriptions", stdout=out)
        old.refresh_from_db(), fresh.refresh_from_db()
        self.assertEqual((old.status, fresh.status), ("EXPIRED", "ACTIVE"))
        self.assertIn("expired: 1", out.getvalue())


class SubscriptionRenewTests(BillingTestCase):
    def setUp(self):
        super().setUp()
        self.plan = make_plan(price="1200.00", duration_days=30)
        self.today = timezone.localdate()

    def renew(self, sub, user=None, **body):
        return self.as_(user or self.admin).post(f"{SUBS}{sub.pk}/renew/", body, format="json")

    def test_renewing_a_running_subscription_extends_from_its_expiry(self):
        sub = subscribe(self.host, self.plan, payment_status="PAID")
        old_expiry, old_start = sub.expiry_date, sub.start_date
        r = self.renew(sub)
        self.assertEqual(r.status_code, 200, r.content)
        sub.refresh_from_db()
        self.assertEqual((sub.start_date, sub.expiry_date), (old_start, old_expiry + timedelta(days=30)))
        self.assertEqual((sub.status, sub.payment_status), ("ACTIVE", "PENDING"))  # the new period is unpaid until marked
        self.assertEqual(self.renew(sub, payment_status="PAID").json()["payment_status"], "PAID")

    def test_price_snapshot_is_preserved_even_if_the_plan_price_changed(self):
        sub = subscribe(self.host, self.plan)
        self.plan.price = 9999
        self.plan.save()
        self.renew(sub)
        sub.refresh_from_db()
        self.assertEqual(str(sub.amount), "1200.00")

    def test_a_lapsed_subscription_restarts_today(self):
        sub = subscribe(self.host, self.plan, start_date=self.today - timedelta(days=60), status="EXPIRED")
        r = self.renew(sub)
        sub.refresh_from_db()
        self.assertEqual((sub.status, sub.start_date, sub.expiry_date), ("ACTIVE", self.today, self.today + timedelta(days=30)))
        self.assertTrue(r.json()["is_current"])

    def test_cancelled_subscriptions_cannot_be_renewed(self):
        sub = subscribe(self.host, self.plan, status="CANCELLED")
        r = self.renew(sub)
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_transition"))

    def test_inactive_plans_cannot_be_renewed_into(self):
        sub = subscribe(self.host, self.plan)
        self.plan.is_active = False
        self.plan.save()
        r = self.renew(sub)
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "plan_inactive"))

    def test_renewal_cannot_overlap_another_active_subscription(self):
        first = subscribe(self.host, self.plan, start_date=self.today - timedelta(days=10))  # ends in 20 days
        subscribe(self.host, self.plan, start_date=first.expiry_date + timedelta(days=5))  # a booked-ahead period
        r = self.renew(first)
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "subscription_overlap"))
        first.refresh_from_db()
        self.assertEqual(first.expiry_date, self.today + timedelta(days=20))

    def test_only_super_admin_can_renew_and_unknown_ids_404(self):
        sub = subscribe(self.host, self.plan)
        for user, code in ((self.host, 403), (self.guest, 403), (None, 401)):
            self.assertEqual(self.as_(user).post(f"{SUBS}{sub.pk}/renew/", {}, format="json").status_code, code)
        self.assertEqual(self.as_(self.admin).post(f"{SUBS}999999/renew/", {}, format="json").status_code, 404)

    def test_renewal_restores_entitlement(self):
        sub = subscribe(self.host, self.plan, start_date=self.today - timedelta(days=60), status="EXPIRED")
        self.assertIsNone(self.as_(self.host).get(SUBS + "current/").json()["subscription"])
        self.renew(sub)
        self.assertEqual(self.as_(self.host).get(SUBS + "current/").json()["subscription"]["id"], sub.pk)


class BillingProfileApiTests(BillingTestCase):
    body = {
        "billing_name": "Asha Rao", "billing_email": "asha@example.com", "address_line1": "12 MG Road",
        "city": "Pune", "state": "Maharashtra", "postal_code": "411001",
    }

    def test_host_creates_reads_and_updates_their_own(self):
        self.as_(self.host)
        empty = self.client.get(BP)
        self.assertEqual((empty.status_code, empty.json()), (200, None))  # no profile yet is a normal state, not an error
        r = self.client.put(BP, self.body, format="json")
        self.assertEqual((r.status_code, r.json()["country"]), (201, "India"))
        r = self.client.patch(BP, {"city": "Mumbai"}, format="json")
        self.assertEqual((r.status_code, r.json()["city"]), (200, "Mumbai"))
        self.assertEqual(self.client.put(BP, {**self.body, "state": "MH"}, format="json").status_code, 200)
        self.assertEqual(BillingProfile.objects.count(), 1)
        self.assertEqual(self.client.get(BP).json()["billing_name"], "Asha Rao")

    def test_validation_and_other_roles(self):
        self.assertEqual(self.as_(self.host).put(BP, {"billing_name": "x"}, format="json").status_code, 400)
        self.assertEqual(self.client.put(BP, {**self.body, "billing_email": "nope"}, format="json").status_code, 400)
        for user, code in ((self.guest, 403), (self.admin, 403), (None, 401)):
            self.assertEqual(self.as_(user).get(BP).status_code, code)
            self.assertEqual(self.client.put(BP, self.body, format="json").status_code, code)

    def test_user_field_in_payload_is_ignored(self):
        self.as_(self.host).put(BP, {**self.body, "user": self.other_host.pk}, format="json")
        self.assertTrue(BillingProfile.objects.filter(user=self.host).exists())
        self.assertFalse(BillingProfile.objects.filter(user=self.other_host).exists())

    def test_super_admin_can_read_but_not_write_any_profile(self):
        BillingProfile.objects.create(user=self.host, **self.body)
        r = self.as_(self.admin).get(BPS + f"?user={self.host.pk}")
        self.assertEqual([p["user"]["id"] for p in r.json()["results"]], [self.host.pk])
        detail = self.client.get(f"{BPS}{self.host.pk}/")
        self.assertEqual((detail.status_code, detail.json()["user"]["id"]), (200, self.host.pk))
        self.assertEqual(self.client.get(f"{BPS}{self.other_host.pk}/").status_code, 404)
        self.assertEqual(self.client.post(BPS, self.body, format="json").status_code, 405)
        self.assertEqual(self.as_(self.host).get(BPS).status_code, 403)


class PlanLimitTests(BillingTestCase):
    PROP = "/api/properties/"

    def payload(self, dest):
        return {"title": "Cabin", "description": "x", "property_type": "CABIN", "destination": dest.pk, "locality": "Hills",
                "price_per_night": "3500.00", "max_guests": 4}

    def test_a_host_without_a_subscription_cannot_create_properties(self):
        dest = make_destination()
        r = self.as_(self.host).post(self.PROP, self.payload(dest), format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "subscription_required"))

    def test_expired_subscription_blocks_creation(self):
        subscribe(self.host, start_date=timezone.localdate() - timedelta(days=60))
        r = self.as_(self.host).post(self.PROP, self.payload(make_destination()), format="json")
        self.assertEqual(self.error(r)["code"], "subscription_required")

    def test_max_properties_is_enforced_and_deleting_frees_a_slot(self):
        subscribe(self.host, make_plan(features={"max_properties": 2}))
        dest = make_destination()
        self.as_(self.host)
        ids = [self.client.post(self.PROP, self.payload(dest), format="json").json()["id"] for _ in range(2)]
        r = self.client.post(self.PROP, self.payload(dest), format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"))
        self.assertEqual(self.client.delete(f"{self.PROP}{ids[0]}/").status_code, 204)
        self.assertEqual(self.client.post(self.PROP, self.payload(dest), format="json").status_code, 201)

    def test_limit_applies_to_the_owner_even_when_a_super_admin_creates(self):
        subscribe(self.host, make_plan(features={"max_properties": 1}))
        dest = make_destination()
        self.as_(self.admin)
        self.assertEqual(self.client.post(self.PROP, {**self.payload(dest), "owner": self.host.pk}, format="json").status_code, 201)
        r = self.client.post(self.PROP, {**self.payload(dest), "owner": self.host.pk}, format="json")
        self.assertEqual(self.error(r)["code"], "plan_limit_reached")
        r = self.client.post(self.PROP, {**self.payload(dest), "owner": self.other_host.pk}, format="json")
        self.assertEqual(self.error(r)["code"], "subscription_required")

    def test_no_limit_key_means_unlimited(self):
        subscribe(self.host, make_plan(features={}))
        dest = make_destination()
        self.as_(self.host)
        self.assertTrue(all(self.client.post(self.PROP, self.payload(dest), format="json").status_code == 201 for _ in range(4)))

    def test_editing_and_deleting_existing_properties_never_needs_a_subscription(self):
        prop = make_property(owner=self.host)
        self.as_(self.host)
        self.assertEqual(self.client.patch(f"{self.PROP}{prop.pk}/", {"title": "New"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"{self.PROP}{prop.pk}/").status_code, 204)

    def test_payment_status_does_not_gate_anything(self):
        subscribe(self.host, payment_status=Subscription.PaymentStatus.FAILED)
        self.assertEqual(self.as_(self.host).post(self.PROP, self.payload(make_destination()), format="json").status_code, 201)

    def test_image_limit_and_subscription_for_uploads(self):
        prop = make_property(owner=self.host)
        url = f"{self.PROP}{prop.pk}/images/"
        up = lambda: self.as_(self.host).post(url, {"image": SimpleUploadedFile("a.png", image_bytes(), content_type="image/png")}, format="multipart")
        with FakeStorage() as cloud:
            self.assertEqual(self.error(up())["code"], "subscription_required")
            subscribe(self.host, make_plan(features={"max_images_per_property": 2}))
            self.assertEqual([up().status_code for _ in range(2)], [201, 201])
            r = up()
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"))
            self.assertEqual((PropertyImage.objects.count(), len(cloud.uploaded)), (2, 2))  # refused before uploading
            # the limit belongs to the property's owner, so a Super Admin hits the same wall
            self.assertEqual(self.as_(self.admin).post(url, {"image": SimpleUploadedFile("a.png", image_bytes(), content_type="image/png")}, format="multipart").status_code, 403)
