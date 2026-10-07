"""Booking rules in one place: availability, price, and the status workflow.

Workflow (only these moves exist; CANCELLED, COMPLETED, EXPIRED and REFUND_REQUIRED are final)::

    (create)  --------------> PENDING     awaiting payment; holds the dates for BOOKING_PAYMENT_WINDOW_MINUTES
    PENDING   --payment------> CONFIRMED   ONLY a verified Razorpay payment inside the window (apps/payments); nobody
                                           can confirm a booking by hand, not even a Super Admin
    PENDING   --window ends--> EXPIRED     no verified payment in time; the dates are free again
    EXPIRED   --late payment-> REFUND_REQUIRED   money arrived after the booking expired; it is never revived
    PENDING   --cancel-------> CANCELLED   the guest, the property's Host (decline), or a Super Admin
    CONFIRMED --cancel-------> CANCELLED   the guest, the property's Host, or a Super Admin
    CONFIRMED --complete-----> COMPLETED   the property's Host or a Super Admin, once check-out has passed

A CONFIRMED booking, or a PENDING one whose ``expires_at`` is still in the future, holds its dates (see
``BookingQuerySet.holding``). Check-out day is free for the next guest.
"""

from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.accounts.models import Role
from apps.catalog.models import Property
from apps.core.exceptions import Conflict

from .models import Booking

S = Booking.Status

# action -> (statuses it may start from, status it ends in)
# There is deliberately no "confirm": only a verified payment confirms a booking (apps/payments).
TRANSITIONS = {
    "cancel": ({S.PENDING, S.CONFIRMED}, S.CANCELLED),
    "complete": ({S.CONFIRMED}, S.COMPLETED),
}
HOST_ONLY_ACTIONS = {"complete"}  # the guest may only cancel


def today() -> date:
    return timezone.localdate()


def payment_window() -> timedelta:
    return timedelta(minutes=settings.BOOKING_PAYMENT_WINDOW_MINUTES)


def price_for(prop, check_in, check_out):
    """``(nights, total)`` worked out from the property's current nightly rate. The one place a price is computed."""
    nights = (check_out - check_in).days
    return nights, prop.price_per_night * Decimal(nights)


def expire_stale(now=None) -> int:
    """Mark unpaid bookings whose window has passed as EXPIRED. Returns how many.

    Safe to call at any time and from many places: the availability queries already ignore an expired hold, so this
    only keeps the stored status truthful (and is what turns a late payment into REFUND_REQUIRED).
    """
    now = now or timezone.now()
    return (
        Booking.objects.filter(status=S.PENDING)
        .filter(Q(expires_at__lte=now) | Q(expires_at__isnull=True))
        .update(status=S.EXPIRED, updated_at=now)
    )


def overlapping(prop, check_in, check_out, exclude_pk=None):
    """Bookings that hold dates inside [check_in, check_out) for this property."""
    qs = Booking.objects.holding().filter(property=prop, check_in__lt=check_out, check_out__gt=check_in)
    return qs.exclude(pk=exclude_pk) if exclude_pk else qs


def blocked_ranges(prop, window_start, window_end):
    """Merged, sorted, half-open ranges ``[start, end)`` of nights taken inside ``[window_start, window_end)``.

    Only bookings that hold dates count (the same rule ``overlapping`` uses when a booking is created): CONFIRMED ones,
    and PENDING ones still inside their payment window. CANCELLED, COMPLETED, EXPIRED and REFUND_REQUIRED never block. The guest's check-out day is free, so ``end`` of one range is a valid
    check-in. Touching or overlapping ranges are merged. Nothing about the bookings (guest, price, status) is returned.
    """
    pairs = (
        Booking.objects.holding()
        .filter(property=prop, check_in__lt=window_end, check_out__gt=window_start)
        .order_by("check_in", "check_out")
        .values_list("check_in", "check_out")
    )
    merged = []
    for check_in, check_out in pairs:
        start, end = max(check_in, window_start), min(check_out, window_end)
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


@transaction.atomic
def create_booking(guest, prop, check_in, check_out, guests_count) -> Booking:
    # Lock the property row so two requests for the same dates are handled one after the other.
    prop = Property.objects.select_for_update().get(pk=prop.pk)
    if overlapping(prop, check_in, check_out).exists():
        raise Conflict("This property is not available for those dates.", code="dates_unavailable")
    _, total = price_for(prop, check_in, check_out)  # worked out again here, never taken from a quote
    return Booking.objects.create(
        guest=guest,
        property=prop,
        check_in=check_in,
        check_out=check_out,
        guests_count=guests_count,
        total_price=total,  # fixed now; later edits to the listing do not change it
        status=S.PENDING,
        expires_at=timezone.now() + payment_window(),
    )


def _may_act(user, action, booking) -> bool:
    if user.role == Role.SUPER_ADMIN:
        return True
    if user.role == Role.HOST:
        return booking.property.owner_id == user.pk
    return user.pk == booking.guest_id and action not in HOST_ONLY_ACTIONS


@transaction.atomic
def transition(booking, action, user) -> Booking:
    booking = Booking.objects.select_for_update().select_related("property").get(pk=booking.pk)
    if not _may_act(user, action, booking):
        raise PermissionDenied("You are not allowed to do this to this booking.")
    allowed_from, target = TRANSITIONS[action]
    if booking.status not in allowed_from:
        raise Conflict(f"A {booking.status.lower()} booking cannot be {target.lower()}.", code="invalid_transition")
    if action == "complete" and booking.check_out > today():
        raise Conflict("A stay can only be completed once the check-out date has passed.", code="stay_not_finished")
    booking.status = target
    booking.save(update_fields=["status", "updated_at"])
    return booking
