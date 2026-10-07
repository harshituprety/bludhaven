from django_filters import rest_framework as filters

from .models import BillingPayment, BillingProfile, HostWallet, Subscription, SubscriptionPlan, WalletTransaction


class PlanFilter(filters.FilterSet):
    class Meta:
        model = SubscriptionPlan
        fields = ["is_active"]


class SubscriptionFilter(filters.FilterSet):
    user = filters.NumberFilter(field_name="user_id")
    plan = filters.NumberFilter(field_name="plan_id")

    class Meta:
        model = Subscription
        fields = ["status", "payment_status"]


class BillingProfileFilter(filters.FilterSet):
    user = filters.NumberFilter(field_name="user_id")

    class Meta:
        model = BillingProfile
        fields = ["user"]


class WalletFilter(filters.FilterSet):
    user = filters.NumberFilter(field_name="user_id")

    class Meta:
        model = HostWallet
        fields = ["user"]


class WalletTransactionFilter(filters.FilterSet):
    user = filters.NumberFilter(field_name="user_id")

    class Meta:
        model = WalletTransaction
        fields = ["kind"]


class BillingPaymentFilter(filters.FilterSet):
    user = filters.NumberFilter(field_name="user_id")

    class Meta:
        model = BillingPayment
        fields = ["status", "purpose"]
