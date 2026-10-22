"""
acquisition/api/routes/email.py — Email API routes.

Routes:
- POST /api/acquisition/email/webhooks/resend - Resend webhook handler
- GET /api/acquisition/email/unsubscribe?token={jwt} - Unsubscribe handler
"""
import jwt
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Request, Query, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ...db import queries
from ...config import EMAIL_UNSUB_SECRET
from ...email.gmail_watcher import GmailWatcher
from ...email.imap_watcher import assess_reply_link
from ...email.reply_state import conversation_review


router = APIRouter(prefix="/api/acquisition/email", tags=["email"])


@router.post("/inbox/sync")
def sync_reply_inbox(since_days: int = Query(default=30, ge=1, le=365)):
    """Synchronize IMAP evidence. This reads mail and writes only CRM evidence."""
    attempted_at = datetime.now(timezone.utc).isoformat()
    try:
        watcher = GmailWatcher()
    except Exception as exc:
        queries.set_inbox_sync_state(attempted_at, False, 0, str(exc), source="gmail")
        raise HTTPException(status_code=503, detail={"status": "failed", "error": str(exc)})

    outreach_contacts, contacts_err = queries.get_contacts_with_outreach(limit=50)
    if contacts_err:
        queries.set_inbox_sync_state(attempted_at, False, 0, contacts_err, source="gmail")
        raise HTTPException(status_code=503, detail={"status": "failed", "error": contacts_err})
    sender_emails = list({contact["email"] for contact in outreach_contacts if contact.get("email")})
    result = watcher.fetch_new_replies(
        datetime.now(timezone.utc) - timedelta(days=since_days), sender_emails=sender_emails,
    )
    if not result.ok:
        _, state_err = queries.set_inbox_sync_state(
            result.synced_at.isoformat(), False, 0, result.error or "Gmail sync failed",
            source=result.source,
        )
        raise HTTPException(status_code=502, detail={
            "status": "failed", "error": result.error, "state_write_error": state_err
        })

    stored = 0
    ambiguous = 0
    unmatched = 0
    errors: list[str] = []
    # Resolve a sender only when it maps uniquely. Then compare against that
    # contact's real sent outreach before marking it as a human reply.
    for message in result.replies:
        contacts, err = queries.find_contacts_by_email(message.from_email)
        if err:
            errors.append(f"contact lookup: {err}")
            continue
        contact = contacts[0] if len(contacts) == 1 else None
        status, reason = "unmatched", "Sender email does not resolve to exactly one CRM contact"
        if contact:
            outbound, err = queries.get_outbound_email_evidence(contact["id"])
            if err:
                errors.append(f"outbound lookup {contact['id']}: {err}")
                continue
            # Resend IDs are provider IDs, not RFC Message-IDs, so linkage can
            # only be confirmed if a stored RFC ID is available. Subject-only
            # similarity remains reviewable, never auto-confirmed.
            outbound_ids = {
                message_id for row in outbound
                for message_id in (row.get("message_id"), row.get("platform_message_id"))
                if message_id
            }
            outbound_subjects = {
                (row.get("metadata") or {}).get("subject", "")
                for row in outbound if (row.get("metadata") or {}).get("subject")
            }
            status, reason = assess_reply_link(message, outbound_ids, outbound_subjects)

        if status == "needs_review":
            ambiguous += 1
        elif status == "unmatched":
            unmatched += 1
        row = {
            "source": result.source,
            "source_uid": message.source_uid,
            "message_id": message.message_id or f"uid:{message.source_uid}",
            "contact_id": contact.get("id") if contact else None,
            "from_email": message.from_email,
            "subject": message.subject,
            "body_text": message.body,
            "in_reply_to": message.in_reply_to,
            "references_ids": list(message.references),
            "occurred_at": message.received_at.isoformat(),
            "link_status": status,
            "link_reason": reason,
        }
        _, err = queries.upsert_inbound_message(row)
        if err:
            errors.append(f"message {row['message_id']}: {err}")
            continue
        stored += 1
        if contact and status in ("human_reply", "needs_review"):
            _, err = queries.update_last_inbound_at(contact["id"], message.received_at.isoformat())
            if err:
                errors.append(f"contact timestamp {contact['id']}: {err}")

    _, state_err = queries.set_inbox_sync_state(
        result.synced_at.isoformat(), not errors, stored,
        "; ".join(errors)[:1000] if errors else None, source=result.source,
    )
    if state_err:
        errors.append(f"sync state write: {state_err}")
    return {
        "status": "ok" if not errors else "partial",
        "synced_at": result.synced_at.isoformat(),
        "messages_seen": len(result.replies),
        "messages_stored": stored,
        "needs_review": ambiguous,
        "unmatched": unmatched,
        "errors": errors,
    }


