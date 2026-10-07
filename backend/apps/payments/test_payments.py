"""Guest booking payment, with Razorpay mocked. Nothing here talks to the real Razorpay."""

import hashlib
import hmac
import json
import threading
from datetime import timedelta
from unittest import mock

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.models import Role
from apps.bookings.models import Booking
from apps.core.testing import ApiTestCase, make_booking, make_property, make_user
from apps.payments import gateway, services
from apps.payments.models import Payment

KEY, SECRET, WEBHOOK_SECRET = "rzp_test_key", "test_secret", "whsec_test"
S, PS = Booking.Status, Payment.Status
creds = override_settings(RAZORPAY_KEY_ID=KEY, RAZORPAY_KEY_SECRET=SECRET, RAZORPAY_WEBHOOK_SECRET=WEBHOOK_SECRET)


def sign(order_id, payment_id, secret=SECRET):
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


class FakeRazorpay:
    """Stands in for gateway.create_order / fetch_payment / capture_payment."""

    def __init__(self):
        self.orders = 0
        self.payments = {}

    def create_order(self, amount, currency, receipt, notes):
        self.orders += 1
        return {"id": f"order_{self.orders}{receipt.replace('-', '')}", "amount": amount, "currency": currency}

    def fetch_payment(self, payment_id):
        return dict(self.payments[payment_id])

    def capture_payment(self, payment_id, amount, currency):
        self.payments[payment_id]["status"] = "captured"
        return dict(self.payments[payment_id])

    def paid(self, order_id, payment_id="pay_1", amount=None, currency="INR", status="captured"):
        self.payments[payment_id] = {"id": payment_id, "order_id": order_id, "amount": amount, "currency": currency, "status": status}
        return self.payments[payment_id]


@creds
class PaymentTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.host = make_user(Role.HOST)
        self.guest = make_user(Role.END_USER, verified=True)
        self.other = make_user(Role.END_USER, verified=True)
        self.admin = make_user(Role.SUPER_ADMIN)
        self.prop = make_property(owner=self.host)  # 4500.00 a night
        self.fake = FakeRazorpay()
        for name in ("create_order", "fetch_payment", "capture_payment"):
            patcher = mock.patch.object(gateway, name, getattr(self.fake, name))
            patcher.start()
            self.addCleanup(patcher.stop)

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client

    def booking(self, **kw):
        return make_booking(guest=kw.pop("guest", self.guest), prop=self.prop, **kw)

    def initiate(self, booking, user=None):
        return self.as_(user or booking.guest).post(f"/api/bookings/{booking.pk}/payment/")

    def verify(self, booking, order_id, payment_id, signature=None, user=None):
        body = {
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature if signature is not None else sign(order_id, payment_id),
        }
        return self.as_(user or booking.guest).post(f"/api/bookings/{booking.pk}/payment/verify/", body, format="json")

    def webhook(self, order_id, payment_id="pay_1", event="payment.captured", amount=None, signature=None, **entity):
        entity = {"id": payment_id, "order_id": order_id, "amount": amount, "currency": "INR", "status": "captured", **entity}
        raw = json.dumps({"event": event, "payload": {"payment": {"entity": entity}}}).encode()
        sig = signature if signature is not None else hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        self.logout()
        return self.client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)

    def start(self, **kw):
        """A PENDING booking with an order; returns (booking, order_id, amount_paise)."""
        b = self.booking(**kw)
        r = self.initiate(b)
        self.assertEqual(r.status_code, 200, r.content)
        data = r.json()
        return b, data["order_id"], data["amount"]

    def expire(self, booking):
        Booking.objects.filter(pk=booking.pk).update(expires_at=timezone.now() - timedelta(seconds=1))


