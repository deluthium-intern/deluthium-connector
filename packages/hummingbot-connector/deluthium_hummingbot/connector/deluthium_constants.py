"""
Constants for the Deluthium connector.
"""

# ---------------------------------------------------------------------------
# Base URL
# ---------------------------------------------------------------------------
BASE_URL = "https://rfq-api.deluthium.ai"

# ---------------------------------------------------------------------------
# Chain configuration
# ---------------------------------------------------------------------------
SUPPORTED_CHAINS: dict[int, str] = {
    56: "BSC",
    8453: "Base",
    1: "Ethereum",
}

DEFAULT_CHAIN_ID: int = 56

WRAPPED_TOKENS: dict[int, str] = {
    56: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    8453: "0x4200000000000000000000000000000000000006",
    1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
}

NATIVE_TOKEN_ADDRESS: str = "0x0000000000000000000000000000000000000000"

# ---------------------------------------------------------------------------
# API endpoint paths
# ---------------------------------------------------------------------------
LISTING_PAIRS_PATH = "/v1/listing/pairs"
QUOTE_INDICATIVE_PATH = "/v1/quote/indicative"
QUOTE_FIRM_PATH = "/v1/quote/firm"
ORDER_STATUS_PATH = "/v1/order/status"
ORDER_HISTORY_PATH = "/v1/order/history"
BALANCES_PATH = "/v1/balances"

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
RATE_LIMIT: dict[str, int] = {
    "requests": 300,
    "period": 60,
}

# ---------------------------------------------------------------------------
# Error codes – string-based
# ---------------------------------------------------------------------------
STRING_ERROR_CODES: dict[str, str] = {
    "INVALID_API_KEY": "The API key provided is invalid or expired.",
    "INSUFFICIENT_LIQUIDITY": "Not enough liquidity to fill the requested amount.",
    "PAIR_NOT_SUPPORTED": "The requested trading pair is not supported.",
    "QUOTE_EXPIRED": "The firm quote has expired. Request a new one.",
    "RATE_LIMIT_EXCEEDED": "Too many requests – slow down.",
    "CHAIN_NOT_SUPPORTED": "The specified chain ID is not supported.",
    "INVALID_AMOUNT": "The amount provided is invalid (zero or negative).",
    "INTERNAL_ERROR": "An unexpected server-side error occurred.",
}

# ---------------------------------------------------------------------------
# Error codes – numeric
# ---------------------------------------------------------------------------
NUMERIC_ERROR_CODES: dict[int, str] = {
    1001: "Invalid API key",
    1002: "Insufficient liquidity",
    1003: "Pair not supported",
    1004: "Quote expired",
    1005: "Rate limit exceeded",
    1006: "Chain not supported",
    1007: "Invalid amount",
    5000: "Internal server error",
}

# ---------------------------------------------------------------------------
# Order states
# ---------------------------------------------------------------------------
ORDER_STATES: dict[str, str] = {
    "pending": "PENDING",
    "open": "OPEN",
    "filled": "FILLED",
    "partially_filled": "PARTIALLY_FILLED",
    "cancelled": "CANCELLED",
    "expired": "EXPIRED",
    "failed": "FAILED",
}

# ---------------------------------------------------------------------------
# Trading defaults
# ---------------------------------------------------------------------------
DEFAULT_SLIPPAGE: float = 0.5
DEFAULT_EXPIRY: int = 60  # seconds

EXCHANGE_NAME: str = "deluthium"
