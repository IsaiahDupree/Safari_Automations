"""
acquisition/entity/username_matcher.py — Fuzzy handle similarity for cross-platform matching.

Uses SequenceMatcher for username similarity and generates handle candidates from display names.
"""
import re
from difflib import SequenceMatcher
from typing import Optional

# Threshold for considering two handles as likely the same person
SAME_HANDLE_THRESHOLD = 0.85


def squish(s: str) -> str:
    """
    Normalize a handle by removing all non-alphanumeric characters and lowercasing.
    
    Examples:
        squish("John_Doe") -> "johndoe"
        squish("@jane.smith") -> "janesmith"
        squish("Tech-Guy!") -> "techguy"
    """
    if not s:
        return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())


def handle_similarity(h1: str, h2: str) -> float:
    """
    Calculate similarity ratio between two handles (0.0 to 1.0).
    
    Uses SequenceMatcher on squished versions of the handles.
    
    Examples:
        handle_similarity("john_doe", "johndoe") -> 1.0
        handle_similarity("john_doe", "jane_doe") -> 0.57
        handle_similarity("techguy", "tech_guy_dev") -> 0.70
    """
    s1 = squish(h1)
    s2 = squish(h2)
    if not s1 or not s2:
        return 0.0
    return SequenceMatcher(None, s1, s2).ratio()


def is_likely_same_handle(known: str, candidate: str) -> bool:
    """
    Determine if two handles likely belong to the same person.
    
    Returns True if similarity ratio >= SAME_HANDLE_THRESHOLD (0.85).
    """
    return handle_similarity(known, candidate) >= SAME_HANDLE_THRESHOLD


def name_to_handle_candidates(display_name: str) -> list[str]:
    """
    Generate likely handle variants from a display name.
    
    Returns a list of probable username patterns based on common conventions:
    - firstname + lastname (concatenated, underscore, dot)
    - first initial + lastname
    - lastname + firstname
    - full name (no spaces, underscores)
    
    Examples:
        name_to_handle_candidates("John Doe") ->
            ["johndoe", "john_doe", "john.doe", "jdoe", "doejohn"]
        
        name_to_handle_candidates("Jane Smith-Brown") ->
            ["janesmithbrown", "jane_smithbrown", "jane.smithbrown", "jsmithbrown", ...]
    """
    if not display_name:
        return []
    
    # Split on whitespace
    parts = display_name.lower().split()
    if not parts:
        return []
    
    # Normalize parts (remove non-alphanumeric)
    first = re.sub(r'[^a-z0-9]', '', parts[0])
    last = re.sub(r'[^a-z0-9]', '', parts[-1]) if len(parts) > 1 else ''
    
    candidates = []
    
    if first and last:
        # Two+ word names
        candidates.extend([
            f"{first}{last}",           # johndoe
            f"{first}_{last}",          # john_doe
            f"{first}.{last}",          # john.doe
            f"{first[0]}{last}",        # jdoe
            f"{last}{first}",           # doejohn
        ])
    
    # Always add full name variants
    no_spaces = display_name.lower().replace(' ', '')
    no_spaces_clean = re.sub(r'[^a-z0-9]', '', no_spaces)
    candidates.append(no_spaces_clean)
    
    underscored = display_name.lower().replace(' ', '_')
    underscored_clean = re.sub(r'[^a-z0-9_]', '', underscored)
    candidates.append(underscored_clean)
    
    # Filter out too-short candidates (less than 3 chars)
    return [c for c in set(candidates) if len(c) >= 3]


def calculate_name_similarity(known_name: Optional[str], candidate_name: Optional[str]) -> float:
    """
    Calculate similarity between two display names.
    
    Uses same squishing logic as handles but on full names.
    """
    if not known_name or not candidate_name:
        return 0.0
    return handle_similarity(known_name, candidate_name)
