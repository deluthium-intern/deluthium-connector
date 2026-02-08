"""
REST / web utilities for the Deluthium connector.

Tries to import Hummingbot's web-assistant infrastructure; falls back to
lightweight stubs so the module can be imported outside of Hummingbot.
"""

from __future__ import annotations

import time

from .deluthium_constants import BASE_URL

# ---------------------------------------------------------------------------
# Conditional Hummingbot imports
# ---------------------------------------------------------------------------
try:
    from hummingbot.core.web_assistant.connections.data_types import (  # type: ignore[import]
        RESTRequest,
    )
    from hummingbot.core.web_assistant.rest_pre_processors import (  # type: ignore[import]
        RESTPreProcessorBase,
    )
    from hummingbot.core.web_assistant.web_assistants_factory import (  # type: ignore[import]
        WebAssistantsFactory,
    )
    from hummingbot.core.api_throttler.async_throttler import (  # type: ignore[import]
        AsyncThrottler,
    )
except ImportError:
    RESTRequest = None  # type: ignore[assignment,misc]
    RESTPreProcessorBase = None  # type: ignore[assignment,misc]
    WebAssistantsFactory = None  # type: ignore[assignment,misc]
    AsyncThrottler = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# URL builders
# ---------------------------------------------------------------------------


def rest_url(path: str) -> str:
    """Build a full Deluthium REST URL for the given *path*."""
    return f"{BASE_URL}{path}"


def public_rest_url(path: str) -> str:
    """Build a public (unauthenticated) REST URL."""
    return rest_url(path)


def private_rest_url(path: str) -> str:
    """Build a private (authenticated) REST URL."""
    return rest_url(path)


# ---------------------------------------------------------------------------
# Server time
# ---------------------------------------------------------------------------


def get_current_server_time() -> float:
    """Return the current server time as a UNIX timestamp.

    Deluthium does not expose a dedicated server-time endpoint, so we
    simply return the local system time.
    """
    return time.time()
