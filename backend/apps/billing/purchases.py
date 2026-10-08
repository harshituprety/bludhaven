"""Self-serve Host billing: buy or change a plan, top up the wallet, cancel, and the daily lifecycle.

Money is handled in **paise** (integers). A plan's ``price`` is rupees (Decimal) and is converted once, here.

How a plan purchase works
-------------------------
``quote`` works out what a purchase would be, ``checkout`` fixes it and creates the Razorpay order, and the order is
settled by exactly one of two doors: the browser's verify call and Razorpay's webhook. ``settle`` is idempotent and
row-locked, so they can arrive in either order, twice, or only one of them, with the same result.

* NEW / TRIAL / CHANGE start today. A CHANGE ends the Host's current (and any queued) subscription at once and gives
  the value of the unused, paid time back as a wallet credit (pro rata by day), which is then spent on the new plan.
* RENEWAL of the same plan queues the next period right after the current one (or starts today if it already lapsed),
  so paying early never wastes days.
* The wallet (credit + balance) pays first; only the rest goes to Razorpay. If nothing is left to charge, the plan is
  activated straight away with no gateway call. A remainder under 1 rupee is absorbed (Razorpay's minimum order is
  1 rupee).
* Payment valid but the purchase can no longer be applied (the wallet no longer covers its share, or the order had been
  replaced by a newer checkout)  ->  REFUND_REQUIRED, nothing applied; refunded by hand in the Razorpay dashboard.
  There are no automatic refunds.

Lock order (to rule out deadlocks): Host user row, then the payment row, then the wallet row.
"""

import logging
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import transaction
from django.http import Http404
from django.utils import timezone

from apps.accounts.models import User
from apps.core.exceptions import Conflict
from apps.payments import gateway

from . import limits
from .models import BillingPayment, HostWallet, Subscription, SubscriptionPlan, WalletTransaction

logger = logging.getLogger(__name__)
BP, S, WT = BillingPayment, Subscription.Status, WalletTransaction.Kind
CURRENCY = "INR"
MIN_CHARGE_PAISE = 100  # Razorpay will not create an order below 1 rupee

# Outcomes of settle()
APPLIED, ALREADY_PAID, REFUND_REQUIRED, IGNORED = "applied", "already_paid", "refund_required", "ignored"


