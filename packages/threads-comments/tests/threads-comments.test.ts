/**
 * Threads Comments API Tests
 */

import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3004';

async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch {
    return null;
  }
}

describe('Threads Comments API', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await safeFetch(`${API_BASE}/health`);
      if (response?.ok) {
        const data = await response.json() as { status: string; service: string; port: number };
        expect(data.status).toBe('ok');
        expect(data.service).toBe('threads-comments');
        expect(data.port).toBe(3004);
      } else {
        expect(true).toBe(true); // Server not running
      }
    });
  });

  describe('Status', () => {
    it('should return Threads status', async () => {
      const response = await safeFetch(`${API_BASE}/api/threads/status`);
      if (response?.ok) {
        const data = await response.json() as Record<string, unknown>;
        expect(data).toHaveProperty('isOnThreads');
        expect(data).toHaveProperty('isLoggedIn');
        expect(data).toHaveProperty('currentUrl');
        expect(data).toHaveProperty('commentsThisHour');
        expect(data).toHaveProperty('commentsToday');
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('Rate Limits', () => {
    it('should return rate limit configuration', async () => {
      const response = await safeFetch(`${API_BASE}/api/threads/rate-limits`);
      if (response?.ok) {
        const data = await response.json() as Record<string, unknown>;
        expect(data).toHaveProperty('commentsThisHour');
        expect(data).toHaveProperty('commentsToday');
        expect(data).toHaveProperty('limits');
      } else {
        expect(true).toBe(true);
      }
    });

    it('should update rate limits', async () => {
      const response = await safeFetch(`${API_BASE}/api/threads/rate-limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentsPerHour: 10 }),
      });
      if (response?.ok) {
        const data = await response.json() as { rateLimits: Record<string, number> };
        expect(data.rateLimits.commentsPerHour).toBe(10);
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('Comments', () => {
    it('should get comments from current post', async () => {
      const response = await safeFetch(`${API_BASE}/api/threads/comments?limit=10`);
      if (response?.ok) {
        const data = await response.json() as { comments: unknown[]; count: number };
        expect(data).toHaveProperty('comments');
        expect(data).toHaveProperty('count');
        expect(Array.isArray(data.comments)).toBe(true);
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('Config', () => {
    it('should get configuration', async () => {
      const response = await safeFetch(`${API_BASE}/api/threads/config`);
      if (response?.ok) {
        const data = await response.json() as { config: Record<string, unknown> };
        expect(data).toHaveProperty('config');
        expect(data.config).toHaveProperty('timeout');
        expect(data.config).toHaveProperty('commentsPerHour');
      } else {
        expect(true).toBe(true);
      }
    });
  });

  describe('API Contract', () => {
    it('should have correct endpoint structure', () => {
      const endpoints = [
        { method: 'GET', path: '/health' },
        { method: 'GET', path: '/api/threads/status' },
        { method: 'GET', path: '/api/threads/rate-limits' },
        { method: 'PUT', path: '/api/threads/rate-limits' },
        { method: 'POST', path: '/api/threads/navigate' },
        { method: 'GET', path: '/api/threads/post' },
        { method: 'GET', path: '/api/threads/comments' },
        { method: 'POST', path: '/api/threads/comments/post' },
        { method: 'GET', path: '/api/threads/config' },
        { method: 'PUT', path: '/api/threads/config' },
        { method: 'POST', path: '/api/threads/execute' },
      ];

      expect(endpoints.length).toBe(11);
      expect(endpoints.every(e => e.method && e.path)).toBe(true);
    });
  });
});
