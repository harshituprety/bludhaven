# Blüdhaven API reference

Base URL in development: `http://localhost:8000`. All bodies are JSON. Protected endpoints take
`Authorization: Bearer <access token>`. The refresh token is never in a body: it is an httpOnly cookie (see *Sessions*).

## Conventions

**Errors** always have this shape:

```json
{"error": {"code": "validation_error", "message": "Invalid input.", "details": {"email": ["..."]}}}
```

`details` is present for validation errors (field → messages) and throttling (`{"retry_after": seconds}`).

| Status | `code` examples |
| ------ | ---------------- |
| 400 | `validation_error`, `parse_error`, `invalid_token` (bad/expired/used link) |
| 401 | `not_authenticated`, `token_not_valid`, `no_active_account` |
| 403 | `permission_denied` |
| 404 | `not_found` |
| 405 / 415 | `method_not_allowed`, `unsupported_media_type` |
| 429 | `throttled` (also sends a `Retry-After` header) |
| 500 | `server_error` (generic; details are only in the server log) |

**Lists** (later phases) are paginated: `?page=2&page_size=24` (default 12, max 100) and return
`{count, next, previous, results}`. Filtering, `?search=` and `?ordering=` are opt-in per endpoint.

**User object** returned by register, login and `me`:
`{id, email, full_name, role, is_email_verified, date_joined}`. The password is never returned.

## Endpoints

| Method | Path | Auth | Throttle scope | Purpose |
| ------ | ---- | ---- | -------------- | ------- |
| GET | `/api/health/` | public | `anon` | Liveness probe |
| POST | `/api/auth/register/` | public | `register` | Create an End User and send the verification email |
| POST | `/api/auth/verify-email/` | public | `auth` | Verify an email address with the emailed token |
| POST | `/api/auth/resend-verification/` | public | `resend_verification` | Send a new verification email (only if the account exists and is unverified) |
| GET | `/api/auth/csrf/` | public | `anon` | `{csrfToken}` for refresh/logout |
| POST | `/api/auth/token/` | public | `auth` | Log in: `{access, user}` + refresh cookie |
| POST | `/api/auth/token/refresh/` | cookie + CSRF | `refresh` | Empty body; rotates the cookie, returns `{access}` |
| POST | `/api/auth/token/blacklist/` | cookie + CSRF | `logout` | Log out: revoke the refresh token, clear the cookie (always 200) |
| POST | `/api/auth/password-reset/` | public | `password_reset` | Ask for a password-reset email |
| POST | `/api/auth/password-reset/confirm/` | public | `auth` | Set a new password with the emailed link |
| GET | `/api/auth/me/` | Bearer | `user` | The signed-in user |
| PATCH | `/api/auth/me/` | Bearer | `user` | Change your own `full_name` (nothing else) |
| POST | `/api/auth/change-password/` | Bearer | `user` + `password_change` | Change your password; signs you out everywhere |

### Register — `POST /api/auth/register/`

Body: `{"email", "full_name", "password"}`. Nothing else is accepted: any other key (`role`,
`is_staff`, `is_email_verified`, ...) returns 400 and creates nothing. The role is always `END_USER`.
The password must pass Django's validators (length, not common, not all numeric, not like the email).
Returns **201** with the user object (`is_email_verified: false`) and sends the verification email.
If the email cannot be sent, the account is still created and the failure is logged.

### Verify email — `POST /api/auth/verify-email/`

Body: `{"token": "<from the emailed link>"}`. The link looks like
`{FRONTEND_URL}/verify-email?token=...`; the React page reads `token` and POSTs it here.

- **200** `{"detail": "Email verified.", "already_verified": false}`
- **200** `{"detail": "Email is already verified.", "already_verified": true}` (replay is harmless)
- **400** `invalid_token` for anything wrong, tampered, expired (48 h by default) or issued for an address that has since changed
- The response never includes the address, the user or the token.
- It is a POST on purpose, so email scanners that open links cannot verify an account.
- A client cannot set the verified state: it is stored server-side only (`email_verified_at`), is read-only in the API and in the admin, and registration rejects attempts to send it. Super Admins created with `createsuperuser` start verified.
- Logging in does not require a verified address. **Creating a booking does** (403 with code `email_not_verified`); browsing, favourites and reading your own bookings do not.

