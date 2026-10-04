from django.conf import settings
from django.db import models


class SiteSetting(models.Model):
    """A global, Super-Admin-managed setting stored as key -> JSON value."""

    key = models.CharField(max_length=100, unique=True)
    value = models.JSONField()
    description = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        ordering = ["key"]

    def __str__(self):
        return self.key
