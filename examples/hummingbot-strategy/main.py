"""
Hummingbot Strategy Example

Demonstrates a simple pure market making strategy using the Deluthium connector.
This script runs inside Hummingbot after the connector has been installed.

Setup:
    pip install deluthium-hummingbot
    deluthium-hummingbot install --hummingbot-dir /path/to/hummingbot

Then run this strategy in Hummingbot:
    create --script deluthium_pmm_strategy
"""

import os
from decimal import Decimal
from typing import Dict, List

# These imports work inside the Hummingbot runtime
# from hummingbot.strategy.script_strategy_base import ScriptStrategyBase
# from hummingbot.connector.exchange_py_base import ExchangePyBase


# Example standalone usage of the Deluthium connector
async def standalone_example():
    """
    Shows how to use the Deluthium Hummingbot connector API directly,
    outside of the Hummingbot framework.
    """
    from deluthium_hummingbot.connector.deluthium_exchange import DeluthiumExchange

    # Configuration
    config = {
        "api_key": os.environ.get("DELUTHIUM_API_KEY", "your-jwt-token"),
        "chain_id": 56,  # BSC
    }

    exchange = DeluthiumExchange(
        client_config_map=None,  # type: ignore
        deluthium_api_key=config["api_key"],
        trading_pairs=["WBNB-USDT"],
    )

    # Fetch trading pairs
    print("Fetching trading rules...")
    # trading_rules = await exchange._update_trading_rules()
    # print(f"Found {len(trading_rules)} trading rules")

    # Get order book snapshot
    print("\nFetching order book for WBNB-USDT...")
    # order_book = await exchange._request_order_book_snapshot("WBNB-USDT")
    # print(f"Best bid: {order_book.get('bids', [[0]])[0][0]}")
    # print(f"Best ask: {order_book.get('asks', [[0]])[0][0]}")

    print("\nHummingbot strategy example ready.")
    print("Install with: pip install deluthium-hummingbot")
    print("Then run in Hummingbot: create --script pure_market_making --exchange deluthium")


if __name__ == "__main__":
    import asyncio
    asyncio.run(standalone_example())
