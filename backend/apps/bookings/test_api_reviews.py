"""Reviews: who may write, edit and delete them, and who may read them."""

from apps.accounts.models import Role
from apps.core.testing import ApiTestCase, make_booking, make_property, make_user

from .models import Booking, Review

REV = "/api/reviews/"
S = Booking.Status


class ReviewTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.admin = make_user(Role.SUPER_ADMIN)
        self.host = make_user(Role.HOST)
        self.other_host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER, verified=True)
        self.other_guest = make_user(Role.END_USER, verified=True)
        self.prop = make_property(owner=self.host)
        self.done = make_booking(guest=self.guest, prop=self.prop, status=S.COMPLETED)

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client

    def review(self, user=None, booking=None, **body):
        payload = {"booking": (booking or self.done).pk, "rating": 5, "comment": "Lovely", **body}
        payload = {k: v for k, v in payload.items() if v is not None}
        return self.as_(user or self.guest).post(REV, payload, format="json")


class ReviewCreateTests(ReviewTestCase):
    def test_an_unverified_email_cannot_review(self):
        unverified = make_user(Role.END_USER, verified=False)
        done = make_booking(guest=unverified, prop=self.prop, status=S.COMPLETED)
        r = self.review(user=unverified, booking=done)
        self.assertEqual((r.status_code, self.error(r)["code"]), (403, "email_not_verified"))
        self.assertEqual(Review.objects.count(), 0)

    def test_the_guest_reviews_a_completed_stay_once(self):
        r = self.review()
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        self.assertEqual(set(data), {"id", "property", "author", "rating", "comment", "created_at"})
        self.assertEqual((data["rating"], data["property"], data["author"]), (5, self.prop.pk, {"id": self.guest.pk, "full_name": self.guest.full_name}))
        self.assertNotIn("booking", data)
        self.assertEqual(Review.objects.get().booking, self.done)

    def test_a_second_review_of_the_same_stay_is_rejected(self):
        self.review()
        r = self.review(rating=1)
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))
        self.assertIn("booking", self.error(r)["details"])
        self.assertEqual(Review.objects.get().rating, 5)

    def test_only_completed_stays_can_be_reviewed(self):
        for status in (S.PENDING, S.CONFIRMED, S.CANCELLED):
            booking = make_booking(guest=self.guest, prop=self.prop, status=status)
            r = self.review(booking=booking)
            self.assertEqual(r.status_code, 400, status)
            self.assertIn("booking", self.error(r)["details"])
        self.assertEqual(Review.objects.count(), 0)

    def test_you_cannot_review_someone_elses_stay_and_it_looks_like_it_does_not_exist(self):
        r = self.review(self.other_guest)
        self.assertEqual(r.status_code, 400)
        self.assertIn("booking", self.error(r)["details"])
        missing = self.review(self.guest, booking=type("B", (), {"pk": 999999})())
        import re

        normalise = lambda body: re.sub(r"\d+", "N", str(body))  # noqa: E731  (the echoed id differs, nothing else)
        self.assertEqual(normalise(r.json()), normalise(missing.json()))  # identical answer: nothing is revealed
        self.assertEqual(Review.objects.count(), 0)

    def test_hosts_super_admins_and_anonymous_cannot_write_reviews(self):
        for user in (self.host, self.admin):
            self.assertEqual(self.review(user).status_code, 403)
        self.assertEqual(self.as_(None).post(REV, {"booking": self.done.pk, "rating": 5}, format="json").status_code, 401)
        self.assertEqual(Review.objects.count(), 0)

    def test_rating_and_comment_validation(self):
        for body in ({"rating": 0}, {"rating": 6}, {"rating": -1}, {"rating": "five"}, {"rating": 4.5}, {"rating": None}, {"comment": "x" * 2001}):
            with self.subTest(body):
                self.assertEqual(self.review(**body).status_code, 400)
        self.assertEqual(Review.objects.count(), 0)
        self.assertEqual(self.review(comment=None).status_code, 201)  # the comment is optional

    def test_missing_booking_is_a_validation_error(self):
        r = self.as_(self.guest).post(REV, {"rating": 5}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))


class ReviewReadTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.other_prop = make_property(owner=self.other_host)
        self.r1 = Review.objects.create(booking=self.done, rating=5, comment="Great")
        self.r2 = Review.objects.create(booking=make_booking(guest=self.other_guest, prop=self.prop, status=S.COMPLETED), rating=2, comment="Meh")
        self.r3 = Review.objects.create(booking=make_booking(guest=self.guest, prop=self.other_prop, status=S.COMPLETED), rating=4)

    def test_anyone_can_read_reviews(self):
        r = self.as_(None).get(REV)
        self.assertEqual((r.status_code, r.json()["count"]), (200, 3))
        self.assertEqual(self.client.get(f"{REV}{self.r1.pk}/").json()["comment"], "Great")
        self.assertNotIn(self.guest.email, self.client.get(REV).content.decode())

    def test_filter_search_and_order(self):
        ids = lambda q: {x["id"] for x in self.as_(None).get(f"{REV}{q}").json()["results"]}  # noqa: E731
        self.assertEqual(ids(f"?property={self.prop.pk}"), {self.r1.pk, self.r2.pk})
        self.assertEqual(ids("?rating=4"), {self.r3.pk})
        self.assertEqual(ids("?min_rating=4"), {self.r1.pk, self.r3.pk})
        self.assertEqual(self.client.get(f"{REV}?ordering=rating").json()["results"][0]["id"], self.r2.pk)
        self.assertEqual(self.client.get(f"{REV}?ordering=-rating").json()["results"][0]["id"], self.r1.pk)
        self.assertEqual(self.client.get(f"{REV}?rating=abc").status_code, 400)

    def test_the_list_uses_a_fixed_number_of_queries(self):
        for _ in range(6):
            Review.objects.create(booking=make_booking(guest=self.guest, prop=self.prop, status=S.COMPLETED), rating=3)
        with self.assertNumQueries(2):  # count, reviews with guest and property
            self.as_(None).get(REV)

    def test_property_ratings_follow_the_reviews(self):
        card = lambda: self.as_(None).get(f"/api/properties/{self.prop.pk}/").json()  # noqa: E731
        self.assertEqual((card()["average_rating"], card()["review_count"]), (3.5, 2))
        self.as_(self.guest).delete(f"{REV}{self.r1.pk}/")
        self.assertEqual((card()["average_rating"], card()["review_count"]), (2.0, 1))


class ReviewChangeTests(ReviewTestCase):
    def setUp(self):
        super().setUp()
        self.rev = Review.objects.create(booking=self.done, rating=3, comment="OK")

    def test_the_author_edits_rating_and_comment_only(self):
        r = self.as_(self.guest).patch(f"{REV}{self.rev.pk}/", {"rating": 5, "comment": "Better on reflection", "booking": 12345}, format="json")
        self.assertEqual((r.status_code, r.json()["rating"], r.json()["comment"]), (200, 5, "Better on reflection"))
        self.rev.refresh_from_db()
        self.assertEqual(self.rev.booking, self.done)  # the booking cannot be swapped
        self.assertEqual(self.as_(self.guest).patch(f"{REV}{self.rev.pk}/", {"rating": 9}, format="json").status_code, 400)

    def test_nobody_else_can_edit(self):
        for user, code in ((self.other_guest, 403), (self.host, 403), (self.other_host, 403), (self.admin, 403), (None, 401)):
            r = self.as_(user).patch(f"{REV}{self.rev.pk}/", {"rating": 1}, format="json")
            self.assertEqual(r.status_code, code, getattr(user, "role", None))
        self.rev.refresh_from_db()
        self.assertEqual(self.rev.rating, 3)

    def test_the_author_or_a_super_admin_deletes_but_not_the_host(self):
        for user, code in ((self.host, 403), (self.other_guest, 403), (None, 401)):
            self.assertEqual(self.as_(user).delete(f"{REV}{self.rev.pk}/").status_code, code)
        self.assertEqual(self.as_(self.admin).delete(f"{REV}{self.rev.pk}/").status_code, 204)
        again = Review.objects.create(booking=self.done, rating=2)
        self.assertEqual(self.as_(self.guest).delete(f"{REV}{again.pk}/").status_code, 204)

    def test_after_deleting_the_stay_can_be_reviewed_again(self):
        self.as_(self.guest).delete(f"{REV}{self.rev.pk}/")
        self.assertEqual(self.review(rating=4).status_code, 201)


