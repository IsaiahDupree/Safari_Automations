/**
 * Extract All DMs - Replicable System
 * 
 * This script systematically extracts messages from ALL contacts in your Instagram DM inbox.
 * 
 * Patterns Discovered:
 * 1. Contact names are in <span> elements with exact text match
 * 2. Username handles are lowercase (a-z0-9._), 5-25 chars
 * 3. Messages appear after username handle in page text
 * 4. "messaged you about a comment..." lines should be skipped
 * 5. Scrollable container has scrollHeight > 1500, clientHeight > 400
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============== Configuration ==============

const CONFIG = {
  maxContacts: 50,           // Max contacts to process
  scrollPauseBetween: 1000,  // ms between scroll actions
  clickWait: 3000,           // ms to wait after clicking contact
  msgScrollCount: 2,         // Number of times to scroll for older messages
  inboxScrollCount: 5,       // Number of times to scroll inbox to load more contacts
};

// ============== Safari API ==============

async function exec(script: string): Promise<string> {
  try {
    const response = await fetch(`${SAFARI_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    const result = await response.json() as { output: string };
    return result.output || '';
  } catch (error) {
    console.error('Safari exec error:', error);
    return '';
  }
}

async function navigateToInbox(): Promise<boolean> {
  const response = await fetch(`${SAFARI_URL}/api/inbox/navigate`, { method: 'POST' });
  return response.ok;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== Contact Discovery ==============

/**
 * Get all visible contact names from the inbox (parses page text)
 */
async function getVisibleContacts(): Promise<string[]> {
  const script = `(function(){
    var contacts = [];
    var seen = {};
    var text = document.body.innerText;
    var lines = text.split(String.fromCharCode(10));
    var skip = ["Primary", "General", "Requests", "Messages", "Note...", "Search", "Unread", "Active", "Message...", "Instagram", "Home", "Reels", "Explore", "Notifications", "Create", "Dashboard", "Profile", "More", "Your note", "Your messages", "Send message", "Send a message", "YouTube"];
    for(var i = 0; i < lines.length; i++){
      var l = lines[i].trim();
      if(!l || l.length < 3 || l.length > 50) continue;
      if(!/^[A-Z]/.test(l)) continue;
      var isSkip = false;
      for(var j = 0; j < skip.length; j++){
        if(l === skip[j] || l.indexOf(skip[j]) === 0){ isSkip = true; break; }
      }
      if(isSkip) continue;
      if(/^[0-9]/.test(l)) continue;
      if(l.includes("·")) continue;
      if(l.includes("sent a")) continue;
      if(l.includes("You:")) continue;
      if(l.includes("messaged you")) continue;
      if(l.split(" ").length > 5) continue;
      var name = l.split("|")[0].trim();
      if(name.length > 2 && name.length < 40 && !seen[name]){
        seen[name] = true;
        contacts.push(name);
      }
    }
    return contacts.join("|||");
  })()`;
  
  const result = await exec(script);
  return result.split('|||').filter(c => c.length > 0);
}

/**
 * Scroll the inbox to load more contacts
 */
async function scrollInbox(): Promise<void> {
  await exec(`
    (function(){
      var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s");
      if(c) c.scrollTop += 1500;
      return "scrolled";
    })()
  `);
}

/**
 * Collect all contacts by scrolling through inbox
 */
async function collectAllContacts(): Promise<string[]> {
  const allContacts = new Set<string>();
  
  // Initial contacts
  const initial = await getVisibleContacts();
  initial.forEach(c => allContacts.add(c));
  console.log(`  Initial: ${initial.length} contacts`);
  
  // Scroll and collect more
  for (let i = 0; i < CONFIG.inboxScrollCount; i++) {
    await scrollInbox();
    await wait(CONFIG.scrollPauseBetween);
    
    const more = await getVisibleContacts();
    const beforeSize = allContacts.size;
    more.forEach(c => allContacts.add(c));
    
    const newFound = allContacts.size - beforeSize;
    if (newFound > 0) {
      console.log(`  Scroll ${i + 1}: +${newFound} contacts (total: ${allContacts.size})`);
    }
    
    // Stop if no new contacts found
    if (newFound === 0 && i > 1) break;
  }
  
  return Array.from(allContacts).slice(0, CONFIG.maxContacts);
}

// ============== Message Extraction ==============

/**
 * Click on a contact to open their conversation
 */
