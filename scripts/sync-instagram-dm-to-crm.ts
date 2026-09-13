#!/usr/bin/env npx tsx
/**
 * Sync Instagram DMs to MediaPoster CRM
 * 
 * Reads DM data from Safari and syncs to Supabase tables:
 * - instagram_contacts
 * - instagram_conversations  
 * - instagram_messages
 * 
 * Usage:
 *   npx tsx scripts/sync-instagram-dm-to-crm.ts
 *   npx tsx scripts/sync-instagram-dm-to-crm.ts --tab Primary
 *   npx tsx scripts/sync-instagram-dm-to-crm.ts --full
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load .env file
config();

const execAsync = promisify(exec);

// Supabase config - hardcode fallbacks for reliability
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === SAFARI EXECUTOR ===

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

async function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// === DATA EXTRACTION ===

interface ConversationData {
  username: string;
  displayName: string;
  lastMessage: string;
  lastMessageTime: string;
  isUnread: boolean;
  tab: string;
}

interface MessageData {
  text: string;
  isOutbound: boolean;
  timestamp?: string;
}

async function navigateToInbox(): Promise<void> {
  await execAsync(`osascript -e 'tell application "Safari" to set URL of front document to "https://www.instagram.com/direct/inbox/"'`);
  await wait(3000);
}

async function clickTab(tabName: string): Promise<boolean> {
  const result = await safari(`
    (function() {
      var tabs = document.querySelectorAll('[role="tab"]');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].innerText.includes('${tabName}')) {
          tabs[i].click();
          return 'clicked';
        }
      }
      return 'not found';
    })()
  `);
  await wait(2000);
  return result === 'clicked';
}

async function getConversationsFromTab(tab: string): Promise<ConversationData[]> {
  const pageText = await safari(`document.body.innerText`);
  const conversations: ConversationData[] = [];
  
  // Parse the page text to extract conversation data
  const lines = pageText.split('\n').filter(l => l.trim());
  
  let currentConvo: Partial<ConversationData> | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Time pattern (e.g., "22w", "14h", "1d", "1m")
    if (/^\d+[mhdwy]$/.test(line)) {
      if (currentConvo && currentConvo.username) {
        currentConvo.lastMessageTime = line;
        currentConvo.tab = tab.toLowerCase();
        conversations.push(currentConvo as ConversationData);
      }
      currentConvo = null;
      continue;
    }
    
    // Skip system text
    if (['Unread', 'Active', 'Primary', 'General', 'Requests', 'Note...', 'Send message', 'Your messages'].includes(line)) {
      if (line === 'Unread' && currentConvo) {
        currentConvo.isUnread = true;
      }
      continue;
    }
    
    // Looks like a username/display name (reasonable length, no common message patterns)
    if (line.length > 2 && line.length < 60 && 
        !line.includes('sent') && !line.includes('You:') && 
        !line.includes('·') && !line.startsWith('https://')) {
      
      if (!currentConvo) {
        currentConvo = {
          username: line,
          displayName: line,
          lastMessage: '',
          isUnread: false,
        };
      } else if (!currentConvo.lastMessage) {
        currentConvo.lastMessage = line;
      }
    } else if (currentConvo && !currentConvo.lastMessage && line.length > 0) {
      currentConvo.lastMessage = line.substring(0, 100);
    }
  }
  
  return conversations.slice(0, 30); // Limit to 30 per tab
}

async function clickOnConversation(username: string): Promise<boolean> {
  const result = await safari(`
    (function() {
      var spans = document.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].textContent === '${username}') {
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

async function getMessagesFromConversation(): Promise<MessageData[]> {
  const pageText = await safari(`
    (function() {
      var main = document.querySelector('[role="main"]');
      if (!main) return '';
      
      var messages = [];
      var elements = main.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      var seen = new Set();
      
      elements.forEach(function(el) {
        var text = (el.innerText || '').trim();
        if (text && text.length > 0 && text.length < 500 && !seen.has(text)) {
          seen.add(text);
          messages.push(text);
        }
      });
      
      return messages.join('|||');
    })()
  `);
  
  if (!pageText) return [];
  
  return pageText.split('|||').map(text => ({
    text,
    isOutbound: text.startsWith('You:') || text.includes('You sent'),
  }));
}

// === SUPABASE SYNC ===

async function upsertContact(data: ConversationData): Promise<string | null> {
  const { data: contact, error } = await supabase
    .from('instagram_contacts')
    .upsert({
      instagram_username: data.username,
      display_name: data.displayName,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'instagram_username',
    })
    .select('id')
    .single();
  
  if (error) {
    console.error(`Error upserting contact ${data.username}:`, error.message);
    return null;
  }
  
  return contact?.id || null;
}

async function upsertConversation(contactId: string, data: ConversationData): Promise<string | null> {
  // Check if conversation exists
  const { data: existing } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contactId)
    .single();
  
  if (existing) {
    // Update existing
    const { error } = await supabase
      .from('instagram_conversations')
      .update({
        tab: data.tab,
        is_unread: data.isUnread,
        last_message_preview: data.lastMessage,
        last_message_time: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    
    if (error) console.error(`Error updating conversation:`, error.message);
    return existing.id;
  } else {
    // Insert new
    const { data: conv, error } = await supabase
      .from('instagram_conversations')
      .insert({
        contact_id: contactId,
        tab: data.tab,
        is_unread: data.isUnread,
        last_message_preview: data.lastMessage,
        last_message_time: new Date().toISOString(),
      })
      .select('id')
      .single();
    
    if (error) {
      console.error(`Error inserting conversation:`, error.message);
      return null;
    }
    return conv?.id || null;
  }
}

async function insertMessages(conversationId: string, contactId: string, messages: MessageData[]): Promise<number> {
  let count = 0;
  
  for (const msg of messages) {
    const { error } = await supabase
      .from('instagram_messages')
      .insert({
        conversation_id: conversationId,
        contact_id: contactId,
        message_text: msg.text,
        is_outbound: msg.isOutbound,
        sent_at: new Date().toISOString(),
      });
    
    if (!error) count++;
  }
  
  return count;
}

async function createSyncLog(syncType: string, tab?: string): Promise<string> {
  const { data, error } = await supabase
    .from('instagram_dm_sync_log')
    .insert({
      sync_type: syncType,
      tab_synced: tab,
      status: 'running',
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating sync log:', error.message);
    return '';
  }
  return data?.id || '';
}

async function updateSyncLog(logId: string, contactsSynced: number, messagesSynced: number, errors: string[], status: 'completed' | 'failed'): Promise<void> {
  await supabase
    .from('instagram_dm_sync_log')
    .update({
      contacts_synced: contactsSynced,
      messages_synced: messagesSynced,
      errors: errors.length > 0 ? errors : null,
      completed_at: new Date().toISOString(),
      status,
    })
    .eq('id', logId);
}

// === MAIN SYNC FUNCTION ===

async function syncTab(tab: string): Promise<{ contacts: number; messages: number; errors: string[] }> {
  console.log(`\n📥 Syncing ${tab} tab...`);
  
  const result = { contacts: 0, messages: 0, errors: [] as string[] };
  
  // Click on the tab
  const clicked = await clickTab(tab);
  if (!clicked && tab !== 'Primary') {
    result.errors.push(`Could not click ${tab} tab`);
    return result;
  }
  
  await wait(2000);
  
  // Get conversations
  const conversations = await getConversationsFromTab(tab);
  console.log(`  Found ${conversations.length} conversations`);
  
  for (const conv of conversations) {
    try {
      // Upsert contact
      const contactId = await upsertContact(conv);
      if (!contactId) {
        result.errors.push(`Failed to upsert contact: ${conv.username}`);
        continue;
      }
      result.contacts++;
      
      // Upsert conversation
      const conversationId = await upsertConversation(contactId, conv);
      if (!conversationId) {
        result.errors.push(`Failed to upsert conversation for: ${conv.username}`);
        continue;
      }
      
      console.log(`  ✓ ${conv.username} (${conv.tab})`);
    } catch (error) {
      result.errors.push(`Error processing ${conv.username}: ${error}`);
    }
  }
  
  return result;
}

async function syncHiddenRequests(): Promise<{ contacts: number; messages: number; errors: string[] }> {
  console.log(`\n📥 Syncing Hidden Requests...`);
  
  const result = { contacts: 0, messages: 0, errors: [] as string[] };
  
  // First go to Requests tab
  await clickTab('Requests');
  await wait(2000);
  
  // Click Hidden Requests link
  const clicked = await safari(`
    (function() {
      var els = document.querySelectorAll('a, div[role="button"], span');
      for (var i = 0; i < els.length; i++) {
        if ((els[i].innerText || '').includes('Hidden Requests')) {
          els[i].click();
          return 'clicked';
        }
      }
      return 'not found';
    })()
  `);
  
  if (clicked !== 'clicked') {
    result.errors.push('Could not find Hidden Requests');
    return result;
  }
  
  await wait(2000);
  
  // Get conversations from hidden requests
  const conversations = await getConversationsFromTab('hidden_requests');
  console.log(`  Found ${conversations.length} hidden requests`);
  
  for (const conv of conversations) {
    try {
      const contactId = await upsertContact(conv);
      if (contactId) {
        await upsertConversation(contactId, { ...conv, tab: 'hidden_requests' });
        result.contacts++;
        console.log(`  ✓ ${conv.username} (hidden)`);
      }
    } catch (error) {
      result.errors.push(`Error processing ${conv.username}: ${error}`);
    }
  }
  
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const specificTab = args.find(a => !a.startsWith('--'));
  const fullSync = args.includes('--full');
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     📬 Instagram DM → CRM Sync                               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  // Check Supabase connection
  if (!SUPABASE_KEY) {
    console.error('\n❌ SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY not set');
    console.log('Set environment variable and try again');
    process.exit(1);
  }
  
  // Navigate to inbox
  console.log('\n🌐 Navigating to Instagram DMs...');
  await navigateToInbox();
  
  // Create sync log
  const syncType = fullSync ? 'full' : (specificTab ? 'tab_specific' : 'incremental');
  const logId = await createSyncLog(syncType, specificTab);
  
  let totalContacts = 0;
  let totalMessages = 0;
  const allErrors: string[] = [];
  
  try {
    if (specificTab) {
      // Sync specific tab
      const result = await syncTab(specificTab);
      totalContacts += result.contacts;
      totalMessages += result.messages;
      allErrors.push(...result.errors);
    } else {
      // Sync all tabs
      const tabs = ['Primary', 'General', 'Requests'];
      
      for (const tab of tabs) {
        const result = await syncTab(tab);
        totalContacts += result.contacts;
        totalMessages += result.messages;
        allErrors.push(...result.errors);
      }
      
      // Also sync hidden requests
      const hiddenResult = await syncHiddenRequests();
      totalContacts += hiddenResult.contacts;
      totalMessages += hiddenResult.messages;
      allErrors.push(...hiddenResult.errors);
    }
    
    // Update sync log
    await updateSyncLog(logId, totalContacts, totalMessages, allErrors, 'completed');
    
    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('📊 SYNC COMPLETE');
    console.log('═'.repeat(60));
    console.log(`✅ Contacts synced: ${totalContacts}`);
    console.log(`✅ Messages synced: ${totalMessages}`);
    if (allErrors.length > 0) {
      console.log(`⚠️ Errors: ${allErrors.length}`);
      allErrors.slice(0, 5).forEach(e => console.log(`   - ${e}`));
    }
    console.log('\n');
    
  } catch (error) {
    console.error('\n❌ Sync failed:', error);
    await updateSyncLog(logId, totalContacts, totalMessages, [...allErrors, String(error)], 'failed');
    process.exit(1);
  }
}

main().catch(console.error);
