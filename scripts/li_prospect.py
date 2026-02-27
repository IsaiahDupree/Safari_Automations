#!/usr/bin/env python3
"""
li_prospect.py — LinkedIn prospecting pipeline
Search → Score → Qualify → Connect → Message → CRM

Powered by the linkedin-automation service (port 3105).
Start service: PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts

Usage:
  python3 scripts/li_prospect.py --search                        # run all search_queries from config
  python3 scripts/li_prospect.py --search --query "founder saas" # specific query
  python3 scripts/li_prospect.py --search --limit 30             # max results per query
  python3 scripts/li_prospect.py --connect --limit 20            # send connection requests to qualified
  python3 scripts/li_prospect.py --pipeline                      # full search + connect run
  python3 scripts/li_prospect.py --status                        # show pipeline stats
  python3 scripts/li_prospect.py --start-service                 # start the linkedin-automation service
"""

import os, sys, json, time, random, subprocess
import urllib.request, urllib.parse
from datetime import datetime, timezone

import yaml  # pip install pyyaml

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE  = os.path.join(SCRIPT_DIR, "prospect_config.yaml")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ivhfuhxorppptyuofbgq.supabase.co")
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")

TABLE = "linkedin_prospects"


# ── Supabase helpers ──────────────────────────────────────────────────────────
def _sb_request(method, path, body=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        url += '?' + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body else None
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }
    if method in ('POST', 'PATCH') and body:
        headers['Prefer'] = 'return=representation,resolution=merge-duplicates'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()
        print(f"  ⚠️  Supabase {method} {path}: {e.code} {body_txt[:200]}")
        return []
    except Exception as ex:
        print(f"  ⚠️  Supabase error: {ex}")
        return []


def _upsert_prospects(rows):
    if not rows:
        return 0
    result = _sb_request('POST', TABLE, rows,
                         params={'on_conflict': 'profile_url'})
    return len(result) if isinstance(result, list) else 0


def _update_prospect(profile_url, updates):
    updates['updated_at'] = utcnow()
    _sb_request('PATCH', TABLE, updates,
                params={'profile_url': f'eq.{urllib.parse.quote(profile_url)}'})


def _get_prospects(stage=None, min_score=0, limit=100):
    params = {'select': '*', 'order': 'fit_score.desc', 'limit': limit}
    if stage:
        params['stage'] = f'eq.{stage}'
    if min_score:
        params['fit_score'] = f'gte.{min_score}'
    return _sb_request('GET', TABLE, params=params) or []


def utcnow():
    return datetime.now(timezone.utc).isoformat()


# ── Config loader ─────────────────────────────────────────────────────────────
def load_config():
    with open(CONFIG_FILE, 'r') as f:
        return yaml.safe_load(f)


# ── Fit scoring ───────────────────────────────────────────────────────────────
def score_fit(profile: dict, icp: dict) -> tuple[int, list]:
    """
    Score a LinkedIn profile against the ICP. Returns (score 0-100, reasons[]).
    """
    score = 0
    reasons = []
    text = ' '.join([
        (profile.get('current_title') or ''),
        (profile.get('headline') or ''),
        (profile.get('about_snippet') or ''),
        (profile.get('current_company') or ''),
    ]).lower()

    # Negative keywords — bail out early
    for neg in icp.get('negative_keywords', []):
        if neg.lower() in text:
            reasons.append(f'⛔ negative: {neg}')
            return max(0, score - 20), reasons

    # Target titles
    for title in icp.get('target_titles', []):
        if title.lower() in text:
            score += 15
            reasons.append(f'✅ title: {title}')
            break  # only score one title match to avoid inflation

    # Target keywords in headline
    kw_hits = 0
    for kw in icp.get('target_keywords', []):
        if kw.lower() in text:
            score += 10
            reasons.append(f'✅ keyword: {kw}')
            kw_hits += 1
            if kw_hits >= 4:
                break  # cap at 4 keyword hits = 40 pts

    # Company signals
    for sig in icp.get('target_company_signals', []):
        if sig.lower() in text:
            score += 10
            reasons.append(f'✅ company signal: {sig}')
            break

    # Preferred location
    location = (profile.get('location') or '').lower()
    for loc in icp.get('preferred_locations', []):
        if loc.lower() in location:
            score += 5
            reasons.append(f'✅ location: {loc}')
            break

    # Shared connections bonus
    shared = int(profile.get('shared_connections') or 0)
    if shared >= 10:
        score += 10
        reasons.append(f'✅ {shared} shared connections')
    elif shared >= 3:
        score += 5
        reasons.append(f'✅ {shared} shared connections')

    return min(score, 100), reasons


