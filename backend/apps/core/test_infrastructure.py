"""Shared API infrastructure: error shape, pagination, filtering, logging."""

from django.http import Http404
from django.test import SimpleTestCase, override_settings
from django.urls import include, path
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from apps.catalog.models import Destination
from apps.core.testing import ApiTestCase


class DestinationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Destination
        fields = ["id", "name", "state"]


class DestinationList(ListAPIView):
    """Stand-in list endpoint using only the project-wide pagination and filter settings."""

    permission_classes = [AllowAny]
    authentication_classes = []
    queryset = Destination.objects.order_by("name")
    serializer_class = DestinationSerializer
    filterset_fields = ["state"]
    search_fields = ["name"]
    ordering_fields = ["name", "display_order"]


class Boom(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        raise RuntimeError("database password is hunter2")


class Missing(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        raise Http404


class Denied(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        raise PermissionDenied("Nope.")


urlpatterns = [
    path("api/", include("apps.core.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("t/destinations/", DestinationList.as_view()),
    path("t/boom/", Boom.as_view()),
    path("t/missing/", Missing.as_view()),
    path("t/denied/", Denied.as_view()),
]


@override_settings(ROOT_URLCONF=__name__)
class ErrorHandlerTests(ApiTestCase):
    def test_validation_errors_carry_field_details(self):
        r = self.client.post("/api/auth/token/", {}, format="json")
        err = self.error(r)
        self.assertEqual((r.status_code, err["code"], err["message"]), (400, "validation_error", "Invalid input."))
        self.assertIn("email", err["details"])

    def test_not_found_and_permission_errors_share_the_shape(self):
        r = self.client.get("/t/missing/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (404, "not_found"))
        r = self.client.get("/t/denied/")
        self.assertEqual((r.status_code, self.error(r)["code"], self.error(r)["message"]), (403, "permission_denied", "Nope."))
        self.assertEqual(set(r.json()), {"error"})

    def test_unexpected_exceptions_become_a_generic_500_and_are_logged(self):
        with self.assertLogs("apps.core.exceptions", level="ERROR") as logs:
            r = self.client.get("/t/boom/")
        self.assertEqual(r.status_code, 500)
        self.assertEqual(r.json(), {"error": {"code": "server_error", "message": "A server error occurred."}})
        self.assertNotIn("hunter2", r.content.decode())  # internals never reach the client
        self.assertIn("RuntimeError", "\n".join(logs.output))  # but the traceback is in the log

    def test_wrong_method_is_a_405_in_the_same_shape(self):
        r = self.client.delete("/api/health/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (405, "method_not_allowed"))

    def test_the_401_keeps_its_www_authenticate_header(self):
        r = self.client.get("/api/auth/me/")
        self.assertEqual(r.status_code, 401)
        self.assertIn("Bearer", r["WWW-Authenticate"])


@override_settings(ROOT_URLCONF=__name__)
class PaginationAndFilteringTests(ApiTestCase):
    @classmethod
    def setUpTestData(cls):
        Destination.objects.bulk_create(
            [Destination(name=f"City {i:03d}", state="Goa" if i % 3 == 0 else "Kerala", display_order=i) for i in range(1, 121)]
        )

    def get(self, query=""):
        r = self.client.get(f"/t/destinations/{query}")
        return r, r.json()

    def test_default_page_shape_and_size(self):
        r, data = self.get()
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(data), {"count", "next", "previous", "results"})
        self.assertEqual((data["count"], len(data["results"])), (120, 12))
        self.assertIsNone(data["previous"])
        self.assertIn("page=2", data["next"])

    def test_page_navigation(self):
        _, data = self.get("?page=2")
        self.assertEqual(data["results"][0]["name"], "City 013")
        self.assertIn("page=3", data["next"])
        self.assertIsNotNone(data["previous"])
        _, last = self.get("?page=10")
        self.assertIsNone(last["next"])

    def test_page_size_is_adjustable_and_capped(self):
        self.assertEqual(len(self.get("?page_size=5")[1]["results"]), 5)
        self.assertEqual(len(self.get("?page_size=100000")[1]["results"]), 100)

    def test_a_page_past_the_end_or_a_bad_page_is_a_404(self):
        for q in ("?page=999", "?page=0", "?page=abc"):
            with self.subTest(q=q):
                r, _ = self.get(q)
                self.assertEqual(r.status_code, 404)
                self.assertEqual(self.error(r)["code"], "not_found")

    def test_exact_filter(self):
        _, data = self.get("?state=Goa&page_size=100")
        self.assertEqual(data["count"], 40)
        self.assertTrue(all(row["state"] == "Goa" for row in data["results"]))

    def test_search(self):
        _, data = self.get("?search=100")
        self.assertEqual([row["name"] for row in data["results"]], ["City 100"])

    def test_ordering_is_limited_to_allowed_fields(self):
        _, data = self.get("?ordering=-name")
        self.assertEqual(data["results"][0]["name"], "City 120")
        # a field that is not listed in ordering_fields is ignored, not an error
        r, data = self.get("?ordering=state")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(data["results"][0]["name"], "City 001")

    def test_unknown_filter_parameters_are_ignored(self):
        r, data = self.get("?nonsense=1")
        self.assertEqual((r.status_code, data["count"]), (200, 120))

    def test_sql_injection_in_filter_values_is_inert(self):
        r, data = self.get("?state=Goa' OR '1'='1&search=%27%3B%20DROP%20TABLE%20catalog_destination%3B--")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(data["count"], 0)
        self.assertEqual(Destination.objects.count(), 120)


class HealthProbeRedirectTests(SimpleTestCase):
    def test_the_health_probe_is_exempt_from_the_https_redirect(self):
        import re

        from django.conf import settings

        self.assertTrue(any(re.match(p, "api/health/") for p in settings.SECURE_REDIRECT_EXEMPT))
        self.assertFalse(any(re.match(p, "api/plans/") for p in settings.SECURE_REDIRECT_EXEMPT))
