"""Small factory helpers shared by the test modules."""

from datetime import date, timedelta
from decimal import Decimal
from itertools import count

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.utils import timezone
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from apps.accounts.models import Role, User
from apps.bookings.models import Booking
from apps.catalog.models import Amenity, Destination, Property

_n = count(1)
PASSWORD = "a-Str0ng-test-pass"


_PASSWORD_HASH = make_password(PASSWORD)  # hashing is deliberately slow; do it once, not per test user


def make_user(role=Role.END_USER, verified=None, **extra):
    """A user whose password is ``PASSWORD``. Super Admins start verified, everyone else does not (as in production)."""
    email = extra.pop("email", f"user{next(_n)}@example.com")
    verified = (role == Role.SUPER_ADMIN) if verified is None else verified
    fields = dict(
        email=email,
        full_name=extra.pop("full_name", f"Test {role}"),
        role=role,
        password=_PASSWORD_HASH,
        email_verified_at=timezone.now() if verified else None,
    )
    if role == Role.SUPER_ADMIN:
        fields.update(is_staff=True, is_superuser=True)
    fields.update(extra)
    return User.objects.create(**fields)


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


class ApiTestCase(TestCase):
    """TestCase with a fresh API client and an empty cache, so throttle counters never leak between tests."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.client = APIClient()

    def authenticate(self, user):
        """Send a real access token for ``user`` on every following request."""
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(user)}")

    def logout(self):
        self.client.credentials()

    def set_refresh_cookie(self, token):
        """Put a refresh token in the browser's cookie jar, as a login would."""
        from django.conf import settings

        self.client.cookies[settings.REFRESH_COOKIE_NAME] = str(token)

    def refresh_cookie(self):
        from django.conf import settings

        morsel = self.client.cookies.get(settings.REFRESH_COOKIE_NAME)
        return morsel.value if morsel else None

    def error(self, response):
        """The ``error`` object of an error response (see apps/core/exceptions.py)."""
        return response.json()["error"]




def make_amenity(name=None):
    return Amenity.objects.create(name=name or f"Amenity {next(_n)}")


def make_booking(guest=None, prop=None, check_in=None, check_out=None, status=Booking.Status.PENDING, guests_count=2, expires_at=None):
    """Straight into the database (bypasses the API rules), so tests can set up past stays and any status."""
    from datetime import timedelta

    from django.utils import timezone

    payment_window = timedelta(minutes=15)
    prop = prop or make_property()
    check_in = check_in or timezone.localdate() + timedelta(days=10)
    check_out = check_out or check_in + timedelta(days=2)
    return Booking.objects.create(
        guest=guest or make_user(Role.END_USER, verified=True),
        property=prop,
        check_in=check_in,
        check_out=check_out,
        guests_count=guests_count,
        total_price=prop.price_per_night * (check_out - check_in).days,
        status=status,
        # An unpaid booking holds its dates only inside its payment window (pass ``expires_at`` to place it elsewhere).
        expires_at=expires_at if expires_at is not None else (timezone.now() + payment_window if status == Booking.Status.PENDING else None),
    )


def make_plan(name=None, price="999.00", duration_days=30, features=None, **extra):
    from apps.billing.models import SubscriptionPlan

    return SubscriptionPlan.objects.create(
        name=name or f"Plan {next(_n)}", price=Decimal(price), duration_days=duration_days, features=features or {}, **extra
    )


def subscribe(host, plan=None, **extra):
    """Give ``host`` an ACTIVE subscription that is current today. Default plan has no limits."""
    from apps.billing.models import Subscription

    plan = plan or make_plan()
    start = extra.pop("start_date", timezone.localdate() - timedelta(days=1))
    return Subscription.objects.create(
        user=host, plan=plan, amount=plan.price, start_date=start,
        expiry_date=extra.pop("expiry_date", start + timedelta(days=plan.duration_days)), **extra,
    )


def image_bytes(fmt="PNG", size=(40, 30), color=(200, 30, 30)):
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, fmt)
    return out.getvalue()


class FakeCloudinary:
    """Stands in for apps.catalog.storage: records uploads and deletes, never touches the network."""

    def __init__(self):
        self.uploaded, self.deleted = {}, []
        self.fail_upload = False

    def upload_image(self, data, public_id):
        from apps.catalog.storage import StorageUnavailable

        if self.fail_upload:
            raise StorageUnavailable()
        self.uploaded[public_id] = data
        return {"public_id": public_id, "secure_url": f"https://res.cloudinary.test/demo/image/upload/{public_id}.jpg"}

    def delete_image(self, public_id):
        self.deleted.append(public_id)
        return True

    def __enter__(self):
        from unittest import mock

        self._patches = [
            mock.patch("apps.catalog.storage.upload_image", self.upload_image),
            mock.patch("apps.catalog.storage.delete_image", self.delete_image),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()
