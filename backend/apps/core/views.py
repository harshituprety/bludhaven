from rest_framework.decorators import api_view
from rest_framework.response import Response


@api_view(["GET"])
def health(request):
    """Lightweight liveness probe used by the frontend's backend-status indicator."""
    return Response({"status": "ok"})
