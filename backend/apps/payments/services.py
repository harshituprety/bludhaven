"""Guest booking payment: create the order, verify the payment, and settle it exactly once.

The server alone decides the amount (``Booking.total_price``, in paise) and whether a payment counts. Two doors lead
to ``settle``: the browser's verify call and Razorpay's webhook. They can arrive in either order, twice, or only one
of them; ``settle`` is idempotent and row-locked, so the outcome is the same:

* payment valid and the booking is still PENDING inside its window  -> booking CONFIRMED, payment PAID
* payment valid but the booking already expired/was cancelled      -> booking and payment REFUND_REQUIRED
  (never revived; refunded by hand in the Razorpay dashboard, no automatic refunds)
* payment for a different amount/currency/order                    -> nothing changes, nothing is confirmed
"""

import logging
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.bookings import services as booking_services
from apps.bookings.models import Booking
from apps.core.exceptions import Conflict

from . import gateway
from .models import Payment

logger = logging.getLogger(__name__)
BS = Booking.Status
PS = Payment.Status
CURRENCY = "INR"

# Outcomes of settle()
CONFIRMED, ALREADY_PAID, REFUND_REQUIRED, IGNORED = "confirmed", "already_paid", "refund_required", "ignored"


def to_paise(amount: Decimal) -> int:
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _lock_booking(booking_id, guest=None):
    qs = Booking.objects.select_for_update().select_related("property")
    return qs.get(pk=booking_id, guest=guest) if guest else qs.get(pk=booking_id)


def _refuse_if_not_payable(booking):
    if booking.status == BS.CONFIRMED:
        raise Conflict("This booking is already paid.", code="already_paid")
    if booking.status == BS.PENDING and booking.expires_at and booking.expires_at > timezone.now():
        return
    if booking.status in (BS.PENDING, BS.EXPIRED, BS.REFUND_REQUIRED):  # PENDING here means the window is over
        raise Conflict("The payment window for this booking has ended. Please book again.", code="booking_expired")
    raise Conflict("This booking can no longer be paid.", code="booking_not_payable")


def initiate(booking_id, guest) -> dict:
    """Create (or reuse) the Razorpay order for a PENDING booking and return what Checkout needs.

    Calling it again for the same booking returns the same order, so a double click or a retry never creates two.
    """
    try:
        return _initiate(booking_id, guest)
    except Conflict as exc:
        if exc.get_codes() == "booking_expired":
            booking_services.expire_stale()  # outside the failed transaction, so the sweep is kept
        raise


def _initiate(booking_id, guest) -> dict:
    with transaction.atomic():
        try:
            booking = _lock_booking(booking_id, guest)
        except Booking.DoesNotExist:
            from django.http import Http404

            raise Http404
        _refuse_if_not_payable(booking)
        payment = Payment.objects.filter(booking=booking).first()
        if payment is None:
            amount = to_paise(booking.total_price)
            order = gateway.create_order(
                amount, CURRENCY, f"booking-{booking.pk}", {"booking_id": str(booking.pk), "guest_id": str(booking.guest_id)}
            )
            try:
                with transaction.atomic():
                    payment = Payment.objects.create(
                        booking=booking, razorpay_order_id=order["id"], amount_paise=amount, currency=CURRENCY
                    )
            except IntegrityError:  # pragma: no cover - the booking row lock already serialises this
                payment = Payment.objects.get(booking=booking)
        elif payment.status == PS.PAID:
            raise Conflict("This booking is already paid.", code="already_paid")
    return {
        "key_id": settings.RAZORPAY_KEY_ID,  # the public key; the secret never leaves the server
        "order_id": payment.razorpay_order_id,
        "amount": payment.amount_paise,
        "currency": payment.currency,
        "booking_id": booking.pk,
        "expires_at": booking.expires_at,
        "name": "Blüdhaven",
        "description": f"{booking.property.title}, {booking.check_in:%d %b} to {booking.check_out:%d %b %Y}",
    }


