"""Entry point for: python -m market_research.facebook"""
import sys
import os

# Add parent dirs so imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from market_research.facebook_scraper import main

main()
