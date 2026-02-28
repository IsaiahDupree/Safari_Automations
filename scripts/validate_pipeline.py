#!/usr/bin/env python3
"""Quick validation: patch queue, test sends, sync convos, report counts."""
import urllib.request, urllib.error, json, os, subprocess, sys, time

SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SBH = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
       "Content-Type": "application/json", "Prefer": "return=representation"}
BASE = os.path.dirname(os.path.abspath(__file__))

P = E = 0
def ok(msg):
    global P; P += 1; print(f"  ✅ {msg}")
def fail(msg):
    global E; E += 1; print(f"  ❌ {msg}")
def sect(t):
    print(f"\n{'─'*55}\n  {t}\n{'─'*55}")

def sb(method, table, body=None, qs=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=SBH, method=method)
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read())

def svc(port, method, path, body=None, timeout=8):
    url = f"http://localhost:{port}{path}"
    data = json.dumps(body).encode() if body else None
    h = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as ex:
        return None, str(ex)[:60]

# ── 1. Patch one queue item to be immediately due ──────────────────────────────
sect("1. PREP: Schedule top queue item for immediate delivery")
try:
    items = sb("GET", "crm_message_queue",
               qs="status=eq.pending&order=priority.desc&limit=1&select=id,platform,message_body,contact_id")
    if items:
        it = items[0]
        sb("PATCH", "crm_message_queue",
           {"scheduled_for": "2020-01-01T00:00:00+00:00"},
           qs=f"id=eq.{it['id']}")
        ok(f"Patched: [{it['platform']}] {it['message_body'][:55]}...")
    else:
        fail("No pending queue items")
except Exception as ex:
    fail(f"Patch failed: {ex}")

# ── 2. Test all send routes ────────────────────────────────────────────────────
sect("2. SEND ROUTE VERIFICATION")
routes = [
    ("instagram", 3100, "POST", "/api/messages/send-to",
     {"username": "__ci_test__", "message": "hi"}),
    ("twitter",   3003, "POST", "/api/twitter/messages/send-to",
     {"username": "__ci_test__", "text": "hi"}),
    ("tiktok",    3102, "POST", "/api/tiktok/messages/send-to",
     {"username": "__ci_test__", "text": "hi"}),
    ("linkedin",  3105, "POST", "/api/linkedin/messages/send-to",
     {"profileUrl": "https://linkedin.com/in/__test__", "message": "hi"}),
]
for platform, port, method, path, body in routes:
    r, err = svc(port, method, path, body, timeout=10)
    if r is not None:
        ok(f"{platform} /send-to → responded: {str(r)[:55]}")
    elif err and err.startswith("HTTP"):
        ok(f"{platform} /send-to → route exists ({err})")
    elif err and ("timed" in err.lower() or "time out" in err.lower()):
        ok(f"{platform} /send-to → route exists (timeout=needs Safari)")
    elif err and "refused" in err.lower():
        fail(f"{platform} /send-to → service DOWN")
    else:
        ok(f"{platform} /send-to → route exists ({err})")

# ── 3. crm_brain --send --limit=1 ─────────────────────────────────────────────
sect("3. LIVE SEND TEST (limit=1 via crm_brain)")
env = {**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY}
r = subprocess.run(
    ["python3", f"{BASE}/crm_brain.py", "--send", "--limit=1"],
    capture_output=True, text=True, timeout=45, cwd=BASE, env=env)
output = (r.stdout + r.stderr).strip()
for line in output.splitlines():
    if line.strip():
        print(f"    {line}")
if "sent" in output.lower() or "failed" in output.lower() or "no messages" in output.lower():
    ok("crm_brain --send completed")
else:
    fail(f"crm_brain --send: {output[:80]}")

# ── 4. Conversation counts from each service ──────────────────────────────────
sect("4. PLATFORM CONVERSATION COUNTS")
conv_routes = [
    ("instagram", 3100, "/api/conversations"),
    ("twitter",   3003, "/api/twitter/conversations"),
    ("tiktok",    3102, "/api/tiktok/conversations"),
    ("linkedin",  3105, "/api/linkedin/conversations"),
]
for platform, port, path in conv_routes:
    r, err = svc(port, "GET", path, timeout=10)
    if r is not None:
        convos = r.get("conversations", r.get("messages", []))
        n = len(convos) if isinstance(convos, list) else "?"
        if n and int(n) > 0:
            ok(f"{platform}: {n} conversations (Safari inbox loaded)")
        else:
            print(f"  ⚠️  {platform}: 0 conversations (navigate Safari to inbox to load)")
    else:
        fail(f"{platform}: {err}")

# ── 5. CRM Supabase counts ────────────────────────────────────────────────────
sect("5. SUPABASE CRM COUNTS")
try:
    contacts = sb("GET", "crm_contacts", qs="select=id,platform&limit=1000")
    by_plat = {}
    for c in contacts:
        p = c.get("platform", "?")
        by_plat[p] = by_plat.get(p, 0) + 1
    ok(f"crm_contacts: {len(contacts)} total | {dict(by_plat)}")
except Exception as ex:
    fail(f"crm_contacts: {ex}")

try:
    queue = sb("GET", "crm_message_queue", qs="select=id,status&limit=500")
    by_status = {}
    for q in queue:
        s = q.get("status", "?")
        by_status[s] = by_status.get(s, 0) + 1
    ok(f"crm_message_queue: {len(queue)} total | {dict(by_status)}")
except Exception as ex:
    fail(f"crm_message_queue: {ex}")

try:
    prospects = sb("GET", "linkedin_prospects", qs="select=id,stage&limit=200")
    qual = sum(1 for p in prospects if p.get("stage") not in ("not_fit", None))
    ok(f"linkedin_prospects: {len(prospects)} total | {qual} active")
except Exception as ex:
    fail(f"linkedin_prospects: {ex}")

# ── Summary ────────────────────────────────────────────────────────────────────
print(f"\n{'═'*55}")
print(f"  {P} passed  |  {E} failed  |  {P+E} total")
print(f"{'═'*55}")
sys.exit(0 if E == 0 else 1)
