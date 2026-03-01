"""
acquisition/api/routes/entity.py — Entity resolution API endpoints.

Provides REST API for triggering entity resolution, checking status, and managing associations.
"""
import asyncio
from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel, Field

from ...entity_resolution_agent import EntityResolutionAgent, ResolutionResult
from ...db import queries


router = APIRouter(prefix="/entity", tags=["entity"])


# ── Request/Response Models ───────────────────────────────────────────────────

class ResolveRequest(BaseModel):
    """Request to resolve a single contact."""
    contact_id: str
    sources: Optional[List[str]] = Field(default=None, description="Evidence sources to use (perplexity, bio_links, username)")
    wait: bool = Field(default=False, description="Wait for completion (sync mode)")


class ResolveBatchRequest(BaseModel):
    """Request to queue batch resolution."""
    contact_ids: Optional[List[str]] = None
    limit: Optional[int] = Field(default=20, description="Max contacts if contact_ids not specified")


class ResolveResponse(BaseModel):
    """Response for single contact resolution."""
    contact_id: str
    run_id: Optional[str] = None
    status: str  # "queued", "processing", "completed"
    resolution_score: Optional[int] = None
    associations_confirmed: Optional[int] = None
    duration_ms: Optional[int] = None


class AssociationResponse(BaseModel):
    """Association record."""
    id: str
    contact_id: str
    found_platform: str
    found_handle: str
    confidence: int
    confirmed: bool
    evidence_sources: List[str]
    claude_reasoning: Optional[str] = None
    created_at: str


class StatusResponse(BaseModel):
    """Overall entity resolution pipeline status."""
    total_contacts: int
    resolved_count: int
    avg_resolution_score: float
    email_discovery_rate: float
    linkedin_discovery_rate: float
    unresolved_queue_depth: int


