"""Host onboarding: Host sign-up, draft listings, photo order, premium amenities, publishing, privacy."""

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.accounts.models import Role, User
from apps.billing.models import Subscription
from apps.core.testing import FakeStorage, image_bytes, make_amenity, make_destination, make_plan, make_property, make_user, subscribe

from .models import Amenity, Property, PropertyImage
from .test_api_catalog import PROP, CatalogTestCase

REG = "/api/auth/register-host/"
PW = "Str0ng-Passw0rd-xyz!"


class HostSignupTests(CatalogTestCase):
    def test_creates_a_host_with_the_role_set_by_the_server(self):
        r = self.as_(None).post(REG, {"email": "new.host@example.com", "full_name": "New Host", "password": PW}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        user = User.objects.get(email="new.host@example.com")
        self.assertEqual((user.role, user.is_staff, user.is_superuser), (Role.HOST, False, False))
        self.assertIsNone(user.email_verified_at)
        self.assertNotIn("password", r.json())

    def test_a_client_cannot_choose_the_role_or_staff_flags(self):
        for extra in ({"role": "SUPER_ADMIN"}, {"role": "HOST"}, {"is_staff": True}):
            r = self.as_(None).post(REG, {"email": "x@example.com", "full_name": "X", "password": PW, **extra}, format="json")
            self.assertEqual(r.status_code, 400, extra)
        self.assertFalse(User.objects.filter(email="x@example.com").exists())

    def test_duplicate_email_and_weak_password_are_refused(self):
        self.assertEqual(self.as_(None).post(REG, {"email": self.host.email, "full_name": "X", "password": PW}, format="json").status_code, 400)
        self.assertEqual(self.client.post(REG, {"email": "y@example.com", "full_name": "Y", "password": "123"}, format="json").status_code, 400)

    def test_guest_signup_still_makes_an_end_user_and_rejects_role(self):
        r = self.as_(None).post("/api/auth/register/", {"email": "g@example.com", "full_name": "G", "password": PW}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(User.objects.get(email="g@example.com").role, Role.END_USER)
        self.assertEqual(self.client.post("/api/auth/register/", {"email": "h@example.com", "full_name": "H", "password": PW, "role": "HOST"}, format="json").status_code, 400)


class DraftTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.newbie = make_user(Role.HOST, verified=True)  # no plan yet
        self.dest = make_destination("Goa")

    def draft(self, user=None, **extra):
        return self.as_(user or self.newbie).post(PROP, self.prop_payload(self.dest, status="DRAFT", address_line1="12 Beach Rd", postal_code="403001", **extra), format="json")

    def test_a_host_without_a_plan_can_save_a_draft_but_not_a_published_listing(self):
        r = self.draft()
        self.assertEqual((r.status_code, r.json()["status"]), (201, "DRAFT"))
        r = self.client.post(PROP, self.prop_payload(self.dest), format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "subscription_required"))

    def test_drafts_are_capped(self):
        with override_settings(MAX_DRAFTS_PER_HOST=2):
            self.assertEqual(self.draft().status_code, 201)
            self.assertEqual(self.draft().status_code, 201)
            r = self.draft()
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "draft_limit_reached"))

    def test_drafts_are_invisible_to_the_public_and_other_hosts(self):
        pk = self.draft().json()["id"]
        for user in (None, self.guest, self.other_host):
            self.assertEqual(self.as_(user).get(f"{PROP}{pk}/").status_code, 404)
            self.assertNotIn(pk, [p["id"] for p in self.client.get(PROP).json()["results"]])
            self.assertEqual(self.client.get(f"{PROP}{pk}/availability/").status_code, 404)
            self.assertEqual(self.client.get(f"{PROP}{pk}/images/").status_code, 404)
        self.assertEqual(self.as_(self.newbie).get(f"{PROP}{pk}/").status_code, 200)
        self.assertNotIn(pk, [p["id"] for p in self.client.get(PROP).json()["results"]])  # not in the public list, even for the owner
        self.assertIn(pk, [p["id"] for p in self.client.get(PROP + "?mine=true").json()["results"]])
        self.assertEqual(self.as_(self.admin).get(f"{PROP}{pk}/").status_code, 200)

    def test_a_draft_cannot_be_booked_or_favourited(self):
        pk = self.draft().json()["id"]
        verified = make_user(Role.END_USER, verified=True)
        self.assertEqual(self.as_(verified).post("/api/favourites/", {"property_id": pk}, format="json").status_code, 400)
        r = self.client.post("/api/bookings/", {"property": pk, "check_in": "2030-01-01", "check_out": "2030-01-03", "guests_count": 2}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_destination_counts_ignore_drafts(self):
        self.draft()
        before = [d for d in self.as_(None).get("/api/destinations/").json()["results"] if d["id"] == self.dest.pk][0]
        self.assertEqual(before["property_count"], 0)

    def test_status_cannot_be_changed_by_a_plain_update(self):
        pk = self.draft().json()["id"]
        r = self.as_(self.newbie).patch(f"{PROP}{pk}/", {"status": "PUBLISHED"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Property.objects.get(pk=pk).status, "DRAFT")

    def test_draft_saves_progress_step_by_step(self):
        pk = self.draft().json()["id"]
        r = self.client.patch(f"{PROP}{pk}/", {"title": "Better title", "address_line2": "Unit 4"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.json()["title"], r.json()["address_line2"]), ("Better title", "Unit 4"))

    def test_the_address_goes_only_to_the_owner_and_admin(self):
        pk = self.draft().json()["id"]
        self.assertEqual(self.as_(self.newbie).get(f"{PROP}{pk}/").json()["address_line1"], "12 Beach Rd")
        self.assertEqual(self.as_(self.admin).get(f"{PROP}{pk}/").json()["postal_code"], "403001")
        public = make_property(owner=self.host, address_line1="Secret 1", postal_code="111111")
        for user in (None, self.guest, self.other_host):
            d = self.as_(user).get(f"{PROP}{public.pk}/").json()
            self.assertNotIn("address_line1", d)
            self.assertNotIn("postal_code", d)
        self.assertNotIn("Secret 1", self.client.get(PROP).content.decode())

    def test_another_host_cannot_touch_my_draft(self):
        pk = self.draft().json()["id"]
        self.assertEqual(self.as_(self.other_host).patch(f"{PROP}{pk}/", {"title": "Hijack"}, format="json").status_code, 404)
        self.assertEqual(self.client.post(f"{PROP}{pk}/publish/").status_code, 404)
        self.assertEqual(self.client.delete(f"{PROP}{pk}/").status_code, 404)


class PhotoTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.newbie = make_user(Role.HOST, verified=True)
        self.prop = make_property(owner=self.newbie, status="DRAFT")
        self.url = f"{PROP}{self.prop.pk}/images/"

    def upload(self, cloud=None):
        f = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
        return self.as_(self.newbie).post(self.url, {"image": f}, format="multipart")

    def test_a_draft_takes_photos_without_a_plan_up_to_the_draft_cap(self):
        with FakeStorage(), override_settings(DRAFT_MAX_IMAGES=2):
            self.assertEqual(self.upload().status_code, 201)
            self.assertEqual(self.upload().status_code, 201)
            r = self.upload()
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"))

    def test_reorder_and_cover(self):
        with FakeStorage():
            ids = [self.upload().json()["id"] for _ in range(3)]
        r = self.client.post(f"{self.url}reorder/", {"order": [ids[2], ids[0], ids[1]]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual([i["id"] for i in r.json()], [ids[2], ids[0], ids[1]])
        self.assertEqual([i["position"] for i in r.json()], [0, 1, 2])
        self.assertEqual(PropertyImage.objects.get(pk=ids[2]).position, 0)  # the cover
        detail = self.client.get(f"{PROP}{self.prop.pk}/").json()
        self.assertEqual(detail["cover_image"], PropertyImage.objects.get(pk=ids[2]).url)

    def test_reorder_validates_the_list_and_ownership(self):
        with FakeStorage():
            ids = [self.upload().json()["id"] for _ in range(2)]
        for bad in ([ids[0]], [ids[0], ids[0]], [ids[0], 99999], "x", None):
            self.assertEqual(self.as_(self.newbie).post(f"{self.url}reorder/", {"order": bad}, format="json").status_code, 400, bad)
        self.assertEqual(self.as_(self.other_host).post(f"{self.url}reorder/", {"order": ids}, format="json").status_code, 404)
        self.assertEqual(self.as_(None).post(f"{self.url}reorder/", {"order": ids}, format="json").status_code, 401)
        self.assertEqual(self.as_(self.guest).post(f"{self.url}reorder/", {"order": ids}, format="json").status_code, 403)

    def test_a_published_property_still_needs_a_plan_for_photos(self):
        pub = make_property(owner=self.newbie)
        with FakeStorage():
            f = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
            r = self.as_(self.newbie).post(f"{PROP}{pub.pk}/images/", {"image": f}, format="multipart")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "subscription_required"))


class PremiumAmenityTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.dest = make_destination("Goa")
        self.pool = Amenity.objects.create(name="Infinity pool", is_premium=True)
        self.wifi = make_amenity("Wi-Fi")
        self.basic = make_user(Role.HOST, verified=True)
        subscribe(self.basic, make_plan(features={"max_properties": 5}))
        self.premium = make_user(Role.HOST, verified=True)
        subscribe(self.premium, make_plan(features={"max_properties": 5, "premium_amenities": True}))

    def create(self, user, amenities):
        return self.as_(user).post(PROP, self.prop_payload(self.dest, amenities=[a.pk for a in amenities]), format="json")

    def test_a_plan_without_the_feature_is_refused_by_the_backend(self):
        r = self.create(self.basic, [self.wifi, self.pool])
        self.assertEqual(r.status_code, 400)
        self.assertIn("Infinity pool", str(r.json()))
        self.assertEqual(Property.objects.filter(owner=self.basic).count(), 0)

    def test_free_amenities_are_fine_and_a_plan_with_the_feature_may_use_premium(self):
        self.assertEqual(self.create(self.basic, [self.wifi]).status_code, 201)
        self.assertEqual(self.create(self.premium, [self.wifi, self.pool]).status_code, 201)

    def test_update_cannot_sneak_a_premium_amenity_in(self):
        pk = self.create(self.basic, [self.wifi]).json()["id"]
        self.assertEqual(self.client.patch(f"{PROP}{pk}/", {"amenities": [self.wifi.pk, self.pool.pk]}, format="json").status_code, 400)
        self.assertEqual(list(Property.objects.get(pk=pk).amenities.values_list("pk", flat=True)), [self.wifi.pk])

    def test_a_host_with_no_plan_cannot_attach_premium_to_a_draft(self):
        newbie = make_user(Role.HOST, verified=True)
        r = self.as_(newbie).post(PROP, self.prop_payload(self.dest, status="DRAFT", amenities=[self.pool.pk]), format="json")
        self.assertEqual(r.status_code, 400)

    def test_the_feature_flag_is_validated_as_a_boolean(self):
        r = self.as_(self.admin).post("/api/plans/", {"name": "P", "price": "10.00", "duration_days": 30, "features": {"premium_amenities": 1}}, format="json")
        self.assertEqual(r.status_code, 400)
        r = self.client.post("/api/plans/", {"name": "P2", "price": "10.00", "duration_days": 30, "features": {"premium_amenities": True}}, format="json")
        self.assertEqual(r.status_code, 201, r.content)

    def test_publish_rechecks_amenities_after_a_downgrade(self):
        user = self.premium
        pk = self.as_(user).post(PROP, self.prop_payload(self.dest, status="DRAFT", amenities=[self.pool.pk], address_line1="a", postal_code="1"), format="json").json()["id"]
        prop = Property.objects.get(pk=pk)
        with FakeStorage():
            f = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
            self.client.post(f"{PROP}{pk}/images/", {"image": f}, format="multipart")
        Subscription.objects.filter(user=user).update(plan=self.basic.subscriptions.first().plan)
        r = self.client.post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "amenity_not_in_plan"))
        self.assertEqual(Property.objects.get(pk=prop.pk).status, "DRAFT")


class PublishTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.dest = make_destination("Goa")
        self.h = make_user(Role.HOST, verified=True)

    def make_draft(self, **extra):
        r = self.as_(self.h).post(PROP, self.prop_payload(self.dest, status="DRAFT", address_line1="1 Road", postal_code="403001", **extra), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()["id"]

    def add_photos(self, pk, n=1):
        with FakeStorage():
            for _ in range(n):
                f = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
                self.assertEqual(self.as_(self.h).post(f"{PROP}{pk}/images/", {"image": f}, format="multipart").status_code, 201)

    def test_publishing_needs_a_plan(self):
        pk = self.make_draft()
        self.add_photos(pk)
        r = self.client.post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "subscription_required"))
        self.assertEqual(Property.objects.get(pk=pk).status, "DRAFT")

    def test_publishing_needs_a_complete_listing(self):
        subscribe(self.h)
        pk = self.make_draft()
        r = self.as_(self.h).post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "listing_incomplete"))
        self.assertIn("photo", self.error(r)["message"])
        Property.objects.filter(pk=pk).update(address_line1="")
        self.add_photos(pk)
        self.assertIn("address", self.client.post(f"{PROP}{pk}/publish/").json()["error"]["message"])

    def test_publish_makes_it_public_and_bookable(self):
        subscribe(self.h)
        pk = self.make_draft()
        self.add_photos(pk, 2)
        r = self.as_(self.h).post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "PUBLISHED"))
        self.assertEqual(self.as_(None).get(f"{PROP}{pk}/").status_code, 200)
        self.assertIn(pk, [p["id"] for p in self.client.get(PROP).json()["results"]])
        self.assertEqual(self.as_(self.h).post(f"{PROP}{pk}/publish/").status_code, 200)  # idempotent

    def test_publish_respects_the_plan_property_limit(self):
        subscribe(self.h, make_plan(features={"max_properties": 1}))
        make_property(owner=self.h)  # the one allowed
        pk = self.make_draft()
        self.add_photos(pk)
        r = self.as_(self.h).post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"))

    def test_drafts_do_not_count_toward_the_plan_limit(self):
        subscribe(self.h, make_plan(features={"max_properties": 1}))
        self.make_draft()
        self.make_draft()
        self.assertEqual(self.as_(self.h).post(PROP, self.prop_payload(self.dest), format="json").status_code, 201)
        usage = self.client.get("/api/subscriptions/current/").json()["usage"]
        self.assertEqual(usage["properties"], {"used": 1, "limit": 1})

    def test_publish_respects_the_plan_photo_limit(self):
        subscribe(self.h)
        pk = self.make_draft()
        self.add_photos(pk, 3)
        Subscription.objects.filter(user=self.h).update(plan=make_plan(features={"max_images_per_property": 2}))
        r = self.as_(self.h).post(f"{PROP}{pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "plan_limit_reached"))

    def test_unpublish_returns_it_to_draft_and_hides_it(self):
        subscribe(self.h)
        pk = make_property(owner=self.h).pk
        r = self.as_(self.h).post(f"{PROP}{pk}/unpublish/")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "DRAFT"))
        self.assertEqual(self.as_(None).get(f"{PROP}{pk}/").status_code, 404)
        self.assertEqual(self.as_(self.guest).post(f"{PROP}{pk}/unpublish/").status_code, 403)

    def test_existing_flow_is_unchanged_a_host_with_a_plan_creates_a_published_listing(self):
        subscribe(self.h)
        r = self.as_(self.h).post(PROP, self.prop_payload(self.dest), format="json")
        self.assertEqual((r.status_code, r.json()["status"]), (201, "PUBLISHED"))


