# Blüdhaven: architecture and operations guide

> **Blüdhaven is NOT multi-tenant.** It is one marketplace with one shared dataset. There are no tenant or
> organisation models, no tenant IDs, no tenant middleware and no per-tenant schemas or databases. A Host sees
> and manages only the properties they own (*Host ownership*), enforced by role and by queryset filtering.

> **This application uses a single shared dataset with role-based access and Host ownership. It does not use multi-tenancy.**

## 1. Final architecture

```
            React + Vite  (SPA: Tailwind, GSAP, Lenis, Axios)
                 |
                 |  HTTPS / REST API  (JSON; multipart for photos)
                 v
            Django + DRF
                 |
                 +-- Authentication / JWT (SimpleJWT, httpOnly refresh cookie, CSRF)
                 +-- RBAC (SUPER_ADMIN / HOST / END_USER + Host ownership)
                 +-- Properties (destinations, amenities, images, availability)
                 +-- Bookings (PENDING -> [verified payment] CONFIRMED -> COMPLETED / CANCELLED; EXPIRED, REFUND_REQUIRED)
                 +-- Payments (Razorpay order + verification + webhook for guest bookings)
                 +-- Reviews (one per completed booking)
                 +-- Favourites
                 +-- Subscriptions (plans, assign, renew, plan limits)
                 +-- Billing (billing profiles, informational payment status)
                 |
                 +--------> MySQL 8   (all application data)
                 |
                 +--------> Cloudinary (property photos; server-side only)
```

No tenant layer exists anywhere: there is one set of tables, shared by everyone.

### Authentication at a glance

```
 React                                              Django API
   |   access token (15 min), held in JS memory only     |
   |-------- Authorization: Bearer <access> ------------>|   every API call
   |                                                     |
   |   refresh token: httpOnly cookie, invisible to JS   |
   |-- GET /api/auth/csrf/  -> {csrfToken} ------------->|
   |-- POST /api/auth/token/refresh/  ------------------>|   cookie sent by the browser
   |       X-CSRFToken: <csrfToken>, empty body          |   + CSRF check + Origin check
   |<------- {access}  (+ rotated cookie) ---------------|
```

| Part | Notes |
| ---- | ----- |
| `backend/apps/accounts` | email-login `User`, roles, JWT/cookie auth, email verification, password reset, profile + password change, Super Admin user management |
| `backend/apps/catalog` | destinations, amenities, properties, property images, favourites; Cloudinary abstraction (`storage.py`) and image processing (`imaging.py`) |
| `backend/apps/payments` | Razorpay guest payments: `Payment` (one per booking), `gateway.py` (the only code that talks to Razorpay), `services.py` (initiate / verify / idempotent settle), webhook |
| `backend/apps/bookings` | bookings (status workflow, availability rules in `services.py`), reviews |
| `backend/apps/billing` | subscription plans, subscriptions (self-serve purchase, assign / renew), Host wallet and ledger, billing payments, billing profiles, plan-limit enforcement (`limits.py`, `purchases.py`) |
| `backend/apps/core` | health check, site settings, error handler, pagination, throttle classes |
| `frontend/src/services` | `api.js` (Axios, token, refresh, CSRF), one module per domain, `errors.js` |
| `frontend/src/context` | `AuthProvider` (session), `FavouritesProvider` (server-backed favourites), theme |
| `frontend/src/components/RequireRole.jsx` | route guard (UX only) |
| `frontend/src/pages/{host,admin}` | Host and Super Admin panels |

