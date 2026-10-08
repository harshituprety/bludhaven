"""Destinations, amenities, properties, images and favourites through the HTTP API."""

from datetime import timedelta
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import Role
from apps.bookings.models import Booking, Review
from apps.core.testing import ApiTestCase, make_amenity, make_booking, make_destination, make_property, make_user, subscribe, FakeStorage, image_bytes

from .models import Amenity, Destination, Favourite, Property, PropertyImage

DEST, AMEN, PROP, FAV = "/api/destinations/", "/api/amenities/", "/api/properties/", "/api/favourites/"


class CatalogTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.other_host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER)
        subscribe(self.host)
        subscribe(self.other_host)

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client

    def prop_payload(self, destination, **extra):
        return {
            "title": "Pine cabin", "description": "Quiet.", "property_type": "CABIN", "destination": destination.pk,
            "locality": "Hills", "price_per_night": "3500.00", "max_guests": 4, "bedrooms": 2, "bathrooms": 1, **extra,
        }


class DestinationApiTests(CatalogTestCase):
    def test_anyone_can_read_destinations_with_a_property_count(self):
        goa = make_destination("Goa")
        make_property(destination=goa), make_property(destination=goa)
        make_destination("Manali")
        r = self.as_(None).get(DEST)
        self.assertEqual(r.status_code, 200)
        counts = {row["name"]: row["property_count"] for row in r.json()["results"]}
        self.assertEqual(counts, {"Goa": 2, "Manali": 0})
        self.assertEqual(self.client.get(f"{DEST}{goa.pk}/").json()["property_count"], 2)

    def test_only_a_super_admin_can_write(self):
        body = {"name": "Coorg", "state": "Karnataka", "tagline": "Coffee hills", "image_url": "https://img.example/c.jpg", "display_order": 3}
        for user in (None, self.guest, self.host):
            with self.subTest(user=getattr(user, "role", "anonymous")):
                r = self.as_(user).post(DEST, body, format="json")
                self.assertEqual(r.status_code, 401 if user is None else 403)
        self.assertEqual(Destination.objects.count(), 0)
        r = self.as_(self.admin).post(DEST, body, format="json")
        self.assertEqual((r.status_code, r.json()["property_count"]), (201, 0))

    def test_super_admin_can_update_and_delete_but_a_destination_in_use_is_protected(self):
        used, unused = make_destination("Used"), make_destination("Unused")
        make_property(destination=used)
        self.assertEqual(self.as_(self.admin).patch(f"{DEST}{used.pk}/", {"tagline": "New"}, format="json").status_code, 200)
        self.assertEqual(self.as_(self.host).delete(f"{DEST}{unused.pk}/").status_code, 403)
        r = self.as_(self.admin).delete(f"{DEST}{used.pk}/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "in_use"))
        self.assertEqual(self.as_(self.admin).delete(f"{DEST}{unused.pk}/").status_code, 204)

    def test_validation(self):
        make_destination("Goa")
        self.as_(self.admin)
        for body in ({"name": "Goa", "state": "Goa"}, {"name": "", "state": "x"}, {"name": "X", "state": "x", "image_url": "not a url"}, {"name": "X"}):
            r = self.client.post(DEST, body, format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"), body)

    def test_filter_search_order_and_paginate(self):
        make_destination("Goa"), make_destination("Gokarna")
        Destination.objects.filter(name="Goa").update(state="Goa", display_order=2)
        Destination.objects.filter(name="Gokarna").update(state="Karnataka", display_order=1)
        self.assertEqual([d["name"] for d in self.client.get(DEST).json()["results"]], ["Gokarna", "Goa"])  # curated order
        self.assertEqual([d["name"] for d in self.client.get(f"{DEST}?state=karnataka").json()["results"]], ["Gokarna"])
        self.assertEqual(self.client.get(f"{DEST}?search=gok").json()["count"], 1)
        self.assertEqual(self.client.get(f"{DEST}?ordering=-name").json()["results"][0]["name"], "Gokarna")
        self.assertEqual(self.client.get(f"{DEST}?page_size=1").json()["next"] is not None, True)


class AmenityApiTests(CatalogTestCase):
    def test_public_read_and_super_admin_write(self):
        make_amenity("Wi-Fi")
        self.assertEqual(self.as_(None).get(AMEN).json()["count"], 1)
        for user in (self.guest, self.host):
            self.assertEqual(self.as_(user).post(AMEN, {"name": "Pool"}, format="json").status_code, 403)
        r = self.as_(self.admin).post(AMEN, {"name": "Pool"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.post(AMEN, {"name": "pool"}, format="json").status_code, 400)  # duplicate, any case
        self.assertEqual(self.client.patch(f"{AMEN}{r.json()['id']}/", {"name": "Plunge pool"}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(f"{AMEN}{r.json()['id']}/").status_code, 204)

    def test_deleting_an_amenity_just_unlinks_it(self):
        wifi = make_amenity("Wi-Fi")
        prop = make_property()
        prop.amenities.add(wifi)
        self.assertEqual(self.as_(self.admin).delete(f"{AMEN}{wifi.pk}/").status_code, 204)
        self.assertTrue(Property.objects.filter(pk=prop.pk).exists())

    def test_search(self):
        make_amenity("Fireplace"), make_amenity("Wi-Fi")
        self.assertEqual([a["name"] for a in self.client.get(f"{AMEN}?search=fire").json()["results"]], ["Fireplace"])


class PropertyReadTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.goa, self.manali = make_destination("Goa"), make_destination("Manali")
        self.wifi, self.fire, self.pool = make_amenity("Wi-Fi"), make_amenity("Fireplace"), make_amenity("Pool")
        self.p1 = make_property(owner=self.host, destination=self.goa, title="Beach villa", price_per_night=Decimal("9000"), max_guests=8, bedrooms=4, bathrooms=3, property_type="VILLA")
        self.p2 = make_property(owner=self.host, destination=self.goa, title="Palm cottage", price_per_night=Decimal("3000"), max_guests=3, bedrooms=1, property_type="COTTAGE")
        self.p3 = make_property(owner=self.other_host, destination=self.manali, title="Snow cabin", price_per_night=Decimal("5000"), max_guests=5, bedrooms=2, property_type="CABIN")
        self.p1.amenities.set([self.wifi, self.pool]); self.p2.amenities.set([self.wifi]); self.p3.amenities.set([self.wifi, self.fire])

    def titles(self, query=""):
        r = self.as_(None).get(f"{PROP}{query}")
        self.assertEqual(r.status_code, 200, r.content)
        return [p["title"] for p in r.json()["results"]]

    def test_browsing_needs_no_account_and_shows_the_card_fields(self):
        PropertyImage.objects.create(property=self.p1, url="https://img.example/1.jpg", position=1)
        PropertyImage.objects.create(property=self.p1, url="https://img.example/cover.jpg", position=0)
        r = self.as_(None).get(PROP)
        self.assertEqual(r.json()["count"], 3)
        card = next(p for p in r.json()["results"] if p["id"] == self.p1.pk)
        self.assertEqual(set(card), {"id", "title", "property_type", "locality", "destination", "price_per_night", "max_guests", "bedrooms", "bathrooms", "cover_image", "average_rating", "review_count", "created_at"})
        self.assertEqual(card["cover_image"], "https://img.example/cover.jpg")
        self.assertEqual(card["destination"], {"id": self.goa.pk, "name": "Goa", "state": "Test State"})
        self.assertIsNone(next(p for p in r.json()["results"] if p["id"] == self.p2.pk)["cover_image"])

    def test_detail_has_amenities_images_and_a_host_name_but_no_email(self):
        PropertyImage.objects.create(property=self.p1, url="https://img.example/1.jpg")
        r = self.as_(None).get(f"{PROP}{self.p1.pk}/")
        data = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sorted(a["name"] for a in data["amenities"]), ["Pool", "Wi-Fi"])
        self.assertEqual(len(data["images"]), 1)
        self.assertEqual(set(data["owner"]), {"id", "full_name"})
        self.assertNotIn(self.host.email, r.content.decode())
        self.assertEqual(self.client.get(f"{PROP}999999/").status_code, 404)

    def test_ratings_are_computed_from_reviews_not_stored(self):
        for rating in (5, 4):
            Review.objects.create(booking=make_booking(prop=self.p1, status=Booking.Status.COMPLETED), rating=rating)
        card = next(p for p in self.as_(None).get(PROP).json()["results"] if p["id"] == self.p1.pk)
        self.assertEqual((card["average_rating"], card["review_count"]), (4.5, 2))
        other = next(p for p in self.client.get(PROP).json()["results"] if p["id"] == self.p2.pk)
        self.assertEqual((other["average_rating"], other["review_count"]), (None, 0))

    def test_filters(self):
        cases = {
            f"?destination={self.goa.pk}": {"Beach villa", "Palm cottage"},
            "?destination_name=manali": {"Snow cabin"},
            "?property_type=CABIN&property_type=VILLA": {"Beach villa", "Snow cabin"},
            "?min_price=4000": {"Beach villa", "Snow cabin"},
            "?max_price=4000": {"Palm cottage"},
            "?min_price=3000&max_price=5000": {"Palm cottage", "Snow cabin"},
            "?guests=6": {"Beach villa"},
            "?min_bedrooms=2": {"Beach villa", "Snow cabin"},
            "?min_bathrooms=3": {"Beach villa"},
            f"?amenities={self.wifi.pk}": {"Beach villa", "Palm cottage", "Snow cabin"},
            f"?amenities={self.wifi.pk},{self.pool.pk}": {"Beach villa"},  # needs all of them
            f"?amenities={self.fire.pk},{self.pool.pk}": set(),
            f"?owner={self.other_host.pk}": {"Snow cabin"},
            "?nonsense=1": {"Beach villa", "Palm cottage", "Snow cabin"},
        }
        for query, expected in cases.items():
            with self.subTest(query):
                self.assertEqual(set(self.titles(query)), expected)

    def test_invalid_filter_values_are_a_400(self):
        for query in ("?min_price=abc", "?property_type=CASTLE", "?destination=x", "?amenities=1,x", "?check_in=2030-13-45"):
            with self.subTest(query):
                r = self.as_(None).get(f"{PROP}{query}")
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_search(self):
        self.assertEqual(set(self.titles("?search=beach")), {"Beach villa"})
        self.assertEqual(set(self.titles("?search=manali")), {"Snow cabin"})  # destination name
        self.assertEqual(set(self.titles("?search=zzzz")), set())

    def test_ordering(self):
        self.assertEqual(self.titles("?ordering=price_per_night"), ["Palm cottage", "Snow cabin", "Beach villa"])
        self.assertEqual(self.titles("?ordering=-price_per_night"), ["Beach villa", "Snow cabin", "Palm cottage"])
        self.assertEqual(self.titles("?ordering=title")[0], "Beach villa")
        self.assertEqual(self.titles("?ordering=bogus_field"), self.titles())  # unknown ordering is ignored

    def test_ordering_and_filtering_by_rating(self):
        Review.objects.create(booking=make_booking(prop=self.p3, status=Booking.Status.COMPLETED), rating=5)
        Review.objects.create(booking=make_booking(prop=self.p1, status=Booking.Status.COMPLETED), rating=3)
        self.assertEqual(self.titles("?ordering=-average_rating")[:2], ["Snow cabin", "Beach villa"])
        self.assertEqual(self.titles("?min_rating=4"), ["Snow cabin"])

    def test_pagination(self):
        for i in range(15):
            make_property(owner=self.host, destination=self.goa, title=f"Extra {i}")
        r = self.as_(None).get(PROP).json()
        self.assertEqual((r["count"], len(r["results"])), (18, 12))
        self.assertEqual(len(self.client.get(f"{PROP}?page=2").json()["results"]), 6)
        self.assertEqual(len(self.client.get(f"{PROP}?page_size=5").json()["results"]), 5)
        self.assertEqual(self.client.get(f"{PROP}?page=9").status_code, 404)

    def test_the_list_uses_a_fixed_number_of_queries(self):
        for i in range(10):
            p = make_property(owner=self.host, destination=self.goa, title=f"Q{i}")
            PropertyImage.objects.create(property=p, url="https://img.example/x.jpg")
        with self.assertNumQueries(3):  # count, properties, images
            self.as_(None).get(PROP)

    def test_availability_filter(self):
        start = timezone.localdate() + timedelta(days=20)
        make_booking(prop=self.p1, check_in=start, check_out=start + timedelta(days=3), status=Booking.Status.CONFIRMED)
        make_booking(prop=self.p2, check_in=start, check_out=start + timedelta(days=3), status=Booking.Status.CANCELLED)
        make_booking(prop=self.p3, check_in=start, check_out=start + timedelta(days=3), status=Booking.Status.PENDING)
        q = lambda a, b: f"?check_in={start + timedelta(days=a)}&check_out={start + timedelta(days=b)}"  # noqa: E731
        self.assertEqual(set(self.titles(q(1, 2))), {"Palm cottage"})  # inside the booked range; cancelled does not block
        self.assertEqual(set(self.titles(q(-2, 1))), {"Palm cottage"})  # overlaps the start
        self.assertEqual(set(self.titles(q(2, 6))), {"Palm cottage"})  # overlaps the end
        self.assertEqual(set(self.titles(q(3, 5))), {"Beach villa", "Palm cottage", "Snow cabin"})  # check-in on the check-out day is free
        self.assertEqual(set(self.titles(q(-3, 0))), {"Beach villa", "Palm cottage", "Snow cabin"})  # check-out on the check-in day is free

    def test_availability_filter_validation(self):
        start = timezone.localdate() + timedelta(days=5)
        for query in (f"?check_in={start}", f"?check_out={start}", f"?check_in={start}&check_out={start}", f"?check_in={start + timedelta(days=2)}&check_out={start}"):
            with self.subTest(query):
                self.assertEqual(self.as_(None).get(f"{PROP}{query}").status_code, 400)

    def test_mine_filter(self):
        self.assertEqual(set(self.as_(self.host).get(f"{PROP}?mine=true").json()["results"][i]["title"] for i in range(2)), {"Beach villa", "Palm cottage"})
        self.assertEqual(self.as_(None).get(f"{PROP}?mine=true").status_code, 401)
        self.assertEqual(self.as_(None).get(f"{PROP}?mine=false").json()["count"], 3)


class PropertyWriteTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.goa = make_destination("Goa")
        self.wifi, self.pool = make_amenity("Wi-Fi"), make_amenity("Pool")

    def test_a_host_creates_a_property_that_is_always_their_own(self):
        r = self.as_(self.host).post(PROP, self.prop_payload(self.goa, amenities=[self.wifi.pk, self.pool.pk]), format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["owner"]["id"], self.host.pk)
        self.assertEqual(sorted(a["name"] for a in r.json()["amenities"]), ["Pool", "Wi-Fi"])
        self.assertEqual((r.json()["average_rating"], r.json()["review_count"]), (None, 0))
        self.assertEqual(Property.objects.get(pk=r.json()["id"]).owner, self.host)

    def test_a_host_cannot_create_a_property_for_someone_else(self):
        r = self.as_(self.host).post(PROP, self.prop_payload(self.goa, owner=self.other_host.pk), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("owner", self.error(r)["details"])
        self.assertEqual(Property.objects.count(), 0)
        # naming themselves is fine
        self.assertEqual(self.client.post(PROP, self.prop_payload(self.goa, owner=self.host.pk), format="json").status_code, 201)

    def test_end_users_and_anonymous_cannot_create(self):
        self.assertEqual(self.as_(self.guest).post(PROP, self.prop_payload(self.goa), format="json").status_code, 403)
        self.assertEqual(self.as_(None).post(PROP, self.prop_payload(self.goa), format="json").status_code, 401)
        self.assertEqual(Property.objects.count(), 0)

    def test_super_admin_must_name_a_host_owner(self):
        self.as_(self.admin)
        r = self.client.post(PROP, self.prop_payload(self.goa), format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("owner", self.error(r)["details"])
        for not_a_host in (self.guest.pk, self.admin.pk, 999999):
            self.assertEqual(self.client.post(PROP, self.prop_payload(self.goa, owner=not_a_host), format="json").status_code, 400)
        r = self.client.post(PROP, self.prop_payload(self.goa, owner=self.host.pk), format="json")
        self.assertEqual((r.status_code, r.json()["owner"]["id"]), (201, self.host.pk))

    def test_input_validation(self):
        self.as_(self.host)
        bad = {
            "zero price": dict(price_per_night="0"), "negative price": dict(price_per_night="-5"), "price not a number": dict(price_per_night="abc"),
            "too many decimals": dict(price_per_night="10.999"), "price too large": dict(price_per_night="123456789.00"),
            "zero guests": dict(max_guests=0), "negative bedrooms": dict(bedrooms=-1), "bad type": dict(property_type="CASTLE"),
            "blank title": dict(title="  "), "title too long": dict(title="x" * 151), "missing description": dict(description=None),
            "unknown destination": dict(destination=999999), "unknown amenity": dict(amenities=[999999]),
        }
        for label, override in bad.items():
            with self.subTest(label):
                payload = {**self.prop_payload(self.goa), **override}
                payload = {k: v for k, v in payload.items() if v is not None}
                r = self.client.post(PROP, payload, format="json")
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
        self.assertEqual(Property.objects.count(), 0)

    def test_read_only_and_unknown_fields_are_ignored(self):
        payload = self.prop_payload(self.goa, id=999, average_rating=5, review_count=99, created_at="2000-01-01T00:00:00Z", images=[{"url": "https://x.example/a.jpg"}])
        r = self.as_(self.host).post(PROP, payload, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertNotEqual(r.json()["id"], 999)
        self.assertEqual((r.json()["average_rating"], r.json()["review_count"], r.json()["images"]), (None, 0, []))

    def test_a_host_updates_their_own_property(self):
        prop = make_property(owner=self.host, destination=self.goa)
        prop.amenities.set([self.wifi])
        r = self.as_(self.host).patch(f"{PROP}{prop.pk}/", {"title": "Renamed", "price_per_night": "4200", "amenities": [self.pool.pk]}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        prop.refresh_from_db()
        self.assertEqual((prop.title, prop.price_per_night, list(prop.amenities.all())), ("Renamed", Decimal("4200.00"), [self.pool]))
        full = self.client.put(f"{PROP}{prop.pk}/", self.prop_payload(self.goa, title="Replaced"), format="json")
        self.assertEqual((full.status_code, full.json()["title"]), (200, "Replaced"))
        self.assertEqual(self.client.put(f"{PROP}{prop.pk}/", {"title": "only"}, format="json").status_code, 400)  # PUT needs everything

    def test_a_host_cannot_touch_another_hosts_property(self):
        prop = make_property(owner=self.other_host, destination=self.goa, title="Theirs")
        self.as_(self.host)
        for method, body in (("patch", {"title": "Mine now"}), ("put", self.prop_payload(self.goa)), ("delete", None)):
            with self.subTest(method):
                r = getattr(self.client, method)(f"{PROP}{prop.pk}/", body, format="json")
                self.assertEqual((r.status_code, self.error(r)["code"]), (403, "permission_denied"))
        prop.refresh_from_db()
        self.assertEqual((prop.title, prop.owner), ("Theirs", self.other_host))

    def test_a_host_cannot_hand_a_property_to_someone_else(self):
        prop = make_property(owner=self.host, destination=self.goa)
        r = self.as_(self.host).patch(f"{PROP}{prop.pk}/", {"owner": self.other_host.pk}, format="json")
        self.assertEqual(r.status_code, 400)
        prop.refresh_from_db()
        self.assertEqual(prop.owner, self.host)

    def test_end_users_and_anonymous_cannot_modify(self):
        prop = make_property(owner=self.host, destination=self.goa)
        for user, code in ((self.guest, 403), (None, 401)):
            for method in ("patch", "put", "delete"):
                r = getattr(self.as_(user), method)(f"{PROP}{prop.pk}/", {"title": "x"}, format="json")
                self.assertEqual(r.status_code, code, (user, method))
        self.assertEqual(Property.objects.get(pk=prop.pk).title, prop.title)

    def test_super_admin_can_modify_and_reassign_any_property(self):
        prop = make_property(owner=self.host, destination=self.goa)
        self.as_(self.admin)
        self.assertEqual(self.client.patch(f"{PROP}{prop.pk}/", {"title": "By admin"}, format="json").status_code, 200)
        r = self.client.patch(f"{PROP}{prop.pk}/", {"owner": self.other_host.pk}, format="json")
        self.assertEqual((r.status_code, r.json()["owner"]["id"]), (200, self.other_host.pk))
        self.assertEqual(self.client.patch(f"{PROP}{prop.pk}/", {"owner": self.guest.pk}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(f"{PROP}{prop.pk}/").status_code, 204)

    def test_delete_own_property_and_the_protection_of_booked_ones(self):
        free, booked = make_property(owner=self.host), make_property(owner=self.host)
        PropertyImage.objects.create(property=free, url="https://img.example/a.jpg")
        Favourite.objects.create(user=self.guest, property=free)
        make_booking(prop=booked, status=Booking.Status.CANCELLED)
        self.assertEqual(self.as_(self.host).delete(f"{PROP}{free.pk}/").status_code, 204)
        self.assertEqual((PropertyImage.objects.count(), Favourite.objects.count()), (0, 0))  # dependants go with it
        r = self.client.delete(f"{PROP}{booked.pk}/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "in_use"))
        self.assertTrue(Property.objects.filter(pk=booked.pk).exists())

    def test_changing_the_price_does_not_change_existing_bookings(self):
        prop = make_property(owner=self.host, price_per_night=Decimal("1000"))
        booking = make_booking(prop=prop)
        before = booking.total_price
        self.as_(self.host).patch(f"{PROP}{prop.pk}/", {"price_per_night": "5000"}, format="json")
        booking.refresh_from_db()
        self.assertEqual(booking.total_price, before)

    def test_malformed_json_is_a_400(self):
        r = self.as_(self.host).post(PROP, data="{bad", content_type="application/json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "parse_error"))


class PropertyImageApiTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.prop = make_property(owner=self.host)
        self.url = f"{PROP}{self.prop.pk}/images/"
        self.cloud = FakeStorage()
        self.cloud.__enter__()
        self.addCleanup(self.cloud.__exit__)

    def add(self, user, fmt="PNG", name="a.png", **body):
        upload = SimpleUploadedFile(name, image_bytes(fmt), content_type="image/png")
        return self.as_(user).post(self.url, {"image": upload, **body}, format="multipart")

    def test_public_can_list_images_in_order(self):
        PropertyImage.objects.create(property=self.prop, url="https://img.example/b.jpg", position=1, storage_key="secret/key")
        PropertyImage.objects.create(property=self.prop, url="https://img.example/a.jpg", position=0)
        r = self.as_(None).get(self.url)
        self.assertEqual([i["position"] for i in r.json()["results"]], [0, 1])
        self.assertNotIn("secret/key", r.content.decode())
        self.assertNotIn("storage_key", r.content.decode())

    def test_upload_stores_in_cloudinary_and_only_metadata_in_mysql(self):
        r = self.add(self.host, alt_text="Front")
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertEqual((body["position"], body["format"], body["width"], body["height"], body["alt_text"]), (0, "png", 40, 30, "Front"))
        self.assertTrue(body["url"].startswith("https://res.cloudinary.test/"))
        self.assertNotIn("storage_key", body)
        image = PropertyImage.objects.get(pk=body["id"])
        self.assertEqual(image.uploaded_by, self.host)
        self.assertEqual(image.size_bytes, len(next(iter(self.cloud.uploaded.values()))))
        # organised per Host / property, random final segment, client filename not used
        prefix = f"bludhaven/hosts/{self.host.pk}/properties/{self.prop.pk}/"
        self.assertTrue(image.storage_key.startswith(prefix))
        self.assertGreaterEqual(len(image.storage_key) - len(prefix), 20)
        self.assertNotIn("a.png", image.storage_key)

    def test_public_ids_are_unique_per_upload(self):
        self.add(self.host)
        self.add(self.host)
        self.assertEqual(len(self.cloud.uploaded), 2)

    def test_positions_default_to_the_end(self):
        positions = [self.add(self.host).json()["position"] for _ in range(3)]
        self.assertEqual(positions, [0, 1, 2])
        self.assertEqual(self.add(self.host, position=10).json()["position"], 10)
        self.assertEqual(self.add(self.host).json()["position"], 11)

    def test_position_conflict_is_rejected_before_any_upload(self):
        self.add(self.host, position=0)
        r = self.add(self.host, position=0)
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
        self.assertIn("position", self.error(r)["details"])
        self.assertEqual(PropertyImage.objects.filter(property=self.prop).count(), 1)
        self.assertEqual((len(self.cloud.uploaded), self.cloud.deleted), (1, []))

    def test_a_failed_save_after_upload_removes_the_uploaded_file(self):
        from unittest.mock import patch

        from django.db import IntegrityError

        with patch.object(PropertyImage.objects, "create", side_effect=IntegrityError("race")):
            r = self.add(self.host)
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "position_taken"))
        self.assertEqual(list(self.cloud.uploaded), self.cloud.deleted)

    def test_the_real_type_is_checked_not_the_name_or_content_type(self):
        for label, content in (
            ("text", b"just text"),
            ("html", b"<html><script>alert(1)</script></html>"),
            ("svg", b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            ("truncated", image_bytes()[:40]),
            ("empty", b""),
        ):
            with self.subTest(label):
                upload = SimpleUploadedFile("photo.jpg", content, content_type="image/jpeg")
                r = self.as_(self.host).post(self.url, {"image": upload}, format="multipart")
                self.assertEqual(r.status_code, 400, r.content)
                self.assertIn("image", self.error(r)["details"])
        self.assertEqual((PropertyImage.objects.count(), len(self.cloud.uploaded)), (0, 0))

    def test_gif_and_other_formats_outside_the_allow_list_are_refused(self):
        for fmt in ("GIF", "BMP", "TIFF"):
            with self.subTest(fmt):
                self.assertEqual(self.add(self.host, fmt=fmt, name=f"x.{fmt.lower()}").status_code, 400)
        self.assertEqual(self.add(self.host, fmt="JPEG", name="x.jpg").json()["format"], "jpg")
        self.assertEqual(self.add(self.host, fmt="WEBP", name="x.webp").json()["format"], "webp")

    def test_metadata_is_stripped_and_appended_payloads_are_dropped(self):
        import io

        from PIL import Image

        raw = io.BytesIO()
        img = Image.new("RGB", (20, 20), (1, 2, 3))
        exif = Image.Exif()
        exif[0x010E] = "SECRET-DESCRIPTION"
        img.save(raw, "JPEG", exif=exif)
        data = raw.getvalue() + b"<?php system($_GET['c']); ?>"
        upload = SimpleUploadedFile("evil.jpg", data, content_type="image/jpeg")
        self.assertEqual(self.as_(self.host).post(self.url, {"image": upload}, format="multipart").status_code, 201)
        sent = next(iter(self.cloud.uploaded.values()))
        self.assertNotIn(b"SECRET-DESCRIPTION", sent)
        self.assertNotIn(b"<?php", sent)

    def test_size_limit(self):
        with override_settings(IMAGE_MAX_BYTES=50):
            r = self.add(self.host)
        self.assertEqual(r.status_code, 400)
        self.assertIn("larger than", self.error(r)["details"]["image"][0])

    def test_pixel_limit_blocks_decompression_bombs(self):
        with override_settings(IMAGE_MAX_PIXELS=100):
            r = self.add(self.host)  # 40x30 = 1200 pixels
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.cloud.uploaded, {})

    def test_declared_oversize_body_is_refused_before_reading(self):
        with override_settings(IMAGE_MAX_BYTES=10):
            upload = SimpleUploadedFile("a.png", image_bytes() * 3000, content_type="image/png")
            r = self.as_(self.host).post(self.url, {"image": upload}, format="multipart")
        self.assertEqual(r.status_code, 400)

    def test_image_field_is_required_and_urls_are_not_accepted(self):
        self.as_(self.host)
        r = self.client.post(self.url, {"url": "https://evil.example/a.jpg"}, format="multipart")
        self.assertEqual(r.status_code, 400)
        self.assertIn("image", self.error(r)["details"])
        self.assertEqual(self.client.post(self.url, {"url": "https://x.example/a.jpg"}, format="json").status_code, 415)
        self.assertEqual(PropertyImage.objects.count(), 0)

    def test_storage_outage_is_a_clean_503(self):
        self.cloud.fail_upload = True
        r = self.add(self.host)
        self.assertEqual((r.status_code, self.error(r)["code"]), (503, "storage_unavailable"))
        self.assertEqual(PropertyImage.objects.count(), 0)

    def test_missing_cloudinary_configuration_is_a_503(self):
        self.cloud.__exit__()
        try:
            with override_settings(CLOUDINARY_URL=""):
                r = self.add(self.host)
            self.assertEqual((r.status_code, self.error(r)["code"]), (503, "storage_unavailable"))
        finally:
            self.cloud.__enter__()

    def test_only_the_owner_or_super_admin_can_manage_images(self):
        for user, code in ((self.other_host, 403), (self.guest, 403), (None, 401)):
            self.assertEqual(self.add(user).status_code, code, user)
        self.assertEqual(self.cloud.uploaded, {})
        image = PropertyImage.objects.create(property=self.prop, url="https://img.example/a.jpg")
        for user, code in ((self.other_host, 403), (self.guest, 403), (None, 401)):
            self.as_(user)
            self.assertEqual(self.client.patch(f"{self.url}{image.pk}/", {"alt_text": "x"}, format="json").status_code, code)
            self.assertEqual(self.client.delete(f"{self.url}{image.pk}/").status_code, code)
        self.assertEqual(self.add(self.admin).status_code, 201)
        self.assertEqual(PropertyImage.objects.filter(property=self.prop).count(), 2)

    def test_update_changes_only_alt_text_and_position(self):
        image = PropertyImage.objects.create(property=self.prop, url="https://img.example/a.jpg", position=0)
        PropertyImage.objects.create(property=self.prop, url="https://img.example/b.jpg", position=1)
        r = self.as_(self.host).patch(f"{self.url}{image.pk}/", {"alt_text": "Sunrise", "position": 0}, format="json")
        self.assertEqual((r.status_code, r.json()["alt_text"]), (200, "Sunrise"))
        self.assertEqual(self.client.patch(f"{self.url}{image.pk}/", {"position": 1}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(f"{self.url}{image.pk}/", {"position": 5}, format="json").json()["position"], 5)
        self.client.patch(f"{self.url}{image.pk}/", {"url": "https://evil.example/x.jpg", "storage_key": "other/key"}, format="json")
        image.refresh_from_db()
        self.assertEqual((image.url, image.storage_key), ("https://img.example/a.jpg", ""))
        self.assertEqual(self.client.put(f"{self.url}{image.pk}/", {}, format="json").status_code, 405)

    def test_deleting_removes_the_cloudinary_file_after_commit(self):
        body = self.add(self.host).json()
        key = PropertyImage.objects.get(pk=body["id"]).storage_key
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(f"{self.url}{body['id']}/").status_code, 204)
        self.assertEqual(self.cloud.deleted, [key])

    def test_deleting_a_property_removes_its_files(self):
        keys = [PropertyImage.objects.get(pk=self.add(self.host).json()["id"]).storage_key for _ in range(2)]
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.delete(f"{PROP}{self.prop.pk}/").status_code, 204)
        self.assertEqual(sorted(self.cloud.deleted), sorted(keys))

    def test_images_are_scoped_to_their_property(self):
        other = make_property(owner=self.host)
        image = PropertyImage.objects.create(property=other, url="https://img.example/o.jpg")
        self.assertEqual(self.as_(self.host).get(f"{self.url}{image.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"{PROP}999999/images/").status_code, 404)
        self.assertEqual(self.add(self.host).status_code, 201)
        self.assertEqual(self.as_(self.host).post(f"{PROP}999999/images/", {}, format="multipart").status_code, 404)

    def test_upload_throttle(self):
        from unittest.mock import patch

        from apps.core.throttling import UploadRateThrottle

        with patch.dict(UploadRateThrottle.THROTTLE_RATES, {"upload": "2/hour"}):
            codes = [self.add(self.host).status_code for _ in range(3)]
        self.assertEqual(codes, [201, 201, 429])


class FavouriteApiTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.p1, self.p2 = make_property(owner=self.host), make_property(owner=self.host)

    def test_requires_sign_in(self):
        self.assertEqual(self.as_(None).get(FAV).status_code, 401)
        self.assertEqual(self.client.post(FAV, {"property_id": self.p1.pk}, format="json").status_code, 401)

    def test_save_is_idempotent(self):
        first = self.as_(self.guest).post(FAV, {"property_id": self.p1.pk}, format="json")
        again = self.client.post(FAV, {"property_id": self.p1.pk}, format="json")
        self.assertEqual((first.status_code, again.status_code), (201, 200))
        self.assertEqual(first.json()["id"], again.json()["id"])
        self.assertEqual(first.json()["property"]["id"], self.p1.pk)
        self.assertEqual(Favourite.objects.count(), 1)

    def test_any_role_can_save_and_each_sees_only_their_own(self):
        for user in (self.guest, self.host, self.admin):
            self.assertEqual(self.as_(user).post(FAV, {"property_id": self.p1.pk}, format="json").status_code, 201)
        self.as_(self.guest).post(FAV, {"property_id": self.p2.pk}, format="json")
        self.assertEqual(self.client.get(FAV).json()["count"], 2)
        self.assertEqual(self.as_(self.host).get(FAV).json()["count"], 1)

    def test_filter_by_property_and_order(self):
        self.as_(self.guest)
        self.client.post(FAV, {"property_id": self.p1.pk}, format="json")
        self.client.post(FAV, {"property_id": self.p2.pk}, format="json")
        self.assertEqual([f["property"]["id"] for f in self.client.get(f"{FAV}?property={self.p1.pk}").json()["results"]], [self.p1.pk])
        self.assertEqual(self.client.get(FAV).json()["results"][0]["property"]["id"], self.p2.pk)  # newest first

    def test_remove_only_your_own(self):
        fav = Favourite.objects.create(user=self.guest, property=self.p1)
        self.assertEqual(self.as_(self.host).delete(f"{FAV}{fav.pk}/").status_code, 404)
        self.assertEqual(self.as_(self.admin).delete(f"{FAV}{fav.pk}/").status_code, 404)
        self.assertEqual(self.as_(self.guest).delete(f"{FAV}{fav.pk}/").status_code, 204)
        self.assertEqual(Favourite.objects.count(), 0)

    def test_validation_and_method_limits(self):
        self.as_(self.guest)
        for body in ({}, {"property_id": 999999}, {"property_id": "abc"}):
            self.assertEqual(self.client.post(FAV, body, format="json").status_code, 400)
        fav = Favourite.objects.create(user=self.guest, property=self.p1)
        self.assertEqual(self.client.patch(f"{FAV}{fav.pk}/", {"property_id": self.p2.pk}, format="json").status_code, 405)

    def test_the_list_uses_a_fixed_number_of_queries(self):
        for i in range(8):
            Favourite.objects.create(user=self.guest, property=make_property(owner=self.host))
        self.as_(self.guest)
        with self.assertNumQueries(4):  # user lookup, count, favourites+properties, images
            self.client.get(FAV)
