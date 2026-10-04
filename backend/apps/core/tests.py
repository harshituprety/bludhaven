from django.db import IntegrityError, transaction
from django.test import TestCase

from .models import SiteSetting


class SiteSettingTests(TestCase):
    def test_keys_are_unique_and_values_are_json(self):
        SiteSetting.objects.create(key="site.name", value={"title": "Blüdhaven"})
        self.assertEqual(SiteSetting.objects.get(key="site.name").value, {"title": "Blüdhaven"})
        with self.assertRaises(IntegrityError), transaction.atomic():
            SiteSetting.objects.create(key="site.name", value=1)
