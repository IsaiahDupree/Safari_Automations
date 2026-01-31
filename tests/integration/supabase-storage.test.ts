/**
 * Supabase Storage Integration Tests
 * Tests the SafariSupabaseClient against a real Supabase instance
 * 
 * Prerequisites:
 * - SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables set
 * - Migration applied to database
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  SafariSupabaseClient,
  DbCommand,
  DbVideo,
  DbEvent,
} from '../../packages/protocol/src/supabase-client';

// Skip tests if no Supabase credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const shouldSkip = !SUPABASE_URL || !SUPABASE_KEY;

describe.skipIf(shouldSkip)('SafariSupabaseClient', () => {
  let client: SafariSupabaseClient;
  let testCommandId: string;
  let testVideoId: string;

  beforeAll(() => {
    client = new SafariSupabaseClient(SUPABASE_URL, SUPABASE_KEY);
    testCommandId = `test-cmd-${uuidv4()}`;
  });

  describe('Commands', () => {
    it('should insert a command', async () => {
      const command = await client.insertCommand({
        version: '1.0',
        command_id: testCommandId,
        idempotency_key: `idem-${testCommandId}`,
        requested_at: new Date().toISOString(),
        type: 'sora.generate.clean',
        payload: {
          prompt: '@isaiahdupree test prompt',
          character: 'isaiahdupree',
        },
        requester: {
          service: 'test-suite',
          instance_id: 'test-1',
        },
      });

      expect(command).not.toBeNull();
      expect(command?.command_id).toBe(testCommandId);
      expect(command?.status).toBe('CREATED');
      expect(command?.type).toBe('sora.generate.clean');
    });

    it('should get a command by ID', async () => {
      const command = await client.getCommand(testCommandId);

      expect(command).not.toBeNull();
      expect(command?.command_id).toBe(testCommandId);
    });

    it('should get command by idempotency key', async () => {
      const command = await client.getCommandByIdempotencyKey(`idem-${testCommandId}`);

      expect(command).not.toBeNull();
      expect(command?.command_id).toBe(testCommandId);
    });

    it('should update command status to RUNNING', async () => {
      const command = await client.updateCommandStatus(testCommandId, 'RUNNING');

      expect(command).not.toBeNull();
      expect(command?.status).toBe('RUNNING');
      expect(command?.started_at).not.toBeNull();
    });

    it('should update command status to SUCCEEDED with result', async () => {
      const result = {
        video_path: '/test/path/video.mp4',
        cleaned_path: '/test/path/cleaned/video.mp4',
        file_size: 1024000,
      };

      const command = await client.updateCommandStatus(testCommandId, 'SUCCEEDED', result);

      expect(command).not.toBeNull();
      expect(command?.status).toBe('SUCCEEDED');
      expect(command?.completed_at).not.toBeNull();
      expect(command?.result).toEqual(result);
    });
  });

  describe('Videos', () => {
    it('should insert a video', async () => {
      const video = await client.insertVideo({
        command_id: testCommandId,
        prompt: '@isaiahdupree riding a meteor through space',
        character: 'isaiahdupree',
        raw_path: '/test/sora-videos/test-video.mp4',
        raw_size: 971234,
        status: 'ready',
        generation_time_ms: 220000,
        metadata: { test: true },
      });

      expect(video).not.toBeNull();
      expect(video?.prompt).toContain('isaiahdupree');
      expect(video?.status).toBe('ready');
      testVideoId = video?.id || '';
    });

    it('should mark video as cleaned', async () => {
      if (!testVideoId) {
        console.log('Skipping - no video ID');
        return;
      }

      const video = await client.markVideoCleaned(
        testVideoId,
        '/test/sora-videos/cleaned/cleaned_test-video.mp4',
        1146839
      );

      expect(video).not.toBeNull();
      expect(video?.status).toBe('cleaned');
      expect(video?.cleaned_path).toContain('cleaned');
      expect(video?.cleaned_at).not.toBeNull();
    });

    it('should get videos by character', async () => {
      const videos = await client.getVideosByCharacter('isaiahdupree', 10);

      expect(Array.isArray(videos)).toBe(true);
      // Should have at least our test video
      expect(videos.length).toBeGreaterThanOrEqual(1);
    });

    it('should get watermark-free videos', async () => {
      const videos = await client.getWatermarkFreeVideos(10);

      expect(Array.isArray(videos)).toBe(true);
      // All returned videos should have cleaned_path
      for (const video of videos) {
        expect(video.cleaned_path).not.toBeNull();
      }
    });
  });

  describe('Events', () => {
    let testCursor: string;

    it('should insert an event', async () => {
      testCursor = `cursor-${Date.now()}`;

      const event = await client.insertEvent({
        version: '1.0',
        event_id: `evt-${uuidv4()}`,
        command_id: testCommandId,
        cursor: testCursor,
        type: 'sora.video.cleaned',
        severity: 'info',
        payload: {
          input_path: '/test/video.mp4',
          output_path: '/test/cleaned/video.mp4',
        },
        emitted_at: new Date().toISOString(),
      });

      expect(event).not.toBeNull();
      expect(event?.type).toBe('sora.video.cleaned');
    });

    it('should get events by command', async () => {
      const events = await client.getEventsByCommand(testCommandId);

      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThanOrEqual(1);
    });

    it('should get events after cursor', async () => {
      // Get events after a very old cursor to ensure we get results
      const events = await client.getEventsAfterCursor('cursor-0', 10);

      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('Analytics', () => {
    it('should get command performance metrics', async () => {
      const metrics = await client.getCommandPerformance();

      expect(Array.isArray(metrics)).toBe(true);
    });

    it('should get recent video summary', async () => {
      const summary = await client.getRecentVideoSummary();

      expect(Array.isArray(summary)).toBe(true);
    });

    it('should get full command details', async () => {
      const details = await client.getCommandDetails(testCommandId);

      expect(details.command).not.toBeNull();
      expect(details.command?.command_id).toBe(testCommandId);
      expect(Array.isArray(details.videos)).toBe(true);
      expect(Array.isArray(details.events)).toBe(true);
    });
  });
});

// Run quick sanity test if executed directly
if (process.argv[1]?.includes('supabase-storage.test')) {
  console.log('\n🧪 Supabase Storage Integration Test\n');

  if (shouldSkip) {
    console.log('⚠️  Skipping tests - SUPABASE_URL or SUPABASE_SERVICE_KEY not set');
    console.log('\nSet environment variables:');
    console.log('  export SUPABASE_URL=https://your-project.supabase.co');
    console.log('  export SUPABASE_SERVICE_KEY=your-service-role-key');
    process.exit(0);
  }

  console.log('✅ Credentials found, running tests...');
}
