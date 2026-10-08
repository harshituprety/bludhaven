"""The initial Host plans (Trial, Standard, Premium, Ultimate): configuration as data, and what each one entitles."""

from io import StringIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command

from apps.accounts.models import Role
from apps.catalog.models import Amenity, Property
from apps.core.testing import ApiTestCase, FakeStorage, image_bytes, make_destination, make_plan, make_property, make_user, subscribe

from . import limits
from .management.commands.seed_host_plans import HOST_PLANS
from .models import SubscriptionPlan

PLANS, PROP = "/api/plans/", "/api/properties/"
NAMES = ["Trial", "Standard", "Premium", "Ultimate"]


def seed(*args):
    out = StringIO()
    call_command("seed_host_plans", *args, stdout=out)
    return out.getvalue()


class SeedHostPlansTests(ApiTestCase):
    def test_creates_the_four_plans_with_meaningfully_different_limits(self):
        seed()
        plans = {p.name: p for p in SubscriptionPlan.objects.all()}
        self.assertEqual(sorted(plans), sorted(NAMES))
        f = lambda n, k: plans[n].features[k]
        self.assertEqual([f(n, "max_properties") for n in NAMES], [1, 3, 10, 25])
        self.assertEqual([f(n, "max_images_per_property") for n in NAMES], [5, 15, 30, 50])
        self.assertEqual([f(n, "premium_amenities") for n in NAMES], [False, False, True, True])
        self.assertTrue(plans["Trial"].is_trial and plans["Trial"].price == 0)
        self.assertFalse(any(plans[n].is_trial for n in NAMES[1:]))
        prices = [plans[n].price for n in NAMES[1:]]
        self.assertEqual(prices, sorted(prices))
        self.assertTrue(all(p.price > 0 for p in plans.values() if not p.is_trial))

    def test_only_features_the_application_enforces_are_configured(self):
        for config in HOST_PLANS:
            self.assertLessEqual(set(config["features"]), limits.FEATURE_KEYS, config["name"])
            limits.validate_features(config["features"])  # the same validation the admin API applies

    def test_running_it_twice_changes_nothing(self):
        seed()
        self.assertIn("0 created", seed())
        self.assertEqual(SubscriptionPlan.objects.count(), 4)

    def test_a_super_admins_edits_survive_a_second_run_but_not_update(self):
        seed()
        plan = SubscriptionPlan.objects.get(name="Standard")
        plan.price, plan.features = 1299, {"max_properties": 4}
        plan.save()
        seed()
        plan.refresh_from_db()
        self.assertEqual((int(plan.price), plan.features), (1299, {"max_properties": 4}))
        seed("--update")
        plan.refresh_from_db()
        self.assertEqual((int(plan.price), plan.features["max_properties"]), (999, 3))

    def test_the_plans_list_is_ordered_by_display_order_and_reorderable(self):
        seed()
        names = lambda: [p["name"] for p in self.client.get(PLANS).json()["results"]]
        self.assertEqual(names(), NAMES)
        admin = make_user(Role.SUPER_ADMIN)
        ultimate = SubscriptionPlan.objects.get(name="Ultimate")
        self.authenticate(admin)
        r = self.client.patch(f"{PLANS}{ultimate.pk}/", {"display_order": 5}, format="json")
        self.assertEqual((r.status_code, r.json()["display_order"]), (200, 5))
        self.logout()
        self.assertEqual(names()[0], "Ultimate")

    def test_an_inactive_plan_is_hidden_from_the_public_list(self):
        seed()
        SubscriptionPlan.objects.filter(name="Trial").update(is_active=False)
        self.assertNotIn("Trial", [p["name"] for p in self.client.get(PLANS).json()["results"]])


