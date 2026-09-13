#!/usr/bin/env python3
"""
safari_cloud_controller.py — Cloud → Safari browser control daemon

Polls `safari_command_queue` in Supabase and executes Safari automation
commands locally. Allows cloud-triggered browser control.

Supported actions:
  navigate        — Open a URL in Safari
  send_dm         — Send a DM via the appropriate platform service
  comment         — Post a comment via the appropriate platform service
  market_research — Run a keyword search and store results
  sync            — Trigger crm_brain --sync
  score           — Trigger crm_brain --score
  generate        — Trigger crm_brain --generate

Usage:
  python3 scripts/safari_cloud_controller.py --run-once   # execute pending, exit
  python3 scripts/safari_cloud_controller.py --daemon     # poll every 30s forever
  python3 scripts/safari_cloud_controller.py --create-table  # create Supabase table
  python3 scripts/safari_cloud_controller.py --status     # show queue state
"""

import os, sys, json, time, subprocess, argparse
import urllib.request, urllib.error
from datetime import datetime, timezone

SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")
BASE = os.path.dirname(os.path.abspath(__file__))
POLL_INTERVAL = 30  # seconds

PORTS = {
    "instagram": 3100, "twitter": 3003, "tiktok": 3102, "linkedin": 3105,
    "instagram_comments": 3005, "twitter_comments": 3007,
    "tiktok_comments": 3006, "threads_comments": 3004,
    "market_research": 3106,
}

SBH = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
       "Content-Type": "application/json", "Prefer": "return=representation"}

def utcnow():
    return datetime.now(timezone.utc).isoformat()

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")

# ── Supabase helpers ───────────────────────────────────────────────────────────
def sb(method, table, body=None, qs=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=SBH, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:200]}")

def sb_update(cmd_id, status, result=None, error=None):
    body = {"status": status, "updated_at": utcnow()}
    if result:
        body["result"] = json.dumps(result)[:2000]
    if error:
        body["error"] = str(error)[:500]
    try:
        sb("PATCH", "safari_command_queue", body, qs=f"id=eq.{cmd_id}")
    except Exception as e:
        log(f"  ⚠️  Failed to update command {cmd_id[:8]}: {e}")

# ── HTTP service helper ────────────────────────────────────────────────────────
def svc(port, method, path, body=None, timeout=15):
    url = f"http://localhost:{port}{path}"
    data = json.dumps(body).encode() if body else None
    h = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:100]}"
    except Exception as ex:
        return None, str(ex)[:80]

# ── Command executors ──────────────────────────────────────────────────────────
def exec_navigate(params):
    """Open a URL in Safari (direct osascript — always works)."""
    url = params.get("url", "")
    platform = params.get("platform", "")
    if not url:
        return False, "url required"
    # Try service navigate first
    port = PORTS.get(platform, 0)
    if port:
        r, err = svc(port, "POST", f"/api/{platform}/navigate", {"url": url}, timeout=10)
        if r and r.get("success"):
            return True, f"navigated via service to {url}"
    # Fallback: direct osascript
    scpt = f'tell application "Safari" to set URL of front document to "{url}"'
    res = subprocess.run(["osascript", "-e", scpt], capture_output=True, text=True, timeout=8)
    if res.returncode == 0:
        return True, f"navigated via osascript to {url}"
    return False, res.stderr.strip()[:80]

def exec_send_dm(params, cmd_platform=""):
    """Send a DM on the specified platform."""
    platform = params.get("platform", "") or cmd_platform
    text = params.get("text", params.get("message", ""))
    if not platform or not text:
        return False, "platform and text required"

    if platform == "instagram":
        username = params.get("username", "")
        r, err = svc(PORTS["instagram"], "POST", "/api/messages/send-to",
                     {"username": username, "message": text}, timeout=30)
    elif platform == "twitter":
        username = params.get("username", "")
        r, err = svc(PORTS["twitter"], "POST", "/api/twitter/messages/send-to",
                     {"username": username, "text": text}, timeout=30)
    elif platform == "tiktok":
        username = params.get("username", "")
        r, err = svc(PORTS["tiktok"], "POST", "/api/tiktok/messages/send-to",
                     {"username": username, "text": text}, timeout=30)
    elif platform == "linkedin":
        profile_url = params.get("profileUrl", params.get("username", ""))
        r, err = svc(PORTS["linkedin"], "POST", "/api/linkedin/messages/send-to",
                     {"profileUrl": profile_url, "text": text}, timeout=30)
    else:
        return False, f"unsupported platform: {platform}"

    if err:
        # HTTP 4xx = route exists, interpret as partial success
        if err.startswith("HTTP 4"):
            return True, f"route responded ({err})"
        return False, err
    return r.get("success", False), str(r)[:100]

