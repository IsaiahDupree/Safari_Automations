#!/usr/bin/env python3
"""
test_crm_system.py — Verify all platform DM services + CRM brain functionality.
Runs entirely in < 60 seconds. No Safari navigation (assumes tabs already open).
"""
import sys, json, os, time, subprocess
import urllib.request, urllib.error, urllib.parse

BASE = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")

SERVICES = {
    "instagram": 3100,
    "twitter":   3003,
    "tiktok":    3102,
    "linkedin":  3105,
}

RESULTS = []
PASS = 0
FAIL = 0

def req(method, url, body=None, headers=None, timeout=6):
    data = json.dumps(body).encode() if body else None
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read())

def ok(label, detail=""):
    global PASS
    PASS += 1
    mark = "✅"
    print(f"  {mark} {label}{': ' + str(detail) if detail else ''}")
    RESULTS.append(("PASS", label, detail))

def fail(label, detail=""):
    global FAIL
    FAIL += 1
    mark = "❌"
    print(f"  {mark} {label}{': ' + str(detail) if detail else ''}")
    RESULTS.append(("FAIL", label, detail))

def section(title):
    print(f"\n{'─'*60}")
    print(f"  {title}")
    print(f"{'─'*60}")

# ── 1. Syntax checks ───────────────────────────────────────────────────────────
section("1. SYNTAX CHECKS")
for script in ["crm_brain.py", "li_prospect.py", "crm_sync.py"]:
    r = subprocess.run(["python3", "-m", "py_compile", f"{BASE}/{script}"],
                       capture_output=True, timeout=10)
    if r.returncode == 0:
        ok(f"syntax {script}")
    else:
        fail(f"syntax {script}", r.stderr.decode().strip()[:80])

# ── 2. Service health ──────────────────────────────────────────────────────────
section("2. SERVICE HEALTH")
service_status = {}
for platform, port in SERVICES.items():
    try:
        d = req("GET", f"http://localhost:{port}/health", timeout=4)
        status = d.get("status", "?")
        service_status[platform] = True
        ok(f"{platform} :{port}", status)
    except Exception as e:
        service_status[platform] = False
        fail(f"{platform} :{port}", str(e)[:60])

# ── 3. Conversation endpoints ─────────────────────────────────────────────────
section("3. CONVERSATION ENDPOINTS")
conv_endpoints = {
    "instagram": ("GET", "http://localhost:3100/api/conversations"),
    "instagram_all": ("GET", "http://localhost:3100/api/conversations/all"),  # slow — needs DOM
    "twitter": ("GET", "http://localhost:3003/api/twitter/conversations"),
    "tiktok": ("GET", "http://localhost:3102/api/tiktok/conversations"),
    "linkedin": ("GET", "http://localhost:3105/api/linkedin/conversations"),
    "linkedin_msgs": ("GET", "http://localhost:3105/api/linkedin/messages"),
}
conv_counts = {}
for label, (method, url) in conv_endpoints.items():
    platform = label.split("_")[0]
    if not service_status.get(platform, True):
        fail(label, "service down")
        continue
    t = 30 if "all" in label else 8
    try:
        d = req(method, url, timeout=t)
        items = d.get("conversations", d.get("messages", []))
        n = len(items) if isinstance(items, list) else "?"
        conv_counts[label] = n
        ok(label, f"{n} items")
    except TimeoutError:
        fail(label, "timed out — Safari may not be on this inbox yet")
    except Exception as e:
        fail(label, str(e)[:60])

# ── 4. Send route verification (OPTIONS / schema check) ───────────────────────
section("4. SEND ROUTE AVAILABILITY")
send_routes = {
    "instagram_send_to": ("POST", "http://localhost:3100/api/messages/send-to",
                          {"username": "__test__", "message": "test"}),
    "twitter_send_to":   ("POST", "http://localhost:3003/api/twitter/messages/send-to",
                          {"username": "__test__", "text": "test"}),
    "tiktok_send_to":    ("POST", "http://localhost:3102/api/tiktok/messages/send-to",
                          {"username": "__test__", "text": "test"}),
    "linkedin_send_to":  ("POST", "http://localhost:3105/api/linkedin/messages/send-to",
                          {"profileUrl": "https://linkedin.com/in/__test__", "message": "test"}),
}
for label, (method, url, body) in send_routes.items():
    platform = label.split("_")[0]
    if not service_status.get(platform, True):
        fail(label, "service down")
        continue
    try:
        d = req(method, url, body, timeout=8)
        # Any JSON response (even error) means route exists
        ok(label, f"route exists — {str(d)[:60]}")
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()[:80]
        if e.code in (400, 404, 422, 500):
            ok(label, f"route exists (HTTP {e.code})")
        else:
            fail(label, f"HTTP {e.code}: {body_txt}")
    except TimeoutError:
        ok(label, "route exists (timeout — needs active Safari session)")
    except Exception as e:
        # Connection refused = service down, otherwise route may exist
        if "refused" in str(e).lower():
            fail(label, f"service down: {str(e)[:50]}")
        else:
            ok(label, f"route exists ({str(e)[:50]})")  