class InitiatePaymentTests(PaymentTestCase):
    def test_creates_an_order_for_the_server_side_amount(self):
        b = self.booking()  # 2 nights x 4500
        r = self.initiate(b)
        data = r.json()
        self.assertEqual(r.status_code, 200)
        self.assertEqual((data["amount"], data["currency"], data["key_id"], data["booking_id"]), (900000, "INR", KEY, b.pk))
        self.assertNotIn("secret", json.dumps(data).lower())
        p = Payment.objects.get()
        self.assertEqual((p.booking, p.amount_paise, p.status, p.provider), (b, 900000, PS.CREATED, "razorpay"))

    def test_the_amount_comes_from_the_booking_not_the_request(self):
        b = self.booking()
        r = self.as_(self.guest).post(f"/api/bookings/{b.pk}/payment/", {"amount": 1, "total_price": "1.00"}, format="json")
        self.assertEqual(r.json()["amount"], 900000)

    def test_initiating_twice_reuses_the_same_order(self):
        b = self.booking()
        first, second = self.initiate(b).json(), self.initiate(b).json()
        self.assertEqual(first["order_id"], second["order_id"])
        self.assertEqual((self.fake.orders, Payment.objects.count()), (1, 1))

    def test_sign_in_is_required(self):
        b = self.booking()
        self.assertEqual(self.as_(None).post(f"/api/bookings/{b.pk}/payment/").status_code, 401)
        self.assertEqual(Payment.objects.count(), 0)

    def test_another_guests_booking_is_a_404(self):
        b = self.booking()
        self.assertEqual(self.initiate(b, self.other).status_code, 404)
        self.assertEqual(Payment.objects.count(), 0)

    def test_hosts_and_admins_cannot_pay_for_a_guest(self):
        b = self.booking()
        for user in (self.host, self.admin):
            self.assertEqual(self.initiate(b, user).status_code, 403)

    def test_an_unverified_guest_cannot_initiate(self):
        unverified = make_user(Role.END_USER, verified=False)
        b = self.booking(guest=unverified)
        self.assertEqual(self.initiate(b).status_code, 403)

    def test_an_expired_booking_cannot_be_paid(self):
        b = self.booking()
        self.expire(b)
        r = self.initiate(b)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "booking_expired"))
        b.refresh_from_db()
        self.assertEqual(b.status, S.EXPIRED)
        self.assertEqual(Payment.objects.count(), 0)

    def test_non_payable_bookings_are_refused(self):
        cancelled = self.booking(status=S.CANCELLED)
        expired = self.booking(status=S.EXPIRED)
        confirmed = self.booking(status=S.CONFIRMED)
        self.assertEqual(self.initiate(cancelled).json()["error"]["code"], "booking_not_payable")
        self.assertEqual(self.initiate(expired).json()["error"]["code"], "booking_expired")
        self.assertEqual(self.initiate(confirmed).json()["error"]["code"], "already_paid")

    def test_an_already_paid_booking_cannot_start_another_payment(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        self.assertEqual(self.verify(b, order, "pay_1").status_code, 200)
        r = self.initiate(b)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "already_paid"))

    def test_missing_credentials_give_a_clear_503(self):
        b = self.booking()
        mock.patch.stopall()  # use the real gateway functions; they must refuse before any network call
        with override_settings(RAZORPAY_KEY_ID="", RAZORPAY_KEY_SECRET=""):
            r = self.initiate(b)
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (503, "payment_not_configured"))
        self.assertEqual(Payment.objects.count(), 0)


