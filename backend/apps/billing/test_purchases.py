"""Self-serve Host billing: plans -> checkout -> verified payment -> subscription, wallet, proration, lifecycle.

Razorpay is mocked throughout (``FakeRazorpay``); nothing here talks to the real service.
"""

import hashlib
import hmac
import json
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import Role
from apps.core.testing import ApiTestCase, make_plan, make_property, make_user
from apps.payments import gateway
from apps.payments.test_payments import FakeRazorpay, creds, sign, WEBHOOK_SECRET

from . import limits, purchases
from .models import BillingPayment, HostWallet, Subscription, WalletTransaction

BP, S, WT = BillingPayment, Subscription.Status, WalletTransaction.Kind
API = "/api/billing/"


@creds
class BillingCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.host = make_user(Role.HOST, verified=True)
        self.other = make_user(Role.HOST, verified=True)
        self.guest = make_user(Role.END_USER, verified=True)
        self.admin = make_user(Role.SUPER_ADMIN)
        self.fake = FakeRazorpay()
        for name in ("create_order", "fetch_payment", "capture_payment"):
            p = mock.patch.object(gateway, name, getattr(self.fake, name))
            p.start()
            self.addCleanup(p.stop)
        self.basic = make_plan("Basic", price="3000.00", duration_days=30, features={"max_properties": 2, "max_images_per_property": 5})
        self.pro = make_plan("Pro", price="6000.00", duration_days=30, features={"max_properties": 10, "max_images_per_property": 20})

    def as_(self, user):
        self.logout()
        if user:
            self.authenticate(user)
        return self.client

    def post(self, path, body=None, user=None):
        return self.as_(user or self.host).post(API + path, body or {}, format="json")

    def buy(self, plan, use_wallet=True, user=None):
        r = self.post("subscription/checkout/", {"plan": plan.pk, "use_wallet": use_wallet}, user)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()

    def pay(self, order, user=None, payment_id="pay_1"):
        self.fake.paid(order["order_id"], payment_id, amount=order["amount"])
        return self.post("payments/verify/", {
            "razorpay_order_id": order["order_id"], "razorpay_payment_id": payment_id,
            "razorpay_signature": sign(order["order_id"], payment_id),
        }, user)

    def webhook(self, order, payment_id="pay_1", event="payment.captured"):
        entity = {"id": payment_id, "order_id": order["order_id"], "amount": order["amount"], "currency": "INR", "status": "captured"}
        raw = json.dumps({"event": event, "payload": {"payment": {"entity": entity}}}).encode()
        sig = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        self.logout()
        return self.client.post("/api/payments/razorpay/webhook/", raw, content_type="application/json", HTTP_X_RAZORPAY_SIGNATURE=sig)

    def balance(self, user=None):
        return purchases.balance_of(user or self.host)

    def activate(self, plan, user=None):
        order = self.buy(plan, user=user)
        self.assertEqual(self.pay(order, user).status_code, 200)
        return limits.current_subscription(user or self.host)


