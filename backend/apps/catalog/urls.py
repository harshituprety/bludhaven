from rest_framework.routers import SimpleRouter

from .views import AmenityViewSet, DestinationViewSet, FavouriteViewSet, PropertyImageViewSet, PropertyViewSet

router = SimpleRouter()
router.register("destinations", DestinationViewSet, basename="destination")
router.register("amenities", AmenityViewSet, basename="amenity")
router.register("properties", PropertyViewSet, basename="property")
router.register(r"properties/(?P<property_pk>\d+)/images", PropertyImageViewSet, basename="property-image")
router.register("favourites", FavouriteViewSet, basename="favourite")

urlpatterns = router.urls
