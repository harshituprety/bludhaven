"""Single-purpose tokens, built on Django's own primitives (no custom crypto).

* Email verification: ``django.core.signing`` (HMAC with SECRET_KEY, timestamped). The signed
  payload holds the user id and the address being verified, so a link stops working if the
  address changes. A link is also harmless to replay: verifying twice changes nothing.
* Password reset: ``PasswordResetTokenGenerator``. Its hash covers the current password hash and
  last login, so a link dies the moment the password changes (single use) and expires after
  ``PASSWORD_RESET_TIMEOUT``.
"""

from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode

from .models import User

VERIFY_SALT = "accounts.email-verification"


# --- email verification --------------------------------------------------------


def make_verification_token(user):
    return signing.dumps({"uid": user.pk, "email": user.email}, salt=VERIFY_SALT)


def user_from_verification_token(token):
    """The active user a valid, unexpired token was issued for, else None."""
    try:
        data = signing.loads(token, salt=VERIFY_SALT, max_age=settings.EMAIL_VERIFICATION_TIMEOUT)
        user = User.objects.get(pk=data["uid"], is_active=True)
    except (signing.BadSignature, KeyError, TypeError, ValueError, User.DoesNotExist):
        return None
    return user if user.email == data.get("email") else None


# --- password reset ------------------------------------------------------------


def make_reset_credentials(user):
    """(uid, token) for the reset link."""
    return urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)


def user_from_reset_credentials(uid, token):
    """The active user for a valid, unexpired, unused (uid, token) pair, else None."""
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(uid)), is_active=True)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None
    return user if default_token_generator.check_token(user, token) else None
