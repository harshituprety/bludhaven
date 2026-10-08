from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from .models import Role, User


class UserSerializer(serializers.ModelSerializer):
    is_email_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "full_name", "role", "is_email_verified", "date_joined"]
        read_only_fields = fields


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Login with email + password. Adds the role to the token and returns the user."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role  # convenience for clients only; the server always re-reads the DB role
        token["email"] = user.email
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data["user"] = UserSerializer(self.user).data
        return data


class RegisterSerializer(serializers.Serializer):
    """Public sign-up. Always creates an END_USER.

    Only ``email``, ``full_name`` and ``password`` are accepted. Any other key (``role``,
    ``is_staff``, ``is_superuser``, ...) is rejected with a 400 rather than silently ignored,
    so an attempt to pick a role is visible and never creates anything.
    """

    ALLOWED_FIELDS = {"email", "full_name", "password"}

    email = serializers.EmailField(max_length=User._meta.get_field("email").max_length)
    full_name = serializers.CharField(max_length=User._meta.get_field("full_name").max_length)
    password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})

    def to_internal_value(self, data):
        if isinstance(data, dict):
            extra = sorted(set(data) - self.ALLOWED_FIELDS)
            if extra:
                raise serializers.ValidationError({key: "This field is not accepted." for key in extra})
        return super().to_internal_value(data)

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        # Passing an unsaved user lets the similarity validator compare the password to the email.
        candidate = User(email=attrs["email"], full_name=attrs["full_name"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)})
        return attrs

    def create(self, validated_data):
        try:
            return User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                full_name=validated_data["full_name"].strip(),
                role=Role.END_USER,
            )
        except IntegrityError:  # two sign-ups with the same email racing past validate_email
            raise serializers.ValidationError({"email": "A user with this email already exists."})


class HostRegisterSerializer(RegisterSerializer):
    """Host onboarding sign-up. Same fields and rules as the guest sign-up; the server, never the client, assigns HOST."""

    def create(self, validated_data):
        try:
            return User.objects.create_user(
                email=validated_data["email"],
                password=validated_data["password"],
                full_name=validated_data["full_name"].strip(),
                role=Role.HOST,
            )
        except IntegrityError:
            raise serializers.ValidationError({"email": "A user with this email already exists."})


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=1000, trim_whitespace=True)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=User._meta.get_field("email").max_length)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=100)
    token = serializers.CharField(max_length=200)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=User._meta.get_field("email").max_length)


class ProfileUpdateSerializer(serializers.Serializer):
    """What a person may change about themselves: their display name, nothing else.

    Any other key (``role``, ``email``, ``is_staff``, ``is_active``, ...) is rejected with a 400 so an attempt is
    visible instead of silently ignored. Changing the email address would need a re-verification flow; it is not offered.
    """

    ALLOWED_FIELDS = {"full_name"}

    full_name = serializers.CharField(max_length=User._meta.get_field("full_name").max_length)

    def to_internal_value(self, data):
        if isinstance(data, dict):
            extra = sorted(set(data) - self.ALLOWED_FIELDS)
            if extra:
                raise serializers.ValidationError({key: "This field cannot be changed here." for key in extra})
        return super().to_internal_value(data)

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("This field may not be blank.")
        return value

    def update(self, instance, validated_data):
        if "full_name" in validated_data:
            instance.full_name = validated_data["full_name"]
            instance.save(update_fields=["full_name"])
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})
    new_password = serializers.CharField(write_only=True, trim_whitespace=False, style={"input_type": "password"})

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("The current password is not correct.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": "The new password must be different from the current one."})
        try:
            validate_password(attrs["new_password"], user=user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"new_password": list(exc.messages)})
        return attrs
