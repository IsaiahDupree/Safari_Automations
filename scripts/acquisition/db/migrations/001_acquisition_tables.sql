-- 001_acquisition_tables.sql
-- All acquisition tables for the Autonomous Acquisition Agent system
-- PRD-022 through PRD-028
--
-- Run: psql $DATABASE_URL -f 001_acquisition_tables.sql
-- Or via Supabase SQL Editor

BEGIN;

-- ─── PRD-022: Discovery ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_niche_configs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL UNIQUE,
    service_slug    text NOT NULL,
    platforms       text[] NOT NULL DEFAULT '{}',
    keywords        text[] NOT NULL DEFAULT '{}',
    icp_min_score   integer NOT NULL DEFAULT 65,
    skip_warmup_min_score integer DEFAULT 85,
    scoring_prompt  text,
    max_weekly      integer DEFAULT 100,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acq_discovery_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    niche_config_id uuid REFERENCES acq_niche_configs(id),
    platform        text NOT NULL,
    keyword         text NOT NULL,
    discovered      integer NOT NULL DEFAULT 0,
    deduplicated    integer NOT NULL DEFAULT 0,
    seeded          integer NOT NULL DEFAULT 0,
    errors          jsonb DEFAULT '[]',
    duration_ms     integer,
    run_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── PRD-023: Warmup ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_warmup_configs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    niche_config_id     uuid REFERENCES acq_niche_configs(id),
    comments_target     integer NOT NULL DEFAULT 3,
    window_days         integer NOT NULL DEFAULT 5,
    min_gap_hours       integer NOT NULL DEFAULT 12,
    use_ai_comments     boolean NOT NULL DEFAULT true,
    comment_tone        text DEFAULT 'friendly-insightful',
    platforms_priority  text[] DEFAULT '{instagram,twitter,tiktok}',
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acq_warmup_schedules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    platform        text NOT NULL,
    post_url        text,
    scheduled_at    timestamptz NOT NULL,
    comment_text    text,
    sent_at         timestamptz,
    comment_id      text,
    status          text NOT NULL DEFAULT 'pending',
    skip_reason     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_warmup_schedules_contact ON acq_warmup_schedules(contact_id);
CREATE INDEX IF NOT EXISTS idx_warmup_schedules_status ON acq_warmup_schedules(status, scheduled_at);

