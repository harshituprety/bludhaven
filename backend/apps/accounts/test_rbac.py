"""Role-based access and object ownership, exercised end to end with real JWTs.

The views below exist only for these tests. They stand in for the CRUD endpoints of later
phases and use exactly the permission classes those endpoints will use. There is a single
shared dataset (no tenants): a Host's reach is limited by role and by ownership.
"""

from django.test import override_settings
from django.urls import include, path
from rest_framework import serializers
from rest_framework.generics import RetrieveUpdateDestroyAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import IsEndUser, IsHostOrSuperAdmin, IsOwnerOrSuperAdmin, IsSuperAdmin
from apps.bookings.models import Booking
from apps.catalog.models import Property
from apps.core.testing import ApiTestCase, dates, make_property, make_user


def ok_view(*perms):
    class View(APIView):
        permission_classes = [IsAuthenticated, *perms]

        def get(self, request):
            return Response({"ok": True})

    return View.as_view()


class PropertySerializer(serializers.ModelSerializer):
    class Meta:
        model = Property
        fields = ["id", "title"]


class OwnedPropertyView(RetrieveUpdateDestroyAPIView):
    queryset = Property.objects.all()
    serializer_class = PropertySerializer
    permission_classes = [IsAuthenticated, IsHostOrSuperAdmin, IsOwnerOrSuperAdmin]
    owner_field = "owner"


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ["id", "guests_count"]


class HostBookingView(RetrieveUpdateDestroyAPIView):
    """A booking is reachable by the property's Host (dotted owner path), not by other Hosts."""

    queryset = Booking.objects.all()
    serializer_class = BookingSerializer
    permission_classes = [IsAuthenticated, IsHostOrSuperAdmin, IsOwnerOrSuperAdmin]
    owner_field = "property.owner"