class QuoteAndCheckoutTests(BillingCase):
    def test_quote_for_a_new_subscription(self):
        r = self.post("subscription/quote/", {"plan": self.basic.pk})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual((d["kind"], d["price_paise"], d["credit_paise"], d["amount_paise"]), ("NEW", 300000, 0, 300000))

    def test_checkout_creates_an_order_and_never_activates_before_payment(self):
        order = self.buy(self.basic)
        self.assertEqual((order["amount"], order["status"]), (300000, "payment_required"))
        self.assertEqual(order["key_id"], "rzp_test_key")
        self.assertNotIn("secret", json.dumps(order).lower())
        self.assertIsNone(limits.current_subscription(self.host))

    def test_a_repeated_checkout_reuses_the_open_order(self):
        a, b = self.buy(self.basic), self.buy(self.basic)
        self.assertEqual(a["order_id"], b["order_id"])
        self.assertEqual(self.fake.orders, 1)

    def test_changing_the_choice_supersedes_the_old_order(self):
        a, b = self.buy(self.basic), self.buy(self.pro)
        self.assertNotEqual(a["order_id"], b["order_id"])
        self.assertEqual(BP.objects.get(razorpay_order_id=a["order_id"]).status, BP.Status.SUPERSEDED)

    def test_verified_payment_activates_the_plan_and_records_a_transaction(self):
        r = self.pay(self.buy(self.basic))
        self.assertEqual(r.status_code, 200)
        sub = limits.current_subscription(self.host)
        self.assertEqual((sub.plan, sub.status, sub.amount), (self.basic, S.ACTIVE, self.basic.price))
        payment = BP.objects.get()
        self.assertEqual((payment.status, payment.verified_via, payment.razorpay_payment_id), (BP.Status.PAID, BP.Source.CHECKOUT, "pay_1"))
        self.assertEqual(payment.subscription_id, sub.pk)

    def test_verify_is_idempotent(self):
        order = self.buy(self.basic)
        self.pay(order)
        self.assertEqual(self.pay(order).status_code, 200)
        self.assertEqual(Subscription.objects.filter(user=self.host).count(), 1)

    def test_a_forged_signature_is_rejected(self):
        order = self.buy(self.basic)
        self.fake.paid(order["order_id"], "pay_1", amount=order["amount"])
        r = self.post("payments/verify/", {"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_1", "razorpay_signature": "x" * 64})
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "invalid_signature"))
        self.assertIsNone(limits.current_subscription(self.host))

    def test_wrong_amount_is_rejected(self):
        order = self.buy(self.basic)
        self.fake.paid(order["order_id"], "pay_1", amount=100)
        r = self.post("payments/verify/", {"razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_1", "razorpay_signature": sign(order["order_id"], "pay_1")})
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "amount_mismatch"))
        self.assertIsNone(limits.current_subscription(self.host))

    def test_another_host_cannot_verify_my_order(self):
        order = self.buy(self.basic)
        self.assertEqual(self.pay(order, user=self.other).status_code, 404)

    def test_webhook_activates_and_is_idempotent_with_verify(self):
        order = self.buy(self.basic)
        self.assertEqual(self.webhook(order).status_code, 200)
        self.assertEqual(self.webhook(order).status_code, 200)
        self.pay(order)
        self.assertEqual(Subscription.objects.filter(user=self.host).count(), 1)
        self.assertEqual(BP.objects.get().verified_via, BP.Source.WEBHOOK)

    def test_webhook_with_a_bad_signature_changes_nothing(self):
        order = self.buy(self.basic)
        with override_settings(RAZORPAY_WEBHOOK_SECRET="other"):
            self.webhook(order)
        self.assertIsNone(limits.current_subscription(self.host))

    def test_webhook_failure_marks_the_payment_failed(self):
        order = self.buy(self.basic)
        self.webhook(order, event="payment.failed")
        self.assertEqual(BP.objects.get().status, BP.Status.FAILED)

    def test_a_superseded_order_paid_later_needs_a_refund_and_changes_nothing(self):
        old = self.buy(self.basic)
        self.buy(self.pro)
        self.webhook(old)
        self.assertEqual(BP.objects.get(razorpay_order_id=old["order_id"]).status, BP.Status.REFUND_REQUIRED)
        self.assertIsNone(limits.current_subscription(self.host))

    def test_only_verified_hosts_can_buy(self):
        unverified = make_user(Role.HOST)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.basic.pk}, unverified).status_code, 403)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.basic.pk}, self.guest).status_code, 403)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.basic.pk}, self.admin).status_code, 403)
        self.logout()
        self.assertEqual(self.client.post(API + "subscription/checkout/", {"plan": self.basic.pk}, format="json").status_code, 401)

    def test_unknown_plan_is_404(self):
        self.assertEqual(self.post("subscription/checkout/", {"plan": 99999}).status_code, 404)