### React architecture
- **Data flow:** pages call `services/*` through small hooks (`useApiQuery` for reads with loading/error/retry and abort, `useMutation` for writes). Axios responses are mapped to the shapes the existing UI components expect in `utils/mappers.js`. There is no client-side copy of the catalogue: listings, details, availability, bookings, reviews, favourites and plans always come from the API.
- **Session:** `AuthProvider` restores the session on load (refresh cookie, then `GET /api/auth/me/`); `FavouritesProvider` holds the signed-in user's saved properties (optimistic toggle with rollback).
- **Guards:** `RequireRole` renders nothing protected until the session is known; the wrong role sees a "no access" page. These guards only spare people from screens that would fail: **every request is authorised again by the backend**.
- **Money:** the frontend never computes an authoritative price. The price shown before paying comes from `POST /api/bookings/quote/`, the booking total from `POST /api/bookings/`, and the Razorpay amount from the server's order; all are shown as returned. Payment success is only believed after `POST /api/bookings/<id>/payment/verify/` answers `CONFIRMED`.
- **Static content:** only genuinely static copy (FAQ, "How Blüdhaven works", marketing text) lives in the bundle. There are no testimonials, because there is no review feature for them to come from other than real, per-stay guest reviews.

### Django architecture
One project (`config`) and five apps. Views are DRF viewsets with explicit permission classes (`apps/accounts/permissions.py`); business rules live in services/serializers (`bookings/services.py`, `billing/limits.py`), not in views or the frontend. A single exception handler gives every error the shape `{"error": {"code","message","details?"}}` and never leaks stack traces. Pagination, filtering, ordering and throttling are configured once in settings.

## 2. Authentication flow

1. **Register** `POST /api/auth/register/` (`email`, `full_name`, `password`; the role is always `END_USER`). A verification email is sent.
2. **Verify email**: the link is `{FRONTEND_URL}/verify-email?token=…`. The page reads the token, removes it from the URL, and POSTs it once.
3. **Login** `POST /api/auth/token/` returns `{access, user}` and sets the refresh cookie. The SPA keeps `access` in a module variable.
4. **Calls** carry `Authorization: Bearer <access>`. Access tokens last 15 minutes.
5. **401** → the Axios interceptor performs **one shared** refresh (`POST /api/auth/token/refresh/`, empty body), then retries the original request once. Parallel 401s wait for the same refresh. Refresh/login/logout/CSRF calls are never themselves refreshed (no loops).
6. **Page reload**: access token is gone, so the app calls refresh (cookie) and then `GET /api/auth/me/`. A non-secret flag `bh_has_session` in `localStorage` only says "try to restore"; it holds no token. A refresh that is rejected (401/403) ends the session; a network error keeps it.
7. **Logout** `POST /api/auth/token/blacklist/` revokes the refresh token and clears the cookie; the SPA drops the token and flag.
8. **Account page:** `PATCH /api/auth/me/` changes `full_name` only (no role, email or status). `POST /api/auth/change-password/` needs the current password, applies Django's validators, refuses reusing the old password, and **revokes every refresh token**; the SPA then sends the person to `/login`. Access tokens already issued expire within 15 minutes, as after a password reset.
9. **Forgot password** `POST /api/auth/password-reset/` → email link `{FRONTEND_URL}/reset-password?uid=…&token=…` → `POST /api/auth/password-reset/confirm/`. Links last `PASSWORD_RESET_TIMEOUT_MINUTES` (60); a reset also revokes every refresh token. Host invitations use the same 60-minute link; a Super Admin can resend (`POST /api/users/<id>/send-password-reset/`).

## 3. Cookie and CSRF flow

- The refresh token lives only in the `bludhaven_refresh` cookie: `HttpOnly`, `Secure` (on unless `DEBUG`), `SameSite=Lax` by default, `Path=/api/auth/`. It never appears in a response body or request body.
- Because a cookie is sent automatically, refresh and logout are CSRF-protected: the SPA calls `GET /api/auth/csrf/` (returns `{csrfToken}`) and sends it as `X-CSRFToken`; the request's `Origin` must be in `CSRF_TRUSTED_ORIGINS` (defaults to `CORS_ALLOWED_ORIGINS`).
- Axios uses `withCredentials: true`; the API sets `CORS_ALLOW_CREDENTIALS` with an explicit origin list (no wildcard).
- Same-site deployment (`app.example.com` + `api.example.com`) works with `Lax`. Cross-site needs `REFRESH_COOKIE_SAMESITE=None` + HTTPS + explicit origins.