@router.get("/inbox/review")
def get_reply_inbox_review(
    limit: int = Query(default=100, ge=1, le=500),
    contact_id: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
):
    """Return evidence-backed conversation rows and mailbox freshness."""
    sync, err = queries.get_inbox_sync_state(source="gmail")
    if err:
        raise HTTPException(status_code=503, detail=f"Cannot read mailbox sync state: {err}")
    inbound, err = queries.get_inbound_messages(contact_id=contact_id, limit=limit * 5, source="gmail")
    if err:
        raise HTTPException(status_code=503, detail=f"Cannot read inbox evidence: {err}")

    contacts_by_id = {}
    if not contact_id:
        outreach_contacts, err = queries.get_contacts_with_outreach(limit=limit * 5)
        if err:
            raise HTTPException(status_code=503, detail=f"Cannot read outreach contacts: {err}")
        contacts_by_id.update({contact["id"]: contact for contact in outreach_contacts})
    for msg in inbound:
        if msg.get("contact_id") and msg["contact_id"] not in contacts_by_id:
            contact, contact_err = queries.get_contact(msg["contact_id"])
            if contact_err:
                raise HTTPException(status_code=503, detail=f"Cannot read contact: {contact_err}")
            if contact:
                contacts_by_id[msg["contact_id"]] = contact
    contact_ids = list(contacts_by_id)
    outbound, err = queries.get_outbound_messages(contact_ids, limit=limit * 5)
    if err:
        raise HTTPException(status_code=503, detail=f"Cannot read outbound evidence: {err}")

    by_contact: dict[str, list[dict]] = {}
    for msg in inbound:
        if msg.get("contact_id"):
            by_contact.setdefault(msg["contact_id"], []).append({
                **msg, "is_outbound": False, "occurred_at": msg.get("occurred_at"),
                "source_record_id": msg.get("id"),
            })
    for msg in outbound:
        cid = msg.get("contact_id")
        if cid in contacts_by_id:
            by_contact.setdefault(cid, []).append({
                **msg, "source": msg.get("message_type", "crm"),
                "source_record_id": msg.get("id"), "is_outbound": True,
                "occurred_at": msg.get("sent_at"),
            })

    sync_ok = bool(sync and sync.get("last_success_at") and not sync.get("last_error"))
    rows = [conversation_review(contacts_by_id[cid], messages, sync_ok,
                                sync.get("last_success_at") if sync else None)
            for cid, messages in by_contact.items()]
    # Unresolved inbound messages remain visible as explicit review items.
    for msg in inbound:
        if not msg.get("contact_id"):
            rows.append({
                "customer_id": None, "customer": msg.get("from_email"), "offer": None,
                "state": "needs_review" if sync_ok else "stale_data",
                "last_inbound_at": msg.get("occurred_at"), "last_outbound_at": None,
                "last_inbound_preview": (msg.get("body_text") or "")[:500],
                "last_inbound_subject": msg.get("subject"),
                "evidence": {"source": msg.get("source", "gmail"), "source_record_id": msg.get("id"),
                             "message_id": msg.get("message_id"),
                             "occurred_at": msg.get("occurred_at"),
                             "subject": msg.get("subject"),
                             "excerpt": (msg.get("body_text") or "")[:500],
                             "link_reason": msg.get("link_reason")},
                "next_action": "Resolve customer identity and verify the outreach thread",
                "sync": {"ok": sync_ok, "synced_at": sync.get("last_success_at") if sync else None,
                         "status": "fresh" if sync_ok else "failed"},
            })
    if state:
        rows = [row for row in rows if row["state"] == state]
    rows.sort(key=lambda row: row.get("last_inbound_at") or row.get("last_outbound_at") or "", reverse=True)
    return {"items": rows[:limit], "total": len(rows), "sync": sync or {
        "source": "gmail", "last_success_at": None, "last_error": "No sync has completed"
    }}


