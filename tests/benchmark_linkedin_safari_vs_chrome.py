"""
benchmark_linkedin_safari_vs_chrome.py
=======================================
Compares LinkedIn Safari (:3105) vs Chrome CDP (:9333 via linkedin-chrome-agent)
for the same operations. Measures: latency, result count, result quality.

Operations tested:
  1. Health check          — both services reachable?
  2. Hashtag scrape        — #aiautomation, limit=10
  3. People search         — "saas founder ai automation", limit=5
  4. Profile extract       — a known LinkedIn profile (murphybrantley)

Run: python3 tests/benchmark_linkedin_safari_vs_chrome.py
Flags:
  --tag TAG        hashtag to scrape (default: aiautomation)
  --limit N        max results (default: 10)
  --no-live        skip live browser tests (health + scoring only)
"""

import json
import sys
import time
import urllib.request
import urllib.error
import subprocess
import os
from typing import Any, Optional

# ─── Config ────────────────────────────────────────────────────────────────────

SAFARI_BASE = "http://localhost:3105"
CHROME_CDP  = "http://localhost:9333"
SAFARI_AUTH = "Bearer test-token-12345"

TAG   = "aiautomation"
LIMIT = 10
LIVE  = "--no-live" not in sys.argv

for i, arg in enumerate(sys.argv):
    if arg == "--tag" and i + 1 < len(sys.argv):
        TAG = sys.argv[i + 1]
    if arg == "--limit" and i + 1 < len(sys.argv):
        LIMIT = int(sys.argv[i + 1])

# ─── HTTP helpers ──────────────────────────────────────────────────────────────

def get(url: str, auth: Optional[str] = None, timeout: float = 60.0) -> tuple[Any, float, Optional[str]]:
    """Returns (body, elapsed_ms, error)."""
    headers: dict = {}
    if auth:
        headers["Authorization"] = auth
    req = urllib.request.Request(url, headers=headers)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode())
            return body, (time.perf_counter() - t0) * 1000, None
    except Exception as e:
        return None, (time.perf_counter() - t0) * 1000, str(e)


def post(url: str, payload: dict, auth: Optional[str] = None, timeout: float = 120.0) -> tuple[Any, float, Optional[str]]:
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if auth:
        headers["Authorization"] = auth
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.loads(r.read().decode())
            return body, (time.perf_counter() - t0) * 1000, None
    except Exception as e:
        return None, (time.perf_counter() - t0) * 1000, str(e)


def cdp_alive() -> bool:
    try:
        with urllib.request.urlopen(f"{CHROME_CDP}/json/version", timeout=3) as r:
            return True
    except Exception:
        return False


# ─── Scoring helpers ───────────────────────────────────────────────────────────

ICP_SIGNALS = ["saas", "founder", "cto", "ceo", "ai", "automation", "startup",
               "buildinpublic", "indie", "mrr", "arr", "b2b", "bootstrapped"]

def icp_score_profile(profile: dict) -> int:
    """Simple ICP quality score 0-100 for a scraped profile."""
    text = " ".join([
        profile.get("headline", ""),
        profile.get("name", ""),
        profile.get("currentPosition", ""),
        profile.get("company", ""),
        profile.get("role", ""),
    ]).lower()
    hits = sum(1 for kw in ICP_SIGNALS if kw in text)
    return min(100, hits * 12)


# ─── Benchmark cases ───────────────────────────────────────────────────────────

class BenchResult:
    def __init__(self, name: str, backend: str):
        self.name = name
        self.backend = backend
        self.latency_ms: float = 0
        self.result_count: int = 0
        self.avg_icp_score: float = 0
        self.error: Optional[str] = None
        self.raw: Any = None

    def ok(self) -> bool:
        return self.error is None

    def summary(self) -> str:
        if self.error:
            return f"  ✗ {self.latency_ms:.0f}ms  ERR: {self.error[:60]}"
        return f"  ✓ {self.latency_ms:.0f}ms  results={self.result_count}  avg_icp={self.avg_icp_score:.0f}"


def bench_safari_health() -> BenchResult:
    r = BenchResult("Health check", "Safari :3105")
    body, ms, err = get(f"{SAFARI_BASE}/health", auth=SAFARI_AUTH)
    r.latency_ms = ms
    if err:
        r.error = err
    else:
        r.result_count = 1 if body.get("status") in ("ok", "running") else 0
        r.error = None if r.result_count else f"Unexpected status: {body.get('status')}"
    return r


def bench_chrome_health() -> BenchResult:
    r = BenchResult("Health check", "Chrome CDP :9333")
    t0 = time.perf_counter()
    alive = cdp_alive()
    r.latency_ms = (time.perf_counter() - t0) * 1000
    r.result_count = 1 if alive else 0
    r.error = None if alive else "CDP not responding"
    return r


