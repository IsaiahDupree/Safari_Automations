"""
acquisition/config.py — Centralized config for the Autonomous Acquisition Agent.

All environment variables, service ports, daily cap defaults, and pipeline
stage transitions live here so every other module imports from one place.
"""
import os

# ── Core Services ─────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://ivhfuhxorppptyuofbgq.supabase.co")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_KEY")
    or os.environ.get("SUPABASE_ANON_KEY")
    or ""
)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
PERPLEXITY_API_KEY = os.environ.get("PERPLEXITY_API_KEY", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")

# ── Email ─────────────────────────────────────────────────────────────────────

FROM_EMAIL = os.environ.get("FROM_EMAIL", "outreach@example.com")
OWNER_EMAIL = os.environ.get("OWNER_EMAIL", "")
EMAIL_UNSUB_SECRET = os.environ.get("EMAIL_UNSUB_SECRET", "change-me")

IMAP_HOST = os.environ.get("IMAP_HOST", "imap.gmail.com")
IMAP_USER = os.environ.get("IMAP_USER", "")
IMAP_PASS = os.environ.get("IMAP_PASS", "")

# ── Feature Flag ──────────────────────────────────────────────────────────────

ENABLE_ACQUISITION = os.environ.get("ENABLE_ACQUISITION", "false").lower() == "true"

# ── Safari Gateway ────────────────────────────────────────────────────────────

SAFARI_GATEWAY_URL = os.environ.get("SAFARI_GATEWAY_URL", "http://localhost:7070")

# ── Service Ports (DM adapters) ──────────────────────────────────────────────

DM_SERVICE_PORTS = {
    "instagram": 3001,
    "twitter": 3003,
    "tiktok": 3102,
    "linkedin": 3105,
}

# ── Service Ports (Comment adapters) ─────────────────────────────────────────

COMMENT_SERVICE_PORTS = {
    "instagram": 3005,
    "twitter": 3007,
    "tiktok": 3006,
    "threads": 3004,
}

MARKET_RESEARCH_PORT = 3106

# ── Daily Caps ────────────────────────────────────────────────────────────────

DEFAULT_DAILY_CAPS = {
    ("dm", "instagram"): 20,
    ("dm", "twitter"): 50,
    ("dm", "tiktok"): 30,
    ("dm", "linkedin"): 50,
    ("comment", "instagram"): 25,
    ("comment", "twitter"): 40,
    ("comment", "tiktok"): 25,
    ("comment", "threads"): 30,
    ("email", "email"): 30,
}

# ── Pipeline Stage Transitions ───────────────────────────────────────────────

PIPELINE_STAGES = [
    "new",
    "qualified",
    "warming",
    "ready_for_dm",
    "contacted",
    "follow_up_1",
    "follow_up_2",
    "replied",
    "call_booked",
    "closed_won",
    "closed_lost",
    "archived",
]

# Canonical transitions live in state_machine.py — this copy is kept for
# backward-compat imports.  Update both if the funnel changes.
VALID_TRANSITIONS = {
    "new":          ["qualified", "archived"],
    "qualified":    ["warming", "ready_for_dm", "archived"],
    "warming":      ["ready_for_dm", "archived"],
    "ready_for_dm": ["contacted", "archived"],
    "contacted":    ["replied", "follow_up_1", "archived"],
    "follow_up_1":  ["replied", "follow_up_2", "archived"],
    "follow_up_2":  ["replied", "archived"],
    "replied":      ["call_booked", "archived"],
    "call_booked":  ["closed_won", "closed_lost"],
    "closed_won":   [],
    "closed_lost":  ["new"],
    "archived":     ["new"],
}

# ── Claude Models ─────────────────────────────────────────────────────────────

CLAUDE_MODEL_SCORING = "claude-haiku-4-5-20251001"
CLAUDE_MODEL_GENERATION = "claude-haiku-4-5-20251001"
CLAUDE_MODEL_ENTITY = "claude-sonnet-4-5-20250929"

# ── Timing ────────────────────────────────────────────────────────────────────

WARMUP_MIN_GAP_HOURS = 12
WARMUP_WINDOW_DAYS = 5
WARMUP_COMMENTS_TARGET = 3
FOLLOWUP_1_DAYS = 4
FOLLOWUP_2_DAYS = 7
ARCHIVE_DAYS = 10
RE_ENTRY_ARCHIVED_DAYS = 180
RE_ENTRY_CLOSED_LOST_DAYS = 90
