"""
acquisition/api/routes/outreach.py — Outreach API endpoints.

Provides:
- POST /generate — preview DM for a contact
- POST /send — send pending outreach
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import asyncio

from ...outreach_agent import OutreachAgent, ContextBuilder, DMGenerator, MessageValidator
from ...db import queries

router = APIRouter(tags=["outreach"], prefix="/api/acquisition/outreach")


# ── Request/Response Models ──────────────────────────────────────────────────


class GenerateRequest(BaseModel):
    """Request to preview a DM for a contact."""
    contact_id: str
    service_slug: str = "ai-content-engine"


class GenerateResponse(BaseModel):
    """Preview DM response."""
    contact_id: str
    display_name: str
    platform: str
    message_text: str
    validation_score: int
    validation_passed: bool
    validation_errors: list[str]
    estimated_send_at: Optional[str] = None


class SendRequest(BaseModel):
    """Request to send outreach."""
    service_slug: Optional[str] = None
    limit: int = 10
    dry_run: bool = False


class TouchSummary(BaseModel):
    """Summary of a single touch."""
    contact_id: str
    display_name: str
    platform: str
    success: bool
    message: str
    error: Optional[str] = None
    validation_score: int


class SendResponse(BaseModel):
    """Send outreach response."""
    total_processed: int
    successful: int
    failed: int
    skipped: int
    sent: list[TouchSummary]
    skipped_contacts: list[TouchSummary]
    failed_contacts: list[TouchSummary]


# ── Routes ───────────────────────────────────────────────────────────────────


@router.post("/generate", response_model=GenerateResponse)
async def generate_preview(req: GenerateRequest):
    """
    Preview DM for a single contact without sending.

    Returns the generated message, platform, validation score, and estimated send time.
    For human review before enabling auto-send.
    """
    # Get contact
    contact, err = queries.get_contact(req.contact_id)
    if err:
        raise HTTPException(500, f"Failed to fetch contact: {err}")
    if not contact:
        raise HTTPException(404, f"Contact {req.contact_id} not found")

    # Build context
    builder = ContextBuilder()
    brief = await builder.build_context(contact, req.service_slug)

    # Generate DM
    generator = DMGenerator()
    try:
        message = await generator.generate_dm(brief, req.service_slug)
    except Exception as e:
        raise HTTPException(500, f"Failed to generate DM: {str(e)}")

    # Validate
    validator = MessageValidator()
    validation = validator.validate(message, brief.platform)

    return GenerateResponse(
        contact_id=contact["id"],
        display_name=contact.get("display_name", contact.get("handle", "Unknown")),
        platform=contact["primary_platform"],
        message_text=message,
        validation_score=validation.score,
        validation_passed=validation.passed,
        validation_errors=validation.errors,
        estimated_send_at=None,  # Could calculate based on queue/caps
    )


@router.post("/send", response_model=SendResponse)
async def send_outreach(req: SendRequest):
    """
    Send pending outreach for up to N contacts.

    Accepts:
    - service_slug: filter to specific service (optional)
    - limit: max contacts to process
    - dry_run: if true, validate but don't send

    Returns sent[], skipped[], failed[] with reasons.
    """
    agent = OutreachAgent()
    result = await agent.run(
        service_slug=req.service_slug or "ai-content-engine",
        limit=req.limit,
        dry_run=req.dry_run,
    )

    # Categorize touches
    sent = []
    skipped_contacts = []
    failed_contacts = []

    for touch in result.touches:
        # Get contact for display name
        contact, _ = queries.get_contact(touch.contact_id)
        display_name = contact.get("display_name", touch.contact_id) if contact else touch.contact_id
        platform = contact.get("primary_platform", "unknown") if contact else "unknown"

        summary = TouchSummary(
            contact_id=touch.contact_id,
            display_name=display_name,
            platform=platform,
            success=touch.success,
            message=touch.message,
            error=touch.error,
            validation_score=touch.validation_score,
        )

        if touch.success:
            sent.append(summary)
        elif touch.error and "skipped" in touch.error.lower():
            skipped_contacts.append(summary)
        else:
            failed_contacts.append(summary)

    return SendResponse(
        total_processed=result.total_processed,
        successful=result.successful,
        failed=result.failed,
        skipped=result.skipped,
        sent=sent,
        skipped_contacts=skipped_contacts,
        failed_contacts=failed_contacts,
    )
