/**
 * Instagram DM Automation - Complete Toolkit
 * 
 * Comprehensive automation for Instagram DMs including:
 * - Navigate between tabs (Primary, General, Requests, Hidden)
 * - Extract messages from all contacts
 * - Send messages
 * - Get conversation info
 * 
 * Patterns discovered and documented: 2026-01-31
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ============== Tab Navigation ==============

type DMTab = 'Primary' | 'General' | 'Requests';

/**
 * Switch to a specific DM tab
 * Pattern: [role="tab"] with innerText containing tab name
 */
async function switchTab(tab: DMTab): Promise<boolean> {
  const script = `(function(){
    var tabs = document.querySelectorAll("[role=tab]");
    for(var i=0; i<tabs.length; i++){
      if(tabs[i].innerText.includes("${tab}")){
        tabs[i].click();
        return "clicked";
      }
    }
    return "not found";
  })()`;
  
  const result = await exec(script);
  return result.includes('clicked');
}

/**
 * Navigate to Hidden Requests
 * Pattern: Click element containing "Hidden Requests" text
 */
async function goToHiddenRequests(): Promise<boolean> {
  // First go to Requests tab
  await switchTab('Requests');
  await wait(1500);
  
  const script = `(function(){
    var els = document.querySelectorAll("a, div, span");
    for(var i=0; i<els.length; i++){
      if((els[i].innerText||"").includes("Hidden Requests")){
        els[i].click();
        return "clicked";
      }
    }
    return "not found";
  })()`;
  
  const result = await exec(script);
  return result.includes('clicked');
}

/**
 * Get current tab info
 */
async function getTabInfo(): Promise<{ name: string; selected: boolean; count?: number }[]> {
  const script = `(function(){
    var tabs = document.querySelectorAll("[role=tab]");
    var info = [];
    for(var i=0; i<tabs.length; i++){
      var text = tabs[i].innerText.trim();
      var match = text.match(/\\((\\d+)\\)/);
      info.push({
        name: text.replace(/\\s*\\(\\d+\\)/, "").trim(),
        selected: tabs[i].getAttribute("aria-selected") === "true",
        count: match ? parseInt(match[1]) : null
      });
    }
    return JSON.stringify(info);
  })()`;
  
  try {
    return JSON.parse(await exec(script));
  } catch {
    return [];
  }
}

// ============== Contact Operations ==============

/**
 * Get all visible contacts from current tab
 * Pattern: Parse page text for names starting with capital letters
 */
async function getVisibleContacts(): Promise<string[]> {
  const script = `(function(){
    var contacts = [];
    var seen = {};
    var text = document.body.innerText;
    var lines = text.split(String.fromCharCode(10));
    var skip = ["Primary", "General", "Requests", "Messages", "Note...", "Search", "Unread", "Active", "Message...", "Instagram", "Home", "Reels", "Explore", "Notifications", "Create", "Dashboard", "Profile", "More", "Your note", "Your messages", "Send message", "Send a message", "YouTube", "Message requests", "Hidden Requests", "Decide who", "Delete all"];
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
 * Click on a contact to open conversation
 * Pattern: Find span with exact or prefix match
 */
async function clickContact(name: string): Promise<boolean> {
  const escapedName = name.replace(/'/g, "\\'").replace(/[|]/g, '');
  
  const script = `(function(){
    var spans = document.querySelectorAll("span");
    for(var i = 0; i < spans.length; i++){
      var t = spans[i].innerText;
      if(t === "${escapedName}" || (t && t.indexOf("${escapedName}") === 0 && t.length < 60)){
        spans[i].click();
        return "clicked";
      }
    }
    return "not found";
  })()`;
  
  const result = await exec(script);
  return result.includes('clicked');
}

/**
 * Scroll inbox to load more contacts
 * Pattern: div.xb57i2i.x1q594ok.x5lxg6s scrollTop
 */
async function scrollInbox(amount: number = 1500): Promise<void> {
  await exec(`(function(){
    var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s");
    if(c) c.scrollTop += ${amount};
    return "scrolled";
  })()`);
}

// ============== Message Operations ==============

/**
 * Scroll message container to load older messages
 * Pattern: Find div with scrollHeight > 1500, use scrollBy(0, -N)
 */
async function scrollMessagesUp(amount: number = 5000): Promise<boolean> {
  const script = `(function(){
    var c = document.querySelectorAll("div");
    for(var i = 0; i < c.length; i++){
      if(c[i].scrollHeight > 1500 && c[i].clientHeight > 400){
        c[i].scrollBy(0, -${amount});
        return "scrolled";
      }
    }
    return "none";
  })()`;
  
  const result = await exec(script);
  return result.includes('scrolled');
}

/**
 * Find username handle in conversation
 * Pattern: Lowercase string matching /^[a-z0-9._]+$/, 5-25 chars
 */
async function findHandle(): Promise<string | null> {
  const script = `(function(){
    var t = document.body.innerText;
    var lines = t.split(String.fromCharCode(10));
    for(var i = 0; i < lines.length; i++){
      var l = lines[i].trim();
      if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== "the_isaiah_dupree"){
        return l;
      }
    }
    return "";
  })()`;
  
  return (await exec(script)) || null;
}

/**
 * Extract messages from current conversation
 * Pattern: Get text after handle, skip UI elements and metadata
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
      if(l.includes("sent a video")) continue;
      if(l.includes(" · ")) continue;
      if(l === "·") continue;
      if(["Active", "Unread", "View profile", "See Post", "Instagram", "Loading..."].indexOf(l) !== -1) continue;
      if(l.length > 5 && l.length < 1000 && !seen[l]){
        seen[l] = true;
        var isOut = l.indexOf("Test") !== -1 || l.indexOf("I ") === 0 || l.indexOf("I built") !== -1;
        messages.push({ text: l, isOutbound: isOut });
      }
    }
    return JSON.stringify(messages);
  })()`;
  
  try {
    return JSON.parse(await exec(script) || '[]');
  } catch {
    return [];
  }
}

