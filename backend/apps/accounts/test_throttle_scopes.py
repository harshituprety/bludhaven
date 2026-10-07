"""Login, refresh and logout have separate rate-limit buckets: restoring a session never uses up login attempts."""

from unittest.mock import patch

from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.testing import PASSWORD, ApiTestCase, make_user
from apps.core.throttling import AuthRateThrottle

from .models import Role

LOGIN, REFRESH, BLACKLIST = "/api/auth/token/", "/api/auth/token/refresh/", "/api/auth/token/blacklist/"


class ThrottleScopeTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.user = make_user(Role.END_USER, email="guest@example.com")

    def login(self, password=PASSWORD):
        return self.client.post(LOGIN, {"email": "guest@example.com", "password": password}, format="json")

    def refresh(self):
        self.set_refresh_cookie(RefreshToken.for_user(self.user))
        return self.client.post(REFRESH)

    def test_default_rates_are_configured_per_scope(self):
        rates = AuthRateThrottle.THROTTLE_RATES
        for scope in ("auth", "refresh", "logout", "register", "password_reset", "resend_verification", "password_change"):
            self.assertIn(scope, rates)
        self.assertNotEqual(rates["refresh"], rates["auth"])  # its own limit, not an alias

    def test_login_throttling_still_works(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"auth": "3/min"}):
            for _ in range(3):
                self.assertEqual(self.login("wrong-password-1").status_code, 401)
            self.assertEqual(self.login().status_code, 429)

    def test_refresh_has_its_own_limit(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"refresh": "3/min", "auth": "100/min"}):
            for _ in range(3):
                self.assertEqual(self.refresh().status_code, 200)
            r = self.refresh()
            self.assertEqual((r.status_code, self.error(r)["code"]), (429, "throttled"))
            self.assertIn("retry_after", self.error(r)["details"])

    def test_heavy_refresh_traffic_does_not_consume_the_login_bucket(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"refresh": "50/min", "auth": "3/min"}):
            for _ in range(10):  # far more than the login limit
                self.assertEqual(self.refresh().status_code, 200)
            for _ in range(3):  # all three login attempts still available
                self.assertEqual(self.login().status_code, 200)
            self.assertEqual(self.login().status_code, 429)  # and login is still strictly limited

    def test_failed_logins_do_not_consume_the_refresh_bucket(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"refresh": "2/min", "auth": "50/min"}):
            for _ in range(10):
                self.login("wrong-password-1")
            self.assertEqual(self.refresh().status_code, 200)
            self.assertEqual(self.refresh().status_code, 200)
            self.assertEqual(self.refresh().status_code, 429)

    def test_a_throttled_refresh_keeps_the_cookie_so_the_session_survives(self):
        with patch.dict(AuthRateThrottle.THROTTLE_RATES, {"refresh": "1/min"}):
            first = self.refresh()
            self.assertEqual(first.status_code, 200)
            token = first.cookies["bludhaven_refresh"].value
            r = self.client.post(REFRESH)  # same cookie jar, now over the limit
            self.assertEqual(r.status_code, 429)
            self.assertNotIn("bludhaven_refresh", r.cookies)  # the 429 neither clears nor rotates the cookie
            self.assertTrue(token)
