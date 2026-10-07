"""The only module that talks to Razorpay. Tests replace these functions; nothing else imports ``razorpay``."""

import hashlib
import hmac

import razorpay
from django.conf import settings
from razorpay.errors import BadRequestError, GatewayError, ServerError

from apps.core.exceptions import Conflict


class GatewayUnavailable(Conflict):
    status_code = 503
    default_detail = "The payment service is not available right now. Please try again shortly."
    default_code = "payment_unavailable"


def configured() -> bool:
    return bool(settings.RAZORPAY_KEY_ID and settings.RAZORPAY_KEY_SECRET)


def _client():
    if not configured():
        raise GatewayUnavailable("Online payment is not configured on this server.", code="payment_not_configured")
    client = razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))
    client.set_app_details({"title": "Bludhaven", "version": "1"})
    return client


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, timeout=settings.RAZORPAY_TIMEOUT_SECONDS, **kwargs)
    except (BadRequestError, GatewayError, ServerError, OSError) as exc:  # network errors are OSError (requests)
        raise GatewayUnavailable() from exc


def create_order(amount_paise: int, currency: str, receipt: str, notes: dict) -> dict:
    client = _client()
    return _call(client.order.create, {"amount": amount_paise, "currency": currency, "receipt": receipt, "notes": notes})


def fetch_payment(payment_id: str) -> dict:
    client = _client()
    return _call(client.payment.fetch, payment_id)


def capture_payment(payment_id: str, amount_paise: int, currency: str) -> dict:
    client = _client()
    return _call(client.payment.capture, payment_id, amount_paise, {"currency": currency})


def _hmac_ok(secret: str, message: bytes, signature: str) -> bool:
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def checkout_signature_valid(order_id: str, payment_id: str, signature: str) -> bool:
    """Razorpay signs ``order_id|payment_id`` with the key secret."""
    return _hmac_ok(settings.RAZORPAY_KEY_SECRET, f"{order_id}|{payment_id}".encode(), signature)


def webhook_signature_valid(raw_body: bytes, signature: str) -> bool:
    """Razorpay signs the exact raw request body with the webhook secret."""
    return _hmac_ok(settings.RAZORPAY_WEBHOOK_SECRET, raw_body, signature)
