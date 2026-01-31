/**
 * Extract All Chat Data
 * Goes through each conversation and extracts messages
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const safariUrl = process.env.SAFARI_API_URL || 'http://localhost:3100';
const supabaseUrl = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function safari<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${safariUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

async function exec(script: string): Promise<string> {
  const result = await safari<{ output: string }>('/api/execute', 'POST', { script });
  return result.output || '';
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface ChatData {
  contactName: string;
  messages: { text: string; isOutbound: boolean; time?: string }[];
  unread: boolean;
  lastMessageTime?: string;
}

async function getVisibleContacts(): Promise<string[]> {
  const result = await exec(`
    (function() {
      var names = [];
      var text = document.body.innerText;
      var lines = text.split(String.fromCharCode(10));
      // Only skip exact UI element matches
      var exactSkip = ['Primary','General','Requests','Messages','Note...','Search','Unread','Active',
        'Your note','Your messages','Send message','Hidden Requests','Message...','Delete all'];
      var seen = {};
      
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (!l || l.length < 3 || l.length > 45) continue;
        if (!/^[A-Z]/.test(l)) continue;
        if (l.indexOf(' sent ') !== -1) continue;
        if (l.indexOf('You:') !== -1) continue;
        if (l.indexOf('http') !== -1) continue;
        if (/^[0-9]/.test(l)) continue;
        if (l === '·') continue;
        
        // Skip exact UI matches
        var bad = false;
        for (var j = 0; j < exactSkip.length; j++) {
          if (l === exactSkip[j]) { bad = true; break; }
        }
        if (bad) continue;
        
        // Skip if it looks like a message (long with punctuation)
        if (l.split(' ').length > 6) continue;
        if (l.indexOf('!') !== -1 && l.split(' ').length > 4) continue;
        if (l.indexOf('?') !== -1 && l.split(' ').length > 4) continue;
        
        var name = l.split('|')[0].trim();
        if (name.length > 2 && !seen[name]) {
          seen[name] = true;
          names.push(name);
        }
      }
      return names.join('|||');
    })()
  `);
  
  return result.split('|||').filter(n => n.length > 1);
}

async function clickContact(name: string): Promise<boolean> {
  // Escape special characters for JavaScript string
  const escapedName = name.replace(/'/g, "\\'").replace(/🍄/g, '').replace(/[^\w\s]/g, '').trim();
  
  const result = await exec(`
    (function() {
      var searchName = '${escapedName}';
      
      // Method 1: Find by exact text match on conversation items
      var items = document.querySelectorAll('div, span');
      for (var i = 0; i < items.length; i++) {
        var el = items[i];
        var text = (el.innerText || '').trim();
        
        // Check if this element contains just the contact name (not the full conversation preview)
        if (text.indexOf(searchName) === 0 && text.length < searchName.length + 30) {
          // Walk up to find clickable parent
          var parent = el;
          for (var j = 0; j < 10; j++) {
            if (!parent || !parent.parentElement) break;
            parent = parent.parentElement;
            
            // Check for clickable indicators
            if (parent.tagName === 'A') {
              parent.click();
              return 'clicked_link';
            }
            var role = parent.getAttribute('role');
            if (role === 'button' || role === 'listitem' || role === 'row') {
              parent.click();
              return 'clicked_role';
            }
            var style = window.getComputedStyle(parent);
            if (style.cursor === 'pointer') {
              parent.click();
              return 'clicked_pointer';
            }
          }
        }
      }
      
      // Method 2: Find img with profile picture, then click its container
      var imgs = document.querySelectorAll('img[alt*="profile picture"]');
      for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        var container = img.closest('div');
        if (container) {
          var containerText = container.innerText || '';
          if (containerText.indexOf(searchName) !== -1) {
            // Find clickable parent
            var parent = container;
            for (var j = 0; j < 8; j++) {
              if (!parent.parentElement) break;
              parent = parent.parentElement;
              if (parent.getAttribute('role') === 'button' || parent.tagName === 'A') {
                parent.click();
                return 'clicked_img_parent';
              }
            }
            container.click();
            return 'clicked_img_container';
          }
        }
      }
      
      return 'not_found';
    })()
  `);
  
  return result.includes('clicked');
}

async function extractMessages(): Promise<{ text: string; isOutbound: boolean }[]> {
  const result = await exec(`
    (function() {
      var messages = [];
      var seen = {};
      var pageText = document.body.innerText;
      var lines = pageText.split(String.fromCharCode(10));
      
      // Find where conversation panel starts - after a username handle like "saraheashley"
      var convStartIdx = -1;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        // Username handle pattern (lowercase, dots, underscores, numbers)
        if (line.match(/^[a-z0-9._]+$/) && line.length > 5 && line.length < 25) {
          convStartIdx = i;
        }
      }
      
      if (convStartIdx === -1) {
        return JSON.stringify([]);
      }
      
      // Extract messages after the conversation panel starts
      var skipPatterns = ['Message...', 'Primary', 'General', 'Request', 'Active', 'Unread',
        'the_isaiah_dupree', 'Note', 'YouTube', 'Send', 'Type', 'Reply'];
      
      for (var i = convStartIdx + 1; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.length < 3) continue;
        
        // Skip timestamps
        if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Yesterday)/.test(line)) continue;
        if (/^[0-9]{1,2}:[0-9]{2}/.test(line)) continue;
        if (/^[0-9]+[wdhm]$/.test(line)) continue;
        if (line === '·') continue;
        
        // Skip username handles (shared by users)
        if (line.match(/^[a-z0-9._]+$/) && line.length < 25) continue;
        
        // Skip UI patterns
        var skip = false;
        for (var j = 0; j < skipPatterns.length; j++) {
          if (line === skipPatterns[j] || line.indexOf(skipPatterns[j]) === 0) {
            skip = true; break;
          }
        }
        if (skip) continue;
        
        // Skip inbox preview patterns
        if (line.indexOf(' sent ') !== -1) continue;
        if (line.indexOf('You:') !== -1) continue;
        if (line.indexOf('|') !== -1) continue;
        
        // This should be a message!
        if (line.length > 3 && line.length < 1000 && !seen[line]) {
          seen[line] = true;
          // Outbound = we sent it (typically starts with greeting or contains our content)
          var isOutbound = true; // Default to outbound for now
          messages.push({ text: line, isOutbound: isOutbound });
        }
      }
      
      return JSON.stringify(messages.slice(0, 50));
    })()
  `);
  
  try {
    return JSON.parse(result || '[]');
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
        tags: ['extracted'],
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
  
  // Save messages (check for duplicates)
  let saved = 0;
  for (const msg of messages) {
    if (!msg.text || msg.text.length < 2) continue;
    
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
  
  // Update contact last message time
  await supabase
    .from('instagram_contacts')
    .update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id);
  
  return saved;
}

async function main() {
  console.log('\n📬 Extracting All Chat Data\n');
  console.log('='.repeat(60) + '\n');
  
  // Check Safari
  try {
    await safari<{ status: string }>('/health');
    console.log('✅ Safari server connected\n');
  } catch {
    console.error('❌ Safari server not available');
    process.exit(1);
  }
  
  // Navigate to inbox
  console.log('📬 Navigating to inbox...');
  await safari('/api/inbox/navigate', 'POST');
  await wait(2000);
  
  // Reset scroll
  await exec(`(function(){ var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s"); if(c) c.scrollTop = 0; })()`);
  await wait(1000);
  
  const stats = {
    contactsProcessed: 0,
    messagesExtracted: 0,
    messagesSaved: 0,
    errors: [] as string[],
  };
  
  // Collect all contacts by scrolling
  console.log('📜 Collecting all contacts...\n');
  const allContacts = new Set<string>();
  
  for (let scroll = 0; scroll < 30; scroll++) {
    const contacts = await getVisibleContacts();
    contacts.forEach(c => allContacts.add(c));
    
    await exec(`(function(){ var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s"); if(c) c.scrollTop += 400; })()`);
    await wait(800);
    
    if (scroll > 3) {
      const newContacts = await getVisibleContacts();
      let hasNew = false;
      for (const c of newContacts) {
        if (!allContacts.has(c)) {
          hasNew = true;
          break;
        }
      }
      if (!hasNew) break;
    }
  }
  
  const contactList = Array.from(allContacts);
  console.log(`Found ${contactList.length} contacts\n`);
  
  // Process each contact
  for (let i = 0; i < contactList.length; i++) {
    const contact = contactList[i];
    console.log(`[${i + 1}/${contactList.length}] ${contact}`);
    
    try {
      // Navigate back to inbox
      await safari('/api/inbox/navigate', 'POST');
      await wait(1500);
      
      // Scroll to find the contact
      await exec(`(function(){ var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s"); if(c) c.scrollTop = 0; })()`);
      await wait(500);
      
      // Try to find and click the contact
      let clicked = false;
      for (let scroll = 0; scroll < 20 && !clicked; scroll++) {
        clicked = await clickContact(contact);
        if (!clicked) {
          await exec(`(function(){ var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s"); if(c) c.scrollTop += 300; })()`);
          await wait(400);
        }
      }
      
      if (!clicked) {
        console.log(`  ⚠️ Could not find conversation`);
        stats.errors.push(`${contact}: not found`);
        continue;
      }
      
      // IMPORTANT: Wait longer for conversation to fully load
      await wait(4000);
      
      // Extract messages
      const messages = await extractMessages();
      stats.messagesExtracted += messages.length;
      
      if (messages.length === 0) {
        console.log(`  ⚠️ No messages found`);
        continue;
      }
      
      // Save to database
      const saved = await saveMessages(contact, messages);
      stats.messagesSaved += saved;
      stats.contactsProcessed++;
      
      console.log(`  ✅ ${messages.length} messages extracted, ${saved} new saved`);
      
    } catch (error) {
      console.log(`  ❌ Error: ${error}`);
      stats.errors.push(`${contact}: ${error}`);
    }
    
    // Longer delay between contacts for rate limiting
    await wait(1500);
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60) + '\n');
  
  console.log(`Contacts processed:   ${stats.contactsProcessed}`);
  console.log(`Messages extracted:   ${stats.messagesExtracted}`);
  console.log(`New messages saved:   ${stats.messagesSaved}`);
  console.log(`Errors:               ${stats.errors.length}`);
  
  if (stats.errors.length > 0) {
    console.log('\nFirst 5 errors:');
    stats.errors.slice(0, 5).forEach(e => console.log(`  - ${e}`));
  }
  
  // Database totals
  const { count: contactCount } = await supabase.from('instagram_contacts').select('*', { count: 'exact', head: true });
  const { count: msgCount } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  
  console.log('\n📋 Database Totals:');
  console.log(`  Total contacts: ${contactCount}`);
  console.log(`  Total messages: ${msgCount}`);
  
  console.log('\n✨ Extraction complete!\n');
}

main().catch(console.error);
