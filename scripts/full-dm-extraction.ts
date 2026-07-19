/**
 * Full Instagram DM Extraction
 * Scrolls through all conversations, clicks into each, and extracts all data
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

// ===== SELECTORS =====

const SELECTORS = {
  // Conversation list items - multiple approaches
  conversationRows: `
    document.querySelectorAll('div[role="listitem"], div[role="row"], a[href*="/direct/t/"]')
  `,
  
  // Extract usernames from conversation list using page text
  extractUsernames: `
    (function() {
      var usernames = [];
      var pageText = document.body.innerText;
      var lines = pageText.split('\\n');
      
      // Known UI elements to skip
      var skipWords = ['Primary', 'General', 'Requests', 'Messages', 'Note', 'Your note', 
        'Your messages', 'Send message', 'Search', 'Unread', 'Active', 'ago', 'Instagram',
        'the_isaiah_dupree', 'Hidden Requests', 'Decide who'];
      
      // Find display names (names before "sent" or message preview)
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        
        // Skip empty or very short lines
        if (!line || line.length < 2 || line.length > 60) continue;
        
        // Skip known UI text
        var skip = false;
        for (var j = 0; j < skipWords.length; j++) {
          if (line === skipWords[j] || line.startsWith(skipWords[j])) {
            skip = true;
            break;
          }
        }
        if (skip) continue;
        
        // Skip message previews (contain certain patterns)
        if (line.includes(' sent ') || line.includes('You:') || line.includes('·') ||
            line.includes('http') || line.includes('Looking') || line.includes('Hey') ||
            line.includes('voice message') || line.includes('attachment') ||
            /^\\d+[wdhm]$/.test(line)) continue;
        
        // Likely a display name if it's a standalone name-like string
        if (/^[A-Za-z]/.test(line) && !line.includes('  ')) {
          // Clean up display names with | or emoji
          var name = line.split('|')[0].trim().split(' 🍄')[0].split(' ⭐')[0].trim();
          if (name.length > 1 && name.length < 40 && !usernames.includes(name)) {
            usernames.push(name);
          }
        }
      }
      
      return JSON.stringify(usernames);
    })()
  `,
  
  // Scroll the conversation list
  scrollConversationList: `
    (function() {
      var container = document.querySelector('div[role="list"]') || 
                      document.querySelector('[class*="inbox"]') ||
                      document.querySelector('div[style*="overflow"]');
      
      if (!container) {
        // Try finding scrollable parent of conversation items
        var items = document.querySelectorAll('div[role="listitem"], div[role="row"]');
        if (items.length > 0) {
          container = items[0].parentElement;
          while (container && container.scrollHeight <= container.clientHeight) {
            container = container.parentElement;
          }
        }
      }
      
      if (container) {
        container.scrollTop += 500;
        return 'scrolled';
      }
      
      // Fallback: scroll window
      window.scrollBy(0, 500);
      return 'window_scrolled';
    })()
  `,
  
  // Click conversation by index
  clickConversation: (index: number) => `
    (function() {
      var items = document.querySelectorAll('div[role="listitem"], div[role="row"], a[href*="/direct/t/"]');
      if (items[${index}]) {
        items[${index}].click();
        return 'clicked_' + ${index};
      }
      return 'not_found';
    })()
  `,
  
  // Click conversation by display name
  clickByUsername: (displayName: string) => `
    (function() {
      // Find all clickable elements containing the display name
      var allEls = document.querySelectorAll('div, span, a');
      
      for (var i = 0; i < allEls.length; i++) {
        var el = allEls[i];
        var text = el.innerText || '';
        
        // Check if this element contains our display name
        if (text.includes('${displayName}')) {
          // Find the closest clickable parent that looks like a conversation row
          var parent = el;
          for (var j = 0; j < 10; j++) {
            if (!parent || !parent.parentElement) break;
            parent = parent.parentElement;
            
            // Check if this is a clickable row
            var style = window.getComputedStyle(parent);
            if (parent.tagName === 'A' || 
                parent.getAttribute('role') === 'button' ||
                parent.getAttribute('role') === 'listitem' ||
                parent.getAttribute('role') === 'row' ||
                style.cursor === 'pointer') {
              parent.click();
              return 'clicked';
            }
          }
          
          // Try clicking the element itself
          el.click();
          return 'clicked_direct';
        }
      }
      
      return 'not_found';
    })()
  `,
  
  // Extract messages from open conversation
  extractMessages: `
    (function() {
      var messages = [];
      
      // Message containers
      var msgEls = document.querySelectorAll('div[dir="auto"], span[dir="auto"]');
      
      msgEls.forEach(function(el) {
        var text = (el.innerText || '').trim();
        if (text.length > 2 && text.length < 2000) {
          // Skip UI elements
          if (text === 'Messages' || text === 'Primary' || text === 'General' || 
              text === 'Requests' || text.includes('Active') || text.includes('ago')) {
            return;
          }
          
          // Determine if outbound by checking position/styling
          var rect = el.getBoundingClientRect();
          var isOutbound = rect.left > window.innerWidth / 2;
          
          messages.push({
            text: text.substring(0, 500),
            isOutbound: isOutbound
          });
        }
      });
      
      // Deduplicate
      var seen = new Set();
      messages = messages.filter(function(m) {
        if (seen.has(m.text)) return false;
        seen.add(m.text);
        return true;
      });
      
      return JSON.stringify(messages.slice(0, 50));
    })()
  `,
  
  // Get current conversation username
  getCurrentUsername: `
    (function() {
      // Look for username in header
      var header = document.querySelector('header, [role="banner"]');
      if (header) {
        var spans = header.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var text = spans[i].innerText || '';
          if (text && /^[a-zA-Z0-9._]+$/.test(text) && text.length > 1 && text.length < 30) {
            return text;
          }
        }
      }
      
      // Try profile picture alt
      var img = document.querySelector('img[alt*="profile picture"]');
      if (img) {
        var alt = img.getAttribute('alt') || '';
        return alt.replace("'s profile picture", '').trim();
      }
      
      return '';
    })()
  `,
  
  // Switch tab
  switchTab: (tab: string) => `
    (function() {
      var tabs = document.querySelectorAll('[role="tab"], button, a');
      for (var i = 0; i < tabs.length; i++) {
        var text = (tabs[i].innerText || '').toLowerCase();
        if (text.includes('${tab.toLowerCase()}')) {
          tabs[i].click();
          return 'clicked_' + text;
        }
      }
      return 'not_found';
    })()
  `,
  
  // Click Hidden Requests
  clickHiddenRequests: `
    (function() {
      var els = document.querySelectorAll('div, span, a');
      for (var i = 0; i < els.length; i++) {
        if ((els[i].innerText || '').includes('Hidden Requests')) {
          els[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `,
};

// ===== EXTRACTION FUNCTIONS =====

async function scrollAndCollectUsernames(maxScrolls = 10): Promise<string[]> {
  const allUsernames = new Set<string>();
  
  for (let i = 0; i < maxScrolls; i++) {
    // Use the working API endpoint
    const result = await safari<{ conversations: { username: string }[]; count: number }>('/api/conversations');
    
    result.conversations.forEach(c => {
      if (c.username && c.username.length > 1) {
        allUsernames.add(c.username);
      }
    });
    
    console.log(`  Scroll ${i + 1}: Found ${allUsernames.size} total contacts`);
    
    // Scroll down
    await exec(SELECTORS.scrollConversationList);
    await wait(1500);
    
    // Check if we found new ones
    const prevCount = allUsernames.size;
    const newResult = await safari<{ conversations: { username: string }[]; count: number }>('/api/conversations');
    newResult.conversations.forEach(c => {
      if (c.username && c.username.length > 1) {
        allUsernames.add(c.username);
      }
    });
    
    if (allUsernames.size === prevCount && i > 2) {
      console.log('  No new contacts found, stopping scroll');
      break;
    }
  }
  
  return Array.from(allUsernames);
}

async function extractConversationData(username: string): Promise<{
  messages: { text: string; isOutbound: boolean }[];
  error?: string;
}> {
  try {
    // Click on conversation
    const clickResult = await exec(SELECTORS.clickByUsername(username));
    
    if (clickResult === 'not_found') {
      return { messages: [], error: 'Could not find conversation' };
    }
    
    await wait(2000);
    
    // Extract messages
    const messagesJson = await exec(SELECTORS.extractMessages);
    const messages = JSON.parse(messagesJson) as { text: string; isOutbound: boolean }[];
    
    return { messages };
  } catch (error) {
    return { messages: [], error: String(error) };
  }
}

async function saveToDatabase(
  username: string,
  tab: string,
  messages: { text: string; isOutbound: boolean }[]
): Promise<{ contactId: string; saved: number }> {
  // Upsert contact
  const { data: existingContact } = await supabase
    .from('instagram_contacts')
    .select('id')
    .eq('instagram_username', username)
    .single();
  
  let contactId: string;
  
  if (existingContact) {
    contactId = existingContact.id;
  } else {
    const { data: newContact, error } = await supabase
      .from('instagram_contacts')
      .insert({
        instagram_username: username,
        relationship_score: 50,
        pipeline_stage: 'first_touch',
        fit_signals: [],
        tags: [tab],
      })
      .select('id')
      .single();
    
    if (error) throw error;
    contactId = newContact!.id;
  }
  
  // Get or create conversation
  let conversationId: string;
  const { data: existingConv } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contactId)
    .single();
  
  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: newConv } = await supabase
      .from('instagram_conversations')
      .insert({
        contact_id: contactId,
        dm_tab: tab,
        last_message_preview: messages[0]?.text?.substring(0, 100),
      })
      .select('id')
      .single();
    
    conversationId = newConv!.id;
  }
  
  // Save messages (check for duplicates)
  let saved = 0;
  for (const msg of messages) {
    if (!msg.text || msg.text.length < 2) continue;
    
    const { data: existing } = await supabase
      .from('instagram_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('message_text', msg.text.substring(0, 500))
      .limit(1);
    
    if (!existing || existing.length === 0) {
      await supabase.from('instagram_messages').insert({
        conversation_id: conversationId,
        contact_id: contactId,
        message_text: msg.text.substring(0, 2000),
        message_type: 'text',
        is_outbound: msg.isOutbound,
        sent_by_automation: false,
      });
      saved++;
    }
  }
  
  // Update contact stats
  const inbound = messages.filter(m => !m.isOutbound).length;
  const outbound = messages.filter(m => m.isOutbound).length;
  
  await supabase
    .from('instagram_contacts')
    .update({
      last_message_at: new Date().toISOString(),
      total_messages_received: inbound,
      total_messages_sent: outbound,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);
  
  return { contactId, saved };
}

// ===== MAIN EXTRACTION =====

async function fullExtraction() {
  console.log('\n🔄 Full Instagram DM Extraction\n');
  console.log('='.repeat(60) + '\n');
  
  // Check Safari
  try {
    await safari<{ status: string }>('/health');
    console.log('✅ Safari server connected\n');
  } catch {
    console.error('❌ Safari server not available');
    process.exit(1);
  }
  
  const stats = {
    totalContacts: 0,
    totalMessages: 0,
    tabs: {} as Record<string, { contacts: number; messages: number }>,
    errors: [] as string[],
  };
  
  const tabs = [
    { name: 'primary', label: 'Primary' },
    { name: 'general', label: 'General' },
    { name: 'requests', label: 'Requests' },
  ];
  
  // Navigate to inbox
  console.log('📬 Navigating to inbox...');
  await safari('/api/inbox/navigate', 'POST');
  await wait(3000);
  
  for (const tab of tabs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📁 Processing ${tab.label.toUpperCase()} tab`);
    console.log('='.repeat(60) + '\n');
    
    stats.tabs[tab.name] = { contacts: 0, messages: 0 };
    
    // Switch tab
    await exec(SELECTORS.switchTab(tab.name));
    await wait(2000);
    
    // Scroll and collect all usernames
    console.log('📜 Scrolling to find all conversations...');
    const usernames = await scrollAndCollectUsernames(15);
    console.log(`\n✅ Found ${usernames.length} contacts in ${tab.label}\n`);
    
    // Process each conversation
    for (let i = 0; i < usernames.length; i++) {
      const username = usernames[i];
      console.log(`[${i + 1}/${usernames.length}] @${username}`);
      
      try {
        // Navigate back to list (in case we're in a conversation)
        await safari('/api/inbox/navigate', 'POST');
        await wait(1500);
        await exec(SELECTORS.switchTab(tab.name));
        await wait(1500);
        
        // Extract conversation data
        const { messages, error } = await extractConversationData(username);
        
        if (error) {
          console.log(`  ⚠️ ${error}`);
          stats.errors.push(`${username}: ${error}`);
          continue;
        }
        
        if (messages.length === 0) {
          console.log(`  ⚠️ No messages found`);
          continue;
        }
        
        // Save to database
        const { saved } = await saveToDatabase(username, tab.name, messages);
        
        console.log(`  ✅ ${messages.length} messages extracted, ${saved} new saved`);
        
        stats.totalContacts++;
        stats.totalMessages += messages.length;
        stats.tabs[tab.name].contacts++;
        stats.tabs[tab.name].messages += messages.length;
        
      } catch (error) {
        console.log(`  ❌ Error: ${error}`);
        stats.errors.push(`${username}: ${error}`);
      }
      
      // Rate limiting delay
      await wait(1000);
    }
  }
  
  // Try Hidden Requests
  console.log(`\n${'='.repeat(60)}`);
  console.log('📁 Checking HIDDEN REQUESTS');
  console.log('='.repeat(60) + '\n');
  
  await exec(SELECTORS.switchTab('requests'));
  await wait(2000);
  const hiddenResult = await exec(SELECTORS.clickHiddenRequests);
  
  if (hiddenResult === 'clicked') {
    await wait(2000);
    const hiddenUsernames = await scrollAndCollectUsernames(5);
    console.log(`Found ${hiddenUsernames.length} hidden request contacts`);
    
    stats.tabs['hidden_requests'] = { contacts: hiddenUsernames.length, messages: 0 };
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('='.repeat(60) + '\n');
  
  console.log(`Total contacts processed: ${stats.totalContacts}`);
  console.log(`Total messages extracted: ${stats.totalMessages}`);
  console.log(`Errors: ${stats.errors.length}`);
  
  console.log('\nPer-tab breakdown:');
  for (const [tab, data] of Object.entries(stats.tabs)) {
    console.log(`  ${tab}: ${data.contacts} contacts, ${data.messages} messages`);
  }
  
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

fullExtraction().catch(console.error);