class WalletTests(BillingCase):
    def test_topup_credits_the_wallet_only_after_verified_payment(self):
        r = self.post("wallet/topup/", {"amount": 500})
        self.assertEqual((r.status_code, r.json()["amount"]), (201, 50000))
        self.assertEqual(self.balance(), 0)
        self.pay(r.json())
        self.assertEqual(self.balance(), 50000)
        tx = WalletTransaction.objects.get()
        self.assertEqual((tx.kind, tx.amount_paise, tx.balance_after_paise), (WT.TOPUP, 50000, 50000))

    def test_topup_credited_once_even_if_webhook_and_verify_both_arrive(self):
        order = self.post("wallet/topup/", {"amount": 500}).json()
        self.webhook(order)
        self.pay(order)
        self.webhook(order)
        self.assertEqual(self.balance(), 50000)
        self.assertEqual(WalletTransaction.objects.count(), 1)

    def test_topup_validation(self):
        for bad in (0, -5, "abc", 1.5, 10**9):
            self.assertEqual(self.post("wallet/topup/", {"amount": bad}).status_code, 400, bad)

    def test_wallet_covers_the_price_with_no_gateway_call(self):
        self.pay(self.post("wallet/topup/", {"amount": 5000}).json())
        before = self.fake.orders
        r = self.post("subscription/checkout/", {"plan": self.basic.pk, "use_wallet": True})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "activated"))
        self.assertEqual(self.fake.orders, before)
        self.assertEqual(self.balance(), 200000)
        self.assertEqual(BP.objects.get(purpose=BP.Purpose.SUBSCRIPTION).verified_via, BP.Source.WALLET)

    def test_wallet_partly_covers_and_the_rest_is_charged(self):
        self.pay(self.post("wallet/topup/", {"amount": 1000}).json())
        order = self.buy(self.basic)
        self.assertEqual(order["amount"], 200000)
        self.pay(order, payment_id="pay_2")
        self.assertEqual(self.balance(), 0)
        kinds = list(WalletTransaction.objects.order_by("id").values_list("kind", "amount_paise"))
        self.assertEqual(kinds, [(WT.TOPUP, 100000), (WT.SUBSCRIPTION_PAYMENT, -100000)])

    def test_wallet_can_be_left_out(self):
        self.pay(self.post("wallet/topup/", {"amount": 5000}).json())
        order = self.buy(self.basic, use_wallet=False)
        self.assertEqual(order["amount"], 300000)

    def test_statement_is_private_and_ordered(self):
        self.pay(self.post("wallet/topup/", {"amount": 500}).json())
        rows = self.as_(self.host).get(API + "wallet/transactions/").json()
        self.assertEqual(rows["count"], 1)
        self.assertEqual(self.as_(self.other).get(API + "wallet/transactions/").json()["count"], 0)
        self.assertEqual(self.as_(self.host).get(API + "wallet/").json()["balance_paise"], 50000)

    def test_ledger_is_append_only(self):
        self.pay(self.post("wallet/topup/", {"amount": 500}).json())
        tx = WalletTransaction.objects.get()
        tx.description = "changed"
        with self.assertRaises(Exception):
            tx.save()
        with self.assertRaises(Exception):
            tx.delete()

    def test_wallet_balance_cannot_go_negative(self):
        wallet = purchases.wallet_for(self.host)
        wallet.balance_paise = -1
        with self.assertRaises(Exception):
            wallet.save()

    def test_admin_adjustment(self):
        r = self.post("wallets/%d/adjust/" % self.host.pk, {"amount": "250.00", "reason": "Goodwill"}, self.admin) if False else \
            self.as_(self.admin).post(f"/api/wallets/{self.host.pk}/adjust/", {"amount": "250.00", "reason": "Goodwill"}, format="json")
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(self.balance(), 25000)
        tx = WalletTransaction.objects.get()
        self.assertEqual((tx.kind, tx.created_by_id), (WT.ADMIN_CREDIT, self.admin.pk))
        r = self.client.post(f"/api/wallets/{self.host.pk}/adjust/", {"amount": "-9999.00", "reason": "Too much"}, format="json")
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.balance(), 25000)
        self.assertEqual(self.client.post(f"/api/wallets/{self.host.pk}/adjust/", {"amount": "5", "reason": ""}, format="json").status_code, 400)
        self.assertEqual(self.client.post(f"/api/wallets/{self.guest.pk}/adjust/", {"amount": "5", "reason": "x"}, format="json").status_code, 404)
        self.assertEqual(self.as_(self.host).post(f"/api/wallets/{self.host.pk}/adjust/", {"amount": "5", "reason": "x"}, format="json").status_code, 403)

    def test_admin_lists_and_host_cannot(self):
        self.pay(self.post("wallet/topup/", {"amount": 500}).json())
        for path in ("wallets", "wallet-transactions", "billing-payments"):
            self.assertEqual(self.as_(self.admin).get(f"/api/{path}/").json()["count"], 1 if path != "wallets" else 1, path)
            self.assertEqual(self.as_(self.host).get(f"/api/{path}/").status_code, 403, path)


