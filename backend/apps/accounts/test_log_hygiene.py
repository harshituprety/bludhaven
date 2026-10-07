"""No password, access token or refresh token is ever written to the logs, whatever the endpoint does."""

import logging

from django.conf import settings

from apps.core.testing import PASSWORD, ApiTestCase, make_user

from .models import Role


class LogHygieneTests(ApiTestCase):
    def test_credentials_and_tokens_never_reach_the_logs(self):
        make_user(Role.END_USER, email="guest@example.com")
        wrong, new = "wrong-password-1", "brand-New-Str0ng-pass-4"
        records = []

        class Collect(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage() + " " + str(record.args) + " " + (record.exc_text or ""))

        handler = Collect(level=logging.DEBUG)
        root = logging.getLogger()
        old_level = root.level
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        for name in ("apps", "django"):
            logging.getLogger(name).addHandler(handler)
        try:
            self.client.post("/api/auth/token/", {"email": "guest@example.com", "password": wrong}, format="json")
            login = self.client.post("/api/auth/token/", {"email": "guest@example.com", "password": PASSWORD}, format="json")
            access = login.json()["access"]
            refresh = login.cookies[settings.REFRESH_COOKIE_NAME].value
            self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {access}")
            self.client.post("/api/auth/token/refresh/")
            self.client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": new}, format="json", HTTP_AUTHORIZATION=f"Bearer {access}")
            self.client.post("/api/auth/token/blacklist/")
            self.client.post("/api/auth/password-reset/confirm/", {"uid": "x", "token": "reset-token-abc", "new_password": new}, format="json")
        finally:
            root.removeHandler(handler)
            root.setLevel(old_level)
            for name in ("apps", "django"):
                logging.getLogger(name).removeHandler(handler)
        text = "\n".join(records)
        self.assertTrue(records)  # something was logged, so the check is meaningful
        for secret in (PASSWORD, wrong, new, access, refresh, "reset-token-abc"):
            self.assertNotIn(secret, text)
