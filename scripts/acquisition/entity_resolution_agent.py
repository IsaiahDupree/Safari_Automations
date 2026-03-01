"""
acquisition/entity_resolution_agent.py — Cross-platform entity resolution agent.

Given one known platform handle, discovers all other social profiles (Twitter, Instagram,
TikTok, LinkedIn, website, email) using Perplexity search, username fuzzy matching,
bio link extraction, and Claude AI disambiguation.

Updates crm_contacts with confirmed cross-platform handles.
"""
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from typing import Optional

# Support both module and direct execution
if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from acquisition.db import queries
from acquisition.entity.perplexity_client import PerplexityClient, SafariPerplexityFallback, PerplexityNotConfiguredError
from acquisition.entity.username_matcher import handle_similarity, is_likely_same_handle, calculate_name_similarity
from acquisition.entity.bio_link_extractor import extract_bio_links, extract_handle_from_url
from acquisition.entity.disambiguator import disambiguate, disambiguate_batch, Contact, CandidateProfile, DisambiguationResult


@dataclass
class ResolutionResult:
    """Result of entity resolution for a contact."""
    contact_id: str
    confirmed: list[tuple[CandidateProfile, DisambiguationResult]]
    resolution_score: int = 0
    duration_ms: int = 0
    dry_run: bool = False


