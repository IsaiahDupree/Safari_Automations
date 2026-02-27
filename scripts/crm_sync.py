#!/usr/bin/env python3
"""
crm_sync.py — Pull all inbox data from IG/TW/TT and upsert to Supabase crm_contacts + crm_messages.
Usage: python3 crm_sync.py [--dry-run] [--platform instagram|twitter|tiktok]
"""
import json, time, sys, urllib.request, urllib.error, hashlib, subprocess
from datetime import datetime, timezone

def utcnow():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

import os
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("CRM_SUPABASE_URL") or "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("CRM_SUPABASE_ANON_KEY") or "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y"

SERVICES = {
    "instagram": {
        "base":         "http://localhost:3100",
        "conversations":"/api/conversations/all",
        "open":         "/api/conversations/open",
        "messages":     "/api/messages",
        "top_contacts": "/api/crm/top-contacts",
        "stats":        "/api/crm/stats",
    },
    "twitter": {
        "base":         "http://localhost:3003",
        "conversations":"/api/twitter/conversations",
        "open":         "/api/twitter/conversations/open",
        "messages":     "/api/twitter/messages",
        "top_contacts": "/api/twitter/crm/top-contacts",
        "stats":        "/api/twitter/crm/stats",
    },
    "tiktok": {
        "base":         "http://localhost:3102",
        "conversations":"/api/tiktok/conversations",
        "open":         "/api/tiktok/conversations/open",
        "messages":     "/api/tiktok/messages",
        "top_contacts": "/api/tiktok/crm/top-contacts",
        "stats":        "/api/tiktok/crm/stats",
    },
    "linkedin": {
        "base":         "http://localhost:3105",
        "conversations":"/api/linkedin/conversations",
        "open":         "/api/linkedin/messages/open",
        "messages":     "/api/linkedin/messages",
        "top_contacts": None,
        "stats":        None,
    },
}

# ---------- HTTP helpers ----------

def http_get(url, timeout=20):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:
        return None, str(e)[:80]

def http_post(url, body, timeout=30):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
          headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:
        return None, str(e)[:80]

# Conflict columns per table — used in ?on_conflict= query param
ON_CONFLICT = {
    "crm_contacts": "platform,username",
    "crm_messages": "platform,username,message_id",
}

def supabase_upsert(table, rows, dry_run=False):
    if not rows:
        return 0, None
    if dry_run:
        print(f"    [DRY RUN] would upsert {len(rows)} rows to {table}")
        return len(rows), None
    data = json.dumps(rows).encode()
    conflict = ON_CONFLICT.get(table, "")
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if conflict:
        url += f"?on_conflict={conflict}"
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return len(rows), None
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        return 0, f"HTTP {e.code}: {body}"
    except Exception as e:
        return 0, str(e)[:120]

# ---------- Platform sync ----------

INBOX_URLS = {
    "instagram": "https://www.instagram.com/direct/inbox/",
    "twitter":   "https://x.com/messages",
    "tiktok":    "https://www.tiktok.com/messages",
    "linkedin":  "https://www.linkedin.com/messaging/",
}

# Stores (window_idx, tab_idx) after navigate so scrape targets the exact tab
_nav_state = {}  # platform -> (int, int)

def navigate_safari_to(platform, wait=5):
    """Navigate the first matching domain tab to the inbox URL. Stores window+tab index."""
    url = INBOX_URLS[platform]
    domain = url.split('/')[2]  # e.g. 'www.instagram.com'
    scpt = (
        'tell application "Safari"\n'
        '  repeat with w from 1 to count of windows\n'
        '    repeat with t from 1 to count of tabs of window w\n'
        f'      if URL of tab t of window w contains "{domain}" then\n'
        f'        set URL of tab t of window w to "{url}"\n'
        '        set current tab of window w to tab t of window w\n'
        '        return (w as string) & "," & (t as string)\n'
        '      end if\n'
        '    end repeat\n'
        '  end repeat\n'
        f'  set URL of front document to "{url}"\n'
        '  return "1,1"\n'
        'end tell\n'
    )
    with open(f'/tmp/nav_{platform}.scpt', 'w') as fh:
        fh.write(scpt)
    r = subprocess.run(['osascript', f'/tmp/nav_{platform}.scpt'], capture_output=True, text=True)
    raw = r.stdout.strip()
    try:
        parts = raw.split(',')
        _nav_state[platform] = (int(parts[0]), int(parts[1]))
    except Exception:
        _nav_state[platform] = None
    time.sleep(wait)

def _build_js_for_platform(platform):
    """Return JS string that scrapes the inbox and returns JSON array of 'name|lastMsg|unread' strings."""
    if platform == "instagram":
        # Instagram 2025+: Thread list with ~72px tall DIV rows.
        # Unread = any span in the row has font-weight >= 700 (bold).
        return (
            "(function(){"
            "var c=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
            "if(!c)return JSON.stringify([]);"
            "var spans=c.querySelectorAll('span');"
            "var rowMap={};"
            "for(var i=0;i<spans.length;i++){"
            "  var t=(spans[i].innerText||'').trim();"
            "  if(spans[i].children.length===0&&t.length>1&&t.length<80){"
            "    var el=spans[i];"
            "    for(var j=0;j<10;j++){"
            "      el=el.parentElement;if(!el)break;"
            "      var r2=el.getBoundingClientRect();"
            "      if(r2.height>65&&r2.height<90&&r2.width>300){"
            "        var key=Math.round(r2.top);"
            "        if(!rowMap[key])rowMap[key]={texts:[],unread:false,el:el};"
            "        rowMap[key].texts.push(t);"
            "        var fw=parseInt(window.getComputedStyle(spans[i]).fontWeight)||400;"
            "        if(fw>=700)rowMap[key].unread=true;"
            "        break;"
            "      }"
            "    }"
            "  }"
            "}"
            "var keys=Object.keys(rowMap).map(Number).sort(function(a,b){return a-b;});"
            "var out=[];"
            "for(var k=0;k<keys.length&&out.length<500;k++){"
            "  var row=rowMap[keys[k]];"
            "  var name=row.texts[0]||'';"
            "  var skip={'Hidden requests':1,'Message requests':1,'Decide who can message you':1};"
            "  if(!name||name.length<2||skip[name])continue;"
            "  var msg=row.texts.length>1?row.texts[row.texts.length-1]:'';"
            "  out.push(name+'|'+msg+'|'+(row.unread?'1':'0'));"
            "}"
            "return JSON.stringify(out);"
            "})()"
        )
    else:
        sel_map = {
            "tiktok":   "[class*=LiInboxItemWrapper]",
            "twitter":  "[data-testid^=dm-conversation-item]",
            "linkedin": ".msg-conversation-listitem__link",
        }
        sel = sel_map.get(platform, "[class*=conversation]")
        return (
            "(function(){"
            "var rows=document.querySelectorAll('" + sel + "');"
            "var out=[];"
            "for(var i=0;i<rows.length&&i<200;i++){"
            r"var t=(rows[i].innerText||'').replace(/\n+/g,'|').trim();"
            "var r=rows[i].getBoundingClientRect();"
            "if(r.height>0&&t.length>2)out.push(t.substring(0,200));"
            "}"
            "return JSON.stringify(out);"
            "})()"
        )


def _poll_for_element(platform, js_test, max_wait=6.0, interval=0.4):
    """
    Poll until js_test returns a truthy value (not '0','false','null','').
    Returns the truthy result string or '' if timeout.
    """
    deadline = time.time() + max_wait
    while time.time() < deadline:
        result = _run_js_in_tab(platform, js_test)
        if result and result.lower() not in ('0', 'false', 'null', 'undefined', ''):
            return result
        time.sleep(interval)
    return ''


