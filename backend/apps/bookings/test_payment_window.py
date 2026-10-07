"""Quote, the 15-minute payment window, and expiry that does not depend on a cleanup job."""

from datetime import timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import Role
from apps.core.testing import make_booking, make_property, make_user

from . import services
from .models import Booking
from .test_api_bookings import BOOK, BookingTestCase, in_days

S = Booking.Status


class QuoteTests(BookingTestCase):
    def quote(self, user=None, **override):
        body = {"property": self.prop.pk, "check_in": str(in_days(10)), "check_out": str(in_days(13)), "guests_count": 2, **override}
        return self.as_(user or self.guest).post(f"{BOOK}quote/", body, format="json")

    def test_a_quote_prices_the_stay_from_the_database(self):
        r = self.quote()
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        self.assertEqual((data["nights"], data["price_per_night"], data["total_price"], data["currency"]), (3, "2500.00", "7500.00", "INR"))
        self.assertEqual((data["available"], data["payment_window_minutes"]), (True, 15))

    def test_a_quote_saves_nothing(self):
        self.quote()
        self.assertEqual(Booking.objects.count(), 0)

    def test_the_booking_is_priced_again_not_taken_from_the_quote(self):
        self.quote()
        self.prop.price_per_night = Decimal("3000.00")
        self.prop.save()
        r = self.book(total_price="1.00")  # a price in the request is ignored
        self.assertEqual(r.json()["total_price"], "9000.00")

    def test_a_quote_says_when_the_dates_are_taken(self):
        self.book()
        self.assertFalse(self.quote(self.other_guest).json()["available"])

    def test_a_quote_validates_like_a_booking(self):
        self.assertEqual(self.quote(guests_count=99).status_code, 400)
        self.assertEqual(self.quote(check_out=str(in_days(10))).status_code, 400)
        self.assertEqual(self.quote(check_in=str(in_days(-3)), check_out=str(in_days(-1))).status_code, 400)

    def test_only_end_users_can_ask_for_a_quote(self):
        self.assertEqual(self.quote(self.host).status_code, 403)
        self.assertEqual(self.as_(None).post(f"{BOOK}quote/", {}, format="json").status_code, 401)

    def test_a_quote_is_not_a_booking_of_someone_elses(self):
        self.book()
        self.assertEqual(self.as_(self.guest).get(f"{BOOK}quote/").status_code, 405)


class PaymentWindowTests(BookingTestCase):
    def test_a_new_booking_expires_in_fifteen_minutes(self):
        before = timezone.now()
        data = self.book().json()
        b = Booking.objects.get(pk=data["id"])
        self.assertGreaterEqual(b.expires_at, before + timedelta(minutes=15))
        self.assertLessEqual(b.expires_at, timezone.now() + timedelta(minutes=15))
        self.assertEqual(data["payment_status"], None)

    @override_settings(BOOKING_PAYMENT_WINDOW_MINUTES=5)
    def test_the_window_is_configurable(self):
        b = Booking.objects.get(pk=self.book().json()["id"])
        self.assertLess(b.expires_at, timezone.now() + timedelta(minutes=5, seconds=1))

    def test_a_pending_booking_blocks_dates_inside_its_window(self):
        self.assertEqual(self.book().status_code, 201)
        r = self.book(self.other_guest)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "dates_unavailable"))

    def test_an_expired_booking_stops_blocking_even_if_nothing_has_swept_it(self):
        b = Booking.objects.get(pk=self.book().json()["id"])
        Booking.objects.filter(pk=b.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)  # still stored as PENDING: no job has run
        self.assertEqual(self.book(self.other_guest).status_code, 201)
        r = self.client.get(f"/api/properties/{self.prop.pk}/availability/")
        self.assertEqual(len(r.json()["blocked"]), 1)  # only the new booking blocks

    def test_search_availability_ignores_expired_holds(self):
        b = Booking.objects.get(pk=self.book().json()["id"])
        params = f"?check_in={b.check_in}&check_out={b.check_out}"
        self.assertNotIn(self.prop.pk, [p["id"] for p in self.client.get(f"/api/properties/{params}").json()["results"]])
        Booking.objects.filter(pk=b.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertIn(self.prop.pk, [p["id"] for p in self.client.get(f"/api/properties/{params}").json()["results"]])

    def test_listing_bookings_sweeps_expired_ones(self):
        b = make_booking(guest=self.guest, prop=self.prop, expires_at=timezone.now() - timedelta(minutes=1))
        r = self.as_(self.guest).get(BOOK)
        self.assertEqual(r.json()["results"][0]["status"], "EXPIRED")
        b.refresh_from_db()
        self.assertEqual(b.status, S.EXPIRED)

    def test_confirmed_bookings_never_expire(self):
        b = make_booking(guest=self.guest, prop=self.prop, status=S.CONFIRMED)
        Booking.objects.filter(pk=b.pk).update(expires_at=timezone.now() - timedelta(days=1))
        self.assertEqual(services.expire_stale(), 0)
        b.refresh_from_db()
        self.assertEqual(b.status, S.CONFIRMED)

    def test_the_management_command_expires_unpaid_bookings(self):
        old = make_booking(guest=self.guest, prop=self.prop, expires_at=timezone.now() - timedelta(minutes=1))
        fresh = make_booking(guest=self.guest, prop=self.prop, check_in=in_days(40), check_out=in_days(42))
        out = StringIO()
        call_command("expire_unpaid_bookings", stdout=out)
        old.refresh_from_db(), fresh.refresh_from_db()
        self.assertEqual((old.status, fresh.status), (S.EXPIRED, S.PENDING))
        self.assertIn("Expired 1", out.getvalue())

    def test_a_pending_booking_without_a_window_is_treated_as_expired(self):
        legacy = Booking.objects.create(
            guest=self.guest, property=self.prop, check_in=in_days(5), check_out=in_days(7), guests_count=1, total_price=Decimal("5000"), status=S.PENDING
        )
        self.assertFalse(Booking.objects.holding().filter(pk=legacy.pk).exists())
        services.expire_stale()
        legacy.refresh_from_db()
        self.assertEqual(legacy.status, S.EXPIRED)

    def test_the_guest_can_cancel_a_pending_booking_to_free_the_dates(self):
        b = Booking.objects.get(pk=self.book().json()["id"])
        self.act(self.guest, b, "cancel")
        self.assertEqual(self.book(self.other_guest).status_code, 201)

    def test_expired_and_refund_required_bookings_do_not_block_a_role_change(self):
        # a guest whose only bookings are dead can be turned into a Host; see accounts/admin_users.py
        for status in (S.EXPIRED, S.REFUND_REQUIRED):
            make_booking(guest=self.guest, prop=self.prop, status=status, check_in=in_days(50), check_out=in_days(52))
        self.as_(self.admin)
        r = self.client.patch(f"/api/users/{self.guest.pk}/", {"role": Role.HOST}, format="json")
        self.assertNotEqual(self.error_code(r), "has_active_bookings")

    def error_code(self, r):
        return r.json().get("error", {}).get("code")