### Resend verification — `POST /api/auth/resend-verification/`

Body: `{"email"}`. Always answers **200** with the same message, whether or not the address has an
account or is already verified, so it reveals nothing. A new email goes out only to an *active,
unverified* account, with the same signed-token mechanism and expiry as the first one. Limited to 5
per hour per client by default (`THROTTLE_RESEND_VERIFICATION`). Malformed email: 400.

### Forgot password — `POST /api/auth/password-reset/`

Body: `{"email"}`. Always answers **200** with the same message, whether or not the address has an
account, so it cannot be used to find out who is registered. Only active accounts receive an email.
A malformed email returns 400. Limited to 5 requests per hour per client by default.
The link looks like `{FRONTEND_URL}/reset-password?uid=...&token=...`.

### Reset password — `POST /api/auth/password-reset/confirm/`

Body: `{"uid", "token", "new_password"}`.

- **200** `{"detail": "Your password has been reset. You can now sign in."}`
- **400** `invalid_token` if the link is wrong, tampered, expired (60 minutes by default) or already used
- **400** `validation_error` with `details.new_password` if the new password fails Django's validators. The link is not used up by a rejected password.
- The token is Django's `PasswordResetTokenGenerator`: it stops working as soon as the password changes, so it works once. It also stops working if the user signs in after requesting it.
- A successful reset revokes every outstanding refresh token for that user. Access tokens already issued remain valid until they expire (15 minutes by default).

### Sessions
- Cookie `bludhaven_refresh` (httpOnly, Secure outside DEBUG, SameSite Lax by default, path `/api/auth/`). Keep the access token in memory only.
- Refresh/logout: first `GET /api/auth/csrf/` (with credentials) and send the token as `X-CSRFToken`; the `Origin` header must be in `CSRF_TRUSTED_ORIGINS`. Missing/bad token: 403 `csrf_failed`. No cookie: 401 `refresh_token_missing`.
- Refresh tokens rotate on every use and old ones are blacklisted. The SPA must use `credentials: 'include'` and the exact origin must be in `CORS_ALLOWED_ORIGINS`.

### Rate limiting
Each credential endpoint has its **own bucket per client address**, configured with `THROTTLE_*` variables: `auth` (login, email verification, reset confirmation; 10/min), `refresh` (30/min), `logout` (20/min), `register` (10/hour), `password_reset` and `resend_verification` (5/hour each), `password_change` (10/hour **per signed-in user**), `upload` (60/hour per user). A page load that restores a session uses only the `refresh` bucket, so it can never use up login attempts. A throttled request is a 429 `throttled` with `details.retry_after`; a throttled refresh does not clear or rotate the cookie, so the session survives. Counters live in Django's cache: use a shared cache (Redis/Memcached) with several workers.

### Update profile — `PATCH /api/auth/me/`
Body `{"full_name"}` (required, trimmed, at most 150 characters). Returns the user object. Any other key (`role`, `email`, `is_staff`, `is_active`, `is_email_verified`, `email_verified_at`, ...) is rejected with a 400, not ignored. The email address cannot be changed here: that would need a re-verification flow, which is not offered.

### Change password — `POST /api/auth/change-password/`
Body `{"current_password", "new_password"}`. 400 `validation_error` with `details.current_password` when the current password is wrong, and `details.new_password` when it equals the old one or fails Django's password validators. On success: 200, every refresh token of the user is blacklisted and the cookie is cleared, so the person signs in again with the new password. Access tokens already issued live out their 15 minutes (same as after a password reset). Passwords are never logged.

### Login, refresh, logout, me

As in Phase 1/2: see the table above. Login failures (wrong password, unknown email, inactive user)
all return the same 401 `no_active_account`.

## Catalog, bookings, reviews and favourites

All list endpoints are paginated (`?page`, `?page_size`) and accept `?ordering=` (prefix `-` for
descending) on the fields listed. Unknown query parameters are ignored; invalid values are a 400.
Write requests only accept the fields listed; anything else is ignored. Send and receive JSON.

**Who can do what**