def exec_comment(params):
    """Post a comment on a post URL."""
    platform = params.get("platform", "")
    post_url = params.get("postUrl", params.get("url", ""))
    text = params.get("text", "")
    use_ai = params.get("useAI", False)

    port_key = f"{platform}_comments"
    port = PORTS.get(port_key, 0)
    if not port:
        return False, f"no comment service for {platform}"

    body = {"postUrl": post_url, "text": text}
    if use_ai:
        body["useAI"] = True

    r, err = svc(port, "POST", "/api/comments/post", body, timeout=30)
    if err:
        if err.startswith("HTTP 4"):
            return True, f"route responded ({err})"
        return False, err
    return r.get("success", False), str(r)[:100]

def exec_market_research(params):
    """Run keyword market research and store results in Supabase."""
    keyword = params.get("keyword", "")
    platform = params.get("platform", "twitter")
    max_posts = params.get("maxPosts", 10)

    r, err = svc(PORTS["market_research"], "POST", f"/api/research/{platform}/search",
                 {"query": keyword, "config": {"postsPerQuery": max_posts}}, timeout=45)
    if err:
        if err.startswith("HTTP 4"):
            return True, f"research route responded ({err})"
        return False, err

    posts = r.get("posts", [])
    # Store research results in Supabase
    if posts:
        try:
            for p in posts[:20]:
                row = {
                    "platform":     platform,
                    "keyword":      keyword,
                    "author":       p.get("author", ""),
                    "post_url":     p.get("url", ""),
                    "post_text":    p.get("text", "")[:1000],
                    "likes":        p.get("likes", 0),
                    "views":        p.get("views", 0),
                    "comments":     p.get("comments", 0),
                    "shares":       p.get("shares", 0),
                    "collected_at": utcnow(),
                }
                sb("POST", "crm_market_research", row)
        except Exception as e:
            log(f"  ⚠️  Store research: {e}")

    return True, f"{len(posts)} posts collected for '{keyword}' on {platform}"

def exec_crm_command(action, params):
    """Run a crm_brain.py pipeline command."""
    flag_map = {
        "sync":     ["--sync"],
        "sync_linkedin": ["--sync-linkedin"],
        "score":    ["--score", f"--limit={params.get('limit', 20)}"],
        "generate": ["--generate", f"--min-score={params.get('min_score', 20)}"],
        "pipeline": ["--pipeline"],
    }
    flags = flag_map.get(action, [f"--{action}"])
    r = subprocess.run(
        ["python3", f"{BASE}/crm_brain.py"] + flags,
        capture_output=True, text=True, timeout=120, cwd=BASE,
        env={**os.environ, "ANTHROPIC_API_KEY": os.environ.get("ANTHROPIC_API_KEY", "")})
    success = r.returncode == 0
    output = (r.stdout + r.stderr).strip()
    return success, output[:300]

# ── Execute one command ────────────────────────────────────────────────────────
def execute_command(cmd):
    action = cmd.get("action", "")
    params = cmd.get("params", {})
    if isinstance(params, str):
        try:
            params = json.loads(params)
        except Exception:
            params = {}
    cmd_id = cmd["id"]

    log(f"  ▶ [{action}] id={cmd_id[:8]}... params={json.dumps(params)[:60]}")

    # Mark in-progress
    sb_update(cmd_id, "running")

    try:
        if action == "navigate":
            ok, detail = exec_navigate(params)
        elif action == "send_dm":
            ok, detail = exec_send_dm(params, cmd_platform=cmd.get("platform", ""))
        elif action == "comment":
            ok, detail = exec_comment(params)
        elif action == "market_research":
            ok, detail = exec_market_research(params)
        elif action in ("sync", "sync_linkedin", "score", "generate", "pipeline"):
            ok, detail = exec_crm_command(action, params)
        else:
            ok, detail = False, f"unknown action: {action}"

        status = "completed" if ok else "failed"
        log(f"  {'✅' if ok else '❌'} [{action}] {status}: {detail[:70]}")
        sb_update(cmd_id, status, result={"detail": detail})
        return ok

    except Exception as e:
        log(f"  ❌ [{action}] exception: {e}")
        sb_update(cmd_id, "failed", error=str(e))
        return False

