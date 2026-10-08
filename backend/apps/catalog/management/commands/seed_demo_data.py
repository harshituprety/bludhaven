"""Fills a DEVELOPMENT database with sample data so the frontend has something to show.

    python manage.py seed_demo_data            # destinations, amenities, demo Hosts, properties
    python manage.py seed_demo_data --accounts # also a demo Super Admin, a demo Host and a demo guest

Refuses to run unless DJANGO_DEBUG is on. Safe to run repeatedly (existing rows are reused).
The data is the sample content the React prototype used to hard-code. Nothing here is a business rule: the one
"Demo plan" has no limits so the sample Hosts can list properties; a real deployment creates its own plans.
The 16 sample properties that had a photo in the prototype get that photo as a cover ``PropertyImage`` whose URL is
``/demo-photos/<file>`` (the files live in ``frontend/public/demo-photos/`` and are served by the frontend; ``storage_key``
is blank, so nothing is ever deleted from Cloudinary for them). The other properties have no photos; real photos come
from Cloudinary uploads.
"""

import json
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.models import Role, User
from apps.billing.models import Subscription, SubscriptionPlan
from apps.catalog.models import Amenity, Destination, Property, PropertyImage

DATA = Path(__file__).with_name("demo_data.json")
DEMO_DOMAIN = "demo.bludhaven.test"
DEMO_PHOTO_DIR = Path(__file__).resolve().parents[5] / "frontend" / "public" / "demo-photos"
DEMO_PHOTO_URL = "/demo-photos/"


class Command(BaseCommand):
    help = "Load sample destinations, amenities, hosts and properties (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--accounts", action="store_true", help="Also create demo-admin@, demo-host@ and demo-guest@ accounts.")
        parser.add_argument("--password", default="Demo-pass-12345!", help="Password for the demo accounts (development only).")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("seed_demo_data only runs with DJANGO_DEBUG=True. It is for development databases.")
        data = json.loads(DATA.read_text(encoding="utf-8"))
        password_hash = make_password(options["password"])

        destinations = {}
        for d in data["destinations"]:
            obj, _ = Destination.objects.get_or_create(name=d["name"], defaults={"state": d["state"], "tagline": d["tagline"], "display_order": d["display_order"]})
            destinations[d["name"]] = obj

        amenity_names = sorted({a for p in data["properties"] for a in p["amenities"]})
        amenities = {n: Amenity.objects.get_or_create(name=n)[0] for n in amenity_names}

        plan, _ = SubscriptionPlan.objects.get_or_create(
            name="Demo plan (development only)",
            defaults={"description": "Sample plan with no limits, created by seed_demo_data.", "price": 0, "duration_days": 3650, "features": {}},
        )

        hosts = {}
        for name in sorted({p["host"] for p in data["properties"]}):
            email = f"host.{slugify(name)}@{DEMO_DOMAIN}"
            host, created = User.objects.get_or_create(
                email=email, defaults={"full_name": name, "role": Role.HOST, "password": password_hash, "email_verified_at": timezone.now()}
            )
            hosts[name] = host
            self._subscribe(host, plan)

        made = 0
        photos = 0
        for p in data["properties"]:
            city = destinations[p["city"]]
            first = p["location"].split(",")[0].strip()
            locality = "" if first.lower() == p["city"].lower() else first
            prop, created = Property.objects.get_or_create(
                owner=hosts[p["host"]], title=p["title"],
                defaults=dict(
                    destination=city, description=p["description"], property_type=p["type"], locality=locality,
                    price_per_night=p["price"], max_guests=p["guests"], bedrooms=p["bedrooms"], bathrooms=p["bathrooms"],
                ),
            )
            if created:
                prop.amenities.set([amenities[a] for a in p["amenities"]])
                made += 1
            photos += self._add_cover_photo(prop, p)

        if options["accounts"]:
            for email, name, role in (
                (f"demo-admin@{DEMO_DOMAIN}", "Demo Admin", Role.SUPER_ADMIN),
                (f"demo-host@{DEMO_DOMAIN}", "Demo Host", Role.HOST),
                (f"demo-guest@{DEMO_DOMAIN}", "Demo Guest", Role.END_USER),
            ):
                extra = {"is_staff": True, "is_superuser": True} if role == Role.SUPER_ADMIN else {}
                user, _ = User.objects.get_or_create(
                    email=email, defaults={"full_name": name, "role": role, "password": password_hash, "email_verified_at": timezone.now(), **extra}
                )
                if role == Role.HOST:
                    self._subscribe(user, plan)
            self.stdout.write(f"Demo accounts: demo-admin@/demo-host@/demo-guest@{DEMO_DOMAIN} (password: {options['password']})")

        self.stdout.write(self.style.SUCCESS(f"{len(destinations)} destinations, {len(amenities)} amenities, {len(hosts)} hosts, {made} new properties, {photos} new demo photos."))

    @staticmethod
    def _add_cover_photo(prop, data):
        """Give a sample property its prototype photo, once. Never touches a property that already has photos."""
        name = data.get("photo")
        if not name or prop.images.exists():
            return 0
        width = height = size = None
        path = DEMO_PHOTO_DIR / name
        if path.exists():  # facts about the file; the seed still works if the frontend folder is not alongside
            from PIL import Image

            with Image.open(path) as img:
                width, height = img.size
            size = path.stat().st_size
        PropertyImage.objects.create(
            property=prop, url=DEMO_PHOTO_URL + name, storage_key="", width=width, height=height, size_bytes=size,
            format=Path(name).suffix.lstrip(".").lower(), alt_text=data.get("photo_alt", ""), position=0,
        )
        return 1

    @staticmethod
    def _subscribe(host, plan):
        today = timezone.localdate()
        if not Subscription.objects.filter(user=host, status=Subscription.Status.ACTIVE, expiry_date__gt=today).exists():
            Subscription.objects.create(
                user=host, plan=plan, amount=plan.price, payment_status=Subscription.PaymentStatus.PAID,
                start_date=today, expiry_date=today + timedelta(days=plan.duration_days),
            )
