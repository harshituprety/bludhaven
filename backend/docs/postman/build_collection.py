#!/usr/bin/env python3
"""Generates the Postman collection and environment for the Blüdhaven API.

    python docs/postman/build_collection.py

Writes ``Bludhaven.postman_collection.json`` and ``Bludhaven.postman_environment.json`` next to this file.
Nothing secret is written: credentials are empty ``secret`` variables the tester fills in locally.
"""

import json
import uuid
from pathlib import Path

OUT = Path(__file__).parent
PUBLIC, BEARER, COOKIE = "public", "bearer", "cookie+csrf"
ANY = "any signed-in user"


def token_var(role):
    """Which stored token a request uses, decided by the first role named in its 'required role' text."""
    if role == PUBLIC:
        return None
    found = sorted((role.find(k), v) for k, v in (("END_USER", "guestToken"), ("guest", "guestToken"), ("author", "guestToken"), ("any signed-in", "guestToken"), ("SUPER_ADMIN", "adminToken"), ("HOST", "hostToken")) if k in role)
    return found[0][1]


def err(status, code, note=""):
    return (status, code, note)


def script(*lines):
    return {"listen": "test", "script": {"type": "text/javascript", "exec": list(lines)}}


def set_var(var, expr, only_status=(200, 201)):
    cond = " || ".join(f"pm.response.code === {s}" for s in only_status)
    return script(f"if ({cond}) {{ const j = pm.response.json(); pm.environment.set('{var}', String({expr})); }}")


CLEANUP = {"Logout (blacklist refresh token)", "Delete destination", "Delete amenity", "Delete property", "Delete image", "Delete favourite" if False else "Remove favourite", "Delete booking", "Delete review", "Delete plan"}


def req(name, method, path, *, auth=BEARER, role=PUBLIC, body=None, form=None, query=(), headers=(), ok=(200, None), errs=(), notes="", tests=None, success_body=None):
    return dict(name=name, method=method, path=path, auth=auth, role=role, body=body, form=form, query=list(query), headers=list(headers),
                ok=ok, errs=list(errs), notes=notes, tests=tests, success_body=success_body)


CSRF_HEADERS = [("X-CSRFToken", "{{csrfToken}}", "From GET /api/auth/csrf/ (run that first)."), ("Origin", "{{frontendOrigin}}", "Must be listed in CSRF_TRUSTED_ORIGINS.")]

FOLDERS = []


def folder(name, description, *items):
    FOLDERS.append((name, description, items))


ORDER = ["00 Health", "01 Auth", "02 Users (Super Admin)", "03 Destinations", "04 Amenities", "10 Subscription plans", "11 Subscriptions", "12 Billing profile",
         "05 Properties", "06 Property images", "07 Favourites", "08 Bookings", "09 Reviews"]
RENAME = {"10 Subscription plans": "05 Subscription plans", "11 Subscriptions": "06 Subscriptions", "12 Billing profile": "07 Billing profile",
          "05 Properties": "08 Properties", "06 Property images": "09 Property images", "07 Favourites": "10 Favourites", "08 Bookings": "11 Bookings", "09 Reviews": "12 Reviews"}


CREATORS = {"Invite user (Host / End User)", "Create destination", "Create amenity", "Create plan", "Assign plan to Host", "Create property", "Upload image",
            "Add favourite", "Create booking", "Create review", "Create / replace my billing profile", "Renew / extend subscription"}


def _run_order(items):
    """List first, then the requests that create the ids the others use, then the rest (renewal before status changes)."""
    def key(r):
        if r["name"].startswith("List"):
            return 0
        if r["name"] in ("Renew / extend subscription", "Cancel booking"):
            return 3  # last: cancelling ends the workflow, renewing is only valid before a status change
        return 1 if r["name"] in CREATORS else 2
    return tuple(sorted(items, key=key))


def finalize():
    """Order folders by dependency (a Host needs a subscription before creating properties) and move destructive
    requests into a last folder, so 'Run collection' works from top to bottom."""
    kept, cleanup = [], []
    by_name = {f[0]: f for f in FOLDERS}
    for name, description, items in [by_name[n] for n in ORDER]:
        name = RENAME.get(name, name)
        kept.append((name, description, _run_order(tuple(r for r in items if r["name"] not in CLEANUP))))
        cleanup += [r for r in items if r["name"] in CLEANUP]
    order = ["Remove favourite", "Delete review", "Delete booking", "Delete image", "Delete property", "Delete plan", "Delete amenity", "Delete destination", "Logout (blacklist refresh token)"]
    cleanup.sort(key=lambda r: order.index(r["name"]))
    kept.append(("99 Cleanup (run last)", "Destructive requests, kept at the end so the folders above can run top to bottom. Logout is last because it clears the stored access token.", tuple(cleanup)))
    return kept


# --------------------------------------------------------------------------------------------------------------------
folder("00 Health", "Liveness probe. No auth.",
    req("Health", "GET", "/api/health/", auth=PUBLIC, ok=(200, {"status": "ok"})))

