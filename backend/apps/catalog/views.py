from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Avg, Count, Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from apps.accounts.models import Role, User
from apps.accounts.permissions import IsHostOrSuperAdmin, IsOwnerOrSuperAdmin, IsSuperAdminOrReadOnly
from apps.billing import limits
from apps.bookings import services as booking_services
from apps.core.exceptions import Conflict
from apps.core.throttling import UploadRateThrottle

from . import imaging, storage
from .filters import DestinationFilter, FavouriteFilter, PropertyFilter
from .models import Amenity, Destination, Favourite, Property, PropertyImage
from .serializers import (
    AmenitySerializer,
    DestinationSerializer,
    FavouriteSerializer,
    PropertyDetailSerializer,
    PropertyImageSerializer,
    PropertyListSerializer,
    PropertyWriteSerializer,
)

MULTIPART_OVERHEAD = 64 * 1024


class DestinationViewSet(viewsets.ModelViewSet):
    """Public read. Create/update/delete: Super Admin. A destination that still has properties cannot be deleted (409)."""

    serializer_class = DestinationSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    queryset = Destination.objects.annotate(property_count=Count("properties", filter=Q(properties__status=Property.Status.PUBLISHED)))
    filterset_class = DestinationFilter
    search_fields = ["name", "state", "tagline"]
    ordering_fields = ["display_order", "name", "property_count"]
    ordering = ["display_order", "name"]


class AmenityViewSet(viewsets.ModelViewSet):
    """Public read. Create/update/delete: Super Admin."""

    serializer_class = AmenitySerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    queryset = Amenity.objects.all()
    search_fields = ["name"]
    ordering_fields = ["name"]
    ordering = ["name"]