# ── Connection note generator ─────────────────────────────────────────────────
def generate_connection_note(profile: dict, templates: list) -> str:
    first_name = (profile.get('full_name') or '').split()[0] if profile.get('full_name') else 'there'
    their_title = profile.get('current_title') or profile.get('headline') or 'professional'
    their_company = profile.get('current_company') or 'your company'
    template = random.choice(templates)
    note = (template
            .replace('{first_name}', first_name)
            .replace('{their_title}', their_title[:30])
            .replace('{their_company}', their_company[:30])
            .strip())
    return note[:300]  # LinkedIn max


def generate_first_message(profile: dict, template: str) -> str:
    first_name = (profile.get('full_name') or '').split()[0] if profile.get('full_name') else 'there'
    their_title = profile.get('current_title') or profile.get('headline') or 'professional'
    their_company = profile.get('current_company') or 'your company'
    return (template
            .replace('{first_name}', first_name)
            .replace('{their_title}', their_title[:40])
            .replace('{their_company}', their_company[:40])
            .strip())


# Structure-agnostic extractor — works with LinkedIn's hashed class names.
# Walks up from each /in/ link to find the card boundary, extracts text lines.
_EXTRACT_JS = r"""(function(){
  var links = document.querySelectorAll('a[href*="/in/"]');
  var seen = {};
  var results = [];
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var rawHref = a.href.split('?')[0];
    // Skip non-profile links (e.g. recommendations, ads)
    if (!rawHref.match(/linkedin\.com\/in\/[^/]+\/?$/)) continue;
    if (seen[rawHref]) continue;
    // Walk up to find card: smallest ancestor that contains exactly one /in/ link
    var card = a;
    for (var d = 0; d < 8; d++) {
      var p = card.parentElement;
      if (!p) break;
      if (p.querySelectorAll('a[href*="/in/"]').length === 1) { card = p; }
      else break;
    }
    seen[rawHref] = 1;
    // Extract text lines from card, skip noise
    var lines = (card.innerText || '').split('\n')
      .map(function(l){ return l.trim(); })
      .filter(function(l){ return l.length > 1 && l.length < 200; });
    // Heuristic: first meaningful line = name, second = headline, third = location
    var name = '', headline = '', location = '', mutual = 0;
    var skip = ['connect','message','follow','pending','1st','2nd','3rd','•','·'];
    var clean = lines.filter(function(l){
      var lo = l.toLowerCase();
      return !skip.some(function(s){ return lo === s || lo.startsWith(s+' '); });
    });
    var mutMatch = (card.innerText||'').match(/(\d+)\s*mutual/i);
    // Strip degree markers from each line
    var stripDeg = function(s){ return s.replace(/\s*[•·]\s*(1st|2nd|3rd|[123]st|[123]nd|[123]rd)\b.*/i,'').trim(); };
    // Filter lines that look like mutual connections text
    var noMutual = clean.filter(function(l){ return !l.match(/mutual|connection/i); });
    name     = stripDeg(noMutual[0] || '');
    headline = noMutual[1] || '';
    location = noMutual[2] || '';
    if (mutMatch) mutual = parseInt(mutMatch[1]);
    if (name && rawHref) {
      results.push({
        name: name, profileUrl: rawHref,
        headline: headline.substring(0,150),
        location: location.substring(0,80),
        mutualConnections: mutual
      });
    }
    if (results.length >= 25) break;
  }
  return JSON.stringify(results);
})()"""