def bench_safari_hashtag(tag: str = TAG, limit: int = LIMIT) -> BenchResult:
    r = BenchResult(f"Hashtag scrape #{tag}", "Safari :3105")
    body, ms, err = get(
        f"{SAFARI_BASE}/api/linkedin/discover/hashtag?tag={tag}&limit={limit}",
        auth=SAFARI_AUTH, timeout=90
    )
    r.latency_ms = ms
    if err:
        r.error = err
        return r
    profiles = body.get("profiles") or body.get("authors") or body.get("results") or []
    r.result_count = len(profiles)
    r.raw = profiles
    if profiles:
        scores = [icp_score_profile(p) for p in profiles]
        r.avg_icp_score = sum(scores) / len(scores)
    return r


def bench_chrome_hashtag(tag: str = TAG, limit: int = LIMIT) -> BenchResult:
    """Queue a scrape_hashtag task directly into the Chrome agent via CLI."""
    r = BenchResult(f"Hashtag scrape #{tag}", "Chrome CDP")
    harness_dir = "/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard"
    payload = json.dumps({"tag": tag, "limit": limit})
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            ["node", "harness/linkedin-chrome-agent.js", "--queue", "scrape_hashtag", payload],
            cwd=harness_dir, capture_output=True, text=True, timeout=120
        )
        r.latency_ms = (time.perf_counter() - t0) * 1000
        if proc.returncode != 0:
            r.error = proc.stderr[:200] or proc.stdout[-200:]
            return r
        # Parse output: agent logs creators found
        lines = proc.stdout + proc.stderr
        creators = []
        for line in lines.splitlines():
            if '"authorUrl"' in line or '"profileUrl"' in line:
                try:
                    creators.append(json.loads(line))
                except Exception:
                    pass
        # fallback: count "queued" or "synced" mentions
        if not creators:
            import re
            m = re.search(r"(\d+) creators", lines)
            r.result_count = int(m.group(1)) if m else 0
        else:
            r.result_count = len(creators)
            r.raw = creators
            scores = [icp_score_profile(c) for c in creators]
            r.avg_icp_score = sum(scores) / len(scores) if scores else 0
    except subprocess.TimeoutExpired:
        r.error = "Timeout (120s)"
        r.latency_ms = 120_000
    except Exception as e:
        r.error = str(e)
        r.latency_ms = (time.perf_counter() - t0) * 1000
    return r


def bench_safari_search(keywords: str = "saas founder ai automation", limit: int = 5) -> BenchResult:
    r = BenchResult(f"People search: {keywords[:30]}", "Safari :3105")
    body, ms, err = post(
        f"{SAFARI_BASE}/api/linkedin/search/people",
        {"keywords": keywords.split(",")[0], "maxResults": limit},
        auth=SAFARI_AUTH, timeout=120
    )
    r.latency_ms = ms
    if err:
        r.error = err
        return r
    profiles = body.get("profiles") or body.get("results") or []
    r.result_count = len(profiles)
    r.raw = profiles
    if profiles:
        scores = [icp_score_profile(p) for p in profiles]
        r.avg_icp_score = sum(scores) / len(scores)
    return r


def bench_chrome_search(keywords: str = "saas founder ai automation", limit: int = 5) -> BenchResult:
    r = BenchResult(f"People search: {keywords[:30]}", "Chrome CDP")
    harness_dir = "/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard"
    payload = json.dumps({"keywords": keywords, "limit": limit})
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            ["node", "harness/linkedin-chrome-agent.js", "--queue", "search_people", payload],
            cwd=harness_dir, capture_output=True, text=True, timeout=120
        )
        r.latency_ms = (time.perf_counter() - t0) * 1000
        if proc.returncode != 0:
            r.error = proc.stderr[:200] or proc.stdout[-200:]
        else:
            import re
            m = re.search(r"(\d+) prospect", proc.stdout + proc.stderr)
            r.result_count = int(m.group(1)) if m else 0
    except subprocess.TimeoutExpired:
        r.error = "Timeout (120s)"
        r.latency_ms = 120_000
    except Exception as e:
        r.error = str(e)
        r.latency_ms = (time.perf_counter() - t0) * 1000
    return r


def bench_safari_profile() -> BenchResult:
    r = BenchResult("Profile extract (murphybrantley)", "Safari :3105")
    body, ms, err = get(
        f"{SAFARI_BASE}/api/linkedin/profile/murphybrantley",
        auth=SAFARI_AUTH, timeout=30
    )
    r.latency_ms = ms
    if err:
        r.error = err
        return r
    required_fields = ["name", "headline"]
    missing = [f for f in required_fields if not body.get(f)]
    r.result_count = 1 if not missing else 0
    r.avg_icp_score = icp_score_profile(body)
    r.raw = {k: body.get(k) for k in ["name", "headline", "connectionDegree", "canConnect", "canMessage"]}
    r.error = f"Missing fields: {missing}" if missing else None
    return r


# ─── Reporter ──────────────────────────────────────────────────────────────────

