"""
acquisition/entity — Cross-platform entity resolution module.

Discovers all social profiles (Twitter, Instagram, TikTok, LinkedIn, website, email)
for a person given one known platform handle.
"""

from .perplexity_client import PerplexityClient, SafariPerplexityFallback, PerplexityNotConfiguredError
from .username_matcher import squish, handle_similarity, name_to_handle_candidates, is_likely_same_handle
from .bio_link_extractor import extract_bio_links, parse_link_aggregator
from .disambiguator import disambiguate, DisambiguationResult

__all__ = [
    "PerplexityClient",
    "SafariPerplexityFallback",
    "PerplexityNotConfiguredError",
    "squish",
    "handle_similarity",
    "name_to_handle_candidates",
    "is_likely_same_handle",
    "extract_bio_links",
    "parse_link_aggregator",
    "disambiguate",
    "DisambiguationResult",
]
