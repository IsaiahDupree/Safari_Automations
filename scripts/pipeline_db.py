#!/usr/bin/env python3
"""
pipeline_db.py — Supabase helpers for the prospect pipeline.
All tables: prospects, prospect_touches, prospect_signals,
            pipeline_creators, pipeline_keywords, pipeline_runs
"""
import json, os, urllib.request, urllib.error, hashlib
from datetime import datetime, timezone

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or
                "https://ivhfuhxorppptyuofbgq.supabase.co")
SUPABASE_KEY = (os.environ.get("SUPABASE_SERVICE_KEY") or
                os.environ.get("SUPABASE_ANON_KEY") or
                "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}

def utcnow():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# ── low-level ──────────────────────────────────────────────────────────────

def _request(method, path, body=None, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{path}{params}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return json.loads(raw) if raw else [], None
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:300]
        return None, f"HTTP {e.code}: {body}"
    except Exception as e:
        return None, str(e)[:100]

def _upsert(table, rows, on_conflict):
    if not rows:
        return 0, None
    result, err = _request("POST", table,
                            body=rows,
                            params=f"?on_conflict={on_conflict}")
    if err:
        return 0, err
    return len(rows), None

def _select(table, params=""):
    result, err = _request("GET", table, params=params)
    return result or [], err

# ── prospects ──────────────────────────────────────────────────────────────

def _platform_handle_field(platform):
    return {
        "instagram": "instagram_handle",
        "twitter":   "twitter_handle",
        "tiktok":    "tiktok_handle",
        "linkedin":  "linkedin_handle",
        "threads":   "threads_handle",
    }.get(platform, "twitter_handle")

def _normalize_rows(rows):
    """Ensure every row in the list has identical keys (null-fill missing fields).
    PostgREST requires all objects in the array to have the same keys."""
    if not rows:
        return rows
    all_keys = set()
    for r in rows:
        all_keys.update(r.keys())
    return [{k: r.get(k) for k in all_keys} for r in rows]


def upsert_prospects(rows):
    """
    Upsert prospect rows.  Each row must include at least one of:
    instagram_handle, twitter_handle, tiktok_handle, linkedin_handle.
    Deduplication is per platform_handle column.
    """
    clean = []
    for r in rows:
        r.setdefault("stage", "DISCOVERED")
        r.setdefault("created_at", utcnow())
        clean.append(r)

    # Split by platform to use the right conflict column
    by_platform = {}
    for r in clean:
        plat = r.get("discovered_via_platform", "twitter")
        by_platform.setdefault(plat, []).append(r)

    total = 0
    last_err = None
    for plat, group in by_platform.items():
        col = _platform_handle_field(plat)
        # All rows in the group must have identical keys for PostgREST
        normalized = _normalize_rows(group)
        n, err = _upsert("prospects", normalized, on_conflict=col)
        total += n
        if err:
            last_err = err
    return total, last_err

def get_prospects(stage=None, bucket=None, limit=200, ready_for_touch=False):
    params = f"?limit={limit}&order=composite_score.desc"
    filters = []
    if stage:
        filters.append(f"stage=eq.{stage}")
    if bucket:
        filters.append(f"bucket=eq.{bucket}")
    if ready_for_touch:
        filters.append("do_not_contact=eq.false")
        filters.append(f"next_touch_at=lte.{utcnow()}")
    if filters:
        params += "&" + "&".join(filters)
    return _select("prospects", params)

def update_prospect(prospect_id, fields):
    fields["updated_at"] = utcnow()
    result, err = _request("PATCH", "prospects",
                            body=fields,
                            params=f"?id=eq.{prospect_id}")
    return result, err

def advance_stage(prospect_id, new_stage, extra_fields=None):
    fields = {"stage": new_stage, **(extra_fields or {})}
    stage_ts_map = {
        "WARMED":    "warmed_at",
        "CONTACTED": "contacted_at",
        "RESPONDED": "responded_at",
        "QUALIFIED": "qualified_at",
    }
    if new_stage in stage_ts_map:
        fields[stage_ts_map[new_stage]] = utcnow()
    return update_prospect(prospect_id, fields)

# ── touches ────────────────────────────────────────────────────────────────

def queue_touch(prospect_id, touch_type, platform, content,
                channel=None, require_approval=True):
    row = {
        "prospect_id": str(prospect_id),
        "touch_type":  touch_type,
        "platform":    platform,
        "channel":     channel or f"dm_{platform}",
        "content":     content,
        "status":      "queued" if require_approval else "approved",
        "created_at":  utcnow(),
    }
    result, err = _request("POST", "prospect_touches", body=[row])
    return result, err

def get_queued_touches(limit=50):
    params = f"?status=eq.queued&limit={limit}&order=created_at.asc"
    return _select("prospect_touches", params)

def get_approved_touches(limit=50):
    params = f"?status=eq.approved&limit={limit}&order=created_at.asc"
    return _select("prospect_touches", params)

def mark_touch_sent(touch_id, sent=True):
    fields = {"status": "sent" if sent else "failed", "sent_at": utcnow()}
    result, err = _request("PATCH", "prospect_touches",
                            body=fields,
                            params=f"?id=eq.{touch_id}")
    return result, err

def record_reply(touch_id, response_text, intent):
    fields = {
        "response_received": True,
        "response_text":     response_text[:1000],
        "response_intent":   intent,
    }
    result, err = _request("PATCH", "prospect_touches",
                            body=fields,
                            params=f"?id=eq.{touch_id}")
    return result, err

# ── creators ───────────────────────────────────────────────────────────────

def upsert_creators(rows):
    clean = []
    for r in rows:
        clean.append({
            "platform":       r.get("platform", "twitter"),
            "handle":         r.get("handle", ""),
            "display_name":   r.get("display_name") or r.get("handle"),
            "niche":          r.get("niche", ""),
            "audience_size":  int(r.get("audience_size") or r.get("followers") or 0),
            "avg_engagement": float(r.get("total_engagement") or r.get("avg_engagement") or 0),
            "last_scraped_at": utcnow(),
        })
    return _upsert("pipeline_creators", clean, on_conflict="platform,handle")

def get_top_creators(platform=None, limit=50):
    params = f"?limit={limit}&order=avg_engagement.desc"
    if platform:
        params += f"&platform=eq.{platform}"
    return _select("pipeline_creators", params)

# ── keywords ───────────────────────────────────────────────────────────────

def get_active_keywords(niche=None):
    params = "?active=eq.true&order=created_at.asc"
    if niche:
        params += f"&niche=eq.{niche}"
    rows, _ = _select("pipeline_keywords", params)
    return rows or []

def seed_keywords(keywords):
    """keywords = list of {keyword, category, niche, offer_tag}"""
    rows = [{**kw, "active": True} for kw in keywords]
    return _upsert("pipeline_keywords", rows, on_conflict="keyword,niche")

# ── pipeline_runs ──────────────────────────────────────────────────────────

def log_run(phase, platform=None, keyword=None, run_id=None,
            prospects_found=0, prospects_enriched=0, prospects_scored=0,
            touches_queued=0, touches_sent=0, errors=None):
    if run_id:
        # Update existing run
        fields = {
            "prospects_found":    prospects_found,
            "prospects_enriched": prospects_enriched,
            "prospects_scored":   prospects_scored,
            "touches_queued":     touches_queued,
            "touches_sent":       touches_sent,
            "finished_at":        utcnow(),
        }
        if errors:
            fields["errors"] = errors
        _request("PATCH", "pipeline_runs", body=fields,
                 params=f"?id=eq.{run_id}")
        return run_id

    row = {
        "phase":              phase,
        "platform":           platform,
        "keyword":            keyword,
        "prospects_found":    prospects_found,
        "started_at":         utcnow(),
    }
    result, err = _request("POST", "pipeline_runs", body=[row])
    if result and isinstance(result, list) and result:
        return result[0].get("id")
    return None

# ── offers ─────────────────────────────────────────────────────────────────

def get_offers(active_only=True):
    params = "?order=created_at.asc"
    if active_only:
        params += "&active=eq.true"
    rows, _ = _select("pipeline_offers", params)
    return rows or []

def seed_offers(offers):
    return _upsert("pipeline_offers", offers, on_conflict="name")
