"""Cloudinary access, kept behind two functions so tests can replace them and nothing else imports the SDK.

Public IDs are ``<root>/hosts/<host id>/properties/<property id>/<random>``. The random part comes from ``secrets``
so IDs cannot be guessed or enumerated, and the client's filename is never used. Uploads go through this server (so
ownership, size, type and content checks all happen first); the browser never gets Cloudinary credentials.
"""

import logging
import os
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


def is_configured() -> bool:
    return bool(settings.CLOUDINARY_URL)


def folder_for(prop) -> str:
    return f"{settings.CLOUDINARY_ROOT_FOLDER}/hosts/{prop.owner_id}/properties/{prop.pk}"


def new_public_id(prop) -> str:
    """A fresh, server-chosen public ID for one image of ``prop``."""
    return f"{folder_for(prop)}/{secrets.token_urlsafe(18)}"


def _configure():
    if not is_configured():
        raise StorageUnavailable()
    # The SDK reads CLOUDINARY_URL from the process environment.
    os.environ["CLOUDINARY_URL"] = settings.CLOUDINARY_URL
    cloudinary.reset_config()
    cloudinary.config(secure=True)


def upload_image(data: bytes, public_id: str) -> dict:
    """Store ``data``; returns ``{"key", "url"}``. Raises StorageUnavailable if Cloudinary is unset or refuses."""
    if not public_id.startswith(f"{settings.CLOUDINARY_ROOT_FOLDER}/"):
        raise ValueError("refusing to upload outside the server-controlled folder")
    _configure()
    try:
        result = cloudinary.uploader.upload(
            data, public_id=public_id, overwrite=False, unique_filename=False, resource_type="image",
            type="upload", invalidate=False,
        )
    except Exception:
        logger.exception("Cloudinary upload failed for %s", public_id)
        raise StorageUnavailable()
    return {"key": result.get("public_id") or public_id, "url": result["secure_url"]}


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
