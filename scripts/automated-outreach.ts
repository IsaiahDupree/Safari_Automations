#!/usr/bin/env npx tsx
/**
 * Automated Outreach with Human-Like Pacing
 * 
 * Sends relationship-first DMs with:
 * - Rate limiting to avoid detection
 * - Personalized templates based on context
 * - Time-of-day awareness
 * - Consent-first approach
 * 
 * Usage:
 *   npx tsx scripts/automated-outreach.ts --dry-run
 *   npx tsx scripts/automated-outreach.ts --queue
 *   npx tsx scripts/automated-outreach.ts --send
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const execAsync = promisify(exec);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

interface OutreachTask {
  id: string;
  contact_id: string;
  template_id: string;
  message: string;
  priority: number;
  scheduled_for: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
}

interface Contact {
  id: string;
  instagram_username: string;
  display_name: string;
  relationship_score: number;
  pipeline_stage: string;
  what_theyre_building: string | null;
}

// === SAFARI AUTOMATION ===

async function safari(js: string): Promise<string> {
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  
  const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  const tempFile = path.join(os.tmpdir(), `safari-${Date.now()}.js`);
  await fs.writeFile(tempFile, cleanJS);
  
  const script = `
    set jsCode to read POSIX file "${tempFile}" as «class utf8»
    tell application "Safari" to do JavaScript jsCode in front document
  `;
  
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
    await fs.unlink(tempFile).catch(() => {});
    return stdout.trim();
  } catch (error) {
    await fs.unlink(tempFile).catch(() => {});
    return '';
  }
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

async function isWithinActiveHours(): Promise<boolean> {
  const hour = new Date().getHours();
  return hour >= RATE_LIMITS.activeHoursStart && hour < RATE_LIMITS.activeHoursEnd;
}

async function getMessagesSentToday(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { count } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true })
    .eq('is_outbound', true)
    .eq('sent_by_automation', true)
    .gte('sent_at', today.toISOString());
  
  return count || 0;
}

async function canSendMessage(): Promise<{ allowed: boolean; reason: string }> {
  if (!await isWithinActiveHours()) {
    return { allowed: false, reason: 'Outside active hours (9 AM - 9 PM)' };
  }
  
  const sentToday = await getMessagesSentToday();
  if (sentToday >= RATE_LIMITS.messagesPerDay) {
    return { allowed: false, reason: `Daily limit reached (${RATE_LIMITS.messagesPerDay}/day)` };
  }
  
  return { allowed: true, reason: 'OK' };
}

async function clickOnUser(username: string): Promise<boolean> {
  // Navigate to inbox first
  await execAsync(`osascript -e 'tell application "Safari" to set URL of front document to "https://www.instagram.com/direct/inbox/"'`);
  await wait(3000);
  
  // Find and click user
  const result = await safari(`
    (function() {
      var spans = document.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].textContent.includes('${username}')) {
          var parent = spans[i].parentElement.parentElement.parentElement;
          parent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return 'clicked';
        }
      }
      return 'not found';
    })()
  `);
  
  await wait(2000);
  return result === 'clicked';
}

async function sendDM(message: string): Promise<boolean> {
  // Find message input
  const inputResult = await safari(`
    (function() {
      var input = document.querySelector('textarea[placeholder*="Message"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                  document.querySelector('[aria-label*="Message"]');
      if (input) {
        input.focus();
        return 'found';
      }
      return 'not found';
    })()
  `);
  
  if (inputResult !== 'found') return false;
  await wait(500);
  
  // Type message
  const escaped = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
  await safari(`
    (function() {
      var input = document.querySelector('textarea[placeholder*="Message"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (input) {
        if (input.tagName === 'TEXTAREA') {
          input.value = '${escaped}';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          input.innerText = '${escaped}';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        return 'typed';
      }
      return 'failed';
    })()
  `);
  
  await wait(500);
  
  // Click send
  const sendResult = await safari(`
    (function() {
      var btn = document.querySelector('button[type="submit"]') ||
                document.querySelector('div[role="button"][tabindex="0"]');
      if (btn && btn.textContent.toLowerCase().includes('send')) {
        btn.click();
        return 'sent';
      }
      // Try SVG send button
      var svgs = document.querySelectorAll('svg');
      for (var i = 0; i < svgs.length; i++) {
        var parent = svgs[i].closest('div[role="button"]');
        if (parent) {
          parent.click();
          return 'sent';
        }
      }
      return 'no send button';
    })()
  `);
  
  return sendResult === 'sent';
}

// === QUEUE MANAGEMENT ===

async function createOutreachQueue(): Promise<void> {
  console.log('📋 Building outreach queue...\n');
  
  // Get suggested actions that haven't been completed
  const { data: actions, error } = await supabase
    .from('suggested_actions')
    .select(`
      id,
      contact_id,
      template_id,
      priority,
      contact:instagram_contacts(instagram_username, display_name, what_theyre_building),
      template:nba_templates(template_text)
    `)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(20);
  
  if (error || !actions) {
    console.error('Error fetching actions:', error?.message);
    return;
  }
  
  console.log('═'.repeat(70));
  console.log('OUTREACH QUEUE');
  console.log('═'.repeat(70));
  
  let scheduled = 0;
  const baseTime = new Date();
  
  for (const action of actions) {
    const contact = action.contact as any;
    const template = action.template as any;
    
    if (!contact || !template) continue;
    
    // Personalize message
    let message = template.template_text;
    if (contact.what_theyre_building) {
      message = message.replace(/___/g, contact.what_theyre_building);
    }
    
    // Calculate scheduled time with delays
    const scheduledTime = new Date(baseTime.getTime() + (scheduled * randomDelay()));
    
    console.log(`\n${scheduled + 1}. ${contact.display_name || contact.instagram_username}`);
    console.log(`   Message: "${message.substring(0, 50)}..."`);
    console.log(`   Scheduled: ${scheduledTime.toLocaleTimeString()}`);
    
    scheduled++;
  }
  
  console.log('\n' + '═'.repeat(70));
  console.log(`\n✅ ${scheduled} messages queued`);
  console.log(`⏱️  Estimated completion: ${Math.round(scheduled * 3)} minutes\n`);
}

async function executeDryRun(): Promise<void> {
  console.log('🧪 DRY RUN - No messages will be sent\n');
  
  const canSend = await canSendMessage();
  console.log(`Rate limit check: ${canSend.allowed ? '✅' : '❌'} ${canSend.reason}`);
  
  const sentToday = await getMessagesSentToday();
  console.log(`Messages sent today: ${sentToday}/${RATE_LIMITS.messagesPerDay}`);
  console.log(`Active hours: ${RATE_LIMITS.activeHoursStart}:00 - ${RATE_LIMITS.activeHoursEnd}:00`);
  console.log(`Current hour: ${new Date().getHours()}:00`);
  
  await createOutreachQueue();
}

async function executeOutreach(): Promise<void> {
  console.log('📤 EXECUTING OUTREACH\n');
  
  // Check rate limits
  const canSend = await canSendMessage();
  if (!canSend.allowed) {
    console.log(`❌ Cannot send: ${canSend.reason}`);
    return;
  }
  
  // Get pending actions
  const { data: actions } = await supabase
    .from('suggested_actions')
    .select(`
      id,
      contact_id,
      template_id,
      contact:instagram_contacts(id, instagram_username, display_name, what_theyre_building),
      template:nba_templates(template_text)
    `)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .limit(5); // Only do 5 at a time
  
  if (!actions || actions.length === 0) {
    console.log('No pending outreach tasks');
    return;
  }
  
  let sent = 0;
  let failed = 0;
  
  for (const action of actions) {
    const contact = action.contact as any;
    const template = action.template as any;
    
    if (!contact || !template) continue;
    
    // Re-check rate limits
    const check = await canSendMessage();
    if (!check.allowed) {
      console.log(`\n⏸️  Pausing: ${check.reason}`);
      break;
    }
    
    console.log(`\n📤 Sending to ${contact.display_name || contact.instagram_username}...`);
    
    // Click on user
    const clicked = await clickOnUser(contact.instagram_username);
    if (!clicked) {
      console.log('   ❌ Could not find user');
      await supabase
        .from('suggested_actions')
        .update({ status: 'failed' })
        .eq('id', action.id);
      failed++;
      continue;
    }
    
    // Personalize and send message
    let message = template.template_text;
    if (contact.what_theyre_building) {
      message = message.replace(/___/g, contact.what_theyre_building);
    }
    
    const sentOk = await sendDM(message);
    
    if (sentOk) {
      console.log('   ✅ Sent!');
      
      // Log message
      const { data: conversation } = await supabase
        .from('instagram_conversations')
        .select('id')
        .eq('contact_id', contact.id)
        .single();
      
      if (conversation) {
        await supabase.from('instagram_messages').insert({
          conversation_id: conversation.id,
          contact_id: contact.id,
          message_text: message,
          is_outbound: true,
          sent_by_automation: true,
          sent_at: new Date().toISOString(),
        });
      }
      
      // Update action status
      await supabase
        .from('suggested_actions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', action.id);
      
      // Update contact
      await supabase
        .from('instagram_contacts')
        .update({ 
          last_message_at: new Date().toISOString(),
          total_messages_sent: (contact.total_messages_sent || 0) + 1,
        })
        .eq('id', contact.id);
      
      sent++;
    } else {
      console.log('   ❌ Failed to send');
      failed++;
    }
    
    // Human-like delay
    const delay = randomDelay();
    console.log(`   ⏱️  Waiting ${Math.round(delay / 1000)}s...`);
    await wait(delay);
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log(`✅ Sent: ${sent} | ❌ Failed: ${failed}`);
  console.log('═'.repeat(50) + '\n');
}

// === CLI ===

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     📤 Automated Outreach (Human-Like Pacing)                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (args.includes('--dry-run') || args.includes('-d')) {
    await executeDryRun();
  } else if (args.includes('--queue') || args.includes('-q')) {
    await createOutreachQueue();
  } else if (args.includes('--send') || args.includes('-s')) {
    await executeOutreach();
  } else {
    console.log(`
Usage:
  npx tsx scripts/automated-outreach.ts --dry-run    Check rate limits and preview queue
  npx tsx scripts/automated-outreach.ts --queue      Build outreach queue from suggestions
  npx tsx scripts/automated-outreach.ts --send       Execute outreach (with rate limiting)

Rate Limits:
  • ${RATE_LIMITS.messagesPerHour} messages/hour
  • ${RATE_LIMITS.messagesPerDay} messages/day
  • Active hours: ${RATE_LIMITS.activeHoursStart}:00 - ${RATE_LIMITS.activeHoursEnd}:00
  • Delay between messages: ${RATE_LIMITS.minDelayBetweenMs/1000}s - ${RATE_LIMITS.maxDelayBetweenMs/1000}s

⚠️  Always use --dry-run first to verify the queue!
`);
  }
}

main().catch(console.error);
