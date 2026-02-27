#!/usr/bin/env python3
"""
pipeline_enricher.py — Stage 2: Enrichment Agent
For each DISCOVERED prospect: pull public profile data, extract signals,
normalize handles, detect pain/intent keywords.

Run:
    python3 pipeline_enricher.py              # enrich all DISCOVERED prospects
    python3 pipeline_enricher.py --limit 50   # batch size
"""
import json, sys, os, re, time, argparse, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(__file__))
from pipeline_db import get_prospects, update_prospect, advance_stage, utcnow, log_run

DM_SERVICES = {
    "instagram": "http://localhost:3001",
    "twitter":   "http://localhost:3003",
    "tiktok":    "http://localhost:3102",
    "linkedin":  "http://localhost:3105",
}

# ── Pain / intent signal keyword banks ────────────────────────────────────

PAIN_KEYWORDS = [
    "can't grow", "stuck at", "no clients", "need leads", "struggling with",
    "frustrated", "overwhelmed", "manual process", "too slow", "too expensive",
    "waste time", "inefficient", "broken", "doesn't work", "failing",
    "can't figure out", "help me with", "anyone know how",
]

INTENT_KEYWORDS = [
    "looking for", "need help with", "anyone recommend", "what tool",
    "how do you automate", "trying to automate", "want to hire", "dm me",
    "taking clients", "open to", "interested in", "building", "launching",
    "starting", "want to learn", "how to get", "need to figure out",
]

BUDGET_SIGNALS = [
    "revenue", "mrr", "arr", "clients", "paying", "agency", "consulting",
    "freelance", "invoice", "budget", "invest", "profitable", "sale",
]

# ── HTTP helper ────────────────────────────────────────────────────────────

def http_get(url, timeout=15):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)[:80]

def http_post(url, body, timeout=20):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)[:80]

# ── Signal extraction ──────────────────────────────────────────────────────

def extract_signals(text):
    """Pull pain/intent signals from any text block."""
    text_lower = text.lower()
    pain = [kw for kw in PAIN_KEYWORDS if kw in text_lower]
    intent = [kw for kw in INTENT_KEYWORDS if kw in text_lower]
    tools = re.findall(
        r'\b(gpt|claude|notion|zapier|make\.com|hubspot|salesforce|'
        r'convertkit|beehiiv|twitter|instagram|tiktok|shopify|stripe|'
        r'webflow|framer|vercel|supabase|airtable|calendly)\b',
        text_lower
    )
    budget = [kw for kw in BUDGET_SIGNALS if kw in text_lower]
    public_email = None
    email_match = re.search(r'[\w.+-]+@[\w-]+\.[a-z]{2,}', text)
    if email_match:
        public_email = email_match.group(0)
    return {
        "pain_signals":   list(set(pain))[:10],
        "intent_signals": list(set(intent))[:10],
        "tools_mentioned": list(set(tools))[:15],
        "has_budget_signal": len(budget) > 0,
        "public_email": public_email,
    }


def summarize_posts(posts, max_chars=500):
    """Simple extractive summary of recent posts — no LLM needed."""
    texts = []
    for p in posts[:10]:
        t = (p.get("text") or p.get("content") or p.get("caption") or "").strip()
        if t and len(t) > 20:
            texts.append(t[:200])
    if not texts:
        return ""
    combined = " | ".join(texts)
    return combined[:max_chars]


# ── Platform enrichers ─────────────────────────────────────────────────────

def enrich_from_twitter(handle):
    """Use Twitter DM service to get profile info."""
    svc = DM_SERVICES["twitter"]
    # Check if service is up
    health, err = http_get(f"{svc}/health", timeout=5)
    if err:
        return {}
    # Try to get profile via the service
    data, err = http_get(f"{svc}/api/profile?username={handle}", timeout=15)
    if not data:
        return {}
    return {
        "display_name": data.get("name") or handle,
        "audience_size": int(data.get("followers_count") or data.get("followers") or 0),
        "website": data.get("url") or data.get("website") or "",
        "bio": data.get("description") or data.get("bio") or "",
        "recent_posts": data.get("recent_tweets") or data.get("posts") or [],
    }


