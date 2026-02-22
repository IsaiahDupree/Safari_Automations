#!/usr/bin/env python3
"""
Runner for Instagram market research.

Usage (from project root):
  python3 python/market_research/run_instagram.py search automation --type hashtag
  python3 python/market_research/run_instagram.py batch --keywords "automation,saas,nocode"
  python3 python/market_research/run_instagram.py report automation
  python3 python/market_research/run_instagram.py status
"""
import sys, os
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove: sys.path.remove(p)
import asyncio, subprocess
sys.path.insert(0, _python_dir)

from market_research.instagram_scraper import main
if __name__ == "__main__":
    main()
