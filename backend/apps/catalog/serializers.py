from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Role, User
from apps.billing import limits

from .models import Amenity, Destination, Favourite, Property, PropertyImage


# --- small reusable pieces ------------------------------------------------------


class OwnerSummarySerializer(serializers.ModelSerializer):
    """What the public may see about a Host: a name, never an email address."""

    class Meta:
        model = User
        fields = ["id", "full_name"]
        read_only_fields = fields


class DestinationBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Destination
        fields = ["id", "name", "state"]
        read_only_fields = fields


# --- destinations and amenities --------------------------------------------------


class DestinationSerializer(serializers.ModelSerializer):
    property_count = serializers.SerializerMethodField()

    class Meta:
        model = Destination
        fields = ["id", "name", "state", "tagline", "image_url", "display_order", "property_count"]

    def get_property_count(self, obj):
        count = getattr(obj, "property_count", None)  # annotated on list/detail; counted after a write
        return count if count is not None else obj.properties.filter(status=Property.Status.PUBLISHED).count()


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ["id", "name", "is_premium"]


# --- images ------------------------------------------------------------------------


class PropertyImageSerializer(serializers.ModelSerializer):
    """What the API shows about a stored image. ``position`` 0 is the cover.

    Creating takes a multipart ``image`` file (never a URL); the server stores it in Cloudinary and fills in
    ``url`` and the file facts. Updating can change only ``alt_text`` and ``position``.
    ``storage_key`` (the Cloudinary public ID) is never exposed.
    """

    position = serializers.IntegerField(min_value=0, max_value=32767, required=False)
    image = serializers.FileField(write_only=True, required=False, allow_empty_file=True)

    class Meta:
        model = PropertyImage
        fields = ["id", "url", "alt_text", "position", "width", "height", "size_bytes", "format", "created_at", "image"]
        read_only_fields = ["id", "url", "width", "height", "size_bytes", "format", "created_at"]

    def validate(self, attrs):
        if self.instance is None and "image" not in attrs:
            raise serializers.ValidationError({"image": ["This field is required (multipart file upload)."]})
        if self.instance is not None and "image" in attrs:
            raise serializers.ValidationError({"image": ["An image cannot be replaced. Upload a new one and delete this one."]})
        return attrs

    def validate_position(self, value):
        taken = PropertyImage.objects.filter(property=self.context["property"], position=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Another image of this property already uses this position.")
        return value


# --- properties ----------------------------------------------------------------------


def _rounded(value):
    return None if value is None else round(float(value), 2)


class PropertyListSerializer(serializers.ModelSerializer):
    """The card: everything a listing grid needs, nothing more."""

    destination = DestinationBriefSerializer(read_only=True)
    cover_image = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Property
        fields = [
            "id", "title", "property_type", "locality", "destination", "price_per_night",
            "max_guests", "bedrooms", "bathrooms", "cover_image", "average_rating", "review_count", "created_at",
        ]
        read_only_fields = fields

    def get_cover_image(self, obj):
        images = list(obj.images.all())  # prefetched, already ordered by position
        return images[0].url if images else None

    def get_average_rating(self, obj):
        return _rounded(getattr(obj, "average_rating", None))


PRIVATE_FIELDS = ("address_line1", "address_line2", "postal_code")


class PropertyDetailSerializer(PropertyListSerializer):
    owner = OwnerSummarySerializer(read_only=True)
    amenities = AmenitySerializer(many=True, read_only=True)
    images = PropertyImageSerializer(many=True, read_only=True)

    class Meta(PropertyListSerializer.Meta):
        fields = PropertyListSerializer.Meta.fields + ["description", "owner", "amenities", "images", "updated_at"]
        read_only_fields = fields

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated and (user.role == Role.SUPER_ADMIN or instance.owner_id == user.pk):
            data["status"] = instance.status
            for name in PRIVATE_FIELDS:  # the street address goes only to the owner and Super Admins
                data[name] = getattr(instance, name)
        return data


class PropertyWriteSerializer(serializers.ModelSerializer):
    """Create/update input. Only the listed fields can be written; ratings, images and timestamps cannot.

    A Host's properties are always their own. Only a Super Admin supplies (create) or changes (update) ``owner``.
    """

    destination = serializers.PrimaryKeyRelatedField(queryset=Destination.objects.all())
    amenities = serializers.PrimaryKeyRelatedField(many=True, queryset=Amenity.objects.all(), required=False)
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=Role.HOST, is_active=True), required=False)
    # A draft is allowed to be unfinished (no title, description or price yet); everything else must be complete.
    title = serializers.CharField(max_length=150, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)
    price_per_night = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"), required=False)
    max_guests = serializers.IntegerField(min_value=1, max_value=32767)
    bedrooms = serializers.IntegerField(min_value=0, max_value=32767, required=False)
    bathrooms = serializers.IntegerField(min_value=0, max_value=32767, required=False)
    # Only a create may choose the status (DRAFT for the onboarding wizard). Later, publish/unpublish change it.
    status = serializers.ChoiceField(choices=Property.Status.choices, required=False)

    class Meta:
        model = Property
        fields = [
            "owner", "destination", "title", "description", "property_type", "locality",
            "price_per_night", "max_guests", "bedrooms", "bathrooms", "amenities", "status",
            "address_line1", "address_line2", "postal_code",
        ]

    def validate_status(self, value):
        if self.instance is not None:
            raise serializers.ValidationError("Use the publish or unpublish action to change the status.")
        return value

    def validate(self, attrs):
        self._require_complete_unless_draft(attrs)
        user = self.context["request"].user
        if user.role == Role.SUPER_ADMIN:
            if self.instance is None and "owner" not in attrs:
                raise serializers.ValidationError({"owner": "This field is required."})
            return attrs
        # A Host: the owner is themselves, whatever the payload says.
        if "owner" in attrs and attrs["owner"].pk != user.pk:
            raise serializers.ValidationError({"owner": "Only a Super Admin can choose or change the owner."})
        attrs["owner"] = user
        return attrs

    def _require_complete_unless_draft(self, attrs):
        draft = (attrs.get("status") if self.instance is None else self.instance.status) == Property.Status.DRAFT
        errors = {}
        for name in ("title", "description"):
            value = attrs.get(name, getattr(self.instance, name, None) if self.instance else None)
            if not draft and (value is None or not str(value).strip()):
                errors[name] = "This field is required." if value is None else "This field may not be blank."
        price = attrs.get("price_per_night", self.instance.price_per_night if self.instance else None)
        if price is None and draft:
            attrs["price_per_night"] = Decimal("0")
        elif not draft and (price is None or price < Decimal("0.01")):
            errors["price_per_night"] = "This field is required." if price is None else "Ensure this value is greater than or equal to 0.01."
        if errors:
            raise serializers.ValidationError(errors)

    def validate_amenities(self, value):
        """Backend entitlement check: premium amenities need a plan with ``premium_amenities``. Not just hidden in React."""
        premium = [a for a in value if a.is_premium]
        if not premium:
            return value
        owner = self.initial_owner()
        already = set(self.instance.amenities.filter(is_premium=True).values_list("pk", flat=True)) if self.instance else set()
        new = [a for a in premium if a.pk not in already]
        if new and not (owner and limits.allows_premium_amenities(owner)):
            raise serializers.ValidationError(
                f"Your plan does not include: {', '.join(a.name for a in new)}. Choose a plan with premium amenities.",
                code="amenity_not_in_plan",
            )
        return value

    def initial_owner(self):
        user = self.context["request"].user
        if user.role != Role.SUPER_ADMIN:
            return user
        if self.instance is not None:
            return self.instance.owner
        pk = self.initial_data.get("owner") if hasattr(self, "initial_data") else None
        return User.objects.filter(pk=pk, role=Role.HOST).first() if str(pk).isdigit() else None

    def create(self, validated_data):
        amenities = validated_data.pop("amenities", [])
        prop = Property.objects.create(**validated_data)
        prop.amenities.set(amenities)
        return prop

    def update(self, instance, validated_data):
        amenities = validated_data.pop("amenities", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if amenities is not None:
            instance.amenities.set(amenities)
        return instance


# --- favourites --------------------------------------------------------------------------


class PropertySummarySerializer(serializers.ModelSerializer):
    destination = DestinationBriefSerializer(read_only=True)
    cover_image = serializers.SerializerMethodField()

    class Meta:
        model = Property
        fields = ["id", "title", "property_type", "locality", "destination", "price_per_night", "cover_image"]
        read_only_fields = fields

    def get_cover_image(self, obj):
        images = list(obj.images.all())
        return images[0].url if images else None


class FavouriteSerializer(serializers.ModelSerializer):
    property = PropertySummarySerializer(read_only=True)
    property_id = serializers.PrimaryKeyRelatedField(source="property", queryset=Property.objects.filter(status=Property.Status.PUBLISHED), write_only=True)

    class Meta:
        model = Favourite
        fields = ["id", "property", "property_id", "created_at"]
        read_only_fields = ["id", "created_at"]