**Rate limits (per client address, own bucket each, configurable by `THROTTLE_*`):** `auth` (login, verification, reset confirmation) 10/min, `refresh` 30/min, `logout` 20/min, `register` 10/hour, `password_reset` and `resend_verification` 5/hour, `password_change` 10/hour per user. Restoring a session on every page load only uses the `refresh` bucket, so it can never exhaust login attempts. The SPA never retries a throttled refresh in a loop and keeps the person signed in (the cookie is untouched by a 429).

## 4. RBAC

| Role | Can do |
| ---- | ------ |
| `SUPER_ADMIN` | everything: users (invite Hosts, activate/deactivate, edit), all properties/bookings, destinations & amenities, plans, subscriptions (assign/renew/edit), billing profiles |
| `HOST` | own properties and their images, bookings on own properties (cancel/complete; confirmation happens only through payment), own subscription & billing profile; needs an **active subscription** to create properties / upload images |
| `END_USER` | browse, favourites, create/cancel own bookings, review completed stays (verified email required to book/review) |
| anonymous | browse destinations, amenities, properties, reviews and **plans** |

No endpoint can promote anyone to `SUPER_ADMIN`; Super Admins are created on the server (`createsuperuser`). Public registration cannot choose a role.
**The backend is the only authority.** The React route guards and hidden menu items exist so people are not shown pages that would fail; every request is authorised again by DRF permission classes.

## 5. Host ownership model

`Property.owner` is the Host. Querysets for Hosts are filtered to `owner=request.user`; writing `owner` is ignored/forbidden. Images, bookings-on-my-properties and limits all derive from that ownership. A Host writing to another Host's property or image gets 403 `permission_denied`; bookings of other Hosts' properties are simply invisible (404). A Super Admin can view, edit, delete (where the rules allow) and manage the images of any property; a Host's reach never extends past their own. There is no tenant concept anywhere.

## 6. Booking workflow, availability and reviews

- **Create:** an End User with a verified email posts `{property, check_in, check_out, guests_count}`. The server sets guest, status `PENDING` (awaiting payment), `expires_at` (now + 15 minutes) and the price (`nights x price_per_night`, frozen at that moment, recomputed server-side, never taken from a quote). Rules: not in the past, check-out after check-in, at most `BOOKING_MAX_NIGHTS` (90), guests within capacity, dates free. Concurrent requests for one property are serialised with a row lock.
- **Workflow:** `PENDING -> CONFIRMED` **only by a verified Razorpay payment inside the window** (nobody confirms by hand, not even a Super Admin), `PENDING -> EXPIRED` when the window ends unpaid, `EXPIRED -> REFUND_REQUIRED` when a late payment arrives (never revived; refunded manually), `PENDING|CONFIRMED -> CANCELLED` (guest, Host, Super Admin), `CONFIRMED -> COMPLETED` (Host/Super Admin, only after check-out). `CANCELLED`, `COMPLETED`, `EXPIRED` and `REFUND_REQUIRED` are final.
- **Availability:** `GET /api/properties/<id>/availability/` returns merged half-open ranges of taken nights (`start` inclusive, `end` exclusive; check-out day is free). `CONFIRMED` bookings and `PENDING` ones inside their 15-minute window block; `CANCELLED`, `COMPLETED`, `EXPIRED` and `REFUND_REQUIRED` do not (expiry is enforced by the queries, not by a cleanup job). It is public, read-only and returns dates only. The booking calendar greys those days out; creating a booking re-checks on the server, so a stale calendar can never double-book.
- **Reviews:** a review is tied one-to-one to a **booking** (not just a property). Only the booking's guest can create it, only when it is `COMPLETED`, once; the property comes from the booking and cannot be changed. Two completed stays at the same property can each be reviewed. `GET /api/bookings/` includes each booking's own `review` (or `null`) so the UI never has to guess which stay a review belongs to. Hosts cannot write reviews; the author or a Super Admin can delete one.

## 7. API overview

Reference with every field and error code: [`backend/docs/API.md`](../backend/docs/API.md). Postman: [`backend/docs/postman/`](../backend/docs/postman/README.md) (environment variables for base URL, access token, CSRF token and IDs; no secrets; the refresh token is cookie-only).

