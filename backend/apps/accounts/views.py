import logging

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.middleware.csrf import CsrfViewMiddleware, get_token
from django.utils import timezone
from django.utils.cache import add_never_cache_headers
from rest_framework import serializers, status
from rest_framework.exceptions import APIException, AuthenticationFailed, PermissionDenied
from rest_framework.generics import CreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.core.throttling import (
    AuthRateThrottle,
    LogoutRateThrottle,
    PasswordChangeRateThrottle,
    PasswordResetRateThrottle,
    RefreshRateThrottle,
    RegisterRateThrottle,
    ResendVerificationRateThrottle,
)

from . import emails, tokens
from .models import User
from .serializers import (
    ChangePasswordSerializer,
    EmailTokenObtainPairSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    UserSerializer,
    VerifyEmailSerializer,
)

logger = logging.getLogger(__name__)


# --- the refresh-token cookie ----------------------------------------------------


def set_refresh_cookie(response, refresh_token):
    """The refresh token lives only in this cookie: httpOnly (no script access), Secure, SameSite, /api/auth/ only."""
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        str(refresh_token),
        max_age=int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
        httponly=True,
        secure=settings.REFRESH_COOKIE_SECURE,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
        path=settings.REFRESH_COOKIE_PATH,
        domain=settings.REFRESH_COOKIE_DOMAIN,
    )
    return response


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        domain=settings.REFRESH_COOKIE_DOMAIN,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
    return response


class CsrfFailed(PermissionDenied):
    default_detail = "CSRF check failed."
    default_code = "csrf_failed"


class _CsrfCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason  # hand the reason back instead of building an HTML 403


def enforce_csrf(request):
    """Django's own CSRF validation (Origin vs CSRF_TRUSTED_ORIGINS, cookie vs X-CSRFToken header)."""
    django_request = request._request
    check = _CsrfCheck(lambda r: None)
    check.process_request(django_request)
    reason = check.process_view(django_request, None, (), {})
    if reason:
        raise CsrfFailed(f"CSRF check failed: {reason}")


class CsrfProtectedMixin:
    """For views that act on the refresh cookie: browsers attach cookies automatically, so require the CSRF token too."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_csrf(request)


def _no_store(response):
    add_never_cache_headers(response)
    return response


class CsrfTokenView(APIView):
    """GET -> {"csrfToken"}. Sets the CSRF cookie; the page sends the token back in X-CSRFToken on refresh/logout."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return _no_store(Response({"csrfToken": get_token(request._request)}))


class RefreshTokenMissing(AuthenticationFailed):
    default_detail = "No refresh token was sent."
    default_code = "refresh_token_missing"


class EmailTokenObtainPairView(TokenObtainPairView):
    """POST {email, password} -> {access, user}; the refresh token is set as an httpOnly cookie, never in the body."""

    serializer_class = EmailTokenObtainPairSerializer
    throttle_classes = [AuthRateThrottle]

    def post(self, request, *args, **kwargs):
        try:
            response = super().post(request, *args, **kwargs)
        except APIException as exc:
            if exc.status_code == status.HTTP_401_UNAUTHORIZED:
                # No email or password in the log: only that a login failed, and from where.
                logger.warning("Failed login attempt from %s", request.META.get("REMOTE_ADDR", "unknown"))
            raise
        set_refresh_cookie(response, response.data.pop("refresh"))
        return _no_store(response)


class TokenRefreshThrottledView(CsrfProtectedMixin, TokenRefreshView):
    """POST (empty body) -> {access}. Reads the refresh cookie and replaces it with a rotated one.

    The old refresh token is blacklisted by rotation, so a stolen copy stops working as soon as the real client refreshes.
    """

    throttle_classes = [RefreshRateThrottle]

    def post(self, request, *args, **kwargs):
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if not raw:
            raise RefreshTokenMissing()
        serializer = self.get_serializer(data={"refresh": raw})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken, AuthenticationFailed) as exc:
            error = exc if isinstance(exc, APIException) else InvalidToken(exc.args[0])
            response = self.handle_exception(error)
            clear_refresh_cookie(response)  # a dead cookie should not linger
            return _no_store(response)
        data = serializer.validated_data
        response = Response({"access": data["access"]})
        if "refresh" in data:  # rotation is on, so always
            set_refresh_cookie(response, data["refresh"])
        return _no_store(response)


