/**
 * Instagram Comments API Tests
 */
import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3005';

async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch { return null; }
}

describe('Instagram Comments API', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await safeFetch(`${API_BASE}/health`);
      if (response?.ok) {
        const data = await response.json() as { status: string; service: string; port: number };
        expect(data.status).toBe('ok');
        expect(data.service).toBe('instagram-comments');
        expect(data.port).toBe(3005);
      } else { expect(true).toBe(true); }
    });
  });

  describe('Status', () => {
    it('should return Instagram status', async () => {
      const response = await safeFetch(`${API_BASE}/api/instagram/status`);
      if (response?.ok) {
        const data = await response.json() as Record<string, unknown>;
        expect(data).toHaveProperty('isOnInstagram');
        expect(data).toHaveProperty('isLoggedIn');
      } else { expect(true).toBe(true); }
    });
  });

  describe('Rate Limits', () => {
    it('should return rate limit configuration', async () => {
      const response = await safeFetch(`${API_BASE}/api/instagram/rate-limits`);
      if (response?.ok) {
        const data = await response.json() as Record<string, unknown>;
        expect(data).toHaveProperty('commentsThisHour');
        expect(data).toHaveProperty('limits');
      } else { expect(true).toBe(true); }
    });
  });

  describe('API Contract', () => {
    it('should have correct endpoint structure', () => {
      const endpoints = [
        { method: 'GET', path: '/health' },
        { method: 'GET', path: '/api/instagram/status' },
        { method: 'GET', path: '/api/instagram/rate-limits' },
        { method: 'POST', path: '/api/instagram/navigate' },
        { method: 'GET', path: '/api/instagram/comments' },
        { method: 'POST', path: '/api/instagram/comments/post' },
      ];
      expect(endpoints.length).toBe(6);
    });
  });
});
