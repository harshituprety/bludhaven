"""
Django settings for the Blüdhaven backend.

Configuration is read from environment variables (see ``.env.example``).
Application logic lives in ``apps/``; this module only wires things together.
"""

import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    """Read a comma-separated environment variable into a clean list (blank counts as unset)."""
    return [item.strip() for item in (os.getenv(name) or default).split(",") if item.strip()]


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip().lower() in {"1", "true", "yes", "on"}


def env_required(name: str) -> str:
    """Read a variable that must be set; fail loudly at startup instead of running misconfigured."""
    value = os.getenv(name)
    if value is None or value == "":
        raise ImproperlyConfigured(f"Environment variable {name} is required (see backend/.env.example).")
    return value


# --- Core ---------------------------------------------------------------------
# Secure by default: DEBUG is off unless DJANGO_DEBUG is set (copy .env.example for local work).
# Outside DEBUG the app refuses to start without a real secret key and explicit hosts.

DEBUG = env_bool("DJANGO_DEBUG", False)

_DEV_SECRET_KEY = "dev-only-insecure-key-change-me"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY") or (_DEV_SECRET_KEY if DEBUG else "")
if not DEBUG and (not SECRET_KEY or "change-me" in SECRET_KEY or "insecure" in SECRET_KEY):
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set to a long random value when DJANGO_DEBUG is off.")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1" if DEBUG else "")
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must list the site's host names when DJANGO_DEBUG is off.")

# --- Applications -------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "django_filters",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    # Local apps
    "apps.accounts",
    "apps.core",
    "apps.catalog",
    "apps.bookings",
    "apps.billing",
    "apps.payments",
]

# Custom user (email login, database-backed role). Must be set before the first migration.
AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # CorsMiddleware must sit above anything that can generate responses.
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# --- Database -----------------------------------------------------------------
# MySQL 8, configured only through environment variables (no credentials in code).
# Everything talks to it through the Django ORM.

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": env_required("DB_NAME"),
        "USER": env_required("DB_USER"),
        "PASSWORD": env_required("DB_PASSWORD"),
        "HOST": os.getenv("DB_HOST", "127.0.0.1"),
        "PORT": os.getenv("DB_PORT", "3306"),
        "OPTIONS": {
            "charset": "utf8mb4",
            "init_command": "SET sql_mode='STRICT_TRANS_TABLES'",
            # Optional TLS to a managed MySQL: path to the provider's CA certificate.
            **({"ssl": {"ca": os.environ["DB_SSL_CA"]}} if os.getenv("DB_SSL_CA") else {}),
        },
        "TEST": {"CHARSET": "utf8mb4"},
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Password validation ------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# --- Internationalisation -----------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"  # India-focused: "today" for booking dates is the Indian date; stored times stay UTC
USE_I18N = True
USE_TZ = True

# --- Static files -------------------------------------------------------------

STATIC_URL = "static/"

# --- Django REST Framework ----------------------------------------------------

REST_FRAMEWORK = {
    # JSON only for now; the React app is the sole consumer.
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    # Secure by default: every endpoint needs a valid JWT unless it explicitly opts out
    # (see apps/core/views.py health, SimpleJWT's login/refresh views and the register view).
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # One error shape: {"error": {"code", "message", "details"?}} (apps/core/exceptions.py).
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    # List endpoints: ?page=N&page_size=N (default 12, max 100).
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    # List endpoints opt in to fields with `filterset_fields` / `search_fields` / `ordering_fields`.
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    # General limits for every view; login/refresh/register have stricter ones (apps/core/throttling.py).
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("THROTTLE_ANON", "120/min"),
        "user": os.getenv("THROTTLE_USER", "600/min"),
        "auth": os.getenv("THROTTLE_AUTH", "10/min"),
        "refresh": os.getenv("THROTTLE_REFRESH", "30/min"),
        "logout": os.getenv("THROTTLE_LOGOUT", "20/min"),
        "password_change": os.getenv("THROTTLE_PASSWORD_CHANGE", "10/hour"),
        "register": os.getenv("THROTTLE_REGISTER", "10/hour"),
        "password_reset": os.getenv("THROTTLE_PASSWORD_RESET", "5/hour"),
        "resend_verification": os.getenv("THROTTLE_RESEND_VERIFICATION", "5/hour"),
        "upload": os.getenv("THROTTLE_UPLOAD", "60/hour"),
        "payment": os.getenv("THROTTLE_PAYMENT", "30/min"),
    },
    # How many reverse proxies sit in front of Django. 0 = trust only the socket address, so a
    # client cannot dodge throttling by sending its own X-Forwarded-For. Set it when deployed.
    "NUM_PROXIES": int(os.getenv("NUM_PROXIES", "0")),
}

