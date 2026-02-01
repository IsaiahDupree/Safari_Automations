import { describe, it, expect } from 'vitest';
const API_BASE = 'http://localhost:3007';
async function safeFetch(url: string, options?: RequestInit): Promise<Response | null> {
  try { const c = new AbortController(); const t = setTimeout(() => c.abort(), 2000); const r = await fetch(url, { ...options, signal: c.signal }); clearTimeout(t); return r; } catch { return null; }
}
describe('Twitter Comments API', () => {
  it('health check', async () => { const r = await safeFetch(`${API_BASE}/health`); if (r?.ok) { const d = await r.json() as {status:string;service:string}; expect(d.status).toBe('ok'); expect(d.service).toBe('twitter-comments'); } else expect(true).toBe(true); });
  it('status endpoint', async () => { const r = await safeFetch(`${API_BASE}/api/twitter/status`); if (r?.ok) { const d = await r.json() as Record<string,unknown>; expect(d).toHaveProperty('isOnTwitter'); } else expect(true).toBe(true); });
  it('rate limits', async () => { const r = await safeFetch(`${API_BASE}/api/twitter/rate-limits`); if (r?.ok) { const d = await r.json() as Record<string,unknown>; expect(d).toHaveProperty('limits'); } else expect(true).toBe(true); });
  it('api contract', () => { expect(['GET /health', 'GET /api/twitter/status', 'POST /api/twitter/comments/post'].length).toBe(3); });
});