# ══════════════════════════════════════════════════════════════════════════════
# Unsubscribe Token Management
# ══════════════════════════════════════════════════════════════════════════════


def generate_unsub_token(contact_id: str) -> str:
    """
    Generate JWT token for unsubscribe link.

    Args:
        contact_id: Contact UUID

    Returns:
        JWT token string
    """
    payload = {
        "contact_id": contact_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=365),  # 1 year expiry
    }
    return jwt.encode(payload, EMAIL_UNSUB_SECRET, algorithm="HS256")


def decode_unsub_token(token: str) -> Optional[str]:
    """
    Decode unsubscribe token.

    Args:
        token: JWT token

    Returns:
        Contact ID if valid, None if invalid/expired
    """
    try:
        payload = jwt.decode(token, EMAIL_UNSUB_SECRET, algorithms=["HS256"])
        return payload.get("contact_id")
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ══════════════════════════════════════════════════════════════════════════════
# Resend Webhook Handler
# ══════════════════════════════════════════════════════════════════════════════


class ResendWebhookEvent(BaseModel):
    """Resend webhook event payload."""

    type: str  # email.opened, email.clicked, email.bounced, email.complained
    created_at: str
    data: dict


@router.post("/webhooks/resend")
async def handle_resend_webhook(event: ResendWebhookEvent):
    """
    Handle Resend webhook events.

    Supported events:
    - email.opened: Update opened_at timestamp
    - email.clicked: Update clicked_at timestamp
    - email.bounced: Mark as bounced, switch to DM channel
    - email.complained: Mark as spam complaint, unsubscribe

    Args:
        event: Resend webhook event

    Returns:
        Success response
    """
    event_type = event.type
    data = event.data

    # Extract common fields
    resend_id = data.get("email_id")
    to_email = data.get("to", [""])[0] if data.get("to") else None

    if not resend_id:
        raise HTTPException(status_code=400, detail="Missing email_id in webhook data")

    # Handle different event types
    if event_type == "email.opened":
        _, err = queries.update_email_opened(resend_id)
        if err:
            raise HTTPException(status_code=500, detail=f"Failed to update: {err}")

    elif event_type == "email.clicked":
        _, err = queries.update_email_clicked(resend_id)
        if err:
            raise HTTPException(status_code=500, detail=f"Failed to update: {err}")

    elif event_type == "email.bounced":
        # Mark email as bounced
        _, err = queries.update_email_status(resend_id, "bounced")
        if err:
            raise HTTPException(status_code=500, detail=f"Failed to update: {err}")

        # Mark email as unverified
        _, _ = queries.set_email_unverified(resend_id)

        # TODO: Switch to DM channel (requires channel_coordinator from Agent 05)
        # await channel_coordinator.switch_to_dm(resend_id)

    elif event_type == "email.complained":
        # User marked as spam - immediate unsubscribe
        if to_email:
            _, _ = queries.insert_unsubscribe(to_email, reason="spam_complaint")

            # Find and opt out contact
            # Note: This is a simple implementation - in production you might want
            # to query by email to find the contact
            sequences, _ = queries._select(
                "acq_email_sequences", f"?resend_id=eq.{resend_id}&select=contact_id"
            )
            if sequences:
                contact_id = sequences[0]["contact_id"]
                _, _ = queries.set_email_opted_out(contact_id)
                _, _ = queries.cancel_pending_email_sequences(contact_id)

    return {"status": "ok", "event_type": event_type}


