/**
 * TikTok DM API Tests — 4-Layer vitest suite
 *
 * Layer 1: Service health — no Safari required
 * Layer 2: Profile API — requires Safari open on TikTok
 * Layer 3: Prospect discovery — requires Safari on TikTok
 * Layer 4: DM dry-run — no real message sent
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = 'http://localhost:3102';

let serverAvailable = false;
let safariOnTikTok = false;

beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }

  if (serverAvailable) {
    try {
      const res = await fetch(`${API_BASE}/api/status`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as { isOnTikTok?: boolean };
        safariOnTikTok = data.isOnTikTok === true;
      }
    } catch {
      safariOnTikTok = false;
    }
  }
});

// === LAYER 1: Service health (no Safari required) ===

describe('Layer 1 — Service health', () => {
  it('GET /health returns { status: ok, service: tiktok-dm, port: 3102 }', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running on :3102');
      return;
    }
    const res = await fetch(`${API_BASE}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { status: string; service: string; port: number };
    expect(data.status).toBe('ok');
    expect(data.service).toBe('tiktok-dm');
    expect(data.port).toBe(3102);
  });

  it('GET /api/status returns valid shape', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    const res = await fetch(`${API_BASE}/api/status`);
    expect(res.status).not.toBe(500);
    const data = await res.json() as { isOnTikTok: boolean; isLoggedIn: boolean; currentUrl: string };
    expect(typeof data.isOnTikTok).toBe('boolean');
    expect(typeof data.isLoggedIn).toBe('boolean');
    expect(typeof data.currentUrl).toBe('string');
  });

  it('GET /api/tiktok/status returns valid shape (legacy path)', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    const res = await fetch(`${API_BASE}/api/tiktok/status`);
    expect(res.status).not.toBe(500);
    const data = await res.json() as { isOnTikTok: boolean };
    expect(typeof data.isOnTikTok).toBe('boolean');
  });

  it('POST /api/messages/send-to with dryRun:true returns success without sending', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    const res = await fetch(`${API_BASE}/api/messages/send-to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'saraheashley', text: 'test dry run', dryRun: true }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { success: boolean; dryRun: boolean };
    expect(data.success).toBe(true);
    expect(data.dryRun).toBe(true);
  });

  it('GET /api/conversations returns valid shape', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    const res = await fetch(`${API_BASE}/api/conversations`);
    if (res.ok) {
      const data = await res.json() as { conversations: unknown[] };
      expect(Array.isArray(data.conversations)).toBe(true);
    }
  });
});

// === LAYER 2: Profile API (requires Safari open on TikTok) ===

describe('Layer 2 — Profile API', () => {
  it('GET /api/profile/charlidamelio returns followers > 1000000', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    if (!safariOnTikTok) {
      console.log('[skip] Safari not on TikTok — open tiktok.com in Safari to run Layer 2 tests');
      return;
    }

    const res = await fetch(`${API_BASE}/api/profile/charlidamelio`, { signal: AbortSignal.timeout(20000) });
    expect(res.ok).toBe(true);
    const data = await res.json() as {
      username: string; displayName: string; bio: string;
      followers: string; following: string; likes: string;
      verified: boolean; isPrivate: boolean;
    };
    expect(data.username).toBe('charlidamelio');
    expect(typeof data.followers).toBe('string');
    // Parse follower count — charlidamelio has 150M+ followers
    const parseCount = (s: string) => {
      const m = (s || '').replace(/,/g, '').match(/^([\d.]+)\s*([KkMm]?)$/);
      if (!m) return 0;
      const n = parseFloat(m[1]);
      const suffix = m[2].toUpperCase();
      if (suffix === 'K') return n * 1000;
      if (suffix === 'M') return n * 1_000_000;
      return n;
    };
    const followerCount = parseCount(data.followers);
    expect(followerCount).toBeGreaterThan(1_000_000);
  });

  it('GET /api/tiktok/profile/:username returns same shape (legacy path)', async () => {
    if (!serverAvailable || !safariOnTikTok) {
      console.log('[skip]');
      return;
    }
    const res = await fetch(`${API_BASE}/api/tiktok/profile/charlidamelio`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const data = await res.json() as { username: string; followers: string };
      expect(data.username).toBe('charlidamelio');
    }
  });
});

// === LAYER 3: Prospect discovery (requires Safari on TikTok) ===

describe('Layer 3 — Prospect discovery', () => {
  it('POST /api/prospect/discover with buildinpublic returns >= 1 candidate with score > 0', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    if (!safariOnTikTok) {
      console.log('[skip] Safari not on TikTok');
      return;
    }

    const res = await fetch(`${API_BASE}/api/prospect/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashtags: ['buildinpublic'], maxCandidates: 5 }),
      signal: AbortSignal.timeout(120000),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { candidates: { score: number }[]; total: number };
    expect(Array.isArray(data.candidates)).toBe(true);
    expect(data.candidates.length).toBeGreaterThanOrEqual(1);
    expect(data.candidates[0].score).toBeGreaterThan(0);
  });

  it('GET /api/prospect/score/:username returns score + icp shape', async () => {
    if (!serverAvailable || !safariOnTikTok) {
      console.log('[skip]');
      return;
    }
    const res = await fetch(`${API_BASE}/api/prospect/score/charlidamelio`, { signal: AbortSignal.timeout(15000) });
    expect(res.ok).toBe(true);
    const data = await res.json() as { username: string; score: number; signals: string[]; icp: { qualifies: boolean } };
    expect(data.username).toBe('charlidamelio');
    expect(typeof data.score).toBe('number');
    expect(Array.isArray(data.signals)).toBe(true);
    expect(typeof data.icp.qualifies).toBe('boolean');
  });
});

// === LAYER 4: DM dry-run ===

describe('Layer 4 — DM dry-run', () => {
  it('POST /api/messages/send-to with dryRun flag does not send real message', async () => {
    if (!serverAvailable) {
      console.log('[skip] TikTok DM server not running');
      return;
    }
    const res = await fetch(`${API_BASE}/api/messages/send-to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'saraheashley', text: 'layer 4 dry run test', dryRun: true }),
    });
    expect(res.ok).toBe(true);
    const data = await res.json() as { success: boolean; dryRun: boolean };
    expect(data.success).toBe(true);
    expect(data.dryRun).toBe(true);
  });
});