class PropertyViewSet(viewsets.ModelViewSet):
    """Public read. A Host creates properties (always their own) and changes/deletes only their own;
    a Super Admin may do both for any property. A property with bookings cannot be deleted (409)."""

    owner_field = "owner"
    filterset_class = PropertyFilter
    search_fields = ["title", "description", "locality", "destination__name", "destination__state"]
    ordering_fields = ["price_per_night", "created_at", "title", "max_guests", "average_rating"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        qs = (
            Property.objects.select_related("destination", "owner")
            .prefetch_related("images")
            .annotate(average_rating=Avg("bookings__review__rating"), review_count=Count("bookings__review"))
        )
        if self.action != "list":
            qs = qs.prefetch_related("amenities")
        return self._visible(qs)

    def _visible(self, qs):
        """Drafts are private: only their owner (and Super Admins) can see them, and a Host's own drafts show only in
        their own list (``?mine=true``), never in the public one."""
        user = self.request.user
        published = Q(status=Property.Status.PUBLISHED)
        if user.is_authenticated and user.role == Role.SUPER_ADMIN:
            return qs
        if user.is_authenticated and user.role == Role.HOST:
            if self.action != "list" or self.request.query_params.get("mine", "").lower() in ("true", "1"):
                return qs.filter(published | Q(owner=user))
        return qs.filter(published)

    def get_serializer_class(self):
        if self.action == "list":
            return PropertyListSerializer
        if self.action in ("create", "update", "partial_update"):
            return PropertyWriteSerializer
        return PropertyDetailSerializer

    def get_permissions(self):
        if self.action in ("list", "retrieve", "availability"):
            return [AllowAny()]
        if self.action == "create":
            return [IsAuthenticated(), IsHostOrSuperAdmin()]
        return [IsAuthenticated(), IsHostOrSuperAdmin(), IsOwnerOrSuperAdmin()]

    AVAILABILITY_MAX_DAYS = 400

    @action(detail=True, methods=["get"], pagination_class=None, filter_backends=[])
    def availability(self, request, pk=None):
        """Read-only, public: which nights of this property are taken, as merged half-open ranges.

        ``?from=YYYY-MM-DD&to=YYYY-MM-DD`` (default: today to a year ahead, at most 400 days). Nights ``start`` up to
        but not including ``end`` are taken, so a guest may check in on ``end`` and check out on ``start``.
        Only dates are returned: nothing about who booked, or the booking's status or price.
        """
        prop = get_object_or_404(Property.objects.only("id").filter(status=Property.Status.PUBLISHED), pk=pk)
        start = self._date_param(request, "from", booking_services.today())
        end = self._date_param(request, "to", start + timedelta(days=365))
        if end <= start:
            raise ValidationError({"to": ["Must be after 'from'."]})
        if (end - start).days > self.AVAILABILITY_MAX_DAYS:
            raise ValidationError({"to": [f"The window can be at most {self.AVAILABILITY_MAX_DAYS} days."]})
        ranges = booking_services.blocked_ranges(prop, start, end)
        return Response(
            {
                "property": prop.pk,
                "from": start,
                "to": end,
                "max_nights": settings.BOOKING_MAX_NIGHTS,
                "blocked": [{"start": a, "end": b} for a, b in ranges],
            }
        )

    @staticmethod
    def _date_param(request, name, default):
        raw = request.query_params.get(name)
        if raw in (None, ""):
            return default
        field = serializers.DateField()
        try:
            return field.to_internal_value(raw)
        except serializers.ValidationError:
            raise ValidationError({name: ["Use the format YYYY-MM-DD."]})

    def _detail_response(self, instance, status_code):
        fresh = self.get_queryset().get(pk=instance.pk)  # re-read with the rating annotations
        return Response(PropertyDetailSerializer(fresh, context=self.get_serializer_context()).data, status=status_code)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = serializer.validated_data["owner"]
        draft = serializer.validated_data.get("status") == Property.Status.DRAFT
        with transaction.atomic():
            User.objects.select_for_update().get(pk=owner.pk)  # serialise concurrent creates for this Host
            if draft:
                limits.ensure_can_add_draft(owner)  # a draft needs no plan yet, only a sensible cap
            else:
                limits.ensure_can_add_property(owner)
            instance = serializer.save()
        return self._detail_response(instance, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], pagination_class=None, filter_backends=[])
    def publish(self, request, pk=None):
        """Make a draft bookable. The backend re-checks everything: ownership (permission class), a current plan,
        the plan's property and photo limits, premium amenities, and that the listing is complete."""
        prop = self.get_object()
        with transaction.atomic():
            User.objects.select_for_update().get(pk=prop.owner_id)
            prop = Property.objects.select_for_update().get(pk=prop.pk)
            if prop.status == Property.Status.PUBLISHED:
                return self._detail_response(prop, status.HTTP_200_OK)
            sub = limits.current_subscription(prop.owner)
            if sub is None:
                raise PermissionDenied("An active subscription is required to publish.", code="subscription_required")
            missing = []
            if not prop.title.strip():
                missing.append("title")
            if not prop.description.strip():
                missing.append("description")
            if not prop.address_line1.strip():
                missing.append("address")
            if not prop.postal_code.strip():
                missing.append("postal code")
            if prop.price_per_night <= 0:
                missing.append("price per night")
            photos = prop.images.count()
            if photos == 0:
                missing.append("at least one photo")
            if missing:
                raise Conflict(f"Complete the listing first: {', '.join(missing)}.", code="listing_incomplete")
            limits.ensure_can_add_property(prop.owner)  # counts published ones only, so this one fits if the count is below the limit
            max_images = sub.plan.features.get("max_images_per_property")
            if max_images is not None and photos > max_images:
                raise Conflict(f"Your plan allows {max_images} photos per property; this listing has {photos}. Remove some first.", code="plan_limit_reached")
            premium = list(prop.amenities.filter(is_premium=True).values_list("name", flat=True))
            if premium and not sub.plan.features.get("premium_amenities"):
                raise Conflict(f"Your plan does not include: {', '.join(premium)}. Remove them or choose another plan.", code="amenity_not_in_plan")
            prop.status = Property.Status.PUBLISHED
            prop.save(update_fields=["status", "updated_at"])
        return self._detail_response(prop, status.HTTP_200_OK)

    @action(detail=True, methods=["post"], pagination_class=None, filter_backends=[])
    def unpublish(self, request, pk=None):
        """Take a property off the market (back to a draft). Bookings already made are untouched."""
        prop = self.get_object()
        if prop.status != Property.Status.DRAFT:
            prop.status = Property.Status.DRAFT
            prop.save(update_fields=["status", "updated_at"])
        return self._detail_response(prop, status.HTTP_200_OK)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()  # runs the ownership check
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        return self._detail_response(serializer.save(), status.HTTP_200_OK)


