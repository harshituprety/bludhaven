from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role, User
from apps.accounts.permissions import IsHost, IsHostOrSuperAdmin, IsSuperAdmin
from apps.core.exceptions import Conflict

from . import limits, purchases
from .filters import BillingProfileFilter, PlanFilter, SubscriptionFilter
from .models import BillingProfile, Subscription, SubscriptionPlan
from .serializers import (
    AdminBillingProfileSerializer,
    BillingProfileSerializer,
    SubscriptionCreateSerializer,
    SubscriptionPlanSerializer,
    SubscriptionRenewSerializer,
    SubscriptionSerializer,
    SubscriptionUpdateSerializer,
)


class SubscriptionPlanViewSet(viewsets.ModelViewSet):
    """Plans are public to read (anonymous visitors and every role see active plans only; a Super Admin sees all).
    Super Admin creates/edits/deletes.
    A plan that has subscriptions cannot be deleted (409): deactivate it instead."""

    serializer_class = SubscriptionPlanSerializer
    filterset_class = PlanFilter
    search_fields = ["name", "description"]
    ordering_fields = ["display_order", "price", "name", "duration_days", "created_at"]
    ordering = ["display_order", "price", "name"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [AllowAny()]
        return [IsAuthenticated(), IsSuperAdmin()]

    def get_queryset(self):
        qs = SubscriptionPlan.objects.all()
        user = self.request.user
        if not (user.is_authenticated and user.role == Role.SUPER_ADMIN):
            qs = qs.filter(is_active=True)
        return qs


class SubscriptionViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet
):
    """Super Admin: list/assign/update everything. Host: read own (plus ``current``). No delete: cancel instead."""

    filterset_class = SubscriptionFilter
    ordering_fields = ["start_date", "expiry_date", "created_at"]
    ordering = ["-start_date", "-id"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action == "current":
            return [IsAuthenticated(), IsHost()]
        if self.action in ("list", "retrieve"):
            return [IsAuthenticated(), IsHostOrSuperAdmin()]
        return [IsAuthenticated(), IsSuperAdmin()]

    def get_queryset(self):
        qs = Subscription.objects.select_related("user", "plan")
        user = self.request.user
        return qs if user.role == Role.SUPER_ADMIN else qs.filter(user=user)

    def get_serializer_class(self):
        if self.action == "create":
            return SubscriptionCreateSerializer
        if self.action == "partial_update":
            return SubscriptionUpdateSerializer
        return SubscriptionSerializer

    def _out(self, instance, code):
        return Response(SubscriptionSerializer(self.get_queryset().get(pk=instance.pk), context=self.get_serializer_context()).data, status=code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        with transaction.atomic():
            User.objects.select_for_update().get(pk=d["user"].pk)  # serialise assignments for this Host
            overlapping = Subscription.objects.filter(
                user=d["user"], status__in=Subscription.ENTITLING, start_date__lt=d["expiry_date"], expiry_date__gt=d["start_date"]
            )
            if overlapping.exists():
                raise Conflict("This Host already has an active subscription covering those dates. Cancel it first.", code="subscription_overlap")
            sub = Subscription.objects.create(
                user=d["user"], plan=d["plan"], amount=d["plan"].price, start_date=d["start_date"], expiry_date=d["expiry_date"],
                payment_status=d.get("payment_status", Subscription.PaymentStatus.PENDING),
            )
        return self._out(sub, status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        sub = self.get_object()
        serializer = self.get_serializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        if "status" in d and d["status"] != sub.status:
            S = Subscription.Status
            ending = (S.CANCELLED, S.EXPIRED, S.SUSPENDED)
            if sub.status in Subscription.ENTITLING and d["status"] in ending:
                pass
            elif sub.status == S.SUSPENDED and d["status"] in (S.ACTIVE, S.CANCELLED, S.EXPIRED):
                pass  # a suspension can be lifted (or turned into an ending)
            else:
                raise Conflict(f"A {sub.status.lower()} subscription cannot change status to {d['status'].lower()}.", code="invalid_transition")
            sub.status = d["status"]
        if "payment_status" in d:
            sub.payment_status = d["payment_status"]
        sub.save()
        return self._out(sub, status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def renew(self, request, pk=None):
        """Extend a subscription by one more period of its plan (Super Admin).

        The new expiry is ``max(expiry, today) + plan.duration_days``. A subscription that has already lapsed
        restarts today (``start_date`` moves to today) so the gap is never counted as covered. The ``amount`` (price
        snapshot) is kept. ``payment_status`` becomes ``payment_status`` from the body, else PENDING (the new period
        is unpaid until a Super Admin marks it). CANCELLED subscriptions cannot be renewed; assign a new one.
        """
        serializer = SubscriptionRenewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            sub = Subscription.objects.select_related("plan").select_for_update().get(pk=self.get_object().pk)
            User.objects.select_for_update().get(pk=sub.user_id)  # serialise with assignments for this Host
            if sub.status == Subscription.Status.CANCELLED:
                raise Conflict("A cancelled subscription cannot be renewed. Assign a new one.", code="invalid_transition")
            if not sub.plan.is_active:
                raise Conflict("This plan is no longer offered. Assign an active plan instead.", code="plan_inactive")
            today = limits.today()
            lapsed = sub.expiry_date <= today
            new_start = today if lapsed else sub.start_date
            new_expiry = max(sub.expiry_date, today) + timedelta(days=sub.plan.duration_days)
            clash = Subscription.objects.filter(
                user_id=sub.user_id, status=Subscription.Status.ACTIVE, start_date__lt=new_expiry, expiry_date__gt=new_start
            ).exclude(pk=sub.pk)
            if clash.exists():
                raise Conflict("Renewing would overlap another active subscription of this Host.", code="subscription_overlap")
            sub.start_date, sub.expiry_date, sub.status = new_start, new_expiry, Subscription.Status.ACTIVE
            sub.payment_status = serializer.validated_data.get("payment_status", Subscription.PaymentStatus.PENDING)
            sub.save()
        return self._out(sub, status.HTTP_200_OK)

    @action(detail=False, methods=["get"])
    def current(self, request):
        """The signed-in Host's entitling subscription (or null) and their usage against its limits."""
        sub = limits.current_subscription(request.user)
        data = SubscriptionSerializer(sub, context=self.get_serializer_context()).data if sub else None
        queued = purchases.scheduled_change(request.user)
        scheduled = SubscriptionSerializer(queued, context=self.get_serializer_context()).data if queued else None
        return Response({"subscription": data, "scheduled_change": scheduled, "usage": limits.usage(request.user)})


class MyBillingProfileView(APIView):
    """A Host's own billing details: GET (200 with ``null`` until they are set), PUT/PATCH to create or change."""

    permission_classes = [IsAuthenticated, IsHost]

    def get(self, request):
        profile = BillingProfile.objects.filter(user=request.user).first()
        if profile is None:
            # "No billing details yet" is a normal state for a new Host, not an error: 200 with a JSON null.
            # (DRF's renderer would send an empty body for None, which is not valid JSON, so this is answered directly.)
            return JsonResponse(None, safe=False)
        return Response(BillingProfileSerializer(profile).data)

    def put(self, request):
        return self._save(request, partial=False)

    def patch(self, request):
        return self._save(request, partial=True)

    def _save(self, request, partial):
        profile = BillingProfile.objects.filter(user=request.user).first()
        if profile is None and partial:
            partial = False  # nothing to patch: treat as a create, which needs every required field
        serializer = BillingProfileSerializer(profile, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data, status=status.HTTP_200_OK if profile else status.HTTP_201_CREATED)


class BillingProfileAdminViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Super Admin read-only view of every Host's billing profile (``?user=<id>``)."""

    permission_classes = [IsAuthenticated, IsSuperAdmin]
    serializer_class = AdminBillingProfileSerializer
    filterset_class = BillingProfileFilter
    queryset = BillingProfile.objects.select_related("user")
    lookup_field = "user_id"  # the URL id is the Host's user id (profiles have no public id of their own)
    ordering = ["-id"]
