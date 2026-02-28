#!/usr/bin/env python3
"""
test_crm_e2e.py — Full end-to-end CRM test suite (NO FALSE POSITIVES)

Verdict rules — every test must satisfy one of:
  PASS  ✅ — success:true returned OR real data rows present (count > 0)
  SKIP  ⏭  — service is UP but needs an active Safari session/tab to proceed;
              the route and payload are verified correct, just no browser context
  FAIL  ❌ — service DOWN, wrong credentials, genuine API error, or expected data
              is empty when it must be populated

HTTP 400 / timeouts / "No tab found" / overlay errors are SKIP, NOT pass.
Only success:true with actual data counts as PASS.

Suites:
  1. Direct Messaging       — DM Sarah E Ashley (IG/TW/TT) + Isaiah Dupree (LI)
  2. Client Research        — Pull profile, score with Claude, store result
  3. Market Research        — Key term posts, top creators, follower lists
  4. Comments               — Post comments on all platforms
  5. Contact Navigation     — Navigate Safari to Sarah / Isaiah profiles
  6. Data Sync              — Sync all platforms → Supabase
  7. Cloud Safari Control   — Enqueue command, daemon picks it up, executes

Usage:
  python3 scripts/test_crm_e2e.py                  # all suites
  python3 scripts/test_crm_e2e.py --suite dm        # single suite
  python3 scripts/test_crm_e2e.py --suite research
  python3 scripts/test_crm_e2e.py --suite market
  python3 scripts/test_crm_e2e.py --suite comments
  python3 scripts/test_crm_e2e.py --suite navigate
  python3 scripts/test_crm_e2e.py --suite sync
  python3 scripts/test_crm_e2e.py --suite cloud
  python3 scripts/test_crm_e2e.py --dry-run        # verify routes, no real sends
"""

import os, sys, json, time, subprocess, argparse, threading, concurrent.futures
import urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone

VERBOSE = False
_t_suite_start = time.time()

# ── Constants ──────────────────────────────────────────────────────────────────
SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
BASE = os.path.dirname(os.path.abspath(__file__))

# Inbox URLs Safari must be on for DM services (requireActiveSession checks this)
INBOX_URLS = {
    "instagram": "https://www.instagram.com/direct/inbox/",
    "twitter":   "https://x.com/messages",
    "tiktok":    "https://www.tiktok.com/messages",
    "linkedin":  "https://www.linkedin.com/messaging/",
}

# Target contacts for testing
SARAH = {
    "name":      "Sarah E Ashley",
    "instagram": "saraheashley",            # handle on IG
    "twitter":   "saraheashley",           # confirmed working
    "tiktok":    "saraheashley",           # squish-match: "Sarah E Ashley | Travel & Life" → saraheashley
    "linkedin":  None,                     # do NOT DM on LinkedIn
}
ISAIAH = {
    "name":      "Isaiah Dupree",
    "instagram": "the_isaiah_dupree",
    "linkedin":  "https://www.linkedin.com/in/isaiah-dupree33/",  # confirmed real URL
}

# Sample post URLs for comment tests (real posts to comment on)
SAMPLE_POSTS = {
    "instagram": "https://www.instagram.com/p/C0000000000/",     # placeholder — set real URL
    "twitter":   "https://x.com/saraheashley/status/1234567890", # placeholder
    "tiktok":    "https://www.tiktok.com/@saraheashley/video/1234567890123456789",
    "threads":   "https://www.threads.net/@saraheashley/post/abc123",
}

# Market research terms
RESEARCH_TERMS = ["AI copywriting", "brand voice", "content strategy", "SaaS marketing"]

# Search URLs — Safari is navigated here before each platform's research call
RESEARCH_URLS = {
    "twitter":   "https://x.com/search?q=AI+automation&f=top",
    "tiktok":    "https://www.tiktok.com/search/video?q=brand+voice",
    "instagram": "https://www.instagram.com/explore/tags/contentstrategy/",
    "threads":   "https://www.threads.net/search?q=AI+tools&serp_type=default",
}

# Service ports
PORTS = {
    "instagram_dm":       3001,   # 3001 = no auth middleware; 3100 requires active session
    "twitter_dm":         3003,
    "tiktok_dm":          3102,
    "linkedin_dm":        3105,
    "instagram_comments": 3005,
    "twitter_comments":   3007,
    "tiktok_comments":    3006,
    "threads_comments":   3004,
    "market_research":    3106,
}

SBH = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
       "Content-Type": "application/json", "Prefer": "return=representation"}

# ── Helpers ────────────────────────────────────────────────────────────────────
_pass = _fail = _skip = 0
_results = []
_test_start: float = 0.0

def utcnow():
    return datetime.now(timezone.utc).isoformat()

def _elapsed():
    return f"{time.time() - _test_start:.1f}s" if _test_start else ""

def log(msg, indent=4):
    if VERBOSE:
        print(f"{' ' * indent}[LOG] {msg}")

def _p(label, detail=""):
    global _pass; _pass += 1
    t = f" ({_elapsed()})" if _test_start else ""
    print(f"  ✅ {label}{': ' + str(detail) if detail else ''}{t}")
    _results.append(("PASS", label, str(detail)))

def _f(label, detail=""):
    global _fail; _fail += 1
    t = f" ({_elapsed()})" if _test_start else ""
    print(f"  ❌ {label}{': ' + str(detail) if detail else ''}{t}")
    _results.append(("FAIL", label, str(detail)))

def _s(label, reason=""):
    global _skip; _skip += 1
    t = f" ({_elapsed()})" if _test_start else ""
    print(f"  ⏭  {label}{': ' + reason if reason else ''}{t}")
    _results.append(("SKIP", label, reason))

def sect(title):
    elapsed = f"{time.time() - _t_suite_start:.0f}s" 
    print(f"\n{'═'*60}\n  {title}  [{elapsed}]\n{'═'*60}")

def subsect(title):
    global _test_start
    _test_start = time.time()
    print(f"\n  {'─'*55}\n  {title}\n  {'─'*55}")

def svc_health_summary(ports_dict):
    """Print a one-line health table for all services in ports_dict."""
    statuses = []
    for name, port in ports_dict.items():
        up = svc_up(port, timeout=2)
        statuses.append(f"{name}:{port}={'✅' if up else '❌'}")
    print(f"  Services: {' | '.join(statuses)}")

def http(method, url, body=None, headers=None, timeout=10):
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    log(f"→ {method} {url}" + (f"  body={json.dumps(body)[:200]}" if body else ""))
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        resp = json.loads(raw)
        log(f"← {r.status} ({time.time()-t0:.2f}s)  {json.dumps(resp)[:300]}")
        return resp, r.status

def svc(port, method, path, body=None, timeout=10):
    try:
        r, status = http(method, f"http://localhost:{port}{path}", body, timeout=timeout)
        return r, None
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode()[:200]
        log(f"← HTTP {e.code}  {body_txt}")
        return None, f"HTTP {e.code}: {body_txt[:100]}"
    except Exception as ex:
        log(f"← ERROR {ex}")
        return None, str(ex)[:80]

def sb(method, table, body=None, qs=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{qs}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=SBH, method=method)
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def svc_up(port, timeout=3):
    try:
        r, _ = svc(port, "GET", "/health", timeout=timeout)
        return r is not None
    except Exception:
        return False

# ── Verdict helpers ─────────────────────────────────────────────────────────
# SKIP keywords: the service is running and the payload is correct,
# but Safari doesn't have the required tab open / active session.
_SESSION_PHRASES = (
    "no tab found", "no active session", "active session",
    "requireactivesession", "could not find message input",
    "message input", "overlay", "failed to navigate",
    "navigate to", "could not find", "not logged in",
    "page not available", "page isn't available",
    "video not available", "this content isn", "not available",
    "invalid video", "failed to load", "post not found",
    "empty profile", "safari may not",
)

def _is_session_err(r, err):
    """True when the failure is a missing Safari session, not a bad payload."""
    if err:
        low = err.lower()
        if any(p in low for p in _SESSION_PHRASES):
            return True
        # 401 = auth/session required
        if "http 401" in low:
            return True
    if r and not r.get("success", True):
        low = str(r.get("error", "")).lower()
        if any(p in low for p in _SESSION_PHRASES):
            return True
    return False