class EntityResolutionAgent:
    """
    Cross-platform entity resolution agent.
    
    Discovers all social profiles for a contact given one known platform handle.
    """
    
    def __init__(self):
        # Initialize Perplexity client (with fallback)
        try:
            self.perplexity = PerplexityClient()
        except PerplexityNotConfiguredError:
            self.perplexity = SafariPerplexityFallback()
    
    async def resolve(self, contact_id: str, dry_run: bool = False) -> ResolutionResult:
        """
        Run full resolution pipeline for one contact.
        
        Steps:
        1. Collect signals (Perplexity, bio links, username matching)
        2. Build candidate profiles
        3. Rank candidates by evidence score
        4. Disambiguate top candidates with Claude
        5. Write confirmed associations to database
        6. Calculate and update resolution score
        7. Log resolution run
        
        Args:
            contact_id: Contact to resolve
            dry_run: If True, skip database writes
        
        Returns:
            ResolutionResult with confirmed associations and final score
        """
        start = time.time()
        
        # Fetch contact from database
        contact_data, err = queries.get_contact(contact_id)
        if err or not contact_data:
            raise ValueError(f"Contact not found: {contact_id}")
        
        if isinstance(contact_data, list):
            contact_data = contact_data[0] if contact_data else {}
        
        contact = Contact(
            id=contact_data["id"],
            primary_platform=contact_data.get("primary_platform", "unknown"),
            primary_handle=contact_data.get("primary_handle", ""),
            display_name=contact_data.get("display_name"),
            bio_text=contact_data.get("bio_text"),
        )
        
        # 1. Collect signals in parallel
        perplexity_result, bio_links = await asyncio.gather(
            self._search_perplexity(contact),
            extract_bio_links(contact),
            return_exceptions=True
        )
        
        # Handle exceptions
        if isinstance(perplexity_result, Exception):
            perplexity_result = {}
        if isinstance(bio_links, Exception):
            bio_links = []
        
        # 2. Build candidates from all signals
        candidates = self._build_candidates(contact, perplexity_result, bio_links)
        
        # 3. Score and rank candidates
        ranked = self._rank_candidates(contact, candidates)
        
        # 4. Disambiguate top candidates with Claude (max 5)
        confirmed = []
        top_candidates = [c for c in ranked if c.score >= 40][:5]
        
        if top_candidates:
            # Check if we can skip weak signals
            filtered_candidates = [
                c for c in top_candidates
                if not self._should_skip_disambiguation(c)
            ]
            
            if filtered_candidates:
                # Use batch disambiguation for efficiency
                results = await disambiguate_batch(contact, filtered_candidates)
                
                for candidate, result in zip(filtered_candidates, results):
                    if result.same_person and result.confidence >= 80:
                        confirmed.append((candidate, result))
        
        # 5-7. Write to database (unless dry run)
        if not dry_run and confirmed:
            await self._write_associations(contact_id, confirmed)
        
        # Calculate resolution score
        resolution_score = await self._calculate_resolution_score(contact_id, confirmed, dry_run)
        
        # Log run
        duration_ms = int((time.time() - start) * 1000)
        
        if not dry_run:
            await self._log_resolution_run(
                contact_id,
                len(candidates),
                len(confirmed),
                [c.platform for c, _ in confirmed],
                any(c.type == 'email' for c, _ in confirmed),
                any(c.platform == 'linkedin' for c, _ in confirmed),
                duration_ms
            )
        
        return ResolutionResult(
            contact_id=contact_id,
            confirmed=confirmed,
            resolution_score=resolution_score,
            duration_ms=duration_ms,
            dry_run=dry_run
        )
    
    async def _search_perplexity(self, contact: Contact) -> dict:
        """Search Perplexity for cross-platform profiles."""
        try:
            # Get niche from contact or use generic query
            niche_data, _ = queries.get_niche_config(contact_id=contact.id) if hasattr(contact, 'niche_config_id') else (None, None)
            niche = niche_data.get("niche_name", "creator") if niche_data else "creator"
            
            # Build query based on available information
            if contact.display_name:
                query = self.perplexity.query_by_name(
                    contact.display_name,
                    niche,
                    contact.primary_platform
                )
            else:
                query = self.perplexity.query_by_handle(
                    contact.primary_handle,
                    contact.primary_platform,
                    niche
                )
            
            result = await self.perplexity.search(query)
            return self._parse_perplexity_response(result.get("content", ""))
        
        except Exception as e:
            print(f"Perplexity search failed: {e}")
            return {}
    
    def _parse_perplexity_response(self, content: str) -> dict:
        """
        Parse Perplexity response into structured profile data.
        
        Expected format: {"twitter": "@handle", "instagram": "@handle", ...}
        """
        if not content:
            return {}
        
        try:
            # Try to parse as JSON first
            return json.loads(content)
        except json.JSONDecodeError:
            # Fallback: extract handles using regex
            import re
            profiles = {}
            
            # Twitter/X
            twitter_match = re.search(r'twitter[:\s]+@?(\w+)', content, re.IGNORECASE)
            if twitter_match:
                profiles['twitter'] = twitter_match.group(1)
            
            # Instagram
            ig_match = re.search(r'instagram[:\s]+@?([\w.]+)', content, re.IGNORECASE)
            if ig_match:
                profiles['instagram'] = ig_match.group(1)
            
            # TikTok
            tt_match = re.search(r'tiktok[:\s]+@?([\w.]+)', content, re.IGNORECASE)
            if tt_match:
                profiles['tiktok'] = tt_match.group(1)
            
            # LinkedIn
            li_match = re.search(r'linkedin\.com/in/([\w-]+)', content, re.IGNORECASE)
            if li_match:
                profiles['linkedin'] = f"https://linkedin.com/in/{li_match.group(1)}"
            
            # Email
            email_match = re.search(r'[\w.-]+@[\w.-]+\.\w+', content)
            if email_match:
                profiles['email'] = email_match.group(0)
            
            # Website
            website_match = re.search(r'(?:website|site)[:\s]+(https?://[\w.-]+)', content, re.IGNORECASE)
            if website_match:
                profiles['website'] = website_match.group(1)
            
            return profiles
    
    def _build_candidates(self, contact: Contact, perplexity_result: dict, bio_links: list[str]) -> list[CandidateProfile]:
        """
        Build list of candidate profiles from all signal sources.
        
        Deduplicates by (platform, handle) and merges evidence sources.
        """
        candidates_dict = {}  # (platform, handle) -> CandidateProfile
        
        # Add Perplexity results
        for platform, value in perplexity_result.items():
            if not value or value == "null":
                continue
            
            if platform == 'email':
                key = ('email', value.lower())
                if key not in candidates_dict:
                    candidates_dict[key] = CandidateProfile(
                        platform='email',
                        handle=value.lower(),
                        type='email',
                        perplexity_mentioned=True,
                        evidence_sources=['perplexity']
                    )
            elif platform in ('twitter', 'instagram', 'tiktok'):
                handle = value.lstrip('@').lower()
                key = (platform, handle)
                if key not in candidates_dict:
                    candidates_dict[key] = CandidateProfile(
                        platform=platform,
                        handle=handle,
                        perplexity_mentioned=True,
                        evidence_sources=['perplexity']
                    )
            elif platform == 'linkedin' and 'linkedin.com' in value:
                handle = extract_handle_from_url(value, 'linkedin')
                if handle:
                    key = ('linkedin', handle)
                    if key not in candidates_dict:
                        candidates_dict[key] = CandidateProfile(
                            platform='linkedin',
                            handle=handle,
                            perplexity_mentioned=True,
                            evidence_sources=['perplexity']
                        )
        
        # Add bio link results
        for url in bio_links:
            for platform in ('twitter', 'instagram', 'tiktok', 'linkedin'):
                handle = extract_handle_from_url(url, platform)
                if handle:
                    key = (platform, handle.lower())
                    if key not in candidates_dict:
                        candidates_dict[key] = CandidateProfile(
                            platform=platform,
                            handle=handle.lower(),
                            bio_link_overlap=True,
                            evidence_sources=['bio_link']
                        )
                    else:
                        # Merge evidence
                        candidates_dict[key].bio_link_overlap = True
                        if 'bio_link' not in candidates_dict[key].evidence_sources:
                            candidates_dict[key].evidence_sources.append('bio_link')
        
        return list(candidates_dict.values())
    
    def _rank_candidates(self, contact: Contact, candidates: list[CandidateProfile]) -> list[CandidateProfile]:
        """
        Score each candidate by evidence strength and sort by score descending.
        
        Scoring:
        - Username similarity >= 0.85: +40 points
        - Bio link overlap: +30 points
        - Perplexity mentioned: +20 points
        - Name similarity (if available): +10 points
        """
        for candidate in candidates:
            score = 0
            
            # Username similarity
            similarity = handle_similarity(contact.primary_handle, candidate.handle)
            candidate.name_similarity = similarity
            if similarity >= 0.85:
                score += 40
            
            # Bio link overlap
            if candidate.bio_link_overlap:
                score += 30
            
            # Perplexity mentioned
            if candidate.perplexity_mentioned:
                score += 20
            
            # Name similarity (if display names available)
            if contact.display_name and candidate.display_name:
                name_sim = calculate_name_similarity(contact.display_name, candidate.display_name)
                candidate.name_similarity = max(candidate.name_similarity, name_sim)
                if name_sim >= 0.7:
                    score += 10
            
            candidate.score = score
        
        # Sort by score descending
        return sorted(candidates, key=lambda c: c.score, reverse=True)
    
    def _should_skip_disambiguation(self, candidate: CandidateProfile) -> bool:
        """
        Check if candidate signals are too weak to warrant Claude API call.
        
        Skip if:
        - Name similarity < 0.5
        - AND no bio link overlap
        - AND not mentioned by Perplexity
        """
        return (
            candidate.name_similarity < 0.5
            and not candidate.bio_link_overlap
            and not candidate.perplexity_mentioned
        )
    
    async def _write_associations(self, contact_id: str, confirmed: list[tuple[CandidateProfile, DisambiguationResult]]):
        """Write confirmed associations to database."""
        for candidate, result in confirmed:
            # Insert association
            assoc = {
                "contact_id": contact_id,
                "found_platform": candidate.platform,
                "found_handle": candidate.handle,
                "association_type": candidate.type,
                "confidence": result.confidence,
                "confirmed": True,
                "evidence_sources": json.dumps(candidate.evidence_sources),
                "claude_reasoning": result.reasoning,
            }
            
            await asyncio.get_event_loop().run_in_executor(
                None,
                queries.upsert_entity_association,
                assoc
            )
            
            # Update crm_contacts with confirmed handle
            await self._update_contact_handle(contact_id, candidate.platform, candidate.handle, candidate.type)
    
    async def _update_contact_handle(self, contact_id: str, platform: str, handle: str, type: str = "handle"):
        """Update crm_contacts with confirmed platform handle."""
        if type == 'email':
            update_data = {"email": handle}
        elif type == 'linkedin_url' or platform == 'linkedin':
            url = f"https://linkedin.com/in/{handle}" if not handle.startswith('http') else handle
            update_data = {"linkedin_url": url}
        elif type == 'website_url':
            url = f"https://{handle}" if not handle.startswith('http') else handle
            update_data = {"website_url": url}
        elif platform == 'twitter':
            update_data = {"twitter_handle": handle}
        elif platform == 'instagram':
            update_data = {"instagram_handle": handle}
        elif platform == 'tiktok':
            update_data = {"tiktok_handle": handle}
        else:
            return

        await asyncio.get_event_loop().run_in_executor(
            None,
            queries.update_contact,
            contact_id,
            update_data
        )
    
    async def _calculate_resolution_score(self, contact_id: str, confirmed: list[tuple[CandidateProfile, DisambiguationResult]], dry_run: bool = False) -> int:
        """
        Calculate resolution completeness score (0-100) from confirmed associations.

        Scoring:
        - Email (verified): 30 points
        - Email (unverified): 20 points
        - LinkedIn: 25 points
        - Twitter: 15 points
        - Instagram: 15 points
        - TikTok: 10 points
        - Website: 5 points

        Updates crm_contacts.resolution_score unless dry_run=True.
        """
        score = 0

        platforms_found = {c.platform for c, _ in confirmed}

        if 'email' in platforms_found:
            score += 30  # Assume verified for now
        if 'linkedin' in platforms_found:
            score += 25
        if 'twitter' in platforms_found:
            score += 15
        if 'instagram' in platforms_found:
            score += 15
        if 'tiktok' in platforms_found:
            score += 10
        if 'website' in platforms_found:
            score += 5

        final_score = min(score, 100)

        # Update contact with score
        if not dry_run:
            await asyncio.get_event_loop().run_in_executor(
                None,
                queries.update_contact,
                contact_id,
                {"resolution_score": final_score, "entity_resolved": True}
            )

        return final_score
    
    async def _log_resolution_run(self, contact_id: str, associations_found: int, associations_confirmed: int,
                                  platforms_resolved: list[str], email_found: bool, linkedin_found: bool,
                                  duration_ms: int):
        """Log resolution run to acq_resolution_runs table."""
        run = {
            "contact_id": contact_id,
            "associations_found": associations_found,
            "associations_confirmed": associations_confirmed,
            "platforms_resolved": json.dumps(platforms_resolved),
            "email_found": email_found,
            "linkedin_found": linkedin_found,
            "duration_ms": duration_ms,
        }
        
        await asyncio.get_event_loop().run_in_executor(
            None,
            queries.insert_resolution_run,
            run
        )
    
    async def batch_resolve(self, limit: int = 20, dry_run: bool = False) -> list[ResolutionResult]:
        """
        Resolve all unresolved contacts (entity_resolved=false).
        
        Processes up to `limit` contacts with semaphore(3) for parallel execution
        while respecting rate limits.
        
        Args:
            limit: Max contacts to process
            dry_run: If True, skip database writes
        
        Returns:
            List of ResolutionResults
        """
        # Get unresolved contacts
        contacts, err = queries.get_unresolved_contacts(limit)
        if err or not contacts:
            return []
        
        # Process with semaphore to limit concurrency
        semaphore = asyncio.Semaphore(3)
        
        async def resolve_with_limit(contact_id: str):
            async with semaphore:
                try:
                    return await self.resolve(contact_id, dry_run=dry_run)
                except Exception as e:
                    print(f"Error resolving {contact_id}: {e}")
                    return None
        
        results = await asyncio.gather(*[
            resolve_with_limit(c["id"]) for c in contacts
        ])
        
        return [r for r in results if r is not None]


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Entity Resolution Agent")
    parser.add_argument("--resolve", metavar="CONTACT_ID", help="Resolve one contact by ID")
    parser.add_argument("--batch", action="store_true", help="Resolve all unresolved contacts")
    parser.add_argument("--limit", type=int, default=20, help="Max contacts for batch mode")
    parser.add_argument("--status", action="store_true", help="Show resolution status")
    parser.add_argument("--show-unresolved", action="store_true", help="List unresolved contacts")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to database")
    
    args = parser.parse_args()
    
    agent = EntityResolutionAgent()
    
    if args.resolve:
        result = await agent.resolve(args.resolve, dry_run=args.dry_run)
        print(f"\n✅ Resolution {'(DRY RUN)' if result.dry_run else 'complete'} for {result.contact_id}")
        print(f"   Duration: {result.duration_ms}ms")
        print(f"   Resolution score: {result.resolution_score}/100")
        print(f"   Confirmed associations: {len(result.confirmed)}")
        for candidate, disambiguation in result.confirmed:
            print(f"     • {candidate.platform}: @{candidate.handle} (confidence: {disambiguation.confidence}%)")
    
    elif args.batch:
        results = await agent.batch_resolve(limit=args.limit, dry_run=args.dry_run)
        print(f"\n✅ Batch resolution {'(DRY RUN)' if args.dry_run else 'complete'}: {len(results)} contacts")
        total_associations = sum(len(r.confirmed) for r in results)
        avg_score = sum(r.resolution_score for r in results) / len(results) if results else 0
        print(f"   Total associations: {total_associations}")
        print(f"   Average resolution score: {avg_score:.1f}/100")
    
    elif args.status:
        # Show overall status
        contacts, _ = queries.get_contacts(limit=1000)
        total = len(contacts) if contacts else 0
        resolved = len([c for c in contacts if c.get("entity_resolved")]) if contacts else 0
        print(f"\n📊 Entity Resolution Status")
        print(f"   Total contacts: {total}")
        print(f"   Resolved: {resolved} ({resolved/total*100:.1f}%)" if total > 0 else "   Resolved: 0")
        print(f"   Unresolved: {total - resolved}")
    
    elif args.show_unresolved:
        contacts, _ = queries.get_unresolved_contacts(limit=50)
        print(f"\n📋 Unresolved contacts: {len(contacts) if contacts else 0}")
        if contacts:
            for c in contacts[:20]:
                print(f"   • {c['id']} — @{c.get('primary_handle', '?')} ({c.get('primary_platform', '?')})")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    asyncio.run(main())