class PropertyImageViewSet(viewsets.ModelViewSet):
    """``/api/properties/<id>/images/``. Public read; the property's Host or a Super Admin manages them.

    POST is a multipart upload (field ``image``, optional ``alt_text`` and ``position``). PATCH changes only
    ``alt_text``/``position`` as JSON. The file in Cloudinary is removed when the row is deleted.
    """

    serializer_class = PropertyImageSerializer
    owner_field = "property.owner"
    ordering = ["position", "id"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_parsers(self):
        if self.request is not None and self.request.method == "POST" and not self.request.path.rstrip("/").endswith("/reorder"):
            return [MultiPartParser()]  # uploads are multipart only; the reorder action takes JSON
        return [JSONParser()]

    def get_throttles(self):
        throttles = super().get_throttles()
        if self.request is not None and self.request.method == "POST":
            throttles.append(UploadRateThrottle())
        return throttles

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [AllowAny()]
        return [IsAuthenticated(), IsHostOrSuperAdmin(), IsOwnerOrSuperAdmin()]

    @property
    def parent(self):
        if not hasattr(self, "_parent"):
            parent = get_object_or_404(Property.objects.select_related("owner"), pk=self.kwargs["property_pk"])
            user = self.request.user
            private = parent.status == Property.Status.DRAFT and not (
                user.is_authenticated and (user.role == Role.SUPER_ADMIN or parent.owner_id == user.pk)
            )
            if private:
                raise Http404  # a draft's photos are as private as the draft
            self._parent = parent
        return self._parent

    def get_queryset(self):
        return PropertyImage.objects.filter(property=self.parent).select_related("property__owner")

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "property": self.parent}

    @action(detail=False, methods=["post"], pagination_class=None, filter_backends=[])
    def reorder(self, request, property_pk=None):
        """Set the whole order at once: ``{"order": [image ids]}``. The first becomes the cover (position 0)."""
        self.check_object_permissions(request, PropertyImage(property=self.parent))
        order = request.data.get("order")
        if not isinstance(order, list) or not all(isinstance(i, int) and not isinstance(i, bool) for i in order) or len(set(order)) != len(order):
            raise ValidationError({"order": ["Send a list of distinct image ids."]})
        with transaction.atomic():
            list(Property.objects.select_for_update().filter(pk=self.parent.pk))
            images = {i.pk: i for i in PropertyImage.objects.select_for_update().filter(property=self.parent)}
            if set(order) != set(images):
                raise ValidationError({"order": ["The list must contain every photo of this property exactly once."]})
            for index, pk in enumerate(order):  # two passes, because (property, position) is unique
                PropertyImage.objects.filter(pk=pk).update(position=10000 + index)
            for index, pk in enumerate(order):
                PropertyImage.objects.filter(pk=pk).update(position=index)
        return Response(self.get_serializer(self.get_queryset().order_by("position", "id"), many=True).data)

    def create(self, request, *args, **kwargs):
        # No stored object yet, so run the ownership check against an unsaved image of this property.
        self.check_object_permissions(request, PropertyImage(property=self.parent))
        # Refuse an oversize body before reading any of it.
        declared = request.META.get("CONTENT_LENGTH")
        if declared and declared.isdigit() and int(declared) > settings.IMAGE_MAX_BYTES + MULTIPART_OVERHEAD:
            raise ValidationError({"image": [f"Image is larger than {settings.IMAGE_MAX_BYTES // 1024} KB."]}, code="image_too_large")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        limits.ensure_can_add_image(self.parent)  # cheap early refusal, before any processing or upload
        processed = imaging.process_upload(data["image"])

        key = storage.new_public_id(self.parent)
        result = storage.upload_image(processed.data, key)
        stored_id = result.get("key") or key
        try:
            with transaction.atomic():
                list(Property.objects.select_for_update().filter(pk=self.parent.pk))  # serialise limit + position
                limits.ensure_can_add_image(self.parent)
                position = data.get("position")
                if position is None:
                    last = PropertyImage.objects.filter(property=self.parent).order_by("-position").first()
                    position = 0 if last is None else last.position + 1
                elif PropertyImage.objects.filter(property=self.parent, position=position).exists():
                    raise ValidationError({"position": ["Another image of this property already uses this position."]})
                image = PropertyImage.objects.create(
                    property=self.parent, url=result["url"], storage_key=stored_id, position=position,
                    alt_text=data.get("alt_text", ""), width=processed.width, height=processed.height,
                    size_bytes=processed.size_bytes, format=processed.format, uploaded_by=request.user,
                )
        except IntegrityError:
            storage.delete_image(stored_id)
            raise Conflict("Another image just took this position.", code="position_taken")
        except BaseException:
            storage.delete_image(stored_id)  # the row was not saved, so do not leave the file behind
            raise
        return Response(self.get_serializer(image).data, status=status.HTTP_201_CREATED)


class FavouriteViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    """The signed-in user's saved properties (any role). Saving twice is harmless: 201 the first time, 200 after."""

    serializer_class = FavouriteSerializer
    permission_classes = [IsAuthenticated]
    filterset_class = FavouriteFilter
    ordering_fields = ["created_at"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return Favourite.objects.filter(user=self.request.user).select_related("property__destination").prefetch_related("property__images")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        favourite, created = Favourite.objects.get_or_create(user=request.user, property=serializer.validated_data["property"])
        favourite = self.get_queryset().get(pk=favourite.pk)
        return Response(self.get_serializer(favourite).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
