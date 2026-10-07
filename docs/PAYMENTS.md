# Payments (Razorpay): guest bookings and Host billing

Guest room bookings, **Host plan purchases and Host wallet top-ups** are paid online with **Razorpay**. Host billing is described in the last section; the guest booking flow is unchanged by it. Blüdhaven remains a single platform (no tenants, no organisations).

## How a guest booking is paid

```
Guest picks property + dates + guests
  → POST /api/bookings/quote/                 server prices the stay (saves nothing)
  → POST /api/bookings/                       PENDING booking, holds the dates for 15 minutes, price recomputed by the server
  → POST /api/bookings/<id>/payment/          server creates (or reuses) the Razorpay order; amount = booking.total_price in paise
  → Razorpay Checkout (hosted by Razorpay)    card details never touch Blüdhaven
  → POST /api/bookings/<id>/payment/verify/   server checks signature, order, amount, currency, status, expiry → CONFIRMED
  ↳ independently: POST /api/payments/razorpay/webhook/   same checks; confirms even if the browser was closed
```

The frontend is never authoritative for the amount or for success: it shows the server's quote, opens Checkout with the server's order, and shows "Booking confirmed" only after the verify endpoint answers `CONFIRMED`.

## States

| Booking | Meaning |
| ------- | ------- |
| `PENDING` ("Awaiting payment") | Holds its dates only while `expires_at` is in the future (15 minutes after creation, `BOOKING_PAYMENT_WINDOW_MINUTES`). |
| `CONFIRMED` | A verified payment arrived inside the window. Nobody (Host or Super Admin) can confirm a booking by hand. |
| `EXPIRED` | Not paid in time. Stops blocking the dates. **Never automatically resurrected.** |
| `REFUND_REQUIRED` | A payment arrived after the booking had expired (or was cancelled). The booking is **not** confirmed; the `Payment` row is kept (with the Razorpay payment id) so you can refund it **manually in the Razorpay dashboard**. |
| `CANCELLED`, `COMPLETED` | As before. |

`Payment.status`: `CREATED` (order made), `PAID`, `FAILED` (Razorpay reported a failed attempt; the guest may retry on the same order), `REFUND_REQUIRED`. One `Payment` per booking (one-to-one), unique order id and payment id. Only identifiers and amounts are stored: no card data.

Expiry is enforced by the queries (availability, search, booking creation all ignore an unpaid booking past `expires_at`), so correctness does not depend on a scheduled job. To keep stored statuses tidy you may run `python manage.py expire_unpaid_bookings` from cron every few minutes (optional; bookings requests also sweep lazily).

**No automatic refunds.** There is no refund API or refund UI. Refund `REFUND_REQUIRED` payments (and any paid booking you cancel) in the Razorpay dashboard.

**Existing data.** The migration marks every pre-existing unpaid `PENDING` booking `EXPIRED` (it has no payment window and was never paid). `CONFIRMED`, `CANCELLED` and `COMPLETED` bookings are untouched; old confirmed bookings simply have no payment record.

## Local setup (needs Razorpay TEST credentials)

1. Create a Razorpay account and switch the dashboard to **Test Mode**. Under *Account & Settings → API Keys* generate a key pair.
2. In `backend/.env` set `RAZORPAY_KEY_ID=rzp_test_...` and `RAZORPAY_KEY_SECRET=...` (backend only; never in the frontend or git).
3. Run the API and the frontend as usual. Without these keys, starting a payment returns 503 `payment_not_configured`.
4. Pay with Razorpay's test cards/UPI (see Razorpay's *Test Card Details* page). Checkout is loaded from `https://checkout.razorpay.com/v1/checkout.js`, so the browser needs internet access.

### Webhook (needed to confirm when the browser closes)

Razorpay must be able to reach your server, so locally you need a public HTTPS tunnel (for example ngrok or cloudflared) to port 8000.

