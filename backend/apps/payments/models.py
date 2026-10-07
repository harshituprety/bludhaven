from django.db import models


class Payment(models.Model):
    """The money side of one guest booking (Razorpay). One row per booking, never a second one.

    Holds identifiers and amounts only: no card data ever reaches this server (Razorpay Checkout handles it).
    ``amount_paise`` is fixed by the server when the order is created, from ``Booking.total_price``.
    """

    class Status(models.TextChoices):
        CREATED = "CREATED", "Order created"
        PAID = "PAID", "Paid"
        FAILED = "FAILED", "Failed"
        REFUND_REQUIRED = "REFUND_REQUIRED", "Refund required"  # money arrived but the booking could not be confirmed

    class Source(models.TextChoices):
        CHECKOUT = "CHECKOUT", "Checkout verification"
        WEBHOOK = "WEBHOOK", "Webhook"

    booking = models.OneToOneField("bookings.Booking", on_delete=models.PROTECT, related_name="payment")
    provider = models.CharField(max_length=20, default="razorpay", editable=False)
    razorpay_order_id = models.CharField(max_length=64, unique=True)
    razorpay_payment_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    amount_paise = models.PositiveBigIntegerField()
    currency = models.CharField(max_length=3, default="INR")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.CREATED)
    verified_via = models.CharField(max_length=10, choices=Source.choices, blank=True, default="")
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status"], name="payment_status_idx")]

    def __str__(self):
        return f"Payment {self.razorpay_order_id} ({self.status})"