class VerifyPaymentTests(PaymentTestCase):
    def test_a_valid_payment_confirms_the_booking(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        r = self.verify(b, order, "pay_1")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual((r.json()["status"], r.json()["payment_status"]), ("CONFIRMED", "PAID"))
        b.refresh_from_db()
        p = b.payment
        self.assertEqual((b.status, p.status, p.razorpay_payment_id, p.verified_via), (S.CONFIRMED, PS.PAID, "pay_1", "CHECKOUT"))
        self.assertIsNotNone(p.paid_at)

    def test_an_invalid_signature_is_rejected(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        r = self.verify(b, order, "pay_1", signature=sign(order, "pay_1", "wrong_secret"))
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "invalid_signature"))
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_a_signature_for_another_payment_is_rejected(self):
        b, order, amount = self.start()
        self.fake.paid(order, "pay_1", amount)
        r = self.verify(b, order, "pay_1", signature=sign(order, "pay_other"))
        self.assertEqual(self.error(r)["code"], "invalid_signature")

    def error(self, r):
        return r.json()["error"]

    def test_the_wrong_order_id_is_rejected(self):
        b, order, amount = self.start()
        other_b, other_order, other_amount = self.start(guest=self.other)
        self.fake.paid(other_order, "pay_2", other_amount)
        r = self.verify(b, other_order, "pay_2")  # a genuine, signed payment... for somebody else's order
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "order_mismatch"))
        for x in (b, other_b):
            x.refresh_from_db()
            self.assertEqual(x.status, S.PENDING)

    def test_razorpay_saying_the_payment_belongs_to_another_order(self):
        b, order, amount = self.start()
        self.fake.paid("order_somethingelse", "pay_1", amount)
        r = self.verify(b, order, "pay_1")
        self.assertEqual(self.error(r)["code"], "order_mismatch")

    def test_amount_mismatch(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount - 100)
        r = self.verify(b, order, "pay_1")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "amount_mismatch"))
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_currency_mismatch(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount, currency="USD")
        r = self.verify(b, order, "pay_1")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "currency_mismatch"))

    def test_a_failed_payment_leaves_the_booking_pending_and_retryable(self):
        b, order, amount = self.start()
        self.fake.paid(order, "pay_bad", amount, status="failed")
        r = self.verify(b, order, "pay_bad")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "payment_failed"))
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)
        self.fake.paid(order, "pay_good", amount)  # the guest tries again in Checkout
        self.assertEqual(self.verify(b, order, "pay_good").json()["status"], "CONFIRMED")

    def test_a_payment_that_is_not_captured_does_not_confirm(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount, status="created")
        r = self.verify(b, order, "pay_1")
        self.assertEqual(self.error(r)["code"], "payment_incomplete")

    def test_an_authorized_payment_is_captured_then_confirmed(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount, status="authorized")
        self.assertEqual(self.verify(b, order, "pay_1").json()["status"], "CONFIRMED")

    def test_duplicate_verification_is_harmless(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        self.assertEqual(self.verify(b, order, "pay_1").status_code, 200)
        r = self.verify(b, order, "pay_1")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "CONFIRMED"))
        self.assertEqual(Payment.objects.count(), 1)

    def test_a_second_payment_id_does_not_replace_the_first(self):
        b, order, amount = self.start()
        self.fake.paid(order, "pay_1", amount)
        self.verify(b, order, "pay_1")
        self.fake.paid(order, "pay_2", amount)
        self.verify(b, order, "pay_2")
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.razorpay_payment_id), (S.CONFIRMED, "pay_1"))

    def test_another_guest_cannot_verify_my_booking(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        r = self.verify(b, order, "pay_1", user=self.other)
        self.assertEqual(r.status_code, 404)
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_verify_without_an_order_is_404(self):
        b = self.booking()
        self.assertEqual(self.verify(b, "order_x", "pay_1").status_code, 404)

    def test_sign_in_is_required(self):
        b, order, _ = self.start()
        self.assertEqual(self.as_(None).post(f"/api/bookings/{b.pk}/payment/verify/", {}, format="json").status_code, 401)

    def test_missing_fields_are_a_validation_error(self):
        b, *_ = self.start()
        r = self.as_(self.guest).post(f"/api/bookings/{b.pk}/payment/verify/", {"razorpay_order_id": "x"}, format="json")
        self.assertEqual((r.status_code, self.error(r)["code"]), (400, "validation_error"))

    def test_a_payment_after_the_window_needs_a_refund_and_never_confirms(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        self.expire(b)
        r = self.verify(b, order, "pay_1")
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "payment_after_expiry"))
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status, b.payment.razorpay_payment_id), (S.REFUND_REQUIRED, PS.REFUND_REQUIRED, "pay_1"))


