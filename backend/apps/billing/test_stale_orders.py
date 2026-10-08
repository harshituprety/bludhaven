"""A Razorpay order stays payable after it was created. These tests pin down what happens when the Host's situation
changed in between: a stale order must never re-apply an out-of-date quote (double-count credit, cut a paid period,
or sell a "new" subscription to a Host who already has one). It is parked as REFUND_REQUIRED instead."""

from datetime import timedelta
from unittest import mock

from apps.core.testing import make_property

from . import limits, purchases
from .models import BillingPayment, Subscription, WalletTransaction
from .test_purchases import BillingCase

BP, S, WT = BillingPayment, Subscription.Status, WalletTransaction.Kind


class StaleOrderTests(BillingCase):
    def _age(self, sub, days_used):
        sub.start_date = limits.today() - timedelta(days=days_used)
        sub.expiry_date = sub.start_date + timedelta(days=30)
        sub.save()

    def test_an_open_order_is_superseded_by_a_later_wallet_only_purchase(self):
        old = self.activate(self.basic)
        self._age(old, 10)
        stale = self.buy(self.pro, use_wallet=False)  # Razorpay order for the upgrade, left unpaid
        purchases.adjust_wallet(self.admin, self.host, 600000, "test top-up")
        r = self.post("subscription/checkout/", {"plan": self.pro.pk, "use_wallet": True})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "activated"))
        paid_from_wallet = limits.current_subscription(self.host)
        self.assertEqual(BP.objects.get(razorpay_order_id=stale["order_id"]).status, BP.Status.SUPERSEDED)

        self.pay(stale, payment_id="pay_stale")  # the old order is paid afterwards
        self.assertEqual(BP.objects.get(razorpay_order_id=stale["order_id"]).status, BP.Status.REFUND_REQUIRED)
        self.assertEqual(limits.current_subscription(self.host).pk, paid_from_wallet.pk, "the paid period is untouched")
        self.assertEqual(Subscription.objects.filter(user=self.host, plan=self.pro).count(), 1)

    def test_a_change_order_paid_after_the_unused_time_changed_is_not_applied(self):
        old = self.activate(self.basic)
        self._age(old, 1)  # almost all of the period is unused: a large credit
        order = self.buy(self.pro, use_wallet=False)
        quoted = BP.objects.get(razorpay_order_id=order["order_id"]).credit_paise
        self.assertEqual(quoted, 300000 * 29 // 30)
        self._age(old, 29)  # ...and by the time it is paid, nearly none is left
        r = self.pay(order, payment_id="pay_late")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.error(r)["code"], "payment_not_applied")
        bp = BP.objects.get(razorpay_order_id=order["order_id"])
        self.assertEqual(bp.status, BP.Status.REFUND_REQUIRED)
        old.refresh_from_db()
        self.assertEqual(old.status, S.ACTIVE, "the running plan was not cancelled")
        self.assertFalse(WalletTransaction.objects.filter(kind=WT.PRORATION_CREDIT).exists())

    def test_a_change_order_paid_the_same_day_still_applies(self):
        old = self.activate(self.basic)
        self._age(old, 10)
        order = self.buy(self.pro, use_wallet=False)
        self.assertEqual(self.pay(order, payment_id="pay_ok").status_code, 200)
        self.assertEqual(limits.current_subscription(self.host).plan, self.pro)

    def test_a_new_subscription_order_is_not_applied_to_a_host_who_now_has_one(self):
        order = self.buy(self.basic, use_wallet=False)
        self.assertEqual(Subscription.objects.filter(user=self.host).count(), 0)
        existing = self.admin_subscribe()
        r = self.pay(order, payment_id="pay_new")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(BP.objects.get(razorpay_order_id=order["order_id"]).status, BP.Status.REFUND_REQUIRED)
        self.assertEqual(Subscription.objects.filter(user=self.host).count(), 1)
        self.assertEqual(limits.current_subscription(self.host).pk, existing.pk)

    def admin_subscribe(self):
        from apps.core.testing import subscribe

        return subscribe(self.host, self.pro)