folder("01 Auth", """Session model: the **access token** (15 min) comes back in the JSON body of login/refresh and is sent as `Authorization: Bearer`.
The **refresh token is never in a body or header you control**: it is an httpOnly cookie `bludhaven_refresh` (path `/api/auth/`) that Postman's cookie jar stores and re-sends automatically.
Refresh and logout also need a **CSRF token**: call *Get CSRF token* first (it stores `csrfToken`), then send it as `X-CSRFToken` together with an `Origin` that is in `CSRF_TRUSTED_ORIGINS`.
Run order: Register -> Verify email (link from the console/email) -> Login -> Get CSRF token -> Refresh -> Me -> Logout.""",
    req("Register (End User)", "POST", "/api/auth/register/", auth=PUBLIC, body={"email": "{{newUserEmail}}", "full_name": "Test Guest", "password": "{{newUserPassword}}"},
        ok=(201, {"id": 12, "email": "guest@example.com", "full_name": "Test Guest", "role": "END_USER", "is_email_verified": False, "date_joined": "2026-10-04T10:00:00+05:30"}),
        errs=[err(400, "validation_error", "weak password, duplicate email, or an unaccepted field such as `role`"), err(429, "throttled", "scope `register`")],
        notes="Always creates an END_USER. Extra keys (role, is_staff...) are rejected with 400. Sends the verification email."),
    req("Verify email", "POST", "/api/auth/verify-email/", auth=PUBLIC, body={"token": "{{verifyToken}}"},
        ok=(200, {"detail": "Email verified.", "already_verified": False}), errs=[err(400, "invalid_token", "expired, tampered or wrong-purpose token"), err(429, "throttled", "scope `auth`")],
        notes="`token` is the `token` query parameter of the emailed link (`FRONTEND_URL/verify-email?token=...`) - **URL-decode it** (`%3A` -> `:`) before pasting. Already verified -> 200 with `already_verified: true`."),
    req("Resend verification", "POST", "/api/auth/resend-verification/", auth=PUBLIC, body={"email": "{{newUserEmail}}"},
        ok=(200, {"detail": "If that account exists and is not yet verified, a new verification email has been sent."}), errs=[err(429, "throttled", "scope `resend_verification`")],
        notes="Same 200 for known and unknown addresses (no account enumeration)."),
    req("Get CSRF token", "GET", "/api/auth/csrf/", auth=PUBLIC, headers=[("Origin", "{{frontendOrigin}}", "")],
        ok=(200, {"csrfToken": "..."}), tests=set_var("csrfToken", "j.csrfToken"),
        notes="Also sets an httpOnly CSRF cookie. The token in the body is what you send as `X-CSRFToken`."),
    req("Login", "POST", "/api/auth/token/", auth=PUBLIC, body={"email": "{{userEmail}}", "password": "{{userPassword}}"},
        ok=(200, {"access": "<jwt>", "user": {"id": 1, "email": "host@example.com", "full_name": "Host", "role": "HOST", "is_email_verified": True, "date_joined": "2026-10-01T10:00:00+05:30"}}),
        errs=[err(401, "no_active_account", "wrong password, unknown email or inactive user - always the same answer"), err(429, "throttled", "scope `auth`")],
        tests=set_var("accessToken", "j.access"),
        notes="Sets the `bludhaven_refresh` httpOnly cookie. **There is no `refresh` key in the response.**"),
    req("Login as Super Admin", "POST", "/api/auth/token/", auth=PUBLIC, body={"email": "{{adminEmail}}", "password": "{{adminPassword}}"},
        ok=(200, {"access": "<jwt>", "user": {"id": 1, "role": "SUPER_ADMIN"}}), errs=[err(401, "no_active_account")],
        tests=script("if (pm.response.code === 200) { pm.environment.set('adminToken', pm.response.json().access); }"),
        notes="Convenience: stores `adminToken`, used by every Super Admin request in this collection. The refresh cookie is replaced by this login's."),
    req("Login as Host", "POST", "/api/auth/token/", auth=PUBLIC, body={"email": "{{hostEmail}}", "password": "{{hostPassword}}"},
        ok=(200, {"access": "<jwt>", "user": {"id": 2, "role": "HOST"}}), errs=[err(401, "no_active_account")],
        tests=script("if (pm.response.code === 200) { const j = pm.response.json(); pm.environment.set('hostToken', j.access); pm.environment.set('hostId', String(j.user.id)); }"),
        notes="Convenience: stores `hostToken` and `hostId`."),
    req("Login as End User", "POST", "/api/auth/token/", auth=PUBLIC, body={"email": "{{guestEmail}}", "password": "{{guestPassword}}"},
        ok=(200, {"access": "<jwt>", "user": {"id": 3, "role": "END_USER"}}), errs=[err(401, "no_active_account")],
        tests=script("if (pm.response.code === 200) { pm.environment.set('guestToken', pm.response.json().access); }"),
        notes="Convenience: stores `guestToken`."),
    req("Refresh access token", "POST", "/api/auth/token/refresh/", auth=COOKIE, headers=CSRF_HEADERS, ok=(200, {"access": "<jwt>"}),
        errs=[err(403, "csrf_failed", "missing/invalid X-CSRFToken or untrusted Origin"), err(401, "refresh_token_missing", "no cookie"), err(401, "token_not_valid", "expired, rotated-away or blacklisted refresh token"), err(429, "throttled", "scope `refresh` (its own bucket, separate from login)")],
        tests=set_var("accessToken", "j.access"),
        notes="**Empty body.** Reads the refresh token from the cookie, rotates it (new cookie set, old one blacklisted) and returns a new access token."),
    req("Logout (blacklist refresh token)", "POST", "/api/auth/token/blacklist/", auth=COOKIE, headers=CSRF_HEADERS, ok=(200, {"detail": "Signed out."}),
        errs=[err(403, "csrf_failed", "missing/invalid CSRF token"), err(429, "throttled", "scope `logout`")],
        tests=script("if (pm.response.code === 200) { pm.environment.set('accessToken', ''); }"),
        notes="**Empty body.** Blacklists the cookie's refresh token and clears the cookie. Always 200 once CSRF passes, even with no/invalid cookie."),
    req("Forgot password", "POST", "/api/auth/password-reset/", auth=PUBLIC, body={"email": "{{resetEmail}}"},
        ok=(200, {"detail": "If an account exists for that email, a password reset link has been sent."}), errs=[err(429, "throttled", "scope `password_reset`")],
        notes="Same 200 for known and unknown addresses. Use a throwaway account in `resetEmail` (the reset below changes its password and signs it out everywhere). Link in the email: `FRONTEND_URL/reset-password?uid=...&token=...` (URL-decode both values before using them in *Reset password*)."),
    req("Reset password (confirm)", "POST", "/api/auth/password-reset/confirm/", auth=PUBLIC, body={"uid": "{{resetUid}}", "token": "{{resetToken}}", "new_password": "{{newPassword}}"},
        ok=(200, {"detail": "Your password has been reset. You can now sign in."}),
        errs=[err(400, "invalid_token", "bad/expired/already-used link"), err(400, "validation_error", "weak password (the link stays usable)")],
        notes="The link works once. Revokes every refresh token of the user and clears the cookie. For an invited user it also verifies the email."),
    req("Me", "GET", "/api/auth/me/", role=ANY, ok=(200, {"id": 1, "email": "host@example.com", "full_name": "Host", "role": "HOST", "is_email_verified": True, "date_joined": "2026-10-01T10:00:00+05:30"}),
        errs=[err(401, "not_authenticated"), err(401, "token_not_valid", "expired access token -> refresh")]),
    req("Update my profile", "PATCH", "/api/auth/me/", role=ANY, body={"full_name": "New Display Name"},
        ok=(200, {"id": 1, "email": "host@example.com", "full_name": "New Display Name", "role": "HOST", "is_email_verified": True, "date_joined": "2026-10-01T10:00:00+05:30"}),
        errs=[err(400, "validation_error", "blank/too-long name, or any other key (role, email, is_staff, is_active, ...) - those are rejected, not ignored"), err(401, "not_authenticated")],
        notes="Only `full_name` is editable. The email address cannot be changed here (that would need a re-verification flow). PUT/POST/DELETE answer 405."),
    req("Change password", "POST", "/api/auth/change-password/", role=ANY, body={"current_password": "{{userPassword}}", "new_password": "{{changedPassword}}"},
        ok=(200, {"detail": "Your password has been changed. Please sign in again."}),
        errs=[err(400, "validation_error", "details.current_password (wrong) or details.new_password (same as the old one / fails the password validators)"), err(401, "not_authenticated"), err(429, "throttled", "scope `password_change`, per user")],
        notes="**Signs the user out everywhere:** every refresh token is revoked and the cookie cleared (the current 15-minute access token keeps working until it expires, as after a password reset). In a collection run the next request restores the original password so later runs still work. Set `changedPassword` to a strong password different from `userPassword`."),
    req("Change password back", "POST", "/api/auth/change-password/", role=ANY, body={"current_password": "{{changedPassword}}", "new_password": "{{userPassword}}"},
        ok=(200, {"detail": "Your password has been changed. Please sign in again."}),
        errs=[err(400, "validation_error")], notes="Restores `userPassword` after *Change password*. Run them together (the access token from *Login* is still valid)."),
)

