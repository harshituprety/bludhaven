from django.db import IntegrityError, transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.accounts.permissions import IsEmailVerified, IsEndUser, IsOwnerOrSuperAdmin, IsSuperAdmin
from apps.core.exceptions import Conflict

from . import services
from .filters import BookingFilter, ReviewFilter
from .models import Booking, Review
from .serializers import (
    BookingCreateSerializer,
    BookingQuoteSerializer,
    BookingSerializer,
    ReviewCreateSerializer,
    ReviewSerializer,
    ReviewUpdateSerializer,
)


class BookingViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """Bookings are visible only to the guest, the Host of the property, and Super Admins (anything else is a 404).

    * quote: an End User asks what a stay would cost (computed by the server; saves nothing)
    * create: an End User with a verified email (price, status and expiry are set by the server). The booking is
      PENDING, holds its dates for BOOKING_PAYMENT_WINDOW_MINUTES, and becomes CONFIRMED only through a verified
      payment (``POST /api/bookings/{id}/payment/`` and ``.../payment/verify/``, see apps/payments). There is no
      confirm action: nobody confirms a booking by hand.
    * cancel / complete: see ``services.py`` for who may do what, and when
    * delete: Super Admin only (bookings are normally cancelled, not deleted)
    There is no edit: to change dates or guests, cancel and book again.
    """

    filterset_class = BookingFilter
    ordering_fields = ["created_at", "check_in", "check_out", "total_price"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        user = self.request.user
        services.expire_stale()  # keeps the stored status truthful; availability does not depend on it
        qs = Booking.objects.select_related("property__destination", "property__owner", "guest", "review", "payment")
        if user.role == Role.SUPER_ADMIN:
            return qs
        if user.role == Role.HOST:
            return qs.filter(property__owner=user)
        return qs.filter(guest=user)

    def get_serializer_class(self):
        return BookingCreateSerializer if self.action == "create" else BookingSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsEndUser(), IsEmailVerified()]
        if self.action == "quote":
            return [IsAuthenticated(), IsEndUser()]
        if self.action == "destroy":
            return [IsAuthenticated(), IsSuperAdmin()]
        return [IsAuthenticated()]

    @action(detail=False, methods=["post"])
    def quote(self, request):
        serializer = BookingQuoteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        return Response(serializer.to_quote())

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        booking = serializer.save()
        booking = self.get_queryset().get(pk=booking.pk)
        return Response(BookingSerializer(booking, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    def _transition(self, request, name):
        booking = services.transition(self.get_object(), name, request.user)
        booking = self.get_queryset().get(pk=booking.pk)
        return Response(BookingSerializer(booking, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        return self._transition(request, "cancel")

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        return self._transition(request, "complete")


class ReviewViewSet(viewsets.ModelViewSet):
    """Reviews are public to read. Only the guest of a completed stay writes one (once) and edits it;
    the author or a Super Admin may delete it. A Host cannot write, edit or delete reviews of their property."""

    owner_field = "booking.guest"
    filterset_class = ReviewFilter
    ordering_fields = ["created_at", "rating"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return Review.objects.select_related("booking__guest", "booking__property")

    def get_serializer_class(self):
        return {"create": ReviewCreateSerializer, "update": ReviewUpdateSerializer, "partial_update": ReviewUpdateSerializer}.get(
            self.action, ReviewSerializer
        )

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [AllowAny()]
        if self.action == "create":
            return [IsAuthenticated(), IsEndUser(), IsEmailVerified()]
        if self.action in ("update", "partial_update"):
            return [IsAuthenticated(), IsEndUser(), IsOwnerOrSuperAdmin()]
        return [IsAuthenticated(), IsOwnerOrSuperAdmin()]  # destroy: the author, or a Super Admin

    def _show(self, review, status_code):
        review = self.get_queryset().get(pk=review.pk)
        return Response(ReviewSerializer(review, context=self.get_serializer_context()).data, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                review = serializer.save()
        except IntegrityError:  # two submissions racing past the "already reviewed" check
            raise Conflict("This stay has already been reviewed.", code="already_reviewed")
        return self._show(review, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        review = self.get_object()
        serializer = self.get_serializer(review, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        return self._show(serializer.save(), status.HTTP_200_OK)