def to_paise(amount: Decimal) -> int:
    return int((Decimal(amount) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_rupees(paise: int) -> Decimal:
    return (Decimal(paise) / 100).quantize(Decimal("0.01"))


# --- wallet -----------------------------------------------------------------------------------------------------------


def wallet_for(user, lock=False) -> HostWallet:
    wallet, _ = HostWallet.objects.get_or_create(user=user)
    return HostWallet.objects.select_for_update().get(pk=wallet.pk) if lock else wallet


def balance_of(user) -> int:
    return HostWallet.objects.filter(user=user).values_list("balance_paise", flat=True).first() or 0


def _post(wallet, kind, amount, description, *, payment=None, subscription=None, created_by=None):
    """Add one ledger line and move the balance. ``wallet`` must be locked by the caller."""
    new_balance = wallet.balance_paise + amount
    if new_balance < 0:
        raise Conflict("The wallet does not hold enough for this.", code="insufficient_wallet")
    tx = WalletTransaction.objects.create(
        wallet=wallet, user=wallet.user, kind=kind, amount_paise=amount, balance_after_paise=new_balance,
        description=description[:200], billing_payment=payment, subscription=subscription, created_by=created_by,
    )
    wallet.balance_paise = new_balance
    wallet.save(update_fields=["balance_paise", "updated_at"])
    return tx


def adjust_wallet(admin, user, amount_paise, reason):
    """Super Admin: add (positive) or take (negative) money, with a reason that appears on the Host's statement."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        wallet = wallet_for(user, lock=True)
        kind = WT.ADMIN_CREDIT if amount_paise > 0 else WT.ADMIN_DEBIT
        return _post(wallet, kind, amount_paise, reason, created_by=admin)


# --- quote ------------------------------------------------------------------------------------------------------------


def _unused_credit_paise(sub, today):
    """Pro-rata value (by whole days) of the paid time that is left on ``sub``; 0 for anything that was not paid for."""
    if sub.status != S.ACTIVE or sub.payment_status != Subscription.PaymentStatus.PAID:
        return 0
    paid = to_paise(sub.amount)
    if sub.start_date > today:  # a queued renewal: nothing of it has been used
        return paid
    total = (sub.expiry_date - sub.start_date).days
    remaining = max((sub.expiry_date - today).days, 0)
    return paid * remaining // total if total else 0


def _is_downgrade(previous, plan, today):
    """True when ``plan`` is cheaper (per day) than the paid period the Host is in the middle of.

    Only a paid, running ACTIVE period can be downgraded later: its remaining time has already been paid for at the
    higher price, so the cheaper plan is scheduled for when that time is up instead of replacing it now. Anything else
    (a trial, a lapsed period) changes immediately, as before.
    """
    if previous is None or plan.is_trial or previous.status != S.ACTIVE or previous.payment_status != Subscription.PaymentStatus.PAID:
        return False
    if not (previous.start_date <= today < previous.expiry_date):
        return False
    current = previous.plan
    return plan.price * current.duration_days < current.price * plan.duration_days


def scheduled_change(user):
    """The paid, not-yet-started period of a *different* plan queued behind the current one (a scheduled downgrade), or None."""
    t = limits.today()
    current = limits.current_subscription(user)
    queued = Subscription.objects.select_related("plan").filter(user=user, status=S.ACTIVE, start_date__gt=t).order_by("start_date", "id")
    if current is not None:
        queued = queued.exclude(plan_id=current.plan_id)
    return queued.first()


def quote(user, plan, use_wallet=True) -> dict:
    """What buying ``plan`` would be for ``user`` right now. Raises Conflict for a purchase that cannot happen."""
    t = limits.today()
    if not plan.is_active:
        raise Conflict("This plan is no longer offered.", code="plan_inactive")
    price = to_paise(plan.price)
    previous = limits.current_subscription(user)

    if plan.is_trial:
        if Subscription.objects.filter(user=user, plan__is_trial=True).exists():
            raise Conflict("You have already used your free trial.", code="trial_used")
        if previous is not None:
            raise Conflict("A free trial can only be started by a Host without a subscription.", code="trial_unavailable")
        kind, credit = BP.Kind.TRIAL, 0
    elif previous is None:
        kind, credit = BP.Kind.NEW, 0
    elif previous.plan_id == plan.id and previous.status in (S.ACTIVE, S.PAST_DUE):
        if Subscription.objects.filter(user=user, status=S.ACTIVE, start_date__gt=t).exists():
            raise Conflict("Your next period is already paid for.", code="renewal_already_queued")
        kind, credit = BP.Kind.RENEWAL, 0
    elif _is_downgrade(previous, plan, t):
        if Subscription.objects.filter(user=user, status=S.ACTIVE, start_date__gt=t).exists():
            raise Conflict(
                "A plan change or renewal is already scheduled. Cancel it first if you want to schedule a different one.",
                code="change_already_scheduled",
            )
        kind, credit = BP.Kind.DOWNGRADE, 0  # nothing is credited: the current plan keeps running, already paid for
    else:
        kind = BP.Kind.CHANGE
        rows = Subscription.objects.filter(user=user, status__in=Subscription.ENTITLING, expiry_date__gt=t)
        credit = sum(_unused_credit_paise(r, t) for r in rows)

    if kind in (BP.Kind.RENEWAL, BP.Kind.DOWNGRADE) and previous.status == S.ACTIVE and previous.expiry_date > t:
        start = previous.expiry_date
    else:
        start = t

    balance = balance_of(user)
    wallet_paise = min(price, credit + (balance if use_wallet else 0))
    charge = price - wallet_paise
    if 0 < charge < MIN_CHARGE_PAISE:
        charge = 0  # absorbed: under the gateway's minimum
    return {
        "kind": kind, "plan": plan, "previous": previous,
        "price_paise": price, "credit_paise": credit, "wallet_paise": wallet_paise, "amount_paise": charge,
        "wallet_balance_paise": balance, "start_date": start, "expiry_date": start + timedelta(days=plan.duration_days),
        "blockers": limits.plan_blockers(user, plan),
    }


# --- checkout ---------------------------------------------------------------------------------------------------------


def _checkout_payload(payment, description):
    return {
        "key_id": settings.RAZORPAY_KEY_ID,  # the public key; the secret never leaves the server
        "order_id": payment.razorpay_order_id,
        "amount": payment.amount_paise,
        "currency": payment.currency,
        "payment_id": payment.pk,
        "name": "Blüdhaven",
        "description": description,
    }


def _new_order(user, **fields):
    """Create the BillingPayment row and its Razorpay order, replacing any open checkout of the same purpose."""
    purpose = fields["purpose"]
    defaults = {"kind": "", "plan": None, "previous_subscription": None, "price_paise": 0, "credit_paise": 0, "wallet_paise": 0}
    same = {k: fields.get(k, defaults.get(k)) for k in ("purpose", "kind", "plan", "previous_subscription", "price_paise", "credit_paise", "wallet_paise", "amount_paise")}
    open_orders = list(BP.objects.select_for_update().filter(user=user, purpose=purpose, status=BP.Status.CREATED))
    for old in open_orders:
        if all(getattr(old, k) == v for k, v in same.items()):
            return old  # a double click or a retry gets the same order
    for old in open_orders:
        old.status = BP.Status.SUPERSEDED
        old.save(update_fields=["status", "updated_at"])
    payment = BP.objects.create(user=user, **fields)
    order = gateway.create_order(
        payment.amount_paise, CURRENCY, f"bill-{payment.pk}",
        {"payment_id": str(payment.pk), "user_id": str(user.pk), "purpose": purpose},
    )
    payment.razorpay_order_id = order["id"]
    payment.save(update_fields=["razorpay_order_id", "updated_at"])
    return payment


def checkout(user, plan_id, use_wallet=True) -> dict:
    """Start buying a plan. Returns ``{"status": "activated", "subscription"}`` when no gateway charge is needed,
    otherwise ``{"status": "payment_required", ...}`` with what Razorpay Checkout needs."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        plan = SubscriptionPlan.objects.filter(pk=plan_id).first()
        if plan is None:
            raise Http404
        q = quote(user, plan, use_wallet)
        if q["blockers"]:
            raise Conflict(" ".join(q["blockers"]) + " Remove some first, or choose a bigger plan.", code="usage_exceeds_plan")
        fields = dict(
            purpose=BP.Purpose.SUBSCRIPTION, kind=q["kind"], plan=plan, previous_subscription=q["previous"],
            price_paise=q["price_paise"], credit_paise=q["credit_paise"], wallet_paise=q["wallet_paise"], amount_paise=q["amount_paise"],
        )
        if q["amount_paise"] == 0:
            # Activated without the gateway: any Razorpay order still open for an earlier quote is now out of date.
            BP.objects.filter(user=user, purpose=BP.Purpose.SUBSCRIPTION, status=BP.Status.CREATED).update(
                status=BP.Status.SUPERSEDED, updated_at=timezone.now()
            )
            payment = BP.objects.create(user=user, **fields)
            if _apply(payment, BP.Source.WALLET, None) != APPLIED:  # pragma: no cover - the wallet was read under the same lock
                raise Conflict("Your wallet no longer covers this purchase. Please try again.", code="insufficient_wallet")
            return {"status": "activated", "subscription": payment.subscription, "payment": payment}
        payment = _new_order(user, **fields)
        payload = _checkout_payload(payment, f"{plan.name} plan")
    return {"status": "payment_required", "payment": payment, **payload}


def start_topup(user, rupees: int) -> dict:
    paise = rupees * 100
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        payment = _new_order(user, purpose=BP.Purpose.TOPUP, amount_paise=paise)
        return _checkout_payload(payment, "Wallet top-up")


# --- settle -----------------------------------------------------------------------------------------------------------


def _mark_paid(payment, status, source, entity):
    payment.status = status
    payment.verified_via = source
    payment.paid_at = timezone.now()
    if entity:
        payment.razorpay_payment_id = entity.get("id")
    payment.save()


def _quote_is_stale(payment, rows, today) -> bool:
    """A Razorpay order stays payable long after checkout. Its price was fixed against the Host's subscription at that
    moment, so apply it only if that situation still holds; otherwise it would double-count, or over-count, credit.

    * NEW: the Host must still have no running subscription (an admin may have assigned one, or another purchase went through).
    * CHANGE: the unused paid time that was credited must be exactly what it is now (a later day, or a changed
      subscription, means a different credit).
    A refused payment is parked as REFUND_REQUIRED, like any other payment that cannot be applied.
    """
    if payment.kind == BP.Kind.NEW:
        return limits.current_subscription(payment.user) is not None
    if payment.kind == BP.Kind.CHANGE:
        live = [r for r in rows if r.expiry_date > today]
        return sum(_unused_credit_paise(r, today) for r in live) != payment.credit_paise
    return False


def _apply(payment, source, entity) -> str:
    """Turn a valid payment into its effect. Runs inside the caller's transaction with the Host's user row locked."""
    wallet = wallet_for(payment.user, lock=True)
    if payment.purpose == BP.Purpose.TOPUP:
        _post(wallet, WT.TOPUP, payment.amount_paise, "Wallet top-up", payment=payment)
        _mark_paid(payment, BP.Status.PAID, source, entity)
        return APPLIED

    if wallet.balance_paise < payment.wallet_paise - payment.credit_paise:  # the wallet no longer covers its share
        logger.error("Billing payment %s: wallet too low to apply it; refund required", payment.pk)
        _mark_paid(payment, BP.Status.REFUND_REQUIRED, source, entity)
        return REFUND_REQUIRED

    plan, user, now, t = payment.plan, payment.user, timezone.now(), limits.today()
    rows = list(Subscription.objects.select_for_update().filter(user=user, status__in=Subscription.ENTITLING))
    if _quote_is_stale(payment, rows, t):
        logger.error("Billing payment %s: the Host's subscription changed since checkout; not applied, refund required", payment.pk)
        _mark_paid(payment, BP.Status.REFUND_REQUIRED, source, entity)
        return REFUND_REQUIRED
    previous = next((r for r in rows if r.pk == payment.previous_subscription_id), None)
    start = t
    if payment.kind in (BP.Kind.RENEWAL, BP.Kind.DOWNGRADE) and previous is not None:
        if previous.status == S.ACTIVE and previous.expiry_date > t:
            start = previous.expiry_date  # queued right after the current period
            previous.cancel_at_period_end, previous.cancelled_at, previous.cancellation_reason = False, None, ""
        else:
            previous.status = S.EXPIRED  # it had lapsed: the new period starts today
        previous.save()
    elif payment.kind == BP.Kind.CHANGE:
        for row in rows:
            row.status, row.cancelled_at, row.cancel_at_period_end = S.CANCELLED, now, False
            row.cancellation_reason = "plan_changed"
            if row.start_date < t < row.expiry_date:
                row.expiry_date = t  # the unused part was credited to the wallet
            row.save()

    sub = Subscription.objects.create(
        user=user, plan=plan, status=S.TRIAL if payment.kind == BP.Kind.TRIAL else S.ACTIVE, amount=to_rupees(payment.price_paise),
        payment_status=Subscription.PaymentStatus.PAID, start_date=start, expiry_date=start + timedelta(days=plan.duration_days),
        previous_subscription=previous,
    )
    if payment.credit_paise:
        old = previous.plan.name if previous else "your previous plan"
        _post(wallet, WT.PRORATION_CREDIT, payment.credit_paise, f"Credit for unused time on {old}", payment=payment, subscription=previous)
    if payment.wallet_paise:
        _post(wallet, WT.SUBSCRIPTION_PAYMENT, -payment.wallet_paise, f"{plan.name} plan", payment=payment, subscription=sub)
    payment.subscription = sub
    _mark_paid(payment, BP.Status.PAID, source, entity)
    return APPLIED


def settle(order_id, entity, source):
    """Apply one Razorpay payment (``entity``: the payment object as Razorpay returns it) to its billing order.

    Returns None when ``order_id`` is not a billing order at all (the webhook then tries booking payments)."""
    peek = BP.objects.filter(razorpay_order_id=order_id).values_list("user_id", flat=True).first()
    if peek is None:
        return None
    payment_id = entity.get("id")
    with transaction.atomic():
        User.objects.select_for_update().get(pk=peek)
        payment = BP.objects.select_for_update().select_related("plan", "user").get(razorpay_order_id=order_id)
        if (
            not payment_id
            or entity.get("order_id") != payment.razorpay_order_id
            or entity.get("amount") != payment.amount_paise
            or entity.get("currency") != payment.currency
            or entity.get("status") != "captured"
        ):
            logger.error("Razorpay payment %s does not match billing order %s; not applied", payment_id, order_id)
            return IGNORED
        if payment.status in (BP.Status.PAID, BP.Status.REFUND_REQUIRED):
            if payment.razorpay_payment_id != payment_id:
                logger.error("Billing order %s was paid twice (%s, then %s): the second needs a manual refund", order_id, payment.razorpay_payment_id, payment_id)
            return ALREADY_PAID if payment.status == BP.Status.PAID else REFUND_REQUIRED
        if payment.status == BP.Status.SUPERSEDED:  # paid after a newer checkout replaced it: never applied
            logger.warning("Billing order %s was replaced before it was paid: refund required", order_id)
            _mark_paid(payment, BP.Status.REFUND_REQUIRED, source, entity)
            return REFUND_REQUIRED
        return _apply(payment, source, entity)


def verify_checkout(user, order_id, payment_id, signature):
    """The browser says it paid. Trust nothing it sent: check the signature, then ask Razorpay what really happened."""
    payment = BP.objects.filter(user=user, razorpay_order_id=order_id).first()
    if payment is None:
        raise Http404
    if not gateway.checkout_signature_valid(order_id, payment_id, signature):
        raise Conflict("The payment could not be verified.", code="invalid_signature")
    if payment.status == BP.Status.PAID and payment.razorpay_payment_id == payment_id:
        return ALREADY_PAID
    entity = gateway.fetch_payment(payment_id)
    if entity.get("status") == "authorized":
        entity = gateway.capture_payment(payment_id, payment.amount_paise, payment.currency)
    if entity.get("status") == "failed":
        raise Conflict("The payment failed. You can try again.", code="payment_failed")
    if entity.get("order_id") != payment.razorpay_order_id:
        raise Conflict("That payment belongs to a different order.", code="order_mismatch")
    if entity.get("currency") != payment.currency:
        raise Conflict("The payment currency does not match.", code="currency_mismatch")
    if entity.get("amount") != payment.amount_paise:
        raise Conflict("The payment amount does not match.", code="amount_mismatch")
    if entity.get("status") != "captured":
        raise Conflict("The payment has not been completed.", code="payment_incomplete")
    return settle(order_id, entity, BP.Source.CHECKOUT)


def note_failure(order_id):
    """Webhook ``payment.failed``: remember it. The order stays open, so a retry in Checkout can still succeed."""
    BP.objects.filter(razorpay_order_id=order_id, status=BP.Status.CREATED).update(status=BP.Status.FAILED, updated_at=timezone.now())


# --- cancel / resume --------------------------------------------------------------------------------------------------


def cancel(user) -> Subscription:
    """The Host cancels. A running period stays usable to its end and is not renewed; a renewal that was already paid
    but not yet started is cancelled now and its price goes back to the wallet; a PAST_DUE one ends now."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        now, t = timezone.now(), limits.today()
        rows = list(Subscription.objects.select_for_update().filter(user=user, status__in=Subscription.ENTITLING).order_by("start_date"))
        current = limits.current_subscription(user)
        if current is None:
            raise Conflict("You have no subscription to cancel.", code="no_subscription")
        for row in rows:
            if row.start_date > t:  # queued and already paid: give the money back as wallet credit
                credit = _unused_credit_paise(row, t)
                row.status, row.cancelled_at, row.cancellation_reason = S.CANCELLED, now, "host_cancelled"
                row.save()
                if credit:
                    _post(wallet_for(user, lock=True), WT.PRORATION_CREDIT, credit, f"Credit for the cancelled {row.plan.name} renewal", subscription=row)
        current = Subscription.objects.select_for_update().get(pk=current.pk)
        if current.status == S.PAST_DUE:
            current.status = S.CANCELLED
        current.cancel_at_period_end, current.cancelled_at, current.cancellation_reason = True, now, "host_cancelled"
        current.save()
        return current


def cancel_scheduled_change(user) -> Subscription:
    """Call off a scheduled downgrade. The current plan carries on untouched and what was paid for the queued period
    goes back to the wallet."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        queued = scheduled_change(user)
        if queued is None:
            raise Conflict("There is no scheduled plan change to cancel.", code="nothing_scheduled")
        queued = Subscription.objects.select_for_update().get(pk=queued.pk)
        now, t = timezone.now(), limits.today()
        credit = _unused_credit_paise(queued, t)
        queued.status, queued.cancelled_at, queued.cancellation_reason = S.CANCELLED, now, "scheduled_change_cancelled"
        queued.save()
        if credit:
            _post(wallet_for(user, lock=True), WT.PRORATION_CREDIT, credit, f"Credit for the cancelled {queued.plan.name} plan change", subscription=queued)
        return limits.current_subscription(user)


def resume(user) -> Subscription:
    """Undo a cancellation that has not taken effect yet."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.pk)
        current = limits.current_subscription(user)
        if current is None or not current.cancel_at_period_end:
            raise Conflict("There is no pending cancellation to undo.", code="not_cancelling")
        current = Subscription.objects.select_for_update().get(pk=current.pk)
        current.cancel_at_period_end, current.cancelled_at, current.cancellation_reason = False, None, ""
        current.save()
        return current


# --- lifecycle (run daily) --------------------------------------------------------------------------------------------


def process_lifecycle(today=None) -> dict:
    """Move subscriptions through their states. Safe to run any number of times.

    * period over + a paid successor already running  -> EXPIRED
    * period over + Host cancelled                    -> CANCELLED
    * period over, a TRIAL                            -> EXPIRED
    * period over, ACTIVE                             -> PAST_DUE with ``grace_until`` = expiry + SUBSCRIPTION_GRACE_DAYS
    * PAST_DUE and the grace period is over           -> EXPIRED
    """
    t = today or limits.today()
    grace = timedelta(days=settings.SUBSCRIPTION_GRACE_DAYS)
    counts = {"past_due": 0, "expired": 0, "cancelled": 0}

    def running_successor(sub):
        return Subscription.objects.filter(user_id=sub.user_id, status__in=[S.ACTIVE, S.TRIAL], start_date__lte=t, expiry_date__gt=t).exists()

    ended = Subscription.objects.filter(status__in=[S.ACTIVE, S.TRIAL], expiry_date__lte=t).values_list("pk", flat=True)
    for pk in list(ended):
        with transaction.atomic():
            sub = Subscription.objects.select_for_update().get(pk=pk)
            if sub.status not in (S.ACTIVE, S.TRIAL) or sub.expiry_date > t:
                continue
            if running_successor(sub):
                sub.status = S.EXPIRED
                counts["expired"] += 1
            elif sub.cancel_at_period_end:
                sub.status = S.CANCELLED
                counts["cancelled"] += 1
            elif sub.status == S.TRIAL:
                sub.status = S.EXPIRED
                counts["expired"] += 1
            else:
                sub.status, sub.grace_until = S.PAST_DUE, sub.expiry_date + grace
                counts["past_due"] += 1
                if sub.grace_until < t:  # the job did not run for a while
                    sub.status = S.EXPIRED
                    counts["expired"] += 1
            sub.save()

    for pk in list(Subscription.objects.filter(status=S.PAST_DUE).values_list("pk", flat=True)):
        with transaction.atomic():
            sub = Subscription.objects.select_for_update().get(pk=pk)
            if sub.status == S.PAST_DUE and ((sub.grace_until and sub.grace_until < t) or running_successor(sub)):
                sub.status = S.EXPIRED
                sub.save()
                counts["expired"] += 1
    return counts
