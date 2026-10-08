"""Plan entitlements and limit enforcement.

Nothing here invents numbers. A plan allows exactly what its ``features`` JSON says; a key that is absent means
"no limit". Recognised keys (anything else is rejected when a plan is saved):

- ``max_properties``: how many properties the Host may own.
- ``max_images_per_property``: how many images each property may hold.

A Host is *entitled* while they hold

* an ACTIVE or TRIAL subscription with ``start_date <= today < expiry_date`` (expiry is start + the plan's
  duration_days), or
* a PAST_DUE one (the paid period ended) whose grace period has not run out (``today <= grace_until``).

EXPIRED, CANCELLED and SUSPENDED subscriptions never entitle. Without entitlement a Host keeps seeing their
listings and bookings but cannot add properties or photos. Payment status is informational only.
"""

from django.db.models import Count, Max, Q
from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.core.exceptions import PlanLimitReached

from .models import Subscription

FEATURE_KEYS = {"max_properties", "max_images_per_property", "premium_amenities"}
BOOLEAN_KEYS = {"premium_amenities"}  # true/false instead of a count


def validate_features(features):
    if not isinstance(features, dict):
        raise ValidationError("Features must be a JSON object.")
    unknown = sorted(set(features) - FEATURE_KEYS)
    if unknown:
        raise ValidationError(f"Unknown feature(s): {', '.join(unknown)}. Allowed: {', '.join(sorted(FEATURE_KEYS))}.")
    for key, value in features.items():
        if key in BOOLEAN_KEYS:
            if not isinstance(value, bool):
                raise ValidationError(f"{key} must be true or false.")
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > 1_000_000:
            raise ValidationError(f"{key} must be a whole number between 0 and 1000000.")
    return features


def today():
    return timezone.localdate()


def entitling_q(on=None):
    """The rows that entitle their Host on ``on`` (default today), as a Q object."""
    t = on or today()
    S = Subscription.Status
    return Q(start_date__lte=t) & (
        (Q(status__in=[S.ACTIVE, S.TRIAL]) & Q(expiry_date__gt=t)) | (Q(status=S.PAST_DUE) & Q(grace_until__gte=t))
    )


def current_subscription(user):
    """The Host's entitling subscription (latest start first), or None."""
    return Subscription.objects.select_related("plan").filter(entitling_q(), user=user).order_by("-start_date", "-id").first()


def plan_blockers(user, plan):
    """Reasons ``user`` cannot move onto ``plan`` without already being over its limits (empty list if none)."""
    reasons = []
    max_properties = plan.features.get("max_properties")
    properties = _published(user).count()
    if max_properties is not None and properties > max_properties:
        reasons.append(f"You have {properties} properties but {plan.name} allows {max_properties}.")
    max_images = plan.features.get("max_images_per_property")
    if max_images is not None:
        most = user.properties.annotate(n=Count("images")).aggregate(m=Max("n"))["m"] or 0
        if most > max_images:
            reasons.append(f"One of your properties has {most} photos but {plan.name} allows {max_images} per property.")
    return reasons


def _published(user):
    from apps.catalog.models import Property

    return user.properties.filter(status=Property.Status.PUBLISHED)


def allows_premium_amenities(user):
    sub = current_subscription(user)
    return bool(sub and sub.plan.features.get("premium_amenities"))


def _require(owner):
    sub = current_subscription(owner)
    if sub is None:
        raise PermissionDenied(
            "An active subscription is required for this action." , code="subscription_required"
        )
    return sub


def ensure_can_add_property(owner):
    """Call inside a transaction that holds a lock on the owner row, so concurrent creates cannot overshoot."""
    sub = _require(owner)
    limit = sub.plan.features.get("max_properties")
    if limit is not None and _published(owner).count() >= limit:
        raise PlanLimitReached(
            f"Property limit reached. Your {sub.plan.name} plan allows {limit} propert{'y' if limit == 1 else 'ies'}. "
            "Upgrade your plan to add more properties.",
            {"limit": "max_properties", "allowed": limit, "plan": sub.plan.name},
        )


def ensure_can_add_draft(owner):
    """A Host may keep a few unpublished drafts before choosing a plan. Drafts do not count toward the plan's property limit."""
    from apps.catalog.models import Property

    cap = settings.MAX_DRAFTS_PER_HOST
    if owner.properties.filter(status=Property.Status.DRAFT).count() >= cap:
        raise PermissionDenied(f"You can keep at most {cap} unpublished drafts. Publish or delete one first.", code="draft_limit_reached")


def ensure_can_add_image(prop):
    """Call inside a transaction that holds a lock on the property row.

    A published property needs a current plan. A draft may take photos before a plan is chosen (up to ``DRAFT_MAX_IMAGES``);
    a plan, once there, sets the limit.
    """
    sub = current_subscription(prop.owner)
    if sub is None:
        if prop.status != prop.Status.DRAFT:
            _require(prop.owner)
        limit, plan_name = settings.DRAFT_MAX_IMAGES, None
    else:
        limit, plan_name = sub.plan.features.get("max_images_per_property"), sub.plan.name
    if limit is not None and prop.images.count() >= limit:
        noun = f"{limit} image{'' if limit == 1 else 's'} per property"
        if plan_name:
            message = f"Image limit reached. Your {plan_name} plan allows {noun}. Upgrade your plan to add more photos."
        else:
            message = f"Image limit reached. A draft can hold {noun} until you choose a plan. Choose a plan to add more photos."
        raise PlanLimitReached(message, {"limit": "max_images_per_property", "allowed": limit, "plan": plan_name})


def usage(user):
    """Current usage vs limits, for the Host's subscription page."""
    sub = current_subscription(user)
    features = sub.plan.features if sub else {}
    return {
        "properties": {"used": _published(user).count(), "limit": features.get("max_properties")},
        "max_images_per_property": features.get("max_images_per_property"),
        "status": sub.status if sub else None,
    }
