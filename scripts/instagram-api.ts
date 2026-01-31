/**
 * Instagram Automation API
 * 
 * Unified system for username-based operations:
 * - Profile data extraction
 * - Conversation history extraction  
 * - Direct messaging
 * 
 * Usage:
 *   npx tsx scripts/instagram-api.ts profile <username>
 *   npx tsx scripts/instagram-api.ts messages <username>
 *   npx tsx scripts/instagram-api.ts dm <username> <message>
 *   npx tsx scripts/instagram-api.ts full <username>
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============== Database Pattern Loading ==============

let dbPatternsLoaded = false;
let DB_KNOWN_HANDLES: Record<string, string> = {};

async function loadPatternsFromDatabase(): Promise<void> {
  if (dbPatternsLoaded) return;
  
  try {
    const { data: handles } = await supabase
      .from('automation_patterns')
      .select('pattern_key, pattern_value')
      .eq('pattern_type', 'known_handle')
      .eq('is_active', true);
    
    if (handles) {
      for (const h of handles) {
        DB_KNOWN_HANDLES[h.pattern_key] = h.pattern_value;
      }
    }
    dbPatternsLoaded = true;
  } catch (e) {
    // Fall back to hardcoded patterns
  }
}

// Get known handle from DB or fallback
function getKnownHandle(username: string): string | null {
  const clean = username.replace('@', '').toLowerCase();
  return DB_KNOWN_HANDLES[clean] || KNOWN_HANDLES[clean] || null;
}

// ============== Known Handle Mappings (from pattern discovery) ==============

const KNOWN_HANDLES: Record<string, string> = {
  // Handle -> Display Name
  'saraheashley': 'Sarah Ashley',
  'owentheaiguy': 'Owen Case',
  'day1marketing': 'Evan Dawson',
  'steveofallstreets': 'Steven Thiel',
  'sabrina_ramonov': 'Sabrina Ramonov',
  'chase.h.ai': 'Chase AI',
  'nateherkai': 'Nate Herk',
  'liamjohnston.ai': 'Liam Johnston',
  'cyphyr.ai': 'cyphyr.ai',
  'thrivewithangelak': 'Thrive with Angela K',
  'theexpandlab': 'Expand Lab',
  'alassafi.ai': 'Ahmed Alassafi',
  'nicolasboucherfinance': 'Nicolas Boucher',
  'startuparchive_': 'Startup Archive',
  'tonya.qualls': 'Tonya Qualls',
  'kenda.laney': 'Kenda Laney',
  'jeltz.green': 'Demetrius Jeltz-Green',
  'mrnotion.co': 'Mr. Notion',
  'officialjoelyi': 'Joel Yi',
  'andrew.sandler': 'Andrew Sandler',
  'the_adhd_entrepreneur': 'Brooo 100% agree',
  'nick_saraev': 'Nick Saraev',
  'jordanlee__': 'Jordan Lee',
  'michaelkitka': 'Michael Kitka',
  'haroonkhaans': 'HAROON KHAN',
  'tonygaskins': 'Tony Gaskins',
  'gaelevated': 'Georgia Elevated Motor Sales',
  'tech_me_stuff': 'TechMeStuff',
  'ninjaaitools': 'Brad Gaines',
  'dillonxlatham': 'Dillon Latham',
  'producergrind': 'ProducerGrind®',
};

// Reverse mapping: Display Name -> Handle
const DISPLAY_TO_HANDLE: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_HANDLES).map(([handle, name]) => [name.toLowerCase(), handle])
);

// ============== Skip Patterns (from pattern discovery) ==============

const UI_SKIP_ELEMENTS = [
  'Primary', 'General', 'Requests', 'Messages', 'Note...', 'Search',
  'Unread', 'Active', 'Message...', 'Instagram', 'Home', 'Reels',
  'Explore', 'Notifications', 'Create', 'Dashboard', 'Profile', 'More',
  'Your note', 'Your messages', 'Send message', 'YouTube', 'Message requests',
  'Hidden Requests', 'Decide who', 'Delete all', 'Open a chat', 'View profile',
  'Accept', 'Delete', 'Block'
];

const MESSAGE_SKIP_PATTERNS = [
  /^[a-z0-9._]+$/,              // Username handles
  /^\d{1,2}\/\d{1,2}\/\d{2}/,   // Date formats
  /messaged you about/,
  /sent an attachment/,
  /sent a voice/,
  /sent a video/,
  / · /,
  /^(Active|Unread|View profile|See Post|Instagram|Accept|Delete|Block)$/
];

const SPAM_PATTERNS = [
  /followers instantly/i,
  /\$\d+/,
  /free trial/i,
  /DM.*to claim/i,
  /shorten\.(so|ee)/,
  /blucheckmark/i,
  /10K.*followers/i
];

// ============== Core Safari Functions ==============

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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function navigateTo(url: string): Promise<boolean> {
  await exec(`window.location.href = "${url}"`);
  await wait(3000);
  const currentUrl = await exec('window.location.href');
  return currentUrl.includes(url.split('/')[3] || '');
}

// ============== Profile Operations ==============

interface ProfileData {
  username: string;
  displayName: string | null;
  bio: string | null;
  posts: number | null;
  followers: number | null;
  following: number | null;
  isVerified: boolean;
  isPrivate: boolean;
  externalLink: string | null;
  category: string | null;
  mutualFollowers: string[];
  highlights: string[];
}

async function navigateToProfile(username: string): Promise<boolean> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  return navigateTo(`https://www.instagram.com/${cleanUsername}/`);
}

async function extractProfileData(username: string): Promise<ProfileData | null> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  // Navigate to profile
  console.log(`📱 Navigating to @${cleanUsername}...`);
  await navigateToProfile(cleanUsername);
  await wait(2000);
  
  // Extract profile data in smaller chunks to avoid issues
  const basicData = await exec(`(function(){
    var text = document.body.innerText;
    var data = { username: "${cleanUsername}", displayName: null, posts: null, followers: null, following: null };
    var statsMatch = text.match(/(\\d+)\\s*posts/);
    if(statsMatch) data.posts = statsMatch[1];
    statsMatch = text.match(/(\\d+[,.]?\\d*[KMkm]?)\\s*followers/i);
    if(statsMatch) data.followers = statsMatch[1];
    statsMatch = text.match(/(\\d+)\\s*following/);
    if(statsMatch) data.following = statsMatch[1];
    var lines = text.split(String.fromCharCode(10));
    for(var i=0; i<lines.length; i++){
      if(lines[i].trim().toLowerCase() === "${cleanUsername}" && lines[i+1]){
        data.displayName = lines[i+1].trim();
        break;
      }
    }
    return JSON.stringify(data);
  })()`);
  
  const extraData = await exec(`(function(){
    var text = document.body.innerText;
    var data = { isVerified: false, isPrivate: false, category: null, bio: null, externalLink: null };
    data.isVerified = !!document.querySelector("[aria-label='Verified']") || text.includes("Verified");
    data.isPrivate = text.includes("This account is private");
    var categories = ["Digital creator", "Artist", "Musician", "Public figure", "Entrepreneur", "Personal blog"];
    for(var j=0; j<categories.length; j++){
      if(text.includes(categories[j])){ data.category = categories[j]; break; }
    }
    var linkMatch = text.match(/([a-z0-9-]+\\.(com|link|co|io|me|bio)\\/[a-z0-9-_]+)/i);
    if(linkMatch) data.externalLink = linkMatch[1];
    return JSON.stringify(data);
  })()`);
  
  const socialData = await exec(`(function(){
    var text = document.body.innerText;
    var data = { mutualFollowers: [], highlights: [] };
    var mutualMatch = text.match(/Followed by ([^+]+)/);
    if(mutualMatch){
      data.mutualFollowers = mutualMatch[1].split(",").map(function(s){ return s.trim(); }).slice(0,5);
    }
    return JSON.stringify(data);
  })()`);
  
  try {
    const basic = JSON.parse(basicData || '{}');
    const extra = JSON.parse(extraData || '{}');
    const social = JSON.parse(socialData || '{}');
    
    return {
      username: cleanUsername,
      displayName: basic.displayName || null,
      bio: extra.bio || null,
      posts: basic.posts ? parseInt(basic.posts) : null,
      followers: basic.followers || null,
      following: basic.following ? parseInt(basic.following) : null,
      isVerified: extra.isVerified || false,
      isPrivate: extra.isPrivate || false,
      externalLink: extra.externalLink || null,
      category: extra.category || null,
      mutualFollowers: social.mutualFollowers || [],
      highlights: social.highlights || []
    };
  } catch (error) {
    console.error('Error parsing profile data:', error);
    return null;
  }
}

// ============== Conversation Operations ==============

interface Message {
  text: string;
  isOutbound: boolean;
  timestamp?: string;
}

interface ConversationData {
  username: string;
  displayName: string | null;
  messages: Message[];
  messageCount: number;
}

async function findConversationByUsername(username: string): Promise<boolean> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  // Check if we have a known display name for this handle (fast path)
  const knownDisplayName = KNOWN_HANDLES[cleanUsername];
  
  // Navigate to inbox
  await fetch(`${SAFARI_URL}/api/inbox/navigate`, { method: 'POST' });
  await wait(2000);
  
  // If we know the display name, try direct click first (much faster)
  if (knownDisplayName) {
    console.log(`   Known contact: "${knownDisplayName}" (@${cleanUsername})`);
    
    // Click on div containing the contact name (this navigates to conversation)
    const directClick = await exec(`(function(){
      var divs = document.querySelectorAll("div");
      for(var i=0; i<divs.length; i++){
        var t = divs[i].innerText;
        if(t && t.indexOf("${knownDisplayName}") === 0 && t.length < 150){
          divs[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    
    if (directClick.includes('clicked')) {
      await wait(3000);
      // Verify we navigated to a conversation
      const url = await exec('window.location.href');
      if (url.includes('/direct/t/')) {
        console.log(`   ✓ Opened conversation`);
        return true;
      }
    }
    
    // Try in General tab
    await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].innerText.includes("General")){ tabs[i].click(); return "switched"; }
      }
    })()`);
    await wait(1500);
    
    const generalClick = await exec(`(function(){
      var divs = document.querySelectorAll("div");
      for(var i=0; i<divs.length; i++){
        var t = divs[i].innerText;
        if(t && t.indexOf("${knownDisplayName}") === 0 && t.length < 150){
          divs[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    
    if (generalClick.includes('clicked')) {
      await wait(3000);
      const url = await exec('window.location.href');
      if (url.includes('/direct/t/')) {
        console.log(`   ✓ Found in General tab`);
        return true;
      }
    }
  }
  
  // Fallback: Search all tabs
  const tabs = ['Primary', 'General', 'Requests'];
  
  for (const tab of tabs) {
    await exec(`(function(){
      var tabs = document.querySelectorAll("[role=tab]");
      for(var i=0; i<tabs.length; i++){
        if(tabs[i].innerText.includes("${tab}")){ tabs[i].click(); return "switched"; }
      }
    })()`);
    await wait(1500);
    
    // Search page text for username
    const found = await exec(`(function(){
      var text = document.body.innerText.toLowerCase();
      return text.includes("${cleanUsername}") ? "found" : "not found";
    })()`);
    
    if (found === 'found') {
      // Click on aria-label that contains the username
      const clicked = await exec(`(function(){
        var el = document.querySelector("[aria-label*='${cleanUsername}']");
        if(el){ el.click(); return "clicked aria"; }
        // Try finding in conversation list by profile link
        var links = document.querySelectorAll("a[href*='/${cleanUsername}']");
        if(links.length > 0){ 
          var parent = links[0].closest("[role=button]");
          if(parent){ parent.click(); return "clicked parent"; }
        }
        return "not found";
      })()`);
      
      if (clicked.includes('clicked')) {
        await wait(2000);
        console.log(`   ✓ Found @${cleanUsername} in ${tab} tab`);
        return true;
      }
    }
  }
  
  // Final fallback: Open conversation from profile
  console.log(`   Trying to open from profile...`);
  await navigateToProfile(cleanUsername);
  await wait(2000);
  
  const msgClicked = await exec(`(function(){
    var btns = document.querySelectorAll("div[role=button], button");
    for(var i=0; i<btns.length; i++){
      if(btns[i].innerText === "Message"){ btns[i].click(); return "clicked"; }
    }
    return "not found";
  })()`);
  
  if (msgClicked.includes('clicked')) {
    await wait(3000);
    const hasTextbox = await exec(`!!document.querySelector("[role=textbox]")`);
    if (hasTextbox === 'true') {
      console.log(`   ✓ Opened conversation from profile`);
      return true;
    }
  }
  
  return false;
}

async function extractConversationByUsername(username: string): Promise<ConversationData | null> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  console.log(`💬 Looking for conversation with @${cleanUsername}...`);
  
  const found = await findConversationByUsername(cleanUsername);
  if (!found) {
    console.log('   No conversation found');
    return null;
  }
  
  // Wait for conversation to fully load
  await wait(2000);
  
  // Scroll up to load older messages (proven pattern from extract-tab-dms.ts)
  console.log('   Loading message history...');
  for (let i = 0; i < 3; i++) {
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
    await wait(800);
  }
  
  // Find handle in conversation (proven pattern)
  const handle = await exec(`(function(){
    var t = document.body.innerText;
    var lines = t.split(String.fromCharCode(10));
    for(var i = 0; i < lines.length; i++){
      var l = lines[i].trim();
      if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== "the_isaiah_dupree"){
        return l;
      }
    }
    return "";
  })()`);
  
  if (!handle) {
    console.log('   Could not identify handle, using username');
  }
  
  const actualHandle = handle || cleanUsername;
  console.log(`   Handle: @${actualHandle}`);
  
  // Extract messages using proven pattern from extract-tab-dms.ts
  const messagesJson = await exec(`(function(){
    var t = document.body.innerText;
    var idx = t.indexOf("${actualHandle}");
    if(idx === -1) return JSON.stringify([]);
    var endIdx = t.indexOf("Message...", idx);
    if(endIdx === -1) endIdx = idx + 3000;
    var content = t.substring(idx + ${actualHandle.length}, endIdx);
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
  })()`);
  
  // Get display name from aria-label or known mappings
  let displayName = await exec(`(function(){
    var label = document.querySelector("[aria-label*='Conversation with']");
    if(label){
      return label.getAttribute("aria-label").replace("Conversation with ", "");
    }
    return "";
  })()`);
  
  // Use known mapping if available
  if (!displayName && KNOWN_HANDLES[actualHandle]) {
    displayName = KNOWN_HANDLES[actualHandle];
  }
  
  try {
    const messages = JSON.parse(messagesJson || '[]');
    console.log(`   Found ${messages.length} messages`);
    return {
      username: actualHandle,
      displayName: displayName || null,
      messages,
      messageCount: messages.length
    };
  } catch (e) {
    console.log('   Error parsing messages');
    return {
      username: actualHandle,
      displayName: displayName || null,
      messages: [],
      messageCount: 0
    };
  }
}

// ============== DM Operations ==============

async function sendDMByUsername(username: string, message: string): Promise<boolean> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  console.log(`📤 Sending DM to @${cleanUsername}...`);
  
  // First try to find existing conversation
  let found = await findConversationByUsername(cleanUsername);
  
  if (!found) {
    // Try to start new conversation from profile
    console.log('   No existing conversation, starting new from profile...');
    await navigateToProfile(cleanUsername);
    await wait(2000);
    
    // Click Message button on profile
    const clicked = await exec(`(function(){
      var btns = document.querySelectorAll("div[role=button], button");
      for(var i=0; i<btns.length; i++){
        if(btns[i].innerText === "Message"){
          btns[i].click();
          return "clicked";
        }
      }
      return "not found";
    })()`);
    
    if (!clicked.includes('clicked')) {
      console.log('   Could not find Message button on profile');
      return false;
    }
    
    await wait(3000);
  }
  
  // Type message using innerText + input event (proven pattern)
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const typeResult = await exec(`(function(){
    var tb = document.querySelector("[role=textbox]");
    if(!tb) return "no textbox";
    tb.focus();
    tb.innerText = "${escapedMessage}";
    tb.dispatchEvent(new InputEvent("input", {bubbles: true}));
    return "typed";
  })()`);
  
  if (!typeResult.includes('typed')) {
    console.log('   Could not find message input');
    return false;
  }
  
  await wait(500);
  
  // Click Send button (proven pattern)
  const sendResult = await exec(`(function(){
    var btns = document.querySelectorAll("div[role=button]");
    for(var i=0; i<btns.length; i++){
      if(btns[i].innerText === "Send"){
        btns[i].click();
        return "sent";
      }
    }
    return "no send";
  })()`);
  
  if (sendResult.includes('sent')) {
    console.log('   ✅ Message sent!');
    return true;
  }
  
  console.log('   Could not find Send button');
  return false;
}

// ============== Full User Analysis ==============

interface FullUserData {
  profile: ProfileData | null;
  conversation: ConversationData | null;
  hasExistingConversation: boolean;
}

async function getFullUserData(username: string): Promise<FullUserData> {
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  console.log(`\n🔍 Full Analysis: @${cleanUsername}\n`);
  console.log('─'.repeat(50));
  
  // Get profile data
  const profile = await extractProfileData(cleanUsername);
  
  // Get conversation data
  const conversation = await extractConversationByUsername(cleanUsername);
  
  return {
    profile,
    conversation,
    hasExistingConversation: conversation !== null && conversation.messageCount > 0
  };
}

// ============== Database Operations ==============

async function saveUserToDatabase(data: FullUserData): Promise<void> {
  if (!data.profile) return;
  
  const { profile, conversation } = data;
  
  // Upsert contact
  const { data: contact, error } = await supabase
    .from('instagram_contacts')
    .upsert({
      instagram_username: profile.username,
      display_name: profile.displayName,
      bio: profile.bio,
      followers_count: parseInt(String(profile.followers).replace(/[KMkm,]/g, '')) || null,
      following_count: parseInt(String(profile.following).replace(/[KMkm,]/g, '')) || null,
      is_verified: profile.isVerified,
      external_url: profile.externalLink,
      tags: [
        'profile_extracted',
        profile.category ? `category:${profile.category.toLowerCase().replace(/ /g, '_')}` : null,
        profile.isVerified ? 'verified' : null,
        data.hasExistingConversation ? 'has_conversation' : 'no_conversation'
      ].filter(Boolean)
    }, { onConflict: 'instagram_username' })
    .select('id')
    .single();
  
  if (error) {
    console.error('Database error:', error);
    return;
  }
  
  // Save conversation if exists
  if (conversation && contact) {
    const { data: conv } = await supabase
      .from('instagram_conversations')
      .upsert({
        contact_id: contact.id,
        last_message_preview: conversation.messages[0]?.text?.substring(0, 100)
      }, { onConflict: 'contact_id' })
      .select('id')
      .single();
    
    if (conv) {
      for (const msg of conversation.messages) {
        await supabase.from('instagram_messages').upsert({
          conversation_id: conv.id,
          contact_id: contact.id,
          message_text: msg.text,
          is_outbound: msg.isOutbound
        }, { onConflict: 'conversation_id,message_text' });
      }
    }
  }
  
  console.log('   💾 Saved to database');
}

// ============== CLI Interface ==============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const username = args[1];
  
  console.log('\n📱 Instagram Automation API\n');
  
  if (!command) {
    console.log('Commands:');
    console.log('  profile <username>           - Extract profile data');
    console.log('  messages <username>          - Extract conversation history');
    console.log('  messages <username> --save   - Extract and save to database');
    console.log('  dm <username> <message>      - Send a DM');
    console.log('  full <username>              - Full analysis (profile + conversation)');
    console.log('  full <username> --save       - Full analysis + save to database');
    console.log('  batch                        - Extract from ALL known contacts');
    console.log('  known                        - List all known handle mappings');
    console.log('  lookup <query>               - Lookup handle or display name');
    console.log('  stats                        - Show database statistics');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/instagram-api.ts messages owentheaiguy --save');
    console.log('  npx tsx scripts/instagram-api.ts batch');
    console.log('  npx tsx scripts/instagram-api.ts stats');
    return;
  }
  
  // Commands that don't require username
  if (command === 'known' || command === 'lookup' || command === 'stats' || command === 'batch' || command === 'search' || command === 'top' || command === 'recent' || command === 'attention' || command === 'weekly' || command === 'detect') {
    // Handle below
  } else if (!username) {
    console.log('Error: Username required');
    return;
  }
  
  switch (command) {
    case 'profile': {
      const profile = await extractProfileData(username);
      if (profile) {
        console.log('\n📊 Profile Data:\n');
        console.log(`  Username:    @${profile.username}`);
        console.log(`  Name:        ${profile.displayName || 'N/A'}`);
        console.log(`  Category:    ${profile.category || 'N/A'}`);
        console.log(`  Posts:       ${profile.posts || 'N/A'}`);
        console.log(`  Followers:   ${profile.followers || 'N/A'}`);
        console.log(`  Following:   ${profile.following || 'N/A'}`);
        console.log(`  Verified:    ${profile.isVerified ? '✓' : '✗'}`);
        console.log(`  Private:     ${profile.isPrivate ? '✓' : '✗'}`);
        console.log(`  Link:        ${profile.externalLink || 'N/A'}`);
        console.log(`  Bio:         ${profile.bio?.substring(0, 100) || 'N/A'}...`);
        if (profile.mutualFollowers.length > 0) {
          console.log(`  Mutuals:     ${profile.mutualFollowers.join(', ')}`);
        }
        if (profile.highlights.length > 0) {
          console.log(`  Highlights:  ${profile.highlights.join(', ')}`);
        }
      } else {
        console.log('❌ Could not extract profile');
      }
      break;
    }
    
    case 'messages': {
      const saveMessages = args.includes('--save');
      const conversation = await extractConversationByUsername(username);
      if (conversation) {
        console.log(`\n💬 Conversation with @${conversation.username}:\n`);
        console.log(`  Display Name: ${conversation.displayName || 'N/A'}`);
        console.log(`  Messages:     ${conversation.messageCount}\n`);
        conversation.messages.slice(0, 10).forEach((m, i) => {
          const dir = m.isOutbound ? '→' : '←';
          console.log(`  ${i + 1}. ${dir} ${m.text.substring(0, 70)}${m.text.length > 70 ? '...' : ''}`);
        });
        if (conversation.messageCount > 10) {
          console.log(`\n  ... and ${conversation.messageCount - 10} more messages`);
        }
        
        // Save to database if --save flag
        if (saveMessages && conversation.messageCount > 0) {
          console.log('\n   💾 Saving to database...');
          const { saved } = await saveConversationToDatabase(
            conversation.username,
            conversation.displayName,
            conversation.messages
          );
          console.log(`   ✅ Saved ${saved} new messages`);
        }
      } else {
        console.log('❌ No conversation found');
      }
      break;
    }
    
    case 'dm': {
      const message = args.slice(2).join(' ');
      if (!message) {
        console.log('Error: Message required');
        console.log('Usage: dm <username> <message>');
        return;
      }
      const sent = await sendDMByUsername(username, message);
      console.log(sent ? `\n✅ Message sent to @${username}` : `\n❌ Failed to send message`);
      break;
    }
    
    case 'full': {
      const saveToDb = args.includes('--save');
      const data = await getFullUserData(username);
      
      console.log('\n📊 Profile:');
      if (data.profile) {
        console.log(`  @${data.profile.username} | ${data.profile.displayName || 'N/A'}`);
        console.log(`  ${data.profile.followers} followers | ${data.profile.following} following | ${data.profile.posts} posts`);
        console.log(`  ${data.profile.category || 'No category'} | ${data.profile.isVerified ? '✓ Verified' : 'Not verified'}`);
      } else {
        console.log('  Could not extract profile');
      }
      
      console.log('\n💬 Conversation:');
      if (data.conversation) {
        console.log(`  ${data.conversation.messageCount} messages with ${data.conversation.displayName || 'user'}`);
        data.conversation.messages.slice(0, 3).forEach(m => {
          console.log(`    ${m.isOutbound ? '→' : '←'} ${m.text.substring(0, 50)}...`);
        });
      } else {
        console.log('  No existing conversation');
      }
      
      if (saveToDb) {
        await saveUserToDatabase(data);
      }
      break;
    }
    
    case 'known':
      console.log('\n📋 Known Contacts (Handle Mappings):\n');
      const known = listKnownContacts();
      known.forEach((c, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}. @${c.handle.padEnd(25)} → ${c.displayName}`);
      });
      console.log(`\n  Total: ${known.length} known contacts`);
      break;
      
    case 'lookup':
      const lookupQuery = args.slice(1).join(' ');
      if (!lookupQuery) {
        console.log('Usage: lookup <username or display name>');
        break;
      }
      const asHandle = getDisplayName(lookupQuery);
      const asDisplay = getHandle(lookupQuery);
      if (asHandle) {
        console.log(`\n  @${lookupQuery} → "${asHandle}"`);
      } else if (asDisplay) {
        console.log(`\n  "${lookupQuery}" → @${asDisplay}`);
      } else {
        console.log(`\n  No mapping found for "${lookupQuery}"`);
      }
      break;
      
    case 'stats':
      const stats = await getDatabaseStats();
      console.log('\n📊 Database Stats:\n');
      console.log(`  Contacts:      ${stats.contacts}`);
      console.log(`  Conversations: ${stats.conversations}`);
      console.log(`  Messages:      ${stats.messages}`);
      console.log(`  Patterns:      ${stats.patterns}`);
      break;
      
    case 'search': {
      const searchQuery = args.slice(1).join(' ');
      if (!searchQuery) {
        console.log('Usage: search <query>');
        break;
      }
      console.log(`\n🔍 Searching messages for "${searchQuery}"...\n`);
      const results = await searchMessages(searchQuery);
      if (results.length === 0) {
        console.log('  No messages found');
      } else {
        results.forEach((m, i) => {
          const contact = (m as any).instagram_contacts;
          const dir = m.is_outbound ? '→' : '←';
          const who = contact?.instagram_username || 'unknown';
          console.log(`  ${i + 1}. ${dir} @${who}: ${m.message_text?.substring(0, 60)}...`);
        });
      }
      break;
    }
    
    case 'top':
      console.log('\n🏆 Top Contacts by Relationship Score:\n');
      const topContacts = await getTopContacts(10);
      topContacts.forEach((c, i) => {
        console.log(`  ${i + 1}. @${c.instagram_username?.padEnd(25)} Score: ${c.relationship_score}`);
      });
      break;
      
    case 'recent':
      console.log('\n📬 Recent Conversations:\n');
      const recent = await getRecentConversations(10);
      recent.forEach((c, i) => {
        const contact = (c as any).instagram_contacts;
        console.log(`  ${i + 1}. @${contact?.instagram_username?.padEnd(25)} ${c.last_message_preview?.substring(0, 40)}...`);
      });
      break;
      
    case 'health': {
      if (!username) {
        console.log('Usage: health <username>');
        break;
      }
      console.log(`\n💚 Relationship Health Score for @${username}:\n`);
      const health = await calculateRelationshipScore(username);
      if (health) {
        console.log(`  Total Score:     ${health.total}/100`);
        console.log(`  ├─ Recency:      ${health.recency}/20`);
        console.log(`  ├─ Resonance:    ${health.resonance}/20`);
        console.log(`  ├─ Need Clarity: ${health.needClarity}/15`);
        console.log(`  ├─ Value Given:  ${health.valueDelivered}/20`);
        console.log(`  ├─ Reliability:  ${health.reliability}/15`);
        console.log(`  └─ Consent:      ${health.consent}/10`);
        console.log(`\n  Stage: ${health.stage}`);
        if (health.nextAction) {
          console.log(`  Next Action: ${health.nextAction}`);
        }
      } else {
        console.log('  Contact not found');
      }
      break;
    }
    
    case 'nextaction': {
      if (!username) {
        console.log('Usage: nextaction <username>');
        break;
      }
      console.log(`\n🎯 Next Best Action for @${username}:\n`);
      const nba = await getNextBestAction(username);
      if (nba) {
        console.log(`  Score: ${nba.score.total}/100 | Stage: ${nba.score.stage}`);
        console.log(`  Lane:  ${nba.lane}`);
        console.log(`\n  💬 Suggested message:`);
        console.log(`  "${nba.action.action_text}"`);
      } else {
        console.log('  Contact not found');
      }
      break;
    }
    
    case 'attention':
      console.log('\n⚠️ Contacts Needing Attention:\n');
      const needAttention = await getContactsNeedingAttention(10);
      if (needAttention.length === 0) {
        console.log('  All contacts are healthy!');
      } else {
        needAttention.forEach((c, i) => {
          const lastTouch = c.last_meaningful_touch ? new Date(c.last_meaningful_touch).toLocaleDateString() : 'never';
          console.log(`  ${i + 1}. @${c.instagram_username?.padEnd(25)} Last: ${lastTouch}`);
        });
      }
      break;
      
    case 'detect': {
      const text = args.slice(1).join(' ');
      if (!text) {
        console.log('Usage: detect <message text>');
        break;
      }
      console.log(`\n🔍 Detecting fit signals in: "${text.substring(0, 50)}..."\n`);
      const fits = await detectFitSignals(text);
      if (fits.length === 0) {
        console.log('  No fit signals detected');
      } else {
        fits.forEach((f, i) => {
          console.log(`  ${i + 1}. [${f.product}] ${f.signal}`);
          console.log(`     Offer: "${f.offer}"`);
        });
      }
      break;
    }
    
    case 'grade': {
      if (!username) {
        console.log('Usage: grade <username>');
        break;
      }
      console.log(`\n📊 Conversation Grade for @${username}:\n`);
      const grade = await scoreConversation(username);
      if (grade) {
        console.log(`  Score: ${grade.score}/100\n`);
        if (grade.strengths.length > 0) {
          console.log('  ✅ Strengths:');
          grade.strengths.forEach(s => console.log(`     - ${s}`));
        }
        if (grade.improvements.length > 0) {
          console.log('\n  📈 Improvements:');
          grade.improvements.forEach(i => console.log(`     - ${i}`));
        }
        console.log('\n  ' + grade.feedback.join(' | '));
      } else {
        console.log('  Contact not found');
      }
      break;
    }
    
    case 'weekly':
      console.log('\n📅 Weekly Operating System Tasks:\n');
      const tasks = await getWeeklyTasks();
      
      console.log('  🎁 Micro-Wins (send value):');
      tasks.microWins.slice(0, 5).forEach((t: any) => console.log(`     @${t.username}`));
      
      console.log('\n  🤔 Curiosity (ask questions):');
      tasks.curiosity.slice(0, 5).forEach((t: any) => console.log(`     @${t.username}`));
      
      console.log('\n  🔄 Re-warm (gentle re-engage):');
      tasks.rewarm.forEach((t: any) => console.log(`     @${t.username}`));
      
      if (tasks.offers.length > 0) {
        console.log('\n  💼 Ready for Offer:');
        tasks.offers.forEach((t: any) => console.log(`     @${t.username}`));
      }
      break;
    
    case 'suggest': {
      if (!username) {
        console.log('Usage: suggest <username> [last message]');
        break;
      }
      const lastMsg = args.slice(2).join(' ') || '';
      console.log(`\n🤖 AI Copilot Suggestion for @${username}:\n`);
      const suggestion = await generateReplySuggestion(username, lastMsg);
      if (suggestion) {
        console.log(`  💬 "${suggestion}"`);
      } else {
        console.log('  Contact not found');
      }
      break;
    }
      
    case 'batch': {
      console.log('\n📬 Batch Extraction from Known Contacts\n');
      const handles = Object.keys(KNOWN_HANDLES);
      let totalExtracted = 0;
      let totalSaved = 0;
      let successful = 0;
      
      for (let i = 0; i < handles.length; i++) {
        const handle = handles[i];
        const displayName = KNOWN_HANDLES[handle];
        process.stdout.write(`[${i + 1}/${handles.length}] @${handle.padEnd(25)}`);
        
        try {
          const conv = await extractConversationByUsername(handle);
          if (conv && conv.messageCount > 0) {
            const { saved } = await saveConversationToDatabase(conv.username, conv.displayName, conv.messages);
            totalExtracted += conv.messageCount;
            totalSaved += saved;
            successful++;
            console.log(`✅ ${conv.messageCount} msgs, ${saved} saved`);
          } else {
            console.log(`⏭️ no messages`);
          }
        } catch (e) {
          console.log(`❌ error`);
        }
      }
      
      console.log(`\n📊 Batch Summary:`);
      console.log(`  Contacts processed: ${handles.length}`);
      console.log(`  Successful: ${successful}`);
      console.log(`  Messages extracted: ${totalExtracted}`);
      console.log(`  New messages saved: ${totalSaved}`);
      
      const finalStats = await getDatabaseStats();
      console.log(`\n  Database total: ${finalStats.messages} messages`);
      break;
    }
      
    default:
      console.log(`Unknown command: ${command}`);
  }
}

// ============== Database Save Functions ==============

/**
 * Save conversation messages to database (proven pattern from extract-tab-dms.ts)
 */
