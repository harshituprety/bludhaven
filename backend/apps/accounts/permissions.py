"""RBAC building blocks for DRF views.

Role checks (``has_permission``) decide whether a role may use an endpoint at all.
``IsOwnerOrSuperAdmin`` (``has_object_permission``) adds ownership-based authorization:
a Host may only touch objects they own; a Super Admin may touch anything. This is
ownership, not tenant isolation: there is a single shared dataset.

Usage::

    class PropertyViewSet(ModelViewSet):
        permission_classes = [IsAuthenticated, IsHostOrSuperAdmin, IsOwnerOrSuperAdmin]
        owner_field = "owner"          # attribute path to the owning user (dotted paths work)
"""

from operator import attrgetter

from rest_framework.permissions import BasePermission

from .models import Role


class HasRole(BasePermission):
    """Allow authenticated, active users whose role is in ``roles``."""

    roles: tuple = ()
    message = "You do not have permission to perform this action."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_active and user.role in self.roles)


class IsSuperAdmin(HasRole):
    roles = (Role.SUPER_ADMIN,)


class IsHost(HasRole):
    roles = (Role.HOST,)


class IsEndUser(HasRole):
    roles = (Role.END_USER,)


class IsHostOrSuperAdmin(HasRole):
    roles = (Role.HOST, Role.SUPER_ADMIN)


class IsOwnerOrSuperAdmin(BasePermission):
    """Object-level: the requesting user owns the object, or is a Super Admin.

    The view names the ownership attribute with ``owner_field`` (default ``"owner"``).
    Only runs where the view calls ``get_object()`` / ``check_object_permissions()``.
    """

    message = "You can only access your own resources."

    def has_object_permission(self, request, view, obj):
        user = request.user
        if not (user and user.is_authenticated and user.is_active):
            return False
        if user.role == Role.SUPER_ADMIN:
            return True
        try:
            owner = attrgetter(getattr(view, "owner_field", "owner"))(obj)
        except AttributeError:
            return False
        return owner is not None and owner.pk == user.pk
