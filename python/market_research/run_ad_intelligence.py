#!/usr/bin/env python3
"""
Runner for ad intelligence pipeline.

Usage (from project root):
  python3 python/market_research/run_ad_intelligence.py products
  python3 python/market_research/run_ad_intelligence.py brief "automation tools" --product mediaposter
  python3 python/market_research/run_ad_intelligence.py pipeline --keywords "automation,saas" --product mediaposter --skip-scrape
  python3 python/market_research/run_ad_intelligence.py briefs
"""
import sys, os
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove: sys.path.remove(p)
import asyncio, subprocess
sys.path.insert(0, _python_dir)

from market_research.ad_intelligence import main
if __name__ == "__main__":
    main()
