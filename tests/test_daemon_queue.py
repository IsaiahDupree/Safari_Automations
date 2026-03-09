"""
test_daemon_queue.py
====================
Tests for li-daemon, upwork-daemon, and Window 1 enforcement.
Validates: queue dispatch, window assignment, env propagation.

Run: python3 tests/test_daemon_queue.py
Flags:
  --live          run tests that touch Safari (needs Window 1 logged in)
  --insert-rows   insert real test rows into safari_command_queue
"""

import json
import sys
import time
import os
import urllib.request
import urllib.error
import subprocess
from typing import Any, Optional

LIVE = "--live" in sys.argv
INSERT = "--insert-rows" in sys.argv
SAFARI_DIR = "/Users/isaiahdupree/Documents/Software/Safari Automation"

# ─── Helpers ──────────────────────────────────────────────────────────────────

passed = failed = skipped = 0

def ok(msg: str):
    global passed; passed += 1
    print(f"  ✓ {msg}")

def fail(msg: str, reason: str = ""):
    global failed; failed += 1
    print(f"  ✗ {msg}{': ' + reason if reason else ''}")

def skip(msg: str, reason: str = ""):
    global skipped; skipped += 1
    print(f"  ~ {msg}{' (skip: ' + reason + ')' if reason else ''}")

def get(url: str, auth: Optional[str] = None, timeout: float = 10.0) -> tuple[Any, Optional[str]]:
    headers: dict = {}
    if auth: headers["Authorization"] = auth
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:
        return None, str(e)

def post(url: str, payload: dict, auth: Optional[str] = None, timeout: float = 30.0) -> tuple[Any, Optional[str]]:
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if auth: headers["Authorization"] = auth
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:100]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)

def get_process_env(port: int) -> Optional[str]:
    """Return SAFARI_AUTOMATION_WINDOW value from the process bound to port."""
    try:
        pid_line = subprocess.check_output(["lsof", "-ti", f"tcp:{port}"], text=True).strip().split()[0]
        env_line = subprocess.check_output(["ps", "eww", "-p", pid_line], text=True)
        for tok in env_line.split():
            if tok.startswith("SAFARI_AUTOMATION_WINDOW="):
                return tok.split("=", 1)[1]
    except Exception:
        pass
    return None

# ─── Section 1: Services up ───────────────────────────────────────────────────

print("\n═══ 1. Service Health ═══")

for port, name, auth in [
    (3100, "instagram-dm",     None),
    (3003, "twitter-dm",       None),
    (3102, "tiktok-dm",        None),
    (3105, "linkedin-automation", "Bearer test-token-12345"),
    (3005, "instagram-comments", None),
    (3006, "tiktok-comments",   None),
    (3007, "twitter-comments",  None),
    (3004, "threads-comments",  None),
    (3106, "market-research",   None),
    (3107, "upwork-automation", None),
]:
    body, err = get(f"http://localhost:{port}/health", auth=auth, timeout=3)
    if err:
        fail(f"::{port} {name}", err)
    else:
        ok(f"::{port} {name} UP")

# ─── Section 2: Window 1 enforcement ──────────────────────────────────────────

print("\n═══ 2. SAFARI_AUTOMATION_WINDOW=1 ═══")

for port, name in [
    (3100, "instagram-dm"),
    (3003, "twitter-dm"),
    (3102, "tiktok-dm"),
    (3105, "linkedin-automation"),
    (3005, "instagram-comments"),
    (3107, "upwork-automation"),
]:
    env_val = get_process_env(port)
    if env_val is None:
        skip(f"::{port} {name} SAFARI_AUTOMATION_WINDOW", "process env not visible")
    elif env_val == "1":
        ok(f"::{port} {name} SAFARI_AUTOMATION_WINDOW=1 (Local to Cloud)")
    else:
        fail(f"::{port} {name} SAFARI_AUTOMATION_WINDOW={env_val}", "Expected 1 (Personal window would be 2)")

# ─── Section 3: Safari session on Window 1 ────────────────────────────────────

print("\n═══ 3. Session Pointing to Window 1 ═══")

if not LIVE:
    skip("Safari session check", "--live not set")
else:
    for port, name, auth in [
        (3100, "instagram-dm",        None),
        (3003, "twitter-dm",          None),
        (3105, "linkedin-automation", "Bearer test-token-12345"),
    ]:
        body, err = get(f"http://localhost:{port}/api/session/status", auth=auth, timeout=5)
        if err:
            fail(f"::{port} {name} session/status", err)
        elif not body:
            fail(f"::{port} {name} session/status", "empty response")
        else:
            w = body.get("windowIndex")
            tracked = body.get("tracked")
            if tracked and w == 1:
                ok(f"::{port} {name} tracked on Window 1 (Local to Cloud)")
            elif tracked and w == 2:
                fail(f"::{port} {name} tracked on Window 2 (PERSONAL window!)", f"windowIndex={w}")
            elif not tracked:
                # Try ensuring session
                b2, e2 = post(f"http://localhost:{port}/api/session/ensure", {}, auth=auth, timeout=15)
                if e2:
                    fail(f"::{port} {name} session/ensure", e2)
                else:
                    w2 = b2.get("windowIndex") if b2 else None
                    ok(f"::{port} {name} session ensured Window {w2}") if w2 == 1 else fail(f"::{port} {name} session ensure returned Window {w2}")
            else:
                skip(f"::{port} {name} windowIndex={w}", "not tracked")

