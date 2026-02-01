#!/usr/bin/env npx tsx
/**
 * TikTok DM API Verification Script
 * Tests all API endpoints and reports status
 * 
 * Usage: npx tsx scripts/tiktok-verify.ts
 */

export {};

const TIKTOK_API = process.env.TIKTOK_API_URL || 'http://localhost:3102';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  data?: any;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<any>): Promise<void> {
  try {
    const data = await fn();
    results.push({ name, passed: true, message: 'OK', data });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, message: String(error) });
    console.log(`❌ ${name}: ${error}`);
  }
}

async function get(endpoint: string): Promise<any> {
  const res = await fetch(`${TIKTOK_API}${endpoint}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(endpoint: string, body?: any): Promise<any> {
  const res = await fetch(`${TIKTOK_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function runTests(): Promise<void> {
  console.log('\n🧪 TikTok DM API Verification\n');
  console.log(`   API URL: ${TIKTOK_API}\n`);
  console.log('─'.repeat(50) + '\n');

  // 1. Health Check
  await runTest('Health Check', async () => {
    const data = await get('/health');
    if (data.status !== 'ok') throw new Error('Health check failed');
    if (data.platform !== 'tiktok') throw new Error('Wrong platform');
    return data;
  });

  // 2. Status Check
  await runTest('Status Check', async () => {
    const data = await get('/api/tiktok/status');
    if (typeof data.isOnTikTok !== 'boolean') throw new Error('Missing isOnTikTok');
    if (typeof data.isLoggedIn !== 'boolean') throw new Error('Missing isLoggedIn');
    return data;
  });

  // 3. Error Check
  await runTest('Error Detection', async () => {
    const data = await get('/api/tiktok/error-check');
    if (typeof data.hasError !== 'boolean') throw new Error('Missing hasError');
    return data;
  });

  // 4. Rate Limits
  await runTest('Rate Limits', async () => {
    const data = await get('/api/tiktok/rate-limits');
    if (!data.limits) throw new Error('Missing limits');
    if (typeof data.messagesSentToday !== 'number') throw new Error('Missing messagesSentToday');
    return data;
  });

  // 5. Navigate to Inbox
  await runTest('Navigate to Inbox', async () => {
    const data = await post('/api/tiktok/inbox/navigate');
    if (!data.success) throw new Error(data.error || 'Navigation failed');
    return data;
  });

  // 6. List Conversations
  await runTest('List Conversations', async () => {
    const data = await get('/api/tiktok/conversations');
    if (!Array.isArray(data.conversations)) throw new Error('Missing conversations array');
    if (typeof data.count !== 'number') throw new Error('Missing count');
    return { count: data.count, sample: data.conversations.slice(0, 2) };
  });

  // 7. Open Conversation (if conversations exist)
  const convos = results.find(r => r.name === 'List Conversations');
  if (convos?.passed && convos.data?.count > 0) {
    await runTest('Open Conversation', async () => {
      const firstName = convos.data.sample[0]?.displayName?.split(' ')[0]?.toLowerCase();
      if (!firstName) throw new Error('No conversation to open');
      const data = await post('/api/tiktok/conversations/open', { username: firstName });
      if (!data.success) throw new Error(data.error || 'Failed to open');
      return data;
    });

    // 8. Read Messages
    await runTest('Read Messages', async () => {
      const data = await get('/api/tiktok/messages');
      if (!Array.isArray(data.messages)) throw new Error('Missing messages array');
      return { count: data.count, sample: data.messages.slice(0, 2) };
    });
  }

  // 9. Execute Script (raw)
  await runTest('Execute Script', async () => {
    const data = await post('/api/execute', { 
      script: 'document.title' 
    });
    if (!data.output) throw new Error('No output');
    return { title: data.output };
  });

  // Summary
  console.log('\n' + '─'.repeat(50));
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n📊 Results: ${passed}/${total} tests passed\n`);

  if (passed === total) {
    console.log('🎉 All tests passed! TikTok DM API is ready.\n');
  } else {
    console.log('⚠️  Some tests failed. Check the output above.\n');
    process.exit(1);
  }
}

runTests().catch(console.error);
