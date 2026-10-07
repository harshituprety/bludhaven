"""Custom user with an explicit, database-backed role.

The database is the authority for roles: the frontend's own role constants are
only a display concern and are never trusted.
"""

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
    HOST = "HOST", "Host"
    END_USER = "END_USER", "End User"


class UserManager(BaseUserManager):
    """Email is the login identifier. Super Admins are only created here (see create_superuser)."""

    use_in_migrations = True

    def _build(self, email, password, **extra):
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=self.normalize_email(email), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def normalize_email(self, email):
        return (email or "").strip().lower()

    def create_user(self, email, password=None, **extra):
        # Public creation can never produce staff or superusers, whatever is passed in.
        extra["is_staff"] = False
        extra["is_superuser"] = False
        if extra.get("role", Role.END_USER) == Role.SUPER_ADMIN:
            raise ValueError("Super Admins are created with create_superuser / manage.py createsuperuser.")
        extra.setdefault("role", Role.END_USER)
        return self._build(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        # Created by an operator on the server, never by the public API, so the address is trusted.
        extra.update(role=Role.SUPER_ADMIN, is_staff=True, is_superuser=True)
        extra.setdefault("email_verified_at", timezone.now())
        return self._build(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(max_length=254, unique=True)
    full_name = models.CharField(max_length=150)
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.END_USER, db_index=True)
    is_active = models.BooleanField(default=True)
    # Django admin access. Only Super Admins may be staff (enforced by a constraint below).
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)
    # Set only by the server when the owner of the address opens the emailed link (verify-email
    # endpoint). Never writable through the API.
    email_verified_at = models.DateTimeField(null=True, blank=True, editable=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["email"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role="SUPER_ADMIN") | (models.Q(is_staff=False) & models.Q(is_superuser=False)),
                name="user_only_super_admin_can_be_staff",
            ),
        ]

    def __str__(self):
        return self.email

    @property
    def is_email_verified(self):
        return self.email_verified_at is not None

    @property
    def is_super_admin(self):
        return self.role == Role.SUPER_ADMIN

    @property
    def is_host(self):
        return self.role == Role.HOST

    @property
    def is_end_user(self):
        return self.role == Role.END_USER
