from decimal import Decimal

from rest_framework import serializers

from apps.accounts.models import Role, User

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
        return count if count is not None else obj.properties.count()


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ["id", "name"]


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


class PropertyDetailSerializer(PropertyListSerializer):
    owner = OwnerSummarySerializer(read_only=True)
    amenities = AmenitySerializer(many=True, read_only=True)
    images = PropertyImageSerializer(many=True, read_only=True)

    class Meta(PropertyListSerializer.Meta):
        fields = PropertyListSerializer.Meta.fields + ["description", "owner", "amenities", "images", "updated_at"]
        read_only_fields = fields


class PropertyWriteSerializer(serializers.ModelSerializer):
    """Create/update input. Only the listed fields can be written; ratings, images and timestamps cannot.

    A Host's properties are always their own. Only a Super Admin supplies (create) or changes (update) ``owner``.
    """

    destination = serializers.PrimaryKeyRelatedField(queryset=Destination.objects.all())
    amenities = serializers.PrimaryKeyRelatedField(many=True, queryset=Amenity.objects.all(), required=False)
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.filter(role=Role.HOST, is_active=True), required=False)
    price_per_night = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    max_guests = serializers.IntegerField(min_value=1, max_value=32767)
    bedrooms = serializers.IntegerField(min_value=0, max_value=32767, required=False)
    bathrooms = serializers.IntegerField(min_value=0, max_value=32767, required=False)

    class Meta:
        model = Property
        fields = [
            "owner", "destination", "title", "description", "property_type", "locality",
            "price_per_night", "max_guests", "bedrooms", "bathrooms", "amenities",
        ]

    def validate(self, attrs):
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
    property_id = serializers.PrimaryKeyRelatedField(source="property", queryset=Property.objects.all(), write_only=True)

    class Meta:
        model = Favourite
        fields = ["id", "property", "property_id", "created_at"]
        read_only_fields = ["id", "created_at"]
