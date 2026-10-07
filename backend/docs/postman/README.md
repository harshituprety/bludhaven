# Postman collection

Generated from `build_collection.py` (run `python docs/postman/build_collection.py` after any API change).

1. Import `Bludhaven.postman_collection.json` and `Bludhaven.postman_environment.json`, select the environment.
2. Fill the secret variables **locally** (they are empty in the file): `adminEmail/adminPassword` (create with `python manage.py createsuperuser`),
   `hostEmail/hostPassword` (invite a Host from the admin account or via *02 Users*), `guestEmail/guestPassword` (a verified End User).
3. Run *01 Auth -> Login as Super Admin / Host / End User* once. Every request then uses the token of the role it needs.
4. Refresh and logout need the refresh **cookie** (kept by Postman's cookie jar, never typed in) and a CSRF token:
   run *Get CSRF token* first. `frontendOrigin` must be in the API's `CSRF_TRUSTED_ORIGINS`.
5. *Run collection* works top to bottom. The auth endpoints are rate limited (`THROTTLE_AUTH`, default 10/min), so for a full run
   start the dev server with a higher value, e.g. `THROTTLE_AUTH=1000/min`. Destructive requests are in *99 Cleanup*.
6. Email links are URL-encoded: decode `%3A` back to `:` before pasting a token into `verifyToken` / `resetToken`.

Payments (*11 Bookings*): *Start payment* needs Razorpay **test** keys in the API's `.env`; take the three Checkout values into `razorpayOrderId/PaymentId/Signature` for *Verify payment*. Guest room payments only: Host subscriptions are not paid through Razorpay.

Expected in a top-to-bottom run: *Complete booking* returns 409 `stay_not_finished` (the stay is in the future), the *Reviews* requests that need a
completed booking return 400/404, and *Delete plan* returns 409 `in_use` (it has a subscription), and the payment requests return 409/503 without real Razorpay test credentials. These are documented behaviours, not faults.

No secrets or tokens are stored in either file.
