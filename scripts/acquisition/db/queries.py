"""
acquisition/db/queries.py — Typed query functions for all acquisition tables.

Uses stdlib urllib.request against Supabase REST API, matching the pattern
established by crm_brain.py and pipeline_db.py in this project.
"""
import json
import os
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from ..config import SUPABASE_URL, SUPABASE_KEY, DEFAULT_DAILY_CAPS

# ── HTTP plumbing ─────────────────────────────────────────────────────────────

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates",
}


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _request(method: str, path: str, body: Any = None, params: str = "") -> tuple[Any, Optional[str]]:
    url = f"{SUPABASE_URL}/rest/v1/{path}{params}"
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(HEADERS)
    if method in ("POST", "PATCH") and body is not None:
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return (json.loads(raw) if raw else []), None
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:300]
        return None, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return None, str(e)[:200]


def _select(table: str, params: str = "") -> tuple[list[dict], Optional[str]]:
    result, err = _request("GET", table, params=params)
    return result or [], err


def _upsert(table: str, rows: list[dict], on_conflict: str = "") -> tuple[int, Optional[str]]:
    if not rows:
        return 0, None
    # Normalize: ensure every row has the same keys
    all_keys = set()
    for r in rows:
        all_keys.update(r.keys())
    normalized = [{k: r.get(k) for k in all_keys} for r in rows]
    conflict = f"?on_conflict={on_conflict}" if on_conflict else ""
    result, err = _request("POST", table, body=normalized, params=conflict)
    if err:
        return 0, err
    return len(rows), None


def _update(table: str, filters: str, body: dict) -> tuple[Any, Optional[str]]:
    return _request("PATCH", table, body=body, params=filters)


def _delete(table: str, filters: str) -> tuple[Any, Optional[str]]:
    return _request("DELETE", table, params=filters)


# ═══════════════════════════════════════════════════════════════════════════════
# NicheConfig CRUD
# ═══════════════════════════════════════════════════════════════════════════════

def get_niche_configs(active_only: bool = True) -> tuple[list[dict], Optional[str]]:
    params = "?order=created_at.asc"
    if active_only:
        params += "&is_active=eq.true"
    return _select("acq_niche_configs", params)


def get_niche_config(niche_id: str) -> tuple[Optional[dict], Optional[str]]:
    rows, err = _select("acq_niche_configs", f"?id=eq.{niche_id}")
    if err:
        return None, err
    return rows[0] if rows else None, None


