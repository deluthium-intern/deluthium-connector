"""
Utility functions and configuration model for the Deluthium connector.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field

from .deluthium_constants import (
    NATIVE_TOKEN_ADDRESS,
    SUPPORTED_CHAINS,
    WRAPPED_TOKENS,
)

# ---------------------------------------------------------------------------
# Fee constants
# ---------------------------------------------------------------------------
MAKER_FEE = Decimal("0")
TAKER_FEE = Decimal("0.001")

# ---------------------------------------------------------------------------
# Connector flags
# ---------------------------------------------------------------------------
CENTRALIZED = False

# ---------------------------------------------------------------------------
# Wei helpers
# ---------------------------------------------------------------------------


def to_wei(amount: Decimal | float | str, decimals: int = 18) -> int:
    """Convert a human-readable token amount to its smallest unit (wei)."""
    return int(Decimal(str(amount)) * Decimal(10) ** decimals)


def from_wei(wei_str: int | str, decimals: int = 18) -> Decimal:
    """Convert a wei (smallest unit) value back to a human-readable amount."""
    return Decimal(str(wei_str)) / Decimal(10) ** decimals


# ---------------------------------------------------------------------------
# Symbol conversion
# ---------------------------------------------------------------------------


def convert_symbol_to_hummingbot(symbol: str) -> str:
    """Convert a Deluthium-style symbol (e.g. ``BNB/USDT``) to Hummingbot
    format (``BNB-USDT``)."""
    return symbol.replace("/", "-")


def convert_symbol_to_deluthium(symbol: str) -> str:
    """Convert a Hummingbot-style symbol (e.g. ``BNB-USDT``) to Deluthium
    format (``BNB/USDT``)."""
    return symbol.replace("-", "/")


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def validate_chain_id(chain_id: int) -> bool:
    """Return ``True`` if the *chain_id* is supported by Deluthium."""
    return chain_id in SUPPORTED_CHAINS


def is_native_token(address: str) -> bool:
    """Return ``True`` when *address* represents the native (gas) token."""
    return address.lower() == NATIVE_TOKEN_ADDRESS.lower()


def get_wrapped_token(chain_id: int) -> str:
    """Return the wrapped native token contract address for *chain_id*.

    Raises ``ValueError`` if the chain is not supported.
    """
    if chain_id not in WRAPPED_TOKENS:
        raise ValueError(
            f"Chain ID {chain_id} is not supported. "
            f"Supported chains: {list(WRAPPED_TOKENS.keys())}"
        )
    return WRAPPED_TOKENS[chain_id]


# ---------------------------------------------------------------------------
# Configuration model
# ---------------------------------------------------------------------------


class DeluthiumConfigMap(BaseModel):
    """Pydantic configuration model for the Deluthium connector."""

    api_key: str = Field(..., description="Deluthium API key (required)")
    chain_id: int = Field(default=56, description="Target chain ID")
    wallet_address: Optional[str] = Field(
        default=None, description="On-chain wallet address"
    )


KEYS = DeluthiumConfigMap.model_construct()