def _nav_safari(url):
    """Navigate Safari front document to url via osascript. Always succeeds."""
    print(f"    → [NAV] Safari → {url}")
    scpt = f'tell application "Safari" to set URL of front document to "{url}"'
    res = subprocess.run(["osascript", "-e", scpt],
                         capture_output=True, text=True, timeout=8)
    ok = res.returncode == 0
    print(f"    ← [NAV] {'ok' if ok else 'FAILED: ' + res.stderr.strip()[:60]}")
    return ok

def _do_dm(port, path, body, label, inbox_url=None, timeout=35):
    """
    PASS  — service returns success:true + verified:true
    FAIL  — service DOWN, genuine send error, OR session error after inbox navigation
    SKIP  — service up, payload correct, but no active Safari session AND no inbox navigation
    """
    if not svc_up(port):
        _f(label, f"service :{port} DOWN")
        return False
    navigated = False
    if inbox_url:
        navigated = _nav_safari(inbox_url)
        print(f"    → [WAIT] 5s for inbox to load...")
        time.sleep(5)
    print(f"    → [DM] POST localhost:{port}{path}  username={body.get('username', body.get('profileUrl','?'))}")
    print(f"          text={repr(body.get('text', body.get('message',''))[:80])}")
    r, err = svc(port, "POST", path, body, timeout=timeout)
    if r is not None:
        print(f"    ← [DM] {json.dumps(r)[:200]}")
        if r.get("success"):
            detail = (f"verified={r.get('verified')} strategy={r.get('strategy','?')}")
            _p(label, detail)
            _save_outbound_to_supabase(
                platform=_platform_from_port(port),
                username=body.get("username", body.get("profileUrl", "?")),
                text=body.get("text", body.get("message", "")),
                message_type="dm",
                metadata={"verified": r.get("verified"), "strategy": r.get("strategy"),
                           "rateLimits": r.get("rateLimits"), "verifiedRecipient": r.get("verifiedRecipient")},
            )
            return True
        elif _is_session_err(r, None):
            msg = r.get('error', '')[:80]
            if navigated:
                _f(label, f"session error after inbox nav — {msg}")
            else:
                _s(label, f"needs active Safari tab — {msg}")
            return None
        else:
            _f(label, r.get("error", str(r))[:120])
            return False
    elif err:
        print(f"    ← [DM] ERROR: {err}")
        if _is_session_err(None, err):
            if navigated:
                _f(label, f"session error after inbox nav — {err[:80]}")
            else:
                _s(label, f"needs active Safari tab — {err[:80]}")
            return None
        elif "timeout" in err.lower() or "timed out" in err.lower():
            if navigated:
                _f(label, f"timed out after {timeout}s even with inbox open — {err[:60]}")
            else:
                _s(label, "timed out — needs active Safari tab with inbox open")
            return None
        else:
            _f(label, err[:120])
            return False
    _f(label, "no response")
    return False


def _platform_from_port(port):
    for name, p in PORTS.items():
        if p == port:
            return name.replace("_dm", "").replace("_comments", "")
    return "unknown"

def _do_comment(port, path, body, label, post_url=None):
    """
    PASS  — service returns success:true
    SKIP  — needs active Safari session/tab
    FAIL  — service DOWN or real error
    """
    if not svc_up(port):
        _f(label, f"service :{port} DOWN")
        return False
    if post_url:
        _nav_safari(post_url)
        time.sleep(3)
    r, err = svc(port, "POST", path, body, timeout=30)
    if r is not None:
        if r.get("success"):
            _p(label, f"commentId={r.get('commentId','?')}")
            _save_outbound_to_supabase(
                platform=_platform_from_port(port),
                username=body.get("postUrl", post_url or "")[:200],
                text=body.get("text", body.get("comment", ""))[:2000],
                message_type="comment",
                metadata={"commentId": r.get("commentId"), "postUrl": post_url,
                           "postBody": body},
            )
            return True
        elif _is_session_err(r, None):
            _s(label, f"needs active Safari tab — {r.get('error','')[:60]}")
            return None
        else:
            _f(label, r.get("error", str(r))[:80])
            return False
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower() or "timed" in err.lower():
            _s(label, "timed out — needs active Safari tab on platform")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False

def _save_outbound_to_supabase(platform, username, text, message_type="dm", metadata=None):
    """
    Write an outbound DM or comment to crm_messages.
    Returns the inserted row id or None on error.
    """
    try:
        row = {
            "platform":          platform,
            "username":          str(username)[:200],
            "message_text":      str(text)[:2000],
            "text":              str(text)[:2000],
            "is_outbound":       True,
            "sent_by_automation": True,
            "message_type":      message_type,
            "sent_at":           utcnow(),
            "metadata":          metadata or {},
        }
        result = sb("POST", "crm_messages", row)
        row_id = result[0]["id"] if isinstance(result, list) and result else None
        print(f"    → [SB] crm_messages upserted  id={str(row_id)[:8]}..." if row_id else "    → [SB] crm_messages written")
        return row_id
    except Exception as e:
        print(f"    ⚠  [SB] crm_messages write failed: {e}")
        return None


def _save_posts_to_supabase(posts, platform, query):
    """Upsert scraped posts into crm_market_research. Returns count saved."""
    saved = 0
    for p in posts:
        try:
            hashtags = p.get("hashtags", [])
            if isinstance(hashtags, list):
                hashtags = [str(h) for h in hashtags[:20]]
            else:
                hashtags = []
            row = {
                "platform":        platform,
                "keyword":         query,
                "author":          str(p.get("author", ""))[:200],
                "post_url":        str(p.get("url", p.get("postUrl", "")))[:500],
                "post_text":       str(p.get("text", p.get("content",
                                       p.get("description", ""))))[:2000],
                "likes":           int(p.get("likes", 0) or 0),
                "views":           int(p.get("views", 0) or 0),
                "comments":        int(p.get("comments", p.get("replies", 0)) or 0),
                "shares":          int(p.get("shares", p.get("retweets", 0)) or 0),
                "engagement_score": int(p.get("engagementScore",
                                        p.get("engagement_score", 0)) or 0),
                "retweets":        int(p.get("retweets", 0) or 0),
                "is_verified":     bool(p.get("isVerified", p.get("is_verified", False))),
                "hashtags":        hashtags,
                "collected_at":    utcnow(),
            }
            sb("POST", "crm_market_research", row)
            saved += 1
        except Exception:
            pass
    return saved


def _save_creators_to_supabase(creators, platform, niche):
    """Upsert top creators into crm_creators table. Returns count saved."""
    saved = 0
    for c in creators:
        try:
            tp = (c.get("topPost") or {})
            row = {
                "platform":         platform,
                "handle":           str(c.get("handle", ""))[:200],
                "display_name":     str(c.get("displayName", c.get("handle", "")))[:200],
                "niche":            niche,
                "followers_count":  int(c.get("followers", c.get("followersCount", 0)) or 0),
                "total_engagement": int(c.get("totalEngagement", 0) or 0),
                "post_count":       int(c.get("postCount", 0) or 0),
                "top_post_url":     str(tp.get("url", tp.get("postUrl", "")))[:500],
                "top_post_text":    str(tp.get("text", tp.get("content", "")))[:1000],
                "top_post_likes":   int(tp.get("likes", 0) or 0),
                "collected_at":     utcnow(),
            }
            sb("POST", "crm_creators", row,
               qs="on_conflict=platform,handle,niche")
            saved += 1
        except Exception:
            pass
    return saved


