"""Small factory helpers shared by the test modules."""

from datetime import date, timedelta
from decimal import Decimal
from itertools import count

from apps.accounts.models import Role, User
from apps.catalog.models import Destination, Property

_n = count(1)
PASSWORD = "a-Str0ng-test-pass"


def make_user(role=Role.END_USER, **extra):
    email = extra.pop("email", f"user{next(_n)}@example.com")
    if role == Role.SUPER_ADMIN:
        return User.objects.create_superuser(email=email, password=PASSWORD, full_name="Test Super Admin", **extra)
    return User.objects.create_user(email=email, password=PASSWORD, full_name=f"Test {role}", role=role, **extra)


def make_destination(name=None):
    return Destination.objects.create(name=name or f"City{next(_n)}", state="Test State")


def make_property(owner=None, destination=None, **extra):
    fields = dict(
        owner=owner or make_user(Role.HOST),
        destination=destination or make_destination(),
        title=f"Stay {next(_n)}",
        description="A test stay.",
        property_type=Property.Type.CABIN,
        price_per_night=Decimal("4500.00"),
        max_guests=4,
    )
    fields.update(extra)
    return Property.objects.create(**fields)


def dates(nights=2, start=None):
    start = start or date(2030, 1, 10)
    return start, start + timedelta(days=nights)
