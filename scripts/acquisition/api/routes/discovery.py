"""
acquisition/api/routes/discovery.py — Discovery Agent API endpoints.

Endpoints:
- POST /api/acquisition/discovery/run — Trigger discovery run
- GET  /api/acquisition/discovery/runs — List discovery runs
- POST /api/acquisition/niches — Create niche config
- GET  /api/acquisition/niches — List niche configs
- PUT  /api/acquisition/niches/{id} — Update niche config
- DELETE /api/acquisition/niches/{id} — Deactivate niche config
- GET  /api/acquisition/discovery/health — Health check
"""

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ...discovery_agent import DiscoveryAgent, DiscoveryResult
from ...db import queries


router = APIRouter()


# ═══════════════════════════════════════════════════════════════════════════════
# Schemas
# ═══════════════════════════════════════════════════════════════════════════════


class DiscoveryRunRequest(BaseModel):
    """Request to trigger discovery run."""
    niche_config_id: Optional[str] = None
    platform: Optional[str] = None
    limit: Optional[int] = None
    dry_run: bool = False


class DiscoveryRunResponse(BaseModel):
    """Response from discovery run."""
    discovered: int
    deduplicated: int
    seeded: int
    errors: list[str]
    duration_ms: int


class NicheConfigCreate(BaseModel):
    """Create niche config."""
    name: str
    service_slug: str
    platforms: list[str]
    keywords: list[str]
    icp_min_score: int
    max_weekly: int = 100


class NicheConfigUpdate(BaseModel):
    """Update niche config."""
    name: Optional[str] = None
    service_slug: Optional[str] = None
    platforms: Optional[list[str]] = None
    keywords: Optional[list[str]] = None
    icp_min_score: Optional[int] = None
    max_weekly: Optional[int] = None
    is_active: Optional[bool] = None


class NicheConfigResponse(BaseModel):
    """Niche config response."""
    id: str
    name: str
    service_slug: str
    platforms: list[str]
    keywords: list[str]
    icp_min_score: int
    max_weekly: int
    is_active: bool
    created_at: str
    last_run_at: Optional[str] = None
    total_discovered: Optional[int] = None
    total_seeded: Optional[int] = None


class HealthResponse(BaseModel):
    """Discovery health check response."""
    status: str
    last_runs: dict[str, str]  # niche_id -> timestamp
    contacts_seeded_this_week: int


