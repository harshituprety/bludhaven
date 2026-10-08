"""Create the initial Host plans: Trial, Standard, Premium, Ultimate.

The numbers below are only the *starting configuration*. Everything lives in the ``SubscriptionPlan`` table and a Super
Admin changes prices, limits, order and availability afterwards (Admin portal -> Plans, or ``/admin/``). Nothing in the
application checks a plan by name: access is decided by each plan's ``features`` (see ``billing/limits.py``).

    python manage.py seed_host_plans             # add any of the four that are missing; never touch existing ones
    python manage.py seed_host_plans --update    # also reset the four back to this configuration

Safe to run in production, and any number of times. Prices are placeholders to review before launch.
"""

from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.billing.models import SubscriptionPlan

# `features` keys are the ones billing/limits.py recognises. Features the project does not implement (analytics,
# featured listings, priority support) are deliberately absent: a plan must not promise what the app cannot deliver.
HOST_PLANS = [
    {
        "name": "Trial",
        "description": "Try Blüdhaven with one listing, free. Available once per Host.",
        "price": Decimal("0.00"),
        "duration_days": 14,
        "is_trial": True,
        "display_order": 10,
        "features": {"max_properties": 1, "max_images_per_property": 5, "premium_amenities": False},
    },
    {
        "name": "Standard",
        "description": "For a Host with a few properties getting started.",
        "price": Decimal("999.00"),
        "duration_days": 30,
        "is_trial": False,
        "display_order": 20,
        "features": {"max_properties": 3, "max_images_per_property": 15, "premium_amenities": False},
    },
    {
        "name": "Premium",
        "description": "More properties, more photos and premium amenities for a growing business.",
        "price": Decimal("2499.00"),
        "duration_days": 30,
        "is_trial": False,
        "display_order": 30,
        "features": {"max_properties": 10, "max_images_per_property": 30, "premium_amenities": True},
    },
    {
        "name": "Ultimate",
        "description": "The highest limits for professional Hosts and property managers.",
        "price": Decimal("4999.00"),
        "duration_days": 30,
        "is_trial": False,
        "display_order": 40,
        "features": {"max_properties": 25, "max_images_per_property": 50, "premium_amenities": True},
    },
]


class Command(BaseCommand):
    help = "Create the Trial, Standard, Premium and Ultimate Host plans if they do not exist yet."

    def add_arguments(self, parser):
        parser.add_argument("--update", action="store_true", help="Also reset existing plans of these names to the initial configuration.")

    @transaction.atomic
    def handle(self, *args, **options):
        created = updated = kept = 0
        for config in HOST_PLANS:
            defaults = {k: v for k, v in config.items() if k != "name"}
            plan, was_created = SubscriptionPlan.objects.get_or_create(name=config["name"], defaults={**defaults, "is_active": True})
            if was_created:
                created += 1
            elif options["update"]:
                for key, value in defaults.items():
                    setattr(plan, key, value)
                plan.is_active = True
                plan.save()
                updated += 1
            else:
                kept += 1
        self.stdout.write(self.style.SUCCESS(f"Host plans: {created} created, {updated} reset, {kept} left as they were."))
        self.stdout.write("Prices are initial values: review them in the Admin portal before launch.")