folder("02 Users (Super Admin)", "Account management. **Super Admin only.** There is no delete (deactivate instead) and no way to create or promote a Super Admin here (server-side `createsuperuser` only).",
    req("List users", "GET", "/api/users/", role="SUPER_ADMIN",
        query=[("role", "HOST", "SUPER_ADMIN | HOST | END_USER"), ("is_active", "true", ""), ("email_verified", "true", ""), ("search", "", "email or full name"), ("ordering", "-date_joined", "email, full_name, date_joined, role"), ("page", "1", ""), ("page_size", "12", "max 100")],
        ok=(200, {"count": 1, "next": None, "previous": None, "results": [{"id": 2, "email": "host@example.com", "full_name": "Host", "role": "HOST", "is_active": True, "is_email_verified": True, "invitation_pending": False, "date_joined": "..."}]}),
        errs=[err(401, "not_authenticated"), err(403, "permission_denied"), err(400, "validation_error", "bad filter value")]),
    req("Get user", "GET", "/api/users/{{userId}}/", role="SUPER_ADMIN", ok=(200, {"id": 2, "email": "host@example.com", "role": "HOST", "is_active": True}), errs=[err(404, "not_found")]),
    req("Invite user (Host / End User)", "POST", "/api/users/", role="SUPER_ADMIN", body={"email": "new.host@example.com", "full_name": "New Host", "role": "HOST"},
        ok=(201, {"id": 5, "email": "new.host@example.com", "role": "HOST", "invitation_pending": True, "invitation_sent": True}),
        errs=[err(400, "validation_error", "duplicate email, role must be HOST or END_USER")], tests=set_var("userId", "j.id", (201,)),
        notes="No password is chosen. The person gets an email with a set-password link (valid 60 minutes). Opening it verifies their email. `invitation_sent=false` means SMTP failed - resend."),
    req("Update user", "PATCH", "/api/users/{{userId}}/", role="SUPER_ADMIN", body={"full_name": "Renamed", "role": "HOST", "is_active": True},
        ok=(200, {"id": 5, "full_name": "Renamed", "role": "HOST", "is_active": True}),
        errs=[err(409, "protected_account", "Super Admins cannot be changed through the API"), err(409, "self_change", "own role/active flag"), err(409, "in_use", "Host with properties/active subscription -> End User, or End User with open bookings -> Host"), err(400, "validation_error", "role SUPER_ADMIN not allowed")],
        notes="Only `full_name`, `role` (HOST|END_USER) and `is_active` are writable. Deactivating or changing the role revokes the user's refresh tokens."),
    req("Resend invitation / password reset", "POST", "/api/users/{{userId}}/send-password-reset/", role="SUPER_ADMIN", ok=(200, {"sent": True}),
        errs=[err(409, "inactive_user"), err(404, "not_found")], notes="Works for a pending invitation (re-sends the set-password link) and for ordinary resets."),
)

folder("03 Destinations", "Public read. Create/update/delete: Super Admin. Deleting a destination that still has properties returns 409 `in_use`.",
    req("List destinations", "GET", "/api/destinations/", auth=PUBLIC, query=[("state", "", "exact, case-insensitive"), ("search", "", "name, state, tagline"), ("ordering", "display_order,name", "display_order, name, property_count"), ("page", "1", ""), ("page_size", "12", "max 100")],
        ok=(200, {"count": 1, "next": None, "previous": None, "results": [{"id": 1, "name": "Goa", "state": "Goa", "tagline": "", "image_url": "", "display_order": 0, "property_count": 3}]})),
    req("Get destination", "GET", "/api/destinations/{{destinationId}}/", auth=PUBLIC, ok=(200, {"id": 1, "name": "Goa"}), errs=[err(404, "not_found")]),
    req("Create destination", "POST", "/api/destinations/", role="SUPER_ADMIN", body={"name": "Goa", "state": "Goa", "tagline": "Sun and susegad", "image_url": "", "display_order": 0},
        ok=(201, {"id": 1, "name": "Goa"}), errs=[err(400, "validation_error"), err(403, "permission_denied")], tests=set_var("destinationId", "j.id", (201,))),
    req("Update destination", "PATCH", "/api/destinations/{{destinationId}}/", role="SUPER_ADMIN", body={"tagline": "New tagline"}, ok=(200, {"id": 1, "tagline": "New tagline"}), errs=[err(403, "permission_denied")]),
    req("Delete destination", "DELETE", "/api/destinations/{{destinationId}}/", role="SUPER_ADMIN", ok=(204, None), errs=[err(409, "in_use", "properties still use it")]),
)

folder("04 Amenities", "Public read. Create/update/delete: Super Admin. Names are unique (case-insensitive).",
    req("List amenities", "GET", "/api/amenities/", auth=PUBLIC, query=[("search", "", "name"), ("ordering", "name", "")], ok=(200, {"count": 1, "results": [{"id": 1, "name": "Wi-Fi"}]})),
    req("Get amenity", "GET", "/api/amenities/{{amenityId}}/", auth=PUBLIC, ok=(200, {"id": 1, "name": "Wi-Fi"}), errs=[err(404, "not_found")]),
    req("Create amenity", "POST", "/api/amenities/", role="SUPER_ADMIN", body={"name": "Wi-Fi"}, ok=(201, {"id": 1, "name": "Wi-Fi"}), errs=[err(400, "validation_error", "duplicate")], tests=set_var("amenityId", "j.id", (201,))),
    req("Update amenity", "PATCH", "/api/amenities/{{amenityId}}/", role="SUPER_ADMIN", body={"name": "Fast Wi-Fi"}, ok=(200, {"id": 1, "name": "Fast Wi-Fi"})),
    req("Delete amenity", "DELETE", "/api/amenities/{{amenityId}}/", role="SUPER_ADMIN", ok=(204, None), notes="Just unlinks it from properties."),
)

