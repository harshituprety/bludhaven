from datetime import date
from itertools import count

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.accounts.models import Role
from apps.core.testing import make_user

from .models import BillingProfile, Subscription, SubscriptionPlan


_plans = count(1)


def plan(**extra):
    fields = dict(name="Basic", price=999, duration_days=30)
    fields.update(extra)
    return SubscriptionPlan.objects.create(**fields)


class PlanTests(TestCase):
    def test_features_default_to_an_empty_configurable_object(self):
        p = plan()
        p.refresh_from_db()
        self.assertEqual(p.features, {})
        p.features = {"anything": 3}
        p.save()
        p.refresh_from_db()
        self.assertEqual(p.features, {"anything": 3})

    def test_plan_constraints(self):
        for extra in ({"price": -1}, {"duration_days": 0}):
            with self.subTest(extra=extra), self.assertRaises(IntegrityError), transaction.atomic():
                plan(name="Bad", **extra)
        plan(name="Dup")
        with self.assertRaises(IntegrityError), transaction.atomic():
            plan(name="Dup")


class SubscriptionTests(TestCase):
    def sub(self, user, **extra):
        fields = dict(user=user, plan=plan(name=f"Plan {next(_plans)}"), start_date=date(2030, 1, 1), expiry_date=date(2030, 1, 31))
        fields.update(extra)
        return Subscription(**fields)

    def test_only_hosts_can_hold_a_subscription(self):
        for role in (Role.END_USER, Role.SUPER_ADMIN):
            with self.subTest(role=role), self.assertRaises(ValidationError):
                self.sub(make_user(role)).full_clean()
        self.sub(make_user(Role.HOST)).full_clean()

    def test_defaults_and_expiry_after_start(self):
        s = self.sub(make_user(Role.HOST))
        s.save()
        self.assertEqual((s.status, s.payment_status), (Subscription.Status.ACTIVE, Subscription.PaymentStatus.PENDING))
        with self.assertRaises(IntegrityError), transaction.atomic():
            self.sub(make_user(Role.HOST), expiry_date=date(2030, 1, 1)).save()


class BillingProfileTests(TestCase):
    def test_one_profile_per_user(self):
        host = make_user(Role.HOST)
        data = dict(billing_name="A", billing_email="a@example.com", address_line1="1 Road", city="Goa", state="Goa", postal_code="403001")
        BillingProfile.objects.create(user=host, **data)
        with self.assertRaises(IntegrityError), transaction.atomic():
            BillingProfile.objects.create(user=host, **data)