1. Dashboard (Test Mode) → *Webhooks* → *Add new webhook*.
2. URL: `https://<your-public-host>/api/payments/razorpay/webhook/`.
3. Secret: choose a long random string and put the same value in `RAZORPAY_WEBHOOK_SECRET`.
4. Events: `payment.captured`, `order.paid`, `payment.failed`.
5. Restart the API after changing `.env`.

Webhook requests are authenticated only by the signature over the raw body; a bad or missing signature is a 400 and changes nothing. Valid deliveries are always answered 200, and processing is idempotent, so Razorpay's retries are harmless.

## What is and is not tested

- Backend automated tests (`python manage.py test`) and frontend tests (`npm test`) run against a **mocked** Razorpay (no network). They cover price calculation, order creation, ownership, signature/order/amount/currency checks, duplicate verification and webhooks, webhook-before/after-verification, failed and abandoned payments, 15-minute expiry, late payment → `REFUND_REQUIRED`, and concurrent settlement.
- A real Razorpay payment and a real Razorpay webhook delivery were **not** tested (for bookings or for Host billing) in development (the build environment cannot reach Razorpay). Do a test-mode payment and webhook delivery with your own test keys before going live.

## Host billing (plans, wallet, renewal)

Flow: Host chooses a plan at `/host/plans` -> `POST /api/billing/subscription/quote/` shows the exact price -> `.../checkout/` creates a Razorpay order (or activates straight away if the wallet covers it) -> Checkout -> `POST /api/billing/payments/verify/` (signature + Razorpay lookup) and/or the same webhook -> the subscription row is created and the plan's limits apply. The browser never decides an amount or whether a payment counts. The webhook (`/api/payments/razorpay/webhook/`) tries a billing order first and falls back to a booking.

- **Plans** are database rows edited by the Super Admin: price, `duration_days` (the billing period), limits, active flag, and an `is_trial` flag (price must be 0; one per Host, only for a Host with no running plan). Nothing is hard-coded.
- **Periods.** Billing is one Razorpay order per period (no auto-debit mandate). Each paid period is its own `Subscription` row, so history is kept. Renewing the same plan queues the next period to start when the current one ends.
- **Statuses.** TRIAL, ACTIVE, PAST_DUE, EXPIRED, CANCELLED, SUSPENDED. TRIAL, ACTIVE and PAST_DUE (inside its grace days) give access; the rest do not. After access ends the Host is **read-only**: listings stay visible, adding properties and photos is blocked.
- **Proration.** Changing plans cancels the running plan and credits the unused whole days (`amount * days_left // total_days`) toward the new price; a queued, already-paid renewal is credited in full; trial/unpaid/past-due periods earn no credit. A plan whose limits are below current usage cannot be chosen.
- **Wallet.** A top-up wallet in paise with an append-only ledger (`WalletTransaction`: top-ups, plan payments, proration credits, admin adjustments with a reason). The wallet is used first when buying; the rest is charged through Razorpay. Settlement is idempotent (row locks plus a unique ledger entry per payment and kind), so a repeated webhook or verify never double-credits.
- **Lifecycle.** Run `python manage.py expire_subscriptions` daily (cron / Task Scheduler). It moves lapsed ACTIVE rows to PAST_DUE for `SUBSCRIPTION_GRACE_DAYS` (default 3), then EXPIRED, ends cancel-at-period-end rows as CANCELLED, and starts queued renewals. It is safe to run repeatedly. Without it, a lapsed subscription simply stops giving access.
- **Refunds are manual.** A payment that arrives for a replaced order or that can no longer be applied is stored as `REFUND_REQUIRED`; refund it in the Razorpay dashboard.
- **Settings.** `SUBSCRIPTION_GRACE_DAYS`, `WALLET_TOPUP_MAX_RUPEES` (see `.env.example`).
- **Not built:** automatic recurring debits, automatic refunds, renewal emails, feature flags beyond the two limits.