class DraftIncompleteTests(CatalogTestCase):
    def test_a_draft_may_be_unfinished_but_a_published_listing_may_not(self):
        newbie = make_user(Role.HOST, verified=True)
        dest = make_destination("Goa")
        r = self.as_(newbie).post(PROP, {"status": "DRAFT", "destination": dest.pk, "property_type": "VILLA", "max_guests": 3, "bedrooms": 2, "bathrooms": 1}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual((r.json()["title"], r.json()["price_per_night"]), ("", "0.00"))
        pk = r.json()["id"]
        self.assertEqual(r.json()["status"], "DRAFT")
        r = self.client.get(PROP + "?mine=true&status=DRAFT")
        self.assertEqual([p["id"] for p in r.json()["results"]], [pk])
        subscribe(newbie)
        for body in ({"destination": dest.pk, "property_type": "VILLA", "max_guests": 3}, {**self.prop_payload(dest), "price_per_night": "0"}, {**self.prop_payload(dest), "title": " "}):
            self.assertEqual(self.client.post(PROP, body, format="json").status_code, 400, body)

    def test_publishing_needs_a_price(self):
        newbie = make_user(Role.HOST, verified=True)
        subscribe(newbie)
        prop = make_property(owner=newbie, status="DRAFT", price_per_night=0, address_line1="a", postal_code="1")
        PropertyImage.objects.create(property=prop, url="https://x.example/a.jpg", position=0)
        r = self.as_(newbie).post(f"{PROP}{prop.pk}/publish/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "listing_incomplete"))
        self.assertIn("price", self.error(r)["message"])
