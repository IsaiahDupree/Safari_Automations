/**
 * Extract DMs from a specific tab (Primary, General, Requests)
 * Saves all messages to Supabase database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

type DMTab = 'Primary' | 'General' | 'Requests';

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
  return (await exec(script)).includes('clicked');
}

async function getVisibleContacts(): Promise<string[]> {
  const script = `(function(){
    var contacts = [];
    var seen = {};
    var text = document.body.innerText;
    var lines = text.split(String.fromCharCode(10));
    var skip = ["Primary", "General", "Requests", "Messages", "Note...", "Search", "Unread", "Active", "Message...", "Instagram", "Home", "Reels", "Explore", "Notifications", "Create", "Dashboard", "Profile", "More", "Your note", "Your messages", "Send message", "Send a message", "YouTube", "Message requests", "Hidden Requests", "Decide who", "Delete all", "Open a chat"];
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
      if(l.includes("These messages")) continue;
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
  return (await exec(script)).includes('clicked');
}

async function scrollMessagesUp(): Promise<void> {
  await exec(`(function(){
    var c = document.querySelectorAll("div");
    for(var i = 0; i < c.length; i++){
      if(c[i].scrollHeight > 1500 && c[i].clientHeight > 400){
        c[i].scrollBy(0, -5000);
        return "scrolled";
      }
    }
    return "none";
  })()`);
}

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
      if(["Active", "Unread", "View profile", "See Post", "Instagram", "Loading...", "Accept", "Delete", "Block"].indexOf(l) !== -1) continue;
      if(l.length > 5 && l.length < 1000 && !seen[l]){
        seen[l] = true;
        var isOut = l.indexOf("Test") !== -1 || l.indexOf("I ") === 0 || l.indexOf("Hey ") === 0;
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

async function saveToDatabase(
  contactName: string, 
  handle: string | null, 
  messages: { text: string; isOutbound: boolean }[],
  tab: DMTab
): Promise<number> {
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
        tags: handle ? ['dm_extracted', `handle:${handle}`, `tab:${tab.toLowerCase()}`] : ['dm_extracted', `tab:${tab.toLowerCase()}`],
      })
      .select('id')
      .single();
    contact = newContact;
  }
  
  if (!contact) return 0;
  
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
        dm_tab: tab.toLowerCase(),
        last_message_preview: messages[0]?.text?.substring(0, 100),
      })
      .select('id')
      .single();
    conv = newConv;
  }
  
  if (!conv) return 0;
  
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

async function extractTab(tab: DMTab): Promise<void> {
  console.log(`\n📬 Extracting ${tab} tab...\n`);
  
  await navigateToInbox();
  await wait(2000);
  
  if (tab !== 'Primary') {
    const switched = await switchTab(tab);
    if (!switched) {
      console.log(`❌ Failed to switch to ${tab} tab`);
      return;
    }
    await wait(2000);
  }
  
  const contacts = await getVisibleContacts();
  console.log(`Found ${contacts.length} contacts in ${tab}\n`);
  
  let totalMessages = 0;
  let totalSaved = 0;
  
  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    process.stdout.write(`[${i + 1}/${contacts.length}] ${contact.padEnd(35)}`);
    
    // Navigate back to tab
    await navigateToInbox();
    await wait(1000);
    if (tab !== 'Primary') {
      await switchTab(tab);
      await wait(1000);
    }
    
    if (!(await clickContact(contact))) {
      console.log('❌ not found');
      continue;
    }
    
    await wait(3000);
    await scrollMessagesUp();
    await wait(800);
    
    const handle = await findHandle();
    if (!handle) {
      console.log('❌ no handle');
      continue;
    }
    
    const messages = await extractMessages(handle);
    if (messages.length === 0) {
      console.log(`❌ no messages (@${handle})`);
      continue;
    }
    
    const saved = await saveToDatabase(contact, handle, messages, tab);
    totalMessages += messages.length;
    totalSaved += saved;
    
    console.log(`✅ @${handle} | ${messages.length} msgs, ${saved} saved`);
  }
  
  console.log(`\n📊 ${tab} Summary: ${totalMessages} messages found, ${totalSaved} saved`);
}

async function main() {
  const tab = process.argv[2] as DMTab;
  
  if (!tab || !['Primary', 'General', 'Requests'].includes(tab)) {
    console.log('Usage: npx tsx scripts/extract-tab-dms.ts <Primary|General|Requests>');
    return;
  }
  
  await extractTab(tab);
  
  const { count } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  console.log(`\n📊 Total messages in database: ${count}`);
}

main().catch(console.error);
