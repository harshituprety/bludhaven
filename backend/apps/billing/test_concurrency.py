"""Simultaneous property creation cannot overshoot a plan's max_properties (row lock on the Host)."""

import threading

from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import Role
from apps.catalog.models import Property
from apps.core.testing import make_destination, make_plan, make_user, subscribe


class SimultaneousPropertyCreateTests(TransactionTestCase):
    def test_the_limit_holds_under_parallel_requests(self):
        host = make_user(Role.HOST)
        subscribe(host, make_plan(features={"max_properties": 2}))
        dest = make_destination()
        n, codes, barrier = 6, [], threading.Barrier(6)
        payload = {"title": "Cabin", "description": "x", "property_type": "CABIN", "destination": dest.pk, "locality": "Hills",
                   "price_per_night": "3500.00", "max_guests": 4}

        def attempt():
            try:
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {AccessToken.for_user(host)}")
                barrier.wait(timeout=10)
                codes.append(client.post("/api/properties/", payload, format="json").status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt) for _ in range(n)]
        [t.start() for t in threads]
        [t.join(timeout=60) for t in threads]
        self.assertEqual(sorted(codes), [201, 201, 403, 403, 403, 403], codes)
        self.assertEqual(Property.objects.filter(owner=host).count(), 2)
