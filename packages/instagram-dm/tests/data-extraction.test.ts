/**
 * Data Extraction Tests
 * Verifiable tests for obtaining Instagram DM data
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';

// Helper to make requests to Safari API
async function safariRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${SAFARI_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

// Skip tests if Safari server not available
let safariAvailable = false;

beforeAll(async () => {
  try {
    const health = await safariRequest<{ status: string }>('/health');
    safariAvailable = health.status === 'ok';
  } catch {
    safariAvailable = false;
  }
});

describe('Safari Server Connection', () => {
  it('should connect to Safari server', async () => {
    if (!safariAvailable) {
      console.log('⚠️ Safari server not available - skipping live tests');
      return;
    }
    
    const health = await safariRequest<{ status: string; timestamp: string }>('/health');
    
    expect(health).toHaveProperty('status');
    expect(health.status).toBe('ok');
    expect(health).toHaveProperty('timestamp');
  });

  it('should return rate limit information', async () => {
    if (!safariAvailable) return;
    
    const limits = await safariRequest<{
      messagesSentToday: number;
      messagesSentThisHour: number;
      limits: { messagesPerHour: number; messagesPerDay: number };
      activeHours: { isActive: boolean; currentHour: number };
    }>('/api/rate-limits');
    
    expect(limits).toHaveProperty('messagesSentToday');
    expect(limits).toHaveProperty('messagesSentThisHour');
    expect(limits).toHaveProperty('limits');
    expect(limits.limits).toHaveProperty('messagesPerHour');
    expect(limits.limits).toHaveProperty('messagesPerDay');
    expect(limits).toHaveProperty('activeHours');
    expect(typeof limits.activeHours.isActive).toBe('boolean');
  });
});

describe('Conversation Listing', () => {
  it('should list conversations from current view', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{
      conversations: { username: string; lastMessage?: string }[];
      count: number;
    }>('/api/conversations');
    
    expect(result).toHaveProperty('conversations');
    expect(result).toHaveProperty('count');
    expect(Array.isArray(result.conversations)).toBe(true);
    expect(typeof result.count).toBe('number');
    
    // Each conversation should have a username
    for (const conv of result.conversations) {
      expect(conv).toHaveProperty('username');
      expect(typeof conv.username).toBe('string');
    }
  });

  it('should switch between DM tabs', async () => {
    if (!safariAvailable) return;
    
    const tabs = ['primary', 'general', 'requests'] as const;
    
    for (const tab of tabs) {
      const result = await safariRequest<{ success: boolean; tab: string }>(
        '/api/inbox/tab',
        'POST',
        { tab }
      );
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('tab');
      expect(result.tab).toBe(tab);
    }
  });

  it('should get all conversations from all tabs', async () => {
    if (!safariAvailable) return;
    
    // Navigate to inbox first
    await safariRequest('/api/inbox/navigate', 'POST');
    
    const result = await safariRequest<{
      conversations: Record<string, { username: string }[]>;
      totalCount: number;
    }>('/api/conversations/all');
    
    expect(result).toHaveProperty('conversations');
    expect(result).toHaveProperty('totalCount');
    expect(typeof result.totalCount).toBe('number');
    
    // Should have primary, general, requests, hidden_requests keys
    expect(result.conversations).toHaveProperty('primary');
    expect(Array.isArray(result.conversations.primary)).toBe(true);
  });
});

describe('Message Extraction', () => {
  it('should read messages from current conversation', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{
      messages: { text: string; isOutbound: boolean; messageType: string }[];
      count: number;
    }>('/api/messages?limit=10');
    
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('count');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(typeof result.count).toBe('number');
    
    // Each message should have required fields
    for (const msg of result.messages) {
      expect(msg).toHaveProperty('text');
      expect(msg).toHaveProperty('isOutbound');
      expect(msg).toHaveProperty('messageType');
      expect(typeof msg.isOutbound).toBe('boolean');
    }
  });

  it('should respect message limit parameter', async () => {
    if (!safariAvailable) return;
    
    const result5 = await safariRequest<{ messages: unknown[]; count: number }>('/api/messages?limit=5');
    const result20 = await safariRequest<{ messages: unknown[]; count: number }>('/api/messages?limit=20');
    
    expect(result5.messages.length).toBeLessThanOrEqual(5);
    expect(result20.messages.length).toBeLessThanOrEqual(20);
  });
});

describe('Conversation Opening', () => {
  it('should open conversation by username', async () => {
    if (!safariAvailable) return;
    
    // First get list of conversations
    const convos = await safariRequest<{
      conversations: { username: string }[];
    }>('/api/conversations');
    
    if (convos.conversations.length === 0) {
      console.log('⚠️ No conversations available to test');
      return;
    }
    
    const testUsername = convos.conversations[0].username;
    
    const result = await safariRequest<{ success: boolean; username: string }>(
      '/api/conversations/open',
      'POST',
      { username: testUsername }
    );
    
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('username');
    expect(result.username).toBe(testUsername);
  });
});

describe('Data Structure Validation', () => {
  it('should return properly structured conversation data', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{
      conversations: { username: string; lastMessage?: string }[];
      count: number;
    }>('/api/conversations');
    
    // Validate structure
    expect(result.count).toBe(result.conversations.length);
    
    result.conversations.forEach((conv, index) => {
      expect(conv.username).toBeDefined();
      expect(conv.username.length).toBeGreaterThan(0);
      // Username should not contain profile picture suffix
      expect(conv.username).not.toContain("'s profile picture");
    });
  });

  it('should return properly structured message data', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{
      messages: { text: string; isOutbound: boolean; messageType: string }[];
      count: number;
    }>('/api/messages?limit=10');
    
    result.messages.forEach(msg => {
      // Text should be a string (can be empty)
      expect(typeof msg.text).toBe('string');
      
      // isOutbound should be boolean
      expect(typeof msg.isOutbound).toBe('boolean');
      
      // messageType should be a valid type
      expect(['text', 'image', 'video', 'audio', 'story_reply', 'link']).toContain(msg.messageType);
    });
  });
});

describe('JavaScript Execution', () => {
  it('should execute custom JavaScript in Safari', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{ output: string }>(
      '/api/execute',
      'POST',
      { script: 'document.title' }
    );
    
    expect(result).toHaveProperty('output');
    expect(typeof result.output).toBe('string');
  });

  it('should extract DOM elements via JavaScript', async () => {
    if (!safariAvailable) return;
    
    const result = await safariRequest<{ output: string }>(
      '/api/execute',
      'POST',
      { script: 'document.querySelectorAll("a").length.toString()' }
    );
    
    expect(result).toHaveProperty('output');
    const linkCount = parseInt(result.output);
    expect(linkCount).toBeGreaterThanOrEqual(0);
  });
});