def _ig_click_convo_js(display_name):
    """
    JS to scroll the Thread list (xb57i2i container) until the target name is
    visible, then click the row. Scrolls from current position downward in steps.
    Returns 'clicked', 'not found', or 'no thread list'.
    """
    safe = display_name.replace("'", "\\'").replace("\\", "\\\\")
    return (
        "(function(){"
        f"var name='{safe}';"
        "var tl=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
        "if(!tl)return 'no thread list';"
        # Find the scrollable container inside Thread list
        "var sc=null;"
        "var all=tl.querySelectorAll('div');"
        "for(var i=0;i<all.length;i++){{"
        "  if(all[i].scrollHeight>all[i].clientHeight+50&&all[i].clientHeight>200){{"
        "    sc=all[i];break;"
        "  }}"
        "}}"
        # Helper: try to find and click the name in currently visible rows
        "function tryClick(){{"
        "  var spans=tl.querySelectorAll('span');"
        "  for(var i=0;i<spans.length;i++){{"
        "    if((spans[i].innerText||'').trim()===name&&spans[i].children.length===0){{"
        "      var el=spans[i];"
        "      for(var j=0;j<12;j++){{"
        "        el=el.parentElement;if(!el)break;"
        "        var r=el.getBoundingClientRect();"
        "        if(r.height>60&&r.width>200){{el.click();return true;}}"
        "      }}"
        "    }}"
        "  }}"
        "  return false;"
        "}}"
        # Try at current scroll position first
        "if(tryClick())return 'clicked';"
        # If no scroll container found, give up
        "if(!sc)return 'not found (no scroll container)';"
        # Scroll from top in steps
        "var savedST=sc.scrollTop;"
        "sc.scrollTop=0;"
        "var step=Math.max(300,sc.clientHeight*0.7);"
        "var maxST=sc.scrollHeight;"
        "for(var s=0;s<=maxST;s+=step){{"
        "  sc.scrollTop=s;"
        "  if(tryClick())return 'clicked';"
        "}}"
        # Restore scroll position and give up
        "sc.scrollTop=savedST;"
        "return 'not found';"
        "})()"
    )


def ig_scrape_open_conversation(username=""):
    """
    Scrape visible messages from the currently open Instagram right pane.
    Detection rules (from DOM probe):
      - Skip anything in Thread list (left pane)
      - Skip leaf elements with h < 14px (timestamps, dividers)
      - Skip first 2 items (name header + handle)
      - Skip UI chrome strings (Message..., etc.)
      - Outbound: element x > 750 (right-aligned bubbles)
      - Inbound: element x < 750 (left-aligned bubbles)
    Returns list of {text, is_outbound} dicts.
    """
    scrape_js = (
        "(function(){"
        "var tl=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
        "var skip={'Message...':1,'Send message':1,'Send a message to start a chat.':1,"
        "'View transcription':1,'Like':1,'Reply':1,'Unsend':1,'React':1,'More':1,"
        "'Active now':1,'Active today':1,'Active yesterday':1,'·':1};"
        "var out=[];"
        "var headerSkip=2;"  # first 2 right-pane leaves are name + handle
        "var all=document.querySelectorAll('span,div,p');"
        "var vw=window.innerWidth;"
        "var midX=vw*0.55;"  # outbound bubbles are right-aligned (x > ~55% viewport)
        "for(var i=0;i<all.length;i++){"
        "  var el=all[i];"
        "  if(tl&&tl.contains(el))continue;"
        "  if(el.children.length>0)continue;"
        "  var t=(el.innerText||'').trim();"
        "  if(!t||t.length<2||t.length>1000)continue;"
        "  if(skip[t])continue;"
        "  var r=el.getBoundingClientRect();"
        "  if(r.height<14||r.width<20)continue;"  # skip timestamps (h≈11) and dividers
        "  if(r.width>vw*0.8)continue;"  # skip full-width containers
        # Skip header rows (name + handle at top of pane)
        "  if(headerSkip>0){headerSkip--;continue;}"
        "  var isOut=r.left>midX;"
        "  out.push({text:t.substring(0,1000),out:isOut});"
        "  if(out.length>=200)break;"
        "}"
        "return JSON.stringify(out);"
        "})()"
    )
    raw = _run_js_in_tab("instagram", scrape_js)
    try:
        return json.loads(raw or '[]')
    except Exception:
        return []


IG_TAB_URLS = {
    "Primary":        "https://www.instagram.com/direct/inbox/",
    "General":        "https://www.instagram.com/direct/general/",
    "Requests":       "https://www.instagram.com/direct/requests/",
    "HiddenRequests": "https://www.instagram.com/direct/requests/hidden/",
}

# JS that returns currently rendered rows as [{name, top}] sorted top-to-bottom
_IG_GET_VISIBLE_ROWS_JS = (
    "(function(){"
    "var tl=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
    "if(!tl)return '[]';"
    "var vh=window.innerHeight;"
    "var spans=tl.querySelectorAll('span');"
    "var seen={};var rows=[];"
    "var skip={'Hidden requests':1,'Hidden Requests':1,'Message requests':1,"
    "  'Your note':1,'Decide who can message you':1,'Delete all':1,"
    "  'Message requests':1,'New message':1,'Search':1,'Edit':1};"
    "for(var i=0;i<spans.length;i++){"
    "  var t=(spans[i].innerText||'').trim();"
    "  if(!t||t.length<2||t.length>80||spans[i].children.length>0)continue;"
    "  if(skip[t])continue;"
    "  var el=spans[i];"
    "  for(var j=0;j<12;j++){"
    "    el=el.parentElement;if(!el)break;"
    "    var r=el.getBoundingClientRect();"
    "    if(r.height>60&&r.width>200){"
    # Only include rows actually visible in the viewport
    "      if(r.top>=60&&r.bottom<=vh+10){"
    "        var key=Math.round(r.top*10);"
    "        if(!seen[key]){seen[key]=1;rows.push({n:t,top:Math.round(r.top)});}"
    "      }"
    "      break;"
    "    }"
    "  }"
    "}"
    "rows.sort(function(a,b){return a.top-b.top;});"
    "return JSON.stringify(rows);"
    "})()"
)

# JS that scrolls the Thread list container down by `delta` pixels and returns new scrollTop
_IG_SCROLL_LIST_JS = (
    "(function(delta){"
    "var tl=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
    "if(!tl)return '-1|0';"
    "var all=tl.querySelectorAll('div');"
    "for(var i=0;i<all.length;i++){"
    "  if(all[i].scrollHeight>all[i].clientHeight+50&&all[i].clientHeight>200){"
    "    all[i].scrollTop+=delta;"
    "    return all[i].scrollTop+'|'+all[i].scrollHeight;"
    "  }"
    "}"
    "return '-1|0';"
    "})(DELTA_PLACEHOLDER)"
)

# JS that clicks a row by its display name (must already be rendered)
def _ig_click_row_js(name):
    safe = name.replace("'", "\\'").replace("\\", "\\\\")
    return (
        f"(function(){{"
        f"var n='{safe}';"
        "var tl=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
        "if(!tl)return 'no_list';"
        "var spans=tl.querySelectorAll('span');"
        "for(var i=0;i<spans.length;i++){{"
        "  if((spans[i].innerText||'').trim()===n&&spans[i].children.length===0){{"
        "    var el=spans[i];"
        "    for(var j=0;j<12;j++){{"
        "      el=el.parentElement;if(!el)break;"
        "      var r=el.getBoundingClientRect();"
        "      if(r.height>60&&r.width>200){{el.click();return 'clicked';}}"
        "    }}"
        "  }}"
        "}}"
        "return 'not_visible';"
        "})()"
    )


