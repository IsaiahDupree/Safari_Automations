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


router = APIRouter(prefix="/api/acquisition/email", tags=["email"])


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
