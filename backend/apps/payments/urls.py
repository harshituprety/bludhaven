from django.urls import path

from .views import InitiatePaymentView, RazorpayWebhookView, VerifyPaymentView

urlpatterns = [
    path("bookings/<int:pk>/payment/", InitiatePaymentView.as_view(), name="booking-payment"),
    path("bookings/<int:pk>/payment/verify/", VerifyPaymentView.as_view(), name="booking-payment-verify"),
    path("payments/razorpay/webhook/", RazorpayWebhookView.as_view(), name="razorpay-webhook"),
]