def _li_js(js: str) -> str:
    """Run JS in the front Safari document via osascript subprocess."""
    with open('/tmp/li_p_extract.js', 'w', encoding='utf-8') as f:
        f.write(js)
    scpt = (
        'set jsCode to read POSIX file "/tmp/li_p_extract.js" as \xabclass utf8\xbb\n'
        'tell application "Safari" to do JavaScript jsCode in front document\n'
    )
    r = subprocess.run(['osascript', '-e', scpt], capture_output=True, text=True, timeout=20)
    return r.stdout.strip()


def _li_nav(url: str, wait: float = 5.0):
    """Navigate front Safari document to url, wait for it to load."""
    safe = url.replace('"', '%22')
    subprocess.run(
        ['osascript', '-e',
         f'tell application "Safari"\n'
         f'  set URL of front document to "{safe}"\n'
         f'  activate\n'
         f'end tell'],
        capture_output=True, timeout=10
    )
    time.sleep(wait)


def _li_poll_js(js: str, max_wait: float = 12.0) -> str:
    """Poll js until non-empty/non-zero result."""
    deadline = time.time() + max_wait
    while time.time() < deadline:
        r = _li_js(js)
        if r and r not in ('0', 'null', 'undefined', 'false', '[]', ''):
            return r
        time.sleep(0.8)
    return ''


def li_search_people(query: str, max_results: int = 50, icp: dict = None, config: dict = None) -> list:
    """
    Search LinkedIn People Search using direct osascript. Returns scored profiles.
    """
    print(f"\n  🔍 Searching: '{query}' (max {max_results})")
    icp_cfg = icp or {}

    encoded = urllib.parse.quote_plus(query)
    search_url = f"https://www.linkedin.com/search/results/people/?keywords={encoded}"
    _li_nav(search_url, wait=5)

    # Wait for profile links to appear
    ready = _li_poll_js(
        'document.querySelectorAll(\'a[href*="/in/"]\').length + ""',
        max_wait=15
    )
    if not ready or ready == '0':
        print("  ⚠️  No profile links found — page may not have loaded.")
        return []

    all_profiles = []
    seen_urls: set = set()
    page = 1

    while len(all_profiles) < max_results:
        # Scroll to load lazy content
        for _ in range(3):
            _li_js('window.scrollBy(0,700)')
            time.sleep(0.4)

        raw = _li_js(_EXTRACT_JS)
        try:
            cards = json.loads(raw or '[]')
        except Exception:
            cards = []

        new = [c for c in cards if c.get('profileUrl') and c['profileUrl'] not in seen_urls]
        for c in new:
            seen_urls.add(c['profileUrl'])
            headline = c.get('headline', '')
            title, company = _parse_title_company(headline)
            profile = {
                'full_name':         c.get('name', ''),
                'profile_url':       c['profileUrl'],
                'headline':          headline,
                'location':          c.get('location', ''),
                'current_title':     title,
                'current_company':   company,
                'about_snippet':     '',
                'shared_connections': int(c.get('mutualConnections') or 0),
                'search_query':      query,
                'scraped_at':        utcnow(),
                'icp_config_id':     config.get('offer', {}).get('name', '') if config else '',
            }
            if icp:
                score, reasons = score_fit(profile, icp)
            else:
                score, reasons = 0, []
            profile['fit_score']   = score
            profile['fit_reasons'] = reasons
            profile['stage']       = ('qualified'
                                      if score >= icp_cfg.get('min_score_to_qualify', 25)
                                      else 'not_fit')
            all_profiles.append(profile)

        print(f"    Page {page}: +{len(new)} | total {len(all_profiles)}")

        if len(all_profiles) >= max_results:
            break

        # Next page
        clicked = _li_js(
            '(function(){var b=document.querySelector(\'button[aria-label*="Next"]\');'
            'if(b&&!b.disabled){b.click();return"clicked";}return"no_next";})()'
        )
        if clicked != 'clicked':
            break
        page += 1
        time.sleep(3)
        _li_poll_js('document.querySelectorAll(\'a[href*="/in/"]\').length+""', max_wait=8)

    return all_profiles[:max_results]


