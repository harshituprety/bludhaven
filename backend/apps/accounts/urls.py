from django.urls import path

from .views import (
    ChangePasswordView,
    CsrfTokenView,
    EmailTokenObtainPairView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterHostView,
    RegisterView,
    ResendVerificationView,
    TokenBlacklistThrottledView,
    TokenRefreshThrottledView,
    VerifyEmailView,
)

urlpatterns = [
    path("register/", RegisterView.as_view(), name="register"),
    path("register-host/", RegisterHostView.as_view(), name="register_host"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify_email"),
    path("resend-verification/", ResendVerificationView.as_view(), name="resend_verification"),
    path("password-reset/", PasswordResetRequestView.as_view(), name="password_reset"),
    path("password-reset/confirm/", PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("csrf/", CsrfTokenView.as_view(), name="csrf"),
    path("token/", EmailTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", TokenRefreshThrottledView.as_view(), name="token_refresh"),
    path("token/blacklist/", TokenBlacklistThrottledView.as_view(), name="token_blacklist"),
    path("me/", MeView.as_view(), name="me"),
    path("change-password/", ChangePasswordView.as_view(), name="change_password"),
]