class TokenBlacklistThrottledView(CsrfProtectedMixin, APIView):
    """POST (empty body) -> 200. Revokes the refresh token in the cookie and clears the cookie (sign out).

    Always succeeds for the caller: a missing, expired or already revoked token still ends with the cookie cleared.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LogoutRateThrottle]

    def post(self, request):
        raw = request.COOKIES.get(settings.REFRESH_COOKIE_NAME)
        if raw:
            try:
                RefreshToken(raw).blacklist()
            except TokenError:
                pass
        return _no_store(clear_refresh_cookie(Response({"detail": "Signed out."})))


class RegisterView(CreateAPIView):
    """POST {email, full_name, password} -> 201 with the new END_USER (never the password)."""

    serializer_class = RegisterSerializer
    authentication_classes = []  # public: a stale token on a sign-up request must not cause a 401
    permission_classes = [AllowAny]
    throttle_classes = [RegisterRateThrottle]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        logger.info("Registered new end user id=%s", user.pk)
        emails.send_verification_email(user)  # a mail failure is logged, never a failed sign-up
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)


def revoke_all_refresh_tokens(user):
    """End every session of this user: blacklist each refresh token that was ever issued to them."""
    outstanding = OutstandingToken.objects.filter(user=user)
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token=t) for t in outstanding], ignore_conflicts=True)


class MeView(RetrieveUpdateAPIView):
    """GET the signed-in user (also a handy token check). PATCH changes the safe profile fields (only ``full_name``).

    Role, status, staff flags, verification and email are not writable here; unknown keys are rejected with a 400.
    """

    http_method_names = ["get", "patch", "head", "options"]

    def get_serializer_class(self):
        return ProfileUpdateSerializer if self.request.method == "PATCH" else UserSerializer

    def get_object(self):
        return self.request.user

    def patch(self, request, *args, **kwargs):
        serializer = self.get_serializer(request.user, data=request.data)  # full_name is required
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(APIView):
    """POST {current_password, new_password} -> 200. Signs the person out everywhere.

    The current password is required, the new one must pass Django's validators and differ from the old one.
    Every refresh token is revoked and the cookie cleared, so the person logs in again with the new password.
    Access tokens already issued live out their 15 minutes, exactly as after a password reset.
    Neither password is logged.
    """

    permission_classes = [IsAuthenticated]
    throttle_classes = [UserRateThrottle, PasswordChangeRateThrottle]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = request.user
        with transaction.atomic():
            user.set_password(serializer.validated_data["new_password"])
            user.save(update_fields=["password"])
            revoke_all_refresh_tokens(user)
        logger.info("Password changed for user id=%s", user.pk)
        return _no_store(clear_refresh_cookie(Response({"detail": "Your password has been changed. Please sign in again."})))


class InvalidLink(APIException):
    """One generic answer for every bad link: wrong, tampered, expired, used, or for another user."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = "This link is invalid or has expired."
    default_code = "invalid_token"


class _PublicPost(APIView):
    authentication_classes = []  # public: a stale Authorization header must not turn these into 401s
    permission_classes = [AllowAny]
    throttle_classes = [AuthRateThrottle]


class VerifyEmailView(_PublicPost):
    """POST {token} -> 200. Marks the address verified. Only the emailed token can do that.

    POST rather than GET, so mail scanners and link prefetchers that open URLs cannot trigger it.
    The response never contains the email address, the user, or any token.
    """

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = tokens.user_from_verification_token(serializer.validated_data["token"])
        if user is None:
            raise InvalidLink("This verification link is invalid or has expired.")
        if user.is_email_verified:
            return Response({"detail": "Email is already verified.", "already_verified": True})
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
        logger.info("Email verified for user id=%s", user.pk)
        return Response({"detail": "Email verified.", "already_verified": False})


class ResendVerificationView(_PublicPost):
    """POST {email} -> always the same 200. A fresh link goes out only to an active, still-unverified account.

    Same token mechanism and expiry as the first email; older links keep working until they expire.
    Public (not tied to a login) so a user who lost the first email, or whose link expired, can ask again.
    """

    throttle_classes = [ResendVerificationRateThrottle]
    GENERIC = {"detail": "If that account exists and is not yet verified, a new verification email has been sent."}

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None and not user.is_email_verified:
            emails.send_verification_email(user)
        return Response(self.GENERIC)


class PasswordResetRequestView(_PublicPost):
    """POST {email} -> always the same 200, whether or not the address has an account."""

    throttle_classes = [PasswordResetRateThrottle]
    GENERIC = {"detail": "If an account exists for that email, a password reset link has been sent."}

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None:  # includes invited accounts that have no password yet
            emails.send_password_reset_email(user)
        return Response(self.GENERIC)


class PasswordResetConfirmView(_PublicPost):
    """POST {uid, token, new_password} -> 200. The token works once; a weak password does not use it up."""

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = tokens.user_from_reset_credentials(data["uid"], data["token"])
        if user is None:
            raise InvalidLink("This password reset link is invalid or has expired.")
        try:
            validate_password(data["new_password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        with transaction.atomic():
            invited = not user.has_usable_password()  # created by a Super Admin and never given a password
            user.set_password(data["new_password"])  # changes the hash, which is what kills the reset token
            fields = ["password"]
            if invited and not user.is_email_verified:
                user.email_verified_at = timezone.now()  # opening the emailed link proves they own the address
                fields.append("email_verified_at")
            user.save(update_fields=fields)
            # Whoever knew the old password may still hold refresh tokens: end every session.
            revoke_all_refresh_tokens(user)
        logger.info("Password reset completed for user id=%s", user.pk)
        return clear_refresh_cookie(Response({"detail": "Your password has been reset. You can now sign in."}))
