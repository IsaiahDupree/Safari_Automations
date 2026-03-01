"""
acquisition/entity/disambiguator.py — Claude-powered profile disambiguation.

Uses Claude Haiku to determine if two social profiles belong to the same person
based on name similarity, bio overlap, and other evidence.
"""
import asyncio
import json
import os
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional


@dataclass
class Contact:
    """Minimal contact representation for disambiguation."""
    id: str
    primary_platform: str
    primary_handle: str
    display_name: Optional[str] = None
    bio_text: Optional[str] = None


@dataclass
class CandidateProfile:
    """A candidate profile that might belong to the same person."""
    platform: str
    handle: str
    display_name: Optional[str] = None
    bio_text: Optional[str] = None
    name_similarity: float = 0.0
    bio_link_overlap: bool = False
    perplexity_mentioned: bool = False
    score: float = 0.0
    evidence_sources: list[str] = None
    type: str = "handle"  # "handle" or "email"
    
    def __post_init__(self):
        if self.evidence_sources is None:
            self.evidence_sources = []


@dataclass
class DisambiguationResult:
    """Result of Claude disambiguation analysis."""
    same_person: bool
    confidence: int  # 0-100
    reasoning: str
    warning: Optional[str] = None


async def disambiguate(known: Contact, candidate: CandidateProfile) -> DisambiguationResult:
    """
    Use Claude Haiku to determine if two profiles belong to the same person.
    
    Returns DisambiguationResult with confidence >= 80 required for same_person=True.
    
    Args:
        known: The contact we're trying to resolve
        candidate: A candidate profile that might match
    
    Returns:
        DisambiguationResult with same_person, confidence, reasoning
    """
    
    prompt = f"""Are these two social media profiles the SAME PERSON?

Known profile:
- Platform: {known.primary_platform}
- Handle: @{known.primary_handle}
- Display name: {known.display_name or 'unknown'}
- Bio snippet: {(known.bio_text[:200] if known.bio_text else 'unknown')}

Candidate profile:
- Platform: {candidate.platform}
- Handle: @{candidate.handle}
- Display name: {candidate.display_name or 'unknown'}
- Bio snippet: {(candidate.bio_text[:200] if candidate.bio_text else 'unknown')}

Evidence:
- Name similarity: {candidate.name_similarity:.0%}
- Bio link overlap: {candidate.bio_link_overlap}
- Perplexity search mentioned this link: {candidate.perplexity_mentioned}
- Evidence sources: {', '.join(candidate.evidence_sources)}

Respond with ONLY valid JSON (no markdown, no explanation):
{{"same_person": true/false, "confidence": 0-100, "reasoning": "one sentence max", "warning": "note if ambiguous or common name, otherwise null"}}

Only return same_person=true if confidence >= 80."""

    # Call Claude API
    response = await _call_claude_api(prompt)
    
    # Parse JSON response
    try:
        result = json.loads(response)
        return DisambiguationResult(
            same_person=result.get("same_person", False),
            confidence=result.get("confidence", 0),
            reasoning=result.get("reasoning", ""),
            warning=result.get("warning"),
        )
    except json.JSONDecodeError:
        # Fallback: treat as not the same person if can't parse
        return DisambiguationResult(
            same_person=False,
            confidence=0,
            reasoning="Failed to parse Claude response",
            warning="JSON parse error",
        )


async def disambiguate_batch(known: Contact, candidates: list[CandidateProfile]) -> list[DisambiguationResult]:
    """
    Batch disambiguate up to 5 candidates in a single Claude call.
    
    Reduces API costs by processing multiple candidates together.
    Falls back to individual calls if batch parsing fails.
    """
    if not candidates:
        return []
    
    if len(candidates) == 1:
        return [await disambiguate(known, candidates[0])]
    
    # Limit to 5 candidates per batch
    batch = candidates[:5]
    
    # Build batch prompt
    candidates_text = "\n\n".join([
        f"""Candidate {i+1}:
- Platform: {c.platform}
- Handle: @{c.handle}
- Display name: {c.display_name or 'unknown'}
- Bio snippet: {(c.bio_text[:200] if c.bio_text else 'unknown')}
- Name similarity: {c.name_similarity:.0%}
- Bio link overlap: {c.bio_link_overlap}
- Perplexity mentioned: {c.perplexity_mentioned}"""
        for i, c in enumerate(batch)
    ])
    
    prompt = f"""Are any of these candidate profiles the SAME PERSON as the known profile?

Known profile:
- Platform: {known.primary_platform}
- Handle: @{known.primary_handle}
- Display name: {known.display_name or 'unknown'}
- Bio snippet: {(known.bio_text[:200] if known.bio_text else 'unknown')}

{candidates_text}

Respond with ONLY valid JSON array (no markdown):
[
  {{"candidate": 1, "same_person": true/false, "confidence": 0-100, "reasoning": "one sentence", "warning": null}},
  ...
]

Only mark same_person=true if confidence >= 80."""

    try:
        response = await _call_claude_api(prompt, max_tokens=500)
        results_json = json.loads(response)
        
        # Map results back to candidates
        results = []
        for i, candidate in enumerate(batch):
            if i < len(results_json):
                r = results_json[i]
                results.append(DisambiguationResult(
                    same_person=r.get("same_person", False),
                    confidence=r.get("confidence", 0),
                    reasoning=r.get("reasoning", ""),
                    warning=r.get("warning"),
                ))
            else:
                # Missing result, treat as no match
                results.append(DisambiguationResult(
                    same_person=False,
                    confidence=0,
                    reasoning="No result in batch response",
                ))
        
        return results
    
    except (json.JSONDecodeError, KeyError, IndexError):
        # Batch parsing failed, fallback to individual calls
        results = []
        for candidate in batch:
            result = await disambiguate(known, candidate)
            results.append(result)
        return results


async def _call_claude_api(prompt: str, max_tokens: int = 150) -> str:
    """
    Call Claude API with the given prompt.
    
    Uses claude-3-haiku-20240307 for cost efficiency.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY not set")
    
    request_body = {
        "model": "claude-3-haiku-20240307",
        "max_tokens": max_tokens,
        "temperature": 0.1,
        "messages": [
            {"role": "user", "content": prompt}
        ]
    }
    
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(request_body).encode(),
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        method="POST"
    )
    
    try:
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: urllib.request.urlopen(req, timeout=30)
        )
        
        data = json.loads(response.read())
        
        # Log usage
        await _log_claude_usage(max_tokens)
        
        return data["content"][0]["text"]
    
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:300]
        raise Exception(f"Claude API error {e.code}: {error_body}")


async def _log_claude_usage(max_tokens: int):
    """Log Claude API usage for cost tracking."""
    try:
        from ..db import queries
        # Haiku: ~$0.25 per million input tokens, ~$1.25 per million output tokens
        # Rough estimate: $0.0002 per disambiguation call
        await asyncio.get_event_loop().run_in_executor(
            None,
            queries.insert_api_usage,
            "claude",
            1,
            0.0002  # estimated_cost_usd
        )
    except Exception:
        pass
