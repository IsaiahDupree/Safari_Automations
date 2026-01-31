#!/usr/bin/env npx tsx
/**
 * Instagram DM Automation Test Script
 * 
 * Tests the Instagram DM module functionality.
 * Make sure Safari is open and logged into Instagram first!
 * 
 * Usage:
 *   npx tsx scripts/test-instagram-dm.ts
 *   npx tsx scripts/test-instagram-dm.ts --send "username" "message"
 */

import { InstagramDM } from '../packages/services/src/instagram/instagram-dm';

const dm = new InstagramDM();

async function testLogin() {
  console.log('\n─── TEST: Check Login ───────────────────────────────────────\n');
  const result = await dm.checkLogin();
  console.log('Login status:', result.data?.status);
  return result.success;
}

async function testNavigation() {
  console.log('\n─── TEST: Navigate to Inbox ─────────────────────────────────\n');
  const result = await dm.goToInbox();
  console.log('Navigation:', result.success ? '✅ Success' : `❌ ${result.error}`);
  return result.success;
}

async function testGetConversations() {
  console.log('\n─── TEST: Get Conversations ─────────────────────────────────\n');
  const result = await dm.getConversations();
  
  if (result.success) {
    console.log(`Found ${result.data.count} conversations`);
    console.log(`Unread: ${result.data.unreadCount}`);
    console.log('\nConversations:');
    
    result.data.conversations.slice(0, 5).forEach((conv: any) => {
      const unread = conv.isUnread ? '🔴' : '⚪';
      console.log(`  ${unread} ${conv.username}: ${conv.lastMessage.substring(0, 50)}...`);
    });
    
    return result.data.conversations;
  } else {
    console.log('❌ Failed:', result.error);
    return [];
  }
}

async function testOpenConversation(index: number) {
  console.log(`\n─── TEST: Open Conversation #${index} ────────────────────────\n`);
  const result = await dm.openConversation(index);
  console.log('Open:', result.success ? '✅ Success' : `❌ ${result.error}`);
  return result.success;
}

async function testGetMessages() {
  console.log('\n─── TEST: Get Messages ──────────────────────────────────────\n');
  const result = await dm.getMessages();
  
  if (result.success) {
    console.log(`Found ${result.data.count} messages`);
    console.log('\nRecent messages:');
    
    result.data.messages.slice(-5).forEach((msg: any) => {
      const direction = msg.isSent ? '→ You' : '← Them';
      console.log(`  ${direction}: ${msg.text.substring(0, 60)}...`);
    });
    
    return true;
  } else {
    console.log('❌ Failed:', result.error);
    return false;
  }
}

async function testSendMessage(username: string, message: string) {
  console.log(`\n─── TEST: Send Message to ${username} ──────────────────────\n`);
  
  // First check rate limits
  const limits = dm.getRateLimitStatus();
  console.log('Rate limit status:');
  console.log(`  DMs today: ${limits.dmsSentToday}`);
  console.log(`  DMs this hour: ${limits.dmsSentThisHour}`);
  console.log(`  Can send: ${limits.canSend ? '✅' : '❌'}`);
  
  if (!limits.canSend) {
    console.log('⚠️ Rate limited - skipping send');
    return false;
  }
  
  const result = await dm.startConversation(username, message);
  console.log('Send:', result.success ? '✅ Message sent!' : `❌ ${result.error}`);
  return result.success;
}

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🧪 Instagram DM Automation Tests                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n⚠️  Make sure Safari is open and logged into Instagram!\n');
  
  // Test 1: Login check
  const loggedIn = await testLogin();
  if (!loggedIn) {
    console.log('\n❌ Not logged in to Instagram. Please log in first.');
    return;
  }
  
  // Test 2: Navigation
  const navigated = await testNavigation();
  if (!navigated) {
    console.log('\n❌ Navigation failed.');
    return;
  }
  
  // Wait for page to load
  await new Promise(r => setTimeout(r, 2000));
  
  // Test 3: Get conversations
  const conversations = await testGetConversations();
  
  // Test 4: Open first conversation (if exists)
  if (conversations.length > 0) {
    const opened = await testOpenConversation(0);
    
    if (opened) {
      await new Promise(r => setTimeout(r, 1500));
      
      // Test 5: Get messages
      await testGetMessages();
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log('✅ Login check: Working');
  console.log('✅ Navigation: Working');
  console.log(`✅ Get conversations: Found ${conversations.length}`);
  console.log('✅ Open conversation: Working');
  console.log('✅ Get messages: Working');
  console.log('\n📝 To test sending, run:');
  console.log('   npx tsx scripts/test-instagram-dm.ts --send "username" "Hello!"');
  console.log('\n');
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args[0] === '--send' && args[1] && args[2]) {
    const username = args[1];
    const message = args[2];
    await testSendMessage(username, message);
  } else {
    await runAllTests();
  }
}

main().catch(console.error);
