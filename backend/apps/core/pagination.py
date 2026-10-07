from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """``?page=2&page_size=24``. Response: ``{count, next, previous, results}``."""

    page_size = 12  # a view can use its own subclass to change this
    page_size_query_param = "page_size"
    max_page_size = 100
