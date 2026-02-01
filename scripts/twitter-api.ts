/**
 * Twitter/X DM Automation API
 * 
 * Unified system for Twitter DM operations:
 * - Navigate to DMs
 * - List conversations
 * - Extract messages
 * - Send DMs
 * 
 * Usage:
 *   npx tsx scripts/twitter-api.ts navigate
 *   npx tsx scripts/twitter-api.ts conversations
 *   npx tsx scripts/twitter-api.ts messages <conversation_id>
 *   npx tsx scripts/twitter-api.ts dm <username> <message>
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============== Twitter/X Selectors (from Safari Automation docs) ==============

const SELECTORS = {
  // Navigation
  dmNavLink: '[data-testid="AppTabBar_DirectMessage_Link"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  newTweetButton: '[data-testid="SideNav_NewTweet_Button"]',
  
  // Login Detection
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  loginButton: '[data-testid="loginButton"]',
  userAvatar: '[data-testid="UserAvatar-Container"]',
  
  // DM Container
  dmContainer: '[data-testid="dm-container"]',
  dmInboxPanel: '[data-testid="dm-inbox-panel"]',
  dmConversationPanel: '[data-testid="dm-conversation-panel"]',
  dmTimeline: '[data-testid="DM_timeline"]',
  
  // Inbox
  dmInboxTitle: '[data-testid="dm-inbox-title"]',
  dmNewChatButton: '[data-testid="NewDM_Button"]',
  dmSearchBar: '[data-testid="SearchBox_Search_Input"]',
  
  // Tabs
  dmTabAll: '[data-testid="dm-inbox-tab-all"]',
  dmTabRequests: '[href="/messages/requests"]',
  
  // Conversations (multiple patterns)
  conversation: '[data-testid="conversation"]',
  dmConversationEntry: '[data-testid="DMConversationEntry"]',
  dmInboxItem: '[data-testid="DMInboxItem"]',
  dmConversationItem: '[data-testid^="dm-conversation-item"]',
  
  // Message Composer (DraftJS)
  dmComposerTextInput: '[data-testid="dmComposerTextInput"]',
  dmComposerEditor: '[data-testid="DmComposer-Editor"]',
  dmComposerSendButton: '[data-testid="dmComposerSendButton"]',
  sendDMFromProfile: '[data-testid="sendDMFromProfile"]',
  
  // Messages
  messageEntry: '[data-testid="messageEntry"]',
  dmMessage: '[data-testid="DM_message"]',
  dmMessageContainer: '[data-testid="DMMessageContainer"]',
  tweetText: '[data-testid="tweetText"]',
  messagePreview: '[data-testid="messagePreview"]',
  unreadBadge: '[data-testid="unread-badge"]',
  
  // User Info
  userName: '[data-testid="User-Name"]',
  userCell: '[data-testid="UserCell"]',
  typeaheadUser: '[data-testid="TypeaheadUser"]',
  
  // Generic
  textbox: '[role="textbox"]',
  contentEditable: '[contenteditable="true"]',
  draftEditor: '.public-DraftEditor-content',
  
  // Safety/Rate Limiting
  toast: '[data-testid="toast"]',
  alert: '[role="alert"]',
};

// Rate limits from PRD (conservative)
const RATE_LIMITS = {
  maxDmsPerHour: 15,
  maxDmsPerDay: 100,
  minDelayBetweenDms: 90000,  // 1.5 minutes
  maxDelayBetweenDms: 240000, // 4 minutes
  newAccountDmsPerDay: 20,
};

// ============== Helper Functions ==============

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exec(script: string): Promise<string> {
  try {
    const res = await fetch(`${SAFARI_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script })
    });
    const data = await res.json() as { output?: string };
    return data.output || '';
  } catch (e) {
    console.error('Safari API error:', e);
    return '';
  }
}

async function getCurrentUrl(): Promise<string> {
  return await exec('window.location.href');
}

async function isOnTwitterDMs(): Promise<boolean> {
  const url = await getCurrentUrl();
  return url.includes('x.com/messages') || url.includes('twitter.com/messages') || url.includes('x.com/i/chat');
}

/**
 * Check if logged in to Twitter (from Safari Automation docs)
 */