Groups: `auth/*`, `users/*` (Super Admin), `destinations`, `amenities`, `properties` (+ `images`), `favourites`, `bookings` (+ `quote|cancel|complete`, `<id>/payment/`, `<id>/payment/verify/`), `payments/razorpay/webhook/`, `reviews`, `plans`, `subscriptions` (+ `current`, `renew`), `billing/*` (wallet, quote, checkout, verify, cancel, resume, payments), `wallets`, `wallet-transactions`, `billing-payments`, `billing-profile(s)`.
Errors: `{"error": {"code","message","details?"}}`. Lists: `{count,next,previous,results}` with `page`, `page_size` (max 100).
The booking total is computed by the backend; the frontend only displays it. See `docs/PAYMENTS.md` for the payment flow.

## 8. Subscription system

- Plans (`SubscriptionPlan`): name, description, price, `duration_days`, `features` JSON, `is_active`. **Plans are publicly readable** (inactive plans only for Super Admin); only Super Admin writes them. The only recognised feature keys are `max_properties` and `max_images_per_property`; a missing key means no limit is set. No prices or limits are built into the code.
- A subscription gives access when (`ACTIVE` or `TRIAL`, `start_date <= today < expiry_date`) or (`PAST_DUE` and `today <= grace_until`). Hosts buy, change, renew and cancel plans themselves, paid through Razorpay and/or their wallet (see `docs/PAYMENTS.md`, "Host billing"); a Super Admin can still assign, renew, suspend or cancel. Each paid period is its own row, so history is preserved.
- Super Admin assigns a plan to a Host (`POST /api/subscriptions/`), copies a **price snapshot** of the plan, and prevents overlapping entitled subscriptions.
- **Renew** `POST /api/subscriptions/<id>/renew/` (Super Admin): extends from the current expiry if still running, otherwise restarts from today, using `duration_days`; keeps the price snapshot; refuses cancelled subscriptions (409 `invalid_transition`), inactive plans (409 `plan_inactive`) and overlaps (409 `subscription_overlap`).
- `python manage.py expire_subscriptions` marks ended subscriptions EXPIRED (run daily via cron). Entitlement is also checked by date, so a missed run does not grant access.
- UI: public `/plans`; Host `/host/subscription` (status, dates, limits, usage, billing profile); Super Admin `/admin/plans`, `/admin/subscriptions`.

## 8a. Host onboarding and draft listings

- **Route** `/host/onboarding` (every "Become a host" link). Existing Hosts use `/host/login`; `/login` and `/signup` remain the Guest portal.
- **Account**: `POST /api/auth/register-host/` creates a user whose role the **server** sets to HOST (a `role` key in the body is rejected). A signed-in Guest is not converted; they must sign out first.
- **Drafts**: `Property.status` is `DRAFT` or `PUBLISHED` (existing rows and the plain create API default to `PUBLISHED`, so the old create flow still needs a plan). Drafts are visible only to the owner and Super Admin: excluded from the public list, detail, availability, images, bookings, favourites and destination counts. A Host lists their own drafts with `GET /api/properties/?mine=true&status=DRAFT`. Drafts do not count toward `max_properties`; they are capped by `MAX_DRAFTS_PER_HOST` and, before a plan exists, `DRAFT_MAX_IMAGES` photos each.
- **Publish**: `POST /api/properties/<id>/publish/` re-checks the active plan, `max_properties`, `max_images_per_property`, completeness (title, description, price > 0, at least one photo) and premium amenities. `POST .../unpublish/` returns a listing to draft.
- **Photos** reuse `PropertyImage` and the Cloudinary upload (one storage system). `POST /api/properties/<id>/images/reorder/` (JSON `{"order":[ids]}`) sets positions; position 0 is the cover. Public IDs are never exposed.
- **Premium amenities**: `Amenity.is_premium` plus plan feature `premium_amenities` (boolean). The backend rejects assigning a premium amenity unless the owner's plan allows it, and publish re-checks. Set `is_premium` in Django admin or via the amenities API (no dedicated UI yet).
- **Private address**: street address and unit are returned only to the owner and Super Admin, never in public responses.
- **Payment**: plan purchase reuses the billing system (`docs/PAYMENTS.md`); the email must be verified, and the plan is activated only after server-side signature/webhook verification. A failed payment leaves the listing as a draft with all data intact.
- Settings: `MAX_DRAFTS_PER_HOST` (3), `DRAFT_MAX_IMAGES` (10).

