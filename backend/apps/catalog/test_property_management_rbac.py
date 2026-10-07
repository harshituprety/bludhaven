"""Who may manage which property: Hosts only their own, Super Admin any, End Users none."""

from django.core.files.uploadedfile import SimpleUploadedFile

from apps.bookings.models import Booking
from apps.core.testing import FakeCloudinary, image_bytes, make_booking, make_property, subscribe

from .models import Property, PropertyImage
from .test_api_catalog import PROP, CatalogTestCase, make_destination


class PropertyManagementMatrixTests(CatalogTestCase):
    def setUp(self):
        super().setUp()
        self.dest = make_destination("Goa")
        self.prop = make_property(owner=self.host, destination=self.dest, title="Original")
        self.url = f"{PROP}{self.prop.pk}/"

    def test_super_admin_edits_another_hosts_property(self):
        r = self.as_(self.admin).patch(self.url, {"title": "Edited by admin", "price_per_night": "1234.00"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.prop.refresh_from_db()
        self.assertEqual((self.prop.title, str(self.prop.price_per_night), self.prop.owner_id), ("Edited by admin", "1234.00", self.host.pk))

    def test_super_admin_sees_every_property(self):
        make_property(owner=self.other_host)
        r = self.as_(self.admin).get(PROP)
        self.assertEqual(r.json()["count"], 2)

    def test_super_admin_deletes_an_unbooked_property_and_is_stopped_by_existing_rules_when_booked(self):
        free = make_property(owner=self.other_host)
        self.assertEqual(self.as_(self.admin).delete(f"{PROP}{free.pk}/").status_code, 204)
        self.assertFalse(Property.objects.filter(pk=free.pk).exists())
        make_booking(prop=self.prop, status=Booking.Status.CANCELLED)
        r = self.client.delete(self.url)
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "in_use"))
        self.assertTrue(Property.objects.filter(pk=self.prop.pk).exists())

    def test_super_admin_manages_images_of_any_property(self):
        with FakeCloudinary() as cloud:
            upload = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
            r = self.as_(self.admin).post(f"{self.url}images/", {"image": upload}, format="multipart")
            self.assertEqual(r.status_code, 201, r.content)
            image_id = r.json()["id"]
            self.assertEqual(self.client.patch(f"{self.url}images/{image_id}/", {"alt_text": "Front"}, format="json").status_code, 200)
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.delete(f"{self.url}images/{image_id}/").status_code, 204)
            self.assertEqual(len(cloud.deleted), 1)  # the stored file went with the row

    def test_a_host_cannot_edit_another_hosts_property(self):
        before = Property.objects.values().get(pk=self.prop.pk)
        for method, body in (("patch", {"title": "Hijacked"}), ("put", self.prop_payload(self.dest, title="Hijacked")), ("delete", None)):
            with self.subTest(method=method):
                r = getattr(self.as_(self.other_host), method)(self.url, body, format="json")
                self.assertEqual(r.status_code, 403, r.content)
                self.assertEqual(self.error(r)["code"], "permission_denied")
        self.assertEqual(Property.objects.values().get(pk=self.prop.pk), before)

    def test_a_host_cannot_manage_another_hosts_images(self):
        image = PropertyImage.objects.create(property=self.prop, url="https://img.example/a.jpg")
        with FakeCloudinary() as cloud:
            upload = SimpleUploadedFile("a.png", image_bytes("PNG"), content_type="image/png")
            self.assertEqual(self.as_(self.other_host).post(f"{self.url}images/", {"image": upload}, format="multipart").status_code, 403)
            self.assertEqual(self.client.patch(f"{self.url}images/{image.pk}/", {"alt_text": "x"}, format="json").status_code, 403)
            self.assertEqual(self.client.delete(f"{self.url}images/{image.pk}/").status_code, 403)
            self.assertEqual((cloud.uploaded, cloud.deleted), ({}, []))
        self.assertTrue(PropertyImage.objects.filter(pk=image.pk).exists())

    def test_a_host_cannot_take_a_property_by_changing_its_owner(self):
        r = self.as_(self.other_host).patch(self.url, {"owner": self.other_host.pk}, format="json")
        self.assertEqual(r.status_code, 403)
        self.prop.refresh_from_db()
        self.assertEqual(self.prop.owner_id, self.host.pk)

    def test_an_end_user_cannot_manage_properties_or_images(self):
        image = PropertyImage.objects.create(property=self.prop, url="https://img.example/a.jpg")
        self.as_(self.guest)
        self.assertEqual(self.client.post(PROP, self.prop_payload(self.dest), format="json").status_code, 403)
        for method, body in (("patch", {"title": "x"}), ("put", self.prop_payload(self.dest)), ("delete", None)):
            self.assertEqual(getattr(self.client, method)(self.url, body, format="json").status_code, 403, method)
        self.assertEqual(self.client.patch(f"{self.url}images/{image.pk}/", {"alt_text": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.delete(f"{self.url}images/{image.pk}/").status_code, 403)
        self.assertEqual(Property.objects.get(pk=self.prop.pk).title, "Original")

    def test_anonymous_visitors_cannot_manage(self):
        self.as_(None)
        self.assertEqual(self.client.patch(self.url, {"title": "x"}, format="json").status_code, 401)
        self.assertEqual(self.client.delete(self.url).status_code, 401)

    def test_a_host_without_an_active_subscription_still_cannot_gain_extra_reach(self):
        from apps.billing.models import Subscription

        Subscription.objects.filter(user=self.other_host).delete()
        self.assertEqual(self.as_(self.other_host).patch(self.url, {"title": "x"}, format="json").status_code, 403)
