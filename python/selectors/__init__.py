"""
Platform Selectors

Verified CSS selectors and JavaScript helpers for each platform.
Last verified: January 2026
"""

from .instagram_selectors import SELECTORS as INSTAGRAM_SELECTORS
from .instagram_selectors import JS as INSTAGRAM_JS
from .instagram_selectors import URLS as INSTAGRAM_URLS

from .threads_selectors import SELECTORS as THREADS_SELECTORS
from .threads_selectors import JS as THREADS_JS
from .threads_selectors import URLS as THREADS_URLS

from .tiktok_selectors import TikTokSelectors as TIKTOK_SELECTORS

__all__ = [
    'INSTAGRAM_SELECTORS', 'INSTAGRAM_JS', 'INSTAGRAM_URLS',
    'THREADS_SELECTORS', 'THREADS_JS', 'THREADS_URLS',
    'TIKTOK_SELECTORS',
]
