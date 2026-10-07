"""GET /api/properties/<id>/availability/: blocked date ranges, public, with nothing private in them."""

from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import Role
from apps.core.testing import ApiTestCase, make_booking, make_property, make_user

from .models import Booking

S = Booking.Status


def url(prop, **params):
    query = "&".join(f"{k}={v}" for k, v in params.items())
    return f"/api/properties/{prop.pk}/availability/" + (f"?{query}" if query else "")


class AvailabilityTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        self.host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER, verified=True, email="secret-guest@example.com", full_name="Secret Guest")
        self.prop = make_property(owner=self.host)

    def day(self, n):
        return self.today + timedelta(days=n)

    def book(self, a, b, status=S.CONFIRMED, prop=None, guest=None):
        return make_booking(guest=guest or self.guest, prop=prop or self.prop, check_in=self.day(a), check_out=self.day(b), status=status)

    def blocked(self, **params):
        r = self.client.get(url(self.prop, **params))
        self.assertEqual(r.status_code, 200, r.content)
        return r.json()["blocked"]

    def test_it_is_public_and_read_only(self):
        r = self.client.get(url(self.prop))  # anonymous
        self.assertEqual(r.status_code, 200)
        for method in ("post", "put", "patch", "delete"):
            self.authenticate(self.host)
            self.assertEqual(getattr(self.client, method)(url(self.prop)).status_code, 405, method)

    def test_shape_and_defaults(self):
        data = self.client.get(url(self.prop)).json()
        self.assertEqual(set(data), {"property", "from", "to", "max_nights", "blocked"})
        self.assertEqual(data["property"], self.prop.pk)
        self.assertEqual(data["from"], self.today.isoformat())
        self.assertEqual(data["to"], (self.today + timedelta(days=365)).isoformat())
        self.assertEqual(data["max_nights"], 90)
        self.assertEqual(data["blocked"], [])

    def test_pending_and_confirmed_bookings_block_their_nights(self):
        self.book(5, 8, S.PENDING)
        self.book(20, 22, S.CONFIRMED)
        self.assertEqual(
            self.blocked(),
            [{"start": self.day(5).isoformat(), "end": self.day(8).isoformat()}, {"start": self.day(20).isoformat(), "end": self.day(22).isoformat()}],
        )

    def test_cancelled_and_completed_bookings_do_not_block(self):
        self.book(5, 8, S.CANCELLED)
        self.book(-9, -6, S.COMPLETED)
        self.book(30, 33, S.COMPLETED)  # even a (hypothetical) future completed row holds nothing: same rule as booking creation
        self.assertEqual(self.blocked(), [])

    def test_the_rule_matches_what_booking_creation_enforces(self):
        """A date range reported free can be booked; a reported-taken one cannot (and vice versa), end to end."""
        self.book(10, 14, S.CONFIRMED)
        self.authenticate(self.guest)

        def attempt(a, b):
            body = {"property": self.prop.pk, "check_in": self.day(a).isoformat(), "check_out": self.day(b).isoformat(), "guests_count": 1}
            return self.client.post("/api/bookings/", body, format="json").status_code

        self.assertEqual(attempt(12, 15), 409)  # overlaps a reported range
        self.assertEqual(attempt(8, 10), 201)  # check-out on a range's start is allowed
        self.assertEqual(attempt(14, 16), 201)  # check-in on a range's end is allowed
        self.assertEqual(self.blocked(), [
            {"start": self.day(8).isoformat(), "end": self.day(16).isoformat()},  # touching ranges merge
        ])

    def test_overlapping_and_touching_ranges_are_merged_not_listed_per_booking(self):
        self.book(5, 8)
        self.book(8, 10, S.PENDING)  # touches
        self.book(9, 12)  # overlaps
        self.book(20, 21)
        self.assertEqual(
            self.blocked(),
            [{"start": self.day(5).isoformat(), "end": self.day(12).isoformat()}, {"start": self.day(20).isoformat(), "end": self.day(21).isoformat()}],
        )

    def test_one_free_night_between_bookings_keeps_two_ranges(self):
        self.book(5, 8)
        self.book(9, 11)
        self.assertEqual(len(self.blocked()), 2)

    def test_ranges_are_clipped_to_the_requested_window(self):
        self.book(-3, 4)
        self.book(40, 50)
        self.assertEqual(
            self.blocked(**{"from": self.day(0).isoformat(), "to": self.day(45).isoformat()}),
            [{"start": self.day(0).isoformat(), "end": self.day(4).isoformat()}, {"start": self.day(40).isoformat(), "end": self.day(45).isoformat()}],
        )
        self.assertEqual(self.blocked(**{"from": self.day(60).isoformat(), "to": self.day(90).isoformat()}), [])

    def test_a_booking_ending_on_the_window_start_does_not_appear(self):
        self.book(-3, 0)
        self.assertEqual(self.blocked(), [])

    def test_other_properties_bookings_do_not_leak_in(self):
        other = make_property(owner=self.host)
        self.book(5, 8, prop=other)
        self.assertEqual(self.blocked(), [])

    def test_nothing_private_is_exposed(self):
        self.book(5, 8)
        r = self.client.get(url(self.prop))
        text = r.content.decode()
        for private in ("secret-guest", "Secret Guest", "guest", "email", "total_price", "status", "CONFIRMED"):
            self.assertNotIn(private, text)
        self.assertEqual(set(r.json()["blocked"][0]), {"start", "end"})
        self.assertEqual(r.json().keys() & {"guest", "bookings", "email"}, set())

    def test_the_same_answer_for_every_role(self):
        self.book(5, 8)
        expected = self.client.get(url(self.prop)).json()
        for user in (self.guest, self.host, make_user(Role.SUPER_ADMIN), make_user(Role.HOST)):
            self.authenticate(user)
            self.assertEqual(self.client.get(url(self.prop)).json(), expected)

    def test_unknown_property_is_a_404(self):
        r = self.client.get("/api/properties/999999/availability/")
        self.assertEqual((r.status_code, self.error(r)["code"]), (404, "not_found"))

    def test_bad_parameters_are_400(self):
        t = self.today
        for params in (
            {"from": "tomorrow"},
            {"to": "2030-13-45"},
            {"from": t.isoformat(), "to": t.isoformat()},
            {"from": (t + timedelta(days=5)).isoformat(), "to": t.isoformat()},
            {"from": t.isoformat(), "to": (t + timedelta(days=401)).isoformat()},
        ):
            with self.subTest(params=params):
                r = self.client.get(url(self.prop, **params))
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_the_widest_allowed_window_is_accepted(self):
        t = self.today
        r = self.client.get(url(self.prop, **{"from": t.isoformat(), "to": (t + timedelta(days=400)).isoformat()}))
        self.assertEqual(r.status_code, 200)

    def test_it_uses_a_fixed_number_of_queries(self):
        for i in range(10):
            self.book(i * 3, i * 3 + 2)
        with self.assertNumQueries(2):  # the property lookup and the bookings
            self.client.get(url(self.prop))