def _normalise_url(url: str) -> str:
    if not url:
        return ''
    import re
    m = re.search(r'(/in/[^/?#]+)', url)
    return f'https://www.linkedin.com{m.group(1)}/' if m else url


def _parse_title_company(headline: str) -> tuple:
    for sep in [' at ', ' | ', ' · ', ' - ']:
        if sep in headline:
            parts = headline.split(sep, 1)
            return parts[0].strip()[:100], parts[1].strip()[:100]
    return headline[:100], ''


def li_send_connection_request(profile: dict, note: str, dry_run: bool = False) -> tuple[bool, str]:
    """
    Navigate to a LinkedIn profile and send a connection request with a personalized note.
    Uses direct osascript (proven reliable). Returns (success, detail).
    """
    profile_url = profile.get('profile_url', '')
    name = profile.get('full_name', 'Unknown')

    if dry_run:
        print(f"    [dry-run] would connect: {name} — {profile_url}")
        return True, 'dry_run'

    _li_nav(profile_url, wait=5)

    # Poll for profile card to be ready
    ready = _li_poll_js(
        '(function(){var m=document.querySelector("main");return m&&m.querySelector("section")?"yes":"";})()',
        max_wait=12
    )
    if not ready:
        return False, 'profile page did not load'

    # Check current relationship status
    status = _li_js(r"""(function(){
  var m=document.querySelector("main");
  if(!m)return"no_main";
  var s=m.querySelector("section");
  if(!s)return"no_section";
  var txt=(s.innerText||"").toLowerCase();
  // Check for already connected / pending
  if(txt.indexOf("message")!==-1 && txt.indexOf("connect")===-1) return"connected";
  if(txt.indexOf("pending")!==-1) return"pending";
  // Look for Connect button/link
  var all=[].slice.call(s.querySelectorAll("button,a"));
  for(var i=0;i<all.length;i++){
    var a=(all[i].getAttribute("aria-label")||"").toLowerCase();
    var t=(all[i].innerText||"").trim().toLowerCase();
    if(a.indexOf("connect")!==-1||a.indexOf("invite")!==-1||t==="connect") return"can_connect";
  }
  if(txt.indexOf("more")!==-1) return"try_more";
  return"unknown";
})()""")

    if status in ('connected', 'pending'):
        return False, f'skip: {status}'

    # If Connect is in the "More" dropdown, open it first
    if status == 'try_more':
        _li_js(r"""(function(){
  var m=document.querySelector("main");
  var s=m&&m.querySelector("section");
  if(!s)return;
  var btns=[].slice.call(s.querySelectorAll("button,a"));
  for(var i=0;i<btns.length;i++){
    var t=(btns[i].innerText||btns[i].getAttribute("aria-label")||"").trim().toLowerCase();
    if(t==="more"){btns[i].click();return;}
  }
})()""")
        time.sleep(1)
        # Re-check after opening More
        status = _li_js(r"""(function(){
  var items=[].slice.call(document.querySelectorAll('[role="menuitem"],li'));
  for(var i=0;i<items.length;i++){
    if((items[i].innerText||"").trim().toLowerCase()==="connect"){items[i].click();return"clicked_more";}
  }
  return"not_found_more";
})()""")
        if status != 'clicked_more':
            return False, f'Connect not found in More menu ({status})'
        time.sleep(1.5)

    elif status == 'can_connect':
        # Click the Connect button directly
        result = _li_js(r"""(function(){
  var m=document.querySelector("main");
  var s=m&&m.querySelector("section");
  if(!s)return"no_section";
  var all=[].slice.call(s.querySelectorAll("button,a"));
  for(var i=0;i<all.length;i++){
    var a=(all[i].getAttribute("aria-label")||"").toLowerCase();
    var t=(all[i].innerText||"").trim().toLowerCase();
    if(a.indexOf("connect")!==-1||a.indexOf("invite")!==-1||t==="connect"){all[i].click();return"clicked";}
  }
  return"not_found";
})()""")
        if result != 'clicked':
            return False, f'Connect button not found ({result})'
        time.sleep(1.5)

    else:
        return False, f'Cannot connect: status={status}'

    # Add personalized note if a modal appeared
    modal_ready = _li_poll_js(
        'document.querySelector(".send-invite__actions,button[aria-label*=\'note\'],button[aria-label*=\'Note\']") ? "yes" : ""',
        max_wait=5
    )
    if modal_ready and note:
        # Click "Add a note"
        clicked_note = _li_js(r"""(function(){
  var btns=[].slice.call(document.querySelectorAll("button"));
  for(var i=0;i<btns.length;i++){
    var a=(btns[i].getAttribute("aria-label")||"").toLowerCase();
    var t=(btns[i].innerText||"").trim().toLowerCase();
    if(a.indexOf("add a note")!==-1||t==="add a note"){btns[i].click();return"clicked";}
  }
  return"not_found";
})()""")
        if clicked_note == 'clicked':
            time.sleep(0.8)
            # Focus textarea and paste note via clipboard
            _li_js('(function(){var t=document.querySelector("#custom-message,textarea[name=message],textarea");if(t){t.click();t.focus();}})()')
            time.sleep(0.3)
            subprocess.run(['pbcopy'], input=note.encode('utf-8'), check=True)
            subprocess.run(
                ['osascript', '-e',
                 'tell application "Safari" to activate\n'
                 'delay 0.2\n'
                 'tell application "System Events" to keystroke "v" using command down'],
                capture_output=True
            )
            time.sleep(0.5)

    # Click Send
    sent = _li_js(r"""(function(){
  var btns=[].slice.call(document.querySelectorAll("button"));
  for(var i=0;i<btns.length;i++){
    var a=(btns[i].getAttribute("aria-label")||"").toLowerCase();
    var t=(btns[i].innerText||"").trim().toLowerCase();
    if(!btns[i].disabled&&(t==="send"||t==="send invitation"||t==="send without a note"||a.indexOf("send")!==-1)){btns[i].click();return"sent";}
  }
  return"not_found";
})()""")

    if sent == 'sent':
        return True, f'connection request sent (note: {len(note)} chars)'
    return False, f'send button not found ({sent})'


