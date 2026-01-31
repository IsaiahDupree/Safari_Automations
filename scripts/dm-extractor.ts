/**
 * Instagram DM Extractor
 * Reusable script using discovered patterns for extracting conversation data
 * 
 * Patterns discovered:
 * - Contact names in <span> elements with exact match
 * - Username handles: lowercase, 5-25 chars, a-z0-9._
 * - Scrollable container: scrollHeight > 1500, clientHeight > 400
 * - Messages appear after username handle in page text
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============== Safari API Helpers ==============

async function exec(script: string): Promise<string> {
  const response = await fetch(`${SAFARI_URL}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const result = await response.json() as { output: string };
  return result.output || '';
}

async function navigateToInbox(): Promise<void> {
  await fetch(`${SAFARI_URL}/api/inbox/navigate`, { method: 'POST' });
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== Extraction Functions ==============

/**
 * Click on a contact by exact name match in span elements
 */
async function clickContact(name: string): Promise<boolean> {
  const escapedName = name.replace(/'/g, "\\'");
  const result = await exec(`
    (function(){
      var spans = document.querySelectorAll("span");
      for(var i=0; i<spans.length; i++){
        var t = spans[i].innerText;
        if(t === '${escapedName}' || t.indexOf('${escapedName}') === 0 && t.length < 60){
          spans[i].click();
          return "clicked";
        }
      }
      return "not_found";
    })()
  `);
  return result.includes('clicked');
}

/**
 * Scroll the message container UP to load older messages
 */
async function scrollMessagesUp(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await exec(`
      (function(){
        var c = document.querySelectorAll("div");
        for(var i=0; i<c.length; i++){
          if(c[i].scrollHeight > 1500 && c[i].clientHeight > 400){
            c[i].scrollBy(0, -5000);
            return "scrolled";
          }
        }
        return "none";
      })()
    `);
    await wait(1000);
  }
}

/**
 * Find the username handle in the conversation view
 */
async function findUsernameHandle(excludeHandle = 'the_isaiah_dupree'): Promise<string | null> {
  const result = await exec(`
    (function(){
      var t = document.body.innerText;
      var lines = t.split(String.fromCharCode(10));
      for(var i=0; i<lines.length; i++){
        var l = lines[i].trim();
        if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== '${excludeHandle}'){
          return l;
        }
      }
      return "";
    })()
  `);
  return result || null;
}

/**
 * Extract conversation content after the username handle
 */
async function extractConversationContent(handle: string): Promise<string> {
  const result = await exec(`
    (function(){
      var t = document.body.innerText;
      var idx = t.indexOf('${handle}');
      if(idx === -1) return "";
      var endIdx = t.indexOf("Message...", idx);
      if(endIdx === -1) endIdx = idx + 2000;
      return t.substring(idx + ${handle.length}, endIdx);
    })()
  `);
  return result;
}

/**
 * Parse messages from conversation content
 */
function parseMessages(content: string, myHandle = 'the_isaiah_dupree'): { text: string; isOutbound: boolean; timestamp: string }[] {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const messages: { text: string; isOutbound: boolean; timestamp: string }[] = [];
  const seen = new Set<string>();
  
  let currentTimestamp = '';
  
  for (const line of lines) {
    // Skip username handles
    if (/^[a-z0-9._]+$/.test(line) && line.length < 25) continue;
    
    // Capture timestamps
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(line) || /^\d{1,2}\/\d{1,2}\/\d{2}/.test(line)) {
      currentTimestamp = line;
      continue;
    }
    
    // Skip UI elements
    if (['Active', 'Unread', 'View profile', 'See Post', 'Instagram'].includes(line)) continue;
    if (line.includes('messaged you about')) continue;  // Context line before actual message
    if (line.includes('sent an attachment')) continue;   // Attachment indicator
    if (line.includes('sent a voice')) continue;         // Voice message indicator
    if (line.includes('·')) continue;
    if (line.startsWith('https://')) continue;           // Skip raw URLs (extract separately if needed)
    
    // This is likely a message
    if (line.length > 5 && line.length < 1000 && !seen.has(line)) {
      seen.add(line);
      messages.push({
        text: line,
        isOutbound: line.includes('Test') || line.startsWith('Hey') || line.startsWith('Hi ') || line.startsWith('I '),
        timestamp: currentTimestamp
      });
    }
  }
  
  return messages;
}

// ============== Database Functions ==============

