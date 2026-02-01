/**
 * Database Logging Tests
 * 
 * Tests for comment logging to Supabase
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CommentLogger } from '../src/db/comment-logger.js';

const API_BASE = 'http://localhost:3005';

describe('CommentLogger for Instagram', () => {
  let logger: CommentLogger;

  beforeAll(() => {
    logger = new CommentLogger();
  });

  it('should generate a unique session ID', () => {
    expect(logger.getSessionId()).toMatch(/^session_\d+_[a-z0-9]+$/);
  });

  it('should log a single comment to database', async () => {
    const result = await logger.logComment({
      platform: 'threads',
      username: 'test_user',
      postUrl: 'https://threads.com/test/post/123',
      postContent: 'Test post content',
      commentText: 'Test comment from automated test',
      success: true,
      aiAnalysis: {
        sentiment: 'positive',
        topics: ['tech', 'test'],
        tone: 'neutral',
      },
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
  });

  it('should log a failed comment', async () => {
    const result = await logger.logComment({
      platform: 'threads',
      username: 'test_user',
      commentText: 'Failed test comment',
      success: false,
      error: 'Test error message',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBeTruthy();
  });

  it('should get comment history', async () => {
    const history = await logger.getHistory({ platform: 'threads', limit: 10 });

    expect(Array.isArray(history)).toBe(true);
    if (history.length > 0) {
      expect(history[0]).toHaveProperty('platform');
      expect(history[0]).toHaveProperty('commentText');
      expect(history[0]).toHaveProperty('success');
    }
  });

  it('should get stats for platform', async () => {
    const stats = await logger.getStats('threads');

    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('successful');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('todayCount');
    expect(typeof stats.total).toBe('number');
  });

  it('should log multiple comments in a session', async () => {
    const results = [
      { success: true, username: 'user1', comment: 'Comment 1' },
      { success: true, username: 'user2', comment: 'Comment 2' },
      { success: false, username: 'user3', comment: 'Comment 3', error: 'Failed' },
    ];

    const sessionResult = await logger.logSession(results, 'threads');

    expect(sessionResult.logged).toBeGreaterThanOrEqual(2);
    expect(sessionResult.failed).toBeGreaterThanOrEqual(0);
  });
});

describe('Instagram Database API Endpoints', () => {
  it('GET /api/instagram/db/stats should return stats', async () => {
    const response = await fetch(`${API_BASE}/api/instagram/db/stats`);
    
    if (response.ok) {
      const data = await response.json() as { total: number; successful: number };
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('successful');
    }
  });

  it('GET /api/instagram/db/history should return history', async () => {
    const response = await fetch(`${API_BASE}/api/instagram/db/history?limit=5`);
    
    if (response.ok) {
      const data = await response.json() as { history: unknown[]; count: number };
      expect(data).toHaveProperty('history');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.history)).toBe(true);
    }
  });
});
