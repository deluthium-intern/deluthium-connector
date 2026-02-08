"""
Deluthium authentication helper – JWT Bearer token.

Tries to import the Hummingbot ``AuthBase`` so the class integrates
transparently with the Hummingbot web-assistant pipeline.  When Hummingbot is
not installed (e.g. during unit-testing) a minimal stub is used instead.
"""

from __future__ import annotations

try:
    from hummingbot.core.web_assistant.auth import AuthBase  # type: ignore[import]
except ImportError:

    class AuthBase:  # type: ignore[no-redef]
        """Minimal stub when Hummingbot is not available."""

        async def rest_authenticate(self, request):  # noqa: D401
            return request

        async def ws_authenticate(self, request):  # noqa: D401
            return request


class DeluthiumAuth(AuthBase):
    """Attaches a Bearer token and JSON content-type to every REST request."""

    def __init__(self, api_key: str) -> None:
        super().__init__()
        self._api_key = api_key

    async def rest_authenticate(self, request):  # noqa: D401
        """Add ``Authorization`` and ``Content-Type`` headers."""
        headers = request.headers or {}
        headers["Authorization"] = f"Bearer {self._api_key}"
        headers["Content-Type"] = "application/json"
        request.headers = headers
        return request

    async def ws_authenticate(self, request):  # noqa: D401
        """WebSocket auth is a no-op for Deluthium (REST-only API)."""
        return request
