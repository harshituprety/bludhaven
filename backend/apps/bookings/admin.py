from django.contrib import admin

from .models import Booking, Review


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ["id", "property", "guest", "check_in", "check_out", "status"]
    list_filter = ["status"]
    search_fields = ["guest__email", "property__title"]


admin.site.register(Review)