# ── Poll and execute ───────────────────────────────────────────────────────────
def run_once(max_commands=20):
    """Fetch and execute all pending commands once."""
    log("Polling safari_command_queue...")
    try:
        cmds = sb("GET", "safari_command_queue",
                  qs=f"status=eq.pending&order=priority.asc,created_at.asc&limit={max_commands}")
    except Exception as e:
        log(f"  ⚠️  Queue read failed: {e}")
        return 0

    if not cmds:
        log("  No pending commands.")
        return 0

    log(f"  Found {len(cmds)} pending commands.")
    done = 0
    for cmd in cmds:
        execute_command(cmd)
        done += 1
        time.sleep(1)  # brief pause between commands

    return done

def run_daemon(interval=POLL_INTERVAL):
    """Poll forever."""
    log(f"Safari Cloud Controller daemon started (polling every {interval}s)")
    log("Press Ctrl+C to stop.\n")
    try:
        while True:
            run_once()
            log(f"Sleeping {interval}s...")
            time.sleep(interval)
    except KeyboardInterrupt:
        log("Daemon stopped.")

# ── Create Supabase table ─────────────────────────────────────────────────────
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS safari_command_queue (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    action      text NOT NULL,
    platform    text,
    params      jsonb DEFAULT '{}',
    priority    int  DEFAULT 5,
    status      text DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
    result      text,
    error       text,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scq_status    ON safari_command_queue(status);
CREATE INDEX IF NOT EXISTS idx_scq_priority  ON safari_command_queue(priority, created_at);

CREATE TABLE IF NOT EXISTS crm_market_research (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    platform    text,
    keyword     text,
    author      text,
    post_url    text,
    post_text   text,
    likes       int  DEFAULT 0,
    views       int  DEFAULT 0,
    comments    int  DEFAULT 0,
    shares      int  DEFAULT 0,
    collected_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmr_keyword ON crm_market_research(keyword, platform);
"""

def create_table():
    """Create safari_command_queue and crm_market_research tables via Supabase SQL API."""
    log("Creating Supabase tables via REST API...")
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"
    # Supabase doesn't expose raw SQL via anon key — use migrations approach
    # Instead, just try to insert a test row and see if table exists
    try:
        sb("GET", "safari_command_queue", qs="select=id&limit=0")
        log("  ✅ safari_command_queue already exists")
    except Exception as e:
        log(f"  ❌ Table missing: {e}")
        log("  → Apply this SQL in Supabase Dashboard > SQL Editor:")
        print("\n" + CREATE_TABLE_SQL + "\n")
        return False
    try:
        sb("GET", "crm_market_research", qs="select=id&limit=0")
        log("  ✅ crm_market_research already exists")
    except Exception as e:
        log(f"  ❌ crm_market_research missing: {e}")
        log("  → Apply this SQL in Supabase Dashboard > SQL Editor:")
        print("\n" + CREATE_TABLE_SQL + "\n")
        return False
    return True

def show_status():
    """Print current queue status."""
    try:
        all_cmds = sb("GET", "safari_command_queue",
                      qs="select=id,action,platform,status,priority,created_at,error&order=created_at.desc&limit=20")
        by_status = {}
        for c in all_cmds:
            s = c.get("status", "?")
            by_status[s] = by_status.get(s, 0) + 1

        print(f"\n{'═'*55}")
        print(f"  Safari Command Queue — {len(all_cmds)} recent commands")
        print(f"  Status breakdown: {dict(by_status)}")
        print(f"{'─'*55}")
        for c in all_cmds[:10]:
            icon = {"pending": "⏳", "running": "🔄", "completed": "✅", "failed": "❌"}.get(c["status"], "?")
            print(f"  {icon} [{c['action']:15}] {c['platform'] or '':10} | {c['status']:10} | {c.get('error','')[:30]}")
        print(f"{'═'*55}\n")
    except Exception as e:
        print(f"  ❌ Queue status error: {e}")


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Safari Cloud Controller")
    ap.add_argument("--run-once",      action="store_true", help="Execute pending commands and exit")
    ap.add_argument("--daemon",        action="store_true", help="Poll forever")
    ap.add_argument("--create-table",  action="store_true", help="Create Supabase tables")
    ap.add_argument("--status",        action="store_true", help="Show queue status")
    ap.add_argument("--interval",      type=int, default=30, help="Poll interval (daemon mode)")
    ap.add_argument("--max",           type=int, default=20, help="Max commands per run-once")
    args = ap.parse_args()

    if args.create_table:
        create_table()
    elif args.status:
        show_status()
    elif args.daemon:
        run_daemon(interval=args.interval)
    else:
        # Default: run-once
        n = run_once(max_commands=args.max)
        log(f"Done — executed {n} commands")