async function checkLoginStatus(): Promise<{ loggedIn: boolean; username?: string; reason?: string }> {
  const result = await exec(`(function() {
    var url = window.location.href;
    
    // Check for login/signup page
    if (url.includes('/login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) {
      return JSON.stringify({loggedIn: false, reason: 'on_login_page', url: url});
    }
    
    // Check for logged-in indicators
    var indicators = [
      '[data-testid="AppTabBar_Profile_Link"]',
      '[data-testid="SideNav_NewTweet_Button"]',
      'a[href="/compose/post"]',
      '[data-testid="tweetTextarea_0"]'
    ];
    
    for (var i = 0; i < indicators.length; i++) {
      var el = document.querySelector(indicators[i]);
      if (el) {
        var profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        var username = profileLink ? profileLink.getAttribute('href').replace('/', '') : '';
        return JSON.stringify({loggedIn: true, username: username});
      }
    }
    
    return JSON.stringify({loggedIn: false, reason: 'no_indicators_found'});
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return { loggedIn: false, reason: 'parse_error' };
  }
}

/**
 * Detect rate limiting or account issues
 */
async function detectRateLimiting(): Promise<{ limited: boolean; reason?: string }> {
  const result = await exec(`(function() {
    var bodyText = document.body.innerText.toLowerCase();
    
    if (bodyText.includes('rate limit')) return JSON.stringify({limited: true, reason: 'rate_limit'});
    if (bodyText.includes('try again later')) return JSON.stringify({limited: true, reason: 'try_again_later'});
    if (bodyText.includes('too many')) return JSON.stringify({limited: true, reason: 'too_many_requests'});
    if (bodyText.includes('locked')) return JSON.stringify({limited: true, reason: 'account_locked'});
    if (bodyText.includes('unusual activity')) return JSON.stringify({limited: true, reason: 'unusual_activity'});
    if (bodyText.includes('suspended')) return JSON.stringify({limited: true, reason: 'suspended'});
    
    return JSON.stringify({limited: false});
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return { limited: false };
  }
}

// ============== Navigation ==============

/**
 * Navigate to Twitter DMs inbox
 */
async function navigateToDMs(): Promise<boolean> {
  console.log('📬 Navigating to Twitter DMs...');
  
  await exec('window.location.href = "https://x.com/messages"');
  await wait(3000);
  
  const onDMs = await isOnTwitterDMs();
  if (onDMs) {
    console.log('   ✅ On Twitter DMs');
    return true;
  }
  
  console.log('   ❌ Failed to navigate to DMs');
  return false;
}

/**
 * Navigate to a specific conversation
 */
async function navigateToConversation(conversationId: string): Promise<boolean> {
  console.log(`📨 Opening conversation: ${conversationId}`);
  
  await exec(`window.location.href = "https://x.com/messages/${conversationId}"`);
  await wait(3000);
  
  const url = await getCurrentUrl();
  if (url.includes(conversationId)) {
    console.log('   ✅ Conversation opened');
    return true;
  }
  
  console.log('   ❌ Failed to open conversation');
  return false;
}

// ============== Conversation Operations ==============

interface TwitterConversation {
  id: string;
  displayName: string;
  username?: string;
  lastMessage: string;
  timestamp: string;
  unread: boolean;
}

/**
 * List all conversations in the inbox (enhanced with Safari Automation patterns)
 */
async function listConversations(): Promise<TwitterConversation[]> {
  // Make sure we're on DMs
  const onDMs = await isOnTwitterDMs();
  if (!onDMs) {
    await navigateToDMs();
    await wait(2000);
  }
  
  // Simplified extraction that works with current Twitter UI
  const result = await exec(`(function(){
    var convos = document.querySelectorAll('[data-testid^="dm-conversation-item"]');
    if (convos.length === 0) convos = document.querySelectorAll('[data-testid="conversation"]');
    var list = [];
    for (var i = 0; i < convos.length; i++) {
      var c = convos[i];
      var testid = c.getAttribute('data-testid') || '';
      var id = testid.replace('dm-conversation-item-', '');
      var text = c.innerText;
      var lines = text.split('\\n').filter(function(l) { return l.trim(); });
      list.push({
        id: id,
        displayName: lines[0] || '',
        username: '',
        lastMessage: (lines[2] || lines[1] || '').substring(0, 100),
        timestamp: lines[1] || '',
        unread: false
      });
    }
    return JSON.stringify(list);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Click on a conversation to open it
 */
async function openConversation(conversationId: string): Promise<boolean> {
  const result = await exec(`(function(){
    var conv = document.querySelector('[data-testid="dm-conversation-item-${conversationId}"]');
    if(conv) {
      conv.click();
      return 'clicked';
    }
    return 'not found';
  })()`);
  
  if (result === 'clicked') {
    await wait(2000);
    return true;
  }
  return false;
}

/**
 * Switch to DM tab (All or Requests)
 */
async function switchTab(tab: 'all' | 'requests'): Promise<boolean> {
  const selector = tab === 'all' 
    ? '[data-testid="dm-inbox-tab-all"]'
    : '[data-testid="dm-inbox-tab-requests"], [href="/messages/requests"]';
  
  const result = await exec(`(function(){
    var tabEl = document.querySelector('${selector}');
    if(tabEl) {
      tabEl.click();
      return 'clicked';
    }
    return 'not found';
  })()`);
  
  if (result === 'clicked') {
    await wait(1500);
    return true;
  }
  return false;
}

/**
 * Start a new conversation with a user
 */
async function startNewConversation(username: string): Promise<boolean> {
  console.log(`📝 Starting new conversation with @${username}`);
  
  // Click new chat button
  const newChatResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="dm-new-chat-button"]');
    if(!btn) btn = document.querySelector('[data-testid="NewDM_Button"]');
    if(btn) {
      btn.click();
      return 'clicked';
    }
    return 'not found';
  })()`);
  
  if (!newChatResult.includes('clicked')) {
    console.log('   ❌ Could not find new chat button');
    return false;
  }
  
  await wait(1500);
  
  // Type username in search
  const escapedUsername = username.replace(/"/g, '\\"');
  const searchResult = await exec(`(function(){
    var input = document.querySelector('[data-testid="dm-search-bar"]');
    if(!input) input = document.querySelector('[data-testid="SearchBox_Search_Input"]');
    if(!input) input = document.querySelector('input[placeholder*="Search"]');
    if(input) {
      input.focus();
      input.value = "${escapedUsername}";
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    }
    return 'not found';
  })()`);
  
  if (!searchResult.includes('typed')) {
    console.log('   ❌ Could not find search input');
    return false;
  }
  
  await wait(2000);
  
  // Click on user result
  const selectResult = await exec(`(function(){
    var results = document.querySelectorAll('[data-testid="TypeaheadUser"], [data-testid="UserCell"]');
    for(var i = 0; i < results.length; i++) {
      if(results[i].innerText.toLowerCase().includes('${escapedUsername.toLowerCase()}')) {
        results[i].click();
        return 'selected';
      }
    }
    return 'not found';
  })()`);
  
  if (!selectResult.includes('selected')) {
    console.log('   ❌ Could not find user in search results');
    return false;
  }
  
  await wait(1000);
  
  // Click Next button to open chat
  await exec(`(function(){
    var btns = document.querySelectorAll('button, [role="button"]');
    for(var i = 0; i < btns.length; i++) {
      if(btns[i].innerText.toLowerCase() === 'next') {
        btns[i].click();
        return 'clicked';
      }
    }
    return 'not found';
  })()`);
  
  await wait(1500);
  console.log('   ✅ New conversation ready');
  return true;
}

// ============== Message Operations ==============

interface TwitterMessage {
  text: string;
  isOutbound: boolean;
  timestamp?: string;
}

/**
 * Extract messages from current conversation
 * Uses message testids and detects inbound/outbound by position
 */
async function extractMessages(): Promise<TwitterMessage[]> {
  const result = await exec(`(function(){
    var messages = [];
    var windowWidth = window.innerWidth;
    
    // Try dm-message-list first
    var msgEls = document.querySelectorAll('[data-testid^="message-"]');
    if(msgEls.length === 0) msgEls = document.querySelectorAll('[data-testid="tweetText"]');
    
    for(var i = 0; i < msgEls.length; i++) {
      var el = msgEls[i];
      var text = el.innerText.trim();
      if(text && text.length > 0 && text.length < 2000) {
        // Detect outbound by position (right side = sent by user)
        var rect = el.getBoundingClientRect();
        var isOutbound = rect.left > (windowWidth / 2);
        messages.push({ text: text, isOutbound: isOutbound });
      }
    }
    
    if(messages.length === 0) {
      var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      for(var i = 0; i < cells.length; i++) {
        var text = cells[i].innerText.trim();
        if(text && text.length > 10 && text.length < 500) {
          messages.push({ text: text.substring(0, 300), isOutbound: false });
        }
      }
    }
    return JSON.stringify(messages);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Send a DM to the current conversation
 * Uses execCommand for reliable text input in Draft.js editor
 */
async function sendMessage(message: string): Promise<boolean> {
  console.log(`💬 Sending message: "${message.substring(0, 50)}..."`);
  
  // Find and focus textbox
  const textboxFound = await exec(`(function(){
    var tb = document.querySelector('[role="textbox"]');
    if(!tb) tb = document.querySelector('[data-testid="dmComposerTextInput"]');
    if(!tb) tb = document.querySelector('[contenteditable="true"]');
    if(tb) {
      tb.focus();
      return 'found: ' + tb.className.substring(0, 30);
    }
    return 'not found';
  })()`);
  
  if (!textboxFound.includes('found')) {
    console.log('   ❌ Could not find message input');
    return false;
  }
  
  await wait(300);
  
  // Type message using execCommand (works with Draft.js)
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const typeResult = await exec(`(function(){
    var tb = document.querySelector('[role="textbox"]');
    if(!tb) return 'no textbox';
    
    tb.focus();
    // Use execCommand for Draft.js compatibility
    document.execCommand('insertText', false, "${escapedMessage}");
    return 'typed';
  })()`);
  
  if (!typeResult.includes('typed')) {
    console.log('   ❌ Could not type message');
    return false;
  }
  
  await wait(500);
  
  // Click send button
  const sendResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="dmComposerSendButton"]');
    if(!btn) {
      var btns = document.querySelectorAll('[aria-label="Send"]');
      if(btns.length > 0) btn = btns[0];
    }
    if(btn) {
      btn.click();
      return 'sent';
    }
    return 'no send button';
  })()`);
  
  if (sendResult.includes('sent')) {
    console.log('   ✅ Message sent!');
    return true;
  }
  
  console.log('   ❌ Could not find Send button');
  return false;
}

/**
 * Send a DM to a user by username (profile-to-DM flow)
 */
async function sendDMByUsername(username: string, message: string): Promise<boolean> {
  console.log(`\n📤 Sending DM to @${username}`);
  
  // Navigate to user's profile
  console.log(`   📍 Navigating to profile...`);
  await exec(`window.location.href = "https://x.com/${username}"`);
  await wait(2000);
  
  // Wait for profile to load with retry
  let profileReady = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const profileCheck = await exec(`(function(){
      var primary = document.querySelector('[data-testid="primaryColumn"]');
      if(primary && primary.innerText.includes('This account doesn')) return 'not_found';
      var dmBtn = document.querySelector('[data-testid="sendDMFromProfile"]');
      return dmBtn ? 'profile_ready' : 'loading';
    })()`);
    
    if (profileCheck.includes('not_found')) {
      console.log(`   ❌ User @${username} not found`);
      return false;
    }
    
    if (profileCheck.includes('profile_ready')) {
      profileReady = true;
      break;
    }
    
    await wait(1000);
  }
  
  if (!profileReady) {
    console.log(`   ⏳ Profile loading slowly, continuing anyway...`);
  }
  
  // Click the Message button
  console.log(`   💬 Clicking Message button...`);
  const clickResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="sendDMFromProfile"]');
    if(btn) {
      btn.click();
      return 'clicked';
    }
    // Fallback: aria-label
    var msgBtn = document.querySelector('[aria-label="Message"]');
    if(msgBtn) {
      msgBtn.click();
      return 'clicked_aria';
    }
    return 'not found';
  })()`);
  
  if (!clickResult.includes('clicked')) {
    console.log('   ❌ Could not find Message button on profile');
    return false;
  }
  
  await wait(2000);
  
  // Type message using the new DM composer textarea
  console.log(`   ⌨️ Typing message...`);
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const typeResult = await exec(`(function(){
    var tb = document.querySelector('[data-testid="dm-composer-textarea"]');
    if(!tb) tb = document.querySelector('[role="textbox"]');
    if(!tb) tb = document.querySelector('[contenteditable="true"]');
    if(!tb) return 'no textbox';
    tb.focus();
    document.execCommand('insertText', false, "${escapedMessage}");
    return 'typed';
  })()`);
  
  if (!typeResult.includes('typed')) {
    console.log('   ❌ Could not type message');
    return false;
  }
  
  await wait(500);
  
  // Click send button
  const sendResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="dm-composer-send-button"]');
    if(!btn) btn = document.querySelector('[data-testid="dmComposerSendButton"]');
    if(!btn) btn = document.querySelector('[aria-label="Send"]');
    if(btn) {
      btn.click();
      return 'sent';
    }
    return 'no send button';
  })()`);
  
  if (sendResult.includes('sent')) {
    console.log('   ✅ Message sent!');
    return true;
  }
  
  console.log('   ❌ Could not find Send button');
  return false;
}

