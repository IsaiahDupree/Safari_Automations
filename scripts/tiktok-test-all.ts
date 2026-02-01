#!/usr/bin/env npx tsx
/**
 * TikTok DM Complete Test Suite
 * Runs all tests and generates a report
 * 
 * Usage:
 *   npx tsx scripts/tiktok-test-all.ts           # Run all tests
 *   npx tsx scripts/tiktok-test-all.ts --save    # Run tests and save report
 *   npx tsx scripts/tiktok-test-all.ts --json    # Output JSON only
 */

export {};

const API = 'http://localhost:3102';
const args = process.argv.slice(2);
const SAVE_REPORT = args.includes('--save');
const JSON_ONLY = args.includes('--json');

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  message: string;
  data?: any;
  duration: number;
}

const results: TestResult[] = [];
let startTime = Date.now();

async function exec(script: string): Promise<string> {
  const res = await fetch(`${API}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
  const data = await res.json() as { output?: string };
  return data.output || '';
}

async function get(endpoint: string): Promise<any> {
  const res = await fetch(`${API}${endpoint}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function post(endpoint: string, body?: any): Promise<any> {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function runTest(category: string, name: string, fn: () => Promise<any>): Promise<void> {
  const testStart = Date.now();
  try {
    const data = await fn();
    results.push({ 
      name, 
      category, 
      passed: true, 
      message: 'OK', 
      data,
      duration: Date.now() - testStart
    });
    if (!JSON_ONLY) console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ 
      name, 
      category, 
      passed: false, 
      message: String(error),
      duration: Date.now() - testStart
    });
    if (!JSON_ONLY) console.log(`  ❌ ${name}: ${error}`);
  }
}

async function runAllTests(): Promise<void> {
  if (!JSON_ONLY) {
    console.log('\n' + '═'.repeat(60));
    console.log('  TikTok DM Complete Test Suite');
    console.log('═'.repeat(60) + '\n');
  }

  // ========================================
  // API Tests
  // ========================================
  if (!JSON_ONLY) console.log('📡 API Tests\n');

  await runTest('API', 'Health Check', async () => {
    const data = await get('/health');
    if (data.status !== 'ok') throw new Error('Health check failed');
    return data;
  });

  await runTest('API', 'TikTok Status', async () => {
    const data = await get('/api/tiktok/status');
    if (typeof data.isOnTikTok !== 'boolean') throw new Error('Invalid status');
    return data;
  });

  await runTest('API', 'Error Detection', async () => {
    const data = await get('/api/tiktok/error-check');
    if (typeof data.hasError !== 'boolean') throw new Error('Invalid error check');
    return data;
  });

  await runTest('API', 'Rate Limits', async () => {
    const data = await get('/api/tiktok/rate-limits');
    if (!data.limits) throw new Error('Missing limits');
    return data;
  });

  // ========================================
  // Navigation Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n🧭 Navigation Tests\n');

  await runTest('Navigation', 'Navigate to Inbox', async () => {
    const data = await post('/api/tiktok/inbox/navigate');
    if (!data.success) throw new Error(data.error || 'Navigation failed');
    return data;
  });

  // ========================================
  // Conversation Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n💬 Conversation Tests\n');

  await runTest('Conversations', 'List Conversations', async () => {
    const data = await get('/api/tiktok/conversations');
    if (!Array.isArray(data.conversations)) throw new Error('Invalid conversations');
    return { count: data.count };
  });

  await runTest('Conversations', 'Conversation Item Selectors', async () => {
    const result = await exec(`(function(){
      var item = document.querySelector('[data-e2e="chat-list-item"]');
      if (!item) return JSON.stringify({error: 'No conversation found'});
      return JSON.stringify({
        hasNickname: !!item.querySelector('[class*="PInfoNickname"]'),
        hasExtract: !!item.querySelector('[class*="SpanInfoExtract"]'),
        hasTime: !!item.querySelector('[class*="SpanInfoTime"]'),
        hasAvatar: !!item.querySelector('[class*="ImgAvatar"]')
      });
    })()`);
    const data = JSON.parse(result);
    if (!data.hasNickname) throw new Error('Missing nickname selector');
    return data;
  });

  // ========================================
  // Chat Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n📨 Chat Tests\n');

  await runTest('Chat', 'Open Conversation', async () => {
    const data = await post('/api/tiktok/conversations/open', { username: 'sarah' });
    if (!data.success) throw new Error(data.error || 'Failed to open');
    return data;
  });

  await new Promise(r => setTimeout(r, 1000));

  await runTest('Chat', 'Chat Header Selectors', async () => {
    const result = await exec(`(function(){
      return JSON.stringify({
        nickname: document.querySelector('[data-e2e="chat-nickname"]')?.innerText || null,
        username: document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText || null,
        hasAvatar: !!document.querySelector('[data-e2e="top-chat-avatar"]')
      });
    })()`);
    const data = JSON.parse(result);
    if (!data.nickname) throw new Error('Missing nickname');
    return data;
  });

  await runTest('Chat', 'Message Selectors', async () => {
    const result = await exec(`(function(){
      var msgs = document.querySelectorAll('[data-e2e="chat-item"]');
      return JSON.stringify({
        count: msgs.length,
        hasTextContainer: !!document.querySelector('[class*="DivTextContainer"]'),
        hasVideoContainer: !!document.querySelector('[class*="DivVideoContainer"]'),
        hasTimeContainer: !!document.querySelector('[class*="DivTimeContainer"]')
      });
    })()`);
    const data = JSON.parse(result);
    if (data.count === 0) throw new Error('No messages found');
    return data;
  });

  await runTest('Chat', 'Chat Type Detection', async () => {
    const result = await exec(`(function(){
      var strangerBox = document.querySelector('[class*="StrangerBox"]');
      var input = document.querySelector('[data-e2e="message-input-area"]');
      return JSON.stringify({
        type: strangerBox ? 'MESSAGE_REQUEST' : input ? 'REGULAR_DM' : 'UNKNOWN',
        hasInput: !!input,
        isRequest: !!strangerBox
      });
    })()`);
    const data = JSON.parse(result);
    if (data.type === 'UNKNOWN') throw new Error('Could not detect chat type');
    return data;
  });

  await runTest('Chat', 'Read Messages', async () => {
    const data = await get('/api/tiktok/messages');
    if (!Array.isArray(data.messages)) throw new Error('Invalid messages');
    return { count: data.count };
  });

  // ========================================
  // Message Request Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n📬 Message Request Tests\n');

  await runTest('Requests', 'Request Group Selector', async () => {
    await post('/api/tiktok/inbox/navigate');
    await new Promise(r => setTimeout(r, 1000));
    const result = await exec(`(function(){
      var requestGroup = document.querySelector('[class*="DivRequestGroup"]');
      return JSON.stringify({
        found: !!requestGroup,
        text: requestGroup?.innerText?.substring(0, 50) || null
      });
    })()`);
    const data = JSON.parse(result);
    return data;
  });

  // ========================================
  // Selector Discovery Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n🔍 Selector Discovery Tests\n');

  await runTest('Discovery', 'data-e2e Selectors', async () => {
    const result = await exec(`(function(){
      var e2e = [];
      document.querySelectorAll('[data-e2e]').forEach(function(el){
        e2e.push(el.getAttribute('data-e2e'));
      });
      return JSON.stringify([...new Set(e2e)]);
    })()`);
    const data = JSON.parse(result);
    if (data.length < 10) throw new Error('Too few selectors found');
    return { count: data.length, selectors: data.slice(0, 10) };
  });

  await runTest('Discovery', 'Class Pattern Selectors', async () => {
    const result = await exec(`(function(){
      var classes = [];
      document.querySelectorAll('div[class]').forEach(function(d){
        var m = d.className.match(/--([A-Z][a-zA-Z]+)/g);
        if(m) m.forEach(function(x){ classes.push(x.replace('--','')); });
      });
      return JSON.stringify([...new Set(classes)]);
    })()`);
    const data = JSON.parse(result);
    if (data.length < 20) throw new Error('Too few class patterns found');
    return { count: data.length };
  });

  // ========================================
  // Script Execution Tests
  // ========================================
  if (!JSON_ONLY) console.log('\n⚙️ Script Execution Tests\n');

  await runTest('Execution', 'Execute JavaScript', async () => {
    const data = await post('/api/execute', { script: 'document.title' });
    if (!data.output) throw new Error('No output');
    return { title: data.output };
  });

  await runTest('Execution', 'Execute Complex Script', async () => {
    const data = await post('/api/execute', { 
      script: 'JSON.stringify({url: window.location.href, time: Date.now()})' 
    });
    const parsed = JSON.parse(data.output);
    if (!parsed.url) throw new Error('Invalid output');
    return parsed;
  });
}

async function generateReport(): Promise<any> {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const duration = Date.now() - startTime;

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total,
      passed,
      failed,
      passRate: `${Math.round((passed / total) * 100)}%`,
      duration: `${duration}ms`
    },
    categories: {} as Record<string, { passed: number; failed: number; tests: TestResult[] }>,
    allTests: results
  };

  // Group by category
  for (const r of results) {
    if (!report.categories[r.category]) {
      report.categories[r.category] = { passed: 0, failed: 0, tests: [] };
    }
    if (r.passed) report.categories[r.category].passed++;
    else report.categories[r.category].failed++;
    report.categories[r.category].tests.push(r);
  }

  return report;
}

