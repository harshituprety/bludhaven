"""Host subscriptions, self-serve billing and the Host wallet.

Plan limits and prices are not hard-coded anywhere: whatever a plan costs and allows lives in
``SubscriptionPlan`` (``price``, ``duration_days``, ``features``) and is edited by a Super Admin.

* ``Subscription``: one row per paid period of one plan. History is kept: renewing queues a new row, changing plan
  ends the old row and starts a new one that points back at it (``previous_subscription``).
* ``BillingPayment``: the Razorpay side of buying a plan or topping up the wallet (identifiers and amounts only).
* ``HostWallet`` / ``WalletTransaction``: a prepaid balance and its append-only ledger, in paise.
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
    is_active = models.BooleanField(default=True, help_text="Inactive plans cannot be newly assigned or bought.")
    is_trial = models.BooleanField(
        default=False, help_text="A free plan a Host can start once, with no payment. Its price must be 0."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["price", "name"]
        constraints = [
            models.CheckConstraint(condition=Q(price__gte=0), name="plan_price_not_negative"),
            models.CheckConstraint(condition=Q(duration_days__gte=1), name="plan_duration_at_least_1_day"),
            models.CheckConstraint(condition=Q(is_trial=False) | Q(price=0), name="plan_trial_is_free"),
        ]

    def __str__(self):
        return self.name


class Subscription(models.Model):
    class Status(models.TextChoices):
        TRIAL = "TRIAL", "Trial"
        ACTIVE = "ACTIVE", "Active"
        PAST_DUE = "PAST_DUE", "Past due"  # the paid period ended; the Host is still inside the grace period
        EXPIRED = "EXPIRED", "Expired"
        CANCELLED = "CANCELLED", "Cancelled"
        SUSPENDED = "SUSPENDED", "Suspended"  # set by a Super Admin

    # Statuses that can entitle a Host (the dates decide the rest; see limits.current_subscription).
    ENTITLING = (Status.TRIAL, Status.ACTIVE, Status.PAST_DUE)

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        REFUNDED = "REFUNDED", "Refunded"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # The plan's price when this subscription was assigned, so later price changes do not rewrite history.
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0, help_text="Indian rupees.")
    payment_status = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    start_date = models.DateField(help_text="First day of this period.")
    expiry_date = models.DateField(help_text="The day this period ends (not covered).")
    grace_until = models.DateField(null=True, blank=True, help_text="PAST_DUE only: access continues through this day.")
    cancel_at_period_end = models.BooleanField(default=False, help_text="Stays active to the end of the period, then CANCELLED.")
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.CharField(max_length=100, blank=True)
    previous_subscription = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="next_subscriptions",
        help_text="The subscription this one renewed or replaced.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-start_date"]
        constraints = [
            models.CheckConstraint(condition=Q(expiry_date__gt=F("start_date")), name="subscription_expiry_after_start"),
            models.CheckConstraint(condition=Q(amount__gte=0), name="subscription_amount_not_negative"),
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


class BillingPayment(models.Model):
    """The gateway side of one purchase: a plan (``SUBSCRIPTION``) or a wallet top-up (``TOPUP``).

    Holds identifiers and amounts only; no card data ever reaches this server. The amounts are fixed by the server when
    the order is created. ``amount_paise`` is what is charged through Razorpay; ``wallet_paise`` is what the wallet
    covers (including any proration credit), so ``price_paise == amount_paise + wallet_paise`` for a plan purchase.
    """

    class Purpose(models.TextChoices):
        SUBSCRIPTION = "SUBSCRIPTION", "Subscription"
        TOPUP = "TOPUP", "Wallet top-up"

    class Kind(models.TextChoices):
        NEW = "NEW", "New subscription"
        RENEWAL = "RENEWAL", "Renewal"
        CHANGE = "CHANGE", "Plan change"
        TRIAL = "TRIAL", "Trial"

    class Status(models.TextChoices):
        CREATED = "CREATED", "Order created"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        SUPERSEDED = "SUPERSEDED", "Replaced by a newer checkout"
        REFUND_REQUIRED = "REFUND_REQUIRED", "Refund required"  # money arrived but the purchase could not be applied

    class Source(models.TextChoices):
        CHECKOUT = "CHECKOUT", "Checkout verification"
        WEBHOOK = "WEBHOOK", "Webhook"
        WALLET = "WALLET", "Wallet (no gateway charge)"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="billing_payments")
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    kind = models.CharField(max_length=10, choices=Kind.choices, blank=True)
    plan = models.ForeignKey(SubscriptionPlan, null=True, blank=True, on_delete=models.PROTECT, related_name="billing_payments")
    previous_subscription = models.ForeignKey(
        Subscription, null=True, blank=True, on_delete=models.PROTECT, related_name="+",
        help_text="The subscription being renewed or replaced when the order was created.",
    )
    subscription = models.ForeignKey(
        Subscription, null=True, blank=True, on_delete=models.PROTECT, related_name="billing_payments",
        help_text="The subscription this payment activated.",
    )
    price_paise = models.PositiveBigIntegerField(default=0, help_text="Plan price at the time (0 for a top-up).")
    credit_paise = models.PositiveBigIntegerField(default=0, help_text="Value of the unused time of the replaced plan.")
    wallet_paise = models.PositiveBigIntegerField(default=0, help_text="Taken from the wallet (credit and balance).")
    amount_paise = models.PositiveBigIntegerField(default=0, help_text="Charged through Razorpay.")
    currency = models.CharField(max_length=3, default="INR")
    razorpay_order_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    razorpay_payment_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    verified_via = models.CharField(max_length=10, choices=Source.choices, blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["user", "status"], name="billingpayment_user_status_idx")]

    def __str__(self):
        return f"{self.purpose} {self.razorpay_order_id or 'wallet'} ({self.status})"


class HostWallet(models.Model):
    """A Host's prepaid balance in paise. Never negative; changed only through ``WalletTransaction`` rows."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="wallet")
    balance_paise = models.BigIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=Q(balance_paise__gte=0), name="wallet_balance_not_negative")]

    def __str__(self):
        return f"Wallet of {self.user_id}: {self.balance_paise} paise"


