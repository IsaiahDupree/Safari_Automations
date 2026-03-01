"""
acquisition/cron_definitions.py — Cron schedule definitions for acquisition agents.

All 9 acquisition cron jobs + weekly report, gated by ENABLE_ACQUISITION.
Uses APScheduler CronTrigger-compatible schedule strings.
"""

from dataclasses import dataclass


@dataclass
class CronJob:
    name: str
    schedule: str       # cron expression: "min hour day month weekday"
    step: str           # maps to AcquisitionOrchestrator.run_step(step)
    description: str = ""


# ── Acquisition Crons (all gated by ENABLE_ACQUISITION) ─────────────────────

ACQUISITION_CRONS: list[CronJob] = [
    CronJob("acquisition_discovery",      "0 6 * * *",   "discovery",
            "Find 20-50 new prospects from configured niches"),
    CronJob("acquisition_entity",         "30 6 * * *",  "entity_resolve",
            "Link cross-platform profiles for new contacts"),
    CronJob("acquisition_scoring",        "0 7 * * *",   "scoring",
            "ICP score unscored contacts with Claude Haiku"),
    CronJob("acquisition_email_disc",     "30 7 * * *",  "email_discover",
            "Find verified email addresses for qualified contacts"),
    CronJob("acquisition_warmup_sched",   "0 8 * * *",   "warmup_schedule",
            "Plan today's warmup comments"),
    CronJob("acquisition_warmup_exec",    "30 8 * * *",  "warmup_execute",
            "Send scheduled warmup comments"),
    CronJob("acquisition_outreach",       "0 9 * * *",   "outreach",
            "Send first DMs to ready contacts"),
    CronJob("acquisition_email_send",     "30 9 * * *",  "email_send",
            "Send pending email sequences"),
    CronJob("acquisition_sync_followup",  "0 */4 * * *", "sync_followup",
            "Sync inboxes, detect replies, schedule follow-ups"),
    CronJob("acquisition_report",         "0 9 * * 1",   "report",
            "Generate and deliver weekly pipeline report (Mondays)"),
]


def get_cron_by_name(name: str) -> CronJob | None:
    for cron in ACQUISITION_CRONS:
        if cron.name == name:
            return cron
    return None


def get_cron_by_step(step: str) -> CronJob | None:
    for cron in ACQUISITION_CRONS:
        if cron.step == step:
            return cron
    return None
