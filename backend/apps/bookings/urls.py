from rest_framework.routers import SimpleRouter

from .views import BookingViewSet, ReviewViewSet

router = SimpleRouter()
router.register("bookings", BookingViewSet, basename="booking")
router.register("reviews", ReviewViewSet, basename="review")

urlpatterns = router.urls