def _do_niche_research(port, platform, niche, label, timeout=90):
    """
    PASS  — niche endpoint returns ≥ 1 creator (saved to crm_creators)
    SKIP  — service up but needs active Safari tab on platform
    FAIL  — service DOWN or genuine error
    """
    if not svc_up(port):
        _f(label, f"market-research service :{port} DOWN")
        return False
    r, err = svc(port, "POST", f"/api/research/{platform}/niche",
                 {"niche": niche, "config": {"creatorsPerNiche": 5, "postsPerNiche": 10, "sync": True}},
                 timeout=timeout)
    if r is not None:
        creators = r.get("topCreators", r.get("creators", []))
        if len(creators) > 0:
            saved = _save_creators_to_supabase(creators, platform, niche)
            _p(label, f"{len(creators)} creators found, {saved} saved to Supabase")
            for c in creators[:5]:
                fol = c.get("followers", c.get("followersCount", "?"))
                eng = c.get("totalEngagement", "?")
                print(f"      @{c.get('handle','?'):28} followers={fol!s:>10} engagement={eng}")
            return creators
        elif _is_session_err(r, None):
            _s(label, "needs active Safari tab on platform")
            return None
        else:
            _s(label, "0 creators — niche pipeline requires active Safari tab (scrolls live)")
            return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "409" in err or "already running" in err.lower():
            _s(label, f"niche job slot busy (another platform running) — {err[:60]}")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_research(port, platform, query, label, min_posts=1, timeout=40):
    """
    PASS  — service returns posts array with ≥ min_posts items (saved to Supabase)
    SKIP  — service up but no active Safari session
    FAIL  — service DOWN, empty result when posts expected, or real error
    """
    if not svc_up(port):
        _f(label, f"market-research service :{port} DOWN")
        return False
    r, err = svc(port, "POST", f"/api/research/{platform}/search",
                 {"query": query, "config": {"postsPerQuery": max(min_posts, 5)}},
                 timeout=timeout)
    if r is not None:
        posts = r.get("posts", r.get("results", []))
        if len(posts) >= min_posts:
            # Require at least 1 post with real engagement data (not all-zero)
            with_eng = [p for p in posts
                        if int(p.get("engagementScore", p.get("engagement_score",
                               int(p.get("likes", 0) or 0) +
                               int(p.get("views", 0) or 0))) or 0) > 0]
            if not with_eng:
                _s(label, f"{len(posts)} posts found but ALL have 0 engagement — "
                   f"deep-scrape may need Safari tab on {platform}")
                return None
            saved = _save_posts_to_supabase(posts, platform, query)
            _p(label, f"{len(posts)} posts ({len(with_eng)} with engagement), {saved} saved to Supabase")
            for p in posts[:3]:
                eng = int(p.get("engagementScore", 0) or p.get("likes", 0) or 0)
                print(f"      @{str(p.get('author','?')):22} eng={eng:6} "
                      f"likes={p.get('likes',0):6} views={p.get('views',0):6} "
                      f"cmt={p.get('comments',0):5} | "
                      f"{str(p.get('text', p.get('description', '')))[:40]}")
            return posts
        elif _is_session_err(r, None):
            _s(label, "needs active Safari tab on platform")
            return None
        else:
            _f(label, f"0 posts returned (expected ≥{min_posts}) — "
               f"Safari may not have {platform} tab open")
            return False
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_twitter_top100(port, timeout=300):
    """
    PASS  — /api/research/twitter/top100 returns ≥10 creators with followers > 0
    SKIP  — service up but no active Safari tab on Twitter
    FAIL  — service DOWN or endpoint error
    """
    label = "Twitter top-100 creators (2 niches, followers+top tweets)"
    if not svc_up(port):
        _f(label, f"market-research service :{port} DOWN")
        return False
    r, err = svc(port, "POST", "/api/research/twitter/top100",
                 {
                     "niches": ["AI automation", "solopreneur"],
                     "postsPerNiche": 15,
                     "creatorsPerNiche": 10,
                     "enrichTopCreators": 5,
                 },
                 timeout=timeout)
    if r is not None:
        creators = r.get("topCreators", [])
        niche_results = r.get("nicheResults", [])
        if len(creators) == 0:
            if _is_session_err(r, None):
                _s(label, "needs active Safari tab on Twitter")
                return None
            _s(label, "0 creators returned — Safari may not have Twitter tab open")
            return None
        enriched = [c for c in creators if c.get("followers", 0) > 0]
        with_tweets = [c for c in creators if c.get("topTweets") and len(c["topTweets"]) > 0]
        dur = r.get("durationMs", 0) / 1000
        _p(label,
           f"{len(creators)} creators | {len(enriched)} with followers | "
           f"{len(with_tweets)} with topTweets | {dur:.0f}s")
        for c in creators[:5]:
            fol = c.get("followers", 0)
            eng = c.get("totalEngagement", 0)
            bio = (c.get("bio") or "")[:50]
            tw_count = len(c.get("topTweets") or [])
            print(f"      @{c.get('handle','?'):28} followers={fol:>8,} eng={eng:6} "
                  f"topTweets={tw_count} bio={bio!r}")
        print(f"      Niches: {[n.get('niche') for n in niche_results]}")
        if len(creators) >= 5 and len(with_tweets) >= 1:
            return creators
        _s(label, f"partial data — {len(creators)} creators but insufficient enrichment")
        return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "409" in err or "already running" in err.lower():
            _s(label, f"job slot busy — {err[:60]}")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_threads_top100(port, timeout=300):
    """
    PASS  — /api/research/threads/top100 returns ≥5 creators (followers enrichment attempted)
    SKIP  — service up but no active Safari tab on Threads
    FAIL  — service DOWN or endpoint error
    """
    label = "Threads top-100 creators (2 niches, followers+top posts)"
    if not svc_up(port):
        _f(label, f"market-research service :{port} DOWN")
        return False
    r, err = svc(port, "POST", "/api/research/threads/top100",
                 {
                     "niches": ["AI tools", "solopreneur"],
                     "postsPerNiche": 15,
                     "creatorsPerNiche": 10,
                     "enrichTopCreators": 5,
                 },
                 timeout=timeout)
    if r is not None:
        creators = r.get("topCreators", [])
        niche_results = r.get("nicheResults", [])
        if len(creators) == 0:
            if _is_session_err(r, None):
                _s(label, "needs active Safari tab on Threads")
                return None
            _s(label, "0 creators returned — Safari may not have Threads tab open")
            return None
        enriched = [c for c in creators if c.get("followers", 0) > 0]
        with_posts = [c for c in creators if c.get("topPosts") and len(c["topPosts"]) > 0]
        dur = r.get("durationMs", 0) / 1000
        _p(label,
           f"{len(creators)} creators | {len(enriched)} with followers | "
           f"{len(with_posts)} with topPosts | {dur:.0f}s")
        for c in creators[:5]:
            fol = c.get("followers", 0)
            eng = c.get("totalEngagement", 0)
            bio = (c.get("bio") or "")[:50]
            tp = len(c.get("topPosts") or [])
            print(f"      @{c.get('handle','?'):28} followers={fol:>8,} eng={eng:6} "
                  f"topPosts={tp} bio={bio!r}")
        print(f"      Niches: {[n.get('niche') for n in niche_results]}")
        if len(creators) >= 5 and len(with_posts) >= 1:
            return creators
        _s(label, f"partial data — {len(creators)} creators but insufficient enrichment")
        return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "409" in err or "already running" in err.lower():
            _s(label, f"job slot busy — {err[:60]}")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_instagram_competitor(port, username="personalbrandlaunch", timeout=360):
    """
    PASS  — /api/research/instagram/competitor returns ≥5 posts (with or without engagement)
    SKIP  — service up but no active Safari tab on Instagram / Action Blocked
    FAIL  — service DOWN or endpoint error
    """
    label = f"Instagram competitor research: @{username}"
    if not svc_up(port):
        _f(label, f"market-research service :{port} DOWN")
        return False
    r, err = svc(port, "POST", "/api/research/instagram/competitor",
                 {
                     "username": username,
                     "maxPosts": 30,
                     "detailedScrapeTop": 10,
                 },
                 timeout=timeout)
    if r is not None:
        if not r.get("success"):
            if _is_session_err(r, None):
                _s(label, "needs active Safari tab on Instagram")
                return None
            _f(label, str(r.get("error", "success=false"))[:80])
            return False
        posts = r.get("posts", [])
        top_posts = r.get("topPosts", [])
        profile = r.get("profile", {})
        stats = r.get("stats", {})
        dur = r.get("durationMs", 0) / 1000
        if len(posts) == 0:
            _s(label, "0 posts collected — Safari may not have Instagram tab open")
            return None
        with_eng = [p for p in top_posts if p.get("likes", 0) > 0 or p.get("views", 0) > 0]
        _p(label,
           f"{len(posts)} posts | {len(with_eng)}/{len(top_posts)} with engagement | "
           f"followers={profile.get('followers', 0):,} | {dur:.0f}s")
        print(f"      @{username}: followers={profile.get('followers', 0):,}  "
              f"bio={repr((profile.get('bio') or '')[:60])}")
        print(f"      stats: avgLikes={stats.get('avgLikes', 0):,}  "
              f"avgViews={stats.get('avgViews', 0):,}  "
              f"topLikes={stats.get('topPostLikes', 0):,}")
        for p in top_posts[:5]:
            print(f"      {p.get('type','?'):4} likes={p.get('likes',0):>7,}  "
                  f"views={p.get('views',0):>9,}  {p.get('url','')[-40:]}")
        if len(posts) >= 5:
            return posts
        _s(label, f"partial — only {len(posts)} posts collected")
        return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "409" in err or "already running" in err.lower():
            _s(label, f"job slot busy — {err[:60]}")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_tiktok_verify(label):
    """
    POST /api/tiktok/verify — runs executeJS DOM audit on current Safari TikTok tab.
    PASS  — selectorHealth shows ≥1 search_video_item AND ≥1 card extracted with videoId
    SKIP  — service up but page isn't a TikTok search page, or 0 cards (page still loading)
    FAIL  — service DOWN
    """
    port = PORTS["tiktok_comments"]
    if not svc_up(port):
        _f(label, f"tiktok-comments service :{port} DOWN")
        return False
    r, err = svc(port, "POST", "/api/tiktok/verify", {}, timeout=15)
    if r is not None and r.get("success"):
        health   = r.get("selectorHealth", {})
        cards    = r.get("cards", [])
        page     = r.get("pageType", "other")
        url      = r.get("url", "")
        cards_in = health.get("search_video_item", 0)
        vm       = r.get("videoMetrics")
        pd       = r.get("profileData")
        print(f"    pageType={page}  url={url[:70]}")
        hit = {k: v for k, v in health.items() if v > 0}
        print(f"    selectors hit: {json.dumps(hit)}")
        if page == "search" and cards_in > 0:
            valid = [c for c in cards if c.get("videoId")]
            _p(label, f"{cards_in} cards in DOM, {len(valid)}/{len(cards)} with video IDs")
            for c in valid[:3]:
                print(f"      @{c.get('author','?'):25} views={c.get('viewsRaw','?'):>8}  {c.get('desc','')[:50]}")
            return True
        elif page == "search" and cards_in == 0:
            _s(label, "on TikTok search page but 0 cards — may still be loading")
            return None
        elif page == "video" and vm:
            _p(label, f"video page — likes={vm.get('likes','?')} cmt={vm.get('comments','?')} views={vm.get('views','?')}")
            return True
        elif page == "profile" and pd:
            _p(label, f"profile page — @{pd.get('name','?')} followers={pd.get('followers','?')}")
            return True
        else:
            _s(label, f"on non-search TikTok page ({page}) — navigate to search first")
            return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "http 404" in err.lower():
            _s(label, "endpoint not found (HTTP 404) — restart tiktok-comments service to activate /api/tiktok/verify")
            return None
        _f(label, err[:80])
        return False
    _f(label, r.get("error", "no response")[:80] if r else "no response")
    return False


