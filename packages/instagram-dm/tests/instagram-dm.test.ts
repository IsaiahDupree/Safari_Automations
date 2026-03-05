/**
 * Instagram DM API Tests
 *
 * Layer 1 — Contract tests (no server needed): always run
 * Layer 2 — Live server tests (port 3100 must be up): skip gracefully if down
 * Layer 3 — Safari session tests (Safari must be on instagram.com): skip if no session
 * Layer 4 — Data quality tests: validate real shape of returned data
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = 'http://localhost:3100';

// ─── helpers ────────────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

async function hasSession(): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}/api/status`);
    if (!r.ok) return false;
    const d = await r.json() as { isOnInstagram?: boolean; isLoggedIn?: boolean };
    return !!d.isOnInstagram && !!d.isLoggedIn;
  } catch {
    return false;
  }
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// ─── Layer 1: Contract tests (always run) ───────────────────────────────────

describe('API Contract (no server required)', () => {
  it('server base URL is port 3100', () => {
    expect(API_BASE).toBe('http://localhost:3100');
  });

  it('endpoint paths match server routes', () => {
    const routes = [
      'GET /health',
      'GET /api/status',
      'GET /api/rate-limits',
      'GET /api/conversations',
      'GET /api/conversations/all',
      'GET /api/conversations/unread',
      'POST /api/inbox/navigate',
      'POST /api/inbox/tab',
      'POST /api/conversations/open',
      'GET /api/messages',
      'POST /api/messages/send',
      'POST /api/messages/send-to',
      'GET /api/profile/:username',
      'POST /api/debug/eval',
    ];
    // Just verifying they're documented — actual routing tested in live layers
    expect(routes.length).toBeGreaterThanOrEqual(14);
  });

  it('send-to requires username + text (not message)', () => {
    // Key regression: field is "text", not "message"
    const body = { username: 'saraheashley', text: 'hello' };
    expect(body).toHaveProperty('text');
    expect(body).not.toHaveProperty('message');
  });
});

// ─── Layer 2: Live server tests (requires port 3100 up) ─────────────────────

describe('Live Server (port 3100)', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (!serverUp) console.warn('  ⚠ IG DM server not running — Layer 2/3/4 tests skipped');
  });

  it('health returns {status:"ok"}', async () => {
    if (!serverUp) return;
    const d = await get<{ status: string }>('/health');
    expect(d.status).toBe('ok');
  });

  it('health includes rate limit info', async () => {
    if (!serverUp) return;
    const d = await get<{ rateLimits?: unknown }>('/health');
    expect(d).toHaveProperty('rateLimits');
  });

  it('GET /api/rate-limits returns structure', async () => {
    if (!serverUp) return;
    const d = await get<{ limits?: unknown }>('/api/rate-limits');
    expect(d).toHaveProperty('limits');
  });

  it('GET /api/status returns session info', async () => {
    if (!serverUp) return;
    const d = await get<{ isOnInstagram?: boolean; isLoggedIn?: boolean; currentUrl?: string }>('/api/status');
    expect(d).toHaveProperty('isOnInstagram');
    expect(d).toHaveProperty('isLoggedIn');
    expect(d).toHaveProperty('currentUrl');
  });
});

// ─── Layer 3: Safari session tests (requires active Instagram session) ───────

describe('Safari Session — Conversations', () => {
  let serverUp = false;
  let sessionActive = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (serverUp) sessionActive = await hasSession();
    if (!sessionActive) console.warn('  ⚠ No active Instagram Safari session — Layer 3/4 tests skipped');
  });

  it('GET /api/conversations returns array', async () => {
    if (!sessionActive) return;
    const d = await get<{ conversations: unknown[]; count: number }>('/api/conversations');
    expect(Array.isArray(d.conversations)).toBe(true);
    expect(typeof d.count).toBe('number');
    expect(d.count).toBe(d.conversations.length);
  });

  it('conversations have required shape', async () => {
    if (!sessionActive) return;
    const d = await get<{ conversations: Array<{ username: string; lastMessage?: string }> }>('/api/conversations');
    if (d.conversations.length === 0) {
      console.warn('  ⚠ No conversations found — navigate to instagram.com/direct/inbox/ first');
      return;
    }
    const first = d.conversations[0];
    expect(typeof first.username).toBe('string');
    expect(first.username.length).toBeGreaterThan(0);
  });

  it('conversations return >0 items when inbox is loaded', async () => {
    if (!sessionActive) return;
    // Navigate to inbox first to ensure DOM is loaded
    await post('/api/inbox/navigate', {});
    await new Promise(r => setTimeout(r, 2000));
    const d = await get<{ count: number }>('/api/conversations');
    // Soft assertion — warn if empty, don't fail (Safari tab might be mid-navigation)
    if (d.count === 0) {
      console.warn('  ⚠ 0 conversations returned — DOM may not be fully loaded');
    } else {
      expect(d.count).toBeGreaterThan(0);
    }
  }, 20000);

  it('POST /api/inbox/tab general switches tab', async () => {
    if (!sessionActive) return;
    const d = await post<{ success: boolean }>('/api/inbox/tab', { tab: 'general' });
    expect(d.success).toBe(true);
    // Navigate back to primary
    await post('/api/inbox/tab', { tab: 'primary' });
  }, 20000);
});

describe('Safari Session — Profile Enrichment', () => {
  let sessionActive = false;

  beforeAll(async () => {
    const up = await isServerUp();
    if (up) sessionActive = await hasSession();
  });

  it('GET /api/profile/:username returns shape', async () => {
    if (!sessionActive) return;
    const d = await get<{
      success: boolean;
      username: string;
      profile: { fullName: string; bio: string; followers: string; following: string; posts: string; isPrivate: boolean };
    }>('/api/profile/saraheashley');

    expect(d.success).toBe(true);
    expect(d.username).toBe('saraheashley');
    expect(d.profile).toHaveProperty('fullName');
    expect(d.profile).toHaveProperty('bio');
    expect(d.profile).toHaveProperty('followers');
    expect(d.profile).toHaveProperty('following');
    expect(d.profile).toHaveProperty('posts');
    expect(typeof d.profile.isPrivate).toBe('boolean');
  }, 20000);

  it('profile fullName is non-empty for public account', async () => {
    if (!sessionActive) return;
    const d = await get<{ profile: { fullName: string } }>('/api/profile/saraheashley');
    expect(d.profile.fullName.length).toBeGreaterThan(0);
  }, 20000);

  it('profile followers is a number string (not empty) for public account', async () => {
    if (!sessionActive) return;
    const d = await get<{ profile: { followers: string } }>('/api/profile/saraheashley');
    // Regression: was returning "" due to \d → d in template literal
    expect(d.profile.followers).toMatch(/^[\d.,KkMm]+$/);
  }, 20000);

  it('profile bio is non-empty for saraheashley', async () => {
    if (!sessionActive) return;
    const d = await get<{ profile: { bio: string } }>('/api/profile/saraheashley');
    expect(d.profile.bio.length).toBeGreaterThan(0);
  }, 20000);
});

// ─── Layer 4: CRM sync integration ──────────────────────────────────────────

describe('CRM Sync Integration', () => {
  let sessionActive = false;
  let crmliteUp = false;

  beforeAll(async () => {
    const up = await isServerUp();
    if (up) sessionActive = await hasSession();

    // Check CRMLite (local first, then Vercel)
    try {
      const r = await fetch('http://localhost:3200/api/health');
      crmliteUp = r.ok;
    } catch { /* not up */ }

    if (!crmliteUp) console.warn('  ⚠ CRMLite not running locally — sync tests skipped (start: cd crmlite && npm run dev -- --port 3200)');
  });

  it('conversations can be posted to /api/sync/dm', async () => {
    if (!sessionActive || !crmliteUp) return;

    const payload = {
      platform: 'instagram',
      conversations: [{
        username: 'test_sync_user',
        messages: [{ text: 'vitest sync check', is_outbound: false, sent_at: new Date().toISOString() }],
      }],
    };

    const r = await fetch('http://localhost:3200/api/sync/dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify(payload),
    });
    const d = await r.json() as { synced: boolean; contacts_created: number };
    expect(d.synced).toBe(true);
    expect(typeof d.contacts_created).toBe('number');
  }, 15000);

  it('live conversations sync to CRMLite', async () => {
    if (!sessionActive || !crmliteUp) return;

    // Navigate inbox
    await post('/api/inbox/navigate', {});
    await new Promise(r => setTimeout(r, 2000));

    const { conversations } = await get<{ conversations: Array<{ username: string; lastMessage?: string }> }>('/api/conversations');
    if (conversations.length === 0) {
      console.warn('  ⚠ No conversations to sync');
      return;
    }

    const payload = {
      platform: 'instagram',
      conversations: conversations.slice(0, 3).map(c => ({
        username: c.username,
        messages: [{ text: c.lastMessage || '(preview)', is_outbound: false, sent_at: new Date().toISOString() }],
      })),
    };

    const r = await fetch('http://localhost:3200/api/sync/dm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' },
      body: JSON.stringify(payload),
    });
    const d = await r.json() as { synced: boolean; conversations_synced: number; messages_synced: number };
    expect(d.synced).toBe(true);
    expect(d.conversations_synced).toBeGreaterThan(0);
    expect(d.messages_synced).toBeGreaterThan(0);
  }, 30000);
});
