from django.db.models import Exists, OuterRef
from django_filters import rest_framework as filters
from django_filters.filters import BaseInFilter
from rest_framework.exceptions import NotAuthenticated, ValidationError

from apps.bookings.models import Booking

from .models import Amenity, Destination, Favourite, Property


class NumberInFilter(BaseInFilter, filters.NumberFilter):
    """``?amenities=1,2,3``"""


class DestinationFilter(filters.FilterSet):
    state = filters.CharFilter(field_name="state", lookup_expr="iexact")

    class Meta:
        model = Destination
        fields = ["state"]


class PropertyFilter(filters.FilterSet):
    """All query parameters of ``GET /api/properties/``. Unknown parameters are ignored; bad values are a 400."""

    destination = filters.NumberFilter(field_name="destination_id")
    destination_name = filters.CharFilter(field_name="destination__name", lookup_expr="iexact")
    state = filters.CharFilter(field_name="destination__state", lookup_expr="iexact")
    property_type = filters.MultipleChoiceFilter(choices=Property.Type.choices)  # repeat the parameter for several
    min_price = filters.NumberFilter(field_name="price_per_night", lookup_expr="gte")
    max_price = filters.NumberFilter(field_name="price_per_night", lookup_expr="lte")
    guests = filters.NumberFilter(field_name="max_guests", lookup_expr="gte", help_text="Sleeps at least this many.")
    min_bedrooms = filters.NumberFilter(field_name="bedrooms", lookup_expr="gte")
    min_bathrooms = filters.NumberFilter(field_name="bathrooms", lookup_expr="gte")
    amenities = NumberInFilter(method="filter_amenities", help_text="Comma-separated ids; the property needs all of them.")
    min_rating = filters.NumberFilter(field_name="average_rating", lookup_expr="gte")
    owner = filters.NumberFilter(field_name="owner_id")
    status = filters.ChoiceFilter(choices=Property.Status.choices)
    mine = filters.BooleanFilter(method="filter_mine", help_text="Only the signed-in user's own properties.")
    check_in = filters.DateFilter(method="noop")
    check_out = filters.DateFilter(method="noop")

    class Meta:
        model = Property
        fields = []

    def noop(self, queryset, name, value):  # handled together in filter_queryset
        return queryset

    def filter_amenities(self, queryset, name, value):
        # One EXISTS per amenity (no joins), so the rating aggregates are not multiplied by amenity rows.
        through = Property.amenities.through
        for amenity_id in value:
            queryset = queryset.filter(Exists(through.objects.filter(property_id=OuterRef("pk"), amenity_id=amenity_id)))
        return queryset

    def filter_mine(self, queryset, name, value):
        if not value:
            return queryset
        user = self.request.user
        if not user.is_authenticated:
            raise NotAuthenticated()
        return queryset.filter(owner=user)

    def filter_queryset(self, queryset):
        queryset = super().filter_queryset(queryset)
        check_in, check_out = self.form.cleaned_data.get("check_in"), self.form.cleaned_data.get("check_out")
        if check_in or check_out:
            if not (check_in and check_out):
                raise ValidationError({"check_out" if check_in else "check_in": "Give both check_in and check_out to filter by availability."})
            if check_out <= check_in:
                raise ValidationError({"check_out": "Must be after check_in."})
            clashing = Booking.objects.holding().filter(property=OuterRef("pk"), check_in__lt=check_out, check_out__gt=check_in)
            queryset = queryset.exclude(Exists(clashing))
        return queryset


class FavouriteFilter(filters.FilterSet):
    property = filters.NumberFilter(field_name="property_id")

    class Meta:
        model = Favourite
        fields = ["property"]


__all__ = ["DestinationFilter", "PropertyFilter", "FavouriteFilter", "Amenity"]