class ProrationNumbersTests(BillingCase):
    """Exact paise for the upgrade maths (credit = paid * whole days left // period length; the Host pays the rest)."""

    def _quote(self, plan):
        return self.post("subscription/quote/", {"plan": plan.pk, "use_wallet": False}).json()

    def _used(self, sub, days):
        sub.start_date = limits.today() - timedelta(days=days)
        sub.expiry_date = sub.start_date + timedelta(days=30)
        sub.save()

    def test_credit_and_charge_at_the_start_halfway_and_near_the_end(self):
        sub = self.activate(self.basic)  # 3000.00 for 30 days; Pro is 6000.00
        for used, credit in ((1, 290000), (15, 150000), (29, 10000)):
            self._used(sub, used)
            q = self._quote(self.pro)
            self.assertEqual((q["kind"], q["credit_paise"], q["amount_paise"]), ("CHANGE", credit, 600000 - credit), used)
            self.assertEqual(q["credit_paise"] + q["amount_paise"] + q["wallet_paise"] - q["credit_paise"], q["price_paise"])

    def test_rounding_goes_down_to_whole_paise_and_the_total_is_exact(self):
        odd = make_plan_odd("Odd", "1000.00")
        sub = self.activate(odd)
        self._used(sub, 23)  # 7 days left: 100000 * 7 / 30 = 23333.33 -> 23333
        q = self._quote(self.pro)
        self.assertEqual(q["credit_paise"], 23333)
        self.assertEqual(q["credit_paise"] + q["amount_paise"], 600000)

    def test_an_expiring_day_gives_no_credit(self):
        sub = self.activate(self.basic)
        self._used(sub, 30)  # today is the expiry day: nothing is left, so it is no longer current
        self.assertIsNone(limits.current_subscription(self.host))

    def test_two_upgrades_in_a_row_never_credit_more_than_was_paid(self):
        ultimate = make_plan_odd("Ultimate", "9000.00")
        sub = self.activate(self.basic)
        self._used(sub, 10)
        order = self.buy(self.pro, use_wallet=False)
        self.assertEqual(order["amount"], 400000)  # 6000 - 2000
        self.assertEqual(self.pay(order, payment_id="pay_a").status_code, 200)
        pro_sub = limits.current_subscription(self.host)
        self.assertEqual(pro_sub.plan, self.pro)
        pro_sub.start_date = limits.today() - timedelta(days=5)
        pro_sub.expiry_date = pro_sub.start_date + timedelta(days=30)
        pro_sub.save()
        q = self._quote(ultimate)
        self.assertEqual((q["credit_paise"], q["amount_paise"]), (600000 * 25 // 30, 900000 - 500000))
        self.assertEqual(self.pay(self.buy(ultimate, use_wallet=False), payment_id="pay_b").status_code, 200)
        self.assertEqual(self.balance(), 0, "credit was spent on the price, none left over or lost")


def make_plan_odd(name, price):
    from apps.core.testing import make_plan

    return make_plan(name, price=price, duration_days=30, features={"max_properties": 25})


class DowngradeTransitionTests(BillingCase):
    def test_usage_above_the_new_limit_at_the_switch_is_kept_but_nothing_more_can_be_added(self):
        from apps.catalog.models import Property

        pro = self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")  # Basic allows 2 properties
        props = [make_property(owner=self.host) for _ in range(4)]  # fine under Pro (10); added after the downgrade was paid
        with mock.patch.object(limits, "today", return_value=pro.expiry_date):
            purchases.process_lifecycle()
            self.assertEqual(limits.current_subscription(self.host).plan, self.basic)
            usage = limits.usage(self.host)
            self.assertEqual((usage["properties"]["used"], usage["properties"]["limit"]), (4, 2))
            with self.assertRaises(Exception) as ctx:
                limits.ensure_can_add_property(self.host)
            self.assertEqual(getattr(ctx.exception, "default_code", None) or ctx.exception.detail.code, "plan_limit_reached")
        # Nothing was unpublished or deleted: the Host keeps every listing.
        self.assertEqual(Property.objects.filter(owner=self.host, status=Property.Status.PUBLISHED).count(), len(props))
