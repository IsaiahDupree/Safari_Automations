import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS upwork_proposals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  job_title TEXT NOT NULL,
  job_url TEXT NOT NULL,
  job_description TEXT,
  budget TEXT,
  score INTEGER NOT NULL,
  proposal_text TEXT,
  status TEXT DEFAULT 'pending',
  offer_type TEXT,
  telegram_message_id INTEGER,
  demo_url TEXT,
  github_url TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if table already exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upwork_proposals' AND column_name='demo_url') THEN
    ALTER TABLE upwork_proposals ADD COLUMN demo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='upwork_proposals' AND column_name='github_url') THEN
    ALTER TABLE upwork_proposals ADD COLUMN github_url TEXT;
  END IF;
END $$;

-- Submission metadata columns
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS application_url TEXT;
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS submitted_connects_cost INTEGER;
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS submitted_bid_amount TEXT;
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS submitted_form_type TEXT;
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS submitted_files_count INTEGER;
ALTER TABLE upwork_proposals ADD COLUMN IF NOT EXISTS milestones_json JSONB;

-- All discovered jobs (every scan, not just ones that get proposals)
CREATE TABLE IF NOT EXISTS upwork_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  budget TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  pub_date TEXT,
  source TEXT DEFAULT 'upwork',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);
`;

export async function applyMigration(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.log('[supabase] Supabase not configured — skipping migration');
    return;
  }
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('exec_sql', { sql: MIGRATION_SQL });
    if (error) {
      console.warn('[supabase] Migration via RPC failed, table may already exist:', error.message);
    } else {
      console.log('[supabase] Migration applied successfully');
    }
  } catch (err) {
    console.warn('[supabase] Migration skipped:', err instanceof Error ? err.message : String(err));
  }
}