# ─── Section 4: platform_launcher window-scoped scan ─────────────────────────

print("\n═══ 4. platform_launcher Automation Window Scan ═══")

try:
    env = os.environ.copy()
    env["SAFARI_AUTOMATION_WINDOW"] = "1"
    result = subprocess.run(
        ["python3", "platform_launcher.py", "--scan"],
        cwd="/Users/isaiahdupree/Documents/Software/actp-worker",
        capture_output=True, text=True, timeout=15, env=env
    )
    output = result.stdout + result.stderr
    if "w2" in output and "w1" not in output:
        fail("platform_launcher --scan only found Window 2 tabs", "Should scan Window 1 only")
    elif "w1" in output:
        ok("platform_launcher --scan found Window 1 tabs")
    elif "0/9 platforms mapped" in output or "0 platforms" in output:
        fail("platform_launcher --scan found 0 platforms", "Window 1 tabs may be closed")
    else:
        ok(f"platform_launcher --scan ran (check /tmp/safari-platform-tabs.json)")

    # Check the output tab map
    try:
        with open("/tmp/safari-platform-tabs.json") as f:
            tab_map = json.load(f)
        for platform, pos in tab_map.items():
            w = pos.get("window")
            if w != 1:
                fail(f"Tab map: {platform} on window {w}", "Expected Window 1")
            else:
                ok(f"Tab map: {platform} → w{w}t{pos.get('tab')} (Local to Cloud)")
    except Exception as e:
        fail("Read /tmp/safari-platform-tabs.json", str(e))

except subprocess.TimeoutExpired:
    fail("platform_launcher --scan", "Timeout (15s)")
except Exception as e:
    fail("platform_launcher --scan", str(e))

# ─── Section 5: Daemon processes alive ────────────────────────────────────────

print("\n═══ 5. Queue Daemon Processes ═══")

daemon_checks = [
    ("ig-daemon",      "/tmp/ig_daemon.pid",      "instagram"),
    ("tw-daemon",      "/tmp/tw_daemon.pid",       "twitter"),
    ("threads-daemon", "/tmp/threads_daemon.pid",  "threads"),
    ("li-daemon",      "/tmp/li_daemon.pid",       "linkedin"),
    ("upwork-daemon",  "/tmp/upwork_daemon.pid",   "upwork"),
]

for name, pid_file, platform in daemon_checks:
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        # Check process is alive
        subprocess.check_call(["kill", "-0", str(pid)], stderr=subprocess.DEVNULL)
        ok(f"{name} running PID={pid} (platform={platform})")
    except FileNotFoundError:
        fail(f"{name} PID file missing: {pid_file}")
    except (subprocess.CalledProcessError, ValueError):
        fail(f"{name} PID file exists but process not running", pid_file)

# ─── Section 6: Queue dispatch dry-run ───────────────────────────────────────

print("\n═══ 6. Queue Dispatch (dry-run via API) ═══")

if not LIVE:
    skip("LinkedIn hashtag dry-run dispatch", "--live not set")
else:
    # Test li-daemon action via direct API call (bypassing queue)
    body, err = get(
        "http://localhost:3105/api/linkedin/discover/hashtag?tag=saasfounder&limit=3",
        auth="Bearer test-token-12345", timeout=60
    )
    if err:
        fail("li-daemon: GET /api/linkedin/discover/hashtag", err)
    elif body:
        authors = body.get("profiles") or body.get("authors") or body.get("results") or []
        ok(f"LinkedIn hashtag scrape: {len(authors)} authors from #saasfounder")
    else:
        fail("LinkedIn hashtag scrape", "empty response")

    # Test upwork-daemon action via direct API call
    body, err = get("http://localhost:3107/api/upwork/connects", timeout=15)
    if err:
        fail("upwork-daemon: GET /api/upwork/connects", err)
    elif body:
        available = body.get("available", body.get("connects", {}).get("available", "?"))
        ok(f"Upwork connects: {available} available")
    else:
        fail("Upwork connects check", "empty response")

# ─── Section 7: LaunchAgent status ────────────────────────────────────────────

print("\n═══ 7. LaunchAgent Status ═══")

for label in ["com.actp.li-daemon", "com.actp.upwork-daemon", "com.actp.safari-watchdog"]:
    try:
        out = subprocess.check_output(
            ["launchctl", "list", label], stderr=subprocess.DEVNULL, text=True
        )
        if '"PID"' in out or "PID" in out:
            ok(f"{label} running")
        else:
            skip(f"{label}", "not shown (may still be running)")
    except subprocess.CalledProcessError:
        out = subprocess.check_output(["launchctl", "list"], text=True)
        if label in out:
            line = [l for l in out.splitlines() if label in l][0]
            parts = line.split()
            exit_code = parts[1] if len(parts) >= 2 else "?"
            if exit_code == "0":
                ok(f"{label} exit=0")
            else:
                fail(f"{label}", f"exit={exit_code}")
        else:
            fail(f"{label}", "not in launchctl list")

# ─── Summary ──────────────────────────────────────────────────────────────────

total = passed + failed + skipped
print(f"\n{'═' * 50}")
print(f"  Results: {passed} passed  {failed} failed  {skipped} skipped  ({total} total)")
print(f"{'═' * 50}")

if failed > 0:
    print(f"\n  Run with --live for session tests: python3 tests/test_daemon_queue.py --live")
    sys.exit(1)