# ── Pipeline functions ────────────────────────────────────────────────────────
def run_search(queries: list, max_per_query: int, config: dict, dry_run: bool = False) -> dict:
    """Run all search queries, score prospects, upsert to Supabase."""
    icp = config.get('icp', {})

    total_found = 0
    total_qualified = 0
    total_upserted = 0

    for query in queries:
        profiles = li_search_people(query, max_results=max_per_query, icp=icp, config=config)
        if not profiles:
            continue

        qualified = [p for p in profiles if p.get('stage') == 'qualified']
        total_found += len(profiles)
        total_qualified += len(qualified)

        # Print summary
        for p in profiles[:5]:
            flag = '✅' if p.get('stage') == 'qualified' else '·'
            print(f"    {flag} [{p['fit_score']:3d}] {p.get('full_name','?')[:30]:30s} | {(p.get('headline','')[:50])}")

        if len(profiles) > 5:
            print(f"    ... and {len(profiles)-5} more")

        if not dry_run:
            n = _upsert_prospects(profiles)
            total_upserted += n
            print(f"  📦 Upserted {n} prospects for query: '{query}'")

    return {'found': total_found, 'qualified': total_qualified, 'upserted': total_upserted}


def run_connect(limit: int, config: dict, dry_run: bool = False) -> dict:
    """Send connection requests to qualified prospects not yet contacted."""
    notes_templates = config.get('connection_notes', [
        "Hey {first_name}! I'd love to connect and learn more about your work."
    ])

    prospects = _get_prospects(stage='qualified', limit=limit)
    if not prospects:
        print("  No qualified prospects to connect with.")
        return {'attempted': 0, 'succeeded': 0}

    print(f"\n  📤 Sending connection requests to {len(prospects)} qualified prospects...")
    succeeded = 0
    failed = 0

    for p in prospects:
        name = p.get('full_name', '?')
        score = p.get('fit_score', 0)
        note = generate_connection_note(p, notes_templates)
        print(f"\n  → [{score:3d}] {name[:40]} | {(p.get('headline','')[:50])}")
        print(f"       Note: {note[:80]}...")

        ok, detail = li_send_connection_request(p, note, dry_run=dry_run)
        status = '✅' if ok else '❌'
        print(f"       {status} {detail}")

        if ok:
            succeeded += 1
            if not dry_run:
                _update_prospect(p['profile_url'], {
                    'stage': 'connection_sent',
                    'connection_note': note,
                    'contacted_at': utcnow(),
                })
        else:
            failed += 1

        # Rate limit: ~10 connection requests/day is safe; be conservative
        if not dry_run:
            time.sleep(random.uniform(8, 15))

    return {'attempted': len(prospects), 'succeeded': succeeded, 'failed': failed}


