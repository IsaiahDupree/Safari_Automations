"""
acquisition/seed_acquisition_workflow.py — Seed the acquisition DAG workflow definition.

Inserts the 'autonomous-acquisition' workflow into actp_workflow_definitions
with a 7-step DAG as specified in PRD-025.

Usage:
    python3 -m acquisition.seed_acquisition_workflow
"""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from acquisition.db import queries


WORKFLOW_DEFINITION = {
    "name": "autonomous-acquisition",
    "version": "1.0.0",
    "description": "Full acquisition pipeline: discovery → scoring → warmup → outreach → follow-up → reporting",
    "steps": [
        {
            "id": "discovery",
            "task_type": "acquisition_discovery",
            "description": "Scan platforms for new prospects matching niche configs",
            "depends_on": [],
        },
        {
            "id": "entity_resolution",
            "task_type": "acquisition_entity_resolution",
            "description": "Link cross-platform profiles for new contacts",
            "depends_on": ["discovery"],
        },
        {
            "id": "scoring",
            "task_type": "icp_scoring",
            "description": "Score contacts with Claude Haiku against ICP criteria",
            "depends_on": ["discovery"],
        },
        {
            "id": "warmup",
            "task_type": "engagement_warmup",
            "description": "Schedule and send warmup comments on prospect posts",
            "depends_on": ["scoring"],
        },
        {
            "id": "outreach",
            "task_type": "dm_outreach",
            "description": "Send personalized DMs to warmed-up contacts",
            "depends_on": ["warmup"],
        },
        {
            "id": "followup",
            "task_type": "followup_sequence",
            "description": "Detect replies, schedule follow-ups, notify humans",
            "depends_on": ["outreach"],
        },
        {
            "id": "report",
            "task_type": "pipeline_report",
            "description": "Generate weekly pipeline performance report",
            "depends_on": [],
        },
    ],
    "schedule": {
        "discovery": "0 6 * * *",
        "entity_resolution": "30 6 * * *",
        "scoring": "0 7 * * *",
        "warmup": "0 8 * * *",
        "outreach": "0 9 * * *",
        "followup": "0 */4 * * *",
        "report": "0 9 * * 1",
    },
}


def seed_workflow() -> dict:
    """Insert or update the acquisition workflow definition."""
    row = {
        "name": WORKFLOW_DEFINITION["name"],
        "version": WORKFLOW_DEFINITION["version"],
        "definition": json.dumps(WORKFLOW_DEFINITION),
        "is_active": True,
    }
    count, err = queries._upsert("actp_workflow_definitions", [row], on_conflict="name")
    if err:
        return {"error": err}
    return {"seeded": "autonomous-acquisition", "steps": len(WORKFLOW_DEFINITION["steps"])}


if __name__ == "__main__":
    result = seed_workflow()
    print(json.dumps(result, indent=2))
