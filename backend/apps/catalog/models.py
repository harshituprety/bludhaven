"""What can be browsed and booked: destinations, properties and their photos.

Derived values (average rating, review count, stays per destination) are NOT stored;
they are computed from reviews/properties when needed.
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class Destination(models.Model):
    """A city guests search by. Mirrors the frontend's destination cards."""

    name = models.CharField(max_length=100, unique=True)
    state = models.CharField(max_length=100)
    tagline = models.CharField(max_length=200, blank=True)
    # A URL reference only (cloud storage later); never the image bytes.
    image_url = models.URLField(max_length=500, blank=True)
    # The home page features the first few destinations, so the order is curated, not alphabetical.
    display_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["display_order", "name"]

    def __str__(self):
        return f"{self.name}, {self.state}"


class Amenity(models.Model):
    """A feature a property can offer (Wi-Fi, Fireplace…). Its own table so it is shared, filterable and not repeated as text."""

    name = models.CharField(max_length=60, unique=True)

    class Meta:
        verbose_name_plural = "amenities"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Property(models.Model):
    """A stay listed by a Host."""

    class Type(models.TextChoices):
        CABIN = "CABIN", "Cabin"
        VILLA = "VILLA", "Villa"
        COTTAGE = "COTTAGE", "Cottage"
        APARTMENT = "APARTMENT", "Apartment"
        TENT = "TENT", "Tent"
        HOUSEBOAT = "HOUSEBOAT", "Houseboat"

    # Ownership (not tenancy): a Host may only change their own properties.
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="properties")
    destination = models.ForeignKey(Destination, on_delete=models.PROTECT, related_name="properties")
    title = models.CharField(max_length=150)
    description = models.TextField()
    property_type = models.CharField(max_length=20, choices=Type.choices)
    locality = models.CharField(max_length=120, blank=True, help_text="Area within the destination, e.g. Assagao.")
    price_per_night = models.DecimalField(max_digits=10, decimal_places=2, help_text="Indian rupees.")
    max_guests = models.PositiveSmallIntegerField()
    bedrooms = models.PositiveSmallIntegerField(default=1)
    bathrooms = models.PositiveSmallIntegerField(default=1)
    amenities = models.ManyToManyField(Amenity, blank=True, related_name="properties")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "properties"
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(condition=models.Q(price_per_night__gt=0), name="property_price_positive"),
            models.CheckConstraint(condition=models.Q(max_guests__gte=1), name="property_max_guests_at_least_1"),
        ]
        indexes = [
            models.Index(fields=["destination", "property_type"], name="property_dest_type_idx"),
            models.Index(fields=["price_per_night"], name="property_price_idx"),
        ]

    def __str__(self):
        return self.title

    def clean(self):
        # A role rule the database cannot express as a constraint; enforced wherever full_clean() runs.
        if self.owner_id and self.owner.role != "HOST":
            raise ValidationError({"owner": "A property must be owned by a user with the Host role."})


class PropertyImage(models.Model):
    """A photo of a property. Stores where the file lives, never the file itself."""

    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="images")
    url = models.URLField(max_length=500)
    # Cloudinary public ID (random, under <root>/hosts/<host id>/properties/<property id>/), needed to delete the file.
    # Blank only on rows created before uploads existed.
    storage_key = models.CharField(max_length=255, blank=True)
    # Facts about the stored file, read from it at upload. The file itself is never kept in the database.
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    size_bytes = models.PositiveIntegerField(null=True, blank=True)
    format = models.CharField(max_length=10, blank=True, help_text="jpg, png or webp.")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    alt_text = models.CharField(max_length=200, blank=True)
    position = models.PositiveSmallIntegerField(default=0, help_text="0 is the cover photo.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]
        constraints = [
            models.UniqueConstraint(fields=["property", "position"], name="propertyimage_unique_position"),
        ]

    def __str__(self):
        return f"{self.property_id} #{self.position}"


class Favourite(models.Model):
    """A user's saved property (the heart on a card)."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="favourites")
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name="favourited_by")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "property"], name="favourite_unique_user_property"),
        ]

    def __str__(self):
        return f"{self.user_id} ♥ {self.property_id}"
