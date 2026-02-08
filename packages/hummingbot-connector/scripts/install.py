"""
Convenience wrapper – delegates to the package-internal install script.

This file lives outside the installed package and is provided for
development convenience (``python scripts/install.py …``).
"""

from deluthium_hummingbot.scripts.install import main  # noqa: F401

if __name__ == "__main__":
    main()