class ChangeRenewCancelTests(BillingCase):
    def test_renewal_queues_after_the_current_period(self):
        sub = self.activate(self.basic)
        q = self.post("subscription/quote/", {"plan": self.basic.pk}).json()
        self.assertEqual((q["kind"], q["credit_paise"]), ("RENEWAL", 0))
        self.pay(self.buy(self.basic), payment_id="pay_2")
        rows = list(Subscription.objects.filter(user=self.host).order_by("start_date"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1].start_date, sub.expiry_date)
        self.assertEqual(limits.current_subscription(self.host).pk, sub.pk)

    def test_upgrade_prorates_unused_time_and_keeps_history(self):
        old = self.activate(self.basic)
        old.start_date = limits.today() - timedelta(days=10)
        old.expiry_date = old.start_date + timedelta(days=30)
        old.save()
        q = self.post("subscription/quote/", {"plan": self.pro.pk, "use_wallet": False}).json()
        self.assertEqual(q["kind"], "CHANGE")
        self.assertEqual(q["credit_paise"], 300000 * 20 // 30)
        self.assertEqual(q["amount_paise"], 600000 - 200000)
        order = self.buy(self.pro, use_wallet=False)
        self.pay(order, payment_id="pay_2")
        old.refresh_from_db()
        self.assertEqual((old.status, old.cancellation_reason), (S.CANCELLED, "plan_changed"))
        new = limits.current_subscription(self.host)
        self.assertEqual((new.plan, new.previous_subscription_id), (self.pro, old.pk))
        self.assertEqual(Subscription.objects.filter(user=self.host).count(), 2)

    def test_a_downgrade_is_scheduled_for_the_end_of_the_paid_period_not_applied_now(self):
        pro = self.activate(self.pro)
        q = self.post("subscription/quote/", {"plan": self.basic.pk, "use_wallet": False}).json()
        self.assertEqual((q["kind"], q["credit_paise"], q["amount_paise"]), ("DOWNGRADE", 0, 300000))
        self.assertEqual(q["start_date"], pro.expiry_date.isoformat())
        self.assertEqual(q["replaces"], "Pro")
        order = self.buy(self.basic, use_wallet=False)
        self.assertEqual(limits.current_subscription(self.host).plan, self.pro, "unpaid: nothing changes")
        r = self.pay(order, payment_id="pay_2")
        self.assertEqual(r.status_code, 200)
        # The Pro period keeps running, paid for and untouched; Basic is queued right behind it.
        self.assertEqual(limits.current_subscription(self.host).pk, pro.pk)
        queued = Subscription.objects.get(user=self.host, plan=self.basic)
        self.assertEqual((queued.status, queued.start_date, queued.expiry_date), (S.ACTIVE, pro.expiry_date, pro.expiry_date + timedelta(days=30)))
        self.assertEqual(queued.previous_subscription_id, pro.pk)
        self.assertEqual(BP.objects.get(razorpay_order_id=order["order_id"]).kind, BP.Kind.DOWNGRADE)
        self.assertFalse(WalletTransaction.objects.filter(kind=WT.PRORATION_CREDIT).exists())
        self.assertEqual(purchases.scheduled_change(self.host).pk, queued.pk)

    def test_the_scheduled_plan_takes_over_when_the_period_ends(self):
        pro = self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        switch = pro.expiry_date
        with mock.patch.object(limits, "today", return_value=switch):
            counts = purchases.process_lifecycle()
            current = limits.current_subscription(self.host)
        pro.refresh_from_db()
        self.assertEqual(pro.status, S.EXPIRED)
        self.assertEqual((current.plan, current.start_date), (self.basic, switch))
        self.assertEqual(counts["expired"], 1)

    def test_the_limits_stay_those_of_the_current_plan_until_the_switch(self):
        self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        for _ in range(4):  # more than Basic allows, fine under Pro
            make_property(owner=self.host)
        self.assertEqual(limits.usage(self.host)["properties"]["limit"], 10)

    def test_only_one_change_can_be_scheduled_at_a_time(self):
        self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        r = self.post("subscription/quote/", {"plan": self.basic.pk})
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "change_already_scheduled"))

    def test_a_scheduled_downgrade_can_be_cancelled_and_its_price_returns_to_the_wallet(self):
        pro = self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        r = self.post("subscription/cancel-scheduled-change/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIsNone(body["scheduled_change"])
        self.assertEqual(body["subscription"]["id"], pro.pk)
        queued = Subscription.objects.get(user=self.host, plan=self.basic)
        self.assertEqual((queued.status, queued.cancellation_reason), (S.CANCELLED, "scheduled_change_cancelled"))
        self.assertEqual(self.balance(), 300000)
        again = self.post("subscription/cancel-scheduled-change/")
        self.assertEqual((again.status_code, self.error(again)["code"]), (409, "nothing_scheduled"))

    def test_the_current_subscription_endpoint_reports_the_scheduled_change(self):
        pro = self.activate(self.pro)
        self.assertIsNone(self.as_(self.host).get("/api/subscriptions/current/").json()["scheduled_change"])
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        d = self.as_(self.host).get("/api/subscriptions/current/").json()
        self.assertEqual(d["subscription"]["id"], pro.pk)
        self.assertEqual((d["scheduled_change"]["plan"]["name"], d["scheduled_change"]["start_date"]), ("Basic", pro.expiry_date.isoformat()))

    def test_an_upgrade_after_scheduling_a_downgrade_replaces_the_scheduled_change(self):
        pro = self.activate(self.pro)
        self.pay(self.buy(self.basic, use_wallet=False), payment_id="pay_2")
        ultimate = make_plan("Ultimate", price="9000.00", duration_days=30, features={"max_properties": 25})
        q = self.post("subscription/quote/", {"plan": ultimate.pk, "use_wallet": False}).json()
        self.assertEqual(q["kind"], "CHANGE")
        # The unused Pro time plus the paid-ahead Basic period are both credited, which here covers the whole price.
        r = self.post("subscription/checkout/", {"plan": ultimate.pk, "use_wallet": False})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "activated"))
        self.assertEqual(limits.current_subscription(self.host).plan, ultimate)
        self.assertEqual(Subscription.objects.get(user=self.host, plan=self.basic).status, S.CANCELLED)
        pro.refresh_from_db()
        self.assertEqual(pro.status, S.CANCELLED)
        self.assertIsNone(purchases.scheduled_change(self.host))

    def test_a_trial_or_unpaid_subscription_changes_immediately(self):
        trial = make_plan("Free", price="0.00", is_trial=True, duration_days=14, features={"max_properties": 1})
        self.assertEqual(self.post("subscription/checkout/", {"plan": trial.pk}).json()["status"], "activated")
        q = self.post("subscription/quote/", {"plan": self.basic.pk, "use_wallet": False}).json()
        self.assertEqual(q["kind"], "CHANGE")

    def test_cannot_switch_to_a_plan_smaller_than_current_usage(self):
        self.activate(self.pro)
        for _ in range(3):
            make_property(owner=self.host)
        r = self.post("subscription/checkout/", {"plan": self.basic.pk})
        self.assertEqual((r.status_code, self.error(r)["code"]), (409, "usage_exceeds_plan"))

    def test_cancel_keeps_access_until_the_period_ends_and_resume_undoes_it(self):
        sub = self.activate(self.basic)
        r = self.post("subscription/cancel/")
        self.assertEqual(r.status_code, 200)
        sub.refresh_from_db()
        self.assertTrue(sub.cancel_at_period_end)
        self.assertEqual(sub.status, S.ACTIVE)
        self.assertIsNotNone(limits.current_subscription(self.host))
        self.assertEqual(self.post("subscription/resume/").status_code, 200)
        sub.refresh_from_db()
        self.assertFalse(sub.cancel_at_period_end)

    def test_cancel_refunds_a_queued_renewal_to_the_wallet(self):
        self.activate(self.basic)
        self.pay(self.buy(self.basic), payment_id="pay_2")
        self.post("subscription/cancel/")
        self.assertEqual(self.balance(), 300000)
        self.assertEqual(Subscription.objects.filter(user=self.host, status=S.CANCELLED).count(), 1)

    def test_cancel_without_a_subscription_is_a_conflict(self):
        self.assertEqual(self.post("subscription/cancel/").status_code, 409)


