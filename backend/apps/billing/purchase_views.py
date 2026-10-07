"""Self-serve Host billing endpoints (Hosts) and the Super Admin's wallet / payment views.

Host (all need a signed-in, email-verified Host; money moves only through ``purchases``):

* ``GET  /api/billing/wallet/``                   balance
* ``GET  /api/billing/wallet/transactions/``      the wallet statement
* ``POST /api/billing/wallet/topup/``             start a top-up   {amount: whole rupees}
* ``POST /api/billing/subscription/quote/``       what a plan would cost right now   {plan, use_wallet}
* ``POST /api/billing/subscription/checkout/``    buy / change / renew / start a trial   {plan, use_wallet}
* ``POST /api/billing/subscription/cancel/`` and ``.../resume/``
* ``POST /api/billing/payments/verify/``          the browser reports a finished Checkout (plan purchase or top-up)
* ``GET  /api/billing/payments/``                 the Host's payments

Super Admin: ``/api/wallets/``, ``/api/wallet-transactions/``, ``/api/billing-payments/`` (read) and
``POST /api/wallets/{user_id}/adjust/``.
"""

from django.http import Http404
from rest_framework import mixins, status, viewsets
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.accounts.permissions import IsEmailVerified, IsHost, IsSuperAdmin
from apps.core.exceptions import Conflict
from apps.core.throttling import PaymentRateThrottle

from . import limits, purchases
from .filters import BillingPaymentFilter, WalletFilter, WalletTransactionFilter
from .models import BillingPayment, HostWallet, SubscriptionPlan, WalletTransaction
from .serializers import (
    AdjustWalletSerializer,
    AdminBillingPaymentSerializer,
    AdminWalletSerializer,
    AdminWalletTransactionSerializer,
    BillingPaymentSerializer,
    PlanChoiceSerializer,
    SubscriptionSerializer,
    TopUpSerializer,
    VerifyBillingSerializer,
    WalletSerializer,
    WalletTransactionSerializer,
    rupees,
)


class _HostBillingView(APIView):
    permission_classes = [IsAuthenticated, IsHost, IsEmailVerified]
    throttle_classes = [PaymentRateThrottle]


def _subscription_state(request, sub):
    """The Host's current subscription and usage, in the shape the Subscription page uses."""
    data = SubscriptionSerializer(sub, context={"request": request}).data if sub else None
    return {"subscription": data, "usage": limits.usage(request.user)}


def _wallet_state(user):
    return WalletSerializer(purchases.wallet_for(user)).data


class WalletView(_HostBillingView):
    def get(self, request):
        return Response(_wallet_state(request.user))


class WalletTransactionsView(ListAPIView, _HostBillingView):
    serializer_class = WalletTransactionSerializer

    def get_queryset(self):
        return WalletTransaction.objects.filter(user=self.request.user)


class MyBillingPaymentsView(ListAPIView, _HostBillingView):
    serializer_class = BillingPaymentSerializer

    def get_queryset(self):
        return BillingPayment.objects.filter(user=self.request.user).select_related("plan")


class TopUpView(_HostBillingView):
    def post(self, request):
        data = TopUpSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        return Response(purchases.start_topup(request.user, data.validated_data["amount"]), status=status.HTTP_201_CREATED)


def _plan_or_404(plan_id):
    plan = SubscriptionPlan.objects.filter(pk=plan_id).first()
    if plan is None:
        raise Http404
    return plan


class QuoteView(_HostBillingView):
    def post(self, request):
        data = PlanChoiceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        plan = _plan_or_404(data.validated_data["plan"])
        q = purchases.quote(request.user, plan, data.validated_data["use_wallet"])
        return Response(
            {
                "kind": q["kind"],
                "plan": {"id": plan.pk, "name": plan.name, "duration_days": plan.duration_days, "features": plan.features, "is_trial": plan.is_trial},
                "price_paise": q["price_paise"], "price": rupees(q["price_paise"]),
                "credit_paise": q["credit_paise"], "credit": rupees(q["credit_paise"]),
                "wallet_paise": q["wallet_paise"], "wallet_applied": rupees(q["wallet_paise"]),
                "amount_paise": q["amount_paise"], "amount_due": rupees(q["amount_paise"]),
                "wallet_balance_paise": q["wallet_balance_paise"], "wallet_balance": rupees(q["wallet_balance_paise"]),
                "start_date": q["start_date"], "expiry_date": q["expiry_date"],
                "replaces": q["previous"].plan.name if q["previous"] and q["kind"] == BillingPayment.Kind.CHANGE else None,
                "blockers": q["blockers"],
            }
        )


class CheckoutView(_HostBillingView):
    def post(self, request):
        data = PlanChoiceSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        result = purchases.checkout(request.user, data.validated_data["plan"], data.validated_data["use_wallet"])
        if result["status"] == "activated":
            return Response({"status": "activated", **_subscription_state(request, result["subscription"]), "wallet": _wallet_state(request.user)})
        result.pop("payment")
        return Response(result, status=status.HTTP_201_CREATED)


class VerifyBillingView(_HostBillingView):
    def post(self, request):
        data = VerifyBillingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        d = data.validated_data
        outcome = purchases.verify_checkout(request.user, d["razorpay_order_id"], d["razorpay_payment_id"], d["razorpay_signature"])
        if outcome == purchases.REFUND_REQUIRED:
            raise Conflict(
                "Your payment arrived but could not be applied, so nothing was changed. "
                "It will be refunded; please contact Customer Care if you do not see the refund.",
                code="payment_not_applied",
            )
        if outcome == purchases.IGNORED:  # pragma: no cover - verify_checkout checks everything settle checks
            raise Conflict("The payment could not be applied.", code="payment_not_applied")
        return Response({"status": outcome, **_subscription_state(request, limits.current_subscription(request.user)), "wallet": _wallet_state(request.user)})


class CancelView(_HostBillingView):
    def post(self, request):
        sub = purchases.cancel(request.user)
        return Response({**_subscription_state(request, sub), "wallet": _wallet_state(request.user)})


class ResumeView(_HostBillingView):
    def post(self, request):
        sub = purchases.resume(request.user)
        return Response(_subscription_state(request, sub))


# --- Super Admin -------------------------------------------------------------------------------------------------------


class _AdminReadViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated, IsSuperAdmin]


class AdminWalletViewSet(_AdminReadViewSet):
    serializer_class = AdminWalletSerializer
    filterset_class = WalletFilter
    queryset = HostWallet.objects.select_related("user")
    ordering = ["-updated_at", "-id"]


class AdminWalletTransactionViewSet(_AdminReadViewSet):
    serializer_class = AdminWalletTransactionSerializer
    filterset_class = WalletTransactionFilter
    queryset = WalletTransaction.objects.select_related("user")
    ordering = ["-created_at", "-id"]


class AdminBillingPaymentViewSet(_AdminReadViewSet):
    serializer_class = AdminBillingPaymentSerializer
    filterset_class = BillingPaymentFilter
    queryset = BillingPayment.objects.select_related("user", "plan")
    ordering = ["-created_at", "-id"]


class AdminAdjustWalletView(APIView):
    """``POST /api/wallets/{user_id}/adjust/``: credit or debit a Host's wallet, with a reason."""

    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, user_id):
        host = User.objects.filter(pk=user_id, role=Role.HOST).first()
        if host is None:
            raise Http404
        data = AdjustWalletSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        tx = purchases.adjust_wallet(request.user, host, purchases.to_paise(data.validated_data["amount"]), data.validated_data["reason"])
        return Response(AdminWalletTransactionSerializer(tx).data, status=status.HTTP_201_CREATED)