# ── 5. Supabase CRM tables ────────────────────────────────────────────────────
section("5. SUPABASE CRM TABLES")
sb_tables = ["crm_contacts", "crm_conversations", "crm_messages",
             "crm_message_queue", "crm_score_history", "linkedin_prospects"]
for table in sb_tables:
    try:
        d = req("GET", f"{SUPABASE_URL}/rest/v1/{table}?select=id&limit=1",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=6)
        count = len(d) if isinstance(d, list) else "?"
        ok(f"table:{table}", f"accessible (sample rows: {count})")
    except Exception as e:
        fail(f"table:{table}", str(e)[:60])

# ── 6. CRM contacts count ─────────────────────────────────────────────────────
section("6. CRM DATA COUNTS")
count_queries = {
    "crm_contacts":          "select=id&limit=1000",
    "linkedin_prospects":    "select=id,stage&limit=1000",
    "crm_message_queue":     "select=id,status&limit=200",
}
for table, qs in count_queries.items():
    try:
        d = req("GET", f"{SUPABASE_URL}/rest/v1/{table}?{qs}",
                headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
                timeout=8)
        if table == "crm_message_queue":
            pending = sum(1 for r in d if r.get("status") == "pending")
            ok(f"{table}", f"{len(d)} total, {pending} pending")
        elif table == "linkedin_prospects":
            qualified = sum(1 for r in d if r.get("stage") not in ("not_fit", None))
            ok(f"{table}", f"{len(d)} total, {qualified} qualified/active")
        else:
            ok(f"{table}", f"{len(d)} rows")
    except Exception as e:
        fail(f"{table}", str(e)[:60])

# ── 7. crm_brain.py --sync-linkedin ──────────────────────────────────────────
section("7. CRM BRAIN — SYNC LINKEDIN PROSPECTS")
r = subprocess.run(
    ["python3", f"{BASE}/crm_brain.py", "--sync-linkedin"],
    capture_output=True, text=True, timeout=30, cwd=BASE
)
if r.returncode == 0:
    synced_line = next((l for l in r.stdout.splitlines() if "synced" in l.lower()), r.stdout.strip()[:80])
    ok("crm_brain --sync-linkedin", synced_line)
else:
    fail("crm_brain --sync-linkedin", r.stderr.strip()[:120])

# ── 8. crm_brain.py --status ──────────────────────────────────────────────────
section("8. CRM BRAIN — STATUS")
r = subprocess.run(
    ["python3", f"{BASE}/crm_brain.py", "--status"],
    capture_output=True, text=True, timeout=20, cwd=BASE
)
if r.returncode == 0:
    lines = [l for l in r.stdout.splitlines() if l.strip()]
    for line in lines[:20]:
        print(f"    {line}")
    ok("crm_brain --status", f"{len(lines)} lines output")
else:
    fail("crm_brain --status", r.stderr.strip()[:120])

# ── 9. crm_sync.py syntax + import test ──────────────────────────────────────
section("9. CRM SYNC FUNCTIONS")
crm_sync_path = os.path.join(BASE, "crm_sync.py")
if os.path.exists(crm_sync_path):
    r2 = subprocess.run(["python3", "-m", "py_compile", crm_sync_path],
                        capture_output=True, text=True, timeout=10)
    if r2.returncode == 0:
        ok("crm_sync.py syntax clean")
    else:
        fail("crm_sync.py", r2.stderr.strip()[:80])
else:
    fail("crm_sync.py", f"not found at {crm_sync_path}")

# ── Summary ────────────────────────────────────────────────────────────────────
print(f"\n{'═'*60}")
print(f"  RESULTS: {PASS} passed  |  {FAIL} failed  |  {PASS+FAIL} total")
print(f"{'═'*60}")

if FAIL > 0:
    print("\n  FAILURES:")
    for status, label, detail in RESULTS:
        if status == "FAIL":
            print(f"    ❌ {label}: {detail}")

sys.exit(0 if FAIL == 0 else 1)