/**
 * Send a message in current conversation
 * Pattern: Find textbox[role=textbox], insert text, click Send button
 */
async function sendMessage(text: string): Promise<boolean> {
  // Focus textbox and insert text
  const typeScript = `(function(){
    var textbox = document.querySelector("[role=textbox]");
    if(!textbox) return "no textbox";
    textbox.focus();
    document.execCommand("insertText", false, "${text.replace(/"/g, '\\"')}");
    return "typed";
  })()`;
  
  const typed = await exec(typeScript);
  if (!typed.includes('typed')) return false;
  
  await wait(500);
  
  // Click send button
  const sendScript = `(function(){
    var parent = document.querySelector("[role=textbox]").parentElement.parentElement.parentElement;
    var btns = parent.querySelectorAll("[aria-label]");
    for(var i=0; i<btns.length; i++){
      if(btns[i].getAttribute("aria-label") === "Send"){
        btns[i].click();
        return "sent";
      }
    }
    return "no send btn";
  })()`;
  
  const sent = await exec(sendScript);
  return sent.includes('sent');
}

/**
 * Get conversation info (actions available)
 * Pattern: aria-labels near conversation header
 */
async function getConversationInfo(): Promise<{
  contactName: string | null;
  handle: string | null;
  actions: string[];
}> {
  const script = `(function(){
    var info = { contactName: null, handle: null, actions: [] };
    
    // Get contact name from conversation header
    var convLabel = document.querySelector("[aria-label*='Conversation with']");
    if(convLabel){
      var label = convLabel.getAttribute("aria-label");
      info.contactName = label.replace("Conversation with ", "");
    }
    
    // Get handle
    var t = document.body.innerText;
    var lines = t.split(String.fromCharCode(10));
    for(var i = 0; i < lines.length; i++){
      var l = lines[i].trim();
      if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== "the_isaiah_dupree"){
        info.handle = l;
        break;
      }
    }
    
    // Get available actions
    var actions = ["Audio call", "Video call", "Conversation information", "Add Photo or Video", "Voice Clip", "Choose a GIF or sticker"];
    for(var i=0; i<actions.length; i++){
      if(document.querySelector("[aria-label='" + actions[i] + "']")){
        info.actions.push(actions[i]);
      }
    }
    
    return JSON.stringify(info);
  })()`;
  
  try {
    return JSON.parse(await exec(script));
  } catch {
    return { contactName: null, handle: null, actions: [] };
  }
}

// ============== Status Indicators ==============

/**
 * Check if contact is active (online)
 * Pattern: "Active" text near contact name in inbox
 */
async function isContactActive(name: string): Promise<boolean> {
  const script = `(function(){
    var text = document.body.innerText;
    var idx = text.indexOf("${name}");
    if(idx === -1) return "false";
    var nearby = text.substring(Math.max(0, idx-50), idx+100);
    return nearby.includes("Active") ? "true" : "false";
  })()`;
  
  return (await exec(script)) === 'true';
}

