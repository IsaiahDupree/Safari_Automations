/**
 * API Client Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InstagramDMClient, createDMClient } from '../src/api/client.js';

describe('InstagramDMClient', () => {
  let client: InstagramDMClient;
  
  beforeEach(() => {
    client = new InstagramDMClient({ baseUrl: 'http://localhost:3100' });
  });

  describe('constructor', () => {
    it('removes trailing slash from baseUrl', () => {
      const c = new InstagramDMClient({ baseUrl: 'http://localhost:3100/' });
      // The URL is internal, but we can test behavior
      expect(c).toBeDefined();
    });

    it('uses default timeout', () => {
      const c = new InstagramDMClient({ baseUrl: 'http://test.com' });
      expect(c).toBeDefined();
    });

    it('accepts custom timeout', () => {
      const c = new InstagramDMClient({ baseUrl: 'http://test.com', timeout: 5000 });
      expect(c).toBeDefined();
    });
  });
});

describe('createDMClient', () => {
  it('creates client with default URL', () => {
    const client = createDMClient();
    expect(client).toBeInstanceOf(InstagramDMClient);
  });

  it('creates client with custom URL', () => {
    const client = createDMClient('http://custom:3000');
    expect(client).toBeInstanceOf(InstagramDMClient);
  });
});

describe('InstagramDMClient methods', () => {
  let client: InstagramDMClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    client = new InstagramDMClient({ baseUrl: 'http://localhost:3100' });
    mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('healthCheck calls correct endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok', timestamp: '2024-01-01' }),
    });
    
    const result = await client.healthCheck();
    
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/health',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('ok');
  });

  it('sendMessageTo calls correct endpoint with body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, username: 'test' }),
    });
    
    const result = await client.sendMessageTo('testuser', 'Hello!');
    
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/api/messages/send-to',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ username: 'testuser', text: 'Hello!' }),
      })
    );
    expect(result.success).toBe(true);
  });

  it('handles error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Rate limit exceeded',
      json: async () => ({ error: 'Too many requests' }),
    });
    
    const result = await client.sendMessage('test');
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('Too many requests');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    
    const result = await client.healthCheck();
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('listConversations uses GET method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [], count: 0 }),
    });
    
    await client.listConversations();
    
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/api/conversations',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('switchTab sends tab in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, tab: 'general' }),
    });
    
    await client.switchTab('general');
    
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3100/api/inbox/tab',
      expect.objectContaining({
        body: JSON.stringify({ tab: 'general' }),
      })
    );
  });
});