// ============== Profile Operations ==============

interface TwitterProfile {
  username: string;
  displayName: string;
  bio: string;
  followers: string;
  following: string;
}

/**
 * Extract profile data from current page
 */
async function extractProfileData(): Promise<TwitterProfile | null> {
  const result = await exec(`(function(){
    var profile = {};
    
    // Username from URL
    var url = window.location.href;
    var match = url.match(/x\\.com\\/([^\\/?]+)/);
    profile.username = match ? match[1] : '';
    
    // Display name
    var nameEl = document.querySelector('[data-testid="UserName"]');
    if(nameEl) {
      var spans = nameEl.querySelectorAll('span');
      if(spans.length > 0) profile.displayName = spans[0].innerText;
    }
    
    // Bio
    var bioEl = document.querySelector('[data-testid="UserDescription"]');
    profile.bio = bioEl ? bioEl.innerText : '';
    
    // Followers/Following
    var links = document.querySelectorAll('a[href*="followers"], a[href*="following"]');
    for(var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      var text = links[i].innerText;
      if(href.includes('followers')) profile.followers = text;
      if(href.includes('following')) profile.following = text;
    }
    
    return JSON.stringify(profile);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ============== Database Operations ==============

/**
 * Save conversation to database
 */
async function saveConversationToDatabase(username: string, displayName: string, messages: TwitterMessage[]): Promise<{ contactId: string; saved: number }> {
  // Upsert contact
  const { data: contact, error: contactError } = await supabase
    .from('twitter_contacts')
    .upsert({
      twitter_username: username.toLowerCase(),
      display_name: displayName,
      updated_at: new Date().toISOString()
    }, { onConflict: 'twitter_username' })
    .select('id')
    .single();
  
  if (contactError || !contact) {
    console.error('Error upserting contact:', contactError?.message);
    return { contactId: '', saved: 0 };
  }
  
  // Upsert conversation
  const { data: conversation } = await supabase
    .from('twitter_conversations')
    .upsert({
      contact_id: contact.id,
      last_message_at: new Date().toISOString(),
      last_message_preview: messages[messages.length - 1]?.text?.substring(0, 100) || '',
      updated_at: new Date().toISOString()
    }, { onConflict: 'contact_id' })
    .select('id')
    .single();
  
  if (!conversation) return { contactId: contact.id, saved: 0 };
  
  // Insert messages
  let saved = 0;
  for (const msg of messages) {
    const { error } = await supabase
      .from('twitter_messages')
      .insert({
        conversation_id: conversation.id,
        contact_id: contact.id,
        message_text: msg.text,
        is_outbound: msg.isOutbound,
        sent_at: new Date().toISOString()
      });
    if (!error) saved++;
  }
  
  return { contactId: contact.id, saved };
}

/**
 * Get database stats
 */
async function getDatabaseStats(): Promise<{ contacts: number; conversations: number; messages: number }> {
  const { count: contacts } = await supabase.from('twitter_contacts').select('*', { count: 'exact', head: true });
  const { count: conversations } = await supabase.from('twitter_conversations').select('*', { count: 'exact', head: true });
  const { count: messages } = await supabase.from('twitter_messages').select('*', { count: 'exact', head: true });
  
  return {
    contacts: contacts || 0,
    conversations: conversations || 0,
    messages: messages || 0
  };
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
 * Calculate relationship health score (0-100)
 */
async function calculateRelationshipScore(username: string): Promise<RelationshipScore | null> {
  const clean = username.replace('@', '').toLowerCase();
  
  const { data: contact } = await supabase
    .from('twitter_contacts')
    .select('*')
    .eq('twitter_username', clean)
    .single();
  
  if (!contact) return null;
  
  const lastTouch = contact.last_meaningful_touch ? new Date(contact.last_meaningful_touch) : null;
  const daysSinceTouch = lastTouch ? (Date.now() - lastTouch.getTime()) / (1000 * 60 * 60 * 24) : 999;
  const recency = daysSinceTouch <= 7 ? 20 : daysSinceTouch <= 14 ? 15 : daysSinceTouch <= 30 ? 10 : daysSinceTouch <= 60 ? 5 : 0;
  
  const resonance = Math.min(20, contact.resonance_score || 0);
  const needClarity = Math.min(15, contact.need_clarity_score || 0);
  const valueDelivered = Math.min(20, contact.value_delivered_score || 0);
  const reliability = Math.min(15, contact.reliability_score || 0);
  const consent = Math.min(10, contact.consent_level || 0);
  
  const total = recency + resonance + needClarity + valueDelivered + reliability + consent;
  const stage = contact.relationship_stage || 'first_touch';
  
  let nextAction = null;
  if (total < 40) nextAction = 'rewarm: low_friction';
  else if (total < 60) nextAction = 'service: permission_to_help';
  else if (total < 80) nextAction = 'friendship: check_in';
  else if (stage === 'fit_repeats') nextAction = 'offer: permissioned_offer';
  
  return { total, recency, resonance, needClarity, valueDelivered, reliability, consent, stage, nextAction };
}

/**
 * Record interaction to update scores
 */
async function recordInteraction(
  username: string,
  interactionType: 'reply_received' | 'value_delivered' | 'promise_kept' | 'consent_given' | 'trust_signal'
): Promise<boolean> {
  const clean = username.replace('@', '').toLowerCase();
  
  const { data: contact } = await supabase
    .from('twitter_contacts')
    .select('id, resonance_score, value_delivered_score, reliability_score, consent_level, trust_signals')
    .eq('twitter_username', clean)
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
    .from('twitter_contacts')
    .update(updates)
    .eq('id', contact.id);
  
  return !error;
}

/**
 * Get next-best-action for a contact
 */
async function getNextBestAction(username: string): Promise<any> {
  const score = await calculateRelationshipScore(username);
  if (!score) return null;
  
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
 * Get contacts needing attention
 */
async function getContactsNeedingAttention(limit = 10): Promise<any[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data } = await supabase
    .from('twitter_contacts')
    .select('twitter_username, display_name, relationship_score, last_meaningful_touch, relationship_stage')
    .or(`last_meaningful_touch.lt.${thirtyDaysAgo},last_meaningful_touch.is.null`)
    .order('relationship_score', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Get top contacts by relationship score
 */
async function getTopContacts(limit = 10): Promise<any[]> {
  const { data } = await supabase
    .from('twitter_contacts')
    .select('twitter_username, display_name, relationship_score, total_messages_sent, total_messages_received')
    .order('relationship_score', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Search messages in database
 */
async function searchMessages(query: string, limit = 20): Promise<any[]> {
  const { data } = await supabase
    .from('twitter_messages')
    .select(`
      id,
      message_text,
      is_outbound,
      sent_at,
      twitter_contacts(twitter_username, display_name)
    `)
    .ilike('message_text', `%${query}%`)
    .order('sent_at', { ascending: false })
    .limit(limit);
  
  return data || [];
}

// ============== Status & Diagnostics ==============

/**
 * Get Twitter DM status and diagnostics
 */
async function getStatus(): Promise<any> {
  const url = await getCurrentUrl();
  const onTwitter = url.includes('x.com') || url.includes('twitter.com');
  const onDMs = url.includes('messages') || url.includes('i/chat');
  
  const elementCheck = await exec(`(function(){
    return JSON.stringify({
      dmContainer: !!document.querySelector('[data-testid="dm-container"]'),
      dmInbox: !!document.querySelector('[data-testid="dm-inbox-panel"]'),
      conversations: document.querySelectorAll('[data-testid^="dm-conversation-item"]').length,
      textbox: !!document.querySelector('[role="textbox"]'),
      sendButton: !!document.querySelector('[data-testid="dmComposerSendButton"]')
    });
  })()`);
  
  let elements = {};
  try {
    elements = JSON.parse(elementCheck);
  } catch {}
  
  return {
    url,
    onTwitter,
    onDMs,
    elements
  };
}

// ============== CLI ==============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('\n🐦 Twitter/X DM Automation API\n');
  
  if (!command || command === 'help') {
    console.log('Commands:');
    console.log('  status                       - Full status (login, rate limit, elements)');
    console.log('  login                        - Check login status');
    console.log('  ratelimit                    - Check rate limiting');
    console.log('  navigate                     - Navigate to DMs inbox');
    console.log('  conversations                - List all conversations');
    console.log('  open <id>                    - Open a conversation');
    console.log('  messages                     - Extract messages');
    console.log('  send <message>               - Send message');
    console.log('  dm <username> <message>      - Send DM to user');
    console.log('  profile <username>           - Extract profile data');
    console.log('  stats                        - Database statistics');
    console.log('  health <username>            - Relationship health score');
    console.log('  nextaction <username>        - AI next-best-action');
    console.log('  detect <text>                - Detect fit signals');
    console.log('  attention                    - Contacts needing care');
    console.log('  top                          - Top contacts by score');
    console.log('  search <query>               - Search messages');
    console.log('  explore                      - Explore DOM');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/twitter-api.ts status');
    console.log('  npx tsx scripts/twitter-api.ts conversations');
    console.log('  npx tsx scripts/twitter-api.ts dm elonmusk "Hello!"');
    return;
  }
  
  // Commands that don't require arguments
  const noArgCommands = ['status', 'login', 'ratelimit', 'navigate', 'conversations', 'messages', 'stats', 'attention', 'top', 'explore'];
  
  switch (command) {
    case 'status': {
      const status = await getStatus();
      const login = await checkLoginStatus();
      const rateLimit = await detectRateLimiting();
      
      console.log('📊 Twitter DM Status:\n');
      console.log(`  URL: ${status.url}`);
      console.log(`  On Twitter: ${status.onTwitter}`);
      console.log(`  On DMs: ${status.onDMs}`);
      console.log(`  Logged In: ${login.loggedIn}${login.username ? ' (@' + login.username + ')' : ''}`);
      console.log(`  Rate Limited: ${rateLimit.limited}${rateLimit.reason ? ' (' + rateLimit.reason + ')' : ''}`);
      console.log(`  Elements:`, status.elements);
      break;
    }
    
    case 'login': {
      const login = await checkLoginStatus();
      console.log('🔐 Twitter Login Status:\n');
      if (login.loggedIn) {
        console.log(`  ✅ Logged in as @${login.username}`);
      } else {
        console.log(`  ❌ Not logged in (${login.reason})`);
      }
      break;
    }
    
    case 'ratelimit': {
      const rateLimit = await detectRateLimiting();
      console.log('⚠️ Rate Limit Check:\n');
      if (rateLimit.limited) {
        console.log(`  ❌ Rate limited: ${rateLimit.reason}`);
      } else {
        console.log(`  ✅ No rate limiting detected`);
      }
      console.log('\n  Recommended limits:');
      console.log(`    Max DMs/hour: ${RATE_LIMITS.maxDmsPerHour}`);
      console.log(`    Max DMs/day: ${RATE_LIMITS.maxDmsPerDay}`);
      console.log(`    Min delay: ${RATE_LIMITS.minDelayBetweenDms / 1000}s`);
      break;
    }
    
    case 'navigate': {
      await navigateToDMs();
      break;
    }
    
    case 'conversations': {
      console.log('📬 Listing conversations...\n');
      const convos = await listConversations();
      if (convos.length === 0) {
        console.log('  No conversations found');
      } else {
        convos.forEach((c, i) => {
          console.log(`  ${i + 1}. ${c.displayName}`);
          console.log(`     ID: ${c.id}`);
          console.log(`     Last: ${c.lastMessage.substring(0, 50)}...`);
          console.log('');
        });
      }
      console.log(`  Total: ${convos.length} conversations`);
      break;
    }
    
    case 'open': {
      const convId = args[1];
      if (!convId) {
        console.log('Usage: open <conversation_id>');
        break;
      }
      await openConversation(convId);
      break;
    }
    
    case 'messages': {
      console.log('📨 Extracting messages...\n');
      const msgs = await extractMessages();
      if (msgs.length === 0) {
        console.log('  No messages found');
      } else {
        msgs.forEach((m, i) => {
          const dir = m.isOutbound ? '→' : '←';
          console.log(`  ${dir} ${m.text.substring(0, 80)}...`);
        });
      }
      console.log(`\n  Total: ${msgs.length} messages`);
      break;
    }
    
    case 'send': {
      const message = args.slice(1).join(' ');
      if (!message) {
        console.log('Usage: send <message>');
        break;
      }
      await sendMessage(message);
      break;
    }
    
    case 'dm': {
      const username = args[1];
      const message = args.slice(2).join(' ');
      if (!username || !message) {
        console.log('Usage: dm <username> <message>');
        break;
      }
      await sendDMByUsername(username, message);
      break;
    }
    
    case 'profile': {
      const username = args[1];
      if (username) {
        await exec(`window.location.href = "https://x.com/${username}"`);
        await wait(3000);
      }
      const profile = await extractProfileData();
      if (profile) {
        console.log('👤 Profile:\n');
        console.log(`  Username: @${profile.username}`);
        console.log(`  Name: ${profile.displayName}`);
        console.log(`  Bio: ${profile.bio}`);
        console.log(`  Followers: ${profile.followers}`);
        console.log(`  Following: ${profile.following}`);
      } else {
        console.log('  Could not extract profile');
      }
      break;
    }
    
    case 'explore': {
      console.log('🔍 Exploring current page...\n');
      const testIds = await exec(`(function(){
        var all = document.querySelectorAll('[data-testid]');
        var ids = [];
        for(var i = 0; i < all.length; i++) {
          ids.push(all[i].getAttribute('data-testid'));
        }
        return ids.join('\\n');
      })()`);
      console.log('  data-testid attributes found:\n');
      testIds.split('\n').forEach(id => console.log(`    ${id}`));
      break;
    }
    
    case 'stats': {
      const stats = await getDatabaseStats();
      console.log('📊 Twitter Database Stats:\n');
      console.log(`  Contacts:      ${stats.contacts}`);
      console.log(`  Conversations: ${stats.conversations}`);
      console.log(`  Messages:      ${stats.messages}`);
      break;
    }
    
    case 'health': {
      const username = args[1];
      if (!username) {
        console.log('Usage: health <username>');
        break;
      }
      console.log(`💚 Relationship Health Score for @${username}:\n`);
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
      const username = args[1];
      if (!username) {
        console.log('Usage: nextaction <username>');
        break;
      }
      console.log(`🎯 Next Best Action for @${username}:\n`);
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
    
    case 'detect': {
      const text = args.slice(1).join(' ');
      if (!text) {
        console.log('Usage: detect <message text>');
        break;
      }
      console.log(`🔍 Detecting fit signals in: "${text.substring(0, 50)}..."\n`);
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
    
    case 'attention': {
      console.log('⚠️ Twitter Contacts Needing Attention:\n');
      const needAttention = await getContactsNeedingAttention(10);
      if (needAttention.length === 0) {
        console.log('  All contacts are healthy!');
      } else {
        needAttention.forEach((c, i) => {
          const lastTouch = c.last_meaningful_touch ? new Date(c.last_meaningful_touch).toLocaleDateString() : 'never';
          console.log(`  ${i + 1}. @${c.twitter_username?.padEnd(25)} Last: ${lastTouch}`);
        });
      }
      break;
    }
    
    case 'top': {
      console.log('🏆 Top Twitter Contacts:\n');
      const top = await getTopContacts(10);
      if (top.length === 0) {
        console.log('  No contacts yet');
      } else {
        top.forEach((c, i) => {
          console.log(`  ${i + 1}. @${c.twitter_username?.padEnd(25)} Score: ${c.relationship_score || 50}`);
        });
      }
      break;
    }
    
    case 'search': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.log('Usage: search <query>');
        break;
      }
      console.log(`🔍 Searching messages for "${query}"...\n`);
      const results = await searchMessages(query);
      if (results.length === 0) {
        console.log('  No messages found');
      } else {
        results.forEach((m, i) => {
          const dir = m.is_outbound ? '→' : '←';
          const contact = (m as any).twitter_contacts;
          console.log(`  ${i + 1}. ${dir} @${contact?.twitter_username}: ${m.message_text.substring(0, 60)}...`);
        });
      }
      break;
    }
    
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run with no arguments for help.');
  }
}

main();

export {
  // Navigation
  navigateToDMs,
  navigateToConversation,
  
  // Conversations
  listConversations,
  openConversation,
  switchTab,
  startNewConversation,
  extractMessages,
  sendMessage,
  sendDMByUsername,
  extractProfileData,
  
  // Login & Safety
  checkLoginStatus,
  detectRateLimiting,
  
  // Database
  saveConversationToDatabase,
  getDatabaseStats,
  
  // Relationship Scoring (Revio Framework)
  calculateRelationshipScore,
  recordInteraction,
  getNextBestAction,
  detectFitSignals,
  getContactsNeedingAttention,
  getTopContacts,
  searchMessages,
  
  // Status & Config
  getStatus,
  RATE_LIMITS,
  SELECTORS
};
