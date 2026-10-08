from django.contrib import admin

from .models import Amenity, Destination, Favourite, Property, PropertyImage


class PropertyImageInline(admin.TabularInline):
    model = PropertyImage
    extra = 0


@admin.register(Destination)
class DestinationAdmin(admin.ModelAdmin):
    list_display = ["name", "state", "display_order"]
    search_fields = ["name", "state"]


@admin.register(Amenity)
class AmenityAdmin(admin.ModelAdmin):
    list_display = ["name", "is_premium"]
    search_fields = ["name"]


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ["title", "destination", "property_type", "price_per_night", "owner", "status"]
    list_filter = ["status", "property_type", "destination"]
    search_fields = ["title", "owner__email"]
    filter_horizontal = ["amenities"]
    inlines = [PropertyImageInline]


admin.site.register(Favourite)