| Resource | Read | Create | Update | Delete |
| -------- | ---- | ------ | ------ | ------ |
| Destinations, Amenities | anyone | Super Admin | Super Admin | Super Admin |
| Properties, Property images | anyone | Host (own) or Super Admin | the property's Host or Super Admin | the property's Host or Super Admin |
| Bookings | guest, the property's Host, Super Admin (others get 404) | End User with verified email | status actions only (see below) | Super Admin |
| Reviews | anyone | guest of a completed stay | the author (rating, comment) | the author or Super Admin |
| Favourites | the signed-in user's own | any signed-in user | — | the owner |

### Destinations — `/api/destinations/`
Fields: `id, name, state, tagline, image_url, display_order, property_count` (counted, read-only).
Filter `state`; search `name, state, tagline`; ordering `display_order, name, property_count` (default `display_order, name`).
Deleting one that still has properties returns **409** `in_use`.

### Amenities — `/api/amenities/`
Fields: `id, name` (unique, case-insensitive). Search `name`; ordering `name`.

### Properties — `/api/properties/`
List (card): `id, title, property_type, locality, destination{id,name,state}, price_per_night, max_guests, bedrooms, bathrooms, cover_image, average_rating, review_count, created_at`.
Detail adds `description, owner{id, full_name}, amenities[], images[], updated_at`. Ratings are computed from reviews, never stored. The Host's email is never shown.

Write body: `title, description, property_type (CABIN|VILLA|COTTAGE|APARTMENT|TENT|HOUSEBOAT), destination (id), locality, price_per_night (> 0, 2 decimals), max_guests (>= 1), bedrooms, bathrooms, amenities [ids]`, plus `owner` (see below).

- A **Host** always owns what they create; sending a different `owner` is a 400. A Host edits or deletes only their own properties (403 otherwise).
- A **Super Admin** must send `owner` (an active Host) on create, and may view, edit, reassign, delete (subject to the rule below) and manage the images of **any** property. A Host cannot touch another Host's property or images (403), and End Users cannot manage properties at all.
- Deleting a property that has any bookings returns **409** `in_use` (its images, favourites and amenity links are removed with it).
- Changing the nightly price never changes existing bookings.

### Availability — `GET /api/properties/<id>/availability/`
Public and read-only. Query: `from` and `to` (`YYYY-MM-DD`; default today and a year later; `to` after `from`, window at most 400 days; otherwise 400).
```json
{"property": 7, "from": "2026-10-04", "to": "2027-10-04", "max_nights": 90,
 "blocked": [{"start": "2026-12-01", "end": "2026-12-04"}]}
```
`blocked` holds merged, sorted, half-open ranges clipped to the window: nights `start` up to but **not including** `end` are taken, so a guest may check in on `end` and check out on `start`. `CONFIRMED` bookings and `PENDING` ones still inside their payment window block (the same rule booking creation enforces); `CANCELLED`, `COMPLETED`, `EXPIRED` and `REFUND_REQUIRED` do not. Only dates are returned: never the guest, email, price or status. The server still re-checks on `POST /api/bookings/` (409 `dates_unavailable`), so a stale calendar can never double-book.

