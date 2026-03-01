#!/usr/bin/env python3
"""
acquisition/reporting_agent.py — AAG Agent 10: Pipeline Analytics & Reporting Agent.

Generates weekly pipeline performance reports, tracks A/B variants, calculates
conversion rates, delivers reports via email + push + Obsidian, and auto-applies
data-backed recommendations.

Usage:
    python3 reporting_agent.py --generate              # Generate and print report
    python3 reporting_agent.py --deliver               # Generate + deliver report
    python3 reporting_agent.py --week 2026-02-24       # Specific week
    python3 reporting_agent.py --dry-run               # Preview without saving
    python3 reporting_agent.py --apply-insights        # Auto-apply recommendations
"""
import argparse
import sys
import os
import subprocess
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

from .reporting import stats_collector, insight_generator, formatter
from .db import queries
from .config import OWNER_EMAIL


def send_report_email(week_start: date, report_html: str, report_md: str) -> tuple[bool, str]:
    """
    Send weekly report via Mail.app using AppleScript.

    Args:
        week_start: Start date of the week
        report_html: HTML version of the report
        report_md: Markdown version (used as fallback)

    Returns:
        (success, error_message)
    """
    if not OWNER_EMAIL:
        return False, "OWNER_EMAIL not configured"

    week_str = week_start.strftime("%b %d, %Y")
    subject = f"📊 Weekly Acquisition Report — Week of {week_str}"

    # Use HTML if available, otherwise markdown
    body = report_html if report_html else report_md

    # AppleScript to send email via Mail.app
    script = f'''
tell application "Mail"
    set newMessage to make new outgoing message with properties {{subject:"{subject}", content:"{body}", visible:true}}
    tell newMessage
        make new to recipient at end of to recipients with properties {{address:"{OWNER_EMAIL}"}}
    end tell
    -- Auto-send: send newMessage
end tell
'''

    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=30
        )
        if result.returncode != 0:
            return False, f"AppleScript error: {result.stderr}"
        return True, "Email draft created in Mail.app"
    except Exception as e:
        return False, str(e)


def send_push_notification(summary: str, title: str = "Weekly Acquisition Report") -> tuple[bool, str]:
    """
    Send macOS push notification.

    Args:
        summary: Short summary text
        title: Notification title

    Returns:
        (success, error_message)
    """
    script = f'''display notification "{summary}" with title "{title}" sound name "default"'''

    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode != 0:
            return False, f"Notification error: {result.stderr}"
        return True, "Push notification sent"
    except Exception as e:
        return False, str(e)


def write_to_obsidian(week_start: date, report_md: str) -> tuple[bool, str]:
    """
    Write report to Obsidian vault as a daily note.

    Args:
        week_start: Start date of the week
        report_md: Markdown report content

    Returns:
        (success, error_message)
    """
    vault_path = Path.home() / ".memory" / "vault"
    daily_notes_dir = vault_path / "DAILY-NOTES"

    if not vault_path.exists():
        return False, f"Obsidian vault not found at {vault_path}"

    # Create daily notes directory if it doesn't exist
    daily_notes_dir.mkdir(parents=True, exist_ok=True)

    # Generate filename
    filename = f"{week_start.isoformat()}-acquisition-report.md"
    report_path = daily_notes_dir / filename

    try:
        with open(report_path, 'w') as f:
            f.write(report_md)
        return True, f"Report written to {report_path}"
    except Exception as e:
        return False, str(e)


def deliver_report(week_start: date, report_md: str, report_html: str, stats: stats_collector.WeeklyStats) -> dict:
    """
    Deliver report via all channels: email, push, Obsidian, and database.

    Args:
        week_start: Start date of the week
        report_md: Markdown report
        report_html: HTML report
        stats: Weekly statistics

    Returns:
        dict with delivery results for each channel
    """
    results = {}

    # 1. Email via Mail.app
    success, msg = send_report_email(week_start, report_html, report_md)
    results["email"] = {"success": success, "message": msg}

    # 2. Push notification
    summary = formatter.format_text_summary(stats)
    success, msg = send_push_notification(summary)
    results["push"] = {"success": success, "message": msg}

    # 3. Obsidian vault
    success, msg = write_to_obsidian(week_start, report_md)
    results["obsidian"] = {"success": success, "message": msg}

    # 4. Store in database
    report_data = {
        "week_start": week_start.isoformat(),
        "week_end": (week_start + timedelta(days=7)).isoformat(),
        "report_md": report_md,
        "report_html": report_html,
        "stats": stats.to_dict(),
        "delivered_at": datetime.now(timezone.utc).isoformat(),
    }
    _, err = queries.insert_weekly_report(report_data)
    results["database"] = {
        "success": err is None,
        "message": "Stored in acq_weekly_reports" if err is None else f"Error: {err}"
    }

    return results


