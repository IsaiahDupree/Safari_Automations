#!/usr/bin/env npx tsx
/**
 * MediaPoster Integration Test Suite
 * 
 * Tests all endpoints that Safari Automation interfaces with:
 * - Health checks
 * - External scheduling API
 * - Video webhooks
 * - Account listing
 * 
 * Usage:
 *   npx tsx scripts/test-mediaposter-integration.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const MEDIAPOSTER_URL = process.env.MEDIAPOSTER_URL || 'http://localhost:5555';
const TEST_VIDEO_PATH = path.join(process.env.HOME || '', 'sora-videos/ready-to-post/badass-04_ready.mp4');

interface TestResult {
  name: string;
  endpoint: string;
  method: string;
  status: 'pass' | 'fail' | 'skip';
  responseCode?: number;
  responseTime?: number;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  endpoint: string,
  method: string,
  body?: any,
  skipIf?: () => boolean
): Promise<TestResult> {
  const result: TestResult = { name, endpoint, method, status: 'skip' };
  
  if (skipIf && skipIf()) {
    console.log(`⏭️  SKIP: ${name}`);
    results.push(result);
    return result;
  }
  
  const startTime = Date.now();
  
  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${MEDIAPOSTER_URL}${endpoint}`, options);
    result.responseCode = response.status;
    result.responseTime = Date.now() - startTime;
    
    const responseText = await response.text();
    let responseData: any;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }
    
    if (response.ok) {
      result.status = 'pass';
      result.details = responseData;
      console.log(`✅ PASS: ${name} (${result.responseTime}ms)`);
    } else {
      result.status = 'fail';
      result.error = typeof responseData === 'object' ? responseData.detail || responseData.error : responseText;
      console.log(`❌ FAIL: ${name} - HTTP ${response.status}`);
      console.log(`   Error: ${result.error?.substring(0, 200)}...`);
    }
  } catch (error) {
    result.status = 'fail';
    result.error = String(error);
    result.responseTime = Date.now() - startTime;
    console.log(`❌ FAIL: ${name} - ${result.error}`);
  }
  
  results.push(result);
  return result;
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🧪 MediaPoster Integration Test Suite                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📡 Target: ${MEDIAPOSTER_URL}`);
  console.log(`📹 Test Video: ${TEST_VIDEO_PATH}`);
  console.log(`📅 Date: ${new Date().toISOString()}\n`);
  
  // ==================== HEALTH CHECKS ====================
  console.log('\n─── HEALTH CHECKS ───────────────────────────────────────────\n');
  
  await runTest(
    'Health Check',
    '/health',
    'GET'
  );
  
  await runTest(
    'External API Health',
    '/api/external/health',
    'GET'
  );
  
  // ==================== ACCOUNT LISTING ====================
  console.log('\n─── ACCOUNT LISTING ─────────────────────────────────────────\n');
  
  await runTest(
    'List Blotato Accounts',
    '/api/external/accounts',
    'GET'
  );
  
  // ==================== QUEUE ANALYSIS ====================
  console.log('\n─── QUEUE ANALYSIS ──────────────────────────────────────────\n');
  
  await runTest(
    'Queue Analysis (TikTok)',
    '/api/external/queue-analysis?platform=tiktok&account_id=710',
    'GET'
  );
  
  await runTest(
    'Queue Capacity',
    '/api/external/capacity?platforms=tiktok,youtube',
    'GET'
  );
  
  // ==================== EXTERNAL SUBMIT ====================
  console.log('\n─── EXTERNAL SUBMIT API ─────────────────────────────────────\n');
  
  const hasTestVideo = fs.existsSync(TEST_VIDEO_PATH);
  
  await runTest(
    'Submit Video (video_path)',
    '/api/external/submit',
    'POST',
    {
      video_path: TEST_VIDEO_PATH,
      title: 'Test Video - Safari Integration',
      caption: 'Testing Safari Automation integration',
      hashtags: ['#test', '#safari'],
      targets: [
        {
          platform: 'tiktok',
          account_id: '710',
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        }
      ],
      source_id: `test-${Date.now()}`,
      source_system: 'safari-automation-test',
    },
    () => !hasTestVideo
  );
  
  // ==================== SMART SCHEDULE ====================
  console.log('\n─── SMART SCHEDULE API ──────────────────────────────────────\n');
  
  await runTest(
    'Smart Schedule (video_path)',
    '/api/external/smart-schedule',
    'POST',
    {
      video_path: TEST_VIDEO_PATH,
      title: 'Test Smart Schedule',
      caption: 'Testing smart scheduling',
      platforms: ['tiktok', 'youtube'],
      source_system: 'safari-automation-test',
    },
    () => !hasTestVideo
  );
  
  // ==================== BULK SCHEDULE ====================
  console.log('\n─── BULK SCHEDULE API ───────────────────────────────────────\n');
  
  await runTest(
    'Bulk Schedule Validation',
    '/api/external/bulk-schedule',
    'POST',
    {
      video_urls: [],  // Empty to test validation
      platform: 'tiktok',
      account_id: '710',
      start_time: new Date(Date.now() + 3600000).toISOString(),
      interval_minutes: 60,
    }
  );
  
  // ==================== VIDEO WEBHOOK ====================
  console.log('\n─── VIDEO WEBHOOK ───────────────────────────────────────────\n');
  
  await runTest(
    'Video Ready Webhook',
    '/api/webhooks/video-ready',
    'POST',
    {
      video_path: TEST_VIDEO_PATH,
      source: 'sora',
      character: 'isaiahdupree',
      platforms: ['youtube', 'tiktok'],
      auto_publish: false,
      metadata: {
        test: true,
        source: 'safari-automation-test',
      },
    },
    () => !hasTestVideo
  );
  
  // ==================== STATUS CHECK ====================
  console.log('\n─── STATUS CHECK ────────────────────────────────────────────\n');
  
  await runTest(
    'Check Status (test source)',
    '/api/external/status/test-source-id',
    'GET'
  );
  
  // ==================== SUMMARY ====================
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('═'.repeat(60));
  
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  
  console.log(`\nTotal:   ${results.length}`);
  console.log(`Passed:  ${passed} ✅`);
  console.log(`Failed:  ${failed} ❌`);
  console.log(`Skipped: ${skipped} ⏭️`);
  
  console.log('\n┌────────────────────────────────────────┬────────┬──────────┬────────┐');
  console.log('│ Test                                   │ Status │ HTTP     │ Time   │');
  console.log('├────────────────────────────────────────┼────────┼──────────┼────────┤');
  
  for (const r of results) {
    const name = r.name.padEnd(38).substring(0, 38);
    const status = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
    const http = (r.responseCode?.toString() || 'N/A').padStart(8);
    const time = r.responseTime ? `${r.responseTime}ms`.padStart(6) : 'N/A'.padStart(6);
    console.log(`│ ${name} │   ${status}   │${http} │${time} │`);
  }
  
  console.log('└────────────────────────────────────────┴────────┴──────────┴────────┘');
  
  // Failed tests details
  const failedTests = results.filter(r => r.status === 'fail');
  if (failedTests.length > 0) {
    console.log('\n❌ FAILED TESTS DETAILS:');
    console.log('─'.repeat(60));
    
    for (const r of failedTests) {
      console.log(`\n${r.name} (${r.endpoint})`);
      console.log(`   HTTP: ${r.responseCode || 'N/A'}`);
      console.log(`   Error: ${r.error?.substring(0, 300)}`);
    }
  }
  
  // Working endpoints summary
  const passedTests = results.filter(r => r.status === 'pass');
  if (passedTests.length > 0) {
    console.log('\n✅ WORKING ENDPOINTS:');
    console.log('─'.repeat(60));
    
    for (const r of passedTests) {
      console.log(`   ${r.method} ${r.endpoint}`);
    }
  }
  
  console.log('\n');
  
  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
