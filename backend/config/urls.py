"""Root URL configuration. All API routes live under the ``/api/`` namespace."""

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.core.urls")),
    # Future: /api/auth/, /api/properties/, /api/bookings/, /api/users/, /api/admin/
]
