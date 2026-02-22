#!/usr/bin/env python3
"""
Runner script for Facebook market research.
Handles PYTHONPATH so selectors/ dir doesn't shadow stdlib.

Usage (run from project root):
  python3 python/market_research/run_facebook.py search "automation tools" --max-posts 50
  python3 python/market_research/run_facebook.py batch --keywords "automation,saas tools"
  python3 python/market_research/run_facebook.py rank "automation tools" --top 20
  python3 python/market_research/run_facebook.py report "automation tools"
  python3 python/market_research/run_facebook.py status
"""
import sys
import os

# CRITICAL: Remove the python/ dir from sys.path first so the local
# selectors/ package doesn't shadow Python's stdlib selectors module.
# Then re-add it AFTER stdlib is loaded.
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove:
    sys.path.remove(p)

# Now import stdlib modules that need 'selectors'
import asyncio       # noqa: E402
import subprocess    # noqa: E402

# Now add python/ dir back for our project imports
sys.path.insert(0, _python_dir)

from market_research.facebook_scraper import main  # noqa: E402

if __name__ == "__main__":
    main()