async function main(): Promise<void> {
  startTime = Date.now();

  try {
    // Check if API is running
    const health = await get('/health').catch(() => null);
    if (!health) {
      console.error('❌ API not running. Start with: npx tsx packages/tiktok-dm/src/api/server.ts');
      process.exit(1);
    }

    await runAllTests();
    const report = await generateReport();

    if (JSON_ONLY) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log('\n' + '═'.repeat(60));
      console.log('  Test Results');
      console.log('═'.repeat(60));
      console.log(`\n  Total:    ${report.summary.total}`);
      console.log(`  Passed:   ${report.summary.passed} ✅`);
      console.log(`  Failed:   ${report.summary.failed} ❌`);
      console.log(`  Rate:     ${report.summary.passRate}`);
      console.log(`  Duration: ${report.summary.duration}`);
      console.log('\n' + '═'.repeat(60) + '\n');

      if (report.summary.failed === 0) {
        console.log('🎉 All tests passed!\n');
      } else {
        console.log('⚠️ Some tests failed:\n');
        results.filter(r => !r.passed).forEach(r => {
          console.log(`   - ${r.category}/${r.name}: ${r.message}`);
        });
        console.log('');
      }
    }

    if (SAVE_REPORT) {
      const fs = await import('fs');
      const reportPath = `test-reports/tiktok-dm-${new Date().toISOString().split('T')[0]}.json`;
      await fs.promises.mkdir('test-reports', { recursive: true });
      await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`📄 Report saved to: ${reportPath}\n`);
    }

    process.exit(report.summary.failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('❌ Test suite error:', error);
    process.exit(1);
  }
}

main();
