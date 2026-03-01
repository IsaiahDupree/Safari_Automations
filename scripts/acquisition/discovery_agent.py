#!/usr/bin/env python3
"""
discovery_agent.py — AAG Agent 02: Prospect Discovery Agent.

Finds qualified prospects from social platforms using the Market Research API
and seeds them into crm_contacts. Handles deduplication and re-entry logic.

Usage:
    python3 -m acquisition.discovery_agent --run
    python3 -m acquisition.discovery_agent --niche-id UUID
    python3 -m acquisition.discovery_agent --platform instagram --limit 20
    python3 -m acquisition.discovery_agent --dry-run
"""
import asyncio
import argparse
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

# Support both module and direct execution
if __name__ == "__main__" and __package__ is None:
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "acquisition"

from acquisition.clients.market_research_client import MarketResearchClient, ProspectData
from acquisition.db.queries import (
    get_niche_configs,
    get_niche_config,
    insert_discovery_run,
    upsert_contact,
    enqueue_resolution,
    _select,
    _update,
)
from acquisition.config import (
    RE_ENTRY_ARCHIVED_DAYS,
    RE_ENTRY_CLOSED_LOST_DAYS,
    DM_SERVICE_PORTS,
)
import subprocess
import json
import urllib.request
import urllib.error


@dataclass
class DiscoveryResult:
    """Result from a discovery run."""
    discovered: int
    deduplicated: int
    seeded: int
    errors: list[str]
    duration_ms: int


@dataclass
class NicheConfig:
    """Niche configuration for discovery."""
    id: str
    name: str
    service_slug: str
    platforms: list[str]
    keywords: list[str]
    icp_min_score: int
    max_weekly: int
    is_active: bool