async function saveToDatabase(contactName: string, handle: string, messages: { text: string; isOutbound: boolean }[]): Promise<number> {
  // Get or create contact
  let { data: contact } = await supabase
    .from('instagram_contacts')
    .select('id')
    .eq('instagram_username', contactName)
    .single();
  
  if (!contact) {
    const { data: newContact } = await supabase
      .from('instagram_contacts')
      .insert({
        instagram_username: contactName,
        relationship_score: 50,
        pipeline_stage: 'first_touch',
        tags: ['dm_extracted'],
      })
      .select('id')
      .single();
    contact = newContact;
  }
  
  if (!contact) return 0;
  
  // Get or create conversation
  let { data: conv } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .single();
  
  if (!conv) {
    const { data: newConv } = await supabase
      .from('instagram_conversations')
      .insert({
        contact_id: contact.id,
        dm_tab: 'primary',
        last_message_preview: messages[0]?.text?.substring(0, 100),
      })
      .select('id')
      .single();
    conv = newConv;
  }
  
  if (!conv) return 0;
  
  // Save messages (skip duplicates)
  let saved = 0;
  for (const msg of messages) {
    const { data: existing } = await supabase
      .from('instagram_messages')
      .select('id')
      .eq('conversation_id', conv.id)
      .eq('message_text', msg.text.substring(0, 200))
      .limit(1);
    
    if (!existing || existing.length === 0) {
      await supabase.from('instagram_messages').insert({
        conversation_id: conv.id,
        contact_id: contact.id,
        message_text: msg.text,
        message_type: 'text',
        is_outbound: msg.isOutbound,
        sent_by_automation: false,
      });
      saved++;
    }
  }
  
  return saved;
}

// ============== Main Extraction Function ==============

export interface ExtractionResult {
  contact: string;
  handle: string | null;
  messagesFound: number;
  messagesSaved: number;
  error?: string;
}

export async function extractConversation(contactName: string): Promise<ExtractionResult> {
  const result: ExtractionResult = { contact: contactName, handle: null, messagesFound: 0, messagesSaved: 0 };
  
  try {
    // Step 1: Navigate to inbox
    await navigateToInbox();
    await wait(1000);
    
    // Step 2: Click contact
    const clicked = await clickContact(contactName);
    if (!clicked) {
      result.error = 'Contact not found';
      return result;
    }
    
    // Step 3: Wait for conversation load
    await wait(3000);
    
    // Step 4: Scroll to load older messages
    await scrollMessagesUp(2);
    
    // Step 5: Find username handle
    const handle = await findUsernameHandle();
    if (!handle) {
      result.error = 'No username handle found';
      return result;
    }
    result.handle = handle;
    
    // Step 6: Extract conversation content
    const content = await extractConversationContent(handle);
    if (!content) {
      result.error = 'No conversation content';
      return result;
    }
    
    // Step 7: Parse messages
    const messages = parseMessages(content);
    result.messagesFound = messages.length;
    
    if (messages.length === 0) {
      result.error = 'No messages parsed';
      return result;
    }
    
    // Step 8: Save to database
    result.messagesSaved = await saveToDatabase(contactName, handle, messages);
    
  } catch (error) {
    result.error = String(error);
  }
  
  return result;
}

// ============== CLI Entry Point ==============

async function main() {
  const contacts = process.argv.slice(2);
  
  if (contacts.length === 0) {
    console.log('Usage: npx tsx scripts/dm-extractor.ts "Contact Name 1" "Contact Name 2" ...');
    console.log('\nExample: npx tsx scripts/dm-extractor.ts "Sarah Ashley" "Owen Case"');
    process.exit(0);
  }
  
  console.log('\n📬 Instagram DM Extractor\n');
  console.log('='.repeat(50));
  
  const results: ExtractionResult[] = [];
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    console.log(`\n[${i + 1}/${contacts.length}] ${contact}`);
    
    const result = await extractConversation(contact);
    results.push(result);
    
    if (result.error) {
      console.log(`  ❌ ${result.error}`);
    } else {
      console.log(`  ✅ Handle: ${result.handle}`);
      console.log(`  ✅ ${result.messagesFound} messages found, ${result.messagesSaved} saved`);
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary\n');
  
  const successful = results.filter(r => !r.error);
  const totalFound = results.reduce((sum, r) => sum + r.messagesFound, 0);
  const totalSaved = results.reduce((sum, r) => sum + r.messagesSaved, 0);
  
  console.log(`Contacts: ${successful.length}/${results.length} successful`);
  console.log(`Messages: ${totalFound} found, ${totalSaved} saved`);
  
  // Show discovered handles
  console.log('\nDiscovered handles:');
  results.filter(r => r.handle).forEach(r => {
    console.log(`  ${r.contact} → ${r.handle}`);
  });
  
  const { count } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  console.log(`\n📋 Database total: ${count} messages`);
}

main().catch(console.error);
