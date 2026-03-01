-- 003_score_history.sql
-- Add ICP scoring tables and columns for AAG Agent 03
-- PRD-023: ICP Scoring
--
-- Run: psql $DATABASE_URL -f 003_score_history.sql
-- Or via Supabase SQL Editor

BEGIN;

-- Add relationship_score column to crm_contacts
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS relationship_score integer;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS last_scored_at timestamptz;

-- Score history table
CREATE TABLE IF NOT EXISTS crm_score_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      uuid NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
    score           integer NOT NULL CHECK (score >= 0 AND score <= 100),
    reasoning       text,
    signals         text[] DEFAULT '{}',
    model_used      text NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
    scored_at       timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_score_history_contact ON crm_score_history(contact_id);
CREATE INDEX IF NOT EXISTS idx_score_history_scored_at ON crm_score_history(scored_at DESC);

-- Index for re-scoring queries
CREATE INDEX IF NOT EXISTS idx_crm_contacts_last_scored ON crm_contacts(last_scored_at) WHERE last_scored_at IS NOT NULL;

COMMIT;