PROP_BODY = {"title": "Pine cabin", "description": "Quiet cabin in the hills.", "property_type": "CABIN", "destination": "{{destinationId}}", "locality": "Old Manali", "price_per_night": "3500.00", "max_guests": 4, "bedrooms": 2, "bathrooms": 1, "amenities": ["{{amenityId}}"]}
folder("05 Properties", """Public read. A **Host** creates properties (always their own; `owner` may only be themselves) and edits/deletes only their own (403 otherwise).
A **Super Admin** must send `owner` (an active Host) on create. Creating needs an **active subscription** and respects the plan's `max_properties` (403 `subscription_required` / `plan_limit_reached`).
Deleting a property with bookings returns 409 `in_use`.""",
    req("List properties", "GET", "/api/properties/", auth=PUBLIC,
        query=[("destination", "", "destination id"), ("destination_name", "", ""), ("state", "", ""), ("property_type", "CABIN", "CABIN|VILLA|COTTAGE|APARTMENT|TENT|HOUSEBOAT (repeatable)"), ("min_price", "", ""), ("max_price", "", ""),
               ("guests", "", "sleeps at least"), ("min_bedrooms", "", ""), ("min_bathrooms", "", ""), ("amenities", "", "comma-separated ids, all required"), ("min_rating", "", ""), ("owner", "", "host id"),
               ("mine", "", "true = signed-in user's own (needs a token)"), ("check_in", "{{checkIn}}", "YYYY-MM-DD, needs check_out"), ("check_out", "{{checkOut}}", "YYYY-MM-DD"), ("search", "", "title, description, locality, destination"),
               ("ordering", "-created_at", "price_per_night, created_at, title, max_guests, average_rating"), ("page", "1", ""), ("page_size", "12", "max 100")],
        ok=(200, {"count": 1, "next": None, "previous": None, "results": [{"id": 1, "title": "Pine cabin", "property_type": "CABIN", "locality": "Old Manali", "destination": {"id": 1, "name": "Manali", "state": "Himachal Pradesh"}, "price_per_night": "3500.00", "max_guests": 4, "bedrooms": 2, "bathrooms": 1, "cover_image": None, "average_rating": None, "review_count": 0, "created_at": "..."}]}),
        errs=[err(400, "validation_error", "bad filter value; only one of check_in/check_out; check_out <= check_in"), err(401, "not_authenticated", "`mine=true` without a token")],
        notes="Auth is optional (only `mine=true` needs a token)."),
    req("Get property", "GET", "/api/properties/{{propertyId}}/", auth=PUBLIC, ok=(200, {"id": 1, "title": "Pine cabin", "description": "...", "owner": {"id": 2, "full_name": "Host"}, "amenities": [{"id": 1, "name": "Wi-Fi"}], "images": [{"id": 1, "url": "https://res.cloudinary.com/...", "alt_text": "", "position": 0}]}), errs=[err(404, "not_found")]),
    req("Property availability", "GET", "/api/properties/{{propertyId}}/availability/", auth=PUBLIC,
        query=[("from", "{{checkIn}}", "YYYY-MM-DD, default today"), ("to", "{{checkOut}}", "YYYY-MM-DD, default from + 365 days, window at most 400 days")],
        ok=(200, {"property": 1, "from": "2026-10-04", "to": "2027-10-04", "max_nights": 90, "blocked": [{"start": "2026-12-01", "end": "2026-12-04"}]}),
        errs=[err(400, "validation_error", "bad date, to <= from, or window over 400 days"), err(404, "not_found")],
        notes="Public and read-only. `blocked` lists merged half-open ranges of taken nights: nights `start` up to but not including `end` are taken, so a guest may check IN on `end` and check OUT on `start`. PENDING and CONFIRMED bookings block; CANCELLED and COMPLETED do not. Only dates are returned - never guest, price or status."),
    req("Create property", "POST", "/api/properties/", role="HOST or SUPER_ADMIN (SA sends `owner`)", body=PROP_BODY,
        ok=(201, {"id": 1, "title": "Pine cabin"}), errs=[err(400, "validation_error"), err(403, "subscription_required", "no active subscription"), err(403, "plan_limit_reached", "max_properties of the owner's plan"), err(403, "permission_denied", "End User")],
        tests=set_var("propertyId", "j.id", (201,))),
    req("Update property", "PATCH", "/api/properties/{{propertyId}}/", role="owning HOST or SUPER_ADMIN", body={"price_per_night": "3800.00"}, ok=(200, {"id": 1, "price_per_night": "3800.00"}),
        errs=[err(403, "permission_denied", "not your property"), err(400, "validation_error")], notes="PUT is also accepted (full body). Existing bookings keep their price."),
    req("Delete property", "DELETE", "/api/properties/{{propertyId}}/", role="owning HOST or SUPER_ADMIN", ok=(204, None), errs=[err(409, "in_use", "has bookings"), err(403, "permission_denied")], notes="Images are removed from Cloudinary after commit. Never needs a subscription."),
)

folder("06 Property images", "Public read. Upload/edit/delete: the property's Host or a Super Admin. **Uploads are `multipart/form-data`** (do not set Content-Type manually in Postman). Needs an active subscription and respects `max_images_per_property`.",
    req("List images", "GET", "/api/properties/{{propertyId}}/images/", auth=PUBLIC, ok=(200, {"count": 1, "results": [{"id": 1, "url": "https://res.cloudinary.com/...", "alt_text": "", "position": 0, "width": 1600, "height": 1000, "size_bytes": 220000, "format": "jpg", "created_at": "..."}]}), errs=[err(404, "not_found")]),
    req("Upload image", "POST", "/api/properties/{{propertyId}}/images/", role="owning HOST or SUPER_ADMIN",
        form=[("image", "file", "JPEG/PNG/WebP, <= IMAGE_MAX_BYTES, checked by content"), ("alt_text", "text", "optional"), ("position", "text", "optional; 0 = cover; default appends")],
        ok=(201, {"id": 1, "url": "https://res.cloudinary.com/...", "alt_text": "Front", "position": 0, "width": 1600, "height": 1000, "size_bytes": 220000, "format": "jpg"}),
        errs=[err(400, "validation_error", "not a real image / unsupported type / too large / position taken (details.image or details.position)"), err(403, "subscription_required"), err(403, "plan_limit_reached", "max_images_per_property"), err(415, "unsupported_media_type", "JSON body"), err(429, "throttled", "scope `upload`"), err(503, "storage_unavailable", "Cloudinary down or not configured")],
        tests=set_var("imageId", "j.id", (201,)), notes="The Cloudinary public ID is never returned."),
    req("Update image (alt text / position)", "PATCH", "/api/properties/{{propertyId}}/images/{{imageId}}/", role="owning HOST or SUPER_ADMIN", body={"alt_text": "Sunrise from the deck", "position": 1},
        ok=(200, {"id": 1, "alt_text": "Sunrise from the deck", "position": 1}), errs=[err(400, "validation_error", "position already used"), err(403, "permission_denied")], notes="Only `alt_text` and `position` change. No PUT."),
    req("Delete image", "DELETE", "/api/properties/{{propertyId}}/images/{{imageId}}/", role="owning HOST or SUPER_ADMIN", ok=(204, None), errs=[err(403, "permission_denied"), err(404, "not_found")]),
)

