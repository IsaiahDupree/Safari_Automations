#!/usr/bin/env npx tsx
/**
 * TikTok DM Integration Example
 * Demonstrates how to integrate TikTok DM API into your application
 * 
 * Usage: npx tsx scripts/tiktok-integration-example.ts
 */

export {};

const API_BASE = 'http://localhost:3102';

// Helper functions
async function apiGet(endpoint: string): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  return res.json() as Promise<any>;
}

async function apiPost(endpoint: string, body?: any): Promise<any> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json() as Promise<any>;
}

// ============================================
// EXAMPLE 1: Check API Status
// ============================================
async function checkStatus() {
  console.log('\n📊 Example 1: Check Status\n');
  
  // Health check
  const health = await apiGet('/health');
  console.log('Health:', health);
  
  // TikTok status
  const status = await apiGet('/api/tiktok/status');
  console.log('Status:', status);
  
  // Error check
  const error = await apiGet('/api/tiktok/error-check');
  console.log('Error state:', error);
  
  return status.isLoggedIn;
}

// ============================================
// EXAMPLE 2: List Conversations
// ============================================
async function listConversations() {
  console.log('\n💬 Example 2: List Conversations\n');
  
  // Navigate to inbox first
  await apiPost('/api/tiktok/inbox/navigate');
  
  // Get conversations
  const data = await apiGet('/api/tiktok/conversations');
  console.log(`Found ${data.count} conversations`);
  
  // Show first 5
  data.conversations.slice(0, 5).forEach((c: any, i: number) => {
    console.log(`  ${i + 1}. ${c.displayName} - "${c.lastMessage?.substring(0, 30)}..."`);
  });
  
  return data.conversations;
}

// ============================================
// EXAMPLE 3: Read Messages from a Conversation
// ============================================
async function readMessages(username: string) {
  console.log(`\n📖 Example 3: Read Messages from ${username}\n`);
  
  // Open the conversation
  const opened = await apiPost('/api/tiktok/conversations/open', { username });
  if (!opened.success) {
    console.log('Failed to open conversation:', opened.error);
    return [];
  }
  
  // Wait for chat to load
  await new Promise(r => setTimeout(r, 1500));
  
  // Read messages
  const data = await apiGet('/api/tiktok/messages?limit=10');
  console.log(`Found ${data.count} messages`);
  
  data.messages.slice(0, 5).forEach((m: any, i: number) => {
    const sender = m.sender === 'me' ? '→' : '←';
    console.log(`  ${sender} [${m.type}] ${m.content?.substring(0, 40)}...`);
  });
  
  return data.messages;
}

// ============================================
// EXAMPLE 4: Check Rate Limits Before Sending
// ============================================
async function checkRateLimits() {
  console.log('\n⏱️ Example 4: Check Rate Limits\n');
  
  const limits = await apiGet('/api/tiktok/rate-limits');
  
  console.log(`  Hourly: ${limits.messagesSentThisHour}/${limits.limits.messagesPerHour}`);
  console.log(`  Daily:  ${limits.messagesSentToday}/${limits.limits.messagesPerDay}`);
  console.log(`  Active: ${limits.activeHours.isActive ? 'Yes' : 'No'}`);
  
  const canSend = 
    limits.messagesSentThisHour < limits.limits.messagesPerHour &&
    limits.messagesSentToday < limits.limits.messagesPerDay &&
    limits.activeHours.isActive;
  
  console.log(`  Can send: ${canSend ? '✅ Yes' : '❌ No'}`);
  
  return canSend;
}

// ============================================
// EXAMPLE 5: Execute Custom JavaScript
// ============================================
async function executeCustomScript() {
  console.log('\n🔧 Example 5: Execute Custom Script\n');
  
  // Get page title
  const title = await apiPost('/api/execute', {
    script: 'document.title'
  });
  console.log('Page title:', title.output);
  
  // Get conversation count
  const count = await apiPost('/api/execute', {
    script: 'document.querySelectorAll("[data-e2e=chat-list-item]").length'
  });
  console.log('Conversation count:', count.output);
  
  // Get current user info
  const header = await apiPost('/api/execute', {
    script: `JSON.stringify({
      nickname: document.querySelector('[data-e2e="chat-nickname"]')?.innerText,
      username: document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText
    })`
  });
  console.log('Chat header:', JSON.parse(header.output || '{}'));
}

// ============================================
// EXAMPLE 6: Error Detection & Recovery
// ============================================
async function handleErrors() {
  console.log('\n🔄 Example 6: Error Detection & Recovery\n');
  
  // Check for error
  const errorCheck = await apiGet('/api/tiktok/error-check');
  
  if (errorCheck.hasError) {
    console.log('Error detected! Attempting retry...');
    const retry = await apiPost('/api/tiktok/error-retry');
    console.log('Retry result:', retry);
    
    if (retry.hasError) {
      console.log('Still has error after retry. Manual intervention needed.');
    } else {
      console.log('Error recovered successfully!');
    }
  } else {
    console.log('No error detected. Page is healthy.');
  }
}

// ============================================
// EXAMPLE 7: Full Integration Flow
// ============================================
async function fullIntegrationFlow() {
  console.log('\n🚀 Example 7: Full Integration Flow\n');
  
  // 1. Check status
  const status = await apiGet('/api/tiktok/status');
  if (!status.isLoggedIn) {
    console.log('❌ Not logged in to TikTok');
    return;
  }
  console.log('✅ Logged in');
  
  // 2. Check for errors
  const errorCheck = await apiGet('/api/tiktok/error-check');
  if (errorCheck.hasError) {
    await apiPost('/api/tiktok/error-retry');
    console.log('⚠️ Recovered from error');
  }
  
  // 3. Navigate to inbox
  await apiPost('/api/tiktok/inbox/navigate');
  console.log('✅ Navigated to inbox');
  
  // 4. Get conversations
  const convos = await apiGet('/api/tiktok/conversations');
  console.log(`✅ Found ${convos.count} conversations`);
  
  // 5. Check rate limits
  const limits = await apiGet('/api/tiktok/rate-limits');
  const canSend = limits.messagesSentThisHour < limits.limits.messagesPerHour;
  console.log(`✅ Rate limits OK: ${canSend}`);
  
  console.log('\n🎉 Integration flow complete!');
}

// Run examples
async function main() {
  console.log('═'.repeat(50));
  console.log('  TikTok DM API Integration Examples');
  console.log('═'.repeat(50));
  
  try {
    await checkStatus();
    await listConversations();
    await readMessages('sarah'); // Change to a real username
    await checkRateLimits();
    await executeCustomScript();
    await handleErrors();
    await fullIntegrationFlow();
    
    console.log('\n' + '═'.repeat(50));
    console.log('  All examples completed!');
    console.log('═'.repeat(50) + '\n');
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
}

main();
