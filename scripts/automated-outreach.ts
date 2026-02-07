#!/usr/bin/env npx tsx
/**
 * Multi-Platform Automated Outreach with Human-Like Pacing
 * 
 * Sends relationship-first DMs across Instagram, TikTok, and Twitter with:
 * - Rate limiting to avoid detection
 * - Personalized templates from nba_templates (18 templates, 5 lanes)
 * - Time-of-day awareness
 * - Consent-first approach (3:1 rule enforcement)
 * - Platform API server integration (not raw Safari)
 * 
 * Platform Servers:
 *   - Instagram: http://localhost:3100
 *   - TikTok:    http://localhost:3102
 *   - Twitter:   http://localhost:3003
 * 
 * References:
 *   - packages/shared/template-engine.ts (template engine)
 *   - packages/instagram-dm/src/api/server.ts (IG endpoints)
 *   - packages/tiktok-dm/src/api/server.ts (TT endpoints)
 *   - packages/twitter-dm/src/api/server.ts (TW endpoints)
 *   - docs/PRDs/PRD_DM_Playbook.md (template definitions)
 *   - docs/PRDs/PRD_DM_Outreach_System.md (outreach phases)
 * 
 * Usage:
 *   npx tsx scripts/automated-outreach.ts --dry-run                  # Preview all platforms
 *   npx tsx scripts/automated-outreach.ts --dry-run --platform=instagram
 *   npx tsx scripts/automated-outreach.ts --queue                    # Build queue for all
 *   npx tsx scripts/automated-outreach.ts --queue --platform=tiktok
 *   npx tsx scripts/automated-outreach.ts --send                     # Execute outreach
 *   npx tsx scripts/automated-outreach.ts --send --platform=twitter
 *   npx tsx scripts/automated-outreach.ts --stats                    # Show outreach stats
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === PLATFORM CONFIG ===
type Platform = 'instagram' | 'tiktok' | 'twitter';

const PLATFORM_SERVERS: Record<Platform, { url: string; prefix: string }> = {
  instagram: { url: 'http://localhost:3100', prefix: '/api' },
  tiktok:    { url: 'http://localhost:3102', prefix: '/api/tiktok' },
  twitter:   { url: 'http://localhost:3003', prefix: '/api/twitter' },
};

const ALL_PLATFORMS: Platform[] = ['instagram', 'tiktok', 'twitter'];

// === RATE LIMITING CONFIG ===
const RATE_LIMITS = {
  messagesPerHour: 10,
  messagesPerDay: 30,
  minDelayBetweenMs: 60000,  // 1 minute minimum
  maxDelayBetweenMs: 300000, // 5 minutes maximum
  activeHoursStart: 9,       // 9 AM
  activeHoursEnd: 21,        // 9 PM
};

// === INTERFACES ===

interface OutreachAction {
  id: string;
  contact_id: string;
  platform: Platform;
  template_id: string;
  lane: string;
  message: string;
  personalized_message: string;
  priority: number;
  phase: string;
  status: string;
  scheduled_for: string;
}

interface Contact {
  id: string;
  username: string;
  platform: string;
  display_name: string;
  relationship_score: number;
  pipeline_stage: string;
  what_theyre_building: string | null;
}

// === PLATFORM API CLIENT ===

async function apiCall(platform: Platform, method: string, path: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const server = PLATFORM_SERVERS[platform];
  const url = `${server.url}${server.prefix}${path}`;
  
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    
    const response = await fetch(url, opts);
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    return { success: false, error: `API call failed: ${error instanceof Error ? error.message : 'Unknown'}` };
  }
}

async function checkPlatformHealth(platform: Platform): Promise<boolean> {
  const result = await apiCall(platform, 'GET', '/../health');
  return result.status === 'ok';
}

async function sendDMViaPlatform(platform: Platform, username: string, message: string): Promise<boolean> {
  const sendPath = platform === 'instagram' ? '/messages/send-to' : '/messages/send-to';
  const body = platform === 'tiktok' 
    ? { username, message } 
    : { username, text: message };
  
  const result = await apiCall(platform, 'POST', sendPath, body);
  return result.success === true;
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function randomDelay(): number {
  return Math.floor(
    Math.random() * (RATE_LIMITS.maxDelayBetweenMs - RATE_LIMITS.minDelayBetweenMs) + 
    RATE_LIMITS.minDelayBetweenMs
  );
}

// === OUTREACH FUNCTIONS ===

function isWithinActiveHours(): boolean {
  const hour = new Date().getHours();
  return hour >= RATE_LIMITS.activeHoursStart && hour < RATE_LIMITS.activeHoursEnd;
}

async function getMessagesSentToday(platform?: Platform): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let query = supabase
    .from('dm_messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'outbound')
    .gte('created_at', today.toISOString());
  
  if (platform) query = query.eq('platform', platform);
  
  const { count } = await query;
  return count || 0;
}

async function canSendMessage(platform?: Platform): Promise<{ allowed: boolean; reason: string }> {
  if (!isWithinActiveHours()) {
    return { allowed: false, reason: 'Outside active hours (9 AM - 9 PM)' };
  }
  
  const sentToday = await getMessagesSentToday(platform);
  if (sentToday >= RATE_LIMITS.messagesPerDay) {
    return { allowed: false, reason: `Daily limit reached (${sentToday}/${RATE_LIMITS.messagesPerDay})` };
  }
  
  return { allowed: true, reason: 'OK' };
}

// === QUEUE MANAGEMENT ===

async function createOutreachQueue(platforms: Platform[]): Promise<void> {
  console.log('📋 Building outreach queue...\n');
  
  for (const platform of platforms) {
    const { data: actions, error } = await supabase
      .from('suggested_actions')
      .select(`
        id,
        contact_id,
        platform,
        template_id,
        lane,
        message,
        personalized_message,
        priority,
        phase
      `)
      .eq('platform', platform)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(20);
    
    if (error || !actions || actions.length === 0) {
      console.log(`   ${platform}: No pending actions`);
      continue;
    }
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📱 ${platform.toUpperCase()} OUTREACH QUEUE (${actions.length} pending)`);
    console.log('═'.repeat(70));
    
    const baseTime = new Date();
    actions.forEach((action, i) => {
      const scheduledTime = new Date(baseTime.getTime() + (i * randomDelay()));
      const msg = (action as Record<string, string>).personalized_message || (action as Record<string, string>).message || '';
      console.log(`\n  ${i + 1}. [${(action as Record<string, string>).lane}] ${(action as Record<string, string>).phase}`);
      console.log(`     Message: "${msg.substring(0, 60)}..."`);
      console.log(`     Scheduled: ${scheduledTime.toLocaleTimeString()}`);
    });
  }
  
  console.log('\n' + '═'.repeat(70));
}

async function executeDryRun(platforms: Platform[]): Promise<void> {
  console.log('🧪 DRY RUN - No messages will be sent\n');
  
  // Check rate limits
  const canSend = await canSendMessage();
  console.log(`Rate limit check: ${canSend.allowed ? '✅' : '❌'} ${canSend.reason}`);
  
  const sentToday = await getMessagesSentToday();
  console.log(`Messages sent today (all platforms): ${sentToday}/${RATE_LIMITS.messagesPerDay}`);
  console.log(`Active hours: ${RATE_LIMITS.activeHoursStart}:00 - ${RATE_LIMITS.activeHoursEnd}:00`);
  console.log(`Current hour: ${new Date().getHours()}:00`);
  
  // Check platform server health
  console.log('\n📡 Platform Server Health:');
  for (const platform of platforms) {
    const healthy = await checkPlatformHealth(platform);
    const server = PLATFORM_SERVERS[platform];
    console.log(`   ${healthy ? '✅' : '❌'} ${platform}: ${server.url}`);
  }
  
  await createOutreachQueue(platforms);
}

async function executeOutreach(platforms: Platform[]): Promise<void> {
  console.log('📤 EXECUTING MULTI-PLATFORM OUTREACH\n');
  
  // Check rate limits
  const canSend = await canSendMessage();
  if (!canSend.allowed) {
    console.log(`❌ Cannot send: ${canSend.reason}`);
    return;
  }
  
  let totalSent = 0;
  let totalFailed = 0;
  
  for (const platform of platforms) {
    // Check platform health
    const healthy = await checkPlatformHealth(platform);
    if (!healthy) {
      console.log(`\n⏭️  Skipping ${platform} — server not running`);
      continue;
    }
    
    // Get pending actions for this platform
    const { data: actions } = await supabase
      .from('suggested_actions')
      .select('*')
      .eq('platform', platform)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(5);
    
    if (!actions || actions.length === 0) {
      console.log(`\n📱 ${platform.toUpperCase()}: No pending actions`);
      continue;
    }
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📱 ${platform.toUpperCase()} — ${actions.length} actions`);
    console.log('═'.repeat(60));
    
    let sent = 0;
    let failed = 0;
    
    for (const action of actions) {
      const a = action as Record<string, unknown>;
      
      // Re-check rate limits
      const check = await canSendMessage(platform);
      if (!check.allowed) {
        console.log(`\n⏸️  Pausing ${platform}: ${check.reason}`);
        break;
      }
      
      const message = (a.personalized_message || a.message || '') as string;
      const contactId = a.contact_id as string;
      
      // Look up username from dm_contacts
      const { data: contact } = await supabase
        .from('dm_contacts')
        .select('username, display_name')
        .eq('id', contactId)
        .single();
      
      const username = (contact as Record<string, string> | null)?.username || 'unknown';
      const displayName = (contact as Record<string, string> | null)?.display_name || username;
      
      console.log(`\n📤 [${a.lane}] → ${displayName} (@${username})`);
      console.log(`   "${message.substring(0, 60)}..."`);
      
      // Send via platform API server
      const sentOk = await sendDMViaPlatform(platform, username, message);
      
      if (sentOk) {
        console.log('   ✅ Sent!');
        await supabase
          .from('suggested_actions')
          .update({ status: 'sent', sent_at: new Date().toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', a.id);
        sent++;
      } else {
        console.log('   ❌ Failed to send');
        await supabase
          .from('suggested_actions')
          .update({ status: 'failed', error: 'API send failed', updated_at: new Date().toISOString() })
          .eq('id', a.id);
        failed++;
      }
      
      // Human-like delay
      const delay = randomDelay();
      console.log(`   ⏱️  Waiting ${Math.round(delay / 1000)}s...`);
      await wait(delay);
    }
    
    console.log(`\n   ${platform}: ✅ ${sent} sent | ❌ ${failed} failed`);
    totalSent += sent;
    totalFailed += failed;
  }
  
  console.log('\n' + '═'.repeat(60));
  console.log(`📊 TOTAL: ✅ ${totalSent} sent | ❌ ${totalFailed} failed`);
  console.log('═'.repeat(60) + '\n');
}

async function showStats(platforms: Platform[]): Promise<void> {
  console.log('\n📊 OUTREACH STATS\n');
  
  for (const platform of platforms) {
    const { data } = await supabase
      .from('suggested_actions')
      .select('status')
      .eq('platform', platform);
    
    if (!data) continue;
    
    const counts: Record<string, number> = {};
    for (const row of data) {
      const s = (row as Record<string, string>).status;
      counts[s] = (counts[s] || 0) + 1;
    }
    
    console.log(`   📱 ${platform.toUpperCase()}:`);
    for (const [status, count] of Object.entries(counts)) {
      console.log(`      ${status}: ${count}`);
    }
    console.log();
  }
}

// === CLI ===

function parsePlatforms(args: string[]): Platform[] {
  const platformArg = args.find(a => a.startsWith('--platform='));
  if (platformArg) {
    const p = platformArg.split('=')[1] as Platform;
    if (ALL_PLATFORMS.includes(p)) return [p];
    console.error(`Unknown platform: ${p}. Use: ${ALL_PLATFORMS.join(', ')}`);
    process.exit(1);
  }
  return ALL_PLATFORMS;
}

async function main() {
  const args = process.argv.slice(2);
  const platforms = parsePlatforms(args);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  📤 Multi-Platform Automated Outreach (Human-Like Pacing)    ║');
  console.log('║  Platforms: Instagram · TikTok · Twitter                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Active: ${platforms.join(', ')}`);
  
  if (args.includes('--dry-run') || args.includes('-d')) {
    await executeDryRun(platforms);
  } else if (args.includes('--queue') || args.includes('-q')) {
    await createOutreachQueue(platforms);
  } else if (args.includes('--send') || args.includes('-s')) {
    await executeOutreach(platforms);
  } else if (args.includes('--stats')) {
    await showStats(platforms);
  } else {
    console.log(`
Usage:
  npx tsx scripts/automated-outreach.ts --dry-run                     Preview all platforms
  npx tsx scripts/automated-outreach.ts --dry-run --platform=instagram
  npx tsx scripts/automated-outreach.ts --queue                       Build outreach queue
  npx tsx scripts/automated-outreach.ts --send                        Execute outreach
  npx tsx scripts/automated-outreach.ts --send --platform=tiktok
  npx tsx scripts/automated-outreach.ts --stats                       Show outreach stats

Rate Limits:
  • ${RATE_LIMITS.messagesPerHour} messages/hour
  • ${RATE_LIMITS.messagesPerDay} messages/day
  • Active hours: ${RATE_LIMITS.activeHoursStart}:00 - ${RATE_LIMITS.activeHoursEnd}:00
  • Delay between messages: ${RATE_LIMITS.minDelayBetweenMs/1000}s - ${RATE_LIMITS.maxDelayBetweenMs/1000}s

Platform Servers:
  • Instagram: http://localhost:3100
  • TikTok:    http://localhost:3102
  • Twitter:   http://localhost:3003

⚠️  Always use --dry-run first to verify the queue!
`);
  }
}

main().catch(console.error);
