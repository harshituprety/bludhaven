"""The real storage module with the Cloudinary SDK calls mocked. Nothing here reaches the network."""

from unittest import mock

from django.test import SimpleTestCase, override_settings

from apps.catalog import storage
from apps.catalog.storage import StorageUnavailable

CFG = dict(CLOUDINARY_URL="cloudinary://k:s@demo", CLOUDINARY_ROOT_FOLDER="bludhaven")


class Prop:
    owner_id, pk = 7, 42


@override_settings(**CFG)
class CloudinaryStorageTests(SimpleTestCase):
    def test_public_id_is_server_controlled_and_unguessable(self):
        a, b = storage.new_public_id(Prop), storage.new_public_id(Prop)
        self.assertNotEqual(a, b)
        self.assertRegex(a, r"^bludhaven/hosts/7/properties/42/[A-Za-z0-9_-]{20,}$")

    def test_upload_sends_bytes_without_overwriting_and_returns_key_and_url(self):
        pid = storage.new_public_id(Prop)
        response = {"public_id": pid, "secure_url": f"https://res.cloudinary.com/demo/image/upload/{pid}.png"}
        with mock.patch("cloudinary.uploader.upload", return_value=response) as up:
            out = storage.upload_image(b"bytes", pid)
        self.assertEqual(out, {"key": pid, "url": response["secure_url"]})
        args, kwargs = up.call_args
        self.assertEqual((args[0], kwargs["public_id"], kwargs["overwrite"], kwargs["resource_type"]), (b"bytes", pid, False, "image"))

    def test_refuses_ids_outside_the_server_folder(self):
        with mock.patch("cloudinary.uploader.upload") as up:
            for bad in ("other/x", "../bludhaven/x", ""):
                with self.assertRaises(ValueError):
                    storage.upload_image(b"x", bad)
        up.assert_not_called()

    def test_sdk_failure_is_a_503_and_never_logs_the_secret(self):
        with mock.patch("cloudinary.uploader.upload", side_effect=RuntimeError("boom")):
            with self.assertLogs("apps.catalog.storage", "ERROR") as logs:
                with self.assertRaises(StorageUnavailable):
                    storage.upload_image(b"x", "bludhaven/hosts/1/properties/1/abc")
        self.assertNotIn("cloudinary://", "\n".join(logs.output))

    @override_settings(CLOUDINARY_URL="")
    def test_unconfigured_storage_is_a_503(self):
        self.assertFalse(storage.is_configured())
        with self.assertRaises(StorageUnavailable):
            storage.upload_image(b"x", "bludhaven/hosts/1/properties/1/abc")

    def test_delete_calls_destroy_and_is_best_effort(self):
        with mock.patch("cloudinary.uploader.destroy") as d:
            self.assertTrue(storage.delete_image("bludhaven/hosts/1/properties/1/abc"))
        self.assertEqual(d.call_args.args[0], "bludhaven/hosts/1/properties/1/abc")
        self.assertTrue(storage.delete_image(""))
        with mock.patch("cloudinary.uploader.destroy", side_effect=RuntimeError("down")):
            with self.assertLogs("apps.catalog.storage", "ERROR"):
                self.assertFalse(storage.delete_image("bludhaven/hosts/1/properties/1/abc"))
