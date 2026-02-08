"""
Main Deluthium exchange connector for Hummingbot.

Deluthium is an RFQ / intent-based DEX aggregator.  Only **market orders**
are supported – the connector obtains a firm quote and returns calldata for
on-chain execution.
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
    DEFAULT_CHAIN_ID,
    EXCHANGE_NAME,
    LISTING_PAIRS_PATH,
    NUMERIC_ERROR_CODES,
    QUOTE_FIRM_PATH,
    STRING_ERROR_CODES,
)
from .deluthium_auth import DeluthiumAuth
from .deluthium_utils import (
    CENTRALIZED,
    MAKER_FEE,
    TAKER_FEE,
    convert_symbol_to_deluthium,
    convert_symbol_to_hummingbot,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Conditional Hummingbot import
# ---------------------------------------------------------------------------
try:
    from hummingbot.connector.exchange_py_base import ExchangePyBase  # type: ignore[import]

    _HB_AVAILABLE = True
except ImportError:

    class ExchangePyBase:  # type: ignore[no-redef]
        """Minimal stub so the module can be imported outside Hummingbot."""

        def __init__(self, *args, **kwargs) -> None:  # noqa: D401
            pass

    _HB_AVAILABLE = False


class DeluthiumExchange(ExchangePyBase):
    """Hummingbot exchange connector for Deluthium (RFQ-based, market orders only)."""

    # Class-level metadata ------------------------------------------------
    name: str = EXCHANGE_NAME
    is_centralized: bool = CENTRALIZED
    maker_fee = MAKER_FEE
    taker_fee = TAKER_FEE

    def __init__(
        self,
        api_key: str,
        chain_id: int = DEFAULT_CHAIN_ID,
        wallet_address: str = "",
        trading_pairs: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        self._api_key = api_key
        self._chain_id = chain_id
        self._wallet_address = wallet_address
        self._trading_pairs = trading_pairs or []
        self._auth = DeluthiumAuth(api_key)

        # Chain-qualified pair cache:  "56:BNB-USDT" -> pair metadata
        self._pair_cache: Dict[str, Dict[str, Any]] = {}

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def authenticator(self) -> DeluthiumAuth:
        return self._auth

    @property
    def trading_pairs(self) -> List[str]:
        return self._trading_pairs

    # ------------------------------------------------------------------
    # Pair cache (chain-qualified)
    # ------------------------------------------------------------------

    def _pair_cache_key(self, trading_pair: str) -> str:
        return f"{self._chain_id}:{trading_pair}"

    async def _populate_pair_cache(self) -> None:
        """Fetch available pairs from Deluthium and populate the cache."""
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
                    for pair_info in data.get("pairs", []):
                        symbol = pair_info.get("symbol", "")
                        hb_symbol = convert_symbol_to_hummingbot(symbol)
                        key = self._pair_cache_key(hb_symbol)
                        self._pair_cache[key] = pair_info
        except Exception:
            logger.exception("Failed to populate Deluthium pair cache")

    def _get_cached_pair(self, trading_pair: str) -> Optional[Dict[str, Any]]:
        key = self._pair_cache_key(trading_pair)
        return self._pair_cache.get(key)

    # ------------------------------------------------------------------
    # Order placement (market orders only)
    # ------------------------------------------------------------------

    async def _place_order(
        self,
        trading_pair: str,
        amount: Decimal,
        is_buy: bool,
        order_type: str = "market",
        price: Optional[Decimal] = None,
    ) -> Dict[str, Any]:
        """Request a firm quote from Deluthium via ``POST /v1/quote/firm``
        and return the resulting calldata for on-chain execution.

        Only market orders are supported.
        """
        url = f"{BASE_URL}{QUOTE_FIRM_PATH}"
        deluthium_symbol = convert_symbol_to_deluthium(trading_pair)
        base, quote = deluthium_symbol.split("/")

        payload: Dict[str, Any] = {
            "baseToken": base,
            "quoteToken": quote,
            "side": "buy" if is_buy else "sell",
            "amount": str(amount),
            "chainId": self._chain_id,
        }
        if self._wallet_address:
            payload["walletAddress"] = self._wallet_address

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    data = await resp.json()
                    self._handle_response_errors(data)
                    logger.info(
                        "Firm quote received for %s %s %s – tx hash: %s",
                        "BUY" if is_buy else "SELL",
                        amount,
                        trading_pair,
                        data.get("txHash", "N/A"),
                    )
                    return data
        except aiohttp.ClientError:
            logger.exception("HTTP error placing order on Deluthium")
            raise

    # ------------------------------------------------------------------
    # Cancel (not supported for RFQ)
    # ------------------------------------------------------------------

    async def _place_cancel(self, order_id: str, trading_pair: str) -> bool:
        """Cancel is not supported – Deluthium quotes are atomic on-chain
        transactions.  Logs a warning and returns ``False``."""
        logger.warning(
            "Order cancellation is not supported on Deluthium (order_id=%s, pair=%s). "
            "Quotes are executed atomically on-chain.",
            order_id,
            trading_pair,
        )
        return False

    # ------------------------------------------------------------------
    # Balances (placeholder)
    # ------------------------------------------------------------------

    async def _update_balances(self) -> None:
        """Balance tracking is not yet implemented for Deluthium.

        On-chain balances should be queried via the wallet provider.
        """
        logger.warning(
            "Balance updates are not implemented for the Deluthium connector. "
            "On-chain balances must be queried externally."
        )

    # ------------------------------------------------------------------
    # Error handling (dual error codes)
    # ------------------------------------------------------------------

    @staticmethod
    def _handle_response_errors(data: Dict[str, Any]) -> None:
        """Inspect a Deluthium API response for error codes and raise on failure.

        Deluthium may return errors as a string ``errorCode`` field **or** a
        numeric ``code`` field.
        """
        # String error codes
        error_code = data.get("errorCode")
        if error_code and error_code in STRING_ERROR_CODES:
            description = STRING_ERROR_CODES[error_code]
            raise RuntimeError(
                f"Deluthium API error [{error_code}]: {description}"
            )

        # Numeric error codes
        numeric_code = data.get("code")
        if numeric_code and int(numeric_code) in NUMERIC_ERROR_CODES:
            description = NUMERIC_ERROR_CODES[int(numeric_code)]
            raise RuntimeError(
                f"Deluthium API error [code {numeric_code}]: {description}"
            )