def show_status():
    """Print pipeline stats."""
    stages = ['new', 'qualified', 'not_fit', 'connection_sent',
              'connected', 'messaged', 'responded', 'booked', 'closed_won', 'closed_lost']
    print("\n" + "=" * 60)
    print("LINKEDIN PROSPECT PIPELINE STATUS")
    print("=" * 60)
    for stage in stages:
        rows = _get_prospects(stage=stage, limit=500)
        if rows:
            avg_score = sum(r.get('fit_score', 0) for r in rows) // len(rows)
            print(f"  {stage:20s}  {len(rows):4d} prospects  (avg score: {avg_score})")
    # Top 10 qualified
    top = _get_prospects(stage='qualified', min_score=40, limit=10)
    if top:
        print("\n  TOP QUALIFIED PROSPECTS:")
        for p in top:
            print(f"    [{p['fit_score']:3d}] {p.get('full_name','?')[:35]:35s} | {p.get('headline','')[:50]}")
    print("=" * 60)


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    args = sys.argv[1:]
    dry_run = "--dry-run" in args

    config = load_config()

    if "--status" in args:
        show_status()
        sys.exit(0)

    # Parse --query override
    custom_query = None
    for i, a in enumerate(args):
        if a == '--query' and i + 1 < len(args):
            custom_query = args[i + 1]
        elif a.startswith('--query='):
            custom_query = a.split('=', 1)[1]

    # Parse --limit
    limit = 30
    for i, a in enumerate(args):
        if a == '--limit' and i + 1 < len(args):
            limit = int(args[i + 1])
        elif a.startswith('--limit='):
            limit = int(a.split('=', 1)[1])

    queries = [custom_query] if custom_query else config.get('search_queries', [])

    if "--search" in args or "--pipeline" in args:
        print("=" * 60)
        print(f"LINKEDIN PROSPECTING — SEARCH")
        print(f"Offer: {config['offer']['name']}")
        print(f"Queries: {len(queries)}  |  Limit: {limit}/query  |  Dry run: {dry_run}")
        print("=" * 60)
        stats = run_search(queries, limit, config, dry_run=dry_run)
        print(f"\n  ✅ Done: {stats['found']} found, {stats['qualified']} qualified, {stats['upserted']} upserted")

    if "--connect" in args or "--pipeline" in args:
        print("\n" + "=" * 60)
        print("LINKEDIN PROSPECTING — CONNECT")
        print("=" * 60)
        stats = run_connect(limit, config, dry_run=dry_run)
        print(f"\n  ✅ Connection requests: {stats.get('succeeded',0)} sent, {stats.get('failed',0)} failed")

    if not any(a in args for a in ('--search', '--connect', '--pipeline', '--status')):
        print(__doc__)
        sys.exit(1)

    show_status()
