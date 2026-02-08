"""
Auto-injection script for the Deluthium Hummingbot connector.

Creates symlinks from the pip-installed ``deluthium_hummingbot`` package
into an existing Hummingbot installation so that the ``deluthium`` exchange
connector is available without modifying Hummingbot source code.

Usage::

    deluthium-hummingbot --hummingbot-dir /path/to/hummingbot
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys
from pathlib import Path

# Files from the connector sub-package that must be symlinked
_CONNECTOR_FILES = [
    "__init__.py",
    "deluthium_constants.py",
    "deluthium_auth.py",
    "deluthium_utils.py",
    "deluthium_web_utils.py",
    "deluthium_order_book.py",
    "deluthium_api_order_book_data_source.py",
    "deluthium_exchange.py",
    "dummy.pxd",
    "dummy.pyx",
]


def _find_connector_source() -> Path:
    """Locate the installed ``deluthium_hummingbot.connector`` package."""
    spec = importlib.util.find_spec("deluthium_hummingbot.connector")
    if spec is None or spec.origin is None:
        print(
            "ERROR: Could not locate the installed deluthium_hummingbot.connector package.\n"
            "       Make sure you have run: pip install deluthium-hummingbot",
            file=sys.stderr,
        )
        sys.exit(1)
    return Path(spec.origin).parent


def _validate_hummingbot(hb_dir: Path) -> Path:
    """Validate that *hb_dir* looks like a Hummingbot installation and return
    the target directory for symlinks."""
    connector_base = hb_dir / "hummingbot" / "connector" / "exchange"
    if not connector_base.is_dir():
        print(
            f"ERROR: {connector_base} does not exist.\n"
            f"       Please provide the root of a valid Hummingbot installation.",
            file=sys.stderr,
        )
        sys.exit(1)
    return connector_base / "deluthium"


def _create_symlinks(source_dir: Path, target_dir: Path) -> None:
    """Create symlinks in *target_dir* pointing at files in *source_dir*."""
    target_dir.mkdir(parents=True, exist_ok=True)

    for filename in _CONNECTOR_FILES:
        src = source_dir / filename
        dst = target_dir / filename

        if not src.exists():
            print(f"  SKIP  {filename} (source not found)")
            continue

        if dst.is_symlink() or dst.exists():
            dst.unlink()

        os.symlink(src, dst)
        print(f"  LINK  {dst} -> {src}")


def main(argv: list[str] | None = None) -> None:
    """Entry-point for the ``deluthium-hummingbot`` CLI command."""
    parser = argparse.ArgumentParser(
        description="Inject the Deluthium connector into a Hummingbot installation.",
    )
    parser.add_argument(
        "--hummingbot-dir",
        type=Path,
        required=True,
        help="Root directory of the Hummingbot installation.",
    )
    args = parser.parse_args(argv)

    hb_dir: Path = args.hummingbot_dir.resolve()
    source_dir = _find_connector_source()
    target_dir = _validate_hummingbot(hb_dir)

    print(f"Source : {source_dir}")
    print(f"Target : {target_dir}")
    print()

    _create_symlinks(source_dir, target_dir)

    print()
    print("Done! Restart Hummingbot to use the 'deluthium' exchange connector.")


if __name__ == "__main__":
    main()