# ═══════════════════════════════════════════════════════════════════════════════
# Discovery Run Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/run", response_model=DiscoveryRunResponse)
async def trigger_discovery_run(request: DiscoveryRunRequest):
    """
    Trigger a discovery run for a specific niche config and/or platform.

    Returns run stats synchronously for runs that complete in <30s,
    otherwise returns run_id for polling.
    """
    agent = DiscoveryAgent(dry_run=request.dry_run)

    try:
        result = await agent.run(
            niche_config_id=request.niche_config_id,
            platform=request.platform,
            limit=request.limit,
        )

        return DiscoveryRunResponse(
            discovered=result.discovered,
            deduplicated=result.deduplicated,
            seeded=result.seeded,
            errors=result.errors,
            duration_ms=result.duration_ms,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/runs")
async def list_discovery_runs(
    niche_config_id: Optional[str] = Query(None),
    platform: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    List recent discovery runs with pagination.

    Filter by niche_config_id, platform, date range.
    Returns run stats including error summaries.
    """
    # Build filter query
    filters = []
    if niche_config_id:
        filters.append(f"niche_config_id.eq.{niche_config_id}")
    if platform:
        filters.append(f"platform.eq.{platform}")

    filter_str = f"?{'&'.join(filters)}" if filters else ""
    filter_str += f"&limit={limit}&offset={offset}&order=created_at.desc"
    filter_str += "&select=*"

    rows, err = queries._select("acq_discovery_runs", filter_str)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to fetch runs: {err}")

    return {
        "runs": rows,
        "total": len(rows),
        "limit": limit,
        "offset": offset,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Niche Config Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


@router.post("/niches", response_model=NicheConfigResponse, status_code=201)
async def create_niche_config(config: NicheConfigCreate):
    """Create a new niche config."""
    import uuid

    niche_dict = {
        "id": str(uuid.uuid4()),
        "name": config.name,
        "service_slug": config.service_slug,
        "platforms": config.platforms,
        "keywords": config.keywords,
        "icp_min_score": config.icp_min_score,
        "max_weekly": config.max_weekly,
        "is_active": True,
    }

    result, err = queries.create_niche_config(niche_dict)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to create niche config: {err}")

    # Fetch created config
    created, err = queries.get_niche_config(niche_dict["id"])
    if err or not created:
        raise HTTPException(status_code=500, detail="Failed to retrieve created config")

    return NicheConfigResponse(**created)


@router.get("/niches")
async def list_niche_configs(
    active_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """
    List all niche configs with last_run stats joined.

    Optionally filter to active configs only.
    """
    configs, err = queries.get_niche_configs(active_only=active_only)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to fetch niche configs: {err}")

    # Apply pagination
    total = len(configs)
    configs = configs[offset:offset + limit]

    # Enrich with run stats
    enriched_configs = []
    for config in configs:
        # Fetch last run for this niche
        runs, err = queries._select(
            "acq_discovery_runs",
            f"?niche_config_id.eq.{config['id']}&limit=1&order=created_at.desc&select=created_at,discovered,seeded"
        )

        last_run = runs[0] if runs else None

        enriched_configs.append({
            **config,
            "last_run_at": last_run.get("created_at") if last_run else None,
            "total_discovered": last_run.get("discovered") if last_run else None,
            "total_seeded": last_run.get("seeded") if last_run else None,
        })

    return {
        "niches": enriched_configs,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.put("/niches/{niche_id}")
async def update_niche_config(niche_id: str, update: NicheConfigUpdate):
    """Update an existing niche config."""
    # Fetch existing config
    existing, err = queries.get_niche_config(niche_id)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to fetch niche config: {err}")
    if not existing:
        raise HTTPException(status_code=404, detail="Niche config not found")

    # Merge updates
    update_dict = update.model_dump(exclude_unset=True)
    updated_config = {**existing, **update_dict}

    # Update in database
    result, err = queries.update_niche_config(niche_id, update_dict)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to update niche config: {err}")

    return NicheConfigResponse(**updated_config)


@router.delete("/niches/{niche_id}")
async def deactivate_niche_config(niche_id: str):
    """Deactivate a niche config (soft delete)."""
    result, err = queries.update_niche_config(niche_id, {"is_active": False})
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to deactivate niche config: {err}")

    return {"status": "deactivated", "niche_id": niche_id}


# ═══════════════════════════════════════════════════════════════════════════════
# Health Check
# ═══════════════════════════════════════════════════════════════════════════════


@router.get("/health", response_model=HealthResponse)
async def discovery_health_check():
    """
    Discovery service health check.

    Returns service status, last successful run timestamp per niche,
    and contacts seeded this week.
    """
    # Get all active niches
    configs, err = queries.get_niche_configs(active_only=True)
    if err:
        raise HTTPException(status_code=500, detail=f"Failed to fetch niche configs: {err}")

    # Get last run for each niche
    last_runs = {}
    for config in configs:
        runs, err = queries._select(
            "acq_discovery_runs",
            f"?niche_config_id.eq.{config['id']}&limit=1&order=created_at.desc&select=created_at"
        )
        if runs:
            last_runs[config['id']] = runs[0]['created_at']

    # Count contacts seeded this week
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    contacts, err = queries._select(
        "crm_contacts",
        f"?created_at.gte.{week_ago}&select=id"
    )

    contacts_this_week = len(contacts) if contacts else 0

    return HealthResponse(
        status="ok",
        last_runs=last_runs,
        contacts_seeded_this_week=contacts_this_week,
    )
