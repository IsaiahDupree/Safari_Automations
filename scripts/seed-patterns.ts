import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  'http://127.0.0.1:54321',
  process.env.CRM_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || ''
);

// Known handle mappings from instagram-api.ts
const KNOWN_HANDLES: Record<string, string> = {
  'saraheashley': 'Sarah Ashley',
  'tonygaskins': 'Tony Gaskins',
  'owentheaiguy': 'Owen',
  'day1marketing': 'Evan Dawson',
  'chase.h.ai': 'Chase AI',
  'ajla_talks': 'Ajla',
  'lucapetty': 'Luca Petty',
  'spincity_hq_': 'Spin City HQ',
  'thrive_with_angelak': 'Thrive with Angela K',
  'expand_lab': 'Expand Lab',
  'liz_elliott_ig': 'Liz Elliott',
  'sabrina_ramonov': 'Sabrina Ramonov',
  'steven_thiel': 'Steven Thiel',
  'ahmed_alassafi': 'Ahmed Alassafi',
  'tiffany_kyazze': 'Tiffany Kyazze',
};

// UI selectors
const SELECTORS = {
  'textbox': '[role="textbox"]',
  'tab': '[role="tab"]',
  'button': 'div[role="button"]',
  'send_button': 'div[role="button"]:contains("Send")',
  'message_button': 'div[role="button"]:contains("Message")',
  'conversation_label': '[aria-label*="Conversation with"]',
  'scroll_container': 'div[scrollHeight > 1500]',
};

// Skip patterns for message extraction
const SKIP_PATTERNS = {
  'date_pattern': '^\\d{1,2}/\\d{1,2}/\\d{2}',
  'handle_pattern': '^[a-z0-9._]+$',
  'time_pattern': '^\\d{1,2}:\\d{2} [AP]M$',
  'ui_elements': 'Active,Unread,View profile,See Post,Instagram,Loading...,Accept,Delete,Block',
  'attachment_indicators': 'sent an attachment,sent a voice,sent a video,messaged you about',
};

// Spam patterns
const SPAM_PATTERNS = {
  'crypto': 'bitcoin,crypto,invest now,guaranteed returns',
  'adult': 'onlyfans,18+,adult content',
  'scam': 'wire transfer,send money,urgent,lottery winner',
};

async function seedPatterns() {
  console.log('🌱 Seeding automation patterns to database...\n');

  // First, create the table if it doesn't exist
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS automation_patterns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_type TEXT NOT NULL,
      pattern_key TEXT NOT NULL,
      pattern_value TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(pattern_type, pattern_key)
    );
  `;
  
  // Try to create table via RPC or just insert
  let inserted = 0;

  // Seed known handles
  console.log('📇 Seeding known handles...');
  for (const [handle, displayName] of Object.entries(KNOWN_HANDLES)) {
    const { error } = await supabase
      .from('automation_patterns')
      .upsert({
        pattern_type: 'known_handle',
        pattern_key: handle,
        pattern_value: displayName,
        metadata: { source: 'instagram-api.ts' }
      }, { onConflict: 'pattern_type,pattern_key' });
    
    if (!error) inserted++;
  }
  console.log(`   ✅ ${inserted} known handles`);

  // Seed selectors
  inserted = 0;
  console.log('🎯 Seeding UI selectors...');
  for (const [name, selector] of Object.entries(SELECTORS)) {
    const { error } = await supabase
      .from('automation_patterns')
      .upsert({
        pattern_type: 'selector',
        pattern_key: name,
        pattern_value: selector,
        metadata: { source: 'FUNDAMENTAL_PATTERNS.md' }
      }, { onConflict: 'pattern_type,pattern_key' });
    
    if (!error) inserted++;
  }
  console.log(`   ✅ ${inserted} selectors`);

  // Seed skip patterns
  inserted = 0;
  console.log('⏭️ Seeding skip patterns...');
  for (const [name, pattern] of Object.entries(SKIP_PATTERNS)) {
    const { error } = await supabase
      .from('automation_patterns')
      .upsert({
        pattern_type: 'skip_pattern',
        pattern_key: name,
        pattern_value: pattern,
        metadata: { source: 'extract-tab-dms.ts' }
      }, { onConflict: 'pattern_type,pattern_key' });
    
    if (!error) inserted++;
  }
  console.log(`   ✅ ${inserted} skip patterns`);

  // Seed spam patterns
  inserted = 0;
  console.log('🚫 Seeding spam patterns...');
  for (const [name, pattern] of Object.entries(SPAM_PATTERNS)) {
    const { error } = await supabase
      .from('automation_patterns')
      .upsert({
        pattern_type: 'spam_pattern',
        pattern_key: name,
        pattern_value: pattern,
        metadata: { source: 'INSTAGRAM_DM_SELECTORS.md' }
      }, { onConflict: 'pattern_type,pattern_key' });
    
    if (!error) inserted++;
  }
  console.log(`   ✅ ${inserted} spam patterns`);

  // Count total
  const { count } = await supabase
    .from('automation_patterns')
    .select('*', { count: 'exact', head: true });

  console.log(`\n📊 Total patterns in database: ${count || 0}`);
}

// Get patterns from database
async function getPatterns(type?: string) {
  let query = supabase
    .from('automation_patterns')
    .select('*')
    .eq('is_active', true);
  
  if (type) {
    query = query.eq('pattern_type', type);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching patterns:', error.message);
    return [];
  }
  
  return data;
}

// CLI
const command = process.argv[2];

if (command === 'seed') {
  seedPatterns();
} else if (command === 'list') {
  const type = process.argv[3];
  getPatterns(type).then(patterns => {
    console.log('\n📋 Patterns in database:\n');
    for (const p of patterns) {
      console.log(`  [${p.pattern_type}] ${p.pattern_key} = ${p.pattern_value.substring(0, 50)}`);
    }
    console.log(`\n  Total: ${patterns.length}`);
  });
} else {
  console.log('Usage:');
  console.log('  npx tsx scripts/seed-patterns.ts seed     - Seed patterns to database');
  console.log('  npx tsx scripts/seed-patterns.ts list     - List all patterns');
  console.log('  npx tsx scripts/seed-patterns.ts list known_handle - List by type');
}

export { getPatterns, KNOWN_HANDLES, SELECTORS, SKIP_PATTERNS, SPAM_PATTERNS };
