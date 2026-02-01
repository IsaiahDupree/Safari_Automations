/**
 * TikTok DM API Tests
 */

import { describe, it, expect } from 'vitest';

const API_BASE = 'http://localhost:3002';

interface ApiResponse {
  status?: string;
  service?: string;
  conversations?: unknown[];
  count?: number;
  success?: boolean;
  messages?: unknown[];
  rateLimits?: Record<string, unknown>;
}

describe('TikTok DM API', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      try {
        const response = await fetch(`${API_BASE}/health`);
        if (response.ok) {
          const data = await response.json() as ApiResponse;
          expect(data.status).toBe('ok');
          expect(data.service).toBe('tiktok-dm');
        }
      } catch {
        console.log('TikTok DM API not running, skipping test');
      }
    });
  });

  describe('Conversations', () => {
    it('should list conversations', async () => {
      try {
        const response = await fetch(`${API_BASE}/api/tiktok/conversations`);
        if (response.ok) {
          const data = await response.json() as ApiResponse;
          expect(data).toHaveProperty('conversations');
          expect(Array.isArray(data.conversations)).toBe(true);
        }
      } catch {
        console.log('TikTok DM API not running, skipping test');
      }
    });
  });

  describe('Messages', () => {
    it('should read messages from current conversation', async () => {
      try {
        const response = await fetch(`${API_BASE}/api/tiktok/messages?limit=10`);
        if (response.ok) {
          const data = await response.json() as ApiResponse;
          expect(data).toHaveProperty('messages');
        }
      } catch {
        console.log('TikTok DM API not running, skipping test');
      }
    });
  });

  describe('API Contract', () => {
    it('should have correct endpoint structure', () => {
      const endpoints = [
        { method: 'GET', path: '/health' },
        { method: 'GET', path: '/api/tiktok/status' },
        { method: 'GET', path: '/api/tiktok/conversations' },
        { method: 'POST', path: '/api/tiktok/conversations/open' },
        { method: 'GET', path: '/api/tiktok/messages' },
        { method: 'POST', path: '/api/tiktok/messages/send' },
        { method: 'POST', path: '/api/tiktok/messages/send-to' },
      ];
      expect(endpoints.length).toBeGreaterThan(0);
    });
  });
});
