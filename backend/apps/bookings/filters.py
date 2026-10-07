from django_filters import rest_framework as filters

from .models import Booking, Review


class BookingFilter(filters.FilterSet):
    status = filters.MultipleChoiceFilter(choices=Booking.Status.choices)
    property = filters.NumberFilter(field_name="property_id")
    guest = filters.NumberFilter(field_name="guest_id")
    check_in_from = filters.DateFilter(field_name="check_in", lookup_expr="gte")
    check_in_to = filters.DateFilter(field_name="check_in", lookup_expr="lte")

    class Meta:
        model = Booking
        fields = []


class ReviewFilter(filters.FilterSet):
    property = filters.NumberFilter(field_name="booking__property_id")
    rating = filters.NumberFilter(field_name="rating")
    min_rating = filters.NumberFilter(field_name="rating", lookup_expr="gte")

    class Meta:
        model = Review
        fields = []
