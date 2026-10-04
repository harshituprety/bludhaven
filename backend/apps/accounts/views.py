from rest_framework.generics import RetrieveAPIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import EmailTokenObtainPairSerializer, UserSerializer


class EmailTokenObtainPairView(TokenObtainPairView):
    """POST {email, password} -> {access, refresh, user}."""

    serializer_class = EmailTokenObtainPairSerializer


class MeView(RetrieveAPIView):
    """GET the signed-in user (also a handy token check). Uses the default IsAuthenticated."""

    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user
