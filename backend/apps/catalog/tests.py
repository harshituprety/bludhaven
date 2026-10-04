from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.accounts.models import Role
from apps.core.testing import make_destination, make_property, make_user

from .models import Amenity, Favourite, Property, PropertyImage


class PropertyTests(TestCase):
    def test_only_a_host_can_own_a_property(self):
        for role in (Role.END_USER, Role.SUPER_ADMIN):
            p = Property(owner=make_user(role), destination=make_destination(), title="T", description="d",
                         property_type=Property.Type.VILLA, price_per_night=Decimal("100"), max_guests=2)
            with self.subTest(role=role), self.assertRaises(ValidationError):
                p.full_clean()
        make_property().full_clean()  # a Host owner is fine

    def test_database_rejects_non_positive_price_and_zero_guests(self):
        for field, value in (("price_per_night", Decimal("0")), ("max_guests", 0)):
            with self.subTest(field=field), self.assertRaises(IntegrityError), transaction.atomic():
                make_property(**{field: value})

    def test_owner_is_protected_from_deletion_while_they_have_properties(self):
        from django.db.models import ProtectedError

        p = make_property()
        with self.assertRaises(ProtectedError):
            p.owner.delete()

    def test_amenities_are_shared_and_unique(self):
        wifi = Amenity.objects.create(name="Wi-Fi")
        a, b = make_property(), make_property()
        a.amenities.add(wifi)
        b.amenities.add(wifi)
        self.assertEqual(wifi.properties.count(), 2)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Amenity.objects.create(name="Wi-Fi")


class ImageAndFavouriteTests(TestCase):
    def test_image_positions_are_unique_per_property_and_cascade_on_delete(self):
        p = make_property()
        PropertyImage.objects.create(property=p, url="https://example.com/a.webp", position=0)
        PropertyImage.objects.create(property=p, url="https://example.com/b.webp", position=1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            PropertyImage.objects.create(property=p, url="https://example.com/c.webp", position=1)
        p.delete()
        self.assertEqual(PropertyImage.objects.count(), 0)

    def test_a_user_can_favourite_a_property_only_once(self):
        user, p = make_user(), make_property()
        Favourite.objects.create(user=user, property=p)
        with self.assertRaises(IntegrityError), transaction.atomic():
            Favourite.objects.create(user=user, property=p)
