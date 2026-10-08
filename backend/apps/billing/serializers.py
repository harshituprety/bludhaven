from datetime import timedelta
from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Role, User

from . import limits
from .models import BillingPayment, BillingProfile, HostWallet, Subscription, SubscriptionPlan, WalletTransaction


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    duration_days = serializers.IntegerField(min_value=1, max_value=36500)
    features = serializers.JSONField(required=False)

    class Meta:
        model = SubscriptionPlan
        fields = ["id", "name", "description", "price", "duration_days", "features", "is_active", "is_trial", "display_order", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_features(self, value):
        return limits.validate_features(value)

    def validate(self, attrs):
        price = attrs.get("price", self.instance.price if self.instance else None)
        is_trial = attrs.get("is_trial", self.instance.is_trial if self.instance else False)
        if is_trial and price != 0:
            raise serializers.ValidationError({"is_trial": "A trial plan must be free (price 0)."})
        return attrs


class PlanBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = ["id", "name", "features", "is_trial"]
        read_only_fields = fields


class SubscriptionHostSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "full_name", "email"]
        read_only_fields = fields


class SubscriptionSerializer(serializers.ModelSerializer):
    """Read shape, shared by Hosts (their own) and Super Admins (all)."""

    user = SubscriptionHostSerializer(read_only=True)
    plan = PlanBriefSerializer(read_only=True)
    is_current = serializers.SerializerMethodField()
    renews_on = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = [
            "id", "user", "plan", "status", "payment_status", "amount", "start_date", "expiry_date", "grace_until",
            "is_current", "renews_on", "cancel_at_period_end", "cancelled_at", "cancellation_reason", "previous_subscription",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_is_current(self, obj):
        return Subscription.objects.filter(limits.entitling_q(), pk=obj.pk).exists()

    def get_renews_on(self, obj):
        """The date the next payment is due, or null when nothing will renew (cancelled, or already paid ahead)."""
        if obj.cancel_at_period_end or obj.status not in (Subscription.Status.ACTIVE, Subscription.Status.TRIAL):
            return None
        return obj.expiry_date


class SubscriptionCreateSerializer(serializers.Serializer):
    """A Super Admin assigns a plan to a Host. Amount and expiry are computed from the plan."""

    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=Role.HOST, is_active=True))
    plan = serializers.PrimaryKeyRelatedField(queryset=SubscriptionPlan.objects.filter(is_active=True))
    start_date = serializers.DateField(required=False)
    payment_status = serializers.ChoiceField(choices=Subscription.PaymentStatus.choices, required=False)

    def validate(self, attrs):
        attrs.setdefault("start_date", limits.today())
        attrs["expiry_date"] = attrs["start_date"] + timedelta(days=attrs["plan"].duration_days)
        return attrs


class SubscriptionUpdateSerializer(serializers.Serializer):
    S = Subscription.Status
    status = serializers.ChoiceField(choices=[S.CANCELLED, S.EXPIRED, S.SUSPENDED, S.ACTIVE], required=False)
    payment_status = serializers.ChoiceField(choices=Subscription.PaymentStatus.choices, required=False)


class BillingProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingProfile
        fields = [
            "billing_name", "billing_email", "phone", "address_line1", "address_line2",
            "city", "state", "postal_code", "country", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]


class AdminBillingProfileSerializer(BillingProfileSerializer):
    user = SubscriptionHostSerializer(read_only=True)

    class Meta(BillingProfileSerializer.Meta):
        fields = ["user"] + BillingProfileSerializer.Meta.fields
        read_only_fields = fields


class SubscriptionRenewSerializer(serializers.Serializer):
    payment_status = serializers.ChoiceField(choices=Subscription.PaymentStatus.choices, required=False)


# --- self-serve billing, wallet ---------------------------------------------------------------------------------------


def rupees(paise):
    return (Decimal(paise) / 100).quantize(Decimal("0.01"))


class WalletSerializer(serializers.ModelSerializer):
    balance = serializers.SerializerMethodField()

    class Meta:
        model = HostWallet
        fields = ["balance_paise", "balance", "updated_at"]
        read_only_fields = fields

    def get_balance(self, obj):
        return rupees(obj.balance_paise)


