"""Super Admin user management: ``/api/users/``.

Accounts are created by invitation (no password is ever chosen or seen by the admin). There is no hard delete:
users own properties, bookings and reviews, so an account is deactivated instead, which also ends its sessions.
Super Admins themselves are managed on the server (``manage.py createsuperuser``), not through this API.
"""

from django.db import transaction
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.core.exceptions import Conflict
from django_filters import rest_framework as filters

from . import emails
from .models import Role, User
from .permissions import IsSuperAdmin

ASSIGNABLE_ROLES = [Role.HOST, Role.END_USER]


class AdminUserSerializer(serializers.ModelSerializer):
    is_email_verified = serializers.BooleanField(read_only=True)
    invitation_pending = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_active", "is_email_verified", "invitation_pending", "date_joined"]
        read_only_fields = ["id", "is_email_verified", "invitation_pending", "date_joined"]

    def get_invitation_pending(self, obj):
        return not obj.has_usable_password()


class AdminUserCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=User._meta.get_field("email").max_length)
    full_name = serializers.CharField(max_length=User._meta.get_field("full_name").max_length)
    role = serializers.ChoiceField(choices=ASSIGNABLE_ROLES)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value


class AdminUserUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=User._meta.get_field("full_name").max_length, required=False)
    role = serializers.ChoiceField(choices=ASSIGNABLE_ROLES, required=False)
    is_active = serializers.BooleanField(required=False)


class UserAdminFilter(filters.FilterSet):
    role = filters.ChoiceFilter(choices=Role.choices)
    is_active = filters.BooleanFilter()
    email_verified = filters.BooleanFilter(field_name="email_verified_at", lookup_expr="isnull", exclude=True)

    class Meta:
        model = User
        fields = ["role", "is_active"]


def _end_sessions(user):
    BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=t) for t in OutstandingToken.objects.filter(user=user)], ignore_conflicts=True
    )


class UserAdminViewSet(
    mixins.CreateModelMixin, mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    permission_classes = [IsAuthenticated, IsSuperAdmin]
    queryset = User.objects.all()
    filterset_class = UserAdminFilter
    search_fields = ["email", "full_name"]
    ordering_fields = ["email", "full_name", "date_joined", "role"]
    ordering = ["-date_joined", "-id"]

    def get_serializer_class(self):
        return AdminUserCreateSerializer if self.action == "create" else AdminUserSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = User.objects.create_user(password=None, **serializer.validated_data)
        sent = emails.send_invitation_email(user)
        body = AdminUserSerializer(user).data
        body["invitation_sent"] = sent
        return Response(body, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        serializer = AdminUserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        with transaction.atomic():
            user = User.objects.select_for_update().get(pk=self.get_object().pk)
            self._guard(request, user, d)
            if "full_name" in d:
                user.full_name = d["full_name"]
            ended = False
            if "role" in d and d["role"] != user.role:
                user.role = d["role"]
                ended = True  # the old tokens carry the old role
            if "is_active" in d and d["is_active"] != user.is_active:
                user.is_active = d["is_active"]
                ended = ended or not user.is_active
            user.save()
            if ended:
                _end_sessions(user)
        return Response(AdminUserSerializer(user).data)

    def _guard(self, request, user, d):
        touching_access = ("role" in d and d["role"] != user.role) or ("is_active" in d and d["is_active"] != user.is_active)
        if touching_access and user.role == Role.SUPER_ADMIN:
            raise Conflict("Super Admin accounts are managed on the server, not through the API.", code="protected_account")
        if touching_access and user.pk == request.user.pk:
            raise Conflict("You cannot change your own role or active status.", code="self_change")
        if "role" in d and d["role"] != user.role:
            from apps.billing.models import Subscription
            from apps.bookings.models import Booking

            if user.role == Role.HOST:
                if user.properties.exists():
                    raise Conflict("This Host still owns properties. Move or delete them first.", code="in_use")
                if Subscription.objects.filter(user=user, status__in=[*Subscription.ENTITLING, Subscription.Status.SUSPENDED]).exists():
                    raise Conflict("This Host has an active subscription. Cancel it first.", code="in_use")
            if d["role"] == Role.HOST and Booking.objects.holding().filter(guest=user).exists():
                raise Conflict("This user has confirmed bookings, or bookings awaiting payment, as a guest.", code="in_use")

    @action(detail=True, methods=["post"], url_path="send-password-reset")
    def send_password_reset(self, request, pk=None):
        """Email the user a fresh set-password link (also re-sends an expired invitation)."""
        user = self.get_object()
        if not user.is_active:
            raise Conflict("This account is deactivated.", code="inactive_user")
        return Response({"sent": emails.send_password_reset_email(user)})
