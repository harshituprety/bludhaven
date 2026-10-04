"""Stays and the feedback on them."""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import F, Q


class Booking(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        CANCELLED = "CANCELLED", "Cancelled"
        COMPLETED = "COMPLETED", "Completed"

    guest = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bookings")
    property = models.ForeignKey("catalog.Property", on_delete=models.PROTECT, related_name="bookings")
    check_in = models.DateField()
    check_out = models.DateField()
    guests_count = models.PositiveSmallIntegerField()
    total_price = models.DecimalField(max_digits=10, decimal_places=2, help_text="Indian rupees, fixed at booking time.")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(check_out__gt=F("check_in")), name="booking_checkout_after_checkin"),
            models.CheckConstraint(condition=Q(guests_count__gte=1), name="booking_guests_at_least_1"),
            models.CheckConstraint(condition=Q(total_price__gte=0), name="booking_total_not_negative"),
        ]
        indexes = [
            # For availability lookups: bookings of a property overlapping a date range.
            models.Index(fields=["property", "check_in", "check_out"], name="booking_availability_idx"),
        ]

    def __str__(self):
        return f"Booking {self.pk}: {self.property_id} {self.check_in}→{self.check_out}"


class Review(models.Model):
    """One review per booking. Tying it to a booking means only guests who actually booked can review,
    which is what the site's FAQ promises; the guest and the property are reached through the booking."""

    booking = models.OneToOneField(Booking, on_delete=models.CASCADE, related_name="review")
    rating = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    comment = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=Q(rating__gte=1, rating__lte=5), name="review_rating_1_to_5"),
        ]

    def __str__(self):
        return f"Review {self.pk}: {self.rating}/5"