class ConfirmAssociationRequest(BaseModel):
    """Request to manually confirm/reject an association."""
    association_id: str
    confirmed: bool


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/resolve", response_model=ResolveResponse)
async def resolve_contact(req: ResolveRequest, background_tasks: BackgroundTasks):
    """
    Resolve all platforms for one contact.
    
    - Sync mode (wait=true): Returns result immediately
    - Async mode (wait=false): Queues job, returns run_id for polling
    """
    agent = EntityResolutionAgent()
    
    if req.wait:
        # Synchronous mode
        try:
            result = await agent.resolve(req.contact_id, dry_run=False)
            return ResolveResponse(
                contact_id=result.contact_id,
                status="completed",
                resolution_score=result.resolution_score,
                associations_confirmed=len(result.confirmed),
                duration_ms=result.duration_ms,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Asynchronous mode - queue for background processing
        run_id = f"run_{req.contact_id}_{int(asyncio.get_event_loop().time())}"
        
        # Queue resolution
        _, err = queries.enqueue_resolution(req.contact_id, priority=5)
        if err:
            raise HTTPException(status_code=500, detail=f"Failed to queue: {err}")
        
        # Add background task
        background_tasks.add_task(_resolve_background, req.contact_id)
        
        return ResolveResponse(
            contact_id=req.contact_id,
            run_id=run_id,
            status="queued",
        )


@router.post("/resolve-batch", response_model=dict)
async def resolve_batch(req: ResolveBatchRequest, background_tasks: BackgroundTasks):
    """
    Queue batch resolution for multiple contacts.
    
    Returns queued count. Results processed by background worker.
    """
    if req.contact_ids:
        # Queue specific contacts
        for contact_id in req.contact_ids:
            _, err = queries.enqueue_resolution(contact_id, priority=5)
            if err:
                raise HTTPException(status_code=500, detail=f"Failed to queue {contact_id}: {err}")
        
        queued_count = len(req.contact_ids)
    else:
        # Queue all unresolved contacts (up to limit)
        contacts, err = queries.get_unresolved_contacts(req.limit or 20)
        if err:
            raise HTTPException(status_code=500, detail=f"Failed to fetch unresolved: {err}")
        
        for contact in contacts:
            queries.enqueue_resolution(contact["id"], priority=5)
        
        queued_count = len(contacts)
    
    # Start background batch processor
    background_tasks.add_task(_resolve_batch_background, req.limit or 20)
    
    return {
        "queued_count": queued_count,
        "status": "processing",
    }


@router.get("/associations/{contact_id}", response_model=List[AssociationResponse])
async def get_associations(contact_id: str):
    """
    List all associations for a contact (confirmed and unconfirmed).
    
    Useful for human review of borderline cases.
    """
    associations, err = queries.get_entity_associations(contact_id)
    if err:
        raise HTTPException(status_code=500, detail=err)
    
    if not associations:
        return []
    
    return [
        AssociationResponse(
            id=a["id"],
            contact_id=a["contact_id"],
            found_platform=a["found_platform"],
            found_handle=a["found_handle"],
            confidence=a["confidence"],
            confirmed=a["confirmed"],
            evidence_sources=a.get("evidence_sources", []),
            claude_reasoning=a.get("claude_reasoning"),
            created_at=a["created_at"],
        )
        for a in associations
    ]


@router.post("/confirm", response_model=dict)
async def confirm_association(req: ConfirmAssociationRequest):
    """
    Manually confirm or reject a candidate association.
    
    On confirm:
    - UPDATE acq_entity_associations.confirmed
    - UPDATE crm_contacts with handle
    - Recalculate resolution_score
    """
    # Get association
    associations, err = queries.get_entity_associations("")  # TODO: get by ID
    if err:
        raise HTTPException(status_code=500, detail=err)
    
    # Find the association (TODO: implement get_association_by_id query)
    # For now, update directly
    
    # Update association
    update_data = {"confirmed": req.confirmed}
    # TODO: implement update_entity_association query
    
    # If confirmed, update contact and recalculate score
    if req.confirmed:
        # TODO: Get association details, update contact, recalc score
        pass
    
    return {
        "association_id": req.association_id,
        "confirmed": req.confirmed,
        "status": "updated",
    }


@router.get("/status", response_model=StatusResponse)
async def get_status():
    """
    Entity resolution pipeline status.
    
    Returns:
    - Total contacts
    - Resolved count
    - Average resolution score
    - Email discovery rate
    - LinkedIn discovery rate
    - Unresolved queue depth
    """
    # Get all contacts
    contacts, err = queries.get_contacts(limit=10000)
    if err:
        raise HTTPException(status_code=500, detail=err)
    
    if not contacts:
        return StatusResponse(
            total_contacts=0,
            resolved_count=0,
            avg_resolution_score=0.0,
            email_discovery_rate=0.0,
            linkedin_discovery_rate=0.0,
            unresolved_queue_depth=0,
        )
    
    total = len(contacts)
    resolved = [c for c in contacts if c.get("entity_resolved")]
    resolved_count = len(resolved)
    
    # Calculate averages
    avg_score = sum(c.get("resolution_score", 0) for c in resolved) / resolved_count if resolved_count > 0 else 0
    
    email_found = len([c for c in resolved if c.get("email")]) / resolved_count if resolved_count > 0 else 0
    linkedin_found = len([c for c in resolved if c.get("linkedin_url")]) / resolved_count if resolved_count > 0 else 0
    
    # Get queue depth
    queue, _ = queries.get_resolution_queue(limit=1000)
    queue_depth = len(queue) if queue else 0
    
    return StatusResponse(
        total_contacts=total,
        resolved_count=resolved_count,
        avg_resolution_score=avg_score,
        email_discovery_rate=email_found,
        linkedin_discovery_rate=linkedin_found,
        unresolved_queue_depth=queue_depth,
    )


# ── Background Tasks ──────────────────────────────────────────────────────────

async def _resolve_background(contact_id: str):
    """Background task for async resolution."""
    agent = EntityResolutionAgent()
    try:
        await agent.resolve(contact_id, dry_run=False)
    except Exception as e:
        print(f"Background resolution failed for {contact_id}: {e}")


async def _resolve_batch_background(limit: int):
    """Background task for batch resolution."""
    agent = EntityResolutionAgent()
    try:
        await agent.batch_resolve(limit=limit, dry_run=False)
    except Exception as e:
        print(f"Background batch resolution failed: {e}")
