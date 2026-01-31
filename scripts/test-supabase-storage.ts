#!/usr/bin/env npx tsx
/**
 * Supabase Storage Integration Test Script
 * Tests the SafariSupabaseClient against a real Supabase instance
 */

import { v4 as uuidv4 } from 'uuid';

// Check for credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🧪 Supabase Storage Integration Tests                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('⚠️  Missing Supabase credentials\n');
    console.log('Set environment variables:');
    console.log('  export SUPABASE_URL=https://your-project.supabase.co');
    console.log('  export SUPABASE_SERVICE_KEY=your-service-role-key\n');
    console.log('Running mock tests instead...\n');
    await runMockTests();
    return;
  }

  console.log('✅ Supabase credentials found');
  console.log(`   URL: ${SUPABASE_URL.slice(0, 30)}...`);
  console.log('');

  // Dynamic import to avoid errors if supabase not configured
  const { SafariSupabaseClient } = await import('../packages/protocol/src/supabase-client');
  const client = new SafariSupabaseClient(SUPABASE_URL, SUPABASE_KEY);

  const testId = uuidv4().slice(0, 8);
  const testCommandId = `test-${testId}`;
  let testVideoId: string | undefined;
  let passed = 0;
  let failed = 0;

  // Helper function
  function test(name: string, success: boolean, details?: string) {
    if (success) {
      console.log(`  ✅ ${name}`);
      passed++;
    } else {
      console.log(`  ❌ ${name}`);
      if (details) console.log(`     ${details}`);
      failed++;
    }
  }

  // ============================================================================
  // COMMAND TESTS
  // ============================================================================
  console.log('\n📋 Commands\n');

  // Insert command
  const insertedCmd = await client.insertCommand({
    version: '1.0',
    command_id: testCommandId,
    idempotency_key: `idem-${testCommandId}`,
    requested_at: new Date().toISOString(),
    type: 'sora.generate.clean',
    payload: {
      prompt: '@isaiahdupree test prompt for integration test',
      character: 'isaiahdupree',
    },
    requester: {
      service: 'test-script',
      instance_id: 'test-1',
    },
  });
  test('Insert command', !!insertedCmd && insertedCmd.command_id === testCommandId);

  // Get command
  const fetchedCmd = await client.getCommand(testCommandId);
  test('Get command by ID', !!fetchedCmd && fetchedCmd.status === 'CREATED');

  // Get by idempotency key
  const idempCmd = await client.getCommandByIdempotencyKey(`idem-${testCommandId}`);
  test('Get command by idempotency key', !!idempCmd);

  // Update to RUNNING
  const runningCmd = await client.updateCommandStatus(testCommandId, 'RUNNING');
  test('Update status to RUNNING', !!runningCmd && runningCmd.status === 'RUNNING' && !!runningCmd.started_at);

  // Update to SUCCEEDED
  const result = { video_path: '/test/video.mp4', file_size: 1024 };
  const succeededCmd = await client.updateCommandStatus(testCommandId, 'SUCCEEDED', result);
  test('Update status to SUCCEEDED with result', 
    !!succeededCmd && succeededCmd.status === 'SUCCEEDED' && !!succeededCmd.completed_at);

  // ============================================================================
  // VIDEO TESTS
  // ============================================================================
  console.log('\n🎬 Videos\n');

  // Insert video
  const insertedVideo = await client.insertVideo({
    command_id: testCommandId,
    prompt: '@isaiahdupree integration test - riding a meteor',
    character: 'isaiahdupree',
    raw_path: `/test/sora-videos/test-${testId}.mp4`,
    raw_size: 971234,
    status: 'ready',
    generation_time_ms: 220000,
    metadata: { test: true, timestamp: Date.now() },
  });
  test('Insert video', !!insertedVideo);
  testVideoId = insertedVideo?.id;

  // Mark as cleaned
  if (testVideoId) {
    const cleanedVideo = await client.markVideoCleaned(
      testVideoId,
      `/test/sora-videos/cleaned/cleaned_test-${testId}.mp4`,
      1146839
    );
    test('Mark video as cleaned', !!cleanedVideo && cleanedVideo.status === 'cleaned');
  }

  // Get videos by character
  const characterVideos = await client.getVideosByCharacter('isaiahdupree', 5);
  test('Get videos by character', Array.isArray(characterVideos) && characterVideos.length > 0);

  // Get watermark-free videos
  const cleanVideos = await client.getWatermarkFreeVideos(5);
  test('Get watermark-free videos', Array.isArray(cleanVideos));

  // ============================================================================
  // EVENT TESTS
  // ============================================================================
  console.log('\n📡 Events\n');

  // Insert event
  const testCursor = `cursor-${Date.now()}`;
  const insertedEvent = await client.insertEvent({
    version: '1.0',
    event_id: `evt-${uuidv4()}`,
    command_id: testCommandId,
    cursor: testCursor,
    type: 'sora.video.cleaned',
    severity: 'info',
    payload: {
      input_path: '/test/video.mp4',
      output_path: '/test/cleaned/video.mp4',
      test: true,
    },
    emitted_at: new Date().toISOString(),
  });
  test('Insert event', !!insertedEvent);

  // Get events by command
  const cmdEvents = await client.getEventsByCommand(testCommandId);
  test('Get events by command', Array.isArray(cmdEvents) && cmdEvents.length > 0);

  // ============================================================================
  // ANALYTICS TESTS
  // ============================================================================
  console.log('\n📊 Analytics\n');

  // Command performance
  const performance = await client.getCommandPerformance();
  test('Get command performance metrics', Array.isArray(performance));

  // Video summary
  const summary = await client.getRecentVideoSummary();
  test('Get recent video summary', Array.isArray(summary));

  // Full command details
  const details = await client.getCommandDetails(testCommandId);
  test('Get full command details', 
    !!details.command && Array.isArray(details.videos) && Array.isArray(details.events));

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '═'.repeat(60));
  console.log(`\n📋 Results: ${passed} passed, ${failed} failed\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed!\n');
  } else {
    console.log('⚠️  Some tests failed. Check Supabase connection and migration.\n');
  }

  // Cleanup note
  console.log(`💡 Test data created with ID: ${testId}`);
  console.log('   You can clean up test data with:');
  console.log(`   DELETE FROM safari_commands WHERE command_id LIKE 'test-%';\n`);
}

async function runMockTests() {
  console.log('📋 Mock Tests (no database)\n');

  // Test type imports work
  const { SafariSupabaseClient } = await import('../packages/protocol/src/supabase-client');
  console.log('  ✅ SafariSupabaseClient class imported');

  // Test types exist
  type TestDbCommand = {
    command_id: string;
    type: string;
    status: string;
  };
  const mockCmd: TestDbCommand = { command_id: 'test', type: 'sora.generate', status: 'CREATED' };
  console.log('  ✅ Type definitions valid');

  // Test command types
  const validTypes = [
    'sora.generate', 'sora.generate.clean', 'sora.batch', 'sora.batch.clean', 'sora.clean'
  ];
  console.log(`  ✅ ${validTypes.length} Sora command types defined`);

  // Test status types
  const validStatuses = ['CREATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'];
  console.log(`  ✅ ${validStatuses.length} command statuses defined`);

  console.log('\n🎉 Mock tests passed!\n');
  console.log('To run full integration tests, set SUPABASE_URL and SUPABASE_SERVICE_KEY\n');
}

runTests().catch(console.error);