class DiscoveryAgent:
    """Agent 02: Discovers prospects from social platforms."""

    def __init__(self, dry_run: bool = False):
        self.client = MarketResearchClient()
        self.dry_run = dry_run
        # Rate limiter: max 3 concurrent platform scans
        self.semaphore = asyncio.Semaphore(3)
        # Platform request tracking for delays
        self.last_request_time = {}

    async def run(
        self,
        niche_config_id: Optional[str] = None,
        platform: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> DiscoveryResult:
        """
        Run discovery agent.

        Args:
            niche_config_id: Specific niche config ID to run (None = all active)
            platform: Specific platform to scan (None = all platforms in config)
            limit: Max contacts to seed (None = no limit)

        Returns:
            DiscoveryResult with counts and errors
        """
        start_time = time.time()
        total_discovered = 0
        total_deduplicated = 0
        total_seeded = 0
        errors = []

        # Get niche configs
        if niche_config_id:
            config_dict, err = get_niche_config(niche_config_id)
            if err:
                errors.append(f"Failed to fetch niche config: {err}")
                return DiscoveryResult(0, 0, 0, errors, 0)
            if not config_dict:
                errors.append(f"Niche config not found: {niche_config_id}")
                return DiscoveryResult(0, 0, 0, errors, 0)
            configs = [self._parse_config(config_dict)]
        else:
            config_dicts, err = get_niche_configs(active_only=True)
            if err:
                errors.append(f"Failed to fetch niche configs: {err}")
                return DiscoveryResult(0, 0, 0, errors, 0)
            configs = [self._parse_config(c) for c in config_dicts]

        if not configs:
            errors.append("No active niche configs found")
            return DiscoveryResult(0, 0, 0, errors, 0)

        # Scan all platforms for all configs
        tasks = []
        for config in configs:
            platforms = [platform] if platform else config.platforms
            for plat in platforms:
                for keyword in config.keywords:
                    tasks.append(self._scan_platform_with_semaphore(config, plat, keyword))

        # Execute all scans with rate limiting
        scan_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Process results
        all_prospects = []
        for result in scan_results:
            if isinstance(result, Exception):
                errors.append(f"Scan failed: {str(result)[:200]}")
            elif isinstance(result, tuple):
                prospects, err = result
                if err:
                    errors.append(err)
                else:
                    all_prospects.extend(prospects)

        total_discovered = len(all_prospects)

        # Deduplicate
        new_prospects, existing_prospects = await self._deduplicate(all_prospects)
        total_deduplicated = len(existing_prospects)

        # Apply limit if specified
        if limit and len(new_prospects) > limit:
            new_prospects = new_prospects[:limit]

        # Seed contacts
        if not self.dry_run:
            for config in configs:
                config_prospects = [p for p in new_prospects if p.niche_label == config.name]
                if config_prospects:
                    seeded = await self._seed_contacts(config_prospects, config)
                    total_seeded += seeded

                    # TikTok enrichment (AAG-009)
                    tiktok_prospects = [p for p in config_prospects if p.platform == "tiktok"]
                    if tiktok_prospects:
                        await self._enrich_tiktok_contacts(tiktok_prospects)

                    # Log discovery run
                    for plat in set(p.platform for p in config_prospects):
                        platform_prospects = [p for p in config_prospects if p.platform == plat]
                        keyword = config_prospects[0].niche_label if config_prospects else ""
                        await self._log_run(DiscoveryRun(
                            niche_config_id=config.id,
                            platform=plat,
                            keyword=keyword,
                            discovered=len(platform_prospects),
                            deduplicated=len([p for p in existing_prospects if p.platform == plat]),
                            seeded=len(platform_prospects),
                            errors=errors,
                            duration_ms=int((time.time() - start_time) * 1000),
                        ))
        else:
            total_seeded = len(new_prospects)

        duration_ms = int((time.time() - start_time) * 1000)
        return DiscoveryResult(
            discovered=total_discovered,
            deduplicated=total_deduplicated,
            seeded=total_seeded,
            errors=errors,
            duration_ms=duration_ms,
        )

    async def _scan_platform_with_semaphore(
        self,
        config: NicheConfig,
        platform: str,
        keyword: str,
    ) -> tuple[list[ProspectData], Optional[str]]:
        """Scan platform with rate limiting."""
        async with self.semaphore:
            # Enforce 5 second delay between requests to same platform
            last_time = self.last_request_time.get(platform, 0)
            elapsed = time.time() - last_time
            if elapsed < 5:
                await asyncio.sleep(5 - elapsed)

            result = await self._scan_platform(config, platform, keyword)
            self.last_request_time[platform] = time.time()
            return result

    async def _scan_platform(
        self,
        config: NicheConfig,
        platform: str,
        keyword: str,
    ) -> tuple[list[ProspectData], Optional[str]]:
        """
        Scan a platform for prospects.

        Args:
            config: Niche configuration
            platform: Platform name
            keyword: Search keyword

        Returns:
            (list of ProspectData, error message or None)
        """
        # LinkedIn discovery via li_prospect.py (AAG-010)
        if platform == "linkedin":
            return await self._scan_linkedin(keyword, config)

        prospects, err = await self.client.search_platform(
            platform=platform,
            keyword=keyword,
            max_results=50,
        )

        if err:
            return [], f"Platform scan failed for {platform}/{keyword}: {err}"

        # Set niche_label on all prospects
        for p in prospects:
            p.niche_label = config.name

        return prospects, None

    async def _deduplicate(
        self,
        prospects: list[ProspectData],
    ) -> tuple[list[ProspectData], list[ProspectData]]:
        """
        Deduplicate prospects against existing contacts.

        Returns:
            (new prospects, existing prospects)
        """
        new = []
        existing = []

        for prospect in prospects:
            # Check if handle exists in any platform column
            is_existing = await self._check_existing_handle(prospect.handle)

            # Check re-entry eligibility for archived/closed_lost
            if is_existing:
                should_reenter = await self._check_reentry_eligibility(prospect.handle)
                if should_reenter:
                    new.append(prospect)
                else:
                    existing.append(prospect)
            else:
                new.append(prospect)

        return new, existing

    async def _check_existing_handle(self, handle: str) -> bool:
        """Check if handle exists in any platform column."""
        # Query crm_contacts for matching handle
        rows, err = _select(
            "crm_contacts",
            f"?or=(twitter_handle.eq.{handle},instagram_handle.eq.{handle},"
            f"tiktok_handle.eq.{handle},linkedin_url.like.*{handle}*)"
            f"&select=id"
        )

        if err:
            return False  # Assume not existing if query fails

        return len(rows) > 0

    async def _check_reentry_eligibility(self, handle: str) -> bool:
        """
        Check if contact should re-enter pipeline.

        Re-entry conditions:
        - archived: re-enter if archived_at < NOW() - 180 days
        - closed_lost: re-enter if updated_at < NOW() - 90 days
        """
        # Find contact
        rows, err = _select(
            "crm_contacts",
            f"?or=(twitter_handle.eq.{handle},instagram_handle.eq.{handle},"
            f"tiktok_handle.eq.{handle},linkedin_url.like.*{handle}*)"
            f"&select=id,pipeline_stage,archived_at,updated_at"
        )

        if err or not rows:
            return False

        contact = rows[0]
        stage = contact.get("pipeline_stage")
        now = datetime.now(timezone.utc)

        if stage == "archived":
            archived_at = contact.get("archived_at")
            if archived_at:
                archived_date = datetime.fromisoformat(archived_at.replace("Z", "+00:00"))
                days_since_archive = (now - archived_date).days
                return days_since_archive >= RE_ENTRY_ARCHIVED_DAYS

        elif stage == "closed_lost":
            updated_at = contact.get("updated_at")
            if updated_at:
                updated_date = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
                days_since_update = (now - updated_date).days
                return days_since_update >= RE_ENTRY_CLOSED_LOST_DAYS

        return False

    async def _seed_contacts(
        self,
        prospects: list[ProspectData],
        config: NicheConfig,
    ) -> int:
        """
        Seed prospects into crm_contacts.

        Args:
            prospects: List of new prospects to seed
            config: Niche configuration

        Returns:
            Number of contacts seeded
        """
        if self.dry_run:
            # In dry run mode, just return count without writing
            return len(prospects)

        seeded = 0

        for prospect in prospects:
            # Build contact dict
            contact = {
                "id": str(uuid.uuid4()),
                "pipeline_stage": "new",
                "niche_label": config.name,
                "source_niche_config_id": config.id,
                "relationship_score": None,  # Scored by Agent 03
                "entity_resolved": False,
            }

            # Set platform-specific handle
            if prospect.platform == "twitter":
                contact["twitter_handle"] = prospect.handle
            elif prospect.platform == "instagram":
                contact["instagram_handle"] = prospect.handle
            elif prospect.platform == "tiktok":
                contact["tiktok_handle"] = prospect.handle
            elif prospect.platform == "linkedin":
                contact["linkedin_url"] = f"https://linkedin.com/in/{prospect.handle}"

            # Add metadata
            contact["name"] = prospect.display_name or prospect.handle

            # Check for re-entry and reset pipeline_stage
            is_reentry = await self._is_reentry(prospect.handle)
            if is_reentry:
                contact["pipeline_stage"] = "new"
                contact["archived_at"] = None

            # Upsert contact
            count, err = upsert_contact(contact)
            if err:
                continue

            # Enqueue for entity resolution
            enqueue_resolution(contact["id"], priority=5)

            seeded += 1

        return seeded

    async def _is_reentry(self, handle: str) -> bool:
        """Check if this is a re-entry (contact already exists)."""
        return await self._check_existing_handle(handle)

    async def _enrich_tiktok_contacts(self, prospects: list[ProspectData]) -> None:
        """
        Enrich TikTok contacts with follower count via enrichment endpoint.

        AAG-009: After seeding TikTok contacts, call enrichment endpoint
        to pull follower count. Skip if already enriched in last 7 days.
        """
        tiktok_port = DM_SERVICE_PORTS.get("tiktok", 3102)
        enrichment_url = f"http://localhost:{tiktok_port}/enrich"

        for prospect in prospects:
            # Check if already enriched recently
            rows, err = _select(
                "crm_contacts",
                f"?tiktok_handle.eq.{prospect.handle}"
                f"&select=id,follower_count_tiktok,tiktok_enriched_at"
            )

            if err or not rows:
                continue

            contact = rows[0]
            enriched_at = contact.get("tiktok_enriched_at")

            # Skip if enriched in last 7 days
            if enriched_at:
                enriched_date = datetime.fromisoformat(enriched_at.replace("Z", "+00:00"))
                days_since = (datetime.now(timezone.utc) - enriched_date).days
                if days_since < 7:
                    continue

            # Call enrichment endpoint
            try:
                body = json.dumps({"handle": prospect.handle}).encode()
                headers = {"Content-Type": "application/json"}
                req = urllib.request.Request(enrichment_url, data=body, headers=headers, method="POST")

                with urllib.request.urlopen(req, timeout=10) as response:
                    result = json.loads(response.read())
                    follower_count = result.get("followerCount", 0)

                    # Update contact
                    _update(
                        "crm_contacts",
                        f"?id=eq.{contact['id']}",
                        {
                            "follower_count_tiktok": follower_count,
                            "tiktok_enriched_at": datetime.now(timezone.utc).isoformat(),
                        }
                    )

            except Exception as e:
                # Log error but don't fail the whole discovery run
                pass

    async def _scan_linkedin(
        self,
        keyword: str,
        config: NicheConfig,
    ) -> tuple[list[ProspectData], Optional[str]]:
        """
        Scan LinkedIn via li_prospect.py integration.

        AAG-010: Call li_prospect.py --search and parse stdout output
        into ProspectData objects.
        """
        # Check if li_prospect.py exists
        li_prospect_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "li_prospect.py"
        )

        if not os.path.exists(li_prospect_path):
            return [], "li_prospect.py not found"

        try:
            # Call li_prospect.py --search with keyword
            result = subprocess.run(
                ["python3", li_prospect_path, "--search", keyword, "--limit", "50"],
                capture_output=True,
                text=True,
                timeout=60,
            )

            if result.returncode != 0:
                return [], f"li_prospect.py failed: {result.stderr[:200]}"

            # Parse JSON output
            prospects_data = json.loads(result.stdout)
            prospects = []

            for item in prospects_data:
                prospects.append(ProspectData(
                    handle=item.get("profile_url", "").split("/")[-1],
                    display_name=item.get("name", ""),
                    platform="linkedin",
                    follower_count=item.get("connections", 0),
                    engagement_rate=0.0,
                    bio_url=item.get("profile_url"),
                    niche_label=config.name,
                ))

            return prospects, None

        except subprocess.TimeoutExpired:
            return [], "li_prospect.py timeout"
        except json.JSONDecodeError:
            return [], "Failed to parse li_prospect.py output"
        except Exception as e:
            return [], f"LinkedIn scan failed: {str(e)[:200]}"

    async def _log_run(self, run: "DiscoveryRun") -> None:
        """Log discovery run to acq_discovery_runs."""
        run_dict = {
            "niche_config_id": run.niche_config_id,
            "platform": run.platform,
            "keyword": run.keyword,
            "discovered": run.discovered,
            "deduplicated": run.deduplicated,
            "seeded": run.seeded,
            "errors": run.errors,
            "duration_ms": run.duration_ms,
        }
        insert_discovery_run(run_dict)

    def _parse_config(self, config_dict: dict) -> NicheConfig:
        """Parse config dict to NicheConfig dataclass."""
        return NicheConfig(
            id=config_dict["id"],
            name=config_dict["name"],
            service_slug=config_dict["service_slug"],
            platforms=config_dict["platforms"],
            keywords=config_dict["keywords"],
            icp_min_score=config_dict["icp_min_score"],
            max_weekly=config_dict.get("max_weekly", 100),
            is_active=config_dict["is_active"],
        )


