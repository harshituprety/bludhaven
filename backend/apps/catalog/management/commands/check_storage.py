"""Post-deployment check of the real Cloudinary account.

    python manage.py check_storage

Uploads a 1x1 test image under ``<root>/healthcheck/``, reads it back over HTTPS, then deletes it.
Run it once after deployment with the production ``CLOUDINARY_URL``; the automated tests use a fake store and
cannot prove the real account works. Prints nothing secret.
"""

import secrets
import urllib.request

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.catalog import storage
from apps.catalog.storage import StorageUnavailable

# A valid 1x1 PNG.
PIXEL = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201"
    "a5f645400000000049454e44ae426082"
)


class Command(BaseCommand):
    help = "Upload a tiny test image to Cloudinary, fetch it from its URL, then delete it, to prove the credentials work."

    def handle(self, *args, **options):
        if not storage.is_configured():
            raise CommandError("CLOUDINARY_URL is not set: image uploads are disabled (they answer 503).")
        public_id = f"{settings.CLOUDINARY_ROOT_FOLDER}/healthcheck/{secrets.token_urlsafe(12)}"
        try:
            result = storage.upload_image(PIXEL, public_id)
        except StorageUnavailable:
            raise CommandError("Upload failed. Check CLOUDINARY_URL (key, secret, cloud name) and outbound HTTPS; see the log.")
        self.stdout.write(self.style.SUCCESS("Upload OK."))
        url = result.get("url", "")
        problem = None
        if not url.startswith("https://"):
            problem = "Cloudinary did not return an https URL."
        else:
            try:
                with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310 (https URL returned by Cloudinary)
                    if response.status != 200 or not response.headers.get("Content-Type", "").startswith("image/"):
                        problem = "The uploaded image could not be read back from its URL."
            except Exception:
                problem = "The image uploaded but its URL is not readable. Check the account's delivery settings."
        deleted = storage.delete_image(result.get("key") or public_id)
        if problem:
            raise CommandError(problem)
        self.stdout.write(self.style.SUCCESS("Read-back OK."))
        if not deleted:
            raise CommandError(f"Upload worked but the delete failed; remove {public_id} by hand.")
        self.stdout.write(self.style.SUCCESS("Delete OK. Cloudinary is configured correctly."))