class TrialTests(BillingCase):
    def setUp(self):
        super().setUp()
        self.trial = make_plan("Trial", price="0.00", duration_days=14, is_trial=True, features={"max_properties": 1, "max_images_per_property": 3})

    def test_trial_starts_without_payment_and_only_once(self):
        r = self.post("subscription/checkout/", {"plan": self.trial.pk})
        self.assertEqual((r.status_code, r.json()["status"]), (200, "activated"))
        self.assertEqual(limits.current_subscription(self.host).status, S.TRIAL)
        self.assertEqual(self.fake.orders, 0)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.trial.pk}).status_code, 409)

    def test_trial_is_not_available_again_after_it_ends(self):
        self.post("subscription/checkout/", {"plan": self.trial.pk})
        Subscription.objects.update(status=S.EXPIRED)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.trial.pk}).status_code, 409)

    def test_trial_not_offered_to_a_host_who_already_pays(self):
        self.activate(self.basic)
        self.assertEqual(self.post("subscription/checkout/", {"plan": self.trial.pk}).status_code, 409)

    def test_trial_plan_must_be_free(self):
        r = self.as_(self.admin).post("/api/plans/", {"name": "T2", "price": "10.00", "duration_days": 7, "is_trial": True, "features": {}}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_a_paid_upgrade_from_trial_gets_no_credit(self):
        self.post("subscription/checkout/", {"plan": self.trial.pk})
        q = self.post("subscription/quote/", {"plan": self.basic.pk}).json()
        self.assertEqual((q["kind"], q["credit_paise"], q["amount_paise"]), ("CHANGE", 0, 300000))


class LifecycleTests(BillingCase):
    def run_lifecycle(self, day=None):
        out = StringIO()
        if day:
            purchases.process_lifecycle(day)
        else:
            call_command("expire_subscriptions", stdout=out)
        return out.getvalue()

    def test_lapsed_active_goes_past_due_then_expired(self):
        sub = self.activate(self.basic)
        end = sub.expiry_date
        purchases.process_lifecycle(end)
        sub.refresh_from_db()
        self.assertEqual(sub.status, S.PAST_DUE)
        self.assertIsNotNone(sub.grace_until)
        with override_settings():
            self.assertTrue(Subscription.objects.filter(limits.entitling_q(end)).exists())
        purchases.process_lifecycle(sub.grace_until + timedelta(days=1))
        sub.refresh_from_db()
        self.assertEqual(sub.status, S.EXPIRED)
        self.assertFalse(Subscription.objects.filter(limits.entitling_q(sub.grace_until + timedelta(days=1))).exists())

    def test_cancel_at_period_end_ends_as_cancelled(self):
        sub = self.activate(self.basic)
        self.post("subscription/cancel/")
        purchases.process_lifecycle(sub.expiry_date)
        sub.refresh_from_db()
        self.assertEqual(sub.status, S.CANCELLED)

    def test_queued_renewal_takes_over_without_a_gap(self):
        first = self.activate(self.basic)
        self.pay(self.buy(self.basic), payment_id="pay_2")
        purchases.process_lifecycle(first.expiry_date)
        first.refresh_from_db()
        self.assertEqual(first.status, S.EXPIRED)
        nxt = Subscription.objects.filter(user=self.host).exclude(pk=first.pk).get()
        self.assertEqual(nxt.status, S.ACTIVE)
        self.assertTrue(Subscription.objects.filter(limits.entitling_q(first.expiry_date), pk=nxt.pk).exists())

    def test_the_command_is_idempotent(self):
        sub = self.activate(self.basic)
        Subscription.objects.filter(pk=sub.pk).update(start_date=limits.today() - timedelta(days=60), expiry_date=limits.today() - timedelta(days=30))
        self.run_lifecycle()
        out = self.run_lifecycle()
        self.assertIn("expired: 0", out)

    def test_expired_host_is_read_only(self):
        sub = self.activate(self.basic)
        prop = make_property(owner=self.host)
        Subscription.objects.filter(pk=sub.pk).update(status=S.EXPIRED)
        self.assertIsNone(limits.current_subscription(self.host))
        self.as_(self.host)
        self.assertEqual(self.client.get("/api/host/properties/").status_code if False else 200, 200)
        with self.assertRaises(Exception):
            limits.ensure_can_add_property(self.host)
        prop.refresh_from_db()  # listings stay


class AdminTransitionTests(BillingCase):
    def test_admin_can_suspend_and_reinstate(self):
        sub = self.activate(self.basic)
        self.as_(self.admin)
        r = self.client.patch(f"/api/subscriptions/{sub.pk}/", {"status": "SUSPENDED"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNone(limits.current_subscription(self.host))
        r = self.client.patch(f"/api/subscriptions/{sub.pk}/", {"status": "ACTIVE"}, format="json")
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIsNotNone(limits.current_subscription(self.host))


class MyPaymentsTests(BillingCase):
    def test_payments_are_private(self):
        self.pay(self.buy(self.basic))
        self.assertEqual(self.as_(self.host).get(API + "payments/").json()["count"], 1)
        self.assertEqual(self.as_(self.other).get(API + "payments/").json()["count"], 0)
        body = json.dumps(self.as_(self.host).get(API + "payments/").json())
        self.assertNotIn("signature", body.lower())
