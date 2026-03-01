"""
acquisition/state_machine.py — Pipeline state transitions for the acquisition funnel.

Defines valid stage transitions and enforces them before any pipeline_stage update.
This is the single source of truth for pipeline flow.
"""

VALID_TRANSITIONS: dict[str, list[str]] = {
    "new":          ["qualified", "archived"],
    "qualified":    ["warming", "ready_for_dm", "archived"],   # ready_for_dm via high-score skip
    "warming":      ["ready_for_dm", "archived"],
    "ready_for_dm": ["contacted", "archived"],
    "contacted":    ["replied", "follow_up_1", "archived"],
    "follow_up_1":  ["replied", "follow_up_2", "archived"],
    "follow_up_2":  ["replied", "archived"],
    "replied":      ["call_booked", "archived"],
    "call_booked":  ["closed_won", "closed_lost"],
    "closed_won":   [],
    "closed_lost":  ["new"],      # re-enter after 90 days
    "archived":     ["new"],      # re-enter after 180 days
}

ALL_STAGES = list(VALID_TRANSITIONS.keys())


class InvalidTransitionError(Exception):
    pass


def validate_transition(from_stage: str, to_stage: str) -> None:
    """Raise InvalidTransitionError if the transition is not allowed."""
    allowed = VALID_TRANSITIONS.get(from_stage)
    if allowed is None:
        raise InvalidTransitionError(
            f"Unknown stage '{from_stage}'. Valid stages: {ALL_STAGES}"
        )
    if to_stage not in allowed:
        raise InvalidTransitionError(
            f"Cannot transition from '{from_stage}' to '{to_stage}'. "
            f"Allowed: {allowed}"
        )