## 9. MySQL configuration

MySQL 8, utf8mb4, strict mode. Create an empty database and a dedicated user, then set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT` (and optionally `DB_SSL_CA`) in `backend/.env`. There is no SQLite fallback. `python manage.py migrate` creates the schema; tests run against a temporary MySQL test database (the user needs `CREATE` on `test_<DB_NAME>`).

## 10. Cloudinary configuration

Set `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>` on the **server only** (never in the frontend). Uploads are multipart to `POST /api/properties/<id>/images/` (field `image`), validated by file content (`IMAGE_ALLOWED_FORMATS`, `IMAGE_MAX_BYTES`, `IMAGE_MAX_PIXELS`), re-encoded, and stored under `<CLOUDINARY_ROOT_FOLDER>/hosts/<host id>/properties/<property id>/<random id>`. The API returns only `url`, `alt_text`, `position`, size facts; the Cloudinary public ID is stored in MySQL for deletion but is never returned. Without `CLOUDINARY_URL`, uploads answer 503 `storage_unavailable`.

Safeguards: size cap (`IMAGE_MAX_BYTES`, also checked from `Content-Length` before reading the body), pixel cap, format allow-list decided from the file content, EXIF/appended data stripped by re-encoding, per-user upload throttle, server-generated IDs only. If the database save fails after the upload, the uploaded file is deleted again (compensation); deleting an image (or a property) removes the Cloudinary file after the transaction commits. A failed Cloudinary delete is logged and never breaks the request, which can leave an orphan file.

> **Real Cloudinary has not been exercised by the automated tests.** They use a fake store and a mocked SDK, which prove our code paths but not your account. After deploying with real credentials run `python manage.py check_storage` (uploads a 1x1 test image, reads it back, deletes it and reports problems), then upload a real photo through the Host screen. Never commit `CLOUDINARY_URL`; set it in the server environment.

## 11. Frontend environment variables

| Variable | Purpose |
| -------- | ------- |
| `VITE_API_BASE_URL` | Django base URL (default `http://localhost:8000`). Must be an origin allowed by the backend CORS/CSRF settings |
| `VITE_SITE_URL` | Public site URL for canonical links, sitemap, robots (set for production builds) |
| `VITE_CUSTOMER_CARE_EMAIL`, `VITE_CUSTOMER_CARE_PHONE` | Where Hosts are sent by "Contact Customer Care" (plans are bought through Customer Care). **Placeholder: set your real details.** Empty = the button says details are not available yet |
| `PEXELS_API_KEY` | Only for the optional `npm run images` script; never bundled |

`VITE_*` values are public in the built bundle. Never put secrets in them.

## 12. Local development

```bash
# backend
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env            # set DB_* and keep DJANGO_DEBUG=True
python manage.py migrate
python manage.py createsuperuser            # first Super Admin
python manage.py seed_demo_data --accounts  # optional, DEBUG only: destinations, amenities, 36 demo properties + demo accounts
python manage.py runserver                  # http://localhost:8000
python manage.py check_storage              # only once CLOUDINARY_URL is set to a real account
# frontend
cd frontend && npm install && cp .env.example .env && npm run dev   # http://localhost:5173
```

Development emails print to the `runserver` console (copy the verify/reset link). Demo accounts from the seed command (`demo-admin@`, `demo-host@`, `demo-guest@demo.bludhaven.test`) must never exist in production; the command refuses to run when `DJANGO_DEBUG` is off.

Without `CLOUDINARY_URL` photo uploads answer 503; seeded demo properties have no photos and show a placeholder tile.

Checks: `python manage.py test`, `python manage.py check`, `python manage.py makemigrations --check`, `npm run lint`, `npm test`, `npm run build`.

## 13. Production configuration