# --- Email, account links ----------------------------------------------------
# Verification and password-reset emails link to the React app (FRONTEND_URL); the pages
# that receive the links are built with the frontend integration. Development prints emails
# to the runserver console (so you can click the link); with DEBUG off, real SMTP is required.

FRONTEND_URL = (os.getenv("FRONTEND_URL") or ("http://localhost:5173" if DEBUG else "")).rstrip("/")
if not DEBUG and not FRONTEND_URL.startswith("https://"):
    raise ImproperlyConfigured("FRONTEND_URL must be the site's https:// address when DJANGO_DEBUG is off.")

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND") or (
    "django.core.mail.backends.console.EmailBackend" if DEBUG else "django.core.mail.backends.smtp.EmailBackend"
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "localhost")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Blüdhaven <no-reply@bludhaven.local>")
if EMAIL_BACKEND.endswith("smtp.EmailBackend") and not DEBUG and not os.getenv("EMAIL_HOST"):
    raise ImproperlyConfigured("EMAIL_HOST (and credentials) must be set to send email when DJANGO_DEBUG is off.")

# Links expire. Password-reset tokens are Django's PasswordResetTokenGenerator (single use: they
# stop working once the password changes). Verification links are Django signed values.
PASSWORD_RESET_TIMEOUT = int(os.getenv("PASSWORD_RESET_TIMEOUT_MINUTES", "60")) * 60
EMAIL_VERIFICATION_TIMEOUT = int(os.getenv("EMAIL_VERIFICATION_TIMEOUT_HOURS", "48")) * 3600

# --- Bookings ------------------------------------------------------------------
# Technical guard against absurd date ranges (and total_price overflow); not a business rule. Raise it freely.
BOOKING_MAX_NIGHTS = int(os.getenv("BOOKING_MAX_NIGHTS", "90"))

# A PENDING booking holds its dates only this long; it is EXPIRED if no verified payment arrives in time.
# Enforced by the availability queries themselves (an expired hold simply stops blocking), so a scheduled cleanup
# (`manage.py expire_unpaid_bookings`) is tidiness, not correctness.
BOOKING_PAYMENT_WINDOW_MINUTES = int(os.getenv("BOOKING_PAYMENT_WINDOW_MINUTES", "15"))

# --- Razorpay (guest booking payments, Host plan purchases and wallet top-ups) --------------------------------------
# Host subscriptions are NOT paid through Razorpay: a Super Admin assigns them after the Host contacts Customer Care.
# All three values are secrets and are read only here, on the server. Without them the payment endpoints answer
# 503 `payments_unavailable`; browsing and booking requests keep working. Use Razorpay TEST keys outside production.
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_TIMEOUT_SECONDS = int(os.getenv("RAZORPAY_TIMEOUT_SECONDS", "15"))

# --- Host subscriptions and wallet --------------------------------------------------
# Plan prices and limits live in the database (Super Admin edits them); these two are operational settings only.
# After a paid period ends the Host stays PAST_DUE (still entitled) for this many days, then the subscription is EXPIRED.
SUBSCRIPTION_GRACE_DAYS = int(os.getenv("SUBSCRIPTION_GRACE_DAYS", "3"))
# Largest single wallet top-up, in whole rupees: a sanity limit against typos, not a business rule.
WALLET_TOPUP_MAX_RUPEES = int(os.getenv("WALLET_TOPUP_MAX_RUPEES", "100000"))

# --- JWT (djangorestframework-simplejwt) --------------------------------------

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_MINUTES", "15"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_DAYS", "7"))),
    # Each refresh issues a new refresh token and blacklists the old one (token_blacklist app).
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": os.getenv("JWT_SIGNING_KEY") or SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- CORS / CSRF / refresh-token cookie ---------------------------------------
# The browser keeps the long-lived refresh token in an httpOnly cookie that JavaScript cannot read;
# only the short-lived access token is held by the page (in memory) and sent as a Bearer header.
#
# * Cookies need CORS with credentials, so CORS_ALLOW_CREDENTIALS is on. That is only safe with an
#   explicit origin list, never "*": origins are validated below.
# * A cookie-authenticated POST (token refresh, logout) is protected against CSRF three ways:
#   SameSite on the cookie, Django's Origin check against CSRF_TRUSTED_ORIGINS, and a CSRF token the
#   page fetches from GET /api/auth/csrf/ and echoes in the X-CSRFToken header.
# * The refresh cookie is only sent to /api/auth/, and never contains anything readable by scripts.

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else "",
)
for _origin in CORS_ALLOWED_ORIGINS:
    if "*" in _origin or not _origin.startswith(("http://", "https://")):
        raise ImproperlyConfigured(f"CORS_ALLOWED_ORIGINS must be explicit http(s) origins, got {_origin!r}.")
