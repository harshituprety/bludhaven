"""Post-deployment check of the real Cloudinary account.

    python manage.py check_storage

Uploads a 1x1 test image under ``<root>/healthcheck/``, confirms it is served over HTTPS, then deletes it.
Run it once after deployment with the production ``CLOUDINARY_URL``; the automated tests use a fake store and
cannot prove the real account works. Prints nothing secret.
"""

import secrets

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
    help = "Upload and delete a tiny test image to prove the Cloudinary credentials work."

    def handle(self, *args, **options):
        if not settings.CLOUDINARY_URL:
            raise CommandError("CLOUDINARY_URL is not set: image uploads are disabled (they answer 503).")
        public_id = f"{settings.CLOUDINARY_ROOT_FOLDER}/healthcheck/{secrets.token_urlsafe(12)}"
        try:
            result = storage.upload_image(PIXEL, public_id)
        except StorageUnavailable:
            raise CommandError("Upload failed. Check CLOUDINARY_URL (key, secret, cloud name) and outbound HTTPS; see the log.")
        url = result.get("secure_url", "")
        if not url.startswith("https://"):
            storage.delete_image(result.get("public_id") or public_id)
            raise CommandError("Cloudinary did not return an https URL.")
        self.stdout.write(self.style.SUCCESS("Upload OK."))
        if not storage.delete_image(result.get("public_id") or public_id):
            raise CommandError("Upload worked but the delete failed; remove the healthcheck/ test file by hand.")
        self.stdout.write(self.style.SUCCESS("Delete OK. Cloudinary is configured correctly."))