# ══════════════════════════════════════════════════════════════════════════════
# Unsubscribe Handler
# ══════════════════════════════════════════════════════════════════════════════


@router.get("/unsubscribe", response_class=HTMLResponse)
async def handle_unsubscribe(token: str = Query(...)):
    """
    Handle email unsubscribe via JWT token.

    Process:
    1. Decode JWT token to get contact_id
    2. Mark contact as email_opted_out=true
    3. Cancel all pending email sequences
    4. Record in acq_email_unsubscribes

    Args:
        token: JWT unsubscribe token

    Returns:
        HTML confirmation page
    """
    # Decode token
    contact_id = decode_unsub_token(token)

    if not contact_id:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Invalid Link</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                           max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
                    h1 { color: #d32f2f; }
                </style>
            </head>
            <body>
                <h1>Invalid or Expired Link</h1>
                <p>This unsubscribe link is invalid or has expired.</p>
                <p>If you continue to receive emails, please reply to any email with "UNSUBSCRIBE".</p>
            </body>
            </html>
            """,
            status_code=400,
        )

    # Get contact
    contact, err = queries.get_contact(contact_id)
    if err or not contact:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Error</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                           max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
                    h1 { color: #d32f2f; }
                </style>
            </head>
            <body>
                <h1>Error</h1>
                <p>We couldn't find your subscription. Please contact support.</p>
            </body>
            </html>
            """,
            status_code=404,
        )

    email = contact.get("email", "")

    # Mark as opted out
    _, err = queries.set_email_opted_out(contact_id)
    if err:
        raise HTTPException(status_code=500, detail="Failed to unsubscribe")

    # Cancel pending sequences
    _, _ = queries.cancel_pending_email_sequences(contact_id)

    # Record unsubscribe
    if email:
        _, _ = queries.insert_unsubscribe(
            email, reason="self_unsubscribe", contact_id=contact_id
        )

    # Return success page
    return HTMLResponse(
        content="""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Unsubscribed</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    max-width: 600px;
                    margin: 100px auto;
                    padding: 20px;
                    text-align: center;
                }
                h1 { color: #2e7d32; }
                p { color: #666; line-height: 1.6; }
                .email {
                    background: #f5f5f5;
                    padding: 8px 16px;
                    border-radius: 4px;
                    display: inline-block;
                    margin: 16px 0;
                    font-family: monospace;
                }
            </style>
        </head>
        <body>
            <h1>✓ You've been unsubscribed</h1>
            <p>You will no longer receive emails from us.</p>
            <div class="email">%s</div>
            <p>If you change your mind, you can re-subscribe anytime by replying to any of our previous emails.</p>
            <p style="margin-top: 40px; font-size: 14px; color: #999;">
                This change may take up to 24 hours to process.
            </p>
        </body>
        </html>
        """
        % (email or "No email on file"),
        status_code=200,
    )


# ══════════════════════════════════════════════════════════════════════════════
# Manual Trigger Routes (for testing/admin)
# ══════════════════════════════════════════════════════════════════════════════


@router.post("/discover")
async def trigger_email_discovery(limit: int = 20, dry_run: bool = False):
    """
    Manually trigger email discovery.

    Args:
        limit: Max contacts to process
        dry_run: If True, don't save discoveries

    Returns:
        Discovery stats
    """
    from ...email_agent import EmailAgent

    agent = EmailAgent()
    stats = await agent.discover_emails(limit=limit, dry_run=dry_run)
    return stats


@router.post("/schedule")
async def trigger_email_schedule(limit: int = 20):
    """
    Manually trigger email sequence scheduling.

    Args:
        limit: Max contacts to schedule

    Returns:
        Scheduling stats
    """
    from ...email_agent import EmailAgent

    agent = EmailAgent()
    stats = await agent.schedule_sequences(limit=limit)
    return stats