CORS_ALLOW_CREDENTIALS = True
# HTTPS origins that may submit cookie-authenticated requests. Defaults to the CORS origins (the frontend).
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS") or list(CORS_ALLOWED_ORIGINS)

REFRESH_COOKIE_NAME = os.getenv("REFRESH_COOKIE_NAME", "bludhaven_refresh")
REFRESH_COOKIE_PATH = "/api/auth/"
REFRESH_COOKIE_SECURE = env_bool("REFRESH_COOKIE_SECURE", not DEBUG)
# Lax is right when the site and the API share a registrable domain (localhost:5173 -> localhost:8000,
# www.example.com -> api.example.com). Use "None" only if they are on unrelated domains (needs Secure).
REFRESH_COOKIE_SAMESITE = (os.getenv("REFRESH_COOKIE_SAMESITE") or "Lax").capitalize()
# Set to ".example.com" only if the frontend and API are on different subdomains and cookies must be shared.
REFRESH_COOKIE_DOMAIN = os.getenv("REFRESH_COOKIE_DOMAIN") or None
if REFRESH_COOKIE_SAMESITE not in {"Lax", "Strict", "None"}:
    raise ImproperlyConfigured("REFRESH_COOKIE_SAMESITE must be Lax, Strict or None.")
if not REFRESH_COOKIE_SECURE and (not DEBUG or REFRESH_COOKIE_SAMESITE == "None"):
    raise ImproperlyConfigured("The refresh cookie must be Secure (only plain-http local development may turn this off).")

CSRF_COOKIE_HTTPONLY = True  # the page gets the token from the JSON response of /api/auth/csrf/, not from the cookie
CSRF_COOKIE_SAMESITE = REFRESH_COOKIE_SAMESITE
CSRF_COOKIE_DOMAIN = REFRESH_COOKIE_DOMAIN

# --- HTTPS and cookies --------------------------------------------------------
# On when DEBUG is off, each switchable by environment variable for unusual setups.

SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", not DEBUG)
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = REFRESH_COOKIE_SECURE
SECURE_HSTS_SECONDS = int(os.getenv("DJANGO_HSTS_SECONDS", "0" if DEBUG else "31536000"))
SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("DJANGO_HSTS_INCLUDE_SUBDOMAINS", False)
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
if env_bool("DJANGO_BEHIND_PROXY", False):
    # Only enable when a trusted proxy (nginx, a load balancer) sets and overwrites this header.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# --- Logging ------------------------------------------------------------------
# Console output (collected by the host). Request bodies, headers, tokens and passwords are
# never logged; auth events record ids or addresses only.

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"standard": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "standard"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "apps": {"handlers": ["console"], "level": LOG_LEVEL, "propagate": False},
        "django": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}

# --- Image uploads (Cloudinary) -------------------------------------------------
# CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> (read by the SDK from the environment too).
# Uploads fail with a clean 503 if it is missing; nothing else in the API depends on it.
CLOUDINARY_URL = os.getenv("CLOUDINARY_URL", "")
CLOUDINARY_ROOT_FOLDER = (os.getenv("CLOUDINARY_ROOT_FOLDER") or "bludhaven").strip("/")
IMAGE_MAX_BYTES = int(os.getenv("IMAGE_MAX_BYTES", str(5 * 1024 * 1024)))
IMAGE_MAX_PIXELS = int(os.getenv("IMAGE_MAX_PIXELS", str(40_000_000)))  # decompression-bomb guard
IMAGE_ALLOWED_FORMATS = [f.lower() for f in env_list("IMAGE_ALLOWED_FORMATS", "jpeg,png,webp")]
# Reject oversize bodies before reading them (multipart overhead allowance).
DATA_UPLOAD_MAX_MEMORY_SIZE = int(os.getenv("DATA_UPLOAD_MAX_MEMORY_SIZE", str(1024 * 1024)))
FILE_UPLOAD_MAX_MEMORY_SIZE = IMAGE_MAX_BYTES
