from django.urls import path
from rest_framework.routers import SimpleRouter

from .purchase_views import (
    AdminAdjustWalletView,
    AdminBillingPaymentViewSet,
    AdminWalletTransactionViewSet,
    AdminWalletViewSet,
    CancelView,
    CheckoutView,
    MyBillingPaymentsView,
    QuoteView,
    ResumeView,
    TopUpView,
    VerifyBillingView,
    WalletTransactionsView,
    WalletView,
)
from .views import BillingProfileAdminViewSet, MyBillingProfileView, SubscriptionPlanViewSet, SubscriptionViewSet

router = SimpleRouter()
router.register("plans", SubscriptionPlanViewSet, basename="plan")
router.register("subscriptions", SubscriptionViewSet, basename="subscription")
router.register("billing-profiles", BillingProfileAdminViewSet, basename="billing-profile")
router.register("wallets", AdminWalletViewSet, basename="admin-wallet")
router.register("wallet-transactions", AdminWalletTransactionViewSet, basename="admin-wallet-transaction")
router.register("billing-payments", AdminBillingPaymentViewSet, basename="admin-billing-payment")

urlpatterns = [
    path("billing-profile/", MyBillingProfileView.as_view(), name="my-billing-profile"),
    # Host: self-serve billing
    path("billing/wallet/", WalletView.as_view(), name="billing-wallet"),
    path("billing/wallet/transactions/", WalletTransactionsView.as_view(), name="billing-wallet-transactions"),
    path("billing/wallet/topup/", TopUpView.as_view(), name="billing-wallet-topup"),
    path("billing/subscription/quote/", QuoteView.as_view(), name="billing-quote"),
    path("billing/subscription/checkout/", CheckoutView.as_view(), name="billing-checkout"),
    path("billing/subscription/cancel/", CancelView.as_view(), name="billing-cancel"),
    path("billing/subscription/resume/", ResumeView.as_view(), name="billing-resume"),
    path("billing/payments/", MyBillingPaymentsView.as_view(), name="billing-payments"),
    path("billing/payments/verify/", VerifyBillingView.as_view(), name="billing-verify"),
    # Super Admin
    path("wallets/<int:user_id>/adjust/", AdminAdjustWalletView.as_view(), name="admin-wallet-adjust"),
] + router.urls
