-- 002_crm_contacts_columns.sql
-- Add acquisition columns to crm_contacts table
-- Safe: uses IF NOT EXISTS, no data loss
--
-- Run: psql $DATABASE_URL -f 002_crm_contacts_columns.sql
-- Or via Supabase SQL Editor

BEGIN;

-- Cross-platform handles (PRD-028)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS twitter_handle text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS instagram_handle text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS tiktok_handle text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS website_url text;

-- Email fields (PRD-027)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS email_source text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS active_channel text DEFAULT 'dm';
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS email_opted_out boolean DEFAULT false;

-- Entity resolution (PRD-028)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS entity_resolved boolean DEFAULT false;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS resolution_score integer;

-- Acquisition pipeline (PRD-022/025)
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS niche_label text;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS source_niche_config_id uuid;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS pipeline_stage text DEFAULT 'new';
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Indexes for common acquisition queries
CREATE INDEX IF NOT EXISTS idx_crm_contacts_pipeline_stage ON crm_contacts(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_niche ON crm_contacts(niche_label);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email) WHERE email IS NOT NULL;

COMMIT;
