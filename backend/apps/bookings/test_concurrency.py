"""Two guests asking for the same dates at the same moment: the database lock lets exactly one win.

Uses real threads and real transactions, so it runs against MySQL's row locking (TransactionTestCase).
"""

import threading
from datetime import timedelta

from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.accounts.models import Role
from apps.core.testing import make_property, make_user

from . import services
from .models import Booking


class SimultaneousBookingTests(TransactionTestCase):
    def test_exactly_one_of_several_simultaneous_requests_succeeds(self):
        prop = make_property(owner=make_user(Role.HOST))
        guests = [make_user(Role.END_USER, verified=True) for _ in range(6)]
        start = timezone.localdate() + timedelta(days=15)
        results, barrier = [], threading.Barrier(len(guests))

        def attempt(guest):
            try:
                barrier.wait(timeout=10)
                services.create_booking(guest, prop, start, start + timedelta(days=3), 2)
                results.append("booked")
            except APIException as exc:
                results.append(exc.get_codes())
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt, args=(g,)) for g in guests]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        self.assertEqual(results.count("booked"), 1, results)
        self.assertEqual(results.count("dates_unavailable"), len(guests) - 1, results)
        self.assertEqual(Booking.objects.filter(property=prop).count(), 1)
