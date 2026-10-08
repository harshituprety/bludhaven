from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers

from apps.accounts.models import User
from apps.catalog.models import Property

from . import services
from .models import Booking, Review

MAX_TOTAL = Decimal("99999999.99")  # total_price is DECIMAL(10,2)


class GuestSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "full_name"]
        read_only_fields = fields


class BookingPropertySerializer(serializers.ModelSerializer):
    destination = serializers.CharField(source="destination.name", read_only=True)

    class Meta:
        model = Property
        fields = ["id", "title", "locality", "destination"]
        read_only_fields = fields


class BookingReviewSerializer(serializers.ModelSerializer):
    """The review of this very stay (a booking has at most one)."""

    class Meta:
        model = Review
        fields = ["id", "rating", "comment", "created_at"]
        read_only_fields = fields


class BookingSerializer(serializers.ModelSerializer):
    """How a booking is shown to its guest, its property's Host and Super Admins."""

    property = BookingPropertySerializer(read_only=True)
    guest = GuestSummarySerializer(read_only=True)
    nights = serializers.SerializerMethodField()
    review = serializers.SerializerMethodField()
    payment_status = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            "id", "property", "guest", "check_in", "check_out", "nights", "guests_count", "total_price", "status",
            "expires_at", "payment_status", "review", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_payment_status(self, obj):
        """CREATED / FAILED / PAID / REFUND_REQUIRED, or null when no payment was ever started. Never any Razorpay ids."""
        try:
            return obj.payment.status  # reverse one-to-one; select_related in the view keeps this to one query
        except ObjectDoesNotExist:
            return None

    def get_review(self, obj):
        try:
            review = obj.review  # reverse one-to-one; select_related in the view keeps this to one query
        except Review.DoesNotExist:
            return None
        return BookingReviewSerializer(review).data

    def get_nights(self, obj):
        return (obj.check_out - obj.check_in).days


class BookingRequestSerializer(serializers.Serializer):
    """The four things a guest chooses. Used to ask for a price quote and to create the booking, with one set of rules."""

    property = serializers.PrimaryKeyRelatedField(queryset=Property.objects.filter(status=Property.Status.PUBLISHED))
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    guests_count = serializers.IntegerField(min_value=1, max_value=32767)

    def validate(self, attrs):
        check_in, check_out, prop = attrs["check_in"], attrs["check_out"], attrs["property"]
        if check_in < services.today():
            raise serializers.ValidationError({"check_in": "Check-in cannot be in the past."})
        if check_out <= check_in:
            raise serializers.ValidationError({"check_out": "Check-out must be after check-in."})
        nights = (check_out - check_in).days
        if nights > settings.BOOKING_MAX_NIGHTS:
            raise serializers.ValidationError({"check_out": f"A stay can be at most {settings.BOOKING_MAX_NIGHTS} nights."})
        if attrs["guests_count"] > prop.max_guests:
            raise serializers.ValidationError({"guests_count": f"This property sleeps at most {prop.max_guests}."})
        if prop.price_per_night * nights > MAX_TOTAL:
            raise serializers.ValidationError({"check_out": "The total price is too large."})
        return attrs


class BookingCreateSerializer(BookingRequestSerializer):
    """Input only: the guest, status, expiry and price come from the server, never from the client."""

    def create(self, validated_data):
        return services.create_booking(
            guest=self.context["request"].user,
            prop=validated_data["property"],
            check_in=validated_data["check_in"],
            check_out=validated_data["check_out"],
            guests_count=validated_data["guests_count"],
        )


class BookingQuoteSerializer(BookingRequestSerializer):
    """Same input; the answer is a price, nothing is saved. ``create_booking`` works the price out again from scratch."""

    def to_quote(self):
        d = self.validated_data
        prop = d["property"]
        nights, total = services.price_for(prop, d["check_in"], d["check_out"])
        return {
            "property": prop.pk,
            "check_in": d["check_in"],
            "check_out": d["check_out"],
            "guests_count": d["guests_count"],
            "nights": nights,
            "price_per_night": f"{prop.price_per_night:.2f}",
            "total_price": f"{total:.2f}",
            "currency": "INR",
            "available": not services.overlapping(prop, d["check_in"], d["check_out"]).exists(),
            "payment_window_minutes": settings.BOOKING_PAYMENT_WINDOW_MINUTES,
        }


class ReviewSerializer(serializers.ModelSerializer):
    """Public view of a review. The booking itself is not exposed."""

    property = serializers.PrimaryKeyRelatedField(source="booking.property", read_only=True)
    author = GuestSummarySerializer(source="booking.guest", read_only=True)

    class Meta:
        model = Review
        fields = ["id", "property", "author", "rating", "comment", "created_at"]
        read_only_fields = fields


class ReviewCreateSerializer(serializers.ModelSerializer):
    """A guest reviews one of their own completed stays, once."""

    booking = serializers.PrimaryKeyRelatedField(queryset=Booking.objects.none())
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    class Meta:
        model = Review
        fields = ["booking", "rating", "comment"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            # Only the user's own bookings are selectable: someone else's id looks like a non-existent one.
            self.fields["booking"].queryset = Booking.objects.filter(guest=request.user)

    def validate_booking(self, booking):
        if booking.status != Booking.Status.COMPLETED:
            raise serializers.ValidationError("Only a completed stay can be reviewed.")
        if Review.objects.filter(booking=booking).exists():
            raise serializers.ValidationError("This stay has already been reviewed.")
        return booking


class ReviewUpdateSerializer(serializers.ModelSerializer):
    """The author may change the rating and comment, nothing else."""

    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)

    class Meta:
        model = Review
        fields = ["rating", "comment"]