folder("07 Favourites", "The signed-in user's own saved properties (any role).",
    req("List my favourites", "GET", "/api/favourites/", role=ANY, query=[("property", "", "check one property id"), ("ordering", "-created_at", ""), ("page", "1", "")], ok=(200, {"count": 1, "results": [{"id": 1, "property": {"id": 1, "title": "Pine cabin"}, "created_at": "..."}]})),
    req("Add favourite", "POST", "/api/favourites/", role=ANY, body={"property_id": "{{propertyId}}"}, ok=(201, {"id": 1, "property": {"id": 1}}), errs=[err(400, "validation_error", "unknown property")],
        tests=set_var("favouriteId", "j.id"), notes="201 the first time, 200 if already saved (idempotent)."),
    req("Remove favourite", "DELETE", "/api/favourites/{{favouriteId}}/", role=ANY, ok=(204, None), errs=[err(404, "not_found", "not yours")]),
)

folder("08 Bookings", """Create: **End User with a verified email only** (Hosts and Super Admins cannot book). The server sets guest, status (PENDING = awaiting payment), a 15-minute `expires_at` and the price (nights x nightly price, never taken from the request or a quote).
List/detail visibility: the guest, the property's Host, Super Admin (others get 404).
There is NO manual confirm: a booking becomes CONFIRMED only through a verified Razorpay payment (see *Start payment* / *Verify payment* / *Razorpay webhook*; guest room payments only - Host subscriptions are bought through Customer Care, not Razorpay). An unpaid booking expires after 15 minutes (EXPIRED); a payment that arrives after that makes it REFUND_REQUIRED (refunded manually in the Razorpay dashboard; no automatic refunds).
Workflow actions take **no body**: cancel (PENDING|CONFIRMED->CANCELLED, guest/Host/SA), complete (CONFIRMED->COMPLETED, Host/SA, only after check-out - so in a top-to-bottom run it returns 409 `stay_not_finished`, and the *Reviews* requests that need a completed booking only succeed with a booking whose stay is over).""",
    req("List bookings", "GET", "/api/bookings/", role=ANY, query=[("status", "", "PENDING|CONFIRMED|CANCELLED|COMPLETED|EXPIRED|REFUND_REQUIRED (repeatable)"), ("property", "", ""), ("guest", "", ""), ("check_in_from", "", "YYYY-MM-DD"), ("check_in_to", "", ""), ("ordering", "-created_at", "created_at, check_in, check_out, total_price"), ("page", "1", "")],
        ok=(200, {"count": 1, "results": [{"id": 1, "property": {"id": 1, "title": "Pine cabin", "locality": "Old Manali", "destination": "Manali"}, "guest": {"id": 3, "full_name": "Test Guest"}, "check_in": "2026-12-01", "check_out": "2026-12-04", "nights": 3, "guests_count": 2, "total_price": "10500.00", "status": "PENDING", "review": None, "created_at": "...", "updated_at": "..."}]})),
    req("Get booking", "GET", "/api/bookings/{{bookingId}}/", role=ANY, ok=(200, {"id": 1, "status": "PENDING", "total_price": "10500.00", "review": {"id": 1, "rating": 5, "comment": "Lovely", "created_at": "..."}}), errs=[err(404, "not_found", "not yours")], notes="`review` is the review of this very booking, or null."),
    req("Create booking", "POST", "/api/bookings/", role="END_USER (verified email)", body={"property": "{{propertyId}}", "check_in": "{{checkIn}}", "check_out": "{{checkOut}}", "guests_count": 2},
        ok=(201, {"id": 1, "status": "PENDING", "nights": 3, "total_price": "10500.00"}),
        errs=[err(400, "validation_error", "past check-in, check-out <= check-in, > BOOKING_MAX_NIGHTS nights, too many guests"), err(403, "email_not_verified"), err(403, "permission_denied", "Host / Super Admin"), err(409, "dates_unavailable")],
        tests=set_var("bookingId", "j.id", (201,))),
    req("Quote booking", "POST", "/api/bookings/quote/", role="END_USER", body={"property": "{{propertyId}}", "check_in": "{{checkIn}}", "check_out": "{{checkOut}}", "guests_count": 2},
        ok=(200, {"property": 1, "nights": 3, "price_per_night": "3500.00", "total_price": "10500.00", "currency": "INR", "available": True, "payment_window_minutes": 15}),
        errs=[err(400, "validation_error"), err(403, "permission_denied", "Host / Super Admin")], notes="Prices the stay from the database and saves nothing. The booking is priced again when created."),
    req("Start payment (create Razorpay order)", "POST", "/api/bookings/{{bookingId}}/payment/", role="the booking's guest (verified email)",
        ok=(200, {"key_id": "rzp_test_xxx", "order_id": "order_xxx", "amount": 1050000, "currency": "INR", "booking_id": 1, "expires_at": "...", "name": "Blüdhaven", "description": "..."}),
        errs=[err(404, "not_found", "not your booking"), err(409, "already_paid"), err(409, "booking_expired"), err(409, "booking_not_payable"), err(503, "payment_unavailable"), err(503, "payment_not_configured", "RAZORPAY_* not set")],
        notes="Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET (Razorpay TEST keys). Amount is in paise and comes from the booking; calling again returns the same order. Open Razorpay Checkout with this order, then call Verify payment."),
    req("Verify payment", "POST", "/api/bookings/{{bookingId}}/payment/verify/", role="the booking's guest (verified email)",
        body={"razorpay_order_id": "{{razorpayOrderId}}", "razorpay_payment_id": "{{razorpayPaymentId}}", "razorpay_signature": "{{razorpaySignature}}"},
        ok=(200, {"id": 1, "status": "CONFIRMED", "payment_status": "PAID"}),
        errs=[err(409, "invalid_signature"), err(409, "order_mismatch"), err(409, "amount_mismatch"), err(409, "currency_mismatch"), err(409, "payment_failed"), err(409, "payment_incomplete"), err(409, "booking_expired"), err(409, "payment_after_expiry", "paid after the window: booking is REFUND_REQUIRED"), err(404, "not_found")],
        notes="The three values come from Razorpay Checkout. The server verifies them with Razorpay; nothing is confirmed on the browser's word."),
    req("Razorpay webhook (called by Razorpay)", "POST", "/api/payments/razorpay/webhook/", auth=PUBLIC, role=PUBLIC,
        headers=[("X-Razorpay-Signature", "{{webhookSignature}}", "HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET. Razorpay sets it; do not send this by hand except to test.")],
        body={"event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_xxx", "order_id": "order_xxx", "amount": 1050000, "currency": "INR", "status": "captured"}}}},
        ok=(200, {"status": "confirmed"}), errs=[err(400, "invalid_signature", "bad or missing signature; nothing changes")],
        notes="Configure this URL in the Razorpay dashboard (events payment.captured, order.paid, payment.failed). Idempotent: duplicates return `already_paid`; a payment for an expired booking returns `refund_required`; unknown orders are `ignored`."),
    req("Cancel booking", "POST", "/api/bookings/{{bookingId}}/cancel/", role="guest, property's HOST or SUPER_ADMIN", ok=(200, {"id": 1, "status": "CANCELLED"}), errs=[err(409, "invalid_transition", "already cancelled/completed")]),
    req("Complete booking", "POST", "/api/bookings/{{bookingId}}/complete/", role="property's HOST or SUPER_ADMIN", ok=(200, {"id": 1, "status": "COMPLETED"}), errs=[err(409, "stay_not_finished", "check-out not passed"), err(409, "invalid_transition")]),
    req("Delete booking", "DELETE", "/api/bookings/{{bookingId}}/", role="SUPER_ADMIN", ok=(204, None), errs=[err(403, "permission_denied")]),
)

