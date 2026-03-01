"""
acquisition/api/routes/reports.py — REST API endpoints for pipeline reporting.

Provides HTTP endpoints for generating reports, viewing analytics,
and applying insights.
"""
from datetime import datetime, date, timedelta
from typing import Optional

from ...reporting import stats_collector, insight_generator, formatter
from ...reporting_agent import generate_report, apply_insights
from ...db import queries


# ──────────────────────────────────────────────────────────────────────────────
# Route Handlers (FastAPI-style, adaptable to Flask/other frameworks)
# ──────────────────────────────────────────────────────────────────────────────

def get_latest_report() -> dict:
    """
    GET /api/reports/latest

    Returns the most recent weekly report.
    """
    report, err = queries.get_latest_report()
    if err:
        return {"error": err}, 500
    if not report:
        return {"error": "No reports found"}, 404
    return report, 200


def post_generate_report(week_start: Optional[str] = None, deliver: bool = False, dry_run: bool = False) -> dict:
    """
    POST /api/reports/generate

    Generate a new weekly report.

    Query params:
        week_start: YYYY-MM-DD (defaults to last Monday)
        deliver: bool (default False)
        dry_run: bool (default False)

    Returns:
        Report data with markdown, HTML, stats, and insights
    """
    # Parse week_start
    if week_start:
        try:
            ws = date.fromisoformat(week_start)
        except ValueError:
            return {"error": f"Invalid date format: {week_start}"}, 400
    else:
        # Default to last Monday
        today = date.today()
        days_since_monday = today.weekday()
        ws = today - timedelta(days=days_since_monday)

    # Generate report
    result = generate_report(ws, deliver=deliver, dry_run=dry_run)

    if "error" in result:
        return {"error": result["error"]}, 500

    return result, 200


def get_conversion_rates(days: int = 30) -> dict:
    """
    GET /api/reports/analytics/conversion

    Calculate stage-to-stage conversion rates.

    Query params:
        days: Look back this many days (default 30)

    Returns:
        Conversion rates for each stage transition
    """
    if not (1 <= days <= 365):
        return {"error": "days must be between 1 and 365"}, 400

    rates, err = stats_collector.get_conversion_rates(since_days=days)
    if err:
        return {"error": err}, 500

    return rates, 200


def get_variant_performance() -> dict:
    """
    GET /api/reports/analytics/variants

    Get performance metrics for all message variants.

    Returns:
        List of variants with sends, replies, and reply_rate
    """
    variants, err = queries.get_variant_performance()
    if err:
        return {"error": err}, 500

    return {"variants": variants}, 200


def post_apply_insights(dry_run: bool = True) -> dict:
    """
    POST /api/reports/analytics/apply-insights

    Auto-apply high-confidence insights from latest report.

    Query params:
        dry_run: bool (default True)

    Returns:
        List of changes applied or that would be applied
    """
    result = apply_insights(dry_run=dry_run)

    if "error" in result:
        return {"error": result["error"]}, 500

    return result, 200


def get_weekly_stats(week_start: str) -> dict:
    """
    GET /api/reports/stats/<week_start>

    Get raw weekly statistics without generating a full report.

    Path params:
        week_start: YYYY-MM-DD

    Returns:
        WeeklyStats as JSON
    """
    try:
        ws = date.fromisoformat(week_start)
    except ValueError:
        return {"error": f"Invalid date format: {week_start}"}, 400

    stats, err = stats_collector.collect_weekly_stats(ws)
    if err:
        return {"error": err}, 500

    return stats.to_dict(), 200


def update_variant_tracking() -> dict:
    """
    POST /api/reports/analytics/update-variants

    Update variant performance tracking and flag winners.

    Returns:
        List of actions taken
    """
    actions, err = insight_generator.update_variant_performance()
    if err:
        return {"error": err}, 500

    return {
        "actions": actions,
        "message": f"{len(actions)} actions taken" if actions else "No changes needed"
    }, 200


# ──────────────────────────────────────────────────────────────────────────────
# Route registration helpers (for FastAPI, Flask, etc.)
# ──────────────────────────────────────────────────────────────────────────────

# Example FastAPI registration:
# from fastapi import APIRouter, Query
#
# router = APIRouter(prefix="/api/reports", tags=["reports"])
#
# @router.get("/latest")
# def latest():
#     result, status = get_latest_report()
#     return result
#
# @router.post("/generate")
# def generate(week_start: Optional[str] = None, deliver: bool = False, dry_run: bool = False):
#     result, status = post_generate_report(week_start, deliver, dry_run)
#     return result
#
# @router.get("/analytics/conversion")
# def conversion(days: int = Query(30, ge=1, le=365)):
#     result, status = get_conversion_rates(days)
#     return result
#
# @router.get("/analytics/variants")
# def variants():
#     result, status = get_variant_performance()
#     return result
#
# @router.post("/analytics/apply-insights")
# def apply(dry_run: bool = True):
#     result, status = post_apply_insights(dry_run)
#     return result
#
# @router.get("/stats/{week_start}")
# def stats(week_start: str):
#     result, status = get_weekly_stats(week_start)
#     return result
#
# @router.post("/analytics/update-variants")
# def update_variants():
#     result, status = update_variant_tracking()
#     return result


# Example Flask registration:
# from flask import Blueprint, request, jsonify
#
# reports_bp = Blueprint('reports', __name__, url_prefix='/api/reports')
#
# @reports_bp.route('/latest', methods=['GET'])
# def latest():
#     result, status = get_latest_report()
#     return jsonify(result), status
#
# @reports_bp.route('/generate', methods=['POST'])
# def generate():
#     week_start = request.args.get('week_start')
#     deliver = request.args.get('deliver', 'false').lower() == 'true'
#     dry_run = request.args.get('dry_run', 'false').lower() == 'true'
#     result, status = post_generate_report(week_start, deliver, dry_run)
#     return jsonify(result), status
#
# @reports_bp.route('/analytics/conversion', methods=['GET'])
# def conversion():
#     days = int(request.args.get('days', 30))
#     result, status = get_conversion_rates(days)
#     return jsonify(result), status
#
# @reports_bp.route('/analytics/variants', methods=['GET'])
# def variants():
#     result, status = get_variant_performance()
#     return jsonify(result), status
#
# @reports_bp.route('/analytics/apply-insights', methods=['POST'])
# def apply():
#     dry_run = request.args.get('dry_run', 'true').lower() == 'true'
#     result, status = post_apply_insights(dry_run)
#     return jsonify(result), status
#
# @reports_bp.route('/stats/<week_start>', methods=['GET'])
# def stats(week_start):
#     result, status = get_weekly_stats(week_start)
#     return jsonify(result), status
#
# @reports_bp.route('/analytics/update-variants', methods=['POST'])
# def update_variants():
#     result, status = update_variant_tracking()
#     return jsonify(result), status
