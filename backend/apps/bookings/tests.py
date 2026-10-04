from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.core.testing import dates, make_property, make_user

from .models import Booking, Review


def booking(**extra):
    ci, co = dates()
    fields = dict(guest=make_user(), property=make_property(), check_in=ci, check_out=co, guests_count=2, total_price=9000)
    fields.update(extra)
    return Booking.objects.create(**fields)


class BookingTests(TestCase):
    def test_defaults_to_pending(self):
        self.assertEqual(booking().status, Booking.Status.PENDING)

    def test_checkout_must_be_after_checkin(self):
        ci, _ = dates()
        for co in (ci, ci.replace(day=1)):
            with self.subTest(check_out=co), self.assertRaises(IntegrityError), transaction.atomic():
                booking(check_in=ci, check_out=co)

    def test_guests_and_total_constraints(self):
        for field, value in (("guests_count", 0), ("total_price", -1)):
            with self.subTest(field=field), self.assertRaises(IntegrityError), transaction.atomic():
                booking(**{field: value})


class ReviewTests(TestCase):
    def test_one_review_per_booking_and_rating_in_range(self):
        b = booking()
        Review.objects.create(booking=b, rating=5, comment="Lovely")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Review.objects.create(booking=b, rating=4)
        for bad in (0, 6):
            with self.subTest(rating=bad), self.assertRaises(IntegrityError), transaction.atomic():
                Review.objects.create(booking=booking(), rating=bad)

    def test_guest_and_property_are_reached_through_the_booking(self):
        b = booking()
        r = Review.objects.create(booking=b, rating=3)
        self.assertEqual((r.booking.guest, r.booking.property), (b.guest, b.property))
