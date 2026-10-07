"""Root URL configuration. All API routes live under the ``/api/`` namespace."""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.core.urls")),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.catalog.urls")),  # destinations, amenities, properties, images, favourites
    path("api/", include("apps.bookings.urls")),  # bookings, reviews
    path("api/", include("apps.payments.urls")),  # booking payment + Razorpay webhook
    path("api/", include("apps.billing.urls")),  # plans, subscriptions, billing profiles
    path("api/", include("apps.accounts.admin_urls")),  # /api/users/ (Super Admin)
]
