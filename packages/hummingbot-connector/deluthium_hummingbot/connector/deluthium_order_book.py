"""
Custom OrderBook for the Deluthium connector.

Overrides three class methods to translate Deluthium API payloads into
Hummingbot ``OrderBookMessage`` objects.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conditional Hummingbot imports
# ---------------------------------------------------------------------------
try:
    from hummingbot.core.data_type.order_book import OrderBook  # type: ignore[import]
    from hummingbot.core.data_type.order_book_message import (  # type: ignore[import]
        OrderBookMessage,
        OrderBookMessageType,
    )

    _HB_AVAILABLE = True
except ImportError:

    class OrderBook:  # type: ignore[no-redef]
        """Stub when Hummingbot is not installed."""

    class OrderBookMessage:  # type: ignore[no-redef]
        """Stub."""

    class OrderBookMessageType:  # type: ignore[no-redef]
        SNAPSHOT = "snapshot"
        DIFF = "diff"
        TRADE = "trade"

    _HB_AVAILABLE = False


class DeluthiumOrderBook(OrderBook):
    """Deluthium-specific order book that converts API responses into
    ``OrderBookMessage`` instances understood by Hummingbot."""

    @classmethod
    def snapshot_message_from_exchange(
        cls,
        msg: Dict[str, Any],
        timestamp: float,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> OrderBookMessage:
        """Create a full-snapshot ``OrderBookMessage`` from an exchange payload."""
        if metadata:
            msg = {**msg, **metadata}  # MED-15: Don't mutate the caller's dict

        content = {
            "trading_pair": msg.get("trading_pair", ""),
            "update_id": msg.get("update_id", int(timestamp)),
            "bids": msg.get("bids", []),
            "asks": msg.get("asks", []),
        }

        if _HB_AVAILABLE:
            return OrderBookMessage(
                message_type=OrderBookMessageType.SNAPSHOT,
                content=content,
                timestamp=timestamp,
            )
        # Standalone fallback – return a plain dict wrapped for tests
        return content  # type: ignore[return-value]

    @classmethod
    def diff_message_from_exchange(
        cls,
        msg: Dict[str, Any],
        timestamp: float,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> OrderBookMessage:
        """Create a diff (incremental) ``OrderBookMessage``."""
        if metadata:
            msg = {**msg, **metadata}  # MED-15: Don't mutate the caller's dict

        content = {
            "trading_pair": msg.get("trading_pair", ""),
            "update_id": msg.get("update_id", int(timestamp)),
            "bids": msg.get("bids", []),
            "asks": msg.get("asks", []),
        }

        if _HB_AVAILABLE:
            return OrderBookMessage(
                message_type=OrderBookMessageType.DIFF,
                content=content,
                timestamp=timestamp,
            )
        return content  # type: ignore[return-value]

    @classmethod
    def trade_message_from_exchange(
        cls,
        msg: Dict[str, Any],
        timestamp: float,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> OrderBookMessage:
        """Create a trade ``OrderBookMessage``."""
        if metadata:
            msg = {**msg, **metadata}  # MED-15: Don't mutate the caller's dict

        content = {
            "trading_pair": msg.get("trading_pair", ""),
            "trade_id": msg.get("trade_id", int(timestamp)),
            "update_id": msg.get("update_id", int(timestamp)),
            "price": msg.get("price", "0"),
            "amount": msg.get("amount", "0"),
            "trade_type": msg.get("trade_type", "buy"),
        }

        if _HB_AVAILABLE:
            return OrderBookMessage(
                message_type=OrderBookMessageType.TRADE,
                content=content,
                timestamp=timestamp,
            )
        return content  # type: ignore[return-value]
