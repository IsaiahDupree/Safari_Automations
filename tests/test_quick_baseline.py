#!/usr/bin/env python3
"""Quick baseline test to identify which features currently pass"""
import json
import urllib.request
import urllib.error
from pathlib import Path

TIKTOK_BASE = "http://localhost:3006"

def test_endpoint(url, method="GET", data=None):
    """Test an endpoint and return (success, status_code)"""
    try:
        req_data = None
        if data:
            req_data = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={"Content-Type": "application/json"},
            method=method
        )
        with urllib.request.urlopen(req, timeout=2) as response:
            return True, response.status
    except urllib.error.HTTPError as e:
        return False, e.code
    except Exception:
        return False, 0

# Run quick tests
print("🧪 Quick Baseline Test\n")

tests = {
    "Health check": (f"{TIKTOK_BASE}/health", "GET", None, 200),
    "Status": (f"{TIKTOK_BASE}/api/tiktok/status", "GET", None, 200),
    "Rate limits": (f"{TIKTOK_BASE}/api/tiktok/rate-limits", "GET", None, 200),
    "Config": (f"{TIKTOK_BASE}/api/tiktok/config", "GET", None, 200),
    "Search cards": (f"{TIKTOK_BASE}/api/tiktok/search-cards", "POST", {"query": "test"}, 200),
    "Video metrics": (f"{TIKTOK_BASE}/api/tiktok/video-metrics", "GET", None, 200),
    "Comments": (f"{TIKTOK_BASE}/api/tiktok/comments", "GET", None, 200),
    "Generate AI comment": (f"{TIKTOK_BASE}/api/tiktok/comments/generate", "POST", {"postContent": "test", "username": "user"}, 200),
    "Verify selectors": (f"{TIKTOK_BASE}/api/tiktok/verify", "POST", {}, 200),
    "Analytics content": (f"{TIKTOK_BASE}/api/tiktok/analytics/content", "GET", None, 200),
    "Activity followers": (f"{TIKTOK_BASE}/api/tiktok/activity/followers", "GET", None, 200),
}

passing = 0
for name, (url, method, data, expected_status) in tests.items():
    success, status = test_endpoint(url, method, data)
    if status == expected_status:
        print(f"✅ {name}")
        passing += 1
    else:
        print(f"❌ {name} (status={status})")

print(f"\n📊 {passing}/{len(tests)} endpoints working")