/**
 * Check if conversation has unread messages
 * Pattern: "Unread" text near contact name
 */
async function hasUnread(name: string): Promise<boolean> {
  const script = `(function(){
    var text = document.body.innerText;
    var idx = text.indexOf("${name}");
    if(idx === -1) return "false";
    var nearby = text.substring(idx, idx+200);
    return nearby.includes("Unread") ? "true" : "false";
  })()`;
  
  return (await exec(script)) === 'true';
}

// ============== CLI Interface ==============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('\n📱 Instagram DM Automation Toolkit\n');
  
  switch (command) {
    case 'tabs':
      await navigateToInbox();
      await wait(2000);
      const tabs = await getTabInfo();
      console.log('DM Tabs:');
      tabs.forEach(t => console.log(`  ${t.selected ? '▶' : ' '} ${t.name}${t.count ? ` (${t.count})` : ''}`));
      break;
      
    case 'switch':
      const tab = args[1] as DMTab;
      if (!['Primary', 'General', 'Requests'].includes(tab)) {
        console.log('Usage: switch <Primary|General|Requests>');
        break;
      }
      await navigateToInbox();
      await wait(1500);
      const switched = await switchTab(tab);
      console.log(switched ? `✅ Switched to ${tab}` : `❌ Failed to switch to ${tab}`);
      break;
      
    case 'hidden':
      await navigateToInbox();
      await wait(1500);
      const hidden = await goToHiddenRequests();
      console.log(hidden ? '✅ Opened Hidden Requests' : '❌ Failed to open Hidden Requests');
      break;
      
    case 'contacts':
      const tabArg = (args[1] as DMTab) || 'Primary';
      await navigateToInbox();
      await wait(2000);
      if (tabArg !== 'Primary') {
        await switchTab(tabArg);
        await wait(1500);
      }
      const contacts = await getVisibleContacts();
      console.log(`Contacts in ${tabArg} (${contacts.length}):`);
      contacts.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
      break;
      
    case 'open':
      const contactName = args.slice(1).join(' ');
      if (!contactName) {
        console.log('Usage: open <contact name>');
        break;
      }
      await navigateToInbox();
      await wait(2000);
      const clicked = await clickContact(contactName);
      if (clicked) {
        await wait(3000);
        const info = await getConversationInfo();
        console.log(`✅ Opened conversation with ${contactName}`);
        console.log(`   Handle: ${info.handle || 'unknown'}`);
        console.log(`   Actions: ${info.actions.join(', ')}`);
      } else {
        console.log(`❌ Contact "${contactName}" not found`);
      }
      break;
      
    case 'extract':
      const extractName = args.slice(1).join(' ');
      if (!extractName) {
        console.log('Usage: extract <contact name>');
        break;
      }
      await navigateToInbox();
      await wait(2000);
      if (await clickContact(extractName)) {
        await wait(3000);
        await scrollMessagesUp();
        await wait(1000);
        const handle = await findHandle();
        if (handle) {
          const messages = await extractMessages(handle);
          console.log(`✅ Extracted ${messages.length} messages from ${extractName} (@${handle})`);
          messages.slice(0, 10).forEach((m, i) => {
            console.log(`  ${i + 1}. ${m.isOutbound ? '→' : '←'} ${m.text.substring(0, 60)}...`);
          });
        } else {
          console.log('❌ Could not find handle');
        }
      } else {
        console.log(`❌ Contact "${extractName}" not found`);
      }
      break;
      
    case 'send':
      const sendTo = args[1];
      const message = args.slice(2).join(' ');
      if (!sendTo || !message) {
        console.log('Usage: send <contact> <message>');
        break;
      }
      await navigateToInbox();
      await wait(2000);
      if (await clickContact(sendTo)) {
        await wait(2000);
        const sent = await sendMessage(message);
        console.log(sent ? `✅ Sent message to ${sendTo}` : `❌ Failed to send message`);
      } else {
        console.log(`❌ Contact "${sendTo}" not found`);
      }
      break;
      
    default:
      console.log('Commands:');
      console.log('  tabs                    - Show DM tabs info');
      console.log('  switch <tab>            - Switch to Primary/General/Requests');
      console.log('  hidden                  - Open Hidden Requests');
      console.log('  contacts [tab]          - List contacts in tab');
      console.log('  open <name>             - Open conversation');
      console.log('  extract <name>          - Extract messages from contact');
      console.log('  send <name> <message>   - Send message to contact');
  }
}

main().catch(console.error);