async function clickContact(name: string): Promise<boolean> {
  const escapedName = name.replace(/'/g, "\\'").replace(/[|]/g, '');
  
  const result = await exec(`
    (function(){
      var spans = document.querySelectorAll("span");
      for(var i = 0; i < spans.length; i++){
        var t = spans[i].innerText;
        if(t === '${escapedName}' || (t && t.indexOf('${escapedName}') === 0 && t.length < 60)){
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
 * Scroll message container to load older messages
 */
async function scrollMessagesUp(): Promise<void> {
  for (let i = 0; i < CONFIG.msgScrollCount; i++) {
    await exec(`
      (function(){
        var c = document.querySelectorAll("div");
        for(var i = 0; i < c.length; i++){
          if(c[i].scrollHeight > 1500 && c[i].clientHeight > 400){
            c[i].scrollBy(0, -5000);
            return "scrolled";
          }
        }
        return "none";
      })()
    `);
    await wait(800);
  }
}

/**
 * Find username handle in conversation view
 */
async function findHandle(): Promise<string | null> {
  const result = await exec(`
    (function(){
      var t = document.body.innerText;
      var lines = t.split(String.fromCharCode(10));
      for(var i = 0; i < lines.length; i++){
        var l = lines[i].trim();
        if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== "the_isaiah_dupree"){
          return l;
        }
      }
      return "";
    })()
  `);
  
  return result || null;
}

/**
 * Extract messages after the username handle
 */
async function extractMessages(handle: string): Promise<{ text: string; isOutbound: boolean }[]> {
  const script = `(function(){
    var t = document.body.innerText;
    var idx = t.indexOf("${handle}");
    if(idx === -1) return JSON.stringify([]);
    var endIdx = t.indexOf("Message...", idx);
    if(endIdx === -1) endIdx = idx + 3000;
    var content = t.substring(idx + ${handle.length}, endIdx);
    var lines = content.split(String.fromCharCode(10));
    var messages = [];
    var seen = {};
    for(var i = 0; i < lines.length; i++){
      var l = lines[i].trim();
      if(!l || l.length < 5) continue;
      if(/^[a-z0-9._]+$/.test(l) && l.length < 25) continue;
      if(/^\\d{1,2}\\/\\d{1,2}\\/\\d{2}/.test(l)) continue;
      if(l.includes("messaged you about")) continue;
      if(l.includes("sent an attachment")) continue;
      if(l.includes("sent a voice")) continue;
      if(l.includes(" · ")) continue;
      if(l === "·") continue;
      if(["Active", "Unread", "View profile", "See Post", "Instagram"].indexOf(l) !== -1) continue;
      if(l.length > 5 && l.length < 1000 && !seen[l]){
        seen[l] = true;
        var isOut = l.indexOf("Test") !== -1 || l.indexOf("I ") === 0 || l.indexOf("I built") !== -1;
        messages.push({ text: l, isOutbound: isOut });
      }
    }
    return JSON.stringify(messages);
  })()`;
  
  try {
    const result = await exec(script);
    return JSON.parse(result || '[]');
  } catch {
    return [];
  }
}

// ============== Database ==============

async function saveToDatabase(
  contactName: string, 
  handle: string | null, 
  messages: { text: string; isOutbound: boolean }[]
): Promise<number> {
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
        tags: handle ? ['dm_extracted', `handle:${handle}`] : ['dm_extracted'],
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

// ============== Main Extraction ==============

interface ExtractionResult {
  contact: string;
  handle: string | null;
  messagesFound: number;
  messagesSaved: number;
  error?: string;
}

async function extractContact(contactName: string): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    contact: contactName,
    handle: null,
    messagesFound: 0,
    messagesSaved: 0,
  };
  
  try {
    // Click contact
    const clicked = await clickContact(contactName);
    if (!clicked) {
      result.error = 'not found';
      return result;
    }
    
    // Wait for conversation to load
    await wait(CONFIG.clickWait);
    
    // Scroll for older messages
    await scrollMessagesUp();
    
    // Find handle
    const handle = await findHandle();
    result.handle = handle;
    
    if (!handle) {
      result.error = 'no handle';
      return result;
    }
    
    // Extract messages
    const messages = await extractMessages(handle);
    result.messagesFound = messages.length;
    
    if (messages.length === 0) {
      result.error = 'no messages';
      return result;
    }
    
    // Save to database
    result.messagesSaved = await saveToDatabase(contactName, handle, messages);
    
  } catch (error) {
    result.error = String(error);
  }
  
  return result;
}

// ============== CLI ==============

async function main() {
  console.log('\n📬 Extract All DMs - Replicable System\n');
  console.log('='.repeat(60));
  
  // Navigate to inbox
  console.log('\n📥 Navigating to inbox...');
  await navigateToInbox();
  await wait(2000);
  
  // Collect all contacts
  console.log('\n📜 Collecting contacts (scrolling inbox)...');
  const contacts = await collectAllContacts();
  console.log(`\n✅ Found ${contacts.length} contacts to process\n`);
  
  // Extract from each contact
  const results: ExtractionResult[] = [];
  let totalMessages = 0;
  let totalSaved = 0;
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    process.stdout.write(`[${i + 1}/${contacts.length}] ${contact.padEnd(30)}`);
    
    // Navigate back to inbox before each contact
    await navigateToInbox();
    await wait(1000);
    
    // Need to scroll to find contact if it was discovered after scrolling
    if (i > 10) {
      for (let s = 0; s < Math.floor(i / 10); s++) {
        await scrollInbox();
        await wait(500);
      }
    }
    
    const result = await extractContact(contact);
    results.push(result);
    
    if (result.error) {
      console.log(`❌ ${result.error}`);
    } else {
      console.log(`✅ ${result.handle} | ${result.messagesFound} msgs, ${result.messagesSaved} saved`);
      totalMessages += result.messagesFound;
      totalSaved += result.messagesSaved;
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY\n');
  
  const successful = results.filter(r => !r.error);
  const withMessages = results.filter(r => r.messagesFound > 0);
  
  console.log(`Contacts processed:  ${results.length}`);
  console.log(`Successful:          ${successful.length}`);
  console.log(`With messages:       ${withMessages.length}`);
  console.log(`Messages found:      ${totalMessages}`);
  console.log(`Messages saved:      ${totalSaved}`);
  
  // Discovered handles
  console.log('\n📋 Discovered Handles:\n');
  results
    .filter(r => r.handle)
    .forEach(r => console.log(`  ${r.contact.padEnd(25)} → ${r.handle}`));
  
  // Database total
  const { count } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  console.log(`\n📊 Database total: ${count} messages`);
  
  // Save handles to file for documentation
  const handlesDoc = results
    .filter(r => r.handle)
    .map(r => `| ${r.contact} | ${r.handle} |`)
    .join('\n');
  
  console.log('\n✨ Extraction complete!');
}

main().catch(console.error);
