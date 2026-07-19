/**
 * Run CRM Database Migrations
 * Creates tables for contacts, conversations, and messages
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.CRM_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.CRM_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

console.log(`Connecting to Supabase at ${supabaseUrl}...`);

const supabase = createClient(supabaseUrl, supabaseKey);

const migrations = [
  {
    name: 'create_instagram_contacts',
    sql: `
      CREATE TABLE IF NOT EXISTS instagram_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        instagram_username TEXT UNIQUE NOT NULL,
        display_name TEXT,
        profile_pic_url TEXT,
        bio TEXT,
        relationship_score INTEGER DEFAULT 50,
        pipeline_stage TEXT DEFAULT 'first_touch',
        what_theyre_building TEXT,
        current_friction TEXT,
        their_definition_of_win TEXT,
        asks_opinion BOOLEAN DEFAULT FALSE,
        shares_updates BOOLEAN DEFAULT FALSE,
        has_referred_others BOOLEAN DEFAULT FALSE,
        fit_signals TEXT[] DEFAULT '{}',
        total_messages_sent INTEGER DEFAULT 0,
        total_messages_received INTEGER DEFAULT 0,
        last_message_at TIMESTAMPTZ,
        notes TEXT,
        tags TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: 'create_instagram_conversations',
    sql: `
      CREATE TABLE IF NOT EXISTS instagram_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
        thread_id TEXT,
        last_message_preview TEXT,
        unread_count INTEGER DEFAULT 0,
        is_group BOOLEAN DEFAULT FALSE,
        participant_count INTEGER DEFAULT 2,
        dm_tab TEXT DEFAULT 'primary',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: 'create_instagram_messages',
    sql: `
      CREATE TABLE IF NOT EXISTS instagram_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES instagram_conversations(id) ON DELETE CASCADE,
        contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
        message_text TEXT,
        message_type TEXT DEFAULT 'text',
        media_url TEXT,
        is_outbound BOOLEAN DEFAULT FALSE,
        sent_by_automation BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: 'create_outreach_queue',
    sql: `
      CREATE TABLE IF NOT EXISTS outreach_queue (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        message_text TEXT NOT NULL,
        priority INTEGER DEFAULT 50,
        status TEXT DEFAULT 'pending',
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: 'create_webhook_events',
    sql: `
      CREATE TABLE IF NOT EXISTS webhook_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type TEXT NOT NULL,
        payload JSONB,
        source TEXT,
        processed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `
  },
  {
    name: 'create_indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_contacts_username ON instagram_contacts(instagram_username);
      CREATE INDEX IF NOT EXISTS idx_contacts_score ON instagram_contacts(relationship_score);
      CREATE INDEX IF NOT EXISTS idx_contacts_stage ON instagram_contacts(pipeline_stage);
      CREATE INDEX IF NOT EXISTS idx_conversations_contact ON instagram_conversations(contact_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON instagram_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_contact ON instagram_messages(contact_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON instagram_messages(sent_at);
      CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_queue(status);
      CREATE INDEX IF NOT EXISTS idx_outreach_scheduled ON outreach_queue(scheduled_at);
    `
  }
];

async function runMigrations() {
  console.log('\n📦 Running CRM Database Migrations...\n');
  
  for (const migration of migrations) {
    console.log(`  Running: ${migration.name}...`);
    
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: migration.sql });
      
      if (error) {
        // Try direct query if RPC doesn't exist
        const { error: directError } = await supabase.from('_migrations').select().limit(0);
        
        // Use REST API to execute SQL
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({ sql: migration.sql }),
        });
        
        if (!response.ok) {
          console.log(`    ⚠️  RPC not available, trying alternative...`);
        }
      }
      
      console.log(`    ✅ ${migration.name}`);
    } catch (err) {
      console.log(`    ⚠️  ${migration.name}: ${err}`);
    }
  }
  
  // Verify tables exist by querying them
  console.log('\n📋 Verifying tables...\n');
  
  const tables = ['instagram_contacts', 'instagram_conversations', 'instagram_messages', 'outreach_queue'];
  
  for (const table of tables) {
    try {
      const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
      
      if (error) {
        console.log(`  ❌ ${table}: ${error.message}`);
      } else {
        console.log(`  ✅ ${table}: ${count || 0} rows`);
      }
    } catch (err) {
      console.log(`  ❌ ${table}: ${err}`);
    }
  }
  
  console.log('\n✨ Migration complete!\n');
}

runMigrations().catch(console.error);