@router.post("/send")
async def trigger_email_send(limit: int = 30, dry_run: bool = False):
    """
    Manually trigger email sending.

    Args:
        limit: Max emails to send
        dry_run: If True, don't actually send

    Returns:
        Send stats
    """
    from ...email_agent import EmailAgent

    agent = EmailAgent()
    stats = await agent.send_pending(limit=limit, dry_run=dry_run)
    return stats


@router.get("/status")
async def get_email_status():
    """
    Get email pipeline metrics and status.

    Returns:
        Metrics including:
        - pending_sequences: Count of pending email sequences
        - sent_today: Emails sent today
        - open_rate_7d: Open rate over last 7 days
        - click_rate_7d: Click rate over last 7 days
        - bounce_rate_7d: Bounce rate over last 7 days
        - reply_rate_7d: Reply rate over last 7 days
        - unsubscribe_rate_7d: Unsubscribe rate over last 7 days
        - cap_usage: Daily cap usage (sent/limit)
    """
    from datetime import datetime, timezone, timedelta

    # Get pending sequences count
    pending, _ = queries._select(
        "acq_email_sequences",
        "?status=eq.pending&select=id"
    )
    pending_count = len(pending) if pending else 0

    # Get daily cap usage
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    cap_row, _ = queries._select(
        "acq_daily_caps",
        f"?action_type=eq.email&platform=eq.email&date=eq.{today_start.date().isoformat()}"
    )

    sent_today = 0
    cap_limit = 30  # Default from config.DEFAULT_DAILY_CAPS

    if cap_row:
        sent_today = cap_row[0].get("count", 0)

    # Get 7-day metrics
    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    seven_days_ago_iso = seven_days_ago.isoformat()

    # Get sent emails in last 7 days
    sent_7d, _ = queries._select(
        "acq_email_sequences",
        f"?status=eq.sent&sent_at=gte.{seven_days_ago_iso}&select=id,opened_at,clicked_at,resend_id"
    )

    total_sent_7d = len(sent_7d) if sent_7d else 0

    if total_sent_7d > 0:
        opened = sum(1 for e in sent_7d if e.get("opened_at"))
        clicked = sum(1 for e in sent_7d if e.get("clicked_at"))
        open_rate = round((opened / total_sent_7d) * 100, 1)
        click_rate = round((clicked / total_sent_7d) * 100, 1)
    else:
        open_rate = 0.0
        click_rate = 0.0

    # Get bounced emails
    bounced_7d, _ = queries._select(
        "acq_email_sequences",
        f"?status=eq.bounced&updated_at=gte.{seven_days_ago_iso}&select=id"
    )
    bounce_count = len(bounced_7d) if bounced_7d else 0
    bounce_rate = round((bounce_count / max(total_sent_7d, 1)) * 100, 1)

    # Get replied contacts (from crm_contacts)
    replied_7d, _ = queries._select(
        "crm_contacts",
        f"?stage=eq.replied&updated_at=gte.{seven_days_ago_iso}&select=id"
    )
    reply_count = len(replied_7d) if replied_7d else 0
    reply_rate = round((reply_count / max(total_sent_7d, 1)) * 100, 1)

    # Get unsubscribes in last 7 days
    unsubs_7d, _ = queries._select(
        "acq_email_unsubscribes",
        f"?created_at=gte.{seven_days_ago_iso}&select=id"
    )
    unsub_count = len(unsubs_7d) if unsubs_7d else 0
    unsub_rate = round((unsub_count / max(total_sent_7d, 1)) * 100, 1)

    return {
        "pending_sequences": pending_count,
        "sent_today": sent_today,
        "cap_limit": cap_limit,
        "cap_usage_pct": round((sent_today / cap_limit) * 100, 1) if cap_limit > 0 else 0,
        "metrics_7d": {
            "total_sent": total_sent_7d,
            "open_rate": open_rate,
            "click_rate": click_rate,
            "bounce_rate": bounce_rate,
            "reply_rate": reply_rate,
            "unsubscribe_rate": unsub_rate,
        },
    }