urlpatterns = [
    path("api/", include("apps.core.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("t/admin-area/", ok_view(IsSuperAdmin)),
    path("t/host-area/", ok_view(IsHostOrSuperAdmin)),
    path("t/end-user-area/", ok_view(IsEndUser)),
    path("t/any-signed-in/", ok_view()),
    path("t/properties/<int:pk>/", OwnedPropertyView.as_view()),
    path("t/host-bookings/<int:pk>/", HostBookingView.as_view()),
]


@override_settings(ROOT_URLCONF=__name__)
class RbacTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.end_user = make_user(Role.END_USER)

    def status(self, url, user=None, method="get", body=None):
        self.logout()
        if user:
            self.authenticate(user)
        return getattr(self.client, method)(url, body, format="json").status_code

    def test_unauthenticated_requests_get_401_everywhere(self):
        for url in ("/t/admin-area/", "/t/host-area/", "/t/end-user-area/", "/t/any-signed-in/"):
            with self.subTest(url=url):
                r = self.client.get(url)
                self.assertEqual(r.status_code, 401)
                self.assertEqual(self.error(r)["code"], "not_authenticated")

    def test_super_admin_area(self):
        self.assertEqual(self.status("/t/admin-area/", self.admin), 200)
        self.assertEqual(self.status("/t/admin-area/", self.host), 403)
        self.assertEqual(self.status("/t/admin-area/", self.end_user), 403)

    def test_host_area(self):
        self.assertEqual(self.status("/t/host-area/", self.host), 200)
        self.assertEqual(self.status("/t/host-area/", self.admin), 200)  # system-wide access
        self.assertEqual(self.status("/t/host-area/", self.end_user), 403)

    def test_end_user_area(self):
        self.assertEqual(self.status("/t/end-user-area/", self.end_user), 200)
        self.assertEqual(self.status("/t/end-user-area/", self.host), 403)
        self.assertEqual(self.status("/t/end-user-area/", self.admin), 403)

    def test_forbidden_responses_use_the_shared_error_shape(self):
        self.authenticate(self.end_user)
        r = self.client.get("/t/admin-area/")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.error(r)["code"], "permission_denied")

    def test_access_follows_the_database_role_not_the_token(self):
        self.authenticate(self.host)  # token minted while HOST
        type(self.host).objects.filter(pk=self.host.pk).update(role=Role.END_USER)
        self.assertEqual(self.client.get("/t/host-area/").status_code, 403)
        type(self.host).objects.filter(pk=self.host.pk).update(role=Role.SUPER_ADMIN, is_staff=True, is_superuser=True)
        self.assertEqual(self.client.get("/t/admin-area/").status_code, 200)

    def test_an_inactive_user_cannot_use_any_area(self):
        self.authenticate(self.admin)
        type(self.admin).objects.filter(pk=self.admin.pk).update(is_active=False)
        self.assertEqual(self.client.get("/t/admin-area/").status_code, 401)


@override_settings(ROOT_URLCONF=__name__)
class OwnershipTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host_a = make_user(Role.HOST)
        self.host_b = make_user(Role.HOST)
        self.end_user = make_user(Role.END_USER)
        self.prop_a = make_property(owner=self.host_a)
        self.prop_b = make_property(owner=self.host_b)

    def url(self, prop):
        return f"/t/properties/{prop.pk}/"

    def patch(self, user, prop, title="Renamed"):
        self.authenticate(user)
        return self.client.patch(self.url(prop), {"title": title}, format="json")

    def test_host_can_modify_their_own_property(self):
        r = self.patch(self.host_a, self.prop_a)
        self.assertEqual(r.status_code, 200)
        self.prop_a.refresh_from_db()
        self.assertEqual(self.prop_a.title, "Renamed")

    def test_host_cannot_modify_another_hosts_property(self):
        before = self.prop_b.title
        r = self.patch(self.host_a, self.prop_b)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.error(r)["code"], "permission_denied")
        self.prop_b.refresh_from_db()
        self.assertEqual(self.prop_b.title, before)

    def test_host_cannot_delete_another_hosts_property(self):
        self.authenticate(self.host_a)
        self.assertEqual(self.client.delete(self.url(self.prop_b)).status_code, 403)
        self.assertTrue(Property.objects.filter(pk=self.prop_b.pk).exists())

    def test_super_admin_can_modify_any_property(self):
        for prop in (self.prop_a, self.prop_b):
            with self.subTest(prop=prop.pk):
                self.assertEqual(self.patch(self.admin, prop, title=f"By admin {prop.pk}").status_code, 200)
                prop.refresh_from_db()
                self.assertEqual(prop.title, f"By admin {prop.pk}")

    def test_end_user_cannot_modify_host_owned_resources(self):
        before = self.prop_a.title
        for method in ("patch", "put", "delete"):
            with self.subTest(method=method):
                self.authenticate(self.end_user)
                r = getattr(self.client, method)(self.url(self.prop_a), {"title": "Hacked"}, format="json")
                self.assertEqual(r.status_code, 403)
        self.prop_a.refresh_from_db()
        self.assertEqual(self.prop_a.title, before)

    def test_anonymous_user_cannot_modify_a_property(self):
        r = self.client.patch(self.url(self.prop_a), {"title": "Hacked"}, format="json")
        self.assertEqual(r.status_code, 401)

    def test_missing_object_is_404_for_everyone_allowed_in(self):
        self.authenticate(self.host_a)
        r = self.client.patch("/t/properties/999999/", {"title": "x"}, format="json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.error(r)["code"], "not_found")

    def test_ownership_follows_the_database_when_ownership_changes(self):
        Property.objects.filter(pk=self.prop_a.pk).update(owner=self.host_b)
        self.assertEqual(self.patch(self.host_a, self.prop_a).status_code, 403)
        self.assertEqual(self.patch(self.host_b, self.prop_a).status_code, 200)

    def test_a_host_reaches_bookings_on_their_own_properties_only(self):
        ci, co = dates()
        booking = Booking.objects.create(guest=self.end_user, property=self.prop_a, check_in=ci, check_out=co, guests_count=2, total_price=9000)
        url = f"/t/host-bookings/{booking.pk}/"
        self.authenticate(self.host_a)
        self.assertEqual(self.client.patch(url, {"guests_count": 3}, format="json").status_code, 200)
        self.authenticate(self.host_b)
        self.assertEqual(self.client.patch(url, {"guests_count": 4}, format="json").status_code, 403)
        self.authenticate(self.end_user)  # the guest is not a Host: blocked at the role check
        self.assertEqual(self.client.patch(url, {"guests_count": 4}, format="json").status_code, 403)
        self.authenticate(self.admin)
        self.assertEqual(self.client.get(url).status_code, 200)
        booking.refresh_from_db()
        self.assertEqual(booking.guests_count, 3)
