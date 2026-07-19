/**
 * Test Chat Extraction
 * Tests ability to open all chats and extract all data from each contact
 */

import dotenv from 'dotenv';
dotenv.config();

const safariUrl = process.env.SAFARI_API_URL || 'http://localhost:3100';

interface TestResult {
  username: string;
  tab: string;
  opened: boolean;
  messagesFound: number;
  messages: { text: string; isOutbound: boolean }[];
  error?: string;
}

async function safariRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${safariUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testChatExtraction() {
  console.log('\n🧪 Testing Chat Extraction\n');
  console.log(`Safari API: ${safariUrl}\n`);
  console.log('='.repeat(60) + '\n');

  // Check Safari server
  try {
    const health = await safariRequest<{ status: string }>('/health');
    console.log(`✅ Safari server: ${health.status}\n`);
  } catch (error) {
    console.error('❌ Safari server not available');
    process.exit(1);
  }

  const results: TestResult[] = [];
  const tabs = ['primary', 'general', 'requests'];

  // Navigate to inbox first
  console.log('📬 Navigating to Instagram inbox...');
  await safariRequest('/api/inbox/navigate', 'POST');
  await wait(3000);

  // Test each tab
  for (const tab of tabs) {
    console.log(`\n📁 Testing ${tab.toUpperCase()} tab...\n`);
    
    // Switch to tab
    const tabResult = await safariRequest<{ success: boolean }>('/api/inbox/tab', 'POST', { tab });
    console.log(`  Tab switch: ${tabResult.success ? '✅' : '❌'}`);
    await wait(2000);

    // Get conversations in this tab
    const convos = await safariRequest<{ conversations: { username: string; lastMessage?: string }[]; count: number }>('/api/conversations');
    console.log(`  Found ${convos.count} conversations\n`);

    // Test each conversation
    for (let i = 0; i < convos.conversations.length; i++) {
      const conv = convos.conversations[i];
      if (!conv.username || conv.username.length < 2) continue;

      console.log(`  [${i + 1}] Testing @${conv.username}...`);
      
      const result: TestResult = {
        username: conv.username,
        tab,
        opened: false,
        messagesFound: 0,
        messages: [],
      };

      try {
        // Try to open the conversation
        const openResult = await safariRequest<{ success: boolean }>('/api/conversations/open', 'POST', { username: conv.username });
        result.opened = openResult.success;
        
        if (!openResult.success) {
          // Try clicking by index
          console.log(`      Trying click by index ${i}...`);
          await safariRequest('/api/execute', 'POST', {
            script: `(function(){ 
              var items = document.querySelectorAll('div[role="listitem"], div[role="row"], a[href*="/direct/t/"]');
              if(items[${i}]) { items[${i}].click(); return 'clicked'; }
              return 'not found';
            })()`
          });
          await wait(2000);
          result.opened = true;
        } else {
          await wait(2000);
        }

        // Try to read messages
        const msgResult = await safariRequest<{ messages: { text: string; isOutbound: boolean; messageType: string }[]; count: number }>('/api/messages?limit=30');
        result.messagesFound = msgResult.count;
        result.messages = msgResult.messages.map(m => ({ text: m.text?.substring(0, 50), isOutbound: m.isOutbound }));

        // Also try direct DOM extraction
        if (msgResult.count === 0) {
          const directMessages = await safariRequest<{ output: string }>('/api/execute', 'POST', {
            script: `(function(){
              var msgs = [];
              var msgEls = document.querySelectorAll('div[dir="auto"], span[dir="auto"]');
              msgEls.forEach(function(el) {
                var text = el.innerText || '';
                if (text.length > 5 && text.length < 500) {
                  msgs.push(text.substring(0, 100));
                }
              });
              return msgs.slice(0, 20).join('|||');
            })()`
          });
          
          if (directMessages.output && directMessages.output.length > 0) {
            const extracted = directMessages.output.split('|||').filter(m => m.length > 0);
            result.messagesFound = extracted.length;
            result.messages = extracted.map(t => ({ text: t.substring(0, 50), isOutbound: false }));
          }
        }

        console.log(`      Opened: ${result.opened ? '✅' : '❌'}`);
        console.log(`      Messages: ${result.messagesFound}`);
        
        if (result.messages.length > 0) {
          console.log(`      Preview: "${result.messages[0].text}..."`);
        }

      } catch (error) {
        result.error = String(error);
        console.log(`      ❌ Error: ${error}`);
      }

      results.push(result);
      
      // Navigate back to inbox for next conversation
      await safariRequest('/api/inbox/navigate', 'POST');
      await wait(2000);
      await safariRequest('/api/inbox/tab', 'POST', { tab });
      await wait(1500);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('='.repeat(60) + '\n');

  const opened = results.filter(r => r.opened).length;
  const withMessages = results.filter(r => r.messagesFound > 0).length;
  const totalMessages = results.reduce((sum, r) => sum + r.messagesFound, 0);
  const errors = results.filter(r => r.error).length;

  console.log(`Total conversations tested: ${results.length}`);
  console.log(`Successfully opened:        ${opened}/${results.length} (${Math.round(opened/results.length*100)}%)`);
  console.log(`With messages extracted:    ${withMessages}/${results.length}`);
  console.log(`Total messages found:       ${totalMessages}`);
  console.log(`Errors:                     ${errors}`);

  console.log('\n📋 Per-contact breakdown:\n');
  
  const byUsername = new Map<string, TestResult[]>();
  results.forEach(r => {
    const existing = byUsername.get(r.username) || [];
    existing.push(r);
    byUsername.set(r.username, existing);
  });

  byUsername.forEach((tests, username) => {
    const totalMsgs = tests.reduce((sum, t) => sum + t.messagesFound, 0);
    const openedCount = tests.filter(t => t.opened).length;
    console.log(`  @${username}:`);
    console.log(`    Tabs: ${tests.map(t => t.tab).join(', ')}`);
    console.log(`    Opened: ${openedCount}/${tests.length}`);
    console.log(`    Messages: ${totalMsgs}`);
    if (tests[0].messages.length > 0) {
      console.log(`    Sample: "${tests[0].messages[0].text}..."`);
    }
    console.log();
  });

  // Pass/fail
  const passRate = opened / results.length;
  if (passRate >= 0.8) {
    console.log('✅ TEST PASSED - Can open and read most chats');
  } else if (passRate >= 0.5) {
    console.log('⚠️ TEST PARTIAL - Some chats accessible');
  } else {
    console.log('❌ TEST FAILED - Cannot reliably open chats');
  }

  console.log('\n');
}

testChatExtraction().catch(console.error);
