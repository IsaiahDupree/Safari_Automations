"""
acquisition/daily_caps.py — Daily rate-limit management for outreach actions.

Wraps acq_daily_caps queries with a clean async-style interface.
Since the project uses synchronous urllib, methods here are sync
but named to match the spec's async signatures for future migration.
"""

from .db import queries


class DailyCapsManager:
    """Manages daily send caps per action type and platform."""

    def check(self, action: str, platform: str) -> bool:
        """Returns True if under limit, False if at/over limit."""
        row, err = queries.get_daily_cap(action, platform)
        if err or not row:
            return False  # Fail closed: no cap row means deny
        return row["sent_today"] < row["daily_limit"]

    def increment(self, action: str, platform: str) -> bool:
        """Increment counter. Returns True on success, False if at limit or error."""
        ok, err = queries.increment_daily_cap(action, platform)
        return ok and not err

    def reset_all(self) -> None:
        """Reset sent_today=0 for all rows. Call at midnight UTC."""
        queries.reset_daily_caps()

    def get_usage_summary(self) -> dict[str, str]:
        """Returns {platform_action: "sent/limit"} for status endpoint."""
        from .config import DEFAULT_DAILY_CAPS
        summary: dict[str, str] = {}
        for (action, platform), default_limit in DEFAULT_DAILY_CAPS.items():
            row, _ = queries.get_daily_cap(action, platform)
            if row:
                summary[f"{platform}_{action}"] = f"{row['sent_today']}/{row['daily_limit']}"
            else:
                summary[f"{platform}_{action}"] = f"0/{default_limit}"
        return summary

    def seed_defaults(self) -> None:
        """On startup: ensure all default rows exist in acq_daily_caps."""
        queries.seed_daily_caps()