def ig_fetch_all_messages(conversations=None, dry_run=False):
    """
    Sliding-window approach: for each tab, iterate visible rows top-to-bottom,
    click each one, scrape right pane, scroll down to reveal next batch, repeat.
    No searching by name — always clicks what is currently rendered on screen.
    Order: Primary → General → Requests → HiddenRequests.
    `conversations` is used only for the unread flag lookup; pass None to auto-detect.
    """
    # Build unread lookup from conversations list if provided
    unread_set = set()
    if conversations:
        for c in conversations:
            if c.get('unread'):
                unread_set.add(c.get('username', ''))

    def nav_to(url):
        nav = _nav_state.get("instagram")
        if nav:
            win, tab = nav
            scpt = (f'tell application "Safari"\n'
                    f'  set URL of tab {tab} of window {win} to "{url}"\n'
                    f'  delay 4\nend tell\n')
        else:
            scpt = (f'tell application "Safari"\n'
                    f'  set URL of front document to "{url}"\n'
                    f'  delay 4\nend tell\n')
        with open('/tmp/ig_tab_nav.scpt', 'w') as f:
            f.write(scpt)
        subprocess.run(['osascript', '/tmp/ig_tab_nav.scpt'], capture_output=True)
        time.sleep(2.5)

    def scroll_list(delta=500):
        """Scroll Thread list by delta px. Returns (new_scrollTop, scrollHeight)."""
        raw = _run_js_in_tab("instagram", _IG_SCROLL_LIST_JS.replace(
            "DELTA_PLACEHOLDER", str(delta)))
        try:
            st, sh = raw.split('|')
            return int(st), int(sh)
        except Exception:
            return -1, 0

    message_rows = []
    now = utcnow()
    total_convos = 0
    total_msgs = 0
    processed = set()  # global across all tabs — each contact only clicked once

    tab_order = ["Primary", "General", "Requests", "HiddenRequests"]

    for tab_name in tab_order:
        tab_url = IG_TAB_URLS[tab_name]
        print(f"\n  📂 {tab_name} → {tab_url.split('instagram.com')[1]}")

        if not dry_run:
            nav_to(tab_url)
            # Wait for Thread list to be ready
            if not _poll_for_element("instagram",
                "document.querySelector('[aria-label=\\\"Thread list\\\"]') ? 'yes' : ''",
                max_wait=8):
                print(f"    ⚠️  Thread list not found — skipping {tab_name}")
                continue

        # processed is GLOBAL across tabs — don't re-click contacts seen in earlier tabs
        prev_url = _run_js_in_tab("instagram", "window.location.href")
        tab_convo_count = 0
        stall_rounds = 0

        while True:
            # Get all currently rendered rows
            raw = _run_js_in_tab("instagram", _IG_GET_VISIBLE_ROWS_JS)
            try:
                rows = json.loads(raw or '[]')
            except Exception:
                rows = []

            # Filter to rows we haven't processed yet
            new_rows = [r for r in rows if r['n'] not in processed]

            if not new_rows:
                # Scroll down and check if we got new content
                st, sh = scroll_list(500)
                time.sleep(0.6)  # let React re-render
                raw2 = _run_js_in_tab("instagram", _IG_GET_VISIBLE_ROWS_JS)
                try:
                    rows2 = json.loads(raw2 or '[]')
                except Exception:
                    rows2 = []
                new_rows2 = [r for r in rows2 if r['n'] not in processed]
                if not new_rows2 or st < 0:
                    stall_rounds += 1
                    if stall_rounds >= 2:
                        break   # reached bottom of list
                else:
                    stall_rounds = 0
                continue

            stall_rounds = 0

            # Click only the FIRST unprocessed visible row, then re-query.
            # Clicking a row scrolls the Thread list (Instagram highlights active convo),
            # which moves other rows off-screen — so we must re-query after each click.
            clicked_one = False
            for row in new_rows:
                name = row['n']
                if name in processed:
                    continue
                processed.add(name)
                is_unread = name in unread_set
                flag = '🔵' if is_unread else '  '
                tab_convo_count += 1
                total_convos += 1

                if dry_run:
                    print(f"    {flag} @{name[:40]} [dry-run]")
                    clicked_one = True
                    break

                # Click the row (it's currently rendered on screen)
                click_result = _run_js_in_tab("instagram", _ig_click_row_js(name))
                if click_result == 'no_list':
                    # Thread list gone — navigate back to this tab and retry
                    nav_to(tab_url)
                    _poll_for_element("instagram",
                        "document.querySelector('[aria-label=\\\"Thread list\\\"]') ? 'yes' : ''",
                        max_wait=8)
                    prev_url = _run_js_in_tab("instagram", "window.location.href")
                    break
                if click_result != 'clicked':
                    print(f"    {flag} @{name[:40]} ⚠️  click failed ({click_result})")
                    clicked_one = True
                    break

                # Wait for right pane to update (URL → /direct/t/...)
                deadline = time.time() + 5.0
                while time.time() < deadline:
                    url = _run_js_in_tab("instagram", "window.location.href")
                    if url != prev_url or '/direct/t/' in url:
                        prev_url = url
                        break
                    time.sleep(0.3)

                # Scrape messages from right pane
                msgs = ig_scrape_open_conversation(name)
                msg_count = len(msgs)
                total_msgs += msg_count

                for m in msgs:
                    txt = m.get('text', '') if isinstance(m, dict) else str(m)
                    if not txt:
                        continue
                    msg_id = hashlib.md5(
                        f"instagram:{name}:{txt[:40]}".encode()
                    ).hexdigest()
                    message_rows.append({
                        "platform":      "instagram",
                        "username":      name,
                        "sender":        "me" if m.get('out') else name,
                        "text":          txt[:2000],
                        "is_outbound":   bool(m.get('out', False)),
                        "message_id":    msg_id,
                        "timestamp_str": "",
                        "synced_at":     now,
                    })

                print(f"    {flag} @{name[:40]} → {msg_count} msgs")
                clicked_one = True
                break  # re-query visible rows after each click

            if not clicked_one and not new_rows:
                stall_rounds += 1  # counted in the scroll block above

        print(f"  ✅ {tab_name}: {tab_convo_count} contacts processed")

    # Deduplicate by message_id (same contact may appear in multiple tabs)
    seen_ids = set()
    deduped = []
    for m in message_rows:
        mid = m.get('message_id', '')
        if mid and mid not in seen_ids:
            seen_ids.add(mid)
            deduped.append(m)
    print(f"\n  💬 Total: {total_msgs} messages from {total_convos} conversations ({len(deduped)} unique)")
    return deduped


# ── Twitter DM sliding window ────────────────────────────────────────────────

# JS: get all currently VISIBLE conversation rows in the Twitter DM inbox
_TW_GET_VISIBLE_ROWS_JS = (
    "(function(){"
    "var rows=document.querySelectorAll('[data-testid^=dm-conversation-item]');"
    "var vh=window.innerHeight;"
    "var out=[];"
    "for(var i=0;i<rows.length;i++){"
    "  var el=rows[i];"
    "  var r=el.getBoundingClientRect();"
    "  if(r.top<60||r.bottom>vh+10)continue;"  # must be in viewport
    "  var desc=el.getAttribute('aria-description')||'';"
    "  var parts=desc.split(',');"
    "  var name=(parts[0]||'').trim();"
    "  var handle=(parts[1]||'').trim().replace('@','');"
    "  var tid=el.getAttribute('data-testid')||'';"
    "  var conv=tid.replace('dm-conversation-item-','');"
    "  var ids=conv.split(':');"
    "  var threadUrl='/messages/'+ids[0]+'-'+ids[1];"
    "  if(name)out.push({name:name,handle:handle,url:threadUrl,top:Math.round(r.top)});"
    "}"
    "return JSON.stringify(out);"
    "})()"
)

# JS: scroll the Twitter DM inbox list down by delta px
_TW_SCROLL_INBOX_JS = (
    "(function(delta){"
    "var panel=document.querySelector('[data-testid=dm-inbox-panel]');"
    "if(!panel)return '-1|0';"
    "var all=panel.querySelectorAll('div');"
    "for(var i=0;i<all.length;i++){"
    "  var el=all[i];"
    "  var ov=window.getComputedStyle(el).overflowY;"
    "  if((ov==='auto'||ov==='scroll'||ov==='overlay')&&el.clientHeight>200){"
    "    el.scrollTop+=delta;"
    "    return el.scrollTop+'|'+el.scrollHeight;"
    "  }"
    "}"
    # fallback: window scroll
    "window.scrollBy(0,delta);return window.scrollY+'|9999';"
    "})(TW_DELTA)"
)