folder("09 Reviews", "A review belongs to one specific booking (one per booking; two completed stays at the same property can each be reviewed). The property comes from the booking and cannot be changed. Public read. Create: the guest of that COMPLETED booking, once, with a verified email. Edit: the author. Delete: the author or Super Admin. Hosts cannot write/edit/delete.",
    req("List reviews", "GET", "/api/reviews/", auth=PUBLIC, query=[("property", "{{propertyId}}", ""), ("rating", "", ""), ("min_rating", "", ""), ("ordering", "-created_at", "created_at, rating"), ("page", "1", "")],
        ok=(200, {"count": 1, "results": [{"id": 1, "property": 1, "author": {"id": 3, "full_name": "Test Guest"}, "rating": 5, "comment": "Lovely", "created_at": "..."}]})),
    req("Get review", "GET", "/api/reviews/{{reviewId}}/", auth=PUBLIC, ok=(200, {"id": 1, "rating": 5}), errs=[err(404, "not_found")]),
    req("Create review", "POST", "/api/reviews/", role="END_USER (verified email)", body={"booking": "{{bookingId}}", "rating": 5, "comment": "Lovely stay"},
        ok=(201, {"id": 1, "rating": 5, "comment": "Lovely stay"}), errs=[err(400, "validation_error", "not completed / already reviewed / not your booking"), err(403, "email_not_verified"), err(403, "permission_denied")], tests=set_var("reviewId", "j.id", (201,))),
    req("Update review", "PATCH", "/api/reviews/{{reviewId}}/", role="author (END_USER)", body={"rating": 4, "comment": "Updated"}, ok=(200, {"id": 1, "rating": 4}), errs=[err(403, "permission_denied")]),
    req("Delete review", "DELETE", "/api/reviews/{{reviewId}}/", role="author or SUPER_ADMIN", ok=(204, None), errs=[err(403, "permission_denied")]),
)

folder("10 Subscription plans", "**Public read** (anonymous visitors see active plans only; a Super Admin also sees inactive ones). Create/update/delete: Super Admin. `features` accepts only `max_properties` and `max_images_per_property`; a missing key means no limit. A plan with subscriptions cannot be deleted (409 `in_use`) - deactivate it.",
    req("List plans", "GET", "/api/plans/", auth=PUBLIC, query=[("is_active", "", "true|false (admin)"), ("search", "", ""), ("ordering", "price", "price, name, duration_days, created_at"), ("page", "1", "")],
        ok=(200, {"count": 1, "results": [{"id": 1, "name": "Starter", "description": "", "price": "1500.00", "duration_days": 30, "features": {"max_properties": 2, "max_images_per_property": 8}, "is_active": True, "created_at": "...", "updated_at": "..."}]})),
    req("Get plan", "GET", "/api/plans/{{planId}}/", auth=PUBLIC, ok=(200, {"id": 1, "name": "Starter"}), errs=[err(404, "not_found", "inactive plan for non-admins")]),
    req("Create plan", "POST", "/api/plans/", role="SUPER_ADMIN", body={"name": "Starter", "description": "", "price": "1500.00", "duration_days": 30, "features": {"max_properties": 2, "max_images_per_property": 8}, "is_active": True},
        ok=(201, {"id": 1, "name": "Starter"}), errs=[err(400, "validation_error", "unknown feature key, negative number, duplicate name"), err(403, "permission_denied")], tests=set_var("planId", "j.id", (201,)),
        notes="The numbers above are examples for testing only - the system ships with no plans and no built-in limits."),
    req("Update plan", "PATCH", "/api/plans/{{planId}}/", role="SUPER_ADMIN", body={"description": "Updated description"}, ok=(200, {"id": 1, "description": "Updated description"}), notes="Send `is_active: false` to stop offering a plan (existing subscriptions keep running; it cannot be newly assigned)."),
    req("Delete plan", "DELETE", "/api/plans/{{planId}}/", role="SUPER_ADMIN", ok=(204, None), errs=[err(409, "in_use", "has subscriptions")], notes="Expected to return 409 after *Assign plan to Host* has run: a plan with subscriptions cannot be deleted - deactivate it instead."),
)

