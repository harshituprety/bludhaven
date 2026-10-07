"""Start Django in a fresh process with production-style environments and check what it does.

Subprocesses are used because settings are read once, at import time.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase

BACKEND = Path(__file__).resolve().parents[2]
GOOD_KEY = "k8#Zq!v2Lm9$Xt4&Rb7^Nw1*Hc6(Pd3)Sy5_Fj0+Ea-Gu"  # random-looking, 46+ chars
PROBE = (
    "import os, json; os.environ['DJANGO_SETTINGS_MODULE']='config.settings';"
    "from django.conf import settings as s;"
    "print(json.dumps({k: getattr(s, k) for k in ["
    "'DEBUG','ALLOWED_HOSTS','CORS_ALLOWED_ORIGINS','CORS_ALLOW_CREDENTIALS','SECURE_SSL_REDIRECT','REFRESH_COOKIE_SECURE','REFRESH_COOKIE_SAMESITE','CSRF_COOKIE_SECURE','CSRF_COOKIE_HTTPONLY','CSRF_TRUSTED_ORIGINS',"
    "'SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE','SECURE_HSTS_SECONDS','SECRET_KEY']}))"
)


def run_settings(**env):
    full = {**os.environ, **env}
    return subprocess.run([sys.executable, "-c", PROBE], cwd=BACKEND, env=full, capture_output=True, text=True, timeout=60)


PROD = {
    "DJANGO_DEBUG": "False",
    "DJANGO_SECRET_KEY": GOOD_KEY,
    "DJANGO_ALLOWED_HOSTS": "api.example.com",
    "CORS_ALLOWED_ORIGINS": "https://www.example.com",
    "FRONTEND_URL": "https://www.example.com",
    "EMAIL_HOST": "smtp.example.com",
}


class ProductionSettingsTests(SimpleTestCase):
    def test_refuses_to_start_without_a_secret_key_when_debug_is_off(self):
        r = run_settings(**{**PROD, "DJANGO_SECRET_KEY": ""})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("DJANGO_SECRET_KEY", r.stderr)

    def test_refuses_the_placeholder_and_dev_keys_when_debug_is_off(self):
        for key in ("change-me", "dev-only-insecure-key-change-me", "some-insecure-key-" + "x" * 40):
            with self.subTest(key=key):
                r = run_settings(**{**PROD, "DJANGO_SECRET_KEY": key})
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("DJANGO_SECRET_KEY", r.stderr)

    def test_refuses_to_start_without_allowed_hosts_when_debug_is_off(self):
        r = run_settings(**{**PROD, "DJANGO_ALLOWED_HOSTS": ""})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("DJANGO_ALLOWED_HOSTS", r.stderr)

    def test_debug_defaults_to_off_when_unset(self):
        r = run_settings(**{**PROD, "DJANGO_DEBUG": ""})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(json.loads(r.stdout)["DEBUG"])

    def test_production_environment_turns_on_https_protections(self):
        r = run_settings(**PROD)
        self.assertEqual(r.returncode, 0, r.stderr)
        s = json.loads(r.stdout)
        self.assertFalse(s["DEBUG"])
        self.assertEqual(s["ALLOWED_HOSTS"], ["api.example.com"])
        self.assertEqual(s["CORS_ALLOWED_ORIGINS"], ["https://www.example.com"])
        self.assertTrue(s["CORS_ALLOW_CREDENTIALS"])  # needed for the refresh cookie; safe because origins are explicit
        self.assertTrue(s["REFRESH_COOKIE_SECURE"])
        self.assertEqual(s["REFRESH_COOKIE_SAMESITE"], "Lax")
        self.assertTrue(s["CSRF_COOKIE_HTTPONLY"])
        self.assertEqual(s["CSRF_TRUSTED_ORIGINS"], ["https://www.example.com"])  # defaults to the frontend origin
        self.assertTrue(s["SECURE_SSL_REDIRECT"])
        self.assertTrue(s["SESSION_COOKIE_SECURE"])
        self.assertTrue(s["CSRF_COOKIE_SECURE"])
        self.assertGreater(s["SECURE_HSTS_SECONDS"], 0)

    def test_production_needs_an_https_frontend_url_and_smtp_host(self):
        for key, bad in (("FRONTEND_URL", ""), ("FRONTEND_URL", "http://www.example.com"), ("EMAIL_HOST", "")):
            with self.subTest(key=key, value=bad):
                r = run_settings(**{**PROD, key: bad})
                self.assertNotEqual(r.returncode, 0)
                self.assertIn(key, r.stderr)

    def test_the_refresh_cookie_cannot_be_made_insecure_in_production(self):
        for env in ({"REFRESH_COOKIE_SECURE": "False"}, {"REFRESH_COOKIE_SAMESITE": "banana"}):
            with self.subTest(env=env):
                self.assertNotEqual(run_settings(**{**PROD, **env}).returncode, 0)
        ok = run_settings(**{**PROD, "REFRESH_COOKIE_SAMESITE": "None"})
        self.assertEqual(ok.returncode, 0, ok.stderr)  # cross-site deployments are possible, but only with Secure
        self.assertNotEqual(run_settings(DJANGO_DEBUG="True", REFRESH_COOKIE_SECURE="False", REFRESH_COOKIE_SAMESITE="None").returncode, 0)

    def test_wildcard_or_malformed_cors_origins_are_refused(self):
        for bad in ("*", "https://*.example.com", "www.example.com"):
            with self.subTest(bad=bad):
                r = run_settings(**{**PROD, "CORS_ALLOWED_ORIGINS": bad})
                self.assertNotEqual(r.returncode, 0)
                self.assertIn("CORS_ALLOWED_ORIGINS", r.stderr)

    def test_production_has_no_default_cors_origins(self):
        r = run_settings(**{**PROD, "CORS_ALLOWED_ORIGINS": ""})
        self.assertEqual(json.loads(r.stdout)["CORS_ALLOWED_ORIGINS"], [])

    def test_development_keeps_working_without_extra_setup(self):
        r = run_settings(DJANGO_DEBUG="True", DJANGO_SECRET_KEY="", DJANGO_ALLOWED_HOSTS="", CORS_ALLOWED_ORIGINS="")
        self.assertEqual(r.returncode, 0, r.stderr)
        s = json.loads(r.stdout)
        self.assertTrue(s["DEBUG"])
        self.assertIn("localhost", s["ALLOWED_HOSTS"])
        self.assertIn("http://localhost:5173", s["CORS_ALLOWED_ORIGINS"])
        self.assertTrue(s["SECRET_KEY"].startswith("dev-only"))
        self.assertFalse(s["REFRESH_COOKIE_SECURE"])  # plain-http localhost
        self.assertEqual(s["CSRF_TRUSTED_ORIGINS"], s["CORS_ALLOWED_ORIGINS"])
        self.assertFalse(s["SECURE_SSL_REDIRECT"])
        self.assertFalse(s["SESSION_COOKIE_SECURE"])
        self.assertEqual(s["SECURE_HSTS_SECONDS"], 0)