class WalletTransaction(models.Model):
    """One line of a wallet's statement. Append-only: a mistake is corrected by a new, opposite entry."""

    class Kind(models.TextChoices):
        TOPUP = "TOPUP", "Top-up"
        SUBSCRIPTION_PAYMENT = "SUBSCRIPTION_PAYMENT", "Subscription payment"
        PRORATION_CREDIT = "PRORATION_CREDIT", "Credit for unused time"
        ADMIN_CREDIT = "ADMIN_CREDIT", "Credit by Blüdhaven"
        ADMIN_DEBIT = "ADMIN_DEBIT", "Debit by Blüdhaven"

    wallet = models.ForeignKey(HostWallet, on_delete=models.PROTECT, related_name="transactions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="wallet_transactions")
    kind = models.CharField(max_length=24, choices=Kind.choices)
    amount_paise = models.BigIntegerField(help_text="Positive adds to the balance, negative takes from it.")
    balance_after_paise = models.BigIntegerField()
    description = models.CharField(max_length=200, blank=True)
    billing_payment = models.ForeignKey(BillingPayment, null=True, blank=True, on_delete=models.PROTECT, related_name="wallet_transactions")
    subscription = models.ForeignKey(Subscription, null=True, blank=True, on_delete=models.PROTECT, related_name="wallet_transactions")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.CheckConstraint(condition=~Q(amount_paise=0), name="wallettx_amount_not_zero"),
            models.CheckConstraint(condition=Q(balance_after_paise__gte=0), name="wallettx_balance_after_not_negative"),
            # A payment can post each kind of entry once, so replaying a webhook cannot double-credit or double-charge.
            # (NULL billing_payment, i.e. admin adjustments, never collide: NULLs are distinct in a unique index.)
            models.UniqueConstraint(fields=["billing_payment", "kind"], name="wallettx_once_per_payment_kind"),
        ]

    def __str__(self):
        return f"{self.kind} {self.amount_paise} → {self.balance_after_paise}"

    def save(self, *args, **kwargs):
        if self.pk:
            raise ValidationError("Wallet transactions cannot be changed.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Wallet transactions cannot be deleted.")