async function saveConversationToDatabase(
  username: string,
  displayName: string | null,
  messages: { text: string; isOutbound: boolean }[]
): Promise<{ contactId: string | null; saved: number }> {
  const handle = username.replace('@', '').toLowerCase();
  
  // Upsert contact
  let { data: contact } = await supabase
    .from('instagram_contacts')
    .select('id')
    .eq('instagram_username', handle)
    .single();
  
  if (!contact) {
    const { data: newContact } = await supabase
      .from('instagram_contacts')
      .insert({
        instagram_username: handle,
        display_name: displayName,
        relationship_score: 50,
        pipeline_stage: 'first_touch',
        tags: ['dm_extracted', 'api_saved', `handle:${handle}`],
      })
      .select('id')
      .single();
    contact = newContact;
  }
  
  if (!contact) return { contactId: null, saved: 0 };
  
  // Upsert conversation
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
        last_message_preview: messages[0]?.text?.substring(0, 100),
      })
      .select('id')
      .single();
    conv = newConv;
  }
  
  if (!conv) return { contactId: contact.id, saved: 0 };
  
  // Save messages (avoid duplicates)
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
  
  return { contactId: contact.id, saved };
}

/**
 * Get database stats
 */
async function getDatabaseStats(): Promise<{ contacts: number; conversations: number; messages: number; patterns: number }> {
  const { count: contacts } = await supabase.from('instagram_contacts').select('*', { count: 'exact', head: true });
  const { count: conversations } = await supabase.from('instagram_conversations').select('*', { count: 'exact', head: true });
  const { count: messages } = await supabase.from('instagram_messages').select('*', { count: 'exact', head: true });
  const { count: patterns } = await supabase.from('automation_patterns').select('*', { count: 'exact', head: true });
  
  return {
    contacts: contacts || 0,
    conversations: conversations || 0,
    messages: messages || 0,
    patterns: patterns || 0
  };
}

