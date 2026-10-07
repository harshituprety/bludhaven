from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from apps.core.testing import FakeCloudinary


class CheckStorageCommandTests(SimpleTestCase):
    @override_settings(CLOUDINARY_URL="")
    def test_refuses_without_credentials(self):
        with self.assertRaisesMessage(CommandError, "CLOUDINARY_URL is not set"):
            call_command("check_storage")

    @override_settings(CLOUDINARY_URL="cloudinary://k:s@demo")
    def test_uploads_then_deletes_a_test_image(self):
        out = StringIO()
        with FakeCloudinary() as cloud:
            call_command("check_storage", stdout=out)
            self.assertEqual(len(cloud.uploaded), 1)
            self.assertEqual(list(cloud.uploaded), cloud.deleted)
        self.assertIn("Cloudinary is configured correctly", out.getvalue())
        self.assertNotIn("k:s", out.getvalue())

    @override_settings(CLOUDINARY_URL="cloudinary://k:s@demo")
    def test_reports_an_upload_failure(self):
        with FakeCloudinary() as cloud:
            cloud.fail_upload = True
            with self.assertRaisesMessage(CommandError, "Upload failed"):
                call_command("check_storage")

    @override_settings(CLOUDINARY_URL="cloudinary://k:s@demo")
    def test_reports_a_failed_delete(self):
        with FakeCloudinary():
            with mock.patch("apps.catalog.storage.delete_image", return_value=False):
                with self.assertRaisesMessage(CommandError, "delete failed"):
                    call_command("check_storage")
