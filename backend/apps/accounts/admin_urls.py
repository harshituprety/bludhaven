from rest_framework.routers import SimpleRouter

from .admin_users import UserAdminViewSet

router = SimpleRouter()
router.register("users", UserAdminViewSet, basename="user")
urlpatterns = router.urls