def settle(order_id, payment_entity, source) -> str:
    """Apply one Razorpay payment (``payment_entity``: the payment object as Razorpay returns it) to its booking."""
    payment_id = payment_entity.get("id")
    with transaction.atomic():
        payment = Payment.objects.select_for_update().filter(razorpay_order_id=order_id).first()
        if payment is None:
            logger.warning("Razorpay payment %s is for an unknown order %s; ignored", payment_id, order_id)
            return IGNORED
        booking = Booking.objects.select_for_update().get(pk=payment.booking_id)

        # The payment must be exactly what we asked for. Anything else is never confirmed.
        if (
            not payment_id
            or payment_entity.get("order_id") != payment.razorpay_order_id
            or payment_entity.get("amount") != payment.amount_paise
            or payment_entity.get("currency") != payment.currency
            or payment_entity.get("status") != "captured"
        ):
            logger.error("Razorpay payment %s does not match order %s; not applied", payment_id, order_id)
            return IGNORED

        if payment.status in (PS.PAID, PS.REFUND_REQUIRED):
            if payment.razorpay_payment_id != payment_id:
                logger.error("Order %s was paid twice (%s, then %s): the second needs a manual refund", order_id, payment.razorpay_payment_id, payment_id)
            return ALREADY_PAID if payment.status == PS.PAID else REFUND_REQUIRED

        now = timezone.now()
        was = booking.status
        payment.razorpay_payment_id = payment_id
        payment.verified_via = source
        payment.paid_at = now
        if booking.status == BS.PENDING and booking.expires_at and booking.expires_at > now:
            payment.status, booking.status = PS.PAID, BS.CONFIRMED
            outcome = CONFIRMED
        else:
            payment.status, booking.status = PS.REFUND_REQUIRED, BS.REFUND_REQUIRED
            outcome = REFUND_REQUIRED
            logger.warning("Payment %s arrived for booking %s in state %s: refund required", payment_id, booking.pk, was)
        payment.save()
        booking.save(update_fields=["status", "updated_at"])
        return outcome


def verify_checkout(booking_id, guest, order_id, payment_id, signature) -> str:
    """The browser says it paid. Trust nothing it sent: check the signature, then ask Razorpay what really happened."""
    payment = Payment.objects.filter(booking_id=booking_id, booking__guest=guest).first()
    if payment is None:
        from django.http import Http404

        raise Http404
    if order_id != payment.razorpay_order_id:
        raise Conflict("That payment belongs to a different order.", code="order_mismatch")
    if not gateway.checkout_signature_valid(order_id, payment_id, signature):
        raise Conflict("The payment could not be verified.", code="invalid_signature")
    if payment.status == PS.PAID and payment.razorpay_payment_id == payment_id:
        return ALREADY_PAID  # a repeat of a verification that already succeeded (or the webhook got there first)

    entity = gateway.fetch_payment(payment_id)
    if entity.get("status") == "authorized":  # capture is automatic on most accounts; do it ourselves if not
        entity = gateway.capture_payment(payment_id, payment.amount_paise, payment.currency)
    if entity.get("status") == "failed":
        raise Conflict("The payment failed. You can try again while the booking is held.", code="payment_failed")
    if entity.get("order_id") != payment.razorpay_order_id:
        raise Conflict("That payment belongs to a different order.", code="order_mismatch")
    if entity.get("currency") != payment.currency:
        raise Conflict("The payment currency does not match the booking.", code="currency_mismatch")
    if entity.get("amount") != payment.amount_paise:
        raise Conflict("The payment amount does not match the booking.", code="amount_mismatch")
    if entity.get("status") != "captured":
        raise Conflict("The payment has not been completed.", code="payment_incomplete")
    return settle(order_id, entity, Payment.Source.CHECKOUT)


def note_failure(order_id, payment_entity):
    """Webhook ``payment.failed``: remember it. The order stays open, so a retry in Checkout can still succeed."""
    Payment.objects.filter(razorpay_order_id=order_id, status=PS.CREATED).update(status=PS.FAILED, updated_at=timezone.now())
