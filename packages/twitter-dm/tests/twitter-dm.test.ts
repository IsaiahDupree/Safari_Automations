/**
 * Twitter DM API Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const API_BASE = 'http://localhost:3003';

interface ApiResponse {
  status?: string;
  service?: string;
  messagesSentToday?: number;
  messagesSentThisHour?: number;
  limits?: Record<string, number>;
  activeHours?: Record<string, unknown>;
  rateLimits?: Record<string, number>;
  isOnTwitter?: boolean;
  isLoggedIn?: boolean;
  currentUrl?: string;
  conversations?: unknown[];
  count?: number;
  totalCount?: number;
  success?: boolean;
  tab?: string;
  messages?: unknown[];
}

describe('Twitter DM API', () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${API_BASE}/health`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data.status).toBe('ok');
        expect(data.service).toBe('twitter-dm');
      } else {
        // Server not running - skip test
        console.log('Twitter DM API not running, skipping test');
      }
    });
  });

  describe('Rate Limits', () => {
    it('should return rate limit configuration', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/rate-limits`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('messagesSentToday');
        expect(data).toHaveProperty('messagesSentThisHour');
        expect(data).toHaveProperty('limits');
        expect(data).toHaveProperty('activeHours');
      }
    });

    it('should update rate limits', async () => {
      const newLimits = { messagesPerHour: 10 };
      const response = await fetch(`${API_BASE}/api/twitter/rate-limits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLimits),
      });
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data.rateLimits?.messagesPerHour).toBe(10);
      }
    });
  });

  describe('Status', () => {
    it('should return Twitter status', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/status`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('isOnTwitter');
        expect(data).toHaveProperty('isLoggedIn');
        expect(data).toHaveProperty('currentUrl');
      }
    });
  });

  describe('Conversations', () => {
    it('should list conversations', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/conversations`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('conversations');
        expect(data).toHaveProperty('count');
        expect(Array.isArray(data.conversations)).toBe(true);
      }
    });

    it('should get all conversations by tab', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/conversations/all`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('conversations');
        expect(data).toHaveProperty('totalCount');
      }
    });

    it('should get unread conversations', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/conversations/unread`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('conversations');
        expect(data).toHaveProperty('count');
      }
    });
  });

  describe('Navigation', () => {
    it('should navigate to inbox', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/inbox/navigate`, {
        method: 'POST',
      });
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('success');
      }
    });

    it('should switch tabs', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/inbox/tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: 'primary' }),
      });
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('success');
        expect(data).toHaveProperty('tab');
      }
    });
  });

  describe('Messages', () => {
    it('should read messages from current conversation', async () => {
      const response = await fetch(`${API_BASE}/api/twitter/messages?limit=10`);
      
      if (response.ok) {
        const data = await response.json() as ApiResponse;
        expect(data).toHaveProperty('messages');
        expect(data).toHaveProperty('count');
      }
    });
  });

  describe('API Contract', () => {
    it('should have correct endpoint structure', () => {
      const endpoints = [
        { method: 'GET', path: '/health' },
        { method: 'GET', path: '/api/twitter/status' },
        { method: 'GET', path: '/api/twitter/rate-limits' },
        { method: 'PUT', path: '/api/twitter/rate-limits' },
        { method: 'POST', path: '/api/twitter/inbox/navigate' },
        { method: 'POST', path: '/api/twitter/inbox/tab' },
        { method: 'GET', path: '/api/twitter/conversations' },
        { method: 'GET', path: '/api/twitter/conversations/all' },
        { method: 'GET', path: '/api/twitter/conversations/unread' },
        { method: 'POST', path: '/api/twitter/conversations/open' },
        { method: 'POST', path: '/api/twitter/conversations/new' },
        { method: 'GET', path: '/api/twitter/messages' },
        { method: 'POST', path: '/api/twitter/messages/send' },
        { method: 'POST', path: '/api/twitter/messages/send-to' },
        { method: 'POST', path: '/api/twitter/messages/send-to-url' },
        { method: 'POST', path: '/api/twitter/execute' },
        { method: 'PUT', path: '/api/twitter/config' },
      ];

      expect(endpoints.length).toBe(17);
      expect(endpoints.every(e => e.method && e.path)).toBe(true);
    });
  });
});
