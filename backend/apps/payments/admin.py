from django.contrib import admin

from .models import Payment


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    """Read-only: a payment's status changes only through verified Razorpay data. REFUND_REQUIRED rows are refunded
    by hand in the Razorpay dashboard."""

    list_display = ["razorpay_order_id", "razorpay_payment_id", "booking", "amount_paise", "currency", "status", "verified_via", "paid_at"]
    list_filter = ["status", "verified_via"]
    search_fields = ["razorpay_order_id", "razorpay_payment_id", "booking__guest__email"]
    readonly_fields = [f.name for f in Payment._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