folder("11 Subscriptions", """Super Admin assigns, updates and renews; a Host reads their own. Entitled = status ACTIVE and `start_date <= today < expiry_date`. Payment status is informational (manual): PENDING, PAID, FAILED, REFUNDED. There is no payment gateway.""",
    req("List subscriptions", "GET", "/api/subscriptions/", role="SUPER_ADMIN (all) or HOST (own)", query=[("user", "", "host id (admin)"), ("plan", "", ""), ("status", "", "ACTIVE|EXPIRED|CANCELLED"), ("payment_status", "", ""), ("ordering", "-start_date", "start_date, expiry_date, created_at"), ("page", "1", "")],
        ok=(200, {"count": 1, "results": [{"id": 1, "user": {"id": 2, "full_name": "Host", "email": "host@example.com"}, "plan": {"id": 1, "name": "Starter", "features": {}}, "status": "ACTIVE", "payment_status": "PAID", "amount": "1500.00", "start_date": "2026-10-04", "expiry_date": "2026-11-03", "is_current": True, "created_at": "...", "updated_at": "..."}]}),
        errs=[err(403, "permission_denied", "End User")]),
    req("Get subscription", "GET", "/api/subscriptions/{{subscriptionId}}/", role="SUPER_ADMIN or the owning HOST", ok=(200, {"id": 1, "status": "ACTIVE"}), errs=[err(404, "not_found", "another Host's")]),
    req("Current subscription (Host)", "GET", "/api/subscriptions/current/", role="HOST", ok=(200, {"subscription": {"id": 1, "status": "ACTIVE", "expiry_date": "2026-11-03", "plan": {"id": 1, "name": "Starter", "features": {"max_properties": 2}}}, "usage": {"properties": {"used": 1, "limit": 2}, "max_images_per_property": 8}}),
        errs=[err(403, "permission_denied", "not a Host")], notes="`subscription` is null when the Host has no entitling subscription."),
    req("Assign plan to Host", "POST", "/api/subscriptions/", role="SUPER_ADMIN", body={"user": "{{hostId}}", "plan": "{{planId}}", "start_date": "2026-10-04", "payment_status": "PENDING"},
        ok=(201, {"id": 1, "status": "ACTIVE", "amount": "1500.00", "start_date": "2026-10-04", "expiry_date": "2026-11-03"}),
        errs=[err(400, "validation_error", "inactive plan or not an active Host"), err(409, "subscription_overlap", "Host already has an ACTIVE subscription for those dates")], tests=set_var("subscriptionId", "j.id", (201,)),
        notes="`start_date` and `payment_status` are optional. Expiry = start + plan.duration_days; `amount` snapshots the plan price."),
    req("Update status / payment", "PATCH", "/api/subscriptions/{{subscriptionId}}/", role="SUPER_ADMIN", body={"payment_status": "PAID"},
        ok=(200, {"id": 1, "status": "ACTIVE", "payment_status": "PAID"}), errs=[err(409, "invalid_transition", "only ACTIVE can become CANCELLED/EXPIRED"), err(400, "validation_error")], notes="Only `status` and `payment_status`, both optional. `status` may only move an ACTIVE subscription to `CANCELLED` or `EXPIRED` (e.g. `{\"status\": \"CANCELLED\"}`)."),
    req("Renew / extend subscription", "POST", "/api/subscriptions/{{subscriptionId}}/renew/", role="SUPER_ADMIN", body={"payment_status": "PENDING"},
        ok=(200, {"id": 1, "status": "ACTIVE", "amount": "1500.00", "expiry_date": "2026-12-03"}),
        errs=[err(409, "invalid_transition", "CANCELLED cannot be renewed"), err(409, "plan_inactive"), err(409, "subscription_overlap"), err(403, "permission_denied")],
        notes="Body optional. New expiry = max(expiry, today) + plan.duration_days. A lapsed subscription restarts today. The price snapshot (`amount`) is kept; `payment_status` defaults to PENDING."),
)

folder("12 Billing profile", "A Host's invoice details. Super Admin can read every profile (read-only).",
    req("Get my billing profile", "GET", "/api/billing-profile/", role="HOST", ok=(200, {"billing_name": "Asha Rao", "billing_email": "asha@example.com", "phone": "", "address_line1": "12 MG Road", "address_line2": "", "city": "Pune", "state": "Maharashtra", "postal_code": "411001", "country": "India"}), errs=[err(404, "not_found", "none yet"), err(403, "permission_denied")]),
    req("Create / replace my billing profile", "PUT", "/api/billing-profile/", role="HOST", body={"billing_name": "Asha Rao", "billing_email": "asha@example.com", "phone": "", "address_line1": "12 MG Road", "address_line2": "", "city": "Pune", "state": "Maharashtra", "postal_code": "411001", "country": "India"},
        ok=(201, {"billing_name": "Asha Rao"}), errs=[err(400, "validation_error")], notes="201 when created, 200 when replaced."),
    req("Update my billing profile", "PATCH", "/api/billing-profile/", role="HOST", body={"city": "Mumbai"}, ok=(200, {"city": "Mumbai"}), errs=[err(400, "validation_error")]),
    req("List billing profiles (admin)", "GET", "/api/billing-profiles/", role="SUPER_ADMIN", query=[("user", "", "host id"), ("page", "1", "")], ok=(200, {"count": 1, "results": [{"user": {"id": 2, "full_name": "Host", "email": "host@example.com"}, "billing_name": "Asha Rao"}]})),
    req("Get billing profile (admin)", "GET", "/api/billing-profiles/{{hostId}}/", role="SUPER_ADMIN", ok=(200, {"billing_name": "Asha Rao"}), errs=[err(404, "not_found")], notes="The id in the URL is the Host's **user id**. Read-only."),
)

ENV_VARS = {
    "baseUrl": ("http://localhost:8000", "default"), "frontendOrigin": ("http://localhost:5173", "default"),
    "accessToken": ("", "secret"), "csrfToken": ("", "secret"),
    "userEmail": ("", "default"), "userPassword": ("", "secret"),
    "newUserEmail": ("", "default"), "resetEmail": ("", "default"), "newUserPassword": ("", "secret"), "newPassword": ("", "secret"), "changedPassword": ("", "secret"),
    "verifyToken": ("", "secret"), "resetUid": ("", "default"), "resetToken": ("", "secret"),
    "userId": ("", "default"), "hostId": ("", "default"),
    "adminEmail": ("", "default"), "adminPassword": ("", "secret"), "hostEmail": ("", "default"), "hostPassword": ("", "secret"), "guestEmail": ("", "default"), "guestPassword": ("", "secret"),
    "checkIn": ("", "default"), "checkOut": ("", "default"), "adminToken": ("", "secret"), "hostToken": ("", "secret"), "guestToken": ("", "secret"), "destinationId": ("", "default"), "amenityId": ("", "default"), "propertyId": ("", "default"), "imageId": ("", "default"),
    "favouriteId": ("", "default"), "bookingId": ("", "default"), "razorpayOrderId": ("", "default"), "razorpayPaymentId": ("", "default"), "razorpaySignature": ("", "default"), "webhookSignature": ("", "default"), "reviewId": ("", "default"), "planId": ("", "default"), "subscriptionId": ("", "default"),
}


