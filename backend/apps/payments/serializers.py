from rest_framework import serializers


class VerifyPaymentSerializer(serializers.Serializer):
    """What Razorpay Checkout hands the browser. Used only to look the payment up; nothing here is trusted."""

    razorpay_order_id = serializers.CharField(max_length=64)
    razorpay_payment_id = serializers.CharField(max_length=64)
    razorpay_signature = serializers.CharField(max_length=256)
