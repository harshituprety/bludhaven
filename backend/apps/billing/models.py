"""Subscriptions for Hosts, with manual payment tracking (no payment gateway).

Plan limits are not hard-coded anywhere: whatever a plan allows lives in ``SubscriptionPlan.features``
(JSON) and is edited by a Super Admin, so no business limits are baked into the schema.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q


class SubscriptionPlan(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Indian rupees for one period.")
    duration_days = models.PositiveIntegerField(help_text="How long one purchase lasts; start + this = expiry.")
    features = models.JSONField(default=dict, blank=True, help_text="Configurable feature flags / limits for this plan.")
    is_active = models.BooleanField(default=True, help_text="Inactive plans cannot be newly assigned.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["price", "name"]
        constraints = [
            models.CheckConstraint(condition=Q(price__gte=0), name="plan_price_not_negative"),
            models.CheckConstraint(condition=Q(duration_days__gte=1), name="plan_duration_at_least_1_day"),
        ]

    def __str__(self):
        return self.name


class Subscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    payment_status = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    start_date = models.DateField()
    expiry_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(condition=Q(expiry_date__gt=F("start_date")), name="subscription_expiry_after_start"),
        ]
        indexes = [models.Index(fields=["user", "status"], name="subscription_user_status_idx")]

    def __str__(self):
        return f"{self.user_id} → {self.plan_id} ({self.status})"

    def clean(self):
        # Subscriptions belong to Hosts, who are the ones listing properties. Enforced wherever full_clean() runs.
        if self.user_id and self.user.role != "HOST":
            raise ValidationError({"user": "Only users with the Host role can hold a subscription."})


class BillingProfile(models.Model):
    """Where a Host's invoices go. One per user."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="billing_profile")
    billing_name = models.CharField(max_length=150)
    billing_email = models.EmailField()
    phone = models.CharField(max_length=20, blank=True)
    address_line1 = models.CharField(max_length=255)
    address_line2 = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    postal_code = models.CharField(max_length=20)
    country = models.CharField(max_length=100, default="India")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Billing for {self.user_id}"
