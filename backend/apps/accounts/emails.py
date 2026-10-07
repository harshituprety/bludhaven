"""The two account emails. Plain text, no tracking, nothing secret except the link itself.

Nothing here logs addresses, links or tokens.
"""

import logging
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import send_mail

from . import tokens

logger = logging.getLogger(__name__)

SITE = "Blüdhaven"


def _send(user, subject, body, what):
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)
    except Exception:  # SMTP down, bad credentials, ...: the request that triggered it must still succeed
        logger.error("Could not send %s email for user id=%s", what, user.pk, exc_info=True)
        return False
    logger.info("Sent %s email for user id=%s", what, user.pk)
    return True


def verification_link(user):
    return f"{settings.FRONTEND_URL}/verify-email?{urlencode({'token': tokens.make_verification_token(user)})}"


def send_verification_email(user):
    hours = settings.EMAIL_VERIFICATION_TIMEOUT // 3600
    body = (
        f"Hi {user.full_name},\n\n"
        f"Welcome to {SITE}. Please confirm your email address by opening this link:\n\n"
        f"{verification_link(user)}\n\n"
        f"The link works for {hours} hours. If you did not create an account, you can ignore this email.\n"
    )
    return _send(user, f"Confirm your {SITE} email address", body, "verification")


def reset_link(user):
    uid, token = tokens.make_reset_credentials(user)
    return f"{settings.FRONTEND_URL}/reset-password?{urlencode({'uid': uid, 'token': token})}"


def send_password_reset_email(user):
    minutes = settings.PASSWORD_RESET_TIMEOUT // 60
    body = (
        f"Hi {user.full_name},\n\n"
        f"Someone asked to reset the password for your {SITE} account. To choose a new password, open:\n\n"
        f"{reset_link(user)}\n\n"
        f"The link works once and expires in {minutes} minutes. If this was not you, ignore this email: "
        f"your password has not changed.\n"
    )
    return _send(user, f"Reset your {SITE} password", body, "password-reset")


def send_invitation_email(user):
    """Sent when a Super Admin creates an account: the link lets the person choose their own password."""
    minutes = settings.PASSWORD_RESET_TIMEOUT // 60
    body = (
        f"Hi {user.full_name},\n\n"
        f"An account has been created for you on {SITE}. To choose your password and sign in, open:\n\n"
        f"{reset_link(user)}\n\n"
        f"The link works once and expires in {minutes} minutes. If it has expired, use \"Forgot password\" on the sign-in page.\n"
    )
    return _send(user, f"Your {SITE} account", body, "invitation")
