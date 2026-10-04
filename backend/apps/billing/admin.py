from django.contrib import admin

from .models import BillingProfile, Subscription, SubscriptionPlan


@admin.register(SubscriptionPlan)
class SubscriptionPlanAdmin(admin.ModelAdmin):
    list_display = ["name", "price", "duration_days", "is_active"]


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "status", "payment_status", "start_date", "expiry_date"]
    list_filter = ["status", "payment_status"]


admin.site.register(BillingProfile)
