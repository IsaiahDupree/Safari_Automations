/**
 * Extract Top 5 Chat Conversations
 * Focused extraction using discovered patterns
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const safariUrl = process.env.SAFARI_API_URL || 'http://localhost:3100';
const supabaseUrl = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function exec(script: string): Promise<string> {
  const response = await fetch(`${safariUrl}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const result = await response.json() as { output: string };
  return result.output || '';
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Top 5 contacts to extract (Tiffany Kyazze excluded - different selectors)
const TOP_CONTACTS = [
  'Sarah Ashley',
  'Evan Dawson',
  'Owen Case',
  'Steven Thiel',
  'Sabrina Ramonov'
];

async function activateSafari(): Promise<void> {
  // Ensure Safari is frontmost before any action
  await fetch(`${safariUrl}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'document.hasFocus()' }),
  });
}

async function clickContact(name: string): Promise<boolean> {
  console.log(`  Clicking on ${name}...`);
  
  // First scroll to top of conversation list
  await exec(`(function(){ var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s"); if(c) c.scrollTop = 0; })()`);
  await wait(500);
  
  // Escape special characters in name
  const escapedName = name.replace(/[|]/g, '').trim();
  
  const result = await exec(`
    (function() {
      var searchName = '${escapedName}';
      var items = document.querySelectorAll('div, span');
      
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var text = (el.innerText || '').trim();
        
        // Match contact name at start of text, with reasonable length
        if (text.indexOf(searchName) === 0 && text.length < 100) {
          // Click the element
          el.click();
          return 'clicked: ' + text.substring(0, 30);
        }
      }
      return 'not_found';
    })()
  `);
  
  console.log(`  Click result: ${result}`);
  return result.includes('clicked');
}

async function scrollAndExtractMessages(contactName: string): Promise<{ text: string; isOutbound: boolean; timestamp?: string }[]> {
  // First, scroll the message container UP to load older messages
  console.log(`  Scrolling to load older messages...`);
  
  for (let scroll = 0; scroll < 5; scroll++) {
    await exec(`
      (function() {
        var containers = document.querySelectorAll("div");
        for (var i = 0; i < containers.length; i++) {
          var c = containers[i];
          if (c.scrollHeight > 2000 && c.clientHeight > 400) {
            c.scrollBy(0, -3000);
            return "scrolled";
          }
        }
        return "none";
      })()
    `);
    await wait(1500);
  }
  
  // Extract username handle from contact name (lowercase version)
  const handleGuess = contactName.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 15);
  
  // Now extract messages from the conversation
  const result = await exec(`
    (function() {
      var messages = [];
      var seen = {};
      var pageText = document.body.innerText;
      
      // Find the conversation section by looking for username handle after contact name
      // Pattern: "Sarah Ashley\\nsaraheashley\\n" then messages follow
      var handles = pageText.match(/\\n([a-z0-9._]{5,20})\\n/g);
      if (!handles) return JSON.stringify({error: "no handles"});
      
      // Find handle that matches contact name pattern
      var targetHandle = null;
      var handleGuess = '${handleGuess}';
      for (var h = 0; h < handles.length; h++) {
        var handle = handles[h].trim();
        if (handle.indexOf(handleGuess.substring(0,5)) !== -1 || 
            handleGuess.indexOf(handle.substring(0,5)) !== -1) {
          targetHandle = handle;
          break;
        }
      }
      
      if (!targetHandle && handles.length > 1) {
        targetHandle = handles[1].trim(); // Second handle is usually the contact
      }
      
      if (!targetHandle) return JSON.stringify({error: "no target handle"});
      
      // Get text after this handle
      var startIdx = pageText.indexOf(targetHandle) + targetHandle.length;
      var convText = pageText.substring(startIdx);
      var lines = convText.split(String.fromCharCode(10));
      
      var currentTimestamp = '';
      
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.length < 2) continue;
        
        // Stop at Message... (end of conversation)
        if (line === 'Message...') break;
        
        // Capture timestamps (Jan 1, 2026, 5:32 PM format)
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(line)) {
          currentTimestamp = line;
          continue;
        }
        
        // Skip other timestamp formats
        if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Yesterday)/.test(line)) continue;
        if (/^[0-9]{1,2}:[0-9]{2}/.test(line)) continue;
        
        // Skip username handles (shared content)
        if (line.match(/^[a-z0-9._]+$/) && line.length < 25) continue;
        
        // Skip UI elements
        if (line === 'Active' || line === 'Unread') continue;
        if (line.indexOf('·') !== -1) continue;
        if (/[0-9]+[wdhm]$/.test(line)) continue;
        
        // This is a message or shared content
        if (line.length > 2 && line.length < 1000 && !seen[line]) {
          seen[line] = true;
          var isOutbound = line.indexOf('Test') !== -1 || line.indexOf('Hey') === 0 || 
                          line.indexOf('Hi ') === 0 || line.indexOf('Hello') === 0;
          messages.push({ 
            text: line, 
            isOutbound: isOutbound,
            timestamp: currentTimestamp 
          });
        }
      }
      
      return JSON.stringify(messages);
    })()
  `);
  
  try {
    const parsed = JSON.parse(result || '[]');
    if (parsed.error) {
      console.log(`  Debug: ${parsed.error}`);
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

async function saveMessages(contactName: string, messages: { text: string; isOutbound: boolean }[]): Promise<number> {
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
        fit_signals: [],
        tags: ['top5_extracted'],
      })
      .select('id')
      .single();
    contact = newContact;
  }
  
  if (!contact) return 0;
  
  // Get or create conversation
  let { data: conversation } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .single();
  
  if (!conversation) {
    const { data: newConv } = await supabase
      .from('instagram_conversations')
      .insert({
        contact_id: contact.id,
        dm_tab: 'primary',
        last_message_preview: messages[0]?.text?.substring(0, 100),
      })
      .select('id')
      .single();
    conversation = newConv;
  }
  
  if (!conversation) return 0;
  
  // Save messages
  let saved = 0;
  for (const msg of messages) {
    const { data: existing } = await supabase
      .from('instagram_messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('message_text', msg.text.substring(0, 500))
      .limit(1);
    
    if (!existing || existing.length === 0) {
      await supabase.from('instagram_messages').insert({
        conversation_id: conversation.id,
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

async function main() {
  console.log('\n📬 Extracting Top 5 Chat Conversations\n');
  console.log('='.repeat(50) + '\n');
  
  // Navigate to inbox
  console.log('📬 Navigating to inbox...');
  await fetch(`${safariUrl}/api/inbox/navigate`, { method: 'POST' });
  await wait(3000);
  
  const results: { contact: string; messages: number; saved: number; error?: string }[] = [];
  
  for (const contact of TOP_CONTACTS) {
    console.log(`\n[${TOP_CONTACTS.indexOf(contact) + 1}/${TOP_CONTACTS.length}] ${contact}`);
    
    try {
      // Activate Safari before each action
      await activateSafari();
      
      // Navigate back to inbox first
      await fetch(`${safariUrl}/api/inbox/navigate`, { method: 'POST' });
      await wait(3000);
      
      // Click on the contact
      const clicked = await clickContact(contact);
      if (!clicked) {
        console.log(`  ⚠️ Could not find contact`);
        results.push({ contact, messages: 0, saved: 0, error: 'not found' });
        continue;
      }
      
      // Wait for conversation to load (important!)
      console.log(`  Waiting for conversation to load...`);
      await wait(5000);
      
      // Extract messages
      const messages = await scrollAndExtractMessages(contact);
      console.log(`  Found ${messages.length} messages`);
      
      if (messages.length > 0) {
        // Show first few messages
        messages.slice(0, 3).forEach((m, i) => {
          const prefix = m.isOutbound ? '  → (out)' : '  ← (in)';
          console.log(`${prefix} ${m.text.substring(0, 60)}...`);
        });
        
        // Save to database
        const saved = await saveMessages(contact, messages);
        console.log(`  ✅ Saved ${saved} new messages to DB`);
        results.push({ contact, messages: messages.length, saved });
      } else {
        console.log(`  ⚠️ No messages extracted`);
        results.push({ contact, messages: 0, saved: 0, error: 'no messages' });
      }
      
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
      results.push({ contact, messages: 0, saved: 0, error: String(error) });
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(50) + '\n');
  
  let totalMessages = 0;
  let totalSaved = 0;
  
  results.forEach(r => {
    const status = r.error ? `❌ ${r.error}` : `✅ ${r.messages} msgs, ${r.saved} saved`;
    console.log(`${r.contact}: ${status}`);
    totalMessages += r.messages;
    totalSaved += r.saved;
  });
  
  console.log(`\nTotal: ${totalMessages} messages extracted, ${totalSaved} new saved`);
  
  // Database totals
  const { count: msgCount } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  console.log(`\n📋 Database: ${msgCount} total messages`);
}

main().catch(console.error);
