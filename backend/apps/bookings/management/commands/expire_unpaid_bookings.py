from django.core.management.base import BaseCommand

from apps.bookings import services


class Command(BaseCommand):
    help = (
        "Mark unpaid PENDING bookings whose payment window has passed as EXPIRED. Optional housekeeping (run it from cron "
        "every few minutes): availability already ignores expired holds, and the API sweeps on every bookings request."
    )

    def handle(self, *args, **options):
        count = services.expire_stale()
        self.stdout.write(f"Expired {count} unpaid booking(s).")
