from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from apps.core.testing import FakeStorage

CLD = dict(CLOUDINARY_URL="cloudinary://k:s@demo", CLOUDINARY_ROOT_FOLDER="bludhaven")


class _Response:
    def __init__(self, status=200, content_type="image/png"):
        self.status, self.headers = status, {"Content-Type": content_type}

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class CheckStorageCommandTests(SimpleTestCase):
    @override_settings(CLOUDINARY_URL="")
    def test_refuses_without_configuration(self):
        with self.assertRaisesMessage(CommandError, "CLOUDINARY_URL is not set"):
            call_command("check_storage")

    @override_settings(**CLD)
    def test_uploads_reads_back_then_deletes_a_test_image(self):
        out = StringIO()
        with FakeStorage() as cloud, mock.patch("urllib.request.urlopen", return_value=_Response()):
            call_command("check_storage", stdout=out)
            self.assertEqual(len(cloud.uploaded), 1)
            self.assertEqual(list(cloud.uploaded), cloud.deleted)
        self.assertIn("Cloudinary is configured correctly", out.getvalue())
        self.assertNotIn("k:s", out.getvalue())

    @override_settings(**CLD)
    def test_reports_an_upload_failure(self):
        with FakeStorage() as cloud:
            cloud.fail_upload = True
            with self.assertRaisesMessage(CommandError, "Upload failed"):
                call_command("check_storage")

    @override_settings(**CLD)
    def test_reports_an_unreadable_public_url_and_still_cleans_up(self):
        with FakeStorage() as cloud, mock.patch("urllib.request.urlopen", side_effect=OSError("403")):
            with self.assertRaisesMessage(CommandError, "URL is not readable"):
                call_command("check_storage")
            self.assertEqual(list(cloud.uploaded), cloud.deleted)

    @override_settings(**CLD)
    def test_reports_a_failed_delete(self):
        with FakeStorage(), mock.patch("urllib.request.urlopen", return_value=_Response()):
            with mock.patch("apps.catalog.storage.delete_image", return_value=False):
                with self.assertRaisesMessage(CommandError, "delete failed"):
                    call_command("check_storage")