# JS: scrape messages from the currently open Twitter DM thread
_TW_SCRAPE_MESSAGES_JS = (
    "(function(){"
    "var sc=document.querySelector('[data-testid=DmScrollerContainer]');"
    "if(!sc)return '[]';"
    "var entries=sc.querySelectorAll('[data-testid=messageEntry]');"
    "var out=[];"
    "for(var i=0;i<entries.length;i++){"
    "  var el=entries[i];"
    # Outbound: no DM_Conversation_Avatar inside the entry (my messages have no sender avatar)
    "  var hasAvatar=!!el.querySelector('[data-testid=DM_Conversation_Avatar]');"
    "  var isOut=!hasAvatar;"
    # Get text: prefer tweetText, fall back to first non-empty leaf span
    "  var tt=el.querySelector('[data-testid=tweetText]');"
    "  var txt=tt?(tt.innerText||'').trim():'';"
    "  if(!txt){"
    "    var spans=el.querySelectorAll('span');"
    "    for(var j=0;j<spans.length;j++){"
    "      var t=(spans[j].innerText||'').trim();"
    "      if(t.length>1&&spans[j].children.length===0){txt=t;break;}"
    "    }"
    "  }"
    "  if(txt)out.push({text:txt.substring(0,1000),out:isOut});"
    "}"
    "return JSON.stringify(out);"
    "})()"
)


def _tw_nav_to(url, wait=4):
    """Navigate the Twitter Safari tab to a URL."""
    nav = _nav_state.get("twitter")
    if nav:
        win, tab = nav
        scpt = (f'tell application "Safari"\n'
                f'  set URL of tab {tab} of window {win} to "{url}"\n'
                f'  delay {wait}\nend tell\n')
    else:
        scpt = (f'tell application "Safari"\n'
                f'  set URL of front document to "{url}"\n'
                f'  delay {wait}\nend tell\n')
    with open('/tmp/tw_nav.scpt', 'w') as f:
        f.write(scpt)
    subprocess.run(['osascript', '/tmp/tw_nav.scpt'], capture_output=True)
    time.sleep(1.5)


def _tw_scroll_inbox(delta=400):
    """Scroll the Twitter DM inbox list. Returns (scrollTop, scrollHeight)."""
    raw = _run_js_in_tab("twitter", _TW_SCROLL_INBOX_JS.replace("TW_DELTA", str(delta)))
    try:
        st, sh = raw.split('|')
        return int(float(st)), int(float(sh))
    except Exception:
        return -1, 0


def _tw_collect_tab_rows():
    """Sliding window over current Twitter DM tab — returns list of row dicts."""
    collected = {}   # url → row
    stall_rounds = 0
    while True:
        raw = _run_js_in_tab("twitter", _TW_GET_VISIBLE_ROWS_JS)
        try:
            rows = json.loads(raw or '[]')
        except Exception:
            rows = []
        new = [r for r in rows if r['url'] not in collected]
        if new:
            for r in new:
                collected[r['url']] = r
            stall_rounds = 0
        else:
            st, _ = _tw_scroll_inbox(400)
            time.sleep(0.6)
            raw2 = _run_js_in_tab("twitter", _TW_GET_VISIBLE_ROWS_JS)
            try:
                rows2 = json.loads(raw2 or '[]')
            except Exception:
                rows2 = []
            new2 = [r for r in rows2 if r['url'] not in collected]
            if new2:
                for r in new2:
                    collected[r['url']] = r
                stall_rounds = 0
            else:
                stall_rounds += 1
                if stall_rounds >= 2 or st < 0:
                    break
    return list(collected.values())


def tw_collect_conversations():
    """
    Phase 1: Navigate to x.com/messages, slide through All + Requests tabs,
    collect all conversation rows. Returns list of dicts compatible with
    sync_platform contact_rows builder: {username, name, url, tab, unread}.
    """
    _tw_nav_to("https://x.com/messages", wait=4)
    if not _poll_for_element("twitter",
            "document.querySelector('[data-testid=dm-inbox-panel]') ? 'yes' : ''",
            max_wait=8):
        print("  ⚠️  Twitter DM inbox panel not found")
        return []

    print("  📂 Twitter All tab")
    all_rows = _tw_collect_tab_rows()
    print(f"    → {len(all_rows)} conversations")

    req_click = _run_js_in_tab("twitter",
        "var t=document.querySelector('[data-testid=dm-inbox-tab-requests]');"
        "if(t){t.click();return 'clicked';}return 'no_tab';")
    time.sleep(1.5)
    req_rows = []
    if req_click == 'clicked':
        print("  📂 Twitter Requests tab")
        req_rows = _tw_collect_tab_rows()
        print(f"    → {len(req_rows)} conversations")

    seen_urls = set()
    result = []
    for r in (all_rows + req_rows):
        if r['url'] in seen_urls:
            continue
        seen_urls.add(r['url'])
        result.append({
            "username":     r.get('handle') or r['name'],
            "name":         r['name'],
            "url":          r['url'],
            "tab":          r.get('tab', 'all'),
            "unread":       False,   # Twitter doesn't expose unread flag via DOM easily
            "lastMessage":  "",
            "displayName":  r['name'],
        })
    print(f"  ✅ {len(result)} total unique Twitter conversations")
    return result


def tw_fetch_all_messages(conversations, dry_run=False):
    """
    Phase 2: For each pre-collected Twitter conversation, navigate to
    /messages/{id1}-{id2}, wait for messageEntry, scrape messages.
    Outbound detection: messageEntry without DM_Conversation_Avatar = sent by me.
    """
    unread_set = {c.get('username', '') for c in (conversations or []) if c.get('unread')}
    message_rows = []
    now = utcnow()
    total_msgs = 0
    processed_msgs = set()

    for conv in (conversations or []):
        handle = conv.get('username') or conv.get('handle') or ''
        name   = conv.get('displayName') or conv.get('name') or handle
        url    = conv.get('url', '')
        if not url or not handle:
            continue
        is_unread = handle in unread_set
        flag = '🔵' if is_unread else '  '

        if dry_run:
            print(f"    {flag} @{handle[:40]} [dry-run]")
            continue

        _tw_nav_to(f"https://x.com{url}", wait=3)

        # Poll for at least 1 messageEntry inside DmScrollerContainer
        loaded = False
        for _ in range(12):
            cnt = _run_js_in_tab("twitter",
                "(function(){var sc=document.querySelector('[data-testid=DmScrollerContainer]');"
                "if(!sc)return 0;"
                "return sc.querySelectorAll('[data-testid=messageEntry]').length;})()")
            try:
                if int(float(cnt or '0')) > 0:
                    loaded = True
                    break
            except Exception:
                pass
            time.sleep(0.4)

        if not loaded:
            print(f"    {flag} @{handle[:40]} ⚠️  messages not loaded")
            continue

        raw = _run_js_in_tab("twitter", _TW_SCRAPE_MESSAGES_JS)
        try:
            msgs = json.loads(raw or '[]')
        except Exception:
            msgs = []

        msg_count = 0
        for m in msgs:
            txt = (m.get('text') or '').strip()
            if not txt:
                continue
            msg_id = hashlib.md5(f"twitter:{handle}:{txt[:40]}".encode()).hexdigest()
            if msg_id in processed_msgs:
                continue
            processed_msgs.add(msg_id)
            message_rows.append({
                "platform":      "twitter",
                "username":      handle,
                "sender":        "me" if m.get('out') else handle,
                "text":          txt[:2000],
                "is_outbound":   bool(m.get('out', False)),
                "message_id":    msg_id,
                "timestamp_str": "",
                "synced_at":     now,
            })
            msg_count += 1

        total_msgs += msg_count
        print(f"    {flag} @{handle[:40]} → {msg_count} msgs")

    print(f"\n  💬 Total: {total_msgs} messages from {len(conversations or [])} conversations")
    return message_rows