def print_comparison(label: str, safari: BenchResult, chrome: BenchResult):
    print(f"\n{'─' * 60}")
    print(f"  {label}")
    print(f"{'─' * 60}")
    print(f"  Safari  {safari.summary()}")
    print(f"  Chrome  {chrome.summary()}")
    if safari.ok() and chrome.ok():
        faster = "Safari" if safari.latency_ms < chrome.latency_ms else "Chrome"
        speedup = max(safari.latency_ms, chrome.latency_ms) / max(1, min(safari.latency_ms, chrome.latency_ms))
        print(f"  → {faster} is {speedup:.1f}x faster")
        if safari.result_count and chrome.result_count:
            more = "Safari" if safari.result_count > chrome.result_count else "Chrome"
            print(f"  → {more} returned more results ({safari.result_count} vs {chrome.result_count})")
        if safari.avg_icp_score and chrome.avg_icp_score:
            better = "Safari" if safari.avg_icp_score > chrome.avg_icp_score else "Chrome"
            print(f"  → {better} had higher avg ICP quality ({safari.avg_icp_score:.0f} vs {chrome.avg_icp_score:.0f})")


# ─── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  LinkedIn Benchmark: Safari :3105 vs Chrome CDP :9333")
    print(f"  Hashtag: #{TAG}  |  Limit: {LIMIT}  |  Live: {LIVE}")
    print("=" * 60)

    # ── 1. Health ──────────────────────────────────────────────
    print("\n[1/4] Health checks")
    s_health = bench_safari_health()
    c_health = bench_chrome_health()
    print_comparison("Health", s_health, c_health)

    safari_live = s_health.ok() and LIVE
    chrome_live  = c_health.ok() and LIVE

    if not safari_live:
        print(f"\n  ⚠  Safari :3105 not available — skipping live Safari tests")
    if not chrome_live:
        print(f"\n  ⚠  Chrome CDP not available — skipping Chrome tests")
        print(f"     Start Chrome: bash harness/start-chrome-debug.sh start")
        print(f"     Then log into LinkedIn in the Chrome window")

    # ── 2. Hashtag scrape ───────────────────────────────────────
    print("\n[2/4] Hashtag scrape")
    if safari_live:
        s_hash = bench_safari_hashtag()
    else:
        s_hash = BenchResult(f"Hashtag #{TAG}", "Safari :3105")
        s_hash.error = "Service not available"

    if chrome_live:
        c_hash = bench_chrome_hashtag()
    else:
        c_hash = BenchResult(f"Hashtag #{TAG}", "Chrome CDP")
        c_hash.error = "CDP not available"

    print_comparison(f"Hashtag scrape #{TAG} (limit={LIMIT})", s_hash, c_hash)

    # ── 3. People search ────────────────────────────────────────
    print("\n[3/4] People search")
    if safari_live:
        s_search = bench_safari_search()
    else:
        s_search = BenchResult("People search", "Safari :3105")
        s_search.error = "Service not available"

    if chrome_live:
        c_search = bench_chrome_search()
    else:
        c_search = BenchResult("People search", "Chrome CDP")
        c_search.error = "CDP not available"

    print_comparison("People search: saas founder ai automation (limit=5)", s_search, c_search)

    # ── 4. Profile extract (Safari only — Chrome has different path) ───
    print("\n[4/4] Profile extraction")
    if safari_live:
        s_prof = bench_safari_profile()
        print(f"  Safari  {s_prof.summary()}")
        if s_prof.raw:
            print(f"  Profile: {s_prof.raw}")
    else:
        print("  Safari  ✗ not available")
    print("  Chrome  N/A (uses scrape_profile_network, not single profile endpoint)")

    # ── Summary table ──────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print("  SUMMARY")
    print(f"{'=' * 60}")
    print(f"  {'Test':<35} {'Safari':<12} {'Chrome':<12}")
    print(f"  {'-'*35} {'-'*12} {'-'*12}")
    for label, s, c in [
        ("Health", s_health, c_health),
        (f"Hashtag #{TAG} (limit={LIMIT})", s_hash, c_hash),
        ("People search", s_search, c_search),
    ]:
        s_str = f"{s.latency_ms:.0f}ms/{s.result_count}r" if s.ok() else "ERR"
        c_str = f"{c.latency_ms:.0f}ms/{c.result_count}r" if c.ok() else "ERR"
        print(f"  {label:<35} {s_str:<12} {c_str:<12}")

    print(f"\n  Legend: Xms = latency, Yr = results returned")

    # Save results to file
    results = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {"tag": TAG, "limit": LIMIT, "live": LIVE},
        "health":  {"safari": vars(s_health), "chrome": vars(c_health)},
        "hashtag": {"safari": vars(s_hash),   "chrome": vars(c_hash)},
        "search":  {"safari": vars(s_search), "chrome": vars(c_search)},
    }
    out = "/tmp/linkedin_benchmark_results.json"
    with open(out, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n  Results saved to: {out}")


if __name__ == "__main__":
    main()