def create_niche_config(config: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_niche_configs", body=[config])


def update_niche_config(niche_id: str, updates: dict) -> tuple[Any, Optional[str]]:
    return _update("acq_niche_configs", f"?id=eq.{niche_id}", updates)


def deactivate_niche_config(niche_id: str) -> tuple[Any, Optional[str]]:
    return _update("acq_niche_configs", f"?id=eq.{niche_id}", {"is_active": False})


# ═══════════════════════════════════════════════════════════════════════════════
# Contacts (crm_contacts) — acquisition-specific queries
# ═══════════════════════════════════════════════════════════════════════════════

def upsert_contact(contact: dict) -> tuple[int, Optional[str]]:
    return _upsert("crm_contacts", [contact], on_conflict="id")


def get_contacts_by_stage(stage: str, limit: int = 100) -> tuple[list[dict], Optional[str]]:
    return _select("crm_contacts", f"?pipeline_stage=eq.{stage}&limit={limit}&order=created_at.asc")


def get_unscored_contacts(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    return _select("crm_contacts", f"?pipeline_stage=eq.new&limit={limit}&order=created_at.asc")


def get_qualified_contacts(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    return _select("crm_contacts", f"?pipeline_stage=eq.qualified&limit={limit}&order=created_at.asc")


def get_warming_contacts(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    return _select("crm_contacts", f"?pipeline_stage=eq.warming&limit={limit}&order=created_at.asc")


def get_ready_for_dm(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    return _select("crm_contacts", f"?pipeline_stage=eq.ready_for_dm&limit={limit}&order=created_at.asc")


def get_unresolved_contacts(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    return _select(
        "crm_contacts",
        f"?entity_resolved=eq.false&pipeline_stage=neq.archived&limit={limit}&order=created_at.asc"
    )


def get_contact(contact_id: str) -> tuple[Optional[dict], Optional[str]]:
    rows, err = _select("crm_contacts", f"?id=eq.{contact_id}")
    if err:
        return None, err
    return rows[0] if rows else None, None


def update_contact_email(contact_id: str, email: str, verified: bool = False) -> tuple[Any, Optional[str]]:
    updates = {
        "email": email,
        "email_verified": verified,
    }
    return _update("crm_contacts", f"?id=eq.{contact_id}", updates)


def update_pipeline_stage(contact_id: str, new_stage: str, triggered_by: str = "system") -> tuple[Any, Optional[str]]:
    # Get current stage first
    rows, err = _select("crm_contacts", f"?id=eq.{contact_id}&select=pipeline_stage")
    if err:
        return None, err
    old_stage = rows[0]["pipeline_stage"] if rows else "unknown"

    # Update contact
    updates: dict[str, Any] = {"pipeline_stage": new_stage}
    if new_stage == "archived":
        updates["archived_at"] = _utcnow()
    result, err = _update("crm_contacts", f"?id=eq.{contact_id}", updates)
    if err:
        return None, err

    # Record funnel event
    insert_funnel_event(contact_id, old_stage, new_stage, triggered_by)
    return result, None


# ═══════════════════════════════════════════════════════════════════════════════
# Score History (PRD-023: ICP Scoring)
# ═══════════════════════════════════════════════════════════════════════════════

def insert_score_history(
    contact_id: str,
    score: int,
    reasoning: str = "",
    signals: list[str] | None = None,
    model_used: str = "claude-haiku-4-5-20251001"
) -> tuple[Any, Optional[str]]:
    """Insert a new score history record and update contact's relationship_score."""
    # Insert score history
    history_record = {
        "contact_id": contact_id,
        "score": score,
        "reasoning": reasoning,
        "signals": signals or [],
        "model_used": model_used,
        "scored_at": _utcnow(),
    }
    result, err = _request("POST", "crm_score_history", body=[history_record])
    if err:
        return None, err

    # Update contact's relationship_score and last_scored_at
    _, err = _update("crm_contacts", f"?id=eq.{contact_id}", {
        "relationship_score": score,
        "last_scored_at": _utcnow(),
    })
    if err:
        return None, err

    return result, None


def get_score_history(contact_id: str, limit: int = 10) -> tuple[list[dict], Optional[str]]:
    """Get score history for a contact, most recent first."""
    return _select("crm_score_history", f"?contact_id=eq.{contact_id}&order=scored_at.desc&limit={limit}")


def get_contacts_for_scoring(
    limit: int = 50,
    niche_id: str | None = None,
    rescore_stale: bool = False
) -> tuple[list[dict], Optional[str]]:
    """
    Get contacts that need scoring.

    - If rescore_stale=False: contacts with relationship_score IS NULL and pipeline_stage='new'
    - If rescore_stale=True: contacts with last_scored_at > 30 days ago
    """
    if rescore_stale:
        # Contacts scored more than 30 days ago
        stale_date = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        params = f"?last_scored_at=lt.{stale_date}&pipeline_stage=neq.archived&order=last_scored_at.asc&limit={limit}"
        if niche_id:
            params += f"&source_niche_config_id=eq.{niche_id}"
        return _select("crm_contacts", params)
    else:
        # Unscored contacts in 'new' stage
        params = f"?relationship_score=is.null&pipeline_stage=eq.new&order=created_at.asc&limit={limit}"
        if niche_id:
            params += f"&source_niche_config_id=eq.{niche_id}"
        return _select("crm_contacts", params)


# ═══════════════════════════════════════════════════════════════════════════════
# Discovery Runs
# ═══════════════════════════════════════════════════════════════════════════════

def insert_discovery_run(run: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_discovery_runs", body=[run])


def get_recent_discovery_runs(limit: int = 20) -> tuple[list[dict], Optional[str]]:
    return _select("acq_discovery_runs", f"?order=run_at.desc&limit={limit}")


# ═══════════════════════════════════════════════════════════════════════════════
# Warmup Schedules
# ═══════════════════════════════════════════════════════════════════════════════

def insert_warmup_schedule(schedule: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_warmup_schedules", body=[schedule])


def get_pending_warmup(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    now = _utcnow()
    return _select(
        "acq_warmup_schedules",
        f"?status=eq.pending&scheduled_at=lte.{now}&order=scheduled_at.asc&limit={limit}"
    )


def update_warmup_status(schedule_id: str, status: str, **kwargs) -> tuple[Any, Optional[str]]:
    body: dict[str, Any] = {"status": status}
    if status == "sent":
        body["sent_at"] = _utcnow()
    body.update(kwargs)
    return _update("acq_warmup_schedules", f"?id=eq.{schedule_id}", body)


def get_warmup_schedules_for_contact(contact_id: str, status: Optional[str] = None) -> tuple[list[dict], Optional[str]]:
    """Get warmup schedules for a contact, optionally filtered by status."""
    params = f"?contact_id=eq.{contact_id}&order=scheduled_at.asc"
    if status:
        params += f"&status=eq.{status}"
    return _select("acq_warmup_schedules", params)


def get_warmup_config(niche_id: str) -> tuple[Optional[dict], Optional[str]]:
    """Get warmup config for a niche."""
    rows, err = _select("acq_warmup_configs", f"?niche_config_id=eq.{niche_id}")
    if err:
        return None, err
    return rows[0] if rows else None, None


# ═══════════════════════════════════════════════════════════════════════════════
# Outreach Sequences
# ═══════════════════════════════════════════════════════════════════════════════

def insert_outreach_sequence(seq: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_outreach_sequences", body=[seq])


def get_pending_outreach(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    now = _utcnow()
    return _select(
        "acq_outreach_sequences",
        f"?status=eq.pending&scheduled_at=lte.{now}&order=scheduled_at.asc&limit={limit}"
    )


def update_outreach_status(seq_id: str, status: str, **kwargs) -> tuple[Any, Optional[str]]:
    body: dict[str, Any] = {"status": status}
    if status == "sent":
        body["sent_at"] = _utcnow()
    body.update(kwargs)
    return _update("acq_outreach_sequences", f"?id=eq.{seq_id}", body)


def reschedule_outreach_to_tomorrow(seq_id: str) -> tuple[Any, Optional[str]]:
    """Reschedule a capped outreach sequence to tomorrow 9AM UTC.

    When a DM is skipped due to daily cap, the contact stays in pipeline
    and the sequence is rescheduled for the next day.
    """
    from datetime import datetime, timedelta, timezone, time as dt_time
    tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
    tomorrow_9am = datetime.combine(tomorrow, dt_time(9, 0), tzinfo=timezone.utc)
    return _update(
        "acq_outreach_sequences",
        f"?id=eq.{seq_id}",
        {"scheduled_at": tomorrow_9am.isoformat(), "skip_reason": "daily_cap_hit"},
    )


def get_today_stats() -> tuple[dict, Optional[str]]:
    """Get today's send/receive counts for the status dashboard."""
    today = datetime.now(timezone.utc).date().isoformat()
    stats: dict[str, int] = {}

    # DMs sent today
    rows, _ = _select(
        "acq_outreach_sequences",
        f"?status=eq.sent&sent_at=gte.{today}T00:00:00Z&select=id"
    )
    stats["dms_sent"] = len(rows) if rows else 0

    # Emails sent today
    rows, _ = _select(
        "acq_email_sequences",
        f"?status=eq.sent&sent_at=gte.{today}T00:00:00Z&select=id"
    )
    stats["emails_sent"] = len(rows) if rows else 0

    # Warmup comments sent today
    rows, _ = _select(
        "acq_warmup_schedules",
        f"?status=eq.sent&sent_at=gte.{today}T00:00:00Z&select=id"
    )
    stats["warmup_sent"] = len(rows) if rows else 0

    # Contacts discovered today
    rows, _ = _select(
        "acq_discovery_runs",
        f"?run_at=gte.{today}T00:00:00Z&select=seeded"
    )
    stats["discovered"] = sum(r.get("seeded", 0) for r in rows) if rows else 0

    return stats, None


# ═══════════════════════════════════════════════════════════════════════════════
# Email Sequences
# ═══════════════════════════════════════════════════════════════════════════════

def insert_email_sequence(seq: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_email_sequences", body=[seq])


def get_pending_email(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    now = _utcnow()
    return _select(
        "acq_email_sequences",
        f"?status=eq.pending&scheduled_at=lte.{now}&order=scheduled_at.asc&limit={limit}"
    )


def get_email_sequences_for_contact(contact_id: str) -> tuple[list[dict], Optional[str]]:
    return _select("acq_email_sequences", f"?contact_id=eq.{contact_id}&order=touch_number.asc")


def update_email_status(seq_id: str, status: str, **kwargs) -> tuple[Any, Optional[str]]:
    body: dict[str, Any] = {"status": status}
    if status == "sent":
        body["sent_at"] = _utcnow()
    body.update(kwargs)
    return _update("acq_email_sequences", f"?id=eq.{seq_id}", body)


def update_email_draft(seq_id: str, subject: str, body_text: str, body_html: str) -> tuple[Any, Optional[str]]:
    body = {
        "subject": subject,
        "body_text": body_text,
        "body_html": body_html,
    }
    return _update("acq_email_sequences", f"?id=eq.{seq_id}", body)


def update_email_sent(seq_id: str, resend_id: str) -> tuple[Any, Optional[str]]:
    body = {
        "status": "sent",
        "sent_at": _utcnow(),
        "resend_id": resend_id,
    }
    return _update("acq_email_sequences", f"?id=eq.{seq_id}", body)


def update_email_opened(resend_id: str) -> tuple[Any, Optional[str]]:
    return _update(
        "acq_email_sequences",
        f"?resend_id=eq.{resend_id}",
        {"opened_at": _utcnow()}
    )


def update_email_clicked(resend_id: str) -> tuple[Any, Optional[str]]:
    return _update(
        "acq_email_sequences",
        f"?resend_id=eq.{resend_id}",
        {"clicked_at": _utcnow()}
    )


def cancel_pending_email_sequences(contact_id: str) -> tuple[Any, Optional[str]]:
    return _update(
        "acq_email_sequences",
        f"?contact_id=eq.{contact_id}&status=eq.pending",
        {"status": "cancelled"}
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Email Discoveries
# ═══════════════════════════════════════════════════════════════════════════════

def upsert_email_discovery(discovery: dict) -> tuple[int, Optional[str]]:
    return _upsert("acq_email_discoveries", [discovery])


def get_email_discoveries(contact_id: str) -> tuple[list[dict], Optional[str]]:
    return _select(
        "acq_email_discoveries",
        f"?contact_id=eq.{contact_id}&order=confidence.desc,discovered_at.desc"
    )


def set_email_unverified(resend_id: str) -> tuple[Any, Optional[str]]:
    # First get the contact from the email sequence
    sequences, err = _select("acq_email_sequences", f"?resend_id=eq.{resend_id}&select=contact_id,to_email")
    if err or not sequences:
        return None, err or "sequence not found"

    contact_id = sequences[0]["contact_id"]

    # Update contact email_verified to false
    return _update("crm_contacts", f"?id=eq.{contact_id}", {"email_verified": False})


# ═══════════════════════════════════════════════════════════════════════════════
# Email Unsubscribes
# ═══════════════════════════════════════════════════════════════════════════════

def insert_unsubscribe(email: str, reason: str, contact_id: Optional[str] = None) -> tuple[Any, Optional[str]]:
    unsub = {
        "email": email,
        "reason": reason,
        "contact_id": contact_id,
        "unsubscribed_at": _utcnow(),
    }
    return _request("POST", "acq_email_unsubscribes", body=[unsub])


def is_email_unsubscribed(email: str) -> tuple[bool, Optional[str]]:
    rows, err = _select("acq_email_unsubscribes", f"?email=eq.{email}")
    if err:
        return False, err
    return len(rows) > 0, None


def set_email_opted_out(contact_id: str) -> tuple[Any, Optional[str]]:
    return _update("crm_contacts", f"?id=eq.{contact_id}", {"email_opted_out": True})


# ═══════════════════════════════════════════════════════════════════════════════
# Entity Resolution
# ═══════════════════════════════════════════════════════════════════════════════

def upsert_entity_association(assoc: dict) -> tuple[int, Optional[str]]:
    return _upsert("acq_entity_associations", [assoc])


def get_entity_associations(contact_id: str) -> tuple[list[dict], Optional[str]]:
    return _select("acq_entity_associations", f"?contact_id=eq.{contact_id}&order=confidence.desc")


def insert_resolution_run(run: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_resolution_runs", body=[run])


def enqueue_resolution(contact_id: str, priority: int = 5) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_resolution_queue", body=[{
        "contact_id": contact_id,
        "priority": priority,
        "queued_at": _utcnow(),
    }])


def get_resolution_queue(limit: int = 20) -> tuple[list[dict], Optional[str]]:
    return _select("acq_resolution_queue", f"?order=priority.asc,queued_at.asc&limit={limit}")


def dequeue_resolution(queue_id: str) -> tuple[Any, Optional[str]]:
    return _delete("acq_resolution_queue", f"?id=eq.{queue_id}")


# ═══════════════════════════════════════════════════════════════════════════════
# Daily Caps
# ═══════════════════════════════════════════════════════════════════════════════

def get_daily_cap(action_type: str, platform: str) -> tuple[Optional[dict], Optional[str]]:
    rows, err = _select(
        "acq_daily_caps",
        f"?action_type=eq.{action_type}&platform=eq.{platform}"
    )
    if err:
        return None, err
    return rows[0] if rows else None, None


def check_daily_cap(action_type: str, platform: str) -> tuple[bool, Optional[str]]:
    cap, err = get_daily_cap(action_type, platform)
    if err:
        return False, err
    if not cap:
        return False, f"No cap configured for {action_type}/{platform}"
    return cap["sent_today"] < cap["daily_limit"], None


def increment_daily_cap(action_type: str, platform: str) -> tuple[bool, Optional[str]]:
    cap, err = get_daily_cap(action_type, platform)
    if err:
        return False, err
    if not cap:
        return False, f"No cap configured for {action_type}/{platform}"
    if cap["sent_today"] >= cap["daily_limit"]:
        return False, None  # At limit, not an error
    new_sent = cap["sent_today"] + 1
    _, err = _update(
        "acq_daily_caps",
        f"?action_type=eq.{action_type}&platform=eq.{platform}",
        {"sent_today": new_sent, "updated_at": _utcnow()},
    )
    if err:
        return False, err
    return True, None


def reset_daily_caps() -> tuple[int, Optional[str]]:
    now = _utcnow()
    _, err = _update(
        "acq_daily_caps",
        f"?reset_at=lte.{now}",
        {"sent_today": 0, "reset_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(), "updated_at": now},
    )
    if err:
        return 0, err
    return 1, None


def seed_daily_caps() -> tuple[int, Optional[str]]:
    rows = []
    for (action_type, platform), limit in DEFAULT_DAILY_CAPS.items():
        rows.append({
            "action_type": action_type,
            "platform": platform,
            "daily_limit": limit,
            "sent_today": 0,
            "reset_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
            "updated_at": _utcnow(),
        })
    return _upsert("acq_daily_caps", rows, on_conflict="action_type,platform")


# ═══════════════════════════════════════════════════════════════════════════════
# Funnel Events
# ═══════════════════════════════════════════════════════════════════════════════

def insert_funnel_event(
    contact_id: str,
    from_stage: str,
    to_stage: str,
    triggered_by: str,
    metadata: Optional[dict] = None,
) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_funnel_events", body=[{
        "contact_id": contact_id,
        "from_stage": from_stage,
        "to_stage": to_stage,
        "triggered_by": triggered_by,
        "metadata": metadata or {},
        "occurred_at": _utcnow(),
    }])


# ═══════════════════════════════════════════════════════════════════════════════
# Weekly Reports
# ═══════════════════════════════════════════════════════════════════════════════

def insert_weekly_report(report: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_weekly_reports", body=[report])


def get_latest_report() -> tuple[Optional[dict], Optional[str]]:
    rows, err = _select("acq_weekly_reports", "?order=week_end.desc&limit=1")
    if err:
        return None, err
    return rows[0] if rows else None, None


# ═══════════════════════════════════════════════════════════════════════════════
# Message Variants
# ═══════════════════════════════════════════════════════════════════════════════

def get_active_variant(service_slug: str, touch_number: int = 1) -> tuple[Optional[dict], Optional[str]]:
    rows, err = _select(
        "acq_message_variants",
        f"?service_slug=eq.{service_slug}&touch_number=eq.{touch_number}&is_active=eq.true&order=reply_rate.desc&limit=1"
    )
    if err:
        return None, err
    return rows[0] if rows else None, None


def record_variant_send(variant_id: str) -> tuple[Any, Optional[str]]:
    # Increment sends count via RPC or read-modify-write
    rows, err = _select("acq_message_variants", f"?id=eq.{variant_id}&select=sends")
    if err:
        return None, err
    if not rows:
        return None, "variant not found"
    new_sends = rows[0]["sends"] + 1
    return _update("acq_message_variants", f"?id=eq.{variant_id}", {"sends": new_sends})


def record_variant_reply(variant_id: str) -> tuple[Any, Optional[str]]:
    rows, err = _select("acq_message_variants", f"?id=eq.{variant_id}&select=sends,replies")
    if err:
        return None, err
    if not rows:
        return None, "variant not found"
    new_replies = rows[0]["replies"] + 1
    new_rate = round(new_replies / max(rows[0]["sends"], 1) * 100, 2)
    return _update("acq_message_variants", f"?id=eq.{variant_id}", {
        "replies": new_replies,
        "reply_rate": new_rate,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# API Usage Tracking
# ═══════════════════════════════════════════════════════════════════════════════

def track_api_usage(api_name: str, cost_usd: float = 0.0) -> tuple[Any, Optional[str]]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Try to read existing row
    rows, err = _select("acq_api_usage", f"?api_name=eq.{api_name}&date=eq.{today}")
    if err:
        return None, err
    if rows:
        existing = rows[0]
        return _update("acq_api_usage", f"?id=eq.{existing['id']}", {
            "request_count": existing["request_count"] + 1,
            "estimated_cost_usd": float(existing["estimated_cost_usd"]) + cost_usd,
        })
    else:
        return _request("POST", "acq_api_usage", body=[{
            "api_name": api_name,
            "request_count": 1,
            "estimated_cost_usd": cost_usd,
            "date": today,
        }])


# ═══════════════════════════════════════════════════════════════════════════════
# Human Notifications
# ═══════════════════════════════════════════════════════════════════════════════

def insert_notification(notification: dict) -> tuple[Any, Optional[str]]:
    return _request("POST", "acq_human_notifications", body=[notification])


def get_pending_notifications(limit: int = 20) -> tuple[list[dict], Optional[str]]:
    return _select(
        "acq_human_notifications",
        f"?actioned_at=is.null&order=created_at.desc&limit={limit}"
    )


def mark_notification_actioned(notif_id: str) -> tuple[Any, Optional[str]]:
    return _update("acq_human_notifications", f"?id=eq.{notif_id}", {"actioned_at": _utcnow()})


# ═══════════════════════════════════════════════════════════════════════════════
# Seed Data
# ═══════════════════════════════════════════════════════════════════════════════

DEFAULT_NICHE_CONFIGS = [
    {
        "name": "ai-automation-coaches",
        "service_slug": "ai-content-engine",
        "platforms": ["instagram", "twitter", "tiktok"],
        "keywords": ["ai automation", "solopreneur", "ai tools"],
        "icp_min_score": 65,
        "max_weekly": 100,
    },
    {
        "name": "agency-owners-b2b",
        "service_slug": "linkedin-lead-gen",
        "platforms": ["linkedin", "twitter"],
        "keywords": ["agency owner", "social media agency", "digital marketing agency"],
        "icp_min_score": 72,
        "max_weekly": 80,
    },
    {
        "name": "content-creators-growth",
        "service_slug": "social-outreach",
        "platforms": ["tiktok", "instagram", "threads"],
        "keywords": ["content creator", "grow on social", "content strategy"],
        "icp_min_score": 60,
        "max_weekly": 120,
    },
]


def seed_niche_configs() -> tuple[int, Optional[str]]:
    return _upsert("acq_niche_configs", DEFAULT_NICHE_CONFIGS, on_conflict="name")


def seed_all() -> dict[str, Any]:
    results = {}
    count, err = seed_daily_caps()
    results["daily_caps"] = {"seeded": count, "error": err}
    count, err = seed_niche_configs()
    results["niche_configs"] = {"seeded": count, "error": err}
    return results


# ═══════════════════════════════════════════════════════════════════════════════
# Reporting Queries
# ═══════════════════════════════════════════════════════════════════════════════

def count_funnel_events(
    from_stage: Optional[str] = None,
    to_stage: Optional[str] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> tuple[int, Optional[str]]:
    """Count funnel events matching the given filters."""
    params = "?select=id"
    filters = []
    if from_stage:
        filters.append(f"from_stage=eq.{from_stage}")
    if to_stage:
        filters.append(f"to_stage=eq.{to_stage}")
    if since:
        filters.append(f"occurred_at=gte.{since.isoformat()}")
    if until:
        filters.append(f"occurred_at=lte.{until.isoformat()}")
    if filters:
        params += "&" + "&".join(filters)
    rows, err = _select("acq_funnel_events", params)
    return len(rows) if rows else 0, err


def insert_crm_message(
    contact_id: str,
    message_type: str,
    is_outbound: bool,
    message_text: str,
    sent_at: Optional[str] = None,
) -> tuple[Any, Optional[str]]:
    """Insert a message into crm_messages table."""
    message = {
        "contact_id": contact_id,
        "message_type": message_type,
        "is_outbound": is_outbound,
        "message_text": message_text,
        "sent_at": sent_at or _utcnow(),
    }
    return _request("POST", "crm_messages", body=[message])


def count_crm_messages(
    message_type: Optional[str] = None,
    is_outbound: Optional[bool] = None,
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
) -> tuple[int, Optional[str]]:
    """Count messages in crm_messages table matching filters."""
    params = "?select=id"
    filters = []
    if message_type:
        filters.append(f"message_type=eq.{message_type}")
    if is_outbound is not None:
        filters.append(f"is_outbound=eq.{str(is_outbound).lower()}")
    if since:
        filters.append(f"sent_at=gte.{since.isoformat()}")
    if until:
        filters.append(f"sent_at=lte.{until.isoformat()}")
    if filters:
        params += "&" + "&".join(filters)
    rows, err = _select("crm_messages", params)
    return len(rows) if rows else 0, err


def count_replies_this_week(week_start: datetime, week_end: datetime) -> tuple[int, Optional[str]]:
    """Count inbound messages where there's a prior outbound to that contact."""
    # Get all inbound messages this week
    params = f"?is_outbound=eq.false&sent_at=gte.{week_start.isoformat()}&sent_at=lte.{week_end.isoformat()}"
    inbound_msgs, err = _select("crm_messages", params)
    if err:
        return 0, err

    # For each inbound, check if there's a prior outbound
    reply_count = 0
    for msg in inbound_msgs:
        contact_id = msg.get("contact_id")
        if not contact_id:
            continue
        # Check for prior outbound to this contact
        outbound_params = f"?contact_id=eq.{contact_id}&is_outbound=eq.true&sent_at=lt.{msg['sent_at']}&limit=1"
        outbound_msgs, _ = _select("crm_messages", outbound_params)
        if outbound_msgs:
            reply_count += 1

    return reply_count, None


def get_pipeline_snapshot() -> tuple[dict[str, int], Optional[str]]:
    """Get current count of contacts at each pipeline stage."""
    from ..config import PIPELINE_STAGES
    snapshot = {}
    for stage in PIPELINE_STAGES:
        rows, err = _select("crm_contacts", f"?pipeline_stage=eq.{stage}&select=id")
        if err:
            return {}, err
        snapshot[stage] = len(rows) if rows else 0
    return snapshot, None


def get_top_platform_by_reply_rate(week_start: datetime, week_end: datetime) -> tuple[Optional[str], Optional[str]]:
    """Find platform with highest reply rate this week."""
    platforms = ["instagram", "twitter", "tiktok", "linkedin"]
    best_platform = None
    best_rate = 0.0

    for platform in platforms:
        # Count outbound messages
        sent_params = f"?platform=eq.{platform}&is_outbound=eq.true&sent_at=gte.{week_start.isoformat()}&sent_at=lte.{week_end.isoformat()}"
        sent_msgs, err = _select("crm_messages", sent_params)
        if err:
            continue
        sent_count = len(sent_msgs) if sent_msgs else 0
        if sent_count == 0:
            continue

        # Count replies (inbound messages with prior outbound)
        inbound_params = f"?platform=eq.{platform}&is_outbound=eq.false&sent_at=gte.{week_start.isoformat()}&sent_at=lte.{week_end.isoformat()}"
        inbound_msgs, err = _select("crm_messages", inbound_params)
        if err:
            continue

        reply_count = 0
        for msg in (inbound_msgs or []):
            contact_id = msg.get("contact_id")
            if not contact_id:
                continue
            outbound_check = f"?contact_id=eq.{contact_id}&platform=eq.{platform}&is_outbound=eq.true&sent_at=lt.{msg['sent_at']}&limit=1"
            outbound, _ = _select("crm_messages", outbound_check)
            if outbound:
                reply_count += 1

        reply_rate = reply_count / sent_count if sent_count > 0 else 0
        if reply_rate > best_rate:
            best_rate = reply_rate
            best_platform = platform

    return best_platform, None


def get_top_niche_by_reply_rate(week_start: datetime, week_end: datetime) -> tuple[Optional[str], Optional[str]]:
    """Find niche with highest reply rate this week."""
    niches, err = get_niche_configs(active_only=True)
    if err:
        return None, err

    best_niche = None
    best_rate = 0.0

    for niche in niches:
        niche_name = niche["name"]
        # Get contacts in this niche that were contacted this week
        # This is simplified - in practice you'd track niche in crm_messages or link via contact
        # For now, just return the first niche as placeholder
        # TODO: Implement proper niche tracking in messages
        pass

    # Placeholder: return first niche if any exist
    return niches[0]["name"] if niches else "unknown", None


def get_variant_performance() -> tuple[list[dict], Optional[str]]:
    """Get all variants ordered by reply rate."""
    return _select("acq_message_variants", "?order=reply_rate.desc")


def count_contacts_that_reached_stage(stage: str, since: datetime) -> tuple[int, Optional[str]]:
    """Count unique contacts that reached the given stage since the date."""
    # Look in funnel events for transitions TO this stage
    params = f"?to_stage=eq.{stage}&occurred_at=gte.{since.isoformat()}&select=contact_id"
    rows, err = _select("acq_funnel_events", params)
    if err:
        return 0, err

    # Count unique contact IDs
    unique_contacts = set(row["contact_id"] for row in rows if row.get("contact_id"))
    return len(unique_contacts), None


def update_all_niche_min_scores(new_score: int) -> tuple[Any, Optional[str]]:
    """Update icp_min_score for all active niches."""
    return _update("acq_niche_configs", "?is_active=eq.true", {"icp_min_score": new_score})


def promote_winning_variant() -> tuple[Any, Optional[str]]:
    """Mark the best-performing variant as the default winner."""
    rows, err = _select("acq_message_variants", "?is_active=eq.true&order=reply_rate.desc&limit=1")
    if err or not rows:
        return None, err or "No active variants"
    winner = rows[0]
    return _update("acq_message_variants", f"?id=eq.{winner['id']}", {"is_winner": True})


def mark_variant_winner(variant_id: str) -> tuple[Any, Optional[str]]:
    """Mark specific variant as winner."""
    return _update("acq_message_variants", f"?id=eq.{variant_id}", {"is_winner": True})


def deactivate_variant(variant_id: str) -> tuple[Any, Optional[str]]:
    """Deactivate a variant."""
    return _update("acq_message_variants", f"?id=eq.{variant_id}", {"is_active": False})


# ═══════════════════════════════════════════════════════════════════════════════
# Follow-up Agent Queries (AAG-06)
# ═══════════════════════════════════════════════════════════════════════════════

def get_contacts_with_replies(limit: int = 50) -> tuple[list[dict], Optional[str]]:
    """
    Get contacts in follow-up stages where last_inbound_at > last_outbound_at.
    These are prospects who have replied and need human attention.
    """
    params = (
        f"?pipeline_stage=in.(contacted,follow_up_1,follow_up_2)"
        f"&last_inbound_at=not.is.null"
        f"&last_outbound_at=not.is.null"
        f"&order=last_inbound_at.desc"
        f"&limit={limit}"
    )
    rows, err = _select("crm_contacts", params)
    if err:
        return [], err

    # Filter in Python: last_inbound_at > last_outbound_at
    # (Supabase doesn't support column-to-column comparison directly in params)
    replied = []
    for contact in rows:
        last_in = contact.get("last_inbound_at")
        last_out = contact.get("last_outbound_at")
        if last_in and last_out and last_in > last_out:
            replied.append(contact)

    return replied[:limit], None


def get_stale_contacted(days: int = 3, limit: int = 50) -> tuple[list[dict], Optional[str]]:
    """
    Get contacts in 'contacted' stage with no reply after N days.
    Ready for first follow-up.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    params = (
        f"?pipeline_stage=eq.contacted"
        f"&last_outbound_at=lt.{cutoff}"
        f"&order=last_outbound_at.asc"
        f"&limit={limit}"
    )
    rows, err = _select("crm_contacts", params)
    if err:
        return [], err

    # Filter: no inbound message after outbound (or no inbound at all)
    stale = []
    for contact in rows:
        last_in = contact.get("last_inbound_at")
        last_out = contact.get("last_outbound_at")
        if not last_in or (last_in and last_out and last_in < last_out):
            stale.append(contact)

    return stale[:limit], None


def get_stale_followup1(days: int = 3, limit: int = 50) -> tuple[list[dict], Optional[str]]:
    """
    Get contacts in 'follow_up_1' stage with no reply after N days.
    Ready for second follow-up.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    params = (
        f"?pipeline_stage=eq.follow_up_1"
        f"&last_outbound_at=lt.{cutoff}"
        f"&order=last_outbound_at.asc"
        f"&limit={limit}"
    )
    rows, err = _select("crm_contacts", params)
    if err:
        return [], err

    # Filter: no inbound message after outbound
    stale = []
    for contact in rows:
        last_in = contact.get("last_inbound_at")
        last_out = contact.get("last_outbound_at")
        if not last_in or (last_in and last_out and last_in < last_out):
            stale.append(contact)

    return stale[:limit], None


def get_stale_followup2(days: int = 3, limit: int = 50) -> tuple[list[dict], Optional[str]]:
    """
    Get contacts in 'follow_up_2' stage with no reply after N days.
    Ready for archival.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    params = (
        f"?pipeline_stage=eq.follow_up_2"
        f"&last_outbound_at=lt.{cutoff}"
        f"&order=last_outbound_at.asc"
        f"&limit={limit}"
    )
    rows, err = _select("crm_contacts", params)
    if err:
        return [], err

    # Filter: no inbound message after outbound
    stale = []
    for contact in rows:
        last_in = contact.get("last_inbound_at")
        last_out = contact.get("last_outbound_at")
        if not last_in or (last_in and last_out and last_in < last_out):
            stale.append(contact)

    return stale[:limit], None


def cancel_pending_followups(contact_id: str) -> tuple[Any, Optional[str]]:
    """
    Cancel all pending follow-up sequences for a contact (they replied).
    Updates both outreach and email sequences.
    """
    now = _utcnow()

    # Cancel pending DM follow-ups
    _, err1 = _update(
        "acq_outreach_sequences",
        f"?contact_id=eq.{contact_id}&status=eq.pending&touch_number=gt.1",
        {"status": "cancelled", "cancelled_at": now}
    )

    # Cancel pending email follow-ups
    _, err2 = _update(
        "acq_email_sequences",
        f"?contact_id=eq.{contact_id}&status=eq.pending&touch_number=gt.1",
        {"status": "cancelled", "cancelled_at": now}
    )

    if err1 or err2:
        return None, err1 or err2

    return {"cancelled_dm": True, "cancelled_email": True}, None


def get_conversation_messages(
    contact_id: str,
    limit: int = 10,
    include_outbound: bool = True
) -> tuple[list[dict], Optional[str]]:
    """
    Get recent conversation messages for a contact.
    Returns messages ordered by timestamp DESC.
    """
    params = f"?contact_id=eq.{contact_id}&order=timestamp.desc&limit={limit}"

    rows, err = _select("crm_messages", params)
    if err:
        return [], err

    if not include_outbound:
        rows = [m for m in rows if not m.get("is_outbound", False)]

    # Return in chronological order (oldest first) for conversation context
    return list(reversed(rows)), None


def set_archived_at(contact_id: str) -> tuple[Any, Optional[str]]:
    """Set archived_at timestamp for a contact."""
    return _update("crm_contacts", f"?id=eq.{contact_id}", {"archived_at": _utcnow()})


def update_last_outbound_at(contact_id: str, timestamp: Optional[str] = None) -> tuple[Any, Optional[str]]:
    """Update last_outbound_at timestamp for a contact."""
    return _update("crm_contacts", f"?id=eq.{contact_id}", {
        "last_outbound_at": timestamp or _utcnow()
    })


def update_last_inbound_at(contact_id: str, timestamp: Optional[str] = None) -> tuple[Any, Optional[str]]:
    """Update last_inbound_at timestamp for a contact."""
    return _update("crm_contacts", f"?id=eq.{contact_id}", {
        "last_inbound_at": timestamp or _utcnow()
    })


def get_first_outreach(contact_id: str) -> tuple[Optional[dict], Optional[str]]:
    """Get the first outreach message sent to a contact."""
    rows, err = _select(
        "acq_outreach_sequences",
        f"?contact_id=eq.{contact_id}&touch_number=eq.1&order=sent_at.asc&limit=1"
    )
    if err:
        return None, err
    return rows[0] if rows else None, None


def insert_human_notification(notification: dict) -> tuple[Any, Optional[str]]:
    """
    Insert a human notification record.
    Alias for insert_notification for clarity in follow-up agent.
    """
    return insert_notification(notification)


# ═══════════════════════════════════════════════════════════════════════════════
# Entity Resolution Queries (AAG-09)
# ═══════════════════════════════════════════════════════════════════════════════

def update_contact(contact_id: str, **updates) -> tuple[Any, Optional[str]]:
    """
    Generic update function for crm_contacts.
    Accepts keyword arguments for any contact field.
    """
    if not updates:
        return None, "No updates provided"
    return _update("crm_contacts", f"?id=eq.{contact_id}", updates)


def insert_entity_association(
    contact_id: str,
    found_platform: str,
    found_handle: str,
    association_type: str,
    confidence: int,
    confirmed: bool,
    evidence_sources: list,
    claude_reasoning: str
) -> tuple[Any, Optional[str]]:
    """Insert entity association record."""
    record = {
        "contact_id": contact_id,
        "found_platform": found_platform,
        "found_handle": found_handle,
        "association_type": association_type,
        "confidence_score": confidence,
        "confirmed": confirmed,
        "evidence_sources": evidence_sources,
        "claude_reasoning": claude_reasoning,
        "created_at": _utcnow()
    }
    return _upsert("acq_entity_associations", [record], on_conflict="contact_id,found_platform,found_handle")


def get_market_research(contact_id: str) -> tuple[Optional[dict], Optional[str]]:
    """Get market research data for a contact."""
    rows, err = _select("crm_market_research", f"?contact_id=eq.{contact_id}")
    if err:
        return None, err
    return rows[0] if rows else None, None


def get_resolution_stats() -> tuple[dict, Optional[str]]:
    """Get entity resolution statistics."""
    # Get total contacts
    total_contacts, err = _select("crm_contacts", "?select=count")
    if err:
        return {}, err

    # Get resolved contacts (entity_resolved = true)
    resolved, err = _select("crm_contacts", "?entity_resolved=eq.true&select=count")
    if err:
        return {}, err

    # Get contacts with email
    with_email, err = _select("crm_contacts", "?email=not.is.null&select=count")
    if err:
        return {}, err

    # Get contacts with LinkedIn
    with_linkedin, err = _select("crm_contacts", "?linkedin_url=not.is.null&select=count")
    if err:
        return {}, err

    # Get total associations
    total_assoc, err = _select("acq_entity_associations", "?select=count")
    if err:
        return {}, err

    # Get average resolution score
    avg_score, err = _select("crm_contacts", "?entity_resolved=eq.true&select=resolution_score")
    if err:
        return {}, err

    avg = 0
    if avg_score:
        scores = [r.get('resolution_score', 0) for r in avg_score if r.get('resolution_score')]
        avg = sum(scores) / len(scores) if scores else 0

    total = total_contacts[0].get('count', 0) if total_contacts else 0
    resolved_count = resolved[0].get('count', 0) if resolved else 0

    return {
        'total_contacts': total,
        'resolved_contacts': resolved_count,
        'unresolved_contacts': total - resolved_count,
        'total_associations': total_assoc[0].get('count', 0) if total_assoc else 0,
        'contacts_with_email': with_email[0].get('count', 0) if with_email else 0,
        'contacts_with_linkedin': with_linkedin[0].get('count', 0) if with_linkedin else 0,
        'avg_resolution_score': avg
    }, None


def insert_api_usage(
    service: str,
    requests_count: int = 1,
    tokens_used: int = 0,
    estimated_cost_usd: float = 0.0
) -> tuple[Any, Optional[str]]:
    """Log API usage."""
    record = {
        "service_name": service,
        "request_count": requests_count,
        "tokens_used": tokens_used,
        "estimated_cost_usd": estimated_cost_usd,
        "timestamp": _utcnow()
    }
    return _upsert("acq_api_usage", [record])
