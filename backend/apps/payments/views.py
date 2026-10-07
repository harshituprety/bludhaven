import json
import logging

from django.http import Http404
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsEmailVerified, IsEndUser
from apps.bookings.models import Booking
from apps.bookings.serializers import BookingSerializer
from apps.core.exceptions import Conflict
from apps.core.throttling import PaymentRateThrottle

from apps.billing import purchases as billing

from . import gateway, services
from .serializers import VerifyPaymentSerializer

logger = logging.getLogger(__name__)


class _GuestPaymentView(APIView):
    permission_classes = [IsAuthenticated, IsEndUser, IsEmailVerified]
    throttle_classes = [PaymentRateThrottle]


class InitiatePaymentView(_GuestPaymentView):
    """``POST /api/bookings/{id}/payment/``: create (or reuse) the Razorpay order for the guest's own PENDING booking."""

    def post(self, request, pk):
        return Response(services.initiate(pk, request.user))


class VerifyPaymentView(_GuestPaymentView):
    """``POST /api/bookings/{id}/payment/verify/``: the browser reports a finished Checkout; the server checks it."""

    def post(self, request, pk):
        data = VerifyPaymentSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        outcome = services.verify_checkout(
            pk,
            request.user,
            data.validated_data["razorpay_order_id"],
            data.validated_data["razorpay_payment_id"],
            data.validated_data["razorpay_signature"],
        )
        if outcome == services.REFUND_REQUIRED:
            raise Conflict(
                "Your payment arrived after the booking expired, so the booking was not confirmed. "
                "It will be refunded; please contact Customer Care if you do not see the refund.",
                code="payment_after_expiry",
            )
        if outcome == services.IGNORED:  # pragma: no cover - verify_checkout checks everything settle checks
            raise Conflict("The payment could not be applied.", code="payment_not_applied")
        booking = Booking.objects.select_related("property__destination", "property__owner", "guest", "review", "payment").get(pk=pk)
        return Response(BookingSerializer(booking, context={"request": request}).data)


class RazorpayWebhookView(APIView):
    """``POST /api/payments/razorpay/webhook/``: called by Razorpay, not by a browser.

    Authenticated only by the signature over the raw body. A valid delivery is always answered 200 (even when it is
    ignored) so Razorpay does not retry for ever; a bad signature is a 400.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = []

    def post(self, request):
        raw = request.body
        if not gateway.webhook_signature_valid(raw, request.headers.get("X-Razorpay-Signature", "")):
            return Response({"error": {"code": "invalid_signature", "message": "Invalid signature."}}, status=status.HTTP_400_BAD_REQUEST)
        try:
            event = json.loads(raw)
            name = event["event"]
            payload = event.get("payload", {})
            entity = payload.get("payment", {}).get("entity")
        except (ValueError, KeyError, AttributeError):
            return Response({"status": "ignored"})
        if not isinstance(entity, dict):
            return Response({"status": "ignored"})
        order_id = entity.get("order_id")
        if name in ("payment.captured", "order.paid"):
            # A Host plan purchase or wallet top-up, if the order is one of those; otherwise a guest booking.
            outcome = billing.settle(order_id, entity, billing.BP.Source.WEBHOOK)
            if outcome is None:
                outcome = services.settle(order_id, entity, services.Payment.Source.WEBHOOK)
        elif name == "payment.failed":
            billing.note_failure(order_id)
            services.note_failure(order_id, entity)
            outcome = "noted"
        else:
            outcome = services.IGNORED
        return Response({"status": outcome})