class WebhookTests(PaymentTestCase):
    def test_a_captured_payment_confirms_even_if_the_browser_never_reports(self):
        b, order, amount = self.start()
        r = self.webhook(order, amount=amount)
        self.assertEqual((r.status_code, r.json()["status"]), (200, "confirmed"))
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status, b.payment.verified_via), (S.CONFIRMED, PS.PAID, "WEBHOOK"))

    def test_order_paid_event_with_a_payment_entity_also_confirms(self):
        b, order, amount = self.start()
        self.assertEqual(self.webhook(order, amount=amount, event="order.paid").json()["status"], "confirmed")

    def test_a_bad_signature_is_rejected_and_changes_nothing(self):
        b, order, amount = self.start()
        for sig in ("deadbeef", ""):
            r = self.webhook(order, amount=amount, signature=sig)
            self.assertEqual(r.status_code, 400)
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_a_signature_made_with_the_checkout_secret_is_not_enough(self):
        b, order, amount = self.start()
        raw = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": {}}}}).encode()
        sig = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
        self.logout()
        r = self.client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(r.status_code, 400)

    def test_with_no_webhook_secret_configured_everything_is_rejected(self):
        b, order, amount = self.start()
        with override_settings(RAZORPAY_WEBHOOK_SECRET=""):
            raw = b"{}"
            sig = hmac.new(b"", raw, hashlib.sha256).hexdigest()
            self.logout()
            r = self.client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(r.status_code, 400)

    def test_duplicate_delivery_is_idempotent(self):
        b, order, amount = self.start()
        self.assertEqual(self.webhook(order, amount=amount).json()["status"], "confirmed")
        r = self.webhook(order, amount=amount)
        self.assertEqual((r.status_code, r.json()["status"]), (200, "already_paid"))
        self.assertEqual(Payment.objects.count(), 1)
        b.refresh_from_db()
        self.assertEqual(b.status, S.CONFIRMED)

    def test_webhook_before_browser_verification(self):
        b, order, amount = self.start()
        self.webhook(order, amount=amount)
        self.fake.paid(order, amount=amount)
        r = self.verify(b, order, "pay_1")
        self.assertEqual((r.status_code, r.json()["status"]), (200, "CONFIRMED"))
        self.assertEqual(Payment.objects.count(), 1)

    def test_browser_verification_before_webhook(self):
        b, order, amount = self.start()
        self.fake.paid(order, amount=amount)
        self.verify(b, order, "pay_1")
        self.assertEqual(self.webhook(order, amount=amount).json()["status"], "already_paid")
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.verified_via), (S.CONFIRMED, "CHECKOUT"))

    def test_an_unknown_order_is_acknowledged_and_ignored(self):
        b, order, amount = self.start()
        r = self.webhook("order_unknown", amount=amount)
        self.assertEqual((r.status_code, r.json()["status"]), (200, "ignored"))
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_a_payment_for_one_order_never_confirms_another_booking(self):
        a, order_a, amount_a = self.start()
        c, order_c, amount_c = self.start(guest=self.other)
        self.webhook(order_a, amount=amount_a)
        a.refresh_from_db(), c.refresh_from_db()
        self.assertEqual((a.status, c.status), (S.CONFIRMED, S.PENDING))

    def test_amount_and_currency_mismatch_do_not_confirm(self):
        b, order, amount = self.start()
        self.assertEqual(self.webhook(order, amount=amount - 1).json()["status"], "ignored")
        self.assertEqual(self.webhook(order, amount=amount, currency="USD").json()["status"], "ignored")
        b.refresh_from_db()
        self.assertEqual(b.status, S.PENDING)

    def test_an_order_id_in_the_body_that_does_not_match_the_stored_order_is_not_applied(self):
        b, order, amount = self.start()
        self.assertEqual(self.webhook("order_other", amount=amount).json()["status"], "ignored")

    def test_a_late_webhook_marks_a_refund_and_never_confirms(self):
        b, order, amount = self.start()
        self.expire(b)
        r = self.webhook(order, amount=amount)
        self.assertEqual(r.json()["status"], "refund_required")
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status), (S.REFUND_REQUIRED, PS.REFUND_REQUIRED))
        self.assertEqual(self.webhook(order, amount=amount).json()["status"], "refund_required")  # duplicate: still no change
        b.refresh_from_db()
        self.assertEqual(b.status, S.REFUND_REQUIRED)

    def test_a_late_payment_does_not_block_the_dates(self):
        b, order, amount = self.start()
        self.expire(b)
        self.webhook(order, amount=amount)
        self.assertFalse(Booking.objects.holding().filter(pk=b.pk).exists())

    def test_payment_after_cancellation_needs_a_refund(self):
        b, order, amount = self.start()
        self.as_(self.guest).post(f"/api/bookings/{b.pk}/cancel/")
        self.webhook(order, amount=amount)
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status), (S.REFUND_REQUIRED, PS.REFUND_REQUIRED))

    def test_payment_failed_event_is_recorded_but_does_not_confirm_or_block_a_retry(self):
        b, order, amount = self.start()
        r = self.webhook(order, event="payment.failed", amount=amount, status="failed")
        self.assertEqual(r.status_code, 200)
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status), (S.PENDING, PS.FAILED))
        self.assertEqual(self.webhook(order, "pay_retry", amount=amount).json()["status"], "confirmed")

    def test_other_events_and_garbage_are_acknowledged(self):
        b, order, amount = self.start()
        self.assertEqual(self.webhook(order, event="refund.processed", amount=amount).json()["status"], "ignored")
        raw = b"not json"
        sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        r = self.client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(r.status_code, 200)

    def test_the_webhook_needs_no_login_and_no_csrf_token(self):
        b, order, amount = self.start()
        from rest_framework.test import APIClient

        client = APIClient(enforce_csrf_checks=True)
        raw = json.dumps({"event": "x"}).encode()
        sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        r = client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)
        self.assertEqual(r.status_code, 200)


