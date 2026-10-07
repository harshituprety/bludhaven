from django.core.management.base import BaseCommand

from apps.billing import purchases


class Command(BaseCommand):
    help = (
        "Move Host subscriptions through their lifecycle: period over -> PAST_DUE (grace period) / CANCELLED / EXPIRED, "
        "and PAST_DUE -> EXPIRED once the grace period is over. Safe to run any time; run it daily (e.g. from cron)."
    )

    def handle(self, *args, **options):
        n = purchases.process_lifecycle()
        self.stdout.write(f"Past due: {n['past_due']}, expired: {n['expired']}, cancelled: {n['cancelled']}.")