# ── TikTok DM sliding window ─────────────────────────────────────────────────

# JS: get ALL chat-list-item rows with name, uniqueid index (all are in DOM)
_TK_GET_ALL_ROWS_JS = (
    "(function(){"
    "var rows=document.querySelectorAll('[data-e2e=chat-list-item]');"
    "var out=[];"
    "for(var i=0;i<rows.length;i++){"
    "  var el=rows[i];"
    "  var spans=el.querySelectorAll('span,p');"
    "  var name='';"
    "  for(var j=0;j<spans.length;j++){"
    "    var t=(spans[j].innerText||'').trim();"
    "    if(t&&spans[j].children.length===0&&t.length>1&&t.length<80){name=t;break;}"
    "  }"
    "  if(name)out.push({name:name,idx:i});"
    "}"
    "return JSON.stringify(out);"
    "})()"
)

# JS: scroll row[idx] into view then click it. Returns 'clicked' or 'not_found'.
def _tk_click_row_js(idx):
    return (
        "(function(){"
        f"var rows=document.querySelectorAll('[data-e2e=chat-list-item]');"
        f"var el=rows[{idx}];"
        "if(!el)return 'not_found';"
        "el.scrollIntoView({block:'center'});"
        "el.click();"
        "return 'clicked';"
        "})()"
    )

# JS: scrape messages from the open TikTok conversation right pane
_TK_SCRAPE_MESSAGES_JS = (
    "(function(){"
    "var items=document.querySelectorAll('[data-e2e=chat-item]');"
    "var vw=window.innerWidth;"
    "var mid=vw*0.5;"
    "var out=[];"
    "for(var i=0;i<items.length;i++){"
    "  var el=items[i];"
    # Outbound: avatar is on the RIGHT side (avatarX > mid)
    "  var av=el.querySelector('[data-e2e=chat-avatar]');"
    "  var avX=av?av.getBoundingClientRect().left:-1;"
    "  var isOut=(avX>mid);"
    # Get message text: first leaf span/p with meaningful content
    "  var spans=el.querySelectorAll('span,p,div');"
    "  var txt='';"
    "  for(var j=0;j<spans.length;j++){"
    "    var t=(spans[j].innerText||'').trim();"
    "    if(t&&spans[j].children.length===0&&t.length>1&&t.length<1000){"
    "      txt=t;break;"
    "    }"
    "  }"
    "  if(txt)out.push({text:txt.substring(0,1000),out:isOut});"
    "}"
    "return JSON.stringify(out);"
    "})()"
)

# JS: get current right-pane identity (nickname + uniqueid) to detect pane change
_TK_GET_PANE_IDENTITY_JS = (
    "(function(){"
    "var n=document.querySelector('[data-e2e=chat-nickname]');"
    "var u=document.querySelector('[data-e2e=chat-uniqueid]');"
    "return (n?(n.innerText||'').trim():'')+':'+(u?(u.innerText||'').trim():'');"
    "})()"
)


def _tk_nav_to(url, wait=4):
    """Navigate the TikTok Safari tab to a URL."""
    nav = _nav_state.get("tiktok")
    if nav:
        win, tab = nav
        scpt = (f'tell application "Safari"\n'
                f'  set URL of tab {tab} of window {win} to "{url}"\n'
                f'  delay {wait}\nend tell\n')
    else:
        scpt = (f'tell application "Safari"\n'
                f'  set URL of front document to "{url}"\n'
                f'  delay {wait}\nend tell\n')
    with open('/tmp/tk_nav.scpt', 'w') as f:
        f.write(scpt)
    subprocess.run(['osascript', '/tmp/tk_nav.scpt'], capture_output=True)
    time.sleep(1.5)


def tk_collect_conversations():
    """
    Navigate to tiktok.com/messages, grab all chat-list-item rows (all are in DOM).
    Returns list of {username, name, idx, unread} dicts.
    """
    _tk_nav_to("https://www.tiktok.com/messages", wait=4)
    if not _poll_for_element("tiktok",
            "document.querySelector('[data-e2e=chat-list-item]') ? 'yes' : ''",
            max_wait=8):
        print("  ⚠️  TikTok chat-list-item not found")
        return []

    raw = _run_js_in_tab("tiktok", _TK_GET_ALL_ROWS_JS)
    try:
        rows = json.loads(raw or '[]')
    except Exception:
        rows = []

    result = []
    for r in rows:
        name = r.get('name', '')
        if not name:
            continue
        result.append({
            "username":    name,
            "name":        name,
            "displayName": name,
            "idx":         r['idx'],
            "unread":      False,
            "lastMessage": "",
        })
    print(f"  ✅ {len(result)} TikTok conversations found")
    return result


def tk_fetch_all_messages(conversations, dry_run=False):
    """
    For each TikTok conversation, scrollIntoView+click the chat-list-item row,
    wait for right pane to update, scrape chat-item messages.
    Outbound detection: chat-avatar x > viewport midpoint = sent by me.
    """
    message_rows = []
    now = utcnow()
    total_msgs = 0
    processed_msgs = set()

    # Get current pane identity before starting
    prev_identity = _run_js_in_tab("tiktok", _TK_GET_PANE_IDENTITY_JS) or ''

    for conv in (conversations or []):
        name  = conv.get('name') or conv.get('username', '')
        idx   = conv.get('idx', -1)
        flag  = '  '

        if dry_run:
            print(f"    {flag} {name[:40]} [dry-run]")
            continue

        if idx < 0:
            continue

        # Click the row
        click_result = _run_js_in_tab("tiktok", _tk_click_row_js(idx))
        if click_result != 'clicked':
            print(f"    {flag} {name[:40]} ⚠️  click failed ({click_result})")
            continue

        # Wait for right pane to show a different conversation
        deadline = time.time() + 5.0
        loaded = False
        while time.time() < deadline:
            identity = _run_js_in_tab("tiktok", _TK_GET_PANE_IDENTITY_JS) or ''
            # Also check chat-items are present
            cnt = _run_js_in_tab("tiktok",
                "document.querySelectorAll('[data-e2e=chat-item]').length")
            try:
                has_msgs = int(float(cnt or '0')) > 0
            except Exception:
                has_msgs = False
            if (identity != prev_identity or has_msgs) and identity:
                prev_identity = identity
                loaded = True
                break
            time.sleep(0.3)

        if not loaded:
            # Still try to scrape — pane may not have changed identity but content is there
            cnt = _run_js_in_tab("tiktok",
                "document.querySelectorAll('[data-e2e=chat-item]').length")
            try:
                loaded = int(float(cnt or '0')) > 0
            except Exception:
                loaded = False

        if not loaded:
            print(f"    {flag} {name[:40]} ⚠️  pane not loaded")
            continue

        # Also get the actual handle from right pane header
        identity_parts = prev_identity.split(':', 1)
        handle = identity_parts[1].lstrip('@') if len(identity_parts) > 1 else name

        raw = _run_js_in_tab("tiktok", _TK_SCRAPE_MESSAGES_JS)
        try:
            msgs = json.loads(raw or '[]')
        except Exception:
            msgs = []

        msg_count = 0
        for m in msgs:
            txt = (m.get('text') or '').strip()
            if not txt:
                continue
            msg_id = hashlib.md5(f"tiktok:{handle}:{txt[:40]}".encode()).hexdigest()
            if msg_id in processed_msgs:
                continue
            processed_msgs.add(msg_id)
            message_rows.append({
                "platform":      "tiktok",
                "username":      handle or name,
                "sender":        "me" if m.get('out') else (handle or name),
                "text":          txt[:2000],
                "is_outbound":   bool(m.get('out', False)),
                "message_id":    msg_id,
                "timestamp_str": "",
                "synced_at":     now,
            })
            msg_count += 1

        total_msgs += msg_count
        print(f"    {flag} {name[:40]} → {msg_count} msgs")

    print(f"\n  💬 Total: {total_msgs} messages from {len(conversations or [])} conversations")
    return message_rows


