"""Evidence-backed, deterministic projection for an outreach inbox review."""
from datetime import datetime, timezone
from typing import Any


def conversation_review(contact: dict[str, Any], messages: list[dict[str, Any]],
                        sync_ok: bool, synced_at: str | None = None) -> dict[str, Any]:
    """Build a review row; never infer a fresh no-reply state after sync failure."""
    ordered = sorted(messages, key=lambda item: item.get("occurred_at") or "")
    latest_inbound = next((m for m in reversed(ordered) if m.get("is_outbound") is False), None)
    latest_outbound = next((m for m in reversed(ordered) if m.get("is_outbound")), None)
    latest_activity = ordered[-1] if ordered else None
    replied = bool(latest_activity and latest_activity.get("is_outbound") is False
                   and latest_activity.get("link_status") == "human_reply")
    ambiguous = bool(latest_activity and latest_activity.get("is_outbound") is False
                     and latest_activity.get("link_status") in ("needs_review", "unmatched"))
    if not sync_ok:
        state, action = "stale_data", "Restore mailbox sync, then review this conversation"
    elif not ordered:
        state, action = "needs_review", "Check mailbox and CRM linkage; no message evidence is available"
    elif ambiguous:
        state, action = "needs_review", "Verify whether the inbound message belongs to this outreach thread"
    elif replied:
        state, action = "human_reply_received", "Review the reply and respond to the customer's latest request"
    elif latest_outbound:
        state, action = "awaiting_reply", "Wait for a reply; do not send a duplicate follow-up before its due time"
    else:
        state, action = "needs_review", "Confirm the conversation history and ownership"
    evidence_message = latest_activity
    return {
        "customer_id": contact.get("id"),
        "customer": contact.get("display_name") or contact.get("email") or "Unknown",
        "offer": contact.get("offer") or contact.get("last_offer_sent") or contact.get("niche_label"),
        "state": state,
        "last_inbound_at": latest_inbound.get("occurred_at") if latest_inbound else None,
        "last_outbound_at": latest_outbound.get("occurred_at") if latest_outbound else None,
        "last_inbound_preview": ((latest_inbound.get("body_text") or latest_inbound.get("message_text") or "")[:500]
                                 if latest_inbound else None),
        "last_inbound_subject": latest_inbound.get("subject") if latest_inbound else None,
        "evidence": ({"source": evidence_message.get("source"),
                      "source_record_id": evidence_message.get("source_record_id"),
                      "message_id": evidence_message.get("message_id"),
                      "occurred_at": evidence_message.get("occurred_at"),
                      "subject": evidence_message.get("subject"),
                      "excerpt": (evidence_message.get("body_text") or evidence_message.get("message_text") or "")[:500],
                      "link_reason": evidence_message.get("link_reason")}
                     if evidence_message else None),
        "next_action": action,
        "sync": {"ok": sync_ok, "synced_at": synced_at,
                 "status": "fresh" if sync_ok else "failed"},
    }