class WalletTransactionSerializer(serializers.ModelSerializer):
    amount = serializers.SerializerMethodField()
    balance_after = serializers.SerializerMethodField()
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = WalletTransaction
        fields = ["id", "kind", "kind_label", "amount_paise", "amount", "balance_after_paise", "balance_after", "description", "billing_payment", "subscription", "created_at"]
        read_only_fields = fields

    def get_amount(self, obj):
        return rupees(obj.amount_paise)

    def get_balance_after(self, obj):
        return rupees(obj.balance_after_paise)


class AdminWalletTransactionSerializer(WalletTransactionSerializer):
    user = SubscriptionHostSerializer(read_only=True)

    class Meta(WalletTransactionSerializer.Meta):
        fields = ["user"] + WalletTransactionSerializer.Meta.fields + ["created_by"]
        read_only_fields = fields


class AdminWalletSerializer(WalletSerializer):
    user = SubscriptionHostSerializer(read_only=True)

    class Meta(WalletSerializer.Meta):
        fields = ["user"] + WalletSerializer.Meta.fields
        read_only_fields = fields


class BillingPaymentSerializer(serializers.ModelSerializer):
    plan = PlanBriefSerializer(read_only=True)
    price = serializers.SerializerMethodField()
    wallet_applied = serializers.SerializerMethodField()
    credit = serializers.SerializerMethodField()
    charged = serializers.SerializerMethodField()
    purpose_label = serializers.CharField(source="get_purpose_display", read_only=True)
    kind_label = serializers.CharField(source="get_kind_display", read_only=True)

    class Meta:
        model = BillingPayment
        fields = [
            "id", "purpose", "purpose_label", "kind", "kind_label", "plan", "subscription", "status", "verified_via", "currency",
            "price_paise", "price", "credit_paise", "credit", "wallet_paise", "wallet_applied", "amount_paise", "charged",
            "paid_at", "created_at",
        ]
        read_only_fields = fields

    def get_price(self, obj):
        return rupees(obj.price_paise)

    def get_wallet_applied(self, obj):
        return rupees(obj.wallet_paise)

    def get_credit(self, obj):
        return rupees(obj.credit_paise)

    def get_charged(self, obj):
        return rupees(obj.amount_paise)


class AdminBillingPaymentSerializer(BillingPaymentSerializer):
    user = SubscriptionHostSerializer(read_only=True)

    class Meta(BillingPaymentSerializer.Meta):
        fields = ["user", "razorpay_order_id", "razorpay_payment_id"] + BillingPaymentSerializer.Meta.fields
        read_only_fields = fields


class PlanChoiceSerializer(serializers.Serializer):
    """Body of a quote or checkout: which plan, and whether the wallet balance may be used."""

    plan = serializers.IntegerField(min_value=1)
    use_wallet = serializers.BooleanField(required=False, default=True)


class VerifyBillingSerializer(serializers.Serializer):
    razorpay_order_id = serializers.CharField(max_length=64)
    razorpay_payment_id = serializers.CharField(max_length=64)
    razorpay_signature = serializers.CharField(max_length=256)


class TopUpSerializer(serializers.Serializer):
    """Whole rupees. The ceiling is a sanity limit (``WALLET_TOPUP_MAX_RUPEES``), not a business rule."""

    amount = serializers.IntegerField(min_value=1)

    def validate_amount(self, value):
        from django.conf import settings

        if value > settings.WALLET_TOPUP_MAX_RUPEES:
            raise serializers.ValidationError(f"The most you can add at once is {settings.WALLET_TOPUP_MAX_RUPEES}.")
        return value


class AdjustWalletSerializer(serializers.Serializer):
    """Super Admin: a positive amount credits the Host, a negative one debits. A reason is required."""

    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    reason = serializers.CharField(max_length=200)

    def validate_amount(self, value):
        if value == 0:
            raise serializers.ValidationError("The amount cannot be zero.")
        return value