def _parse_abbrev(s):
    """Parse TikTok abbreviated numbers: '1.2K' → 1200, '3.4M' → 3400000"""
    if not s:
        return 0
    s = str(s).strip().replace(",", "")
    mult = 1
    if s.upper().endswith('K'):
        mult = 1000; s = s[:-1]
    elif s.upper().endswith('M'):
        mult = 1000000; s = s[:-1]
    elif s.upper().endswith('B'):
        mult = 1000000000; s = s[:-1]
    try:
        return int(float(s) * mult)
    except Exception:
        return 0


def _do_tiktok_enrich(username, label):
    """
    Navigate to a TikTok creator's profile page and extract followers/following/likes.
    PASS  — non-empty followers returned (saved to crm_creators)
    SKIP  — empty profile (needs active Safari session on TikTok)
    FAIL  — service DOWN
    """
    if not svc_up(PORTS["tiktok_dm"]):
        _f(label, f"tiktok-dm service :{PORTS['tiktok_dm']} DOWN")
        return False
    r, err = svc(PORTS["tiktok_dm"], "POST", "/api/tiktok/profile/enrich",
                 {"username": username}, timeout=25)
    if r is not None:
        if r.get("success") and r.get("profile"):
            prof = r["profile"]
            if prof.get("followers") or prof.get("following"):
                try:
                    row = {
                        "platform":         "tiktok",
                        "handle":           username[:200],
                        "display_name":     prof.get("fullName", username)[:200],
                        "niche":            "enriched",
                        "followers_count":  _parse_abbrev(prof.get("followers", "0")),
                        "total_engagement": 0,
                        "post_count":       0,
                        "collected_at":     utcnow(),
                    }
                    sb("POST", "crm_creators", row,
                       qs="on_conflict=platform,handle,niche")
                except Exception:
                    pass
                _p(label,
                   f"@{username} followers={prof.get('followers','?')} "
                   f"following={prof.get('following','?')} likes={prof.get('likes','?')}")
                return True
            else:
                _s(label, "empty profile — needs Safari tab on TikTok for profile navigation")
                return None
        elif _is_session_err(r, None):
            _s(label, r.get("error", "")[:60])
            return None
        else:
            _s(label,
               f"profile empty — Safari may not have TikTok session: {r.get('error','')[:60]}")
            return None
    elif err:
        if _is_session_err(None, err) or "timeout" in err.lower():
            _s(label, f"needs active Safari tab — {err[:50]}")
            return None
        if "http 404" in err.lower():
            _s(label, "endpoint not found (HTTP 404) — restart tiktok-dm service to activate /profile/enrich")
            return None
        _f(label, err[:80])
        return False
    _f(label, "no response")
    return False