Backend (`DJANGO_DEBUG=False` makes the app refuse to start without these): a long random `DJANGO_SECRET_KEY` (and optionally a separate `JWT_SIGNING_KEY`), `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` (https origin of the SPA), `CSRF_TRUSTED_ORIGINS`, `FRONTEND_URL` (https), SMTP settings (`EMAIL_HOST`, …), MySQL credentials, `CLOUDINARY_URL`. HTTPS redirect, secure cookies and HSTS turn on automatically; set `DJANGO_BEHIND_PROXY=True` and `NUM_PROXIES` correctly behind a load balancer so throttling sees real client addresses. Verify with `python manage.py check --deploy`.
Throttle counters use Django's cache (per-process locmem by default): configure a shared cache (Redis/Memcached) when running several workers.
Frontend: set `VITE_API_BASE_URL` and `VITE_SITE_URL`, then `npm run build`.

## 14. Deployment

1. Provision MySQL 8 (utf8mb4) and a user; take backups.
2. Backend: `pip install -r requirements.txt`, set env, `python manage.py migrate`, run behind gunicorn/uwsgi + a TLS-terminating proxy; add a daily cron `python manage.py expire_subscriptions`.
3. Create the first Super Admin on the server: `python manage.py createsuperuser`.
4. Frontend: `npm ci && npm run build`; serve `frontend/dist` as static files from a CDN/nginx with SPA fallback (all unknown paths → `index.html`). Prefer the same site as the API (e.g. `app.` and `api.` subdomains) so the `Lax` refresh cookie works.
5. Smoke test: `GET /api/health/`, register → verify email → login → refresh (reload page) → logout; Host with active subscription creates a property and uploads an image.

## 15. Security checklist (verified in the final pass)

| Item | Status |
| ---- | ------ |
| Refresh token not in localStorage/sessionStorage, not readable by JS | httpOnly cookie only; the only stored flag is `bh_has_session` (no token); covered by frontend tests and a live browser check |
| Access token only in JS memory | yes; never persisted |
| No passwords or tokens in logs | `test_log_hygiene` exercises login, refresh, logout, change/reset password and scans every log record |
| No Cloudinary public IDs exposed | `storage_key` is never serialised; tests assert it |
| No role change through unsafe endpoints | register/`PATCH /me` reject extra keys; no API creates or promotes a Super Admin; Super Admin can only set HOST/END_USER |
| Host ownership | queryset/object permissions + RBAC tests for every Host-vs-Host case |
| Subscription limits | enforced server-side on create and upload, against the property owner's plan |
| Email verification | enforced for booking and reviewing (`email_not_verified`) |
| CSRF for cookie refresh/logout | `X-CSRFToken` + trusted `Origin` required (`csrf_failed` otherwise) |
| CORS | explicit origin list only; wildcard refused; no defaults in production |
| `DEBUG` | defaults to off; `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` required when off (app refuses to start) |
| HTTPS | redirect, HSTS, secure cookies on when `DEBUG` is off (`check --deploy` clean apart from the optional HSTS subdomain/preload advice) |
| Error responses | one JSON shape; unexpected errors are a generic 500 with no traceback |
| Rate limiting | enabled on every credential endpoint and generally on all others |

## 16. Known limitations

- Host subscription payments do not exist (Customer Care + manual assignment); subscription `payment_status` is a manual, informational field.
- Guest payments use Razorpay but have **no automatic refunds**: late payments (`REFUND_REQUIRED`) and cancellations of paid bookings are refunded by hand in the Razorpay dashboard.
- The Razorpay integration was tested only against a mocked gateway; it needs a real test-mode check (keys + public webhook URL) before launch.
- Customer Care contact details are configuration (`VITE_CUSTOMER_CARE_EMAIL` / `_PHONE`), not data in the repository.
- Throttle counters are per process unless a shared cache is configured.
- The only email flows are verification, password reset and Host invitation; there are no booking notifications.
- Email address changes are not offered (no re-verification flow).
- A second Super Admin must be created on the server (`createsuperuser`).
- Real Cloudinary and real SMTP must be smoke-tested after deployment.