class AbandonedPaymentTests(PaymentTestCase):
    def test_an_abandoned_payment_expires_and_frees_the_dates(self):
        b, order, _ = self.start()
        self.expire(b)
        self.assertEqual(services.booking_services.expire_stale(), 1)
        b.refresh_from_db()
        self.assertEqual((b.status, b.payment.status), (S.EXPIRED, PS.CREATED))
        # someone else can now book the same dates
        r = self.as_(self.other).post(
            "/api/bookings/",
            {"property": self.prop.pk, "check_in": str(b.check_in), "check_out": str(b.check_out), "guests_count": 2},
            format="json",
        )
        self.assertEqual(r.status_code, 201)


class PaymentSerializationTests(PaymentTestCase):
    def test_a_booking_shows_its_payment_status_and_expiry(self):
        b = self.booking()
        data = self.as_(self.guest).get(f"/api/bookings/{b.pk}/").json()
        self.assertEqual((data["payment_status"], data["status"]), (None, "PENDING"))
        self.assertIsNotNone(data["expires_at"])
        self.initiate(b)
        self.assertEqual(self.as_(self.guest).get(f"/api/bookings/{b.pk}/").json()["payment_status"], "CREATED")


class SimultaneousSettleTests(TransactionTestCase):
    """The browser's verify and Razorpay's webhook landing at the same instant still produce one confirmed payment."""

    @creds
    def test_concurrent_settlements_confirm_once(self):
        guest = make_user(Role.END_USER, verified=True)
        booking = make_booking(guest=guest, prop=make_property(owner=make_user(Role.HOST)))
        payment = Payment.objects.create(booking=booking, razorpay_order_id="order_c", amount_paise=900000)
        entity = {"id": "pay_c", "order_id": "order_c", "amount": 900000, "currency": "INR", "status": "captured"}
        results, barrier = [], threading.Barrier(4)

        def attempt(source):
            try:
                barrier.wait(timeout=10)
                results.append(services.settle("order_c", dict(entity), source))
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt, args=(s,)) for s in ("CHECKOUT", "WEBHOOK", "WEBHOOK", "CHECKOUT")]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        self.assertEqual(sorted(results), ["already_paid"] * 3 + ["confirmed"], results)
        booking.refresh_from_db()
        payment.refresh_from_db()
        self.assertEqual((booking.status, payment.status, Payment.objects.count()), (S.CONFIRMED, PS.PAID, 1))
