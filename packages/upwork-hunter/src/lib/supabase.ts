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
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