Filters: `destination` (id), `destination_name`, `state`, `property_type` (repeatable), `min_price`, `max_price`, `guests` (sleeps at least), `min_bedrooms`, `min_bathrooms`, `amenities=1,2` (needs all), `min_rating`, `owner` (id), `mine=true` (signed-in user's own), and `check_in` + `check_out` (only properties free for those dates).
Search: `title, description, locality, destination name/state`. Ordering: `price_per_night, created_at, title, max_guests, average_rating`.

### Property images — `/api/properties/<id>/images/`
Read fields: `id, url, alt_text, position, width, height, size_bytes, format, created_at` (the Cloudinary public ID is never shown).
**Upload:** `POST` `multipart/form-data` with `image` (file), optional `alt_text`, optional `position` (0 = cover; omit to append; unique per property, 400 if taken). JSON/URL bodies are refused (415). Limits: `IMAGE_MAX_BYTES` (5 MB), `IMAGE_MAX_PIXELS`, formats JPEG/PNG/WebP decided from the file content (not the name or Content-Type); SVG, GIF and animated images are refused. The file is re-encoded (EXIF/GPS and appended data removed) before upload. Errors: 400 `validation_error` (details under `image`), 403 `subscription_required` / `plan_limit_reached`, 429 `throttled`, 503 `storage_unavailable`.
`PATCH` (JSON) changes only `alt_text` and `position`. `DELETE` removes the row and then the Cloudinary file. No PUT.

### Favourites — `/api/favourites/`
`POST {"property_id"}` returns **201** the first time and **200** if already saved (idempotent). Fields: `id, property{summary}, created_at`. Filter `property` (id) to check one property; `DELETE /api/favourites/<id>/` removes it.

### Bookings — `/api/bookings/`
Create: `POST {property, check_in, check_out, guests_count}` (End User, verified email). The server sets the guest, the status (`PENDING`, "awaiting payment"), the 15-minute `expires_at` and the price (`nights × price_per_night`, fixed at that moment and never taken from the request or from a quote). Rules: check-in not in the past (Indian date), check-out after check-in, at most `BOOKING_MAX_NIGHTS` (90) nights, guests within the property's capacity, and the dates free (`CONFIRMED` bookings, and `PENDING` ones whose `expires_at` is still in the future, hold dates; check-out day is free for the next guest) — otherwise **409** `dates_unavailable`. Bookings of the same property are processed one at a time, so two simultaneous requests cannot both succeed.

Fields: `id, property{id,title,locality,destination}, guest{id,full_name}, check_in, check_out, nights, guests_count, total_price, status, expires_at, payment_status, review, created_at, updated_at`, where `review` is `null` or `{id, rating, comment, created_at}`: the review of **this** booking. There is no edit: cancel and book again.

Workflow (`POST /api/bookings/<id>/<action>/`, no body):

| Action | From | To | Who |
| ------ | ---- | -- | --- |
| `cancel` | PENDING, CONFIRMED | CANCELLED | the guest, the property's Host, Super Admin |
| `complete` | CONFIRMED | COMPLETED | the property's Host, Super Admin, and only once check-out has passed |

There is **no manual confirm** for anyone, including Super Admin: a booking becomes `CONFIRMED` only through a verified payment (below). A move that is not allowed from the current status is **409** `invalid_transition` (`stay_not_finished` for an early `complete`); someone not allowed to perform it is 403. `CANCELLED`, `COMPLETED`, `EXPIRED` and `REFUND_REQUIRED` are final. Statuses: `PENDING` (awaiting payment), `CONFIRMED`, `CANCELLED`, `COMPLETED`, `EXPIRED`, `REFUND_REQUIRED`.

### Booking payment (Razorpay) — guest room bookings only

Guests pay for a booking online with Razorpay. **Host subscription plans are not paid through Razorpay**: Hosts buy or change a plan by contacting Customer Care, and a Super Admin assigns it (see *Subscriptions*).

Flow: `quote` (optional, saves nothing) → `POST /api/bookings/` creates a `PENDING` booking that **holds the dates for 15 minutes** (`BOOKING_PAYMENT_WINDOW_MINUTES`) → `POST /api/bookings/<id>/payment/` creates (or reuses) the Razorpay order → Razorpay Checkout in the browser → `POST /api/bookings/<id>/payment/verify/` → the server checks the payment with Razorpay and only then sets `CONFIRMED`. Razorpay's webhook does the same independently, so a guest who closes the tab after paying is still confirmed. The frontend is never authoritative for the amount or for payment success; every price is computed by the server from the property's nightly rate.

| Endpoint | Who | Body | Result |
| -------- | --- | ---- | ------ |
| `POST /api/bookings/quote/` | End User | `{property, check_in, check_out, guests_count}` (same validation as create) | `{property, check_in, check_out, guests_count, nights, price_per_night, total_price, currency: "INR", available, payment_window_minutes}`. Creates nothing; the price is computed again when you book. |
| `POST /api/bookings/<id>/payment/` | the booking's guest (verified email), throttle `payment` | none | `{key_id, order_id, amount (paise), currency, booking_id, expires_at, name, description}`. Calling again returns the **same** order. `key_id` is the public key; the secret never leaves the server. Errors: 404 (not your booking), 409 `already_paid`, `booking_expired`, `booking_not_payable`, 503 `payment_unavailable` / `payment_not_configured`. |
| `POST /api/bookings/<id>/payment/verify/` | the booking's guest, throttle `payment` | `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` from Checkout | the booking (`status: CONFIRMED`, `payment_status: PAID`). Errors (409): `invalid_signature`, `order_mismatch`, `amount_mismatch`, `currency_mismatch`, `payment_failed`, `payment_incomplete`, `booking_expired`, `payment_after_expiry`. Repeating a successful verification is safe and returns the confirmed booking. |
| `POST /api/payments/razorpay/webhook/` | Razorpay only (no login, no CSRF) | Razorpay's event, signed with `RAZORPAY_WEBHOOK_SECRET` in `X-Razorpay-Signature` over the **raw body** | 400 on a bad signature; otherwise 200 `{status}` (`confirmed`, `already_paid`, `refund_required`, `ignored`, `noted`). Events used: `payment.captured`, `order.paid`, `payment.failed`. |

What the server checks before confirming: the signature, that the order belongs to *this* booking and guest, the payment's order id, amount (paise), currency and `captured` status (it asks Razorpay for the payment, and captures an `authorized` one), and that the booking is still `PENDING` inside its window. A payment that does not match is never applied. Verification and webhook can arrive in either order, twice, or alone; the booking is settled exactly once (row-locked, one `Payment` row per booking).

**Expiry.** A `PENDING` booking blocks dates only while `expires_at` is in the future; availability, search and booking creation all check it, so an unpaid booking stops blocking at exactly 15 minutes even if nothing has cleaned up. Unpaid bookings become `EXPIRED` (lazily on any bookings request, or with `python manage.py expire_unpaid_bookings`, optional cron). **An expired booking is never revived.** If a payment arrives after expiry (or after cancellation) the booking and payment become `REFUND_REQUIRED` and the payment is kept so it can be **refunded by hand in the Razorpay dashboard**. There are no automatic refunds and no refund API. Cancelling a paid `CONFIRMED` booking does not refund it either; refunds are handled by Customer Care in the Razorpay dashboard.

Booking fields now also include `expires_at` and `payment_status` (`null`, `CREATED`, `PAID`, `FAILED`, `REFUND_REQUIRED`).


Filters: `status` (repeatable), `property`, `guest`, `check_in_from`, `check_in_to`. Ordering: `created_at, check_in, check_out, total_price`.

### Reviews — `/api/reviews/`
A review belongs to **one specific booking** (a database one-to-one), never just to a property: the guest, the property and the stay all come from the booking. Two completed stays at the same property can each be reviewed once. The booking id cannot be changed afterwards (`PATCH` accepts only rating/comment), a Host or Super Admin cannot create one, and only the booking's own guest can (someone else's booking looks non-existent).
Create: `POST {booking, rating (1-5), comment (optional, max 2000)}` by the guest of that booking, only when it is `COMPLETED`, once per booking (400 otherwise; someone else's booking looks like a non-existent one). Fields: `id, property, author{id,full_name}, rating, comment, created_at`. The author can `PATCH` rating/comment; the author or a Super Admin can delete (then the stay can be reviewed again). Hosts cannot write, edit or delete reviews. Filters: `property`, `rating`, `min_rating`. Ordering: `created_at, rating`.

## Billing, plans and users

### Plans — `/api/plans/`
Read: **public** (no sign-in needed; everyone sees active plans only, a Super Admin also sees inactive ones). Create/update/delete: Super Admin; a plan with subscriptions cannot be deleted (409 `in_use`), deactivate it. Fields: `name (unique), description, price, duration_days, features, is_active`. `features` accepts only `max_properties` and `max_images_per_property` (whole numbers); a missing key means no limit. Nothing is built in: limits exist only where a Super Admin sets them.

### Subscriptions — `/api/subscriptions/`
- Super Admin: `GET` (filters `user, plan, status, payment_status`), `GET {id}`, `POST {user, plan, start_date?, payment_status?}`, `PATCH {id}` with `status` (`CANCELLED` or `EXPIRED`, only from ACTIVE) and/or `payment_status` (`PENDING, PAID, FAILED, REFUNDED`). No delete. `expiry_date = start_date + plan.duration_days`; `amount` is the plan price at assignment. 400 if the plan is inactive or the user is not an active Host; 409 `subscription_overlap` if the Host already has an ACTIVE subscription overlapping those dates.
- `POST {id}/renew/` (Super Admin, optional body `{payment_status}`): extends the subscription by one more period of its plan. New expiry = `max(expiry, today) + plan.duration_days`; a lapsed subscription restarts today. The `amount` price snapshot is kept, `payment_status` defaults to PENDING, status becomes ACTIVE. 409 `invalid_transition` (CANCELLED), `plan_inactive`, `subscription_overlap`.
- Host: `GET` own list and detail; `GET /api/subscriptions/current/` returns `{subscription|null, usage}`.
- Entitled = ACTIVE and `start_date <= today < expiry_date`. Payment status is informational only.
- Enforcement: creating a property or uploading an image needs entitlement (403 `subscription_required`), and is checked against the **property owner's** plan (403 `plan_limit_reached`), also when a Super Admin acts. Editing or deleting existing items never needs a subscription.
- `manage.py expire_subscriptions` marks elapsed ACTIVE subscriptions EXPIRED (run daily).

### Billing profile — `/api/billing-profile/` (Host) and `/api/billing-profiles/` (Super Admin)
Host: `GET` (404 until set), `PUT` (create/replace, 201 then 200), `PATCH`. Fields: `billing_name, billing_email, phone, address_line1, address_line2, city, state, postal_code, country (India)`. Super Admin: read-only list (`?user=<id>`) and detail at `/api/billing-profiles/<host user id>/`.

### Users — `/api/users/` (Super Admin only)
`GET` (filters `role, is_active, email_verified`; search email/name), `GET {id}`, `POST {email, full_name, role: HOST|END_USER}` (invitation: no password; an email with a set-password link goes out, response has `invitation_sent`), `PATCH {id}` `{full_name, role, is_active}`, `POST {id}/send-password-reset/`. No delete (deactivate instead; this also revokes the user's refresh tokens). Guards (409): Super Admin accounts cannot be changed or promoted through the API, nobody changes their own role/active flag (`self_change`), a Host who owns properties or has an active subscription cannot become an End User, and an End User with held (unexpired pending) or confirmed bookings cannot become a Host (`in_use`). Opening the invitation link verifies the email.

## Email configuration

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `FRONTEND_URL` | `http://localhost:5173` in dev | Must be `https://...` when `DJANGO_DEBUG` is off |
| `EMAIL_BACKEND` | console in dev, SMTP otherwise | In development the email (including its link) is printed to the server console |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | — | SMTP; `EMAIL_HOST` is required when `DJANGO_DEBUG` is off |
| `DEFAULT_FROM_EMAIL` | `Blüdhaven <no-reply@bludhaven.local>` | |
| `PASSWORD_RESET_TIMEOUT_MINUTES` | `60` | |
| `EMAIL_VERIFICATION_TIMEOUT_HOURS` | `48` | |
| `THROTTLE_PASSWORD_RESET` | `5/hour` | |
| `THROTTLE_RESEND_VERIFICATION` | `5/hour` | |
| `THROTTLE_REFRESH`, `THROTTLE_LOGOUT`, `THROTTLE_PASSWORD_CHANGE` | `30/min`, `20/min`, `10/hour` | Own buckets, see *Rate limiting* |
| `BOOKING_MAX_NIGHTS` | `90` | Longest bookable stay |
| `BOOKING_PAYMENT_WINDOW_MINUTES` | `15` | How long an unpaid booking holds its dates |
| `RAZORPAY_KEY_ID` | — | Razorpay **test** key id for development (`rzp_test_...`). Public; sent to the browser with each order |
| `RAZORPAY_KEY_SECRET` | — | Razorpay key secret. **Backend only**, never in the frontend, a repository or a log |
| `RAZORPAY_WEBHOOK_SECRET` | — | The secret you set on the webhook in the Razorpay dashboard; signs webhook bodies |
| `RAZORPAY_TIMEOUT_SECONDS` | `15` | Timeout for calls to Razorpay |
| `THROTTLE_PAYMENT` | `30/min` | Per-user limit on starting/verifying payments |

The application's own log lines never include passwords, tokens, links, or email addresses; they
record user ids only. (The development console email backend prints whole emails to the console as a
mail transport. Use `EMAIL_BACKEND=django.core.mail.backends.dummy.EmailBackend` to silence it.)

## Postman collection

The complete collection (every endpoint, with role, headers, body, query parameters, success and error examples, and the cookie + CSRF flow) is generated into `docs/postman/`:
`Bludhaven.postman_collection.json` and `Bludhaven.postman_environment.json`. See `docs/postman/README.md`.