def _ig_click_tab_js(tab_name):
    """JS to click an Instagram DM tab by name prefix. tab_name: 'Primary','General','Requests'"""
    return (
        "(function(){"
        "var tabs=document.querySelectorAll('[role=tab]');"
        "for(var i=0;i<tabs.length;i++){"
        "  var t=(tabs[i].innerText||'').trim();"
        f"  if(t.indexOf('{tab_name}')===0){{tabs[i].click();return 'clicked:'+t;}}"
        "}"
        "return 'not found';"
        "})()"
    )


def scrape_instagram_all_tabs():
    """
    Scrape ALL Instagram DM tabs by navigating to each URL directly.
    Each tab has its own URL — direct navigation gives a fresh page load,
    which lets the scroll work properly (no React virtual-scroll blocking).
    Tabs: Primary, General, Requests, Hidden Requests (4 total).
    Returns deduplicated list of conversation dicts.
    """
    IG_TABS = [
        ("Primary",         "https://www.instagram.com/direct/inbox/"),
        ("General",         "https://www.instagram.com/direct/general/"),
        ("Requests",        "https://www.instagram.com/direct/requests/"),
        ("HiddenRequests",  "https://www.instagram.com/direct/requests/hidden/"),
    ]

    all_convs = {}  # username → conv dict (dedup)
    nav = _nav_state.get("instagram")

    for tab_name, tab_url in IG_TABS:
        print(f"  📂 Instagram tab: {tab_name}")

        # Navigate directly to the tab URL (fresh page load per tab)
        if nav:
            win, tab = nav
            nav_scpt = (
                'tell application "Safari"\n'
                f'  set URL of tab {tab} of window {win} to "{tab_url}"\n'
                '  delay 3.5\n'
                'end tell\n'
            )
        else:
            nav_scpt = (
                'tell application "Safari"\n'
                f'  set URL of front document to "{tab_url}"\n'
                '  delay 3.5\n'
                'end tell\n'
            )
        nav_path = f"/tmp/ig_nav_{tab_name.lower()}.scpt"
        with open(nav_path, "w") as fh:
            fh.write(nav_scpt)
        subprocess.run(["osascript", nav_path], capture_output=True)
        time.sleep(3.5)  # wait for page to fully load

        # Verify the URL actually loaded (Instagram sometimes redirects)
        url_check = _run_js_in_tab("instagram", "window.location.href")
        expected_slug = tab_url.split("/direct/")[1].rstrip("/")
        if expected_slug not in (url_check or ""):
            # Wait more — Instagram may have taken longer
            time.sleep(2.5)
            url_check = _run_js_in_tab("instagram", "window.location.href")
            if expected_slug not in (url_check or ""):
                print(f"    ⚠️  {tab_name}: URL mismatch (expected '{expected_slug}', got '{url_check[:60]}') — skipping")
                continue
        print(f"    🔗 {tab_name}: {url_check[:60]}")

        # Scroll to bottom on this fresh page — stable_needed=3 for thorough exhaustion
        count = scroll_until_exhausted("instagram", max_rounds=20, stable_needed=3)
        print(f"    ↕  {tab_name}: {count} conversations after full scroll")

        if count == 0:
            print(f"    ⚠️  {tab_name}: no conversations found — skipping")
            continue

        # Scrape all visible conversations
        js = _build_js_for_platform("instagram")
        scpt_path = f"/tmp/crm_ig_{tab_name.lower()}.scpt"
        if nav:
            win, t = nav
            scpt = (
                'tell application "Safari"\n'
                f'  return do JavaScript "{js}" in tab {t} of window {win}\n'
                'end tell\n'
            )
        else:
            scpt = (
                'tell application "Safari"\n'
                '  repeat with w from 1 to count of windows\n'
                '    repeat with t from 1 to count of tabs of window w\n'
                '      if URL of tab t of window w contains "instagram.com" then\n'
                '        return do JavaScript "' + js + '" in tab t of window w\n'
                '      end if\n'
                '    end repeat\n'
                '  end repeat\n'
                'end tell\n'
            )
        with open(scpt_path, "w") as fh:
            fh.write(scpt)
        r = subprocess.run(["osascript", scpt_path], capture_output=True, text=True)
        raw = r.stdout.strip()

        items = []
        try:
            items = json.loads(raw) if raw else []
        except Exception:
            try:
                items = json.loads("[" + raw + "]")
            except Exception:
                pass

        tab_count = 0
        for item in items:
            parts = str(item).strip("|").split("|")
            name = parts[0].strip()
            last_msg = parts[1].strip() if len(parts) > 1 else ""
            # part[2] = "1" means unread (bold name), "0" means read
            is_unread = parts[2].strip() == "1" if len(parts) > 2 else False
            skip = {"Hidden requests", "Message requests", "Decide who can message you"}
            if name and len(name) > 1 and name not in skip:
                if name not in all_convs:
                    all_convs[name] = {
                        "username":    name,
                        "displayName": name,
                        "lastMessage": last_msg,
                        "timestamp":   "",
                        "unread":      is_unread,
                        "tab":         tab_name,
                    }
                    tab_count += 1

        unread_in_tab = sum(1 for v in all_convs.values() if v.get('unread') and v.get('tab') == tab_name)
        print(f"    ✅ {tab_name}: {tab_count} new conversations ({unread_in_tab} unread 🔵)")

    # Navigate back to Primary inbox so ig_fetch_all_messages can click into rows
    nav = _nav_state.get("instagram")
    if nav:
        win, tab = nav
        back_scpt = f'tell application "Safari"\n  set URL of tab {tab} of window {win} to "https://www.instagram.com/direct/inbox/"\n  delay 3\nend tell\n'
    else:
        back_scpt = 'tell application "Safari"\n  set URL of front document to "https://www.instagram.com/direct/inbox/"\n  delay 3\nend tell\n'
    with open('/tmp/ig_back_primary.scpt', 'w') as f:
        f.write(back_scpt)
    subprocess.run(['osascript', '/tmp/ig_back_primary.scpt'], capture_output=True)
    time.sleep(2)

    return list(all_convs.values())


def scrape_conversations_via_osascript(platform, scroll_rounds=3):
    """Scrape inbox rows from the exact Safari tab set by navigate_safari_to."""
    scpt_path = f"/tmp/crm_{platform}.scpt"
    js = _build_js_for_platform(platform)
    nav = _nav_state.get(platform)
    if nav:
        win, tab = nav
        scpt = (
            'tell application "Safari"\n'
            f'  return do JavaScript "' + js + f'" in tab {tab} of window {win}\n'
            'end tell\n'
        )
    else:
        domain_map = {
            "tiktok":    "tiktok.com",
            "instagram": "instagram.com",
            "twitter":   "x.com",
            "linkedin":  "linkedin.com",
        }
        domain = domain_map.get(platform, platform + ".com")
        scpt = (
            'tell application "Safari"\n'
            '  repeat with w from 1 to count of windows\n'
            '    repeat with t from 1 to count of tabs of window w\n'
            f'      if URL of tab t of window w contains "{domain}" then\n'
            '        return do JavaScript "' + js + '" in tab t of window w\n'
            '      end if\n'
            '    end repeat\n'
            '  end repeat\n'
            'end tell\n'
        )
    with open(scpt_path, "w") as fh:
        fh.write(scpt)

    r = subprocess.run(["osascript", scpt_path], capture_output=True, text=True)
    raw = r.stdout.strip()
    if not raw:
        if r.stderr:
            print(f"    osascript err: {r.stderr[:100]}")
        return []

    try:
        items = json.loads(raw)
    except Exception:
        try:
            items = json.loads("[" + raw + "]")
        except Exception as e:
            print(f"    json parse error: {e} | raw[:80]: {raw[:80]}")
            return []

    conversations = []
    for item in items:
        parts = str(item).strip("|").split("|")
        name = parts[0].strip()
        last_msg = parts[1].strip() if len(parts) > 1 else ""
        ts = parts[2].strip() if len(parts) > 2 else ""
        if name and len(name) > 1:
            conversations.append({
                "username": name,
                "displayName": name,
                "lastMessage": last_msg,
                "timestamp": ts,
                "unread": False,
            })
    return conversations

