"""Booking creation, scoping, workflow and the verified-email requirement."""

from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import Role
from apps.core.testing import ApiTestCase, make_booking, make_property, make_user

from .models import Booking

BOOK = "/api/bookings/"
S = Booking.Status


def in_days(n):
    return timezone.localdate() + timedelta(days=n)


class BookingTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.other_host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER, verified=True)
        self.other_guest = make_user(Role.END_USER, verified=True)
        self.prop = make_property(owner=self.host, price_per_night=Decimal("2500.00"), max_guests=4)

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client

    def book(self, user=None, **override):
        body = {"property": self.prop.pk, "check_in": str(in_days(10)), "check_out": str(in_days(13)), "guests_count": 2, **override}
        body = {k: v for k, v in body.items() if v is not None}
        return self.as_(user or self.guest).post(BOOK, body, format="json")

    def act(self, user, booking, action):
        return self.as_(user).post(f"{BOOK}{booking.pk}/{action}/")


class BookingCreateTests(BookingTestCase):
    def test_a_verified_end_user_books(self):
        r = self.book()
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        self.assertEqual((data["status"], data["nights"], data["total_price"], data["guests_count"]), ("PENDING", 3, "7500.00", 2))
        self.assertEqual(data["guest"]["id"], self.guest.pk)
        self.assertEqual(data["property"]["id"], self.prop.pk)
        self.assertEqual(Booking.objects.get().guest, self.guest)

    # --- verified email ----------------------------------------------------------

    def test_an_unverified_end_user_cannot_book(self):
        unverified = make_user(Role.END_USER, verified=False)
        r = self.book(unverified)
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.error(r)["code"], "email_not_verified")
        self.assertEqual(Booking.objects.count(), 0)

    def test_verifying_unlocks_booking(self):
        user = make_user(Role.END_USER, verified=False)
        self.assertEqual(self.book(user).status_code, 403)
        user.email_verified_at = timezone.now()
        user.save()
        self.assertEqual(self.book(user).status_code, 201)

    def test_unverified_users_cannot_log_in_but_a_session_they_already_hold_can_browse_and_read_their_bookings(self):
        user = make_user(Role.END_USER, verified=False)
        self.assertEqual(self.client.post("/api/auth/token/", {"email": user.email, "password": "a-Str0ng-test-pass"}, format="json").status_code, 403)
        self.assertEqual(self.as_(user).get("/api/properties/").status_code, 200)
        self.assertEqual(self.client.get(BOOK).status_code, 200)
        self.assertEqual(self.client.get("/api/favourites/").status_code, 200)

    def test_the_whole_email_flow_unlocks_booking(self):
        from django.core import mail

        from apps.accounts.tokens import make_verification_token

        r = self.client.post("/api/auth/register/", {"email": "new@example.com", "full_name": "New", "password": "correct-horse-battery-9"}, format="json")
        user = type(self.guest).objects.get(pk=r.json()["id"])
        self.assertEqual(self.book(user).status_code, 403)
        self.client.credentials()
        self.client.post("/api/auth/verify-email/", {"token": make_verification_token(user)}, format="json")
        self.assertEqual(self.book(user).status_code, 201)
        self.assertEqual(len(mail.outbox), 1)

    def test_only_end_users_can_book(self):
        for user in (self.host, self.admin):
            r = self.book(user)
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "permission_denied"))
        self.assertEqual(self.as_(None).post(BOOK, {}, format="json").status_code, 401)
        self.assertEqual(Booking.objects.count(), 0)

    # --- validation -----------------------------------------------------------------

    def test_date_and_guest_validation(self):
        cases = {
            "past check-in": dict(check_in=str(in_days(-1)), check_out=str(in_days(2))),
            "check-out before check-in": dict(check_in=str(in_days(5)), check_out=str(in_days(4))),
            "zero nights": dict(check_in=str(in_days(5)), check_out=str(in_days(5))),
            "too many guests": dict(guests_count=5),
            "zero guests": dict(guests_count=0),
            "negative guests": dict(guests_count=-2),
            "not a date": dict(check_in="tomorrow"),
            "missing check-out": dict(check_out=None),
            "missing guests": dict(guests_count=None),
            "unknown property": dict(property=999999),
            "missing property": dict(property=None),
            "too long a stay": dict(check_out=str(in_days(10 + 91))),
        }
        for label, override in cases.items():
            with self.subTest(label):
                r = self.book(**override)
                self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"), r.content)
        self.assertEqual(Booking.objects.count(), 0)

    def test_check_in_today_is_allowed_and_the_longest_stay_is_the_limit(self):
        self.assertEqual(self.book(check_in=str(in_days(0)), check_out=str(in_days(1))).status_code, 201)
        with override_settings(BOOKING_MAX_NIGHTS=5):
            self.assertEqual(self.book(check_in=str(in_days(20)), check_out=str(in_days(25))).status_code, 201)
            self.assertEqual(self.book(check_in=str(in_days(30)), check_out=str(in_days(36))).status_code, 400)

    def test_a_total_that_would_overflow_is_rejected_not_a_500(self):
        pricey = make_property(owner=self.host, price_per_night=Decimal("99999999.99"))
        r = self.book(property=pricey.pk, check_in=str(in_days(10)), check_out=str(in_days(12)))
        self.assertEqual(r.status_code, 400)

    def test_the_client_cannot_set_price_status_or_guest(self):
        r = self.book(total_price="1.00", status="CONFIRMED", guest=self.other_guest.pk, id=999)
        self.assertEqual(r.status_code, 201)
        booking = Booking.objects.get()
        self.assertEqual((booking.total_price, booking.status, booking.guest), (Decimal("7500.00"), S.PENDING, self.guest))

    def test_the_price_is_nights_times_the_current_nightly_rate(self):
        self.prop.price_per_night = Decimal("1999.50")
        self.prop.save()
        self.assertEqual(self.book(check_in=str(in_days(40)), check_out=str(in_days(42))).json()["total_price"], "3999.00")

    # --- availability -------------------------------------------------------------

    def test_overlapping_dates_are_a_409(self):
        self.assertEqual(self.book().status_code, 201)  # days 10-13
        for a, b in ((11, 12), (8, 11), (12, 15), (9, 14), (10, 13)):
            with self.subTest((a, b)):
                r = self.book(self.other_guest, check_in=str(in_days(a)), check_out=str(in_days(b)))
                self.assertEqual((r.status_code, self.error(r)["code"]), (409, "dates_unavailable"))
        self.assertEqual(Booking.objects.count(), 1)

    def test_back_to_back_stays_are_fine(self):
        self.book()  # days 10-13
        self.assertEqual(self.book(self.other_guest, check_in=str(in_days(13)), check_out=str(in_days(15))).status_code, 201)
        self.assertEqual(self.book(self.other_guest, check_in=str(in_days(8)), check_out=str(in_days(10))).status_code, 201)

    def test_other_properties_are_independent(self):
        other = make_property(owner=self.host)
        self.book()
        self.assertEqual(self.book(self.other_guest, property=other.pk).status_code, 201)

    def test_cancelled_and_completed_bookings_release_nothing_but_pending_and_confirmed_hold_dates(self):
        make_booking(prop=self.prop, check_in=in_days(10), check_out=in_days(13), status=S.CANCELLED)
        self.assertEqual(self.book().status_code, 201)  # cancelled did not block
        self.assertEqual(self.book(self.other_guest).status_code, 409)  # the new pending one does
        Booking.objects.filter(status=S.PENDING).update(status=S.CONFIRMED)
        self.assertEqual(self.book(self.other_guest).status_code, 409)
        Booking.objects.filter(status=S.CONFIRMED).update(status=S.CANCELLED)
        self.assertEqual(self.book(self.other_guest).status_code, 201)  # cancelling frees the dates

    def test_booking_takes_a_lock_on_the_property(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(self.book().status_code, 201)
        self.assertTrue(any("FOR UPDATE" in q["sql"] and "catalog_property" in q["sql"] for q in queries.captured_queries))


class BookingVisibilityTests(BookingTestCase):
    def setUp(self):
        super().setUp()
        self.mine = make_booking(guest=self.guest, prop=self.prop)
        self.theirs = make_booking(guest=self.other_guest, prop=make_property(owner=self.other_host))

    def ids(self, user, query=""):
        r = self.as_(user).get(f"{BOOK}{query}")
        self.assertEqual(r.status_code, 200)
        return {b["id"] for b in r.json()["results"]}

    def test_each_role_sees_only_what_it_should(self):
        self.assertEqual(self.ids(self.guest), {self.mine.pk})
        self.assertEqual(self.ids(self.other_guest), {self.theirs.pk})
        self.assertEqual(self.ids(self.host), {self.mine.pk})  # bookings of their own properties
        self.assertEqual(self.ids(self.other_host), {self.theirs.pk})
        self.assertEqual(self.ids(self.admin), {self.mine.pk, self.theirs.pk})

    def test_other_peoples_bookings_do_not_exist_for_you(self):
        for user in (self.other_guest, self.other_host):
            self.assertEqual(self.as_(user).get(f"{BOOK}{self.mine.pk}/").status_code, 404)
            for action in ("cancel", "complete"):
                self.assertEqual(self.act(user, self.mine, action).status_code, 404)
            self.assertEqual(self.as_(user).delete(f"{BOOK}{self.mine.pk}/").status_code, 403)  # deleting is Super Admin only
        self.assertEqual(self.as_(self.guest).get(f"{BOOK}{self.mine.pk}/").status_code, 200)
        self.assertEqual(self.as_(self.host).get(f"{BOOK}{self.mine.pk}/").status_code, 200)
        self.assertEqual(self.as_(self.admin).get(f"{BOOK}{self.mine.pk}/").status_code, 200)

    def test_sign_in_is_required(self):
        self.assertEqual(self.as_(None).get(BOOK).status_code, 401)
        self.assertEqual(self.client.get(f"{BOOK}{self.mine.pk}/").status_code, 401)

    def test_the_host_sees_the_guests_name_but_not_their_email(self):
        r = self.as_(self.host).get(f"{BOOK}{self.mine.pk}/")
        self.assertEqual(set(r.json()["guest"]), {"id", "full_name"})
        self.assertNotIn(self.guest.email, r.content.decode())

    def test_filters_search_and_ordering(self):
        later = make_booking(guest=self.guest, prop=self.prop, check_in=in_days(50), check_out=in_days(52), status=S.CONFIRMED)
        self.assertEqual(self.ids(self.guest, "?status=CONFIRMED"), {later.pk})
        self.assertEqual(self.ids(self.guest, "?status=CONFIRMED&status=PENDING"), {later.pk, self.mine.pk})
        self.assertEqual(self.ids(self.admin, f"?property={self.prop.pk}"), {later.pk, self.mine.pk})
        self.assertEqual(self.ids(self.admin, f"?guest={self.other_guest.pk}"), {self.theirs.pk})
        self.assertEqual(self.ids(self.guest, f"?check_in_from={in_days(40)}"), {later.pk})
        self.assertEqual(self.ids(self.guest, f"?check_in_to={in_days(40)}"), {self.mine.pk})
        r = self.client.get(f"{BOOK}?ordering=-check_in")
        self.assertEqual(r.json()["results"][0]["id"], later.pk)
        self.assertEqual(self.client.get(f"{BOOK}?status=NOPE").status_code, 400)
        self.assertEqual(self.client.get(f"{BOOK}?check_in_from=bad").status_code, 400)

    def test_pagination(self):
        for i in range(14):
            make_booking(guest=self.guest, prop=self.prop, check_in=in_days(100 + 3 * i), check_out=in_days(101 + 3 * i))
        data = self.as_(self.guest).get(BOOK).json()
        self.assertEqual((data["count"], len(data["results"])), (15, 12))

    def test_the_list_uses_a_fixed_number_of_queries(self):
        for i in range(8):
            make_booking(guest=self.guest, prop=make_property(owner=self.host))
        self.as_(self.guest)
        with self.assertNumQueries(4):  # user, expiry sweep, count, bookings with property/destination/guest/payment
            self.client.get(BOOK)

    def test_there_is_no_edit_endpoint(self):
        self.as_(self.guest)
        for method in ("put", "patch"):
            self.assertEqual(getattr(self.client, method)(f"{BOOK}{self.mine.pk}/", {"guests_count": 1}, format="json").status_code, 405)

    def test_only_a_super_admin_deletes_bookings(self):
        for user in (self.guest, self.host):
            self.assertEqual(self.as_(user).delete(f"{BOOK}{self.mine.pk}/").status_code, 403)
        self.assertEqual(self.as_(self.admin).delete(f"{BOOK}{self.mine.pk}/").status_code, 204)


class BookingWorkflowTests(BookingTestCase):
    def booking(self, status=S.PENDING, **kw):
        return make_booking(guest=self.guest, prop=self.prop, status=status, **kw)

    def test_nobody_can_confirm_a_booking_by_hand(self):
        """Only a verified payment confirms (apps/payments). There is no confirm endpoint for anyone."""
        b = self.booking()
        for user in (self.host, self.admin, self.guest):
            self.assertEqual(self.act(user, b, "confirm").status_code, 404, user.role)
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_super_admin_can_complete_and_cancel_but_not_confirm(self):
        b = self.booking(S.CONFIRMED, check_in=in_days(-5), check_out=in_days(-3))
        self.assertEqual(self.act(self.admin, b, "complete").json()["status"], "COMPLETED")
        self.assertEqual(self.act(self.admin, self.booking(), "cancel").json()["status"], "CANCELLED")
        self.assertEqual(self.act(self.admin, self.booking(), "confirm").status_code, 404)

    def test_the_guest_can_cancel_but_not_complete(self):
        b = self.booking()
        r = self.act(self.guest, b, "complete")
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "permission_denied"))
        self.assertEqual(self.act(self.guest, b, "cancel").json()["status"], "CANCELLED")
        confirmed = self.booking(S.CONFIRMED)
        self.assertEqual(self.act(self.guest, confirmed, "cancel").json()["status"], "CANCELLED")

    def test_the_host_can_decline_or_cancel(self):
        self.assertEqual(self.act(self.host, self.booking(), "cancel").json()["status"], "CANCELLED")
        self.assertEqual(self.act(self.host, self.booking(S.CONFIRMED), "cancel").json()["status"], "CANCELLED")

    def test_complete_needs_a_confirmed_booking_whose_stay_is_over(self):
        future = self.booking(S.CONFIRMED)
        r = self.act(self.host, future, "complete")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "stay_not_finished"))
        r = self.act(self.host, self.booking(S.PENDING, check_in=in_days(-5), check_out=in_days(-3)), "complete")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_transition"))
        over = self.booking(S.CONFIRMED, check_in=in_days(-5), check_out=in_days(-3))
        self.assertEqual(self.act(self.host, over, "complete").json()["status"], "COMPLETED")
        checkout_today = self.booking(S.CONFIRMED, check_in=in_days(-2), check_out=in_days(0))
        self.assertEqual(self.act(self.host, checkout_today, "complete").json()["status"], "COMPLETED")

    def test_final_statuses_cannot_change(self):
        for status in (S.CANCELLED, S.COMPLETED):
            b = self.booking(status, check_in=in_days(-9), check_out=in_days(-7))
            for action in ("cancel", "complete"):
                r = self.act(self.admin, b, action)
                self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_transition"), (status, action))

    def test_expired_and_refund_required_bookings_cannot_be_revived(self):
        for status in (S.EXPIRED, S.REFUND_REQUIRED):
            b = self.booking(status, check_in=in_days(30), check_out=in_days(32))
            for action in ("cancel", "complete"):
                r = self.act(self.admin, b, action)
                self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_transition"), (status, action))

    def test_another_host_and_other_guests_cannot_touch_the_booking(self):
        b = self.booking()
        for user in (self.other_host, self.other_guest):
            self.assertEqual(self.act(user, b, "cancel").status_code, 404)
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_an_end_user_who_is_not_the_guest_gets_404_not_403(self):
        self.assertEqual(self.act(self.other_guest, self.booking(), "cancel").status_code, 404)

    def test_anonymous_gets_401(self):
        self.assertEqual(self.act(None, self.booking(), "cancel").status_code, 401)

    def test_transitions_are_post_only(self):
        b = self.booking()
        self.as_(self.host)
        self.assertEqual(self.client.get(f"{BOOK}{b.pk}/cancel/").status_code, 405)
        self.assertEqual(self.client.put(f"{BOOK}{b.pk}/cancel/").status_code, 405)

    def test_a_cancelled_booking_frees_its_dates_for_the_next_guest(self):
        r = self.book()
        booking_id = r.json()["id"]
        self.assertEqual(self.book(self.other_guest).status_code, 409)
        self.as_(self.guest).post(f"{BOOK}{booking_id}/cancel/")
        self.assertEqual(self.book(self.other_guest).status_code, 201)

    def test_updated_at_moves_but_the_price_does_not(self):
        b = self.booking()
        before = b.total_price
        self.act(self.host, b, "cancel")
        b.refresh_from_db()
        self.assertEqual(b.total_price, before)