class ReviewBookingRelationshipTests(ReviewTestCase):
    """A review belongs to one specific completed stay (booking); the property comes from that booking."""

    def second_stay(self, guest=None, status=S.COMPLETED):
        from datetime import timedelta

        return make_booking(guest=guest or self.guest, prop=self.prop, status=status,
                            check_in=self.done.check_out + timedelta(days=30), check_out=self.done.check_out + timedelta(days=33))

    def test_same_guest_same_property_two_completed_stays_can_each_be_reviewed(self):
        second = self.second_stay()
        self.assertEqual(self.review(booking=self.done, rating=4).status_code, 201)
        self.assertEqual(self.review(booking=second, rating=2).status_code, 201)
        self.assertEqual(Review.objects.count(), 2)
        self.assertEqual(Review.objects.get(booking=self.done).rating, 4)
        self.assertEqual(Review.objects.get(booking=second).rating, 2)
        listed = self.client.get(f"{REV}?property={self.prop.pk}").json()["results"]
        self.assertEqual(sorted(r["rating"] for r in listed), [2, 4])

    def test_the_second_stay_stays_reviewable_after_the_first_was_reviewed(self):
        second = self.second_stay()
        self.review(booking=self.done)
        self.assertEqual(self.review(booking=second).status_code, 201)

    def test_one_review_per_booking_even_if_two_requests_race(self):
        from django.db import IntegrityError

        self.review()
        with self.assertRaises(IntegrityError):  # the database itself enforces it, not just the serializer
            Review.objects.create(booking=self.done, rating=3)

    def test_only_the_bookings_own_guest_can_review_it(self):
        r = self.review(user=self.other_guest)
        self.assertEqual(r.status_code, 400)
        self.assertIn("booking", self.error(r)["details"])
        self.assertEqual(Review.objects.count(), 0)

    def test_pending_confirmed_and_cancelled_stays_cannot_be_reviewed(self):
        for status in (S.PENDING, S.CONFIRMED, S.CANCELLED):
            with self.subTest(status=status):
                r = self.review(booking=self.second_stay(status=status))
                self.assertEqual(r.status_code, 400)
        self.assertEqual(Review.objects.count(), 0)

    def test_the_property_cannot_be_chosen_by_the_client(self):
        other_prop = make_property(owner=self.host)
        r = self.review(property=other_prop.pk)  # extra key is ignored; the property comes from the booking
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["property"], self.prop.pk)
        self.assertEqual(Review.objects.get().booking.property, self.prop)

    def test_a_review_cannot_be_moved_to_another_booking_or_property(self):
        review_id = self.review().json()["id"]
        other = self.second_stay()
        other_prop = make_property(owner=self.host)
        r = self.as_(self.guest).patch(f"{REV}{review_id}/", {"rating": 3, "booking": other.pk, "property": other_prop.pk}, format="json")
        self.assertEqual(r.status_code, 200)
        review = Review.objects.get(pk=review_id)
        self.assertEqual((review.booking_id, review.booking.property_id, review.rating), (self.done.pk, self.prop.pk, 3))
        self.assertFalse(Review.objects.filter(booking=other).exists())

    def test_hosts_and_super_admins_cannot_create_reviews(self):
        for user in (self.host, self.other_host, self.admin):
            with self.subTest(role=user.role):
                self.assertEqual(self.review(user=user).status_code, 403)
        self.assertEqual(Review.objects.count(), 0)

    def test_a_super_admin_can_delete_a_review_and_the_stay_becomes_reviewable_again(self):
        review_id = self.review().json()["id"]
        self.assertEqual(self.as_(self.admin).delete(f"{REV}{review_id}/").status_code, 204)
        self.assertEqual(self.review().status_code, 201)

    def test_a_booking_shows_its_own_review_to_its_guest_host_and_admin_only(self):
        second = self.second_stay()
        review_id = self.review(booking=self.done, rating=4).json()["id"]
        for user in (self.guest, self.host, self.admin):
            with self.subTest(role=user.role):
                reviewed = self.as_(user).get(f"/api/bookings/{self.done.pk}/").json()
                self.assertEqual(set(reviewed["review"]), {"id", "rating", "comment", "created_at"})
                self.assertEqual((reviewed["review"]["id"], reviewed["review"]["rating"]), (review_id, 4))
                self.assertIsNone(self.as_(user).get(f"/api/bookings/{second.pk}/").json()["review"])
        self.assertEqual(self.as_(self.other_guest).get(f"/api/bookings/{self.done.pk}/").status_code, 404)

    def test_the_booking_list_attaches_reviews_without_extra_queries(self):
        for i in range(4):
            booking = self.second_stay()
            if i % 2:
                Review.objects.create(booking=booking, rating=5)
        self.as_(self.guest)
        with self.assertNumQueries(4):  # auth lookup, expiry sweep, count, bookings (with property/guest/review/payment joined)
            r = self.client.get("/api/bookings/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sum(1 for b in r.json()["results"] if b["review"]), 2)