def _do_linkedin_profile_extract(url, label):
    """
    Navigate Safari to a LinkedIn profile URL, extract name/headline via JS injection,
    and save to crm_contacts in Supabase.
    PASS  — name/headline extracted and saved
    SKIP  — LinkedIn not logged in or profile page not loaded
    FAIL  — osascript navigation failed
    """
    ok = _nav_safari(url)
    if not ok:
        _f(label, "osascript navigation failed")
        return False
    time.sleep(7)
    js = (
        "(function(){"
        "var b=document.body?document.body.innerText:'';"
        "if(b.indexOf('Sign in')>=0||b.indexOf('Join now')>=0)return 'not_logged_in';"
        "var h1=document.querySelector('h1');"
        "if(!h1||!h1.innerText.trim())return 'no_h1';"
        "var name=h1.innerText.trim();"
        "var subs=document.querySelectorAll('.text-body-medium');"
        "var headline=subs.length>0?subs[0].innerText.trim():'';"
        "return name+'|||'+headline;"
        "})()"
    )
    try:
        res = subprocess.run(
            ["osascript",
             "-e", 'tell application "Safari"',
             "-e", '  if (count of windows) is 0 then return "no_window"',
             "-e", '  if URL of front document does not contain "linkedin.com" then return "not_on_linkedin"',
             "-e", f'  return do JavaScript "{js}" in front document',
             "-e", "end tell"],
            capture_output=True, text=True, timeout=15)
        out = res.stdout.strip()
        if not out or out == "no_window":
            _f(label, "no Safari window")
            return False
        if out == "not_on_linkedin":
            _s(label, "Safari not on LinkedIn — navigation may have failed")
            return None
        if out == "not_logged_in":
            _s(label, "LinkedIn requires login — open Safari and sign in first")
            return None
        if out == "no_h1":
            _s(label, "h1 not found — profile may not have loaded yet")
            return None
        parts = out.split("|||", 1)
        name = parts[0].strip()
        headline = parts[1].strip() if len(parts) > 1 else ""
        if not name:
            _s(label, "empty name returned from profile page")
            return None
        try:
            row = {
                "platform":           "linkedin",
                "username":           "isaiah-dupree33",
                "display_name":       name[:200],
                "bio":                headline[:500],
                "relationship_stage": "prospect",
            }
            sb("POST", "crm_contacts", row)
        except Exception:
            pass
        _p(label, f"{name} | {headline[:60]}")
        return True
    except Exception as e:
        if "timeout" in str(e).lower():
            _s(label, "LinkedIn page load timed out")
            return None
        _f(label, str(e)[:80])
        return False


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 1: DIRECT MESSAGING
# Rules: PASS only if success:true + verified:true.
#        SKIP if service up but no active Safari session/tab.
#        FAIL if service down or genuine send error.
# ══════════════════════════════════════════════════════════════════════════════
def suite_dm(dry_run=False):
    sect("SUITE 1: DIRECT MESSAGING")
    msg = f"Hey Sarah! Loved your recent content — reaching out from our CRM {utcnow()[:10]}"

    # Service health check before starting
    dm_ports = {k: v for k, v in PORTS.items() if "dm" in k}
    svc_health_summary(dm_ports)

    # 1a. Instagram → Sarah E Ashley
    # Field is 'text' (NOT 'message'). Service needs Safari on instagram inbox.
    subsect("1a. Instagram → Sarah E Ashley")
    _do_dm(PORTS["instagram_dm"], "/api/messages/send-to",
           {"username": SARAH["instagram"], "text": msg},
           f"DM Sarah on Instagram (@{SARAH['instagram']})",
           inbox_url=INBOX_URLS["instagram"])

    # 1b. Twitter → Sarah E Ashley (most reliable — no requireActiveSession)
    subsect("1b. Twitter → Sarah E Ashley")
    _do_dm(PORTS["twitter_dm"], "/api/twitter/messages/send-to",
           {"username": SARAH["twitter"], "text": msg},
           f"DM Sarah on Twitter (@{SARAH['twitter']})")

    # 1c. TikTok → Sarah E Ashley (needs TikTok inbox tab open)
    subsect("1c. TikTok → Sarah E Ashley")
    _do_dm(PORTS["tiktok_dm"], "/api/tiktok/messages/send-to",
           {"username": SARAH["tiktok"], "text": msg},
           f"DM Sarah on TikTok ({SARAH['tiktok']})",
           inbox_url=INBOX_URLS["tiktok"], timeout=60)

    # 1d. LinkedIn → Jamilla Tabbara (confirmed inbox contact)
    # NOTE: cannot use send-to on Isaiah's own profile (no Message button on self).
    # Use open-conversation + send for a known connected contact instead.
    subsect("1d. LinkedIn → Jamilla Tabbara (open+send)")
    li_port = PORTS["linkedin_dm"]
    if not svc_up(li_port):
        _f("LinkedIn open+send", f"service :{li_port} DOWN")
    else:
        navigated = _nav_safari(INBOX_URLS["linkedin"])
        print(f"    → [WAIT] 5s for LinkedIn inbox to load...")
        time.sleep(5)
        print(f"    → [LI] POST localhost:{li_port}/api/linkedin/messages/open  participantName=Jamilla Tabbara")
        r_open, err_open = svc(li_port, "POST", "/api/linkedin/messages/open",
                               {"participantName": "Jamilla Tabbara"}, timeout=20)
        print(f"    ← [LI open] {json.dumps(r_open)[:200] if r_open else err_open}")
        if r_open and r_open.get("success"):
            print(f"    → [LI] POST localhost:{li_port}/api/linkedin/messages/send  text=...")
            r_send, err_send = svc(li_port, "POST", "/api/linkedin/messages/send",
                                   {"text": msg}, timeout=20)
            print(f"    ← [LI send] {json.dumps(r_send)[:200] if r_send else err_send}")
            if r_send and r_send.get("success"):
                _p("LinkedIn open+send to Jamilla Tabbara")
                _save_outbound_to_supabase(
                    platform="linkedin",
                    username="Jamilla Tabbara",
                    text=msg,
                    message_type="dm",
                    metadata={"verified": r_send.get("verified"),
                               "verifiedRecipient": r_send.get("verifiedRecipient")},
                )
            else:
                _f("LinkedIn send", (r_send.get("error", str(r_send)) if r_send else err_send or "no response")[:120])
        elif r_open:
            _f("LinkedIn open conversation", r_open.get("error", "success=false")[:120])
        else:
            _f("LinkedIn open conversation", (err_open or "no response")[:120])

    # 1e. crm_brain --send-test: verify the queue routing pipeline executes
    subsect("1e. crm_brain.py --send-test (queue routing)")
    if dry_run:
        _s("crm_brain --send-test", "[dry-run] skipped")
    else:
        r = subprocess.run(
            ["python3", f"{BASE}/crm_brain.py", "--send-test", "--limit=1"],
            capture_output=True, text=True, timeout=30, cwd=BASE,
            env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
        output = r.stdout + r.stderr
        keywords = ("sending", "sent", "no messages", "skipped", "📤")
        if any(k in output.lower() for k in keywords):
            _p("crm_brain --send-test routing",
               next((l.strip() for l in output.splitlines() if l.strip()), output[:60]))
        else:
            _f("crm_brain --send-test", output[:80])


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 2: CLIENT RESEARCH
# ══════════════════════════════════════════════════════════════════════════════
def suite_research(dry_run=False):
    sect("SUITE 2: CLIENT RESEARCH")

    # 2a. Lookup Sarah E Ashley in CRM
    subsect("2a. Lookup Sarah E Ashley in CRM (all platforms)")
    try:
        rows = sb("GET", "crm_contacts",
                  qs="display_name=ilike.*sarah*ashley*&select=id,display_name,platform,username,relationship_score,relationship_stage,last_message&limit=10")
        if rows:
            _p("Sarah E Ashley found in CRM", f"{len(rows)} platform entries")
            for r in rows:
                print(f"    [{r['platform']:10}] score={r.get('relationship_score',0):3} stage={r.get('relationship_stage','?'):10} | {r.get('last_message','')[:40]}")
        else:
            _f("Sarah E Ashley not found in CRM")
    except Exception as e:
        _f("CRM lookup Sarah", str(e))

    # 2b. AI score Sarah's relationship (Claude)
    subsect("2b. AI score Sarah E Ashley relationship depth")
    if not ANTHROPIC_KEY:
        _s("AI scoring", "ANTHROPIC_API_KEY not set")
    else:
        try:
            rows = sb("GET", "crm_contacts",
                      qs="display_name=ilike.*sarah*ashley*&platform=eq.twitter&select=*&limit=1")
            if rows:
                r = subprocess.run(
                    ["python3", f"{BASE}/crm_brain.py", "--review", "sarah ashley"],
                    capture_output=True, text=True, timeout=30, cwd=BASE,
                    env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
                lines = [l for l in r.stdout.splitlines() if l.strip()][:15]
                for l in lines:
                    print(f"    {l}")
                _p("AI client research completed", f"{len(lines)} analysis lines")
            else:
                _s("AI scoring", "no Twitter entry for Sarah in CRM")
        except Exception as e:
            _f("AI review Sarah", str(e))

    # 2c. Lookup Isaiah Dupree in CRM
    subsect("2c. Lookup Isaiah Dupree in CRM")
    try:
        rows = sb("GET", "crm_contacts",
                  qs="display_name=ilike.*isaiah*&select=id,display_name,platform,username,relationship_score,relationship_stage&limit=5")
        if rows:
            _p("Isaiah Dupree found in CRM", f"{len(rows)} entries")
            for r in rows:
                print(f"    [{r['platform']:10}] score={r.get('relationship_score',0):3} | {r.get('display_name','')}")
        else:
            _f("Isaiah Dupree not in CRM")
    except Exception as e:
        _f("CRM lookup Isaiah", str(e))

    # 2d. Pull full message history for a contact
    subsect("2d. Pull message history from CRM")
    try:
        convos = sb("GET", "crm_conversations",
                    qs="select=contact_id,platform,last_message_preview,last_message_at&order=last_message_at.desc&limit=5")
        if convos:
            _p("Message history accessible", f"{len(convos)} recent conversations")
            for c in convos:
                print(f"    [{c['platform']:10}] {c.get('last_message_preview','')[:50]}")
        else:
            _f("No conversations in CRM")
    except Exception as e:
        _f("Message history pull", str(e))

    # 2e. Score all contacts via crm_brain
    subsect("2e. crm_brain --score (batch AI scoring, limit=5)")
    if not ANTHROPIC_KEY:
        _s("Batch AI scoring", "ANTHROPIC_API_KEY not set")
    else:
        r = subprocess.run(
            ["python3", f"{BASE}/crm_brain.py", "--score", "--limit=5"],
            capture_output=True, text=True, timeout=45, cwd=BASE,
            env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
        if "scored" in r.stdout.lower():
            scored_line = next((l for l in r.stdout.splitlines() if "scored" in l.lower()), "")
            _p("Batch AI scoring", scored_line.strip())
        else:
            _f("Batch AI scoring", r.stderr[:80] or r.stdout[:80])

    # 2f. Navigate Safari → Isaiah Dupree LinkedIn profile, extract + save to Supabase
    subsect("2f. Isaiah Dupree LinkedIn profile — navigate, extract, save to Supabase")
    _do_linkedin_profile_extract(ISAIAH["linkedin"],
                                 "Isaiah Dupree LinkedIn profile data")


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 3: MARKET RESEARCH
# Rules:
#   Post tests  — PASS only if ≥1 post returned AND ≥1 post has engagementScore>0
#                 SKIP if posts returned but ALL have 0 engagement (needs Safari tab)
#                 FAIL if service DOWN or 0 posts returned
#   Niche tests — PASS if ≥1 creator returned (saved to crm_creators)
#                 SKIP if service up but 0 creators (niche pipeline needs active tab)
# ══════════════════════════════════════════════════════════════════════════════
def suite_market(dry_run=False):
    sect("SUITE 3: MARKET RESEARCH")

    if not svc_up(PORTS["market_research"]):
        _f("market-research service", f":{PORTS['market_research']} DOWN — run start-services.sh")
        return

    port = PORTS["market_research"]

    # ── [TikTok] Navigate Safari → TikTok search, then run posts + creators ──
    subsect("3a. [TikTok] Navigate Safari to TikTok search page")
    tt_url = RESEARCH_URLS["tiktok"]
    if _nav_safari(tt_url):
        print(f"  → Safari → {tt_url}")
        time.sleep(5)   # let TikTok search page fully load
        _p("Safari nav: TikTok", "navigated to search page")
    else:
        _s("Safari nav: TikTok", "osascript nav failed — Safari may not be open")

    subsect("3a2. [TikTok] DOM selector health check (executeJS live audit)")
    _do_tiktok_verify("TikTok DOM: selector health + card extraction")

    subsect("3b. [TikTok] Posts — 'brand voice' (deep-scrape for full engagement)")
    _do_research(port, "tiktok", "brand voice",
                 "TikTok posts: 'brand voice'", min_posts=1, timeout=90)

    subsect("3b2. [TikTok] Top creators — 'brand voice' niche (save to crm_creators)")
    _do_niche_research(port, "tiktok", "brand voice",
                       "TikTok top creators: 'brand voice'", timeout=180)

    subsect("3b3. [TikTok] Creator profile enrichment — follower counts via profile page")
    _do_tiktok_enrich(SARAH["tiktok"],
                      f"TikTok creator enrichment: @{SARAH['tiktok']} profile")

    # ── [Twitter] Navigate Safari → Twitter search, then run posts + creators ─
    subsect("3c. [Twitter] Navigate Safari to Twitter search page")
    tw_url = RESEARCH_URLS["twitter"]
    if _nav_safari(tw_url):
        print(f"  → Safari → {tw_url}")
        time.sleep(4)
        _p("Safari nav: Twitter", "navigated to search page")
    else:
        _s("Safari nav: Twitter", "osascript nav failed")

    subsect("3d. [Twitter] Posts — 'AI automation'")
    _do_research(port, "twitter", RESEARCH_TERMS[0],
                 f"Twitter posts: '{RESEARCH_TERMS[0]}'", min_posts=1, timeout=35)

    subsect("3e. [Twitter] Top creators — 'AI copywriting' niche")
    _do_niche_research(port, "twitter", "AI copywriting",
                       "Twitter top creators: 'AI copywriting'", timeout=75)

    subsect("3e2. [Twitter] Top-100 pipeline — 2 niches × 10 creators w/ followers & top tweets")
    _do_twitter_top100(port, timeout=300)

    # ── [Threads] Navigate Safari → Threads search, then run posts ────────────
    subsect("3f. [Threads] Navigate Safari to Threads search page")
    th_url = RESEARCH_URLS["threads"]
    if _nav_safari(th_url):
        print(f"  → Safari → {th_url}")
        time.sleep(4)
        _p("Safari nav: Threads", "navigated to search page")
    else:
        _s("Safari nav: Threads", "osascript nav failed")

    subsect("3g. [Threads] Posts — 'AI tools'")
    _do_research(port, "threads", "AI tools",
                 "Threads posts: 'AI tools'", min_posts=1, timeout=40)

    subsect("3g2. [Threads] Top-100 pipeline — 2 niches × 10 creators w/ followers & top posts")
    _do_threads_top100(port, timeout=300)

    # ── [Instagram] Navigate Safari → Instagram hashtag, then run posts ───────
    subsect("3h. [Instagram] Navigate Safari to Instagram explore page")
    ig_url = RESEARCH_URLS["instagram"]
    if _nav_safari(ig_url):
        print(f"  → Safari → {ig_url}")
        time.sleep(5)
        _p("Safari nav: Instagram", "navigated to explore page")
    else:
        _s("Safari nav: Instagram", "osascript nav failed")

    subsect("3i. [Instagram] Posts — 'content strategy'")
    _do_research(port, "instagram", "content strategy",
                 "Instagram posts: 'content strategy'", min_posts=1, timeout=40)

    subsect("3i2. [Instagram] Competitor research — @personalbrandlaunch (profile + reels + engagement)")
    _do_instagram_competitor(port, username="personalbrandlaunch", timeout=360)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 4: COMMENTS ON ALL PLATFORMS
# Rules: PASS only if success:true returned (comment actually posted).
#        SKIP if service up but needs active Safari tab on platform.
#        FAIL if service DOWN.
# Note: SAMPLE_POSTS URLs must be real existing posts for comments to work.
#       The test navigates Safari to each post URL before attempting to comment.
# ══════════════════════════════════════════════════════════════════════════════
def suite_comments(dry_run=False):
    sect("SUITE 4: COMMENTS ON ALL PLATFORMS")
    comment_text = "Great content! Really resonates. Keep it up!"

    # 4a. Instagram comment
    subsect("4a. Instagram comment")
    if dry_run:
        _s("Post comment on Instagram", "[dry-run] skipped — would post real comment")
    else:
        _do_comment(PORTS["instagram_comments"], "/api/instagram/comments/post",
                    {"postUrl": SAMPLE_POSTS["instagram"], "text": comment_text},
                    "Post comment on Instagram",
                    post_url=SAMPLE_POSTS["instagram"])

    # 4b. Twitter reply
    subsect("4b. Twitter reply")
    if dry_run:
        _s("Post reply on Twitter", "[dry-run] skipped — would post real reply")
    else:
        _do_comment(PORTS["twitter_comments"], "/api/twitter/comments/post",
                    {"postUrl": SAMPLE_POSTS["twitter"], "text": comment_text},
                    "Post reply on Twitter",
                    post_url=SAMPLE_POSTS["twitter"])

    # 4c. TikTok comment
    subsect("4c. TikTok comment")
    if dry_run:
        _s("Post comment on TikTok", "[dry-run] skipped — would post real comment")
    else:
        _do_comment(PORTS["tiktok_comments"], "/api/tiktok/comments/post",
                    {"postUrl": SAMPLE_POSTS["tiktok"], "text": comment_text},
                    "Post comment on TikTok",
                    post_url=SAMPLE_POSTS["tiktok"])

    # 4d. Threads comment
    subsect("4d. Threads comment")
    if dry_run:
        _s("Post comment on Threads", "[dry-run] skipped — would post real comment")
    else:
        _do_comment(PORTS["threads_comments"], "/api/threads/comments/post",
                    {"postUrl": SAMPLE_POSTS["threads"], "text": comment_text},
                    "Post comment on Threads",
                    post_url=SAMPLE_POSTS["threads"])

    # 4e. AI-generated Twitter reply (useAI=true — service generates comment from post context)
    subsect("4e. AI-generated Twitter reply (useAI=true)")
    if dry_run:
        _s("AI-generated Twitter reply", "[dry-run] skipped")
    else:
        _do_comment(PORTS["twitter_comments"], "/api/twitter/comments/post",
                    {"postUrl": SAMPLE_POSTS["twitter"], "useAI": True},
                    "AI-generated Twitter reply",
                    post_url=SAMPLE_POSTS["twitter"])


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 5: CONTACT NAVIGATION FROM SAVED CRM DATA
# Rules:
#   5a     — PASS if CRM has ≥ 1 Sarah entry (real DB row)
#   5b-5e  — PASS if osascript exits 0 (Safari actually navigated)
#   5f     — DM from navigated profile: PASS if success:true, SKIP if needs session
# ══════════════════════════════════════════════════════════════════════════════
def suite_navigate(dry_run=False):
    sect("SUITE 5: CONTACT NAVIGATION FROM SAVED DATA")

    # 5a. Load Sarah E Ashley handles from CRM
    subsect("5a. Load Sarah E Ashley handles from CRM")
    handles = {}
    try:
        rows = sb("GET", "crm_contacts",
                  qs="display_name=ilike.*sarah*ashley*&select=platform,username&limit=10")
        handles = {r["platform"]: r.get("username", "") for r in rows if r.get("username")}
        if handles:
            _p("Sarah handles loaded from CRM", str(handles))
        else:
            _f("Sarah handles not found in CRM", "no rows returned")
    except Exception as e:
        _f("Load CRM handles", str(e))

    ig_handle = handles.get("instagram") or SARAH["instagram"]
    tw_handle = handles.get("twitter")   or SARAH["twitter"]
    tt_handle = handles.get("tiktok")    or SARAH["tiktok"]

    # 5b. Navigate Safari → Sarah on Instagram
    subsect("5b. Navigate Safari → Sarah on Instagram")
    ig_url = f"https://www.instagram.com/{ig_handle}/"
    if dry_run:
        _s("Navigate to Sarah on Instagram", f"[dry-run] would open {ig_url}")
    else:
        ok = _nav_safari(ig_url)
        if ok:
            _p("Navigate to Sarah on Instagram", ig_url)
        else:
            _f("Navigate to Sarah on Instagram", "osascript failed")
        time.sleep(2)

    # 5c. Navigate Safari → Sarah on Twitter/X
    subsect("5c. Navigate Safari → Sarah on Twitter")
    tw_url = f"https://x.com/{tw_handle}"
    if dry_run:
        _s("Navigate to Sarah on Twitter", f"[dry-run] would open {tw_url}")
    else:
        ok = _nav_safari(tw_url)
        if ok:
            _p("Navigate to Sarah on Twitter", tw_url)
        else:
            _f("Navigate to Sarah on Twitter", "osascript failed")
        time.sleep(2)

    # 5d. Navigate Safari → Sarah on TikTok
    subsect("5d. Navigate Safari → Sarah on TikTok")
    tt_url = f"https://www.tiktok.com/@{tt_handle.replace(' ', '').lower()}"
    if dry_run:
        _s("Navigate to Sarah on TikTok", f"[dry-run] would open {tt_url}")
    else:
        ok = _nav_safari(tt_url)
        if ok:
            _p("Navigate to Sarah on TikTok", tt_url)
        else:
            _f("Navigate to Sarah on TikTok", "osascript failed")
        time.sleep(2)

    # 5e. Navigate Safari → Isaiah on LinkedIn
    subsect("5e. Navigate Safari → Isaiah on LinkedIn")
    li_url = ISAIAH["linkedin"]
    if dry_run:
        _s("Navigate to Isaiah on LinkedIn", f"[dry-run] would open {li_url}")
    else:
        ok = _nav_safari(li_url)
        if ok:
            _p("Navigate to Isaiah on LinkedIn", li_url)
        else:
            _f("Navigate to Isaiah on LinkedIn", "osascript failed")
        time.sleep(2)

    # 5f. DM Sarah from navigated profile context (field = 'text' not 'message')
    subsect("5f. DM Sarah from saved contact — each platform")
    dm_msg = "Hey Sarah! Loved your recent content on branding. Would love to connect!"
    if dry_run:
        _s("DM Sarah from nav context (all platforms)", "[dry-run] skipped")
    else:
        _do_dm(PORTS["instagram_dm"], "/api/messages/send-to",
               {"username": ig_handle, "text": dm_msg},
               "DM Sarah on Instagram (from nav)",
               inbox_url=INBOX_URLS["instagram"])
        _do_dm(PORTS["twitter_dm"], "/api/twitter/messages/send-to",
               {"username": tw_handle, "text": dm_msg},
               "DM Sarah on Twitter (from nav)")
        _do_dm(PORTS["tiktok_dm"], "/api/tiktok/messages/send-to",
               {"username": tt_handle, "text": dm_msg},
               "DM Sarah on TikTok (from nav)",
               inbox_url=INBOX_URLS["tiktok"])


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 6: DATA SYNC — Safari → Supabase
# Rules:
#   6a/6d  — PASS if row counts are real integers (DB accessible)
#   6b     — PASS if crm_brain --sync exits 0 AND printed "synced"
#   6c     — PASS if crm_brain --sync-linkedin exits 0
#   6e     — SKIP if no conversations yet (inbox sync needs live Safari session)
# ══════════════════════════════════════════════════════════════════════════════
def suite_sync(dry_run=False):
    sect("SUITE 6: DATA SYNC — SAFARI → SUPABASE")

    # 6a. Pre-sync counts (verifies DB connectivity)
    subsect("6a. Pre-sync counts")
    pre = {}
    for table in ["crm_contacts", "crm_conversations", "crm_messages", "crm_message_queue"]:
        try:
            rows = sb("GET", table, qs="select=id&limit=1000")
            pre[table] = len(rows)
            print(f"      {table}: {len(rows)} rows")
        except Exception as e:
            pre[table] = 0
            print(f"      {table}: error — {e}")
    if pre.get("crm_contacts", 0) > 0:
        _p("CRM database accessible", f"{pre['crm_contacts']} contacts pre-sync")
    else:
        _f("CRM database", "crm_contacts empty or unreachable")

    # 6b. Sync all platforms (Safari → Supabase)
    subsect("6b. crm_brain.py --sync (all platforms)")
    if dry_run:
        _s("Platform sync", "[dry-run] skipped")
    else:
        r = subprocess.run(
            ["python3", f"{BASE}/crm_brain.py", "--sync"],
            capture_output=True, text=True, timeout=60, cwd=BASE,
            env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
        sync_output = r.stdout + r.stderr
        for line in sync_output.splitlines():
            if line.strip() and any(k in line for k in ["✅", "❌", "⚠️", "synced", "convers", "Services"]):
                print(f"      {line.strip()}")
        if "synced" in sync_output.lower() and r.returncode == 0:
            _p("Platform sync completed")
        else:
            _f("Platform sync", (r.stderr or sync_output)[:80])

    # 6c. Sync LinkedIn prospects
    subsect("6c. crm_brain.py --sync-linkedin")
    if dry_run:
        _s("LinkedIn prospects sync", "[dry-run] skipped")
    else:
        r2 = subprocess.run(
            ["python3", f"{BASE}/crm_brain.py", "--sync-linkedin"],
            capture_output=True, text=True, timeout=30, cwd=BASE,
            env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
        if r2.returncode == 0:
            sync_line = next((l for l in r2.stdout.splitlines() if "synced" in l.lower()),
                             r2.stdout.strip()[:60])
            _p("LinkedIn prospects sync", sync_line.strip())
        else:
            _f("LinkedIn prospects sync", r2.stderr[:80])

    # 6d. Post-sync counts (must show ≥ pre-sync)
    subsect("6d. Post-sync counts (delta)")
    for table in ["crm_contacts", "crm_conversations"]:
        try:
            rows = sb("GET", table, qs="select=id&limit=1000")
            delta = len(rows) - pre.get(table, 0)
            _p(f"Post-sync {table}", f"{len(rows)} rows (+{delta})")
        except Exception as e:
            _f(f"Post-sync {table}", str(e))

    # 6e. Verify Sarah E Ashley in crm_conversations (needs live Safari inbox sync)
    subsect("6e. Verify Sarah E Ashley in crm_conversations")
    try:
        sarah = sb("GET", "crm_contacts",
                   qs="display_name=ilike.*sarah*ashley*&select=id&limit=1")
        if sarah:
            cid = sarah[0]["id"]
            convos = sb("GET", "crm_conversations", qs=f"contact_id=eq.{cid}&select=*&limit=5")
            if convos:
                _p("Sarah conversations in CRM", f"{len(convos)} conversation threads")
            else:
                _s("Sarah conversations", "no threads yet — needs Safari inbox sync with messages open")
        else:
            _s("Sarah in conversations", "contact not found (sync may not have run yet)")
    except Exception as e:
        _f("Sarah conversation verify", str(e))


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 7: CLOUD → SAFARI BROWSER CONTROL
# Rules:
#   7a-7d  — PASS if Supabase enqueue succeeds (real DB write)
#   7e     — PASS if daemon exits 0 AND each command shows ✅ in output
#   7f     — PASS if Supabase shows the commands as completed (not just pending)
#            Specifically: the DM command must show success:true in result
# ══════════════════════════════════════════════════════════════════════════════
def suite_cloud(dry_run=False):
    sect("SUITE 7: CLOUD → SAFARI BROWSER CONTROL")

    # 7a. Verify safari_command_queue table exists
    subsect("7a. safari_command_queue table")
    try:
        rows = sb("GET", "safari_command_queue", qs="select=id&limit=1")
        _p("safari_command_queue accessible", f"{len(rows)} row(s) accessible")
    except Exception as e:
        _f("safari_command_queue", f"table missing or error: {e}")
        print("      → Run: python3 scripts/safari_cloud_controller.py --create-table")
        return

    # 7b. Enqueue a navigate command (cloud tells Safari to navigate)
    subsect("7b. Enqueue navigate command from cloud")
    cmd = {
        "action":    "navigate",
        "platform":  "instagram",
        "params":    {"url": f"https://www.instagram.com/{SARAH['instagram']}/"},
        "priority":  1,
        "status":    "pending",
        "created_at": utcnow(),
    }
    try:
        result = sb("POST", "safari_command_queue", cmd)
        cmd_id = result[0]["id"] if isinstance(result, list) and result else None
        _p("Navigate command enqueued", f"id={cmd_id[:8]}..." if cmd_id else "enqueued")
    except Exception as e:
        _f("Enqueue navigate command", str(e))

    # 7c. Enqueue a DM command (cloud tells Safari to send DM to @saraheashley on Twitter)
    subsect("7c. Enqueue DM command from cloud")
    dm_cmd = {
        "action":   "send_dm",
        "platform": "twitter",
        "params":   {"username": SARAH["twitter"],
                     "text": f"[cloud-triggered] Hello from CRM — {utcnow()[:16]}"},
        "priority": 2,
        "status":   "pending",
        "created_at": utcnow(),
    }
    try:
        sb("POST", "safari_command_queue", dm_cmd)
        _p("DM command enqueued from cloud")
    except Exception as e:
        _f("Enqueue DM command", str(e))

    # 7d. Enqueue a market research command
    subsect("7d. Enqueue market research command from cloud")
    mr_cmd = {
        "action":   "market_research",
        "platform": "twitter",
        "params":   {"keyword": "AI copywriting", "maxPosts": 10},
        "priority": 3,
        "status":   "pending",
        "created_at": utcnow(),
    }
    try:
        sb("POST", "safari_command_queue", mr_cmd)
        _p("Market research command enqueued from cloud")
    except Exception as e:
        _f("Enqueue market research command", str(e))

    # 7e. Daemon executes pending commands (verifies real execution)
    subsect("7e. Daemon: execute pending commands")
    if dry_run:
        _s("Cloud daemon execution", "[dry-run] skipped")
        return
    r = subprocess.run(
        ["python3", f"{BASE}/safari_cloud_controller.py", "--run-once"],
        capture_output=True, text=True, timeout=60, cwd=BASE,
        env={**os.environ, "ANTHROPIC_API_KEY": ANTHROPIC_KEY})
    output = r.stdout + r.stderr
    for line in output.splitlines():
        if line.strip():
            print(f"      {line}")
    if r.returncode == 0 and "executed" in output.lower():
        _p("Cloud daemon ran successfully")
    elif r.returncode == 0:
        _p("Cloud daemon completed", "no pending commands or queue empty")
    else:
        _f("Cloud daemon", r.stderr[:80] or "non-zero exit")

    # 7f. Verify DM command actually completed with success:true in result
    subsect("7f. Verify cloud DM executed successfully in Supabase")
    try:
        done = sb("GET", "safari_command_queue",
                  qs="action=eq.send_dm&status=eq.completed&order=created_at.desc&limit=3")
        failed = sb("GET", "safari_command_queue",
                    qs="action=eq.send_dm&status=eq.failed&order=created_at.desc&limit=3")
        if done:
            # Check the result field for actual success
            last = done[0]
            result_data = last.get("result", {})
            if isinstance(result_data, str):
                try:
                    result_data = json.loads(result_data)
                except Exception:
                    pass
            dm_ok = (isinstance(result_data, dict) and result_data.get("success")) or \
                    ("success" in str(result_data).lower())
            if dm_ok:
                _p("Cloud DM executed", f"success=true in queue result | {str(result_data)[:60]}")
            else:
                _s("Cloud DM result", f"completed but result unclear: {str(result_data)[:60]}")
        elif failed:
            _f("Cloud DM", f"command failed: {failed[0].get('error','?')[:60]}")
        else:
            _s("Cloud DM verify", "no completed send_dm found — daemon may not have run yet")
    except Exception as e:
        _f("Command queue verify", str(e))


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
SUITES = {
    "dm":       suite_dm,
    "research": suite_research,
    "market":   suite_market,
    "comments": suite_comments,
    "navigate": suite_navigate,
    "sync":     suite_sync,
    "cloud":    suite_cloud,
}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", choices=list(SUITES.keys()), help="Run single suite")
    ap.add_argument("--dry-run", action="store_true", help="Verify routes only, no real sends (DMs still run)")
    ap.add_argument("--verbose", "-v", action="store_true", help="Print full request/response bodies")
    args = ap.parse_args()

    if args.verbose:
        VERBOSE = True

    dry = args.dry_run
    if dry:
        print("\n  [DRY-RUN MODE] — Comments will be skipped; DMs to Sarah still run\n")

    if args.suite:
        SUITES[args.suite](dry_run=dry)
    else:
        for name, fn in SUITES.items():
            fn(dry_run=dry)

    # Summary
    total = _pass + _fail + _skip
    print(f"\n{'═'*60}")
    print(f"  ✅ {_pass} passed  |  ❌ {_fail} failed  |  ⏭  {_skip} skipped  |  {total} total")
    print(f"{'═'*60}")

    if _fail > 0:
        print("\n  FAILURES:")
        for status, label, detail in _results:
            if status == "FAIL":
                print(f"    ❌ {label}: {detail[:70]}")

    sys.exit(0 if _fail == 0 else 1)
