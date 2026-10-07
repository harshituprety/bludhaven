"""Stricter, per-IP throttles for the credential endpoints.

The general ``anon`` / ``user`` throttles come from DRF and cover every other view. These
cover login, email verification and reset confirmation (scope ``auth``), token refresh (``refresh``, its own bucket so
that restoring a session on every page load never uses up login attempts), sign-out (``logout``), registration
(``register``), password-reset requests (``password_reset``) and password changes (``password_change``). Rates are configured in settings (``THROTTLE_*`` environment variables).
"""

from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle


class AuthRateThrottle(SimpleRateThrottle):
    scope = "auth"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class RefreshRateThrottle(AuthRateThrottle):
    """Token refresh: strict, but a separate bucket from login."""

    scope = "refresh"


class LogoutRateThrottle(AuthRateThrottle):
    scope = "logout"


class PasswordChangeRateThrottle(SimpleRateThrottle):
    """Per signed-in user: guessing the current password is the only thing this endpoint can be abused for."""

    scope = "password_change"

    def get_cache_key(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class RegisterRateThrottle(AuthRateThrottle):
    scope = "register"


class PasswordResetRateThrottle(AuthRateThrottle):
    scope = "password_reset"


class ResendVerificationRateThrottle(AuthRateThrottle):
    scope = "resend_verification"


class UploadRateThrottle(UserRateThrottle):
    """Per signed-in user: file uploads are the expensive requests."""

    scope = "upload"


class PaymentRateThrottle(UserRateThrottle):
    """Per signed-in user: starting and verifying payments call the Razorpay API."""

    scope = "payment"
