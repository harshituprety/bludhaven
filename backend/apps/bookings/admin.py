from django.contrib import admin

from .models import Booking, Review


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ["id", "property", "guest", "check_in", "check_out", "status"]
    list_filter = ["status"]
    search_fields = ["guest__email", "property__title"]
    # A booking becomes CONFIRMED only through a verified payment, so the admin site cannot edit these by hand.
    readonly_fields = ["status", "expires_at", "total_price"]


admin.site.register(Review)
