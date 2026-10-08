"""One error shape for the whole API.

Every error response is::

    {"error": {"code": "<machine_code>", "message": "<human text>", "details": <optional>}}

``details`` carries field errors for validation failures (``{"email": ["..."]}``) and
``{"retry_after": seconds}`` for throttling. Unexpected exceptions are logged with a
traceback and answered with a generic 500, so internals never reach the client.
"""

import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.db.models import ProtectedError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import APIException, Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.views import set_rollback

logger = logging.getLogger(__name__)


class Conflict(APIException):
    """409: the request is well formed but clashes with the current state (dates taken, wrong status, in use).

    Raise with a specific code: ``Conflict("Those dates are taken.", code="dates_unavailable")``.
    """

    status_code = status.HTTP_409_CONFLICT
    default_detail = "The request conflicts with the current state of the resource."
    default_code = "conflict"


class PlanLimitReached(APIException):
    """403 ``plan_limit_reached``: the Host's current plan does not allow this. ``details`` says which limit, so a
    client can show an upgrade prompt without parsing the message."""

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = "Your plan does not allow this."
    default_code = "plan_limit_reached"

    def __init__(self, detail, details):
        super().__init__(detail)
        self.details = details


def _error_body(code, message, details=None):
    error = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return {"error": error}


def _code_for(exc):
    """A stable machine code: the exception's own code string, else its class default."""
    # DRF's handler turns these two Django exceptions into API errors, but ``exc`` is still the original.
    if isinstance(exc, Http404):
        return "not_found"
    if isinstance(exc, DjangoPermissionDenied):
        return "permission_denied"
    codes = exc.get_codes()
    if isinstance(codes, str):
        return codes
    # SimpleJWT puts its code under "detail" (e.g. "token_not_valid", "no_active_account").
    if isinstance(codes, dict) and isinstance(codes.get("detail"), str):
        return codes["detail"]
    return exc.default_code


def api_exception_handler(exc, context):
    if isinstance(exc, ProtectedError):
        # Deleting something other rows still point at (a property with bookings, a destination with properties).
        exc = Conflict("This item is still referenced by other records and cannot be deleted.", code="in_use")

    response = drf_exception_handler(exc, context)  # also maps Http404 / PermissionDenied

    if response is None:
        view = context.get("view")
        logger.error("Unhandled exception in %s", type(view).__name__, exc_info=exc)
        set_rollback()
        return Response(_error_body("server_error", "A server error occurred."), status=500)

    if isinstance(exc, ValidationError):
        body = _error_body("validation_error", "Invalid input.", response.data)
    else:
        data = response.data
        detail = data.get("detail") if isinstance(data, dict) else None
        message = str(detail) if detail is not None else "The request could not be completed."
        details = {"retry_after": exc.wait} if isinstance(exc, Throttled) and exc.wait is not None else getattr(exc, "details", None)
        code = _code_for(exc) if isinstance(exc, (APIException, Http404, DjangoPermissionDenied)) else "error"
        body = _error_body(code, message, details)

    response.data = body
    return response
