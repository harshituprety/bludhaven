from django.contrib import admin

from .models import BillingPayment, BillingProfile, HostWallet, Subscription, SubscriptionPlan, WalletTransaction


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "price", "duration_days", "is_trial", "is_active"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "status", "payment_status", "start_date", "expiry_date"]
    list_filter = ["status", "payment_status"]


admin.site.register(BillingProfile)


class _ReadOnly(admin.ModelAdmin):
    """Money records are changed only through the billing services, never by editing rows here."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(BillingPayment)
class BillingPaymentAdmin(_ReadOnly):
    list_display = ["id", "user", "purpose", "kind", "plan", "amount_paise", "status", "verified_via", "created_at"]
    list_filter = ["purpose", "status", "verified_via"]


@admin.register(HostWallet)
class HostWalletAdmin(_ReadOnly):
    list_display = ["user", "balance_paise", "updated_at"]


@admin.register(WalletTransaction)
class WalletTransactionAdmin(_ReadOnly):
    list_display = ["id", "user", "kind", "amount_paise", "balance_after_paise", "created_at"]
    list_filter = ["kind"]