def _run_js_in_tab(platform, js):
    """Run arbitrary JS in the stored nav tab for this platform. Returns raw string."""
    nav = _nav_state.get(platform)
    if nav:
        win, tab = nav
        scpt = (
            'tell application "Safari"\n'
            f'  return do JavaScript "{js}" in tab {tab} of window {win}\n'
            'end tell\n'
        )
    else:
        domain_map = {"tiktok": "tiktok.com", "instagram": "instagram.com",
                      "twitter": "x.com", "linkedin": "linkedin.com"}
        domain = domain_map.get(platform, platform + ".com")
        scpt = (
            'tell application "Safari"\n'
            '  repeat with w from 1 to count of windows\n'
            '    repeat with t from 1 to count of tabs of window w\n'
            f'      if URL of tab t of window w contains "{domain}" then\n'
            '        return do JavaScript "' + js + '" in tab t of window w\n'
            '      end if\n'
            '    end repeat\n'
            '  end repeat\n'
            'end tell\n'
        )
    path = f"/tmp/js_{platform}.scpt"
    with open(path, "w") as f:
        f.write(scpt)
    r = subprocess.run(["osascript", path], capture_output=True, text=True)
    return r.stdout.strip()


def _count_js_for_platform(platform):
    """JS that returns the integer count of loaded conversation rows."""
    if platform == "instagram":
        return (
            "(function(){"
            "var c=document.querySelector('[aria-label=\\\"Thread list\\\"]');"
            "if(!c)return 0;"
            "var spans=c.querySelectorAll('span'),keys={};"
            "for(var i=0;i<spans.length;i++){"
            "  var t=(spans[i].innerText||'').trim();"
            "  if(spans[i].children.length===0&&t.length>1&&t.length<80){"
            "    var el=spans[i];"
            "    for(var j=0;j<10;j++){"
            "      el=el.parentElement;if(!el)break;"
            "      var r=el.getBoundingClientRect();"
            "      if(r.height>65&&r.height<90&&r.width>300){keys[Math.round(r.top)]=1;break;}"
            "    }"
            "  }"
            "}"
            "return Object.keys(keys).length;"
            "})()"
        )
    else:
        sel_map = {
            "tiktok":   "[class*=LiInboxItemWrapper]",
            "twitter":  "[data-testid^=dm-conversation-item]",
            "linkedin": ".msg-conversation-listitem__link",
        }
        sel = sel_map.get(platform, "[class*=conversation]")
        return f"document.querySelectorAll('{sel}').length"


def _scroll_js_for_platform(platform):
    """JS that scrolls the inbox container down one step and returns new scrollTop."""
    if platform == "instagram":
        # Instagram virtual-scroll: the scrollable container is a div with overflow:auto
        # whose scrollHeight > clientHeight — identified by class prefix 'xb57i2i'
        # Fallback: find any auto/scroll div with scrollHeight > clientHeight + 50
        return (
            "(function(){"
            "var sc=document.querySelector('div.xb57i2i');"
            "if(!sc){"
            "  var all=document.querySelectorAll('div');"
            "  for(var i=0;i<all.length;i++){"
            "    var ov=window.getComputedStyle(all[i]).overflowY;"
            "    if(all[i].scrollHeight>all[i].clientHeight+50&&(ov==='auto'||ov==='scroll')&&all[i].clientHeight>100){"
            "      sc=all[i];break;"
            "    }"
            "  }"
            "}"
            "if(sc){sc.scrollTop=sc.scrollTop+900;return sc.scrollTop;}"
            "window.scrollBy(0,900);return window.scrollY;"
            "})()"
        )
    elif platform == "twitter":
        return (
            "(function(){"
            "var c=document.querySelector('[data-testid=DmScrollerContainer]')||"
            "document.querySelector('[data-testid=DMDrawer]')||"
            "document.querySelector('[aria-label*=imeline]');"
            "if(c){c.scrollTop=c.scrollTop+900;return c.scrollTop;}"
            "window.scrollBy(0,900);return window.scrollY;"
            "})()"
        )
    elif platform == "tiktok":
        return (
            "(function(){"
            "var c=document.querySelector('[class*=InboxItemListContainer]')||"
            "document.querySelector('[class*=inbox-list]')||"
            "document.querySelector('[class*=message-list]');"
            "if(c){c.scrollTop=c.scrollTop+900;return c.scrollTop;}"
            "window.scrollBy(0,900);return window.scrollY;"
            "})()"
        )
    else:
        return "(function(){window.scrollBy(0,900);return window.scrollY;})()"


def scroll_until_exhausted(platform, max_rounds=25, stable_needed=2):
    """
    Scroll the inbox ALL THE WAY DOWN until no new conversations appear.
    Stops when item count is stable for `stable_needed` consecutive rounds
    OR max_rounds reached. Returns final item count.
    """
    count_js  = _count_js_for_platform(platform)
    scroll_js = _scroll_js_for_platform(platform)

    prev_count = -1
    stable_streak = 0

    for rnd in range(1, max_rounds + 1):
        _run_js_in_tab(platform, scroll_js)
        time.sleep(1.8)  # let virtual DOM lazy-load

        raw = _run_js_in_tab(platform, count_js)
        try:
            count = int(float(raw or "0"))
        except Exception:
            count = 0

        if count == prev_count:
            stable_streak += 1
            if stable_streak >= stable_needed:
                print(f"  ↕  Scrolled to bottom after {rnd} rounds — {count} conversations loaded")
                return count
        else:
            stable_streak = 0
            if count > 0:
                print(f"  ↕  Round {rnd}: {count} conversations...")

        prev_count = count

    print(f"  ↕  Scroll max rounds ({max_rounds}) reached — {prev_count} items")
    return prev_count