def describe(r):
    lines = [f"**{r['method']}** `{{{{baseUrl}}}}{r['path']}`", ""]
    auth = {PUBLIC: "None (public)", BEARER: "`Authorization: Bearer <token>` (`{{adminToken}}`, `{{hostToken}}` or `{{guestToken}}` by role; `{{accessToken}}` for Me)", COOKIE: "`bludhaven_refresh` httpOnly cookie (stored by Postman's cookie jar) **+** CSRF token"}[r["auth"]]
    if r["auth"] == PUBLIC and r["role"] not in (PUBLIC,):
        auth = "None for reading; a token is only needed where noted"
    lines += [f"**Authentication:** {auth}", f"**Required role:** {'anyone' if r['role'] == PUBLIC else r['role']}"]
    hdr = [("Accept", "application/json", "")] + ([("Authorization", "Bearer <access token>", "")] if r["auth"] == BEARER else []) + r["headers"]
    if r["form"]:
        hdr.append(("Content-Type", "multipart/form-data (set automatically by Postman)", ""))
    elif r["body"] is not None:
        hdr.append(("Content-Type", "application/json", ""))
    lines += ["**Headers:** " + "; ".join(f"`{k}: {v}`" for k, v, _ in hdr)]
    if r["body"] is not None:
        lines += ["", "**Request body (JSON):**", "```json", json.dumps(r["body"], indent=2), "```"]
    elif r["form"]:
        lines += ["", "**Request body (form-data):** " + ", ".join(f"`{k}` ({t}): {d}" for k, t, d in r["form"])]
    elif r["method"] in ("POST", "PATCH", "PUT") :
        lines += ["", "**Request body:** none (empty)"]
    if r["query"]:
        lines += ["", "**Query parameters (all optional unless noted):**"] + [f"- `{k}` - {d or 'see value'}" for k, v, d in r["query"]]
    status, body = r["ok"]
    lines += ["", f"**Success:** {status}" + (" with:" if body is not None else " (no body)")]
    if body is not None:
        lines += ["```json", json.dumps(body, indent=2), "```"]
    if r["errs"]:
        lines += ["", "**Important errors** (shape `{\"error\": {\"code\", \"message\", \"details?\"}}`):"] + [f"- {s} `{c}`" + (f" - {n}" if n else "") for s, c, n in r["errs"]]
    if r["notes"]:
        lines += ["", r["notes"]]
    return "\n".join(lines)


def item(r):
    url = "{{baseUrl}}" + r["path"]
    raw = url + ("?" + "&".join(f"{k}={v}" for k, v, _ in r["query"]) if r["query"] else "")
    headers = [{"key": "Accept", "value": "application/json"}] + [{"key": k, "value": v, **({"description": d} if d else {})} for k, v, d in r["headers"]]
    request = {
        "method": r["method"], "header": headers, "description": describe(r),
        "url": {"raw": raw, "host": ["{{baseUrl}}"], "path": [p for p in r["path"].split("/") if p],
                "query": [{"key": k, "value": v, "description": d, "disabled": v == "" or k not in ("page",) and True} for k, v, d in r["query"]]},
    }
    # Only `page` and a pre-filled ordering are enabled by default; everything else is opt-in.
    for q in request["url"]["query"]:
        q["disabled"] = q["key"] not in ("page", "ordering") or q["value"] == ""
    if r["auth"] == PUBLIC or r["auth"] == COOKIE:
        request["auth"] = {"type": "noauth"}
    elif r["auth"] == BEARER:
        var = "accessToken" if r["path"] == "/api/auth/me/" else (token_var(r["role"]) or "accessToken")
        request["auth"] = {"type": "bearer", "bearer": [{"key": "token", "value": "{{" + var + "}}", "type": "string"}]}
    if r["form"]:
        request["body"] = {"mode": "formdata", "formdata": [
            ({"key": k, "type": "file", "src": [], "description": d} if t == "file" else {"key": k, "value": "", "type": "text", "description": d, "disabled": True}) for k, t, d in r["form"]]}
    elif r["body"] is not None:
        request["body"] = {"mode": "raw", "raw": json.dumps(r["body"], indent=2), "options": {"raw": {"language": "json"}}}
        request["header"].append({"key": "Content-Type", "value": "application/json"})
    status, body = r["ok"]
    events = [script(f"pm.test('status is {status}', () => pm.response.to.have.status({status}));")]
    if r["tests"]:
        events.append(r["tests"])
    responses = [{"name": f"Success {status}", "originalRequest": {"method": r["method"], "header": [], "url": {"raw": raw}}, "status": "OK", "code": status, "header": [{"key": "Content-Type", "value": "application/json"}], "body": json.dumps(body, indent=2) if body is not None else ""}]
    for s, c, n in r["errs"]:
        responses.append({"name": f"{s} {c}", "originalRequest": {"method": r["method"], "header": [], "url": {"raw": raw}}, "status": c, "code": s, "header": [{"key": "Content-Type", "value": "application/json"}],
                          "body": json.dumps({"error": {"code": c, "message": n or c.replace("_", " ").capitalize() + "."}}, indent=2)})
    return {"name": r["name"], "event": events, "request": request, "response": responses}


def build():
    collection = {
        "info": {"_postman_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "bludhaven-api")), "name": "Blüdhaven API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
                 "description": "Complete API of the Blüdhaven backend (Django + DRF). Import this file and `Bludhaven.postman_environment.json`, pick the environment, fill the secret variables locally.\n\n"
                                "**Setup:** import both files, select the environment and fill `adminEmail/adminPassword`, `hostEmail/hostPassword`, `guestEmail/guestPassword` (a Super Admin created with `createsuperuser`, a Host invited from it, and a verified End User). Run *01 Auth* -> the three *Login as ...* requests once; every other request then uses the right role's token automatically. Folders are ordered so *Run collection* works top to bottom (destructive requests are in *99 Cleanup*).\n\n**Auth:** access token in `Authorization: Bearer`, refresh token only in the httpOnly `bludhaven_refresh` cookie (Postman's cookie jar). Refresh and logout need `X-CSRFToken` from *01 Auth / Get CSRF token* and a trusted `Origin`.\n"
                                "**Errors** always look like `{\"error\": {\"code\", \"message\", \"details?\"}}`. **Lists** are paginated `{count, next, previous, results}` (`page`, `page_size` up to 100).\n"
                                "The system is a single shared platform with three roles (SUPER_ADMIN, HOST, END_USER). It is not multi-tenant: Hosts are limited to their own properties by ownership."},
        "event": [{"listen": "prerequest", "script": {"type": "text/javascript", "exec": [
            "// Booking dates: 30 and 33 days from today, refreshed on every request so they are never in the past.",
            "const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);",
            "pm.environment.set('checkIn', d(30)); pm.environment.set('checkOut', d(33));"]}}],
        "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{accessToken}}", "type": "string"}]},
        "item": [{"name": n, "description": d, "item": [item(r) for r in items]} for n, d, items in finalize()],
    }
    env = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "bludhaven-env")), "name": "Blüdhaven - local",
           "values": [{"key": k, "value": v, "type": t, "enabled": True} for k, (v, t) in ENV_VARS.items()], "_postman_variable_scope": "environment"}
    (OUT / "Bludhaven.postman_collection.json").write_text(json.dumps(collection, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT / "Bludhaven.postman_environment.json").write_text(json.dumps(env, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return sum(len(i) for _, _, i in finalize())


if __name__ == "__main__":
    print(f"{build()} requests written to {OUT}")