def enrich_from_instagram(handle):
    svc = DM_SERVICES["instagram"]
    health, err = http_get(f"{svc}/health", timeout=5)
    if err:
        return {}
    data, err = http_get(f"{svc}/api/profile?username={handle}", timeout=15)
    if not data:
        return {}
    return {
        "display_name": data.get("full_name") or data.get("name") or handle,
        "audience_size": int(data.get("follower_count") or data.get("followers") or 0),
        "website": data.get("external_url") or data.get("website") or "",
        "bio": data.get("biography") or data.get("bio") or "",
        "recent_posts": data.get("recent_posts") or data.get("posts") or [],
    }


def enrich_from_tiktok(handle):
    svc = DM_SERVICES["tiktok"]
    health, err = http_get(f"{svc}/health", timeout=5)
    if err:
        return {}
    data, err = http_get(f"{svc}/api/profile?username={handle}", timeout=15)
    if not data:
        return {}
    return {
        "display_name": data.get("nickname") or data.get("name") or handle,
        "audience_size": int(data.get("follower_count") or data.get("followers") or 0),
        "website": data.get("bioLink") or data.get("website") or "",
        "bio": data.get("signature") or data.get("bio") or "",
        "recent_posts": data.get("recent_videos") or data.get("posts") or [],
    }


ENRICHERS = {
    "twitter":   enrich_from_twitter,
    "instagram": enrich_from_instagram,
    "tiktok":    enrich_from_tiktok,
}


def enrich_prospect(prospect):
    """
    Enrich one prospect with public data.
    Returns dict of fields to update, or None on failure.
    """
    plat = prospect.get("discovered_via_platform", "twitter")
    handle_field = f"{plat}_handle"
    handle = (prospect.get(handle_field) or "").lstrip("@")
    if not handle:
        return None

    enricher = ENRICHERS.get(plat)
    raw = enricher(handle) if enricher else {}

    bio = raw.get("bio", "")
    recent_posts = raw.get("recent_posts", [])
    summary = summarize_posts(recent_posts)
    signals = extract_signals(f"{bio} {summary}")

    fields = {
        "stage": "ENRICHED",
    }
    if raw.get("display_name"):
        fields["display_name"] = raw["display_name"]
    if raw.get("audience_size"):
        fields["audience_size"] = raw["audience_size"]
    if raw.get("website"):
        fields["website"] = raw["website"]
    if summary:
        fields["recent_posts_summary"] = summary[:1000]
    if signals["pain_signals"]:
        fields["pain_signals"] = signals["pain_signals"]
    if signals["intent_signals"]:
        fields["intent_signals"] = signals["intent_signals"]
    if signals["tools_mentioned"]:
        fields["tools_mentioned"] = signals["tools_mentioned"]
    if signals["public_email"]:
        fields["public_email"] = signals["public_email"]

    return fields


def run_enricher(limit=100, dry_run=False):
    """Enrich all DISCOVERED prospects."""
    print(f"\n🔬 Running Enricher (limit={limit}, dry_run={dry_run})")
    run_id = log_run("enrich")

    prospects, err = get_prospects(stage="DISCOVERED", limit=limit)
    if err:
        print(f"  ❌ Error fetching prospects: {err}")
        return 0

    print(f"  📋 {len(prospects)} DISCOVERED prospects to enrich")
    enriched = 0

    for p in prospects:
        fields = enrich_prospect(p)
        if fields is None:
            # No handle — mark as enriched with minimal data anyway
            fields = {"stage": "ENRICHED"}

        if not dry_run:
            _, err = update_prospect(p["id"], fields)
            if not err:
                enriched += 1
            else:
                print(f"    ⚠️  Update failed for {p.get('display_name')}: {err}")
        else:
            enriched += 1
            plat = p.get("discovered_via_platform", "?")
            handle = p.get(f"{plat}_handle", "unknown")
            print(f"    [DRY] {handle}: pain={len(fields.get('pain_signals',[]))} "
                  f"intent={len(fields.get('intent_signals',[]))}")

        time.sleep(0.3)  # gentle pace

    print(f"  ✅ Enriched {enriched}/{len(prospects)} prospects")
    log_run("enrich", run_id=run_id, prospects_enriched=enriched)
    return enriched


def main():
    parser = argparse.ArgumentParser(description="Pipeline Enricher")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run_enricher(limit=args.limit, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
