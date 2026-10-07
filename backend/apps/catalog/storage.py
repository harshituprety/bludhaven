"""Cloudinary access, kept behind two functions so tests can replace them and nothing else imports the SDK.

Public IDs are ``<root>/hosts/<host id>/properties/<property id>/<random>``. The random part comes from
``secrets`` so IDs cannot be guessed or enumerated, and the client's filename is never used.
"""

import logging
import secrets

import cloudinary
import cloudinary.uploader
from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)


class StorageUnavailable(APIException):
    status_code = 503
    default_detail = "Image storage is not available right now."
    default_code = "storage_unavailable"


def folder_for(prop) -> str:
    return f"{settings.CLOUDINARY_ROOT_FOLDER}/hosts/{prop.owner_id}/properties/{prop.pk}"


def new_public_id(prop) -> str:
    return f"{folder_for(prop)}/{secrets.token_urlsafe(18)}"


def _configure():
    if not settings.CLOUDINARY_URL:
        raise StorageUnavailable()
    # The SDK reads CLOUDINARY_URL from the process environment.
    import os

    os.environ["CLOUDINARY_URL"] = settings.CLOUDINARY_URL
    cloudinary.reset_config()
    cloudinary.config(secure=True)


def upload_image(data: bytes, public_id: str) -> dict:
    """Upload bytes; returns Cloudinary's response (``secure_url``, ``public_id``...). Raises StorageUnavailable."""
    _configure()
    try:
        return cloudinary.uploader.upload(
            data, public_id=public_id, overwrite=False, unique_filename=False, resource_type="image",
            type="upload", invalidate=False,
        )
    except Exception:
        logger.exception("Cloudinary upload failed for %s", public_id)
        raise StorageUnavailable()


def delete_image(public_id: str) -> bool:
    """Best effort. Never raises: a failed delete leaves an orphan file, not a broken request."""
    if not public_id:
        return True
    try:
        _configure()
        cloudinary.uploader.destroy(public_id, resource_type="image", invalidate=True)
        return True
    except Exception:
        logger.exception("Cloudinary delete failed for %s", public_id)
        return False
