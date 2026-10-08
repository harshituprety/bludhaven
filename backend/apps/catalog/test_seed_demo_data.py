"""seed_demo_data: sample properties, and the 16 prototype cover photos served from /demo-photos/."""

from io import StringIO
from pathlib import Path

from django.core.management import call_command
from django.test import TestCase, override_settings

from apps.catalog.management.commands.seed_demo_data import DEMO_PHOTO_DIR
from apps.catalog.models import Property, PropertyImage

# Taken from the prototype's own data (data/properties.js cover key -> assets/images/catalog.js file), not guessed.
EXPECTED = {
    "Pinecrest Mountain Retreat": "pinecrest-mountain-cabin.webp",
    "Palm Courtyard Villa": "palm-courtyard-pool-villa.webp",
    "Tea Estate Cottage": "tea-estate-hills.webp",
    "Lakeside Haveli Suite": "lakeside-haveli-twilight.webp",
    "Dune Camp Tent House": "dune-camp-desert.webp",
    "Harbour Loft Apartment": "harbour-loft-skyline.webp",
    "Riverbend Bamboo Hut": "riverbend-green-river.webp",
    "Sunset Cliff Villa": "sunset-cliff-palm-villa.webp",
    "Snowline A-Frame": "snowline-cabin-snow.webp",
    "Lutyens Courtyard Apartment": "delhi-courtyard-apartment.webp",
    "Taj View Heritage Suite": "agra-heritage-suite.webp",
    "Colonial Mansion Flat": "kolkata-colonial-flat.webp",
    "Marina Beach Studio": "chennai-beach-studio.webp",
    "Garden City Loft": "bengaluru-garden-loft.webp",
    "Golden Temple Lane Home": "amritsar-heritage-home.webp",
    "Juhu Sea-Facing Apartment": "juhu-sea-apartment.webp",
}


@override_settings(DEBUG=True)
class SeedDemoPhotosTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command("seed_demo_data", stdout=StringIO())

    def test_exactly_the_sixteen_prototype_photos_are_attached(self):
        self.assertEqual(Property.objects.count(), 36)
        self.assertEqual(PropertyImage.objects.count(), 16)
        got = {i.property.title: i.url for i in PropertyImage.objects.select_related("property")}
        self.assertEqual(got, {title: f"/demo-photos/{name}" for title, name in EXPECTED.items()})

    def test_the_other_twenty_properties_have_no_photo(self):
        self.assertEqual(Property.objects.filter(images__isnull=True).count(), 20)
        self.assertFalse(Property.objects.filter(title__in=EXPECTED, images__isnull=True).exists())

    def test_demo_photos_are_covers_with_no_storage_key(self):
        for image in PropertyImage.objects.all():
            self.assertEqual((image.position, image.storage_key), (0, ""))  # blank key: never deleted from Cloudinary
            self.assertEqual(image.format, "webp")
            self.assertTrue(image.alt_text)
            self.assertTrue(image.width and image.height and image.size_bytes)

    def test_every_referenced_file_exists_in_the_frontend_public_folder(self):
        for image in PropertyImage.objects.all():
            self.assertTrue((Path(DEMO_PHOTO_DIR) / image.url.rsplit("/", 1)[1]).is_file(), image.url)

    def test_the_eight_homepage_properties_have_their_photos(self):
        """The home page shows positions 1-5 and 7-9 of the oldest-first list (see frontend Home.jsx)."""
        ordered = list(Property.objects.order_by("created_at", "id"))
        for position in (1, 2, 3, 4, 5, 7, 8, 9):
            prop = ordered[position - 1]
            self.assertEqual(prop.images.count(), 1, prop.title)
            self.assertEqual(prop.images.get().url, f"/demo-photos/{EXPECTED[prop.title]}")

    def test_the_api_returns_the_cover_url_and_hides_the_storage_key(self):
        r = self.client.get("/api/properties/?ordering=created_at&page_size=9")
        by_title = {p["title"]: p for p in r.json()["results"]}
        self.assertEqual(by_title["Pinecrest Mountain Retreat"]["cover_image"], "/demo-photos/pinecrest-mountain-cabin.webp")
        self.assertEqual(by_title["Tea Estate Cottage"]["cover_image"], "/demo-photos/tea-estate-hills.webp")
        detail = self.client.get(f"/api/properties/{by_title['Pinecrest Mountain Retreat']['id']}/").json()
        self.assertNotIn("storage_key", detail["images"][0])
        self.assertEqual(detail["images"][0]["url"], "/demo-photos/pinecrest-mountain-cabin.webp")

    def test_running_it_again_adds_nothing(self):
        call_command("seed_demo_data", stdout=StringIO())
        self.assertEqual((Property.objects.count(), PropertyImage.objects.count()), (36, 16))

    def test_it_never_overwrites_a_property_that_already_has_photos(self):
        prop = Property.objects.get(title="Pinecrest Mountain Retreat")
        prop.images.all().delete()
        PropertyImage.objects.create(property=prop, url="https://res.cloudinary.test/x.jpg", storage_key="k", position=0)
        call_command("seed_demo_data", stdout=StringIO())
        self.assertEqual([i.url for i in prop.images.all()], ["https://res.cloudinary.test/x.jpg"])

    @override_settings(DEBUG=False)
    def test_it_still_refuses_to_run_outside_development(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command("seed_demo_data", stdout=StringIO())