-- ─── PRD-024: Outreach & Follow-up ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_outreach_sequences (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    service_slug    text NOT NULL,
    touch_number    integer NOT NULL DEFAULT 1,
    message_text    text NOT NULL,
    platform        text NOT NULL,
    scheduled_at    timestamptz NOT NULL,
    sent_at         timestamptz,
    message_id      uuid,
    status          text NOT NULL DEFAULT 'pending',
    skip_reason     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_contact ON acq_outreach_sequences(contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status ON acq_outreach_sequences(status, scheduled_at);

CREATE TABLE IF NOT EXISTS acq_human_notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    trigger         text NOT NULL,
    summary         text NOT NULL,
    context_url     text,
    notified_via    text[] DEFAULT '{}',
    notified_at     timestamptz,
    actioned_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── PRD-025: Orchestrator ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_daily_caps (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type     text NOT NULL,
    platform        text NOT NULL,
    daily_limit     integer NOT NULL,
    sent_today      integer NOT NULL DEFAULT 0,
    reset_at        timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(action_type, platform)
);

CREATE TABLE IF NOT EXISTS acq_funnel_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    from_stage      text,
    to_stage        text NOT NULL,
    triggered_by    text NOT NULL,
    metadata        jsonb DEFAULT '{}',
    occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_contact ON acq_funnel_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_occurred ON acq_funnel_events(occurred_at DESC);

-- ─── PRD-026: Reporting ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_weekly_reports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start          date NOT NULL,
    week_end            date NOT NULL,
    discovered          integer NOT NULL DEFAULT 0,
    qualified           integer NOT NULL DEFAULT 0,
    warmup_sent         integer NOT NULL DEFAULT 0,
    dms_sent            integer NOT NULL DEFAULT 0,
    replies_received    integer NOT NULL DEFAULT 0,
    calls_booked        integer NOT NULL DEFAULT 0,
    closed_won          integer NOT NULL DEFAULT 0,
    qualify_rate        numeric(5,2) DEFAULT 0,
    reply_rate          numeric(5,2) DEFAULT 0,
    close_rate          numeric(5,2) DEFAULT 0,
    top_platform        text,
    top_niche           text,
    insights            jsonb DEFAULT '{}',
    report_md           text,
    delivered_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acq_message_variants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_name    text NOT NULL,
    service_slug    text NOT NULL,
    touch_number    integer NOT NULL DEFAULT 1,
    template_text   text NOT NULL,
    sends           integer NOT NULL DEFAULT 0,
    replies         integer NOT NULL DEFAULT 0,
    reply_rate      numeric(5,2) DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── PRD-027: Email ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_email_sequences (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    service_slug    text NOT NULL,
    touch_number    integer NOT NULL DEFAULT 1,
    subject         text NOT NULL,
    body_text       text,
    body_html       text,
    from_email      text NOT NULL,
    to_email        text NOT NULL,
    scheduled_at    timestamptz NOT NULL,
    sent_at         timestamptz,
    opened_at       timestamptz,
    clicked_at      timestamptz,
    resend_id       text,
    status          text NOT NULL DEFAULT 'pending',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_sequences_contact ON acq_email_sequences(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_status ON acq_email_sequences(status, scheduled_at);

CREATE TABLE IF NOT EXISTS acq_email_discoveries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    email           text NOT NULL,
    source          text NOT NULL,
    confidence      numeric(3,2) DEFAULT 0.5,
    verified        boolean DEFAULT false,
    mx_valid        boolean,
    discovered_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_discoveries_contact ON acq_email_discoveries(contact_id);

CREATE TABLE IF NOT EXISTS acq_email_unsubscribes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email           text NOT NULL UNIQUE,
    contact_id      uuid,
    reason          text,
    unsubscribed_at timestamptz NOT NULL DEFAULT now()
);

-- ─── PRD-028: Entity Resolution ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_entity_associations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id          uuid NOT NULL,
    known_platform      text NOT NULL,
    known_handle        text NOT NULL,
    found_platform      text NOT NULL,
    found_handle        text NOT NULL,
    found_url           text,
    association_type    text NOT NULL DEFAULT 'inferred',
    confidence          numeric(3,2) DEFAULT 0.5,
    confirmed           boolean DEFAULT false,
    evidence_sources    text[] DEFAULT '{}',
    claude_reasoning    text,
    resolved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_assoc_contact ON acq_entity_associations(contact_id);

CREATE TABLE IF NOT EXISTS acq_resolution_runs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id              uuid NOT NULL,
    associations_found      integer NOT NULL DEFAULT 0,
    associations_confirmed  integer NOT NULL DEFAULT 0,
    platforms_resolved      text[] DEFAULT '{}',
    email_found             boolean DEFAULT false,
    linkedin_found          boolean DEFAULT false,
    duration_ms             integer,
    run_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS acq_resolution_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL,
    priority        integer NOT NULL DEFAULT 5,
    queued_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resolution_queue_priority ON acq_resolution_queue(priority, queued_at);

-- ─── PRD-025: System State (pause/resume) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_system_state (
    key         text PRIMARY KEY,
    value       text,
    updated_at  timestamptz DEFAULT now()
);

INSERT INTO acq_system_state(key, value) VALUES ('acquisition_paused', 'false') ON CONFLICT DO NOTHING;

-- ─── PRD-028: API Usage Tracking ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS acq_api_usage (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    api_name        text NOT NULL,
    request_count   integer NOT NULL DEFAULT 1,
    estimated_cost_usd numeric(10,4) DEFAULT 0,
    date            date NOT NULL DEFAULT current_date,
    UNIQUE(api_name, date)
);

COMMIT;