/**
 * Search messages in database
 */
async function searchMessages(query: string, limit = 20): Promise<any[]> {
  const { data } = await supabase
    .from('instagram_messages')
    .select(`
      id,
      message_text,
      is_outbound,
      sent_at,
      instagram_contacts(instagram_username, display_name)
    `)
    .ilike('message_text', `%${query}%`)
    .order('sent_at', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Get contact by username with full data
 */
async function getContactFromDB(username: string): Promise<any> {
  const clean = username.replace('@', '').toLowerCase();
  const { data } = await supabase
    .from('instagram_contacts')
    .select(`
      *,
      instagram_conversations(*),
      instagram_messages(count)
    `)
    .eq('instagram_username', clean)
    .single();
  
  return data;
}

/**
 * Update relationship score based on interaction
 */
async function updateRelationshipScore(username: string, delta: number): Promise<boolean> {
  const clean = username.replace('@', '').toLowerCase();
  
  const { data: contact } = await supabase
    .from('instagram_contacts')
    .select('id, relationship_score')
    .eq('instagram_username', clean)
    .single();
  
  if (!contact) return false;
  
  const newScore = Math.min(100, Math.max(0, (contact.relationship_score || 50) + delta));
  
  const { error } = await supabase
    .from('instagram_contacts')
    .update({ 
      relationship_score: newScore,
      updated_at: new Date().toISOString()
    })
    .eq('id', contact.id);
  
  return !error;
}

/**
 * Get top contacts by relationship score
 */
async function getTopContacts(limit = 10): Promise<any[]> {
  const { data } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name, relationship_score, total_messages_sent, total_messages_received')
    .order('relationship_score', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Get recent conversations with message counts
 */
async function getRecentConversations(limit = 10): Promise<any[]> {
  const { data } = await supabase
    .from('instagram_conversations')
    .select(`
      id,
      last_message_preview,
      updated_at,
      instagram_contacts(instagram_username, display_name)
    `)
    .order('updated_at', { ascending: false })
    .limit(limit);
  
  return data || [];
}

// ============== Relationship Health Score (Revio Framework) ==============

interface RelationshipScore {
  total: number;
  recency: number;
  resonance: number;
  needClarity: number;
  valueDelivered: number;
  reliability: number;
  consent: number;
  stage: string;
  nextAction: string | null;
}

/**
 * Calculate relationship health score (0-100) based on Revio framework
 * Weights: Recency 20, Resonance 20, Need Clarity 15, Value Delivered 20, Reliability 15, Consent 10
 */
async function calculateRelationshipScore(username: string): Promise<RelationshipScore | null> {
  const clean = username.replace('@', '').toLowerCase();
  
  const { data: contact } = await supabase
    .from('instagram_contacts')
    .select('*')
    .eq('instagram_username', clean)
    .single();
  
  if (!contact) return null;
  
  // Calculate recency score (20 points max)
  const lastTouch = contact.last_meaningful_touch ? new Date(contact.last_meaningful_touch) : null;
  const daysSinceTouch = lastTouch ? (Date.now() - lastTouch.getTime()) / (1000 * 60 * 60 * 24) : 999;
  const recency = daysSinceTouch <= 7 ? 20 : daysSinceTouch <= 14 ? 15 : daysSinceTouch <= 30 ? 10 : daysSinceTouch <= 60 ? 5 : 0;
  
  // Get stored scores or defaults
  const resonance = Math.min(20, contact.resonance_score || 0);
  const needClarity = Math.min(15, contact.need_clarity_score || 0);
  const valueDelivered = Math.min(20, contact.value_delivered_score || 0);
  const reliability = Math.min(15, contact.reliability_score || 0);
  const consent = Math.min(10, contact.consent_level || 0);
  
  const total = recency + resonance + needClarity + valueDelivered + reliability + consent;
  const stage = contact.relationship_stage || 'first_touch';
  
  // Determine next action based on score and stage
  let nextAction = null;
  if (total < 40) {
    nextAction = 'rewarm: low_friction';
  } else if (total < 60) {
    nextAction = 'service: permission_to_help';
  } else if (total < 80) {
    nextAction = 'friendship: check_in';
  } else if (stage === 'fit_repeats') {
    nextAction = 'offer: permissioned_offer';
  }
  
  return { total, recency, resonance, needClarity, valueDelivered, reliability, consent, stage, nextAction };
}

/**
 * Update relationship score components after interaction
 */
async function recordInteraction(
  username: string,
  interactionType: 'reply_received' | 'value_delivered' | 'promise_kept' | 'consent_given' | 'trust_signal'
): Promise<boolean> {
  const clean = username.replace('@', '').toLowerCase();
  
  const { data: contact } = await supabase
    .from('instagram_contacts')
    .select('id, resonance_score, value_delivered_score, reliability_score, consent_level, trust_signals')
    .eq('instagram_username', clean)
    .single();
  
  if (!contact) return false;
  
  const updates: any = { 
    last_meaningful_touch: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  switch (interactionType) {
    case 'reply_received':
      updates.resonance_score = Math.min(20, (contact.resonance_score || 0) + 2);
      break;
    case 'value_delivered':
      updates.value_delivered_score = Math.min(20, (contact.value_delivered_score || 0) + 5);
      break;
    case 'promise_kept':
      updates.reliability_score = Math.min(15, (contact.reliability_score || 0) + 3);
      break;
    case 'consent_given':
      updates.consent_level = Math.min(10, (contact.consent_level || 0) + 2);
      break;
    case 'trust_signal':
      const signals = contact.trust_signals || [];
      signals.push({ type: 'trust_signal', at: new Date().toISOString() });
      updates.trust_signals = signals;
      break;
  }
  
  const { error } = await supabase
    .from('instagram_contacts')
    .update(updates)
    .eq('id', contact.id);
  
  return !error;
}

/**
 * Get next-best-action for a contact based on their stage and score
 */
async function getNextBestAction(username: string): Promise<any> {
  const score = await calculateRelationshipScore(username);
  if (!score) return null;
  
  // Determine which lane to use
  let lane = 'friendship';
  if (score.total < 40) lane = 'rewarm';
  else if (score.total < 60) lane = 'service';
  else if (score.stage === 'fit_repeats') lane = 'offer';
  else if (score.stage === 'post_win') lane = 'retention';
  
  const { data: actions } = await supabase
    .from('next_best_actions')
    .select('*')
    .eq('lane', lane)
    .eq('is_active', true);
  
  if (!actions || actions.length === 0) return null;
  
  // Return a random action from the lane
  const action = actions[Math.floor(Math.random() * actions.length)];
  return { score, lane, action };
}

/**
 * Detect fit signals from message text
 */
async function detectFitSignals(messageText: string): Promise<any[]> {
  const { data: signals } = await supabase
    .from('fit_signals')
    .select('*')
    .eq('is_active', true);
  
  if (!signals) return [];
  
  const detected: any[] = [];
  const lowerText = messageText.toLowerCase();
  
  for (const signal of signals) {
    const keywords = signal.signal_description.toLowerCase().split(' ');
    const matches = keywords.filter((k: string) => k.length > 3 && lowerText.includes(k));
    if (matches.length >= 2) {
      detected.push({
        product: signal.product,
        signal: signal.signal_key,
        description: signal.signal_description,
        offer: signal.offer_template
      });
    }
  }
  
  return detected;
}

/**
 * Get contacts needing attention (low scores or stale)
 */
async function getContactsNeedingAttention(limit = 10): Promise<any[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name, relationship_score, last_meaningful_touch, relationship_stage')
    .or(`last_meaningful_touch.lt.${thirtyDaysAgo},last_meaningful_touch.is.null`)
    .order('relationship_score', { ascending: false })
    .limit(limit);
  
  return data || [];
}

// ============== AI Copilot & Conversation Scoring ==============

/**
 * Generate AI reply suggestion based on conversation context
 * Uses templates and context to suggest next message
 */
async function generateReplySuggestion(username: string, lastMessage: string): Promise<string | null> {
  const score = await calculateRelationshipScore(username);
  if (!score) return null;
  
  // Get appropriate lane based on score
  let lane = 'friendship';
  if (score.total < 40) lane = 'rewarm';
  else if (score.total < 60) lane = 'service';
  else if (score.stage === 'fit_repeats') lane = 'offer';
  
  // Check for fit signals in last message
  const fits = await detectFitSignals(lastMessage);
  if (fits.length > 0) {
    return fits[0].offer; // Use the offer template for detected fit
  }
  
  // Get random action from appropriate lane
  const { data: actions } = await supabase
    .from('next_best_actions')
    .select('action_text')
    .eq('lane', lane)
    .eq('is_active', true);
  
  if (actions && actions.length > 0) {
    return actions[Math.floor(Math.random() * actions.length)].action_text;
  }
  
  return null;
}

/**
 * Score a conversation based on quality indicators
 * Returns 0-100 score with feedback
 */
interface ConversationGrade {
  score: number;
  feedback: string[];
  strengths: string[];
  improvements: string[];
}

async function scoreConversation(username: string): Promise<ConversationGrade | null> {
  const clean = username.replace('@', '').toLowerCase();
  
  // Get messages for this contact
  const { data: contact } = await supabase
    .from('instagram_contacts')
    .select('id')
    .eq('instagram_username', clean)
    .single();
  
  if (!contact) return null;
  
  const { data: messages } = await supabase
    .from('instagram_messages')
    .select('message_text, is_outbound')
    .eq('contact_id', contact.id)
    .order('sent_at', { ascending: true })
    .limit(50);
  
  if (!messages || messages.length === 0) {
    return { score: 0, feedback: ['No messages found'], strengths: [], improvements: ['Start a conversation'] };
  }
  
  let score = 50; // Base score
  const feedback: string[] = [];
  const strengths: string[] = [];
  const improvements: string[] = [];
  
  // Analyze conversation patterns
  const outbound = messages.filter(m => m.is_outbound);
  const inbound = messages.filter(m => !m.is_outbound);
  
  // Check balance (good conversations are balanced)
  const ratio = outbound.length / (inbound.length || 1);
  if (ratio >= 0.5 && ratio <= 2) {
    score += 10;
    strengths.push('Good back-and-forth balance');
  } else if (ratio > 3) {
    score -= 10;
    improvements.push('Too many outbound messages without replies');
  }
  
  // Check for questions asked (curiosity)
  const questionsAsked = outbound.filter(m => m.message_text?.includes('?')).length;
  if (questionsAsked >= 2) {
    score += 10;
    strengths.push('Asking good questions');
  } else {
    improvements.push('Ask more questions to show curiosity');
  }
  
  // Check for value-first language
  const valueKeywords = ['help', 'resource', 'template', 'intro', 'idea'];
  const hasValueLanguage = outbound.some(m => 
    valueKeywords.some(k => m.message_text?.toLowerCase().includes(k))
  );
  if (hasValueLanguage) {
    score += 10;
    strengths.push('Using value-first language');
  }
  
  // Check for pushy language (negative)
  const pushyKeywords = ['buy', 'purchase', 'discount', 'limited time', 'act now'];
  const hasPushyLanguage = outbound.some(m =>
    pushyKeywords.some(k => m.message_text?.toLowerCase().includes(k))
  );
  if (hasPushyLanguage) {
    score -= 15;
    improvements.push('Avoid pushy sales language');
  }
  
  // Check for permission-based offers
  const permissionKeywords = ['want me to', 'would you like', 'interested in', 'no pressure'];
  const hasPermissionLanguage = outbound.some(m =>
    permissionKeywords.some(k => m.message_text?.toLowerCase().includes(k))
  );
  if (hasPermissionLanguage) {
    score += 10;
    strengths.push('Using permission-based offers');
  }
  
  // Check message length (not too short, not too long)
  const avgLength = outbound.reduce((sum, m) => sum + (m.message_text?.length || 0), 0) / (outbound.length || 1);
  if (avgLength >= 20 && avgLength <= 200) {
    score += 5;
  } else if (avgLength < 10) {
    improvements.push('Messages are too short - add more context');
  } else if (avgLength > 300) {
    improvements.push('Messages are too long - keep them concise');
  }
  
  // Cap score
  score = Math.min(100, Math.max(0, score));
  
  feedback.push(`Analyzed ${messages.length} messages`);
  feedback.push(`Outbound: ${outbound.length}, Inbound: ${inbound.length}`);
  
  return { score, feedback, strengths, improvements };
}

/**
 * Get weekly operating system tasks
 * Returns suggested actions for the week
 */
async function getWeeklyTasks(): Promise<any> {
  // Get contacts by score ranges
  const { data: highScore } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name, relationship_score')
    .gte('relationship_score', 60)
    .order('relationship_score', { ascending: false })
    .limit(10);
  
  const { data: medScore } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name, relationship_score')
    .gte('relationship_score', 40)
    .lt('relationship_score', 60)
    .limit(10);
  
  const { data: lowScore } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name, relationship_score')
    .lt('relationship_score', 40)
    .limit(5);
  
  // Get contacts in fit_repeats stage (ready for offer)
  const { data: fitReady } = await supabase
    .from('instagram_contacts')
    .select('instagram_username, display_name')
    .eq('relationship_stage', 'fit_repeats')
    .limit(5);
  
  return {
    microWins: (highScore || []).slice(0, 10).map(c => ({
      username: c.instagram_username,
      task: 'Send micro-win, resource, or intro'
    })),
    curiosity: (medScore || []).slice(0, 10).map(c => ({
      username: c.instagram_username,
      task: 'Ask curiosity question'
    })),
    rewarm: (lowScore || []).slice(0, 5).map(c => ({
      username: c.instagram_username,
      task: 'Gentle re-engagement'
    })),
    offers: (fitReady || []).slice(0, 5).map(c => ({
      username: c.instagram_username,
      task: 'Permissioned offer (only if fit confirmed)'
    }))
  };
}

/**
 * Update pipeline stage for a contact
 */
async function updatePipelineStage(username: string, stage: string): Promise<boolean> {
  const clean = username.replace('@', '').toLowerCase();
  const validStages = ['first_touch', 'context_captured', 'micro_win_delivered', 'cadence_established', 'trust_signals', 'fit_repeats', 'permissioned_offer', 'post_win'];
  
  if (!validStages.includes(stage)) return false;
  
  const { error } = await supabase
    .from('instagram_contacts')
    .update({ relationship_stage: stage, updated_at: new Date().toISOString() })
    .eq('instagram_username', clean);
  
  return !error;
}

// ============== Utility Functions ==============

/**
 * Get display name from username handle (uses known mappings)
 */
function getDisplayName(username: string): string | null {
  const clean = username.replace('@', '').toLowerCase();
  return KNOWN_HANDLES[clean] || null;
}

/**
 * Get username handle from display name (uses known mappings)
 */
function getHandle(displayName: string): string | null {
  return DISPLAY_TO_HANDLE[displayName.toLowerCase()] || null;
}

/**
 * Check if a message is likely spam
 */
function isSpam(text: string): boolean {
  return SPAM_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * List all known contacts
 */
function listKnownContacts(): { handle: string; displayName: string }[] {
  return Object.entries(KNOWN_HANDLES).map(([handle, displayName]) => ({
    handle,
    displayName
  }));
}

// Export for programmatic use
export {
  // Core functions
  extractProfileData,
  extractConversationByUsername,
  sendDMByUsername,
  getFullUserData,
  findConversationByUsername,
  navigateToProfile,
  
  // Database functions
  saveConversationToDatabase,
  getDatabaseStats,
  
  // Utility functions
  getDisplayName,
  getHandle,
  isSpam,
  listKnownContacts,
  
  // Data
  KNOWN_HANDLES,
  DISPLAY_TO_HANDLE,
  UI_SKIP_ELEMENTS,
  MESSAGE_SKIP_PATTERNS,
  SPAM_PATTERNS
};

main().catch(console.error);