@dataclass
class DiscoveryRun:
    """Discovery run record."""
    niche_config_id: str
    platform: str
    keyword: str
    discovered: int
    deduplicated: int
    seeded: int
    errors: list[str]
    duration_ms: int


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════


async def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="AAG Agent 02: Prospect Discovery")
    parser.add_argument("--run", action="store_true", help="Run discovery for all active niches")
    parser.add_argument("--niche-id", help="Run for specific niche config ID")
    parser.add_argument("--platform", help="Run for specific platform only")
    parser.add_argument("--limit", type=int, help="Max contacts to seed")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (no database writes)")

    args = parser.parse_args()

    if not (args.run or args.niche_id):
        parser.error("Must specify --run or --niche-id")

    agent = DiscoveryAgent(dry_run=args.dry_run)

    print("🔍 Starting Discovery Agent...")
    if args.dry_run:
        print("   DRY RUN MODE (no database writes)")

    result = await agent.run(
        niche_config_id=args.niche_id,
        platform=args.platform,
        limit=args.limit,
    )

    # Print results
    print(f"\n✅ Discovery Complete ({result.duration_ms}ms)")
    print(f"   Discovered: {result.discovered}")
    print(f"   Deduplicated: {result.deduplicated}")
    print(f"   Seeded: {result.seeded}")

    if result.errors:
        print(f"\n⚠️  Errors ({len(result.errors)}):")
        for err in result.errors[:5]:  # Show first 5 errors
            print(f"   - {err}")


if __name__ == "__main__":
    asyncio.run(main())