def sync_platform(platform, cfg, message_limit=20, dry_run=False, fetch_messages=False):
    base = cfg["base"]
    print(f"\n[{platform.upper()}] checking service...")

    # Health check
    health, err = http_get(f"{base}/health", timeout=5)
    if err or not health:
        print(f"  ⚠️  Service down: {err} — skipping {platform}")
        return [], [], "service_down"

    print(f"  ✅ Service up — navigating Safari to {platform} inbox...")

    # Navigate Safari to the inbox
    navigate_safari_to(platform, wait=5)

    if platform == "instagram":
        # Instagram: scrape ALL 4 tabs (Primary + General + Requests + Hidden)
        conversations = scrape_instagram_all_tabs()
        unread_total = sum(1 for c in conversations if c.get('unread'))
        print(f"  Found {len(conversations)} total conversations across all tabs ({unread_total} unread 🔵)")
    elif platform == "twitter":
        # Twitter: slide through All + Requests tabs in DM inbox
        conversations = tw_collect_conversations()
        print(f"  Found {len(conversations)} Twitter conversations")
    elif platform == "tiktok":
        # TikTok: all rows are in DOM, grab them all at once
        conversations = tk_collect_conversations()
        print(f"  Found {len(conversations)} TikTok conversations")
    else:
        # Other platforms: scroll all the way down then scrape
        print(f"  🔄 Scrolling to bottom (exhaust all conversations)...")
        scroll_until_exhausted(platform, max_rounds=25, stable_needed=2)
        time.sleep(1)
        conversations = scrape_conversations_via_osascript(platform)
        print(f"  Found {len(conversations)} conversations via DOM scrape")

    if not conversations:
        # Fallback: try service endpoint
        convs_raw, _ = http_get(f"{base}{cfg['conversations']}", timeout=15)
        if convs_raw:
            raw = convs_raw.get("conversations", [])
            if isinstance(raw, dict):
                for tab in raw.values():
                    if isinstance(tab, list): conversations.extend(tab)
            elif isinstance(raw, list):
                conversations = raw
        print(f"  Fallback service endpoint: {len(conversations)} conversations")

    if not conversations:
        print(f"  ❌ FAIL: 0 conversations found for {platform}")
        print(f"     → Is Safari open and logged in to {platform}?")
        print(f"     → Is the inbox visible (not a different page)?")
        return [], [], "zero_conversations"

    print(f"  ✅ {len(conversations)} conversations loaded")

    # Pull top contacts for CRM scores
    top_raw, _ = http_get(f"{base}{cfg['top_contacts']}?limit=200")
    top_map = {}
    if top_raw:
        for c in top_raw.get("contacts", []):
            u = c.get("username", "")
            if u:
                top_map[u] = c

    # Pull stats
    stats_raw, _ = http_get(f"{base}{cfg['stats']}")

    contact_rows = []
    message_rows = []
    now = utcnow()

    # ── Phase 1: Build contact rows from already-scraped conversation list (fast, no Safari nav) ──
    for conv in conversations:
        username = (conv.get("username") or conv.get("handle") or "").strip()
        if not username:
            continue
        crm = top_map.get(username, {})
        raw_ts = str(conv.get("timestamp") or conv.get("updatedAt") or "").strip()
        safe_ts = raw_ts if (len(raw_ts) < 30 and (":" in raw_ts or "/" in raw_ts or "-" in raw_ts)) else ""
        contact_rows.append({
            "platform":         platform,
            "username":         username,
            "display_name":     conv.get("displayName") or conv.get("name") or username,
            "last_message":     (conv.get("lastMessage") or "")[:500],
            "last_message_at":  safe_ts or None,
            "unread":           bool(conv.get("unread", False)),
            "engagement_score": float(crm.get("engagementScore") or 0),
            "stage":            crm.get("stage") or "cold",
            "messages_sent":    int(crm.get("messagesSent") or 0),
            "replies_received": int(crm.get("repliesReceived") or 0),
            "reply_rate":       float(crm.get("replyRate") or 0),
            "synced_at":        now,
        })

    # ── Phase 2: Message fetch ──────────────────────────────────────────────────────────
    # Instagram: DOM click+scroll (no service API needed, always enabled)
    # Others:    service endpoint loop, opt-in via --messages flag
    if platform == "instagram":
        message_rows = ig_fetch_all_messages(conversations, dry_run=dry_run)

    elif platform == "twitter":
        message_rows = tw_fetch_all_messages(conversations, dry_run=dry_run)

    elif platform == "tiktok":
        message_rows = tk_fetch_all_messages(conversations, dry_run=dry_run)

    elif fetch_messages:
        print(f"  📨 Fetching messages for {len(contact_rows)} conversations...")
        for i, conv in enumerate(conversations):
            username = (conv.get("username") or conv.get("handle") or "").strip()
            if not username:
                continue
            print(f"    [{i+1}/{len(conversations)}] Opening @{username}...")
            open_body = {"participantName": username} if platform == "linkedin" else {"username": username}
            try:
                http_post(f"{base}{cfg['open']}", open_body, timeout=12)
            except Exception:
                continue
            time.sleep(1.5 if platform in ("tiktok", "linkedin") else 1.0)

            msgs_raw, _ = http_get(f"{base}{cfg['messages']}?limit={message_limit}", timeout=10)
            messages = msgs_raw.get("messages", []) if msgs_raw else []

            for j, m in enumerate(messages):
                msg_text = m.get("text") or m.get("content") or ""
                if not msg_text:
                    continue
                msg_id = m.get("id") or m.get("messageId") or hashlib.md5(
                    f"{platform}:{username}:{j}:{msg_text[:30]}".encode()
                ).hexdigest()
                message_rows.append({
                    "platform":      platform,
                    "username":      username,
                    "sender":        m.get("sender") or ("me" if m.get("isOutbound") else username),
                    "text":          msg_text[:2000],
                    "is_outbound":   bool(m.get("isOutbound", False)),
                    "message_id":    str(msg_id),
                    "timestamp_str": str(m.get("timestamp") or m.get("sentAt") or ""),
                    "synced_at":     now,
                })

    # Deduplicate contact_rows by (platform, username) — same username in one batch
    # causes "ON CONFLICT DO UPDATE command cannot affect row" error
    seen_contacts = set()
    deduped_contacts = []
    for c in contact_rows:
        key = (c.get("platform", ""), c.get("username", ""))
        if key not in seen_contacts:
            seen_contacts.add(key)
            deduped_contacts.append(c)
    contact_rows = deduped_contacts

    print(f"  📦 {len(contact_rows)} contacts, {len(message_rows)} messages to upsert")

    # Upsert to Supabase
    n, err = supabase_upsert("crm_contacts", contact_rows, dry_run)
    if err:
        print(f"  ❌ crm_contacts upsert error: {err}")
    else:
        print(f"  ✅ crm_contacts: {n} rows upserted")

    n, err = supabase_upsert("crm_messages", message_rows, dry_run)
    if err:
        print(f"  ❌ crm_messages upsert error: {err}")
    else:
        print(f"  ✅ crm_messages: {n} rows upserted")

    return contact_rows, message_rows, None


def run_sync(platforms=None, message_limit=20, dry_run=False, fetch_messages=False):
    target = platforms or list(SERVICES.keys())
    print("=" * 60)
    print(f"CRM SYNC — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"Platforms: {', '.join(target)}")
    print(f"Supabase:  {SUPABASE_URL}")
    print(f"Dry run:   {dry_run}")
    print("=" * 60)

    all_contacts, all_messages = [], []
    failures = []
    for platform in target:
        cfg = SERVICES[platform]
        contacts, messages, err_flag = sync_platform(platform, cfg, message_limit, dry_run, fetch_messages)
        all_contacts.extend(contacts)
        all_messages.extend(messages)
        if err_flag == "zero_conversations":
            failures.append(platform)

    print(f"\n{'='*60}")
    if failures:
        print(f"❌ SYNC FAILED — 0 conversations on: {', '.join(failures)}")
    else:
        print(f"✅ SYNC COMPLETE")
    print(f"   Total contacts: {len(all_contacts)}")
    print(f"   Total messages: {len(all_messages)}")
    print(f"   Supabase table: crm_contacts / crm_messages")
    if failures:
        print(f"   FAILURES:  {failures}")
    print(f"{'='*60}")

    # Write local JSON backup
    out = {
        "syncedAt": utcnow(),
        "totalContacts": len(all_contacts),
        "totalMessages": len(all_messages),
        "contacts": all_contacts,
        "messages": all_messages[:200],  # cap for file size
    }
    out["failures"] = failures
    with open("/tmp/crm_sync_output.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"   Local backup:   /tmp/crm_sync_output.json")

    return out


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    platform_filter = None
    message_limit = 20
    for arg in sys.argv[1:]:
        if arg.startswith("--platform="):
            platform_filter = [arg.split("=")[1]]
        elif arg in ("instagram", "twitter", "tiktok", "linkedin"):
            platform_filter = [arg]
        elif arg.startswith("--messages="):
            message_limit = int(arg.split("=")[1])
        elif arg == "--deep":
            message_limit = 100
    fetch_messages = "--messages" in sys.argv
    result = run_sync(platforms=platform_filter, message_limit=message_limit,
                      dry_run=dry_run, fetch_messages=fetch_messages)
    if result.get("failures"):
        sys.exit(1)
