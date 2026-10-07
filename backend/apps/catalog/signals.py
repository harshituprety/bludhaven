"""Delete the Cloudinary file after the database row is really gone (and only if the transaction committed)."""

from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from . import storage
from .models import PropertyImage


@receiver(post_delete, sender=PropertyImage)
def delete_stored_file(sender, instance, **kwargs):
    key = instance.storage_key
    if key:
        transaction.on_commit(lambda: storage.delete_image(key))
