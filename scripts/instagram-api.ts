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
  
  // Small wait to ensure page is loaded
  await wait(1000);
  
  // Scroll up to load older messages
  console.log('   Loading message history...');
  for (let i = 0; i < 3; i++) {
    await exec(`(function(){
      var divs = document.querySelectorAll("div");
      for(var i=0; i<divs.length; i++){
        if(divs[i].scrollHeight>1500 && divs[i].clientHeight>400){
          divs[i].scrollBy(0, -5000);
          return "scrolled";
        }
      }
      return "none";
    })()`);
    await wait(800);
  }
  
  // Find handle in conversation - use known handle if available
  let handle = cleanUsername;
  const foundHandle = await exec(`(function(){
    var t = document.body.innerText;
    var lines = t.split(String.fromCharCode(10));
    for(var i=0; i<lines.length; i++){
      var l = lines[i].trim();
      if(l.match(/^[a-z0-9._]+$/) && l.length>5 && l.length<25 && l!=="the_isaiah_dupree"){
        return l;
      }
    }
    return "";
  })()`);
  
  if (foundHandle) {
    handle = foundHandle;
  }
  
  if (!handle) {
    console.log('   Could not identify handle');
    return null;
  }
  
  // Extract messages - improved pattern matching
  const messagesJson = await exec(`(function(){
    var t = document.body.innerText;
    var idx = t.indexOf("${handle}");
    if(idx === -1) return JSON.stringify([]);
    var endIdx = t.indexOf("Message...", idx);
    if(endIdx === -1) endIdx = idx + 5000;
    var content = t.substring(idx, endIdx);
    var lines = content.split(String.fromCharCode(10));
    var messages = [];
    var seen = {};
    var skipHandles = ["${handle}", "the_isaiah_dupree"];
    for(var i=0; i<lines.length; i++){
      var l = lines[i].trim();
      if(!l || l.length<2) continue;
      // Skip username handles
      if(/^[a-z0-9._]+$/.test(l) && l.length<30) continue;
      // Skip date/time patterns
      if(/^\\d{1,2}\\/\\d{1,2}\\/\\d{2}/.test(l)) continue;
      if(/^[A-Z][a-z]{2} \\d{1,2}, \\d{4}/.test(l)) continue;
      if(/^\\d{1,2}:\\d{2} [AP]M$/.test(l)) continue;
      // Skip UI elements
      if(l.includes("messaged you about")) continue;
      if(l.includes("sent an attachment")) continue;
      if(l.includes("sent a voice")) continue;
      if(l.includes("View profile")) continue;
      if(l.includes("Instagram")) continue;
      if(l === "·" || l.includes(" · ")) continue;
      // Skip single emojis or very short
      if(l.length === 1 || l.length === 2) continue;
      // Keep actual messages
      if(l.length>=3 && l.length<1000 && !seen[l]){
        seen[l] = true;
        var isOut = l.indexOf("I ")==0 || l.indexOf("Hey ")==0 || l.indexOf("Hi ")==0 || l.indexOf("Thanks")==0;
        messages.push({ text: l, isOutbound: isOut });
      }
    }
    return JSON.stringify(messages);
  })()`);
  
  // Get display name
  const displayName = await exec(`(function(){
    var label = document.querySelector("[aria-label*='Conversation with']");
    if(label){
      return label.getAttribute("aria-label").replace("Conversation with ", "");
    }
    return "";
  })()`);
  
  try {
    const messages = JSON.parse(messagesJson);
    return {
      username: cleanUsername,
      displayName: displayName || null,
      messages,
      messageCount: messages.length
    };
  } catch {
    return null;
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
  
  // Type and send message
  const typeResult = await exec(`(function(){
    var textbox = document.querySelector("[role=textbox]");
    if(!textbox) return "no textbox";
    textbox.focus();
    document.execCommand("insertText", false, "${message.replace(/"/g, '\\"')}");
    return "typed";
  })()`);
  
  if (!typeResult.includes('typed')) {
    console.log('   Could not find message input');
    return false;
  }
  
  await wait(500);
  
  // Click send
  const sendResult = await exec(`(function(){
    var parent = document.querySelector("[role=textbox]").parentElement.parentElement.parentElement;
    var btns = parent.querySelectorAll("[aria-label]");
    for(var i=0; i<btns.length; i++){
      if(btns[i].getAttribute("aria-label") === "Send"){
        btns[i].click();
        return "sent";
      }
    }
    return "no send";
  })()`);
  
  return sendResult.includes('sent');
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
    console.log('  dm <username> <message>      - Send a DM');
    console.log('  full <username>              - Full analysis (profile + conversation)');
    console.log('  full <username> --save       - Full analysis + save to database');
    console.log('  known                        - List all known handle mappings');
    console.log('  lookup <query>               - Lookup handle or display name');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/instagram-api.ts profile saraheashley');
    console.log('  npx tsx scripts/instagram-api.ts messages owentheaiguy');
    console.log('  npx tsx scripts/instagram-api.ts dm tonygaskins "Hey, checking in!"');
    console.log('  npx tsx scripts/instagram-api.ts full chase.h.ai --save');
    console.log('  npx tsx scripts/instagram-api.ts known');
    console.log('  npx tsx scripts/instagram-api.ts lookup "Sarah Ashley"');
    return;
  }
  
  // Commands that don't require username
  if (command === 'known' || command === 'lookup') {
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
      
    default:
      console.log(`Unknown command: ${command}`);
  }
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