class EntitlementTests(ApiTestCase):
    """What each plan allows, enforced by the backend from the plan's configuration, not by its name."""

    def setUp(self):
        super().setUp()
        seed()
        self.host = make_user(Role.HOST, verified=True)

    def plan(self, name):
        return SubscriptionPlan.objects.get(name=name)

    def payload(self, dest):
        return {"title": "Cabin", "description": "x", "property_type": "CABIN", "destination": dest.pk, "locality": "Hills", "price_per_night": "3500.00", "max_guests": 4}

    def test_property_limit_per_plan_and_the_error_says_how_to_fix_it(self):
        for name, allowed in (("Trial", 1), ("Standard", 3), ("Premium", 10), ("Ultimate", 25)):
            host = make_user(Role.HOST, verified=True)
            subscribe(host, self.plan(name))
            for _ in range(allowed):
                make_property(owner=host, status=Property.Status.PUBLISHED)
            self.authenticate(host)
            r = self.client.post(PROP, self.payload(make_destination()), format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"), name)
            error = self.error(r)
            self.assertIn("Property limit reached", error["message"])
            self.assertIn(name, error["message"])
            self.assertIn("Upgrade your plan", error["message"])
            self.assertEqual(error["details"], {"limit": "max_properties", "allowed": allowed, "plan": name})
            self.logout()

    def test_a_host_cannot_bypass_the_limit_by_calling_the_api_directly(self):
        subscribe(self.host, self.plan("Trial"))
        make_property(owner=self.host, status=Property.Status.PUBLISHED)  # the Trial's one property
        dest = make_destination()
        self.authenticate(self.host)
        for _ in range(3):  # repeated direct calls, no UI involved
            r = self.client.post(PROP, self.payload(dest), format="json")
            self.assertEqual((r.status_code, self.error(r)["code"]), (403, "plan_limit_reached"))
        self.assertEqual(Property.objects.filter(owner=self.host).count(), 1)

    def test_image_limit_per_plan_with_a_structured_error(self):
        for name, allowed in (("Trial", 5), ("Standard", 15)):
            host = make_user(Role.HOST, verified=True)
            subscribe(host, self.plan(name))
            prop = make_property(owner=host)
            from apps.catalog.models import PropertyImage

            for i in range(allowed):
                PropertyImage.objects.create(property=prop, url=f"https://x.test/{name}{i}.jpg", storage_key=f"k/{name}{i}", position=i)
            self.authenticate(host)
            with FakeStorage() as cloud:
                r = self.client.post(f"{PROP}{prop.pk}/images/", {"image": SimpleUploadedFile("a.png", image_bytes(), content_type="image/png")}, format="multipart")
            error = self.error(r)
            self.assertEqual((r.status_code, error["code"]), (403, "plan_limit_reached"), name)
            self.assertIn("Image limit reached", error["message"])
            self.assertIn("Upgrade your plan", error["message"])
            self.assertEqual(error["details"], {"limit": "max_images_per_property", "allowed": allowed, "plan": name})
            self.assertEqual(len(cloud.uploaded), 0, "refused before anything was uploaded")
            self.logout()

    def test_premium_amenities_need_premium_or_ultimate(self):
        pool = Amenity.objects.create(name="Infinity pool", is_premium=True)
        dest = make_destination()
        outcomes = {}
        for name in NAMES:
            host = make_user(Role.HOST, verified=True)
            subscribe(host, self.plan(name))
            self.authenticate(host)
            r = self.client.post(PROP, {**self.payload(dest), "amenities": [pool.pk]}, format="json")
            outcomes[name] = r.status_code
            self.logout()
        self.assertEqual(outcomes, {"Trial": 400, "Standard": 400, "Premium": 201, "Ultimate": 201})

    def test_the_limits_come_from_configuration_so_an_edit_takes_effect_without_code_changes(self):
        plan = make_plan("Custom", features={"max_properties": 2})
        subscribe(self.host, plan)
        for _ in range(2):
            make_property(owner=self.host, status=Property.Status.PUBLISHED)
        self.authenticate(self.host)
        self.assertEqual(self.client.post(PROP, self.payload(make_destination()), format="json").status_code, 403)
        plan.features = {"max_properties": 3}
        plan.save()
        self.assertEqual(self.client.post(PROP, self.payload(make_destination()), format="json").status_code, 201)

    def test_no_application_code_branches_on_a_plan_name(self):
        import pathlib
        import re

        root = pathlib.Path(__file__).resolve().parents[1]
        offenders = []
        for path in root.rglob("*.py"):
            if path.name.startswith("test_") or "migrations" in path.parts or path.name in ("seed_host_plans.py", "seed_demo_data.py"):
                continue
            for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if re.search(r"plan(\.name)?\s*(==|!=|in)\s*[\"'\[(]?\s*[\"'](Trial|Standard|Premium|Ultimate)", line):
                    offenders.append(f"{path.relative_to(root)}:{n}")
        self.assertEqual(offenders, [])
