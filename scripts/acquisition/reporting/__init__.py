"""
acquisition/reporting — Pipeline analytics and reporting components.

This package contains the reporting agent (AAG-10) that generates weekly
pipeline performance reports, tracks A/B variants, calculates conversion rates,
and auto-applies data-backed recommendations.

Modules:
    stats_collector: Collect weekly pipeline metrics
    insight_generator: Generate Claude-powered insights
    formatter: Format reports as markdown/HTML
"""
from .stats_collector import WeeklyStats, collect_weekly_stats, get_conversion_rates
from .insight_generator import Insight, generate_insights, update_variant_performance, auto_apply_insights
from .formatter import format_markdown, format_html, format_text_summary

__all__ = [
    # Stats collection
    'WeeklyStats',
    'collect_weekly_stats',
    'get_conversion_rates',

    # Insights
    'Insight',
    'generate_insights',
    'update_variant_performance',
    'auto_apply_insights',

    # Formatting
    'format_markdown',
    'format_html',
    'format_text_summary',
]
