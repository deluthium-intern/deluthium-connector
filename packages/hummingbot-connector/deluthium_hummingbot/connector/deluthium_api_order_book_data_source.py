"""
Polling-based order-book data source for the Deluthium connector.

Deluthium is an RFQ / intent-based DEX aggregator – there is no
traditional WebSocket order-book feed.  This data source polls indicative
quotes every 30 seconds and synthesises a two-level order book with a
configurable spread (default 0.1 %).
"""

from __future__ import annotations

import asyncio
import logging
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional

import aiohttp

from .deluthium_constants import (
    BASE_URL,
    QUOTE_INDICATIVE_PATH,
    LISTING_PAIRS_PATH,
)
from .deluthium_order_book import DeluthiumOrderBook

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conditional Hummingbot imports
# ---------------------------------------------------------------------------
try:
    from hummingbot.core.data_type.order_book_tracker_data_source import (  # type: ignore[import]
        OrderBookTrackerDataSource,
    )
    from hummingbot.core.data_type.order_book_message import (  # type: ignore[import]
        OrderBookMessage,
    )

    _HB_AVAILABLE = True
except ImportError:

    class OrderBookTrackerDataSource:  # type: ignore[no-redef]
        """Stub base class."""

        def __init__(self, trading_pairs: list[str] | None = None) -> None:
            self._trading_pairs = trading_pairs or []

    class OrderBookMessage:  # type: ignore[no-redef]
        """Stub."""

    _HB_AVAILABLE = False


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
POLL_INTERVAL: float = 30.0  # seconds
# Synthetic spread as a ratio (0.001 = 0.1% = 10 bps). Named _RATIO for clarity (L-11).
SYNTHETIC_SPREAD_RATIO: Decimal = Decimal("0.001")  # 0.1 % (10 bps)


class DeluthiumAPIOrderBookDataSource(OrderBookTrackerDataSource):
    """Polls the Deluthium indicative-quote API to build a synthetic order book."""

    def __init__(
        self,
        trading_pairs: List[str],
        api_key: str,
        chain_id: int = 56,
    ) -> None:
        super().__init__(trading_pairs=trading_pairs)
        self._trading_pairs = trading_pairs
        self._api_key = api_key
        self._chain_id = chain_id

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    async def fetch_trading_pairs(self) -> List[str]:
        """Return the list of trading pairs available on Deluthium."""
        url = f"{BASE_URL}{LISTING_PAIRS_PATH}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    pairs: list[str] = [
                        p.get("symbol", "") for p in data.get("pairs", [])
                    ]
                    return pairs
        except Exception:
            logger.exception("Failed to fetch trading pairs from Deluthium")
            return []

    async def get_last_traded_prices(
        self, trading_pairs: List[str]
    ) -> Dict[str, float]:
        """Return the last mid-price for each requested pair via indicative quotes."""
        prices: Dict[str, float] = {}
        for pair in trading_pairs:
            price = await self._get_indicative_price(pair)
            if price is not None:
                prices[pair] = price
        return prices

    # ------------------------------------------------------------------
    # Order-book snapshot
    # ------------------------------------------------------------------

    async def get_new_order_book(self, trading_pair: str) -> DeluthiumOrderBook:
        """Create a fresh :class:`DeluthiumOrderBook` with a synthetic snapshot."""
        snapshot = await self._request_order_book_snapshot(trading_pair)
        order_book = DeluthiumOrderBook()
        timestamp = time.time()
        msg = DeluthiumOrderBook.snapshot_message_from_exchange(
            snapshot, timestamp, metadata={"trading_pair": trading_pair}
        )
        if _HB_AVAILABLE:
            order_book.apply_snapshot(msg.bids, msg.asks, msg.update_id)
        return order_book

    async def _request_order_book_snapshot(
        self, trading_pair: str
    ) -> Dict[str, Any]:
        """Build a synthetic two-level order book around the indicative price."""
        mid = await self._get_indicative_price(trading_pair)
        if mid is None:
            return {"bids": [], "asks": [], "trading_pair": trading_pair}

        mid_d = Decimal(str(mid))
        half_spread = mid_d * SYNTHETIC_SPREAD_RATIO / 2
        best_bid = float(mid_d - half_spread)
        best_ask = float(mid_d + half_spread)

        # Synthetic depth – two levels each
        return {
            "trading_pair": trading_pair,
            "bids": [
                [best_bid, 1.0],
                [float(mid_d - half_spread * 2), 2.0],
            ],
            "asks": [
                [best_ask, 1.0],
                [float(mid_d + half_spread * 2), 2.0],
            ],
        }

    # ------------------------------------------------------------------
    # Polling loop
    # ------------------------------------------------------------------

    async def listen_for_order_book_snapshots(
        self, ev_loop: asyncio.AbstractEventLoop, output: asyncio.Queue
    ) -> None:
        """Continuously poll indicative quotes and push snapshots."""
        while True:
            try:
                for pair in self._trading_pairs:
                    snapshot = await self._request_order_book_snapshot(pair)
                    timestamp = time.time()
                    msg = DeluthiumOrderBook.snapshot_message_from_exchange(
                        snapshot,
                        timestamp,
                        metadata={"trading_pair": pair},
                    )
                    output.put_nowait(msg)
                await asyncio.sleep(POLL_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Error polling Deluthium order-book snapshots")
                await asyncio.sleep(POLL_INTERVAL)

    async def listen_for_order_book_diffs(
        self, ev_loop: asyncio.AbstractEventLoop, output: asyncio.Queue
    ) -> None:
        """No diff stream – Deluthium is polling-only."""
        await asyncio.sleep(float("inf"))

    async def listen_for_trades(
        self, ev_loop: asyncio.AbstractEventLoop, output: asyncio.Queue
    ) -> None:
        """No real-time trade stream available."""
        await asyncio.sleep(float("inf"))

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _get_indicative_price(
        self, trading_pair: str
    ) -> Optional[float]:
        """Fetch an indicative mid-price for *trading_pair*."""
        url = f"{BASE_URL}{QUOTE_INDICATIVE_PATH}"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        base, quote = trading_pair.split("-") if "-" in trading_pair else trading_pair.split("/")
        params = {
            "baseToken": base,
            "quoteToken": quote,
            "chainId": self._chain_id,
        }
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers, params=params) as resp:
                    resp.raise_for_status()
                    data = await resp.json()
                    price = data.get("price")
                    return float(price) if price is not None else None
        except Exception:
            logger.warning("Failed to get indicative price for %s", trading_pair)
            return None
