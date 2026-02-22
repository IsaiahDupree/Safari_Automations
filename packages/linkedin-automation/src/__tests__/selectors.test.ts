/**
 * LinkedIn Automation — Selector & API Integration Tests
 * Tests profile extraction, messaging, conversations, and outreach engine
 * against the live LinkedIn API server on port 3105.
 *
 * Run: npx tsx src/__tests__/selectors.test.ts
 */

const BASE = 'http://localhost:3105';

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  duration: number;
}

const results: TestResult[] = [];

async function api(method: string, path: string, body?: any): Promise<any> {
  const opts: any = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  return res.json();
}

async function test(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, details: 'OK', duration: Date.now() - start });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (e: any) {
    results.push({ name, passed: false, details: e.message, duration: Date.now() - start });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ─── Health ────────────────────────────────────────────────────

async function testHealth() {
  await test('Server health check', async () => {
    const d = await api('GET', '/health');
    assert(d.status === 'running', `Expected running, got ${d.status}`);
    assert(d.port === 3105, `Expected port 3105, got ${d.port}`);
  });
}

// ─── Profile Extraction Selectors ──────────────────────────────

async function testProfileExtraction() {
  console.log('\n── Profile Extraction ──');

  await test('Extract profile: known 2nd-degree connection', async () => {
    const d = await api('GET', '/api/linkedin/profile/murphybrantley');
    assert(d.name === 'Murphy Brantley', `Name: ${d.name}`);
    assert(d.headline && d.headline.length > 5, `Headline empty: ${d.headline}`);
    assert(d.location && d.location.includes(','), `Location: ${d.location}`);
    assert(d.connectionDegree === '2nd', `Degree: ${d.connectionDegree}`);
    assert(d.mutualConnections >= 0, `Mutual: ${d.mutualConnections}`);
  });

  await test('canConnect detected via anchor tags', async () => {
    // Navigate to profile first
    await api('POST', '/api/linkedin/navigate/profile', { profileUrl: 'https://www.linkedin.com/in/murphybrantley' });
    await new Promise(r => setTimeout(r, 4000));
    const d = await api('GET', '/api/linkedin/profile/extract-current');
    assert(d.canConnect === true, `canConnect: ${d.canConnect}`);
  });

  await test('canMessage detected via anchor tags', async () => {
    const d = await api('GET', '/api/linkedin/profile/extract-current');
    assert(d.canMessage === true, `canMessage: ${d.canMessage}`);
  });

  await test('Extract profile: public figure (Bill Gates)', async () => {
    const d = await api('GET', '/api/linkedin/profile/williamhgates');
    assert(d.name === 'Bill Gates', `Name: ${d.name}`);
    assert(d.headline && d.headline.length > 5, `Headline empty`);
    assert(d.location && d.location.length > 3, `Location: ${d.location}`);
    assert(d.currentPosition && d.currentPosition.title, `No currentPosition`);
  });

  await test('isOpenToWork / isHiring detection', async () => {
    const d = await api('GET', '/api/linkedin/profile/extract-current');
    assert(typeof d.isOpenToWork === 'boolean', `isOpenToWork not boolean`);
    assert(typeof d.isHiring === 'boolean', `isHiring not boolean`);
  });
}

// ─── Messaging Selectors ───────────────────────────────────────

async function testMessaging() {
  console.log('\n── Messaging ──');

  await test('Navigate to messaging', async () => {
    const d = await api('POST', '/api/linkedin/navigate/messaging', {});
    assert(d.success === true, `Navigate failed: ${JSON.stringify(d)}`);
    await new Promise(r => setTimeout(r, 3000));
  });

  await test('List conversations (no duplicates, has names)', async () => {
    const d = await api('GET', '/api/linkedin/conversations');
    const convos = d.conversations || [];
    assert(convos.length > 0, `No conversations found`);
    const names = convos.map((c: any) => c.participantName);
    assert(names.every((n: string) => n && n.length > 1), `Some names empty: ${names}`);
    // Check for Sarah Ashley
    const sarah = convos.find((c: any) => c.participantName.includes('Sarah Ashley'));
    assert(!!sarah, `Sarah Ashley not in conversations`);
  });

  await test('Open conversation: Sarah Ashley (native click)', async () => {
    const d = await api('POST', '/api/linkedin/messages/open', { participantName: 'Sarah Ashley' });
    assert(d.success === true, `Failed to open: ${JSON.stringify(d)}`);
  });

  await test('Read messages: no duplicates', async () => {
    const d = await api('GET', '/api/linkedin/messages');
    const msgs = d.messages || [];
    assert(msgs.length > 0, `No messages found`);
    // Check for duplicates by content+timestamp
    const keys = msgs.map((m: any) => `${m.content?.substring(0, 30)}|${m.timestamp}`);
    const unique = new Set(keys);
    assert(unique.size === keys.length, `Duplicates found: ${keys.length} total, ${unique.size} unique`);
  });

  await test('Read messages: has sender and content', async () => {
    const d = await api('GET', '/api/linkedin/messages');
    const msgs = d.messages || [];
    for (const m of msgs) {
      assert(m.content && m.content.length > 0, `Message missing content`);
    }
  });

  await test('Message input selectors present', async () => {
    const d = await api('POST', '/api/linkedin/debug/js', {
      js: '(function(){var ce=document.querySelector(".msg-form__contenteditable");var sb=document.querySelector(".msg-form__send-button");return JSON.stringify({ce:!!ce,sb:!!sb})})()'
    });
    const parsed = JSON.parse(d.result);
    assert(parsed.ce === true, `Content editable not found`);
    assert(parsed.sb === true, `Send button not found`);
  });
}

// ─── Outreach Engine ───────────────────────────────────────────

async function testOutreachEngine() {
  console.log('\n── Outreach Engine ──');

  await test('List campaigns', async () => {
    const d = await api('GET', '/api/linkedin/outreach/campaigns');
    assert(Array.isArray(d.campaigns), `Expected campaigns array`);
  });

  await test('Get stats', async () => {
    const d = await api('GET', '/api/linkedin/outreach/stats');
    assert(typeof d.total === 'number', `Expected total number`);
    assert(typeof d.byStage === 'object', `Expected byStage object`);
  });

  await test('Get prospects', async () => {
    const d = await api('GET', '/api/linkedin/outreach/prospects');
    assert(Array.isArray(d.prospects), `Expected prospects array`);
  });

  await test('Get runs', async () => {
    const d = await api('GET', '/api/linkedin/outreach/runs');
    assert(Array.isArray(d.runs), `Expected runs array`);
  });

  await test('Create campaign', async () => {
    const d = await api('POST', '/api/linkedin/outreach/campaigns', {
      name: 'Test Campaign - ' + Date.now(),
      offer: 'Test offer',
      search: { keywords: ['test'] },
      targetTitles: ['Engineer'],
      minScore: 50,
      maxProspectsPerRun: 1,
      templates: {
        connectionNote: 'Hi {firstName}',
        firstDm: 'Hello {firstName}',
        followUp1: 'Following up {firstName}',
        followUp2: 'Checking in {firstName}',
        followUp3: 'Last note {firstName}',
      },
    });
    assert(d.success === true, `Create failed: ${JSON.stringify(d)}`);
    assert(d.campaign && d.campaign.id, `No campaign ID`);
  });
}

// ─── Connection Status Selectors ───────────────────────────────

async function testConnectionSelectors() {
  console.log('\n── Connection Status ──');

  await test('Connection status check (button + anchor detection)', async () => {
    await api('POST', '/api/linkedin/navigate/profile', { profileUrl: 'https://www.linkedin.com/in/murphybrantley' });
    await new Promise(r => setTimeout(r, 4000));
    const d = await api('POST', '/api/linkedin/debug/js', {
      js: `(function(){var main=document.querySelector('main');if(!main) return 'no_main';var sec=main.querySelector('section');if(!sec) return 'no_section';var hasConnect=false;var hasMessage=false;var btns=sec.querySelectorAll('button');for(var i=0;i<btns.length;i++){var a=(btns[i].getAttribute('aria-label')||'').toLowerCase();if(a.includes('connect')||a.includes('invite'))hasConnect=true;if(a.includes('message'))hasMessage=true}var ancs=sec.querySelectorAll('a');for(var j=0;j<ancs.length;j++){var aa=(ancs[j].getAttribute('aria-label')||'').toLowerCase();var at=ancs[j].innerText.trim().toLowerCase();var ah=(ancs[j].href||'').toLowerCase();if(aa.includes('connect')||aa.includes('invite')||at==='connect'||ah.includes('custom-invite'))hasConnect=true;if(aa.includes('message')||at==='message'||ah.includes('/messaging/compose'))hasMessage=true}return JSON.stringify({hasConnect:hasConnect,hasMessage:hasMessage})})()`
    });
    const parsed = JSON.parse(d.result);
    assert(parsed.hasConnect === true, `Connect not detected via buttons+anchors`);
    assert(parsed.hasMessage === true, `Message not detected via buttons+anchors`);
  });
}

// ─── Run All ───────────────────────────────────────────────────

async function main() {
  console.log('🧪 LinkedIn Selector & Integration Tests\n');
  console.log(`Server: ${BASE}`);

  // Check server is up
  try {
    await fetch(`${BASE}/health`);
  } catch {
    console.error('❌ Server not running on port 3105. Start it first.');
    process.exit(1);
  }

  await testHealth();
  await testProfileExtraction();
  await testConnectionSelectors();
  await testMessaging();
  await testOutreachEngine();

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalMs = results.reduce((s, r) => s + r.duration, 0);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed (${totalMs}ms total)`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ✗ ${r.name}: ${r.details}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