def generate_report(week_start: date, deliver: bool = False, dry_run: bool = False) -> dict:
    """
    Main report generation orchestrator.

    Args:
        week_start: Start date of the week
        deliver: If True, deliver report via all channels
        dry_run: If True, don't save anything

    Returns:
        dict with report content and metadata
    """
    print(f"📊 Generating report for week of {week_start.strftime('%b %d, %Y')}...")

    # Step 1: Collect statistics
    print("  → Collecting weekly statistics...")
    stats, err = stats_collector.collect_weekly_stats(week_start)
    if err:
        return {"error": err}

    # Step 2: Generate insights using Claude
    print("  → Generating insights with Claude...")
    insights, err = insight_generator.generate_insights(stats)
    if err:
        print(f"  ⚠️  Insight generation failed: {err}")
        insights = []

    # Step 3: Format reports
    print("  → Formatting reports...")
    report_md = formatter.format_markdown(stats, insights)
    report_html = formatter.format_html(stats, insights)

    # Step 4: Deliver if requested
    delivery_results = {}
    if deliver and not dry_run:
        print("  → Delivering report...")
        delivery_results = deliver_report(week_start, report_md, report_html, stats)

        # Print delivery results
        for channel, result in delivery_results.items():
            status = "✅" if result["success"] else "❌"
            print(f"    {status} {channel}: {result['message']}")

    return {
        "week_start": week_start.isoformat(),
        "week_end": (week_start + timedelta(days=7)).isoformat(),
        "stats": stats.to_dict(),
        "insights": [i.to_dict() for i in insights],
        "report_md": report_md,
        "report_html": report_html,
        "delivery": delivery_results,
        "dry_run": dry_run,
    }


def apply_insights(dry_run: bool = True) -> dict:
    """
    Auto-apply high-confidence insights from the latest report.

    Args:
        dry_run: If True, only show what would be applied

    Returns:
        dict with applied changes
    """
    print("🔧 Applying insights from latest report...")

    # Get latest report
    latest, err = queries.get_latest_report()
    if err or not latest:
        return {"error": err or "No reports found"}

    # Parse insights from stored report
    stats_data = latest.get("stats", {})
    insights_data = stats_data.get("insights", [])
    insights = [insight_generator.Insight(**i) for i in insights_data]

    if not insights:
        return {"message": "No insights to apply"}

    # Auto-apply insights
    print(f"  → Found {len(insights)} insights, filtering for high-confidence...")
    applied, err = insight_generator.auto_apply_insights(insights, dry_run=dry_run)
    if err:
        return {"error": err}

    mode = "would be" if dry_run else "were"
    print(f"\n  ✅ {len(applied)} changes {mode} applied:")
    for change in applied:
        print(f"    - {change}")

    return {
        "applied": applied,
        "dry_run": dry_run,
    }


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="AAG Agent 10: Pipeline Analytics & Reporting")
    parser.add_argument("--generate", action="store_true", help="Generate and print report")
    parser.add_argument("--deliver", action="store_true", help="Generate + deliver report")
    parser.add_argument("--week", type=str, help="Week start date (YYYY-MM-DD), defaults to last Monday")
    parser.add_argument("--dry-run", action="store_true", help="Preview without saving")
    parser.add_argument("--apply-insights", action="store_true", help="Auto-apply recommendations")

    args = parser.parse_args()

    # Determine week start date
    if args.week:
        try:
            week_start = date.fromisoformat(args.week)
        except ValueError:
            print(f"❌ Invalid date format: {args.week}. Use YYYY-MM-DD")
            sys.exit(1)
    else:
        # Default to last Monday
        today = date.today()
        days_since_monday = today.weekday()  # Monday is 0
        week_start = today - timedelta(days=days_since_monday)

    # Execute requested action
    if args.apply_insights:
        result = apply_insights(dry_run=args.dry_run)
        if "error" in result:
            print(f"❌ Error: {result['error']}")
            sys.exit(1)
        sys.exit(0)

    elif args.generate or args.deliver:
        result = generate_report(week_start, deliver=args.deliver, dry_run=args.dry_run)
        if "error" in result:
            print(f"❌ Error: {result['error']}")
            sys.exit(1)

        # Print report
        print("\n" + "="*80)
        print(result["report_md"])
        print("="*80)

        if args.dry_run:
            print("\n⚠️  Dry run mode: Report not saved or delivered")

        sys.exit(0)

    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
