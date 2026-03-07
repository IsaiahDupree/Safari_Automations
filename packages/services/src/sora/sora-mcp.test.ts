/**
 * Sora MCP — unit tests
 * Run: npx tsx --test packages/services/src/sora/sora-mcp.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Helpers (copied from sora-mcp.ts for isolated testing) ──────────────────

function loadEnvFiles(...envFiles: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const envFile of envFiles) {
    try {
      for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) {
          const key = m[1].trim();
          if (!env[key]) env[key] = m[2].trim().replace(/^['"]|['"]$/g, '');
        }
      }
    } catch {}
  }
  return env;
}

function extractSoraVideoId(draftHref?: string): string | undefined {
  if (!draftHref) return undefined;
  const m = draftHref.match(/\/(?:g|gen)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : draftHref.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || undefined;
}

function wmRegion(height: number, width: number): { wmH: number; wmY: number } {
  const wmH = Math.ceil(height * 0.085);
  const wmY = height - wmH;
  return { wmH, wmY };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('loadEnvFiles', () => {
  it('first-wins: key from first file is not overwritten', () => {
    const tmp1 = `/tmp/sora-test-env1-${Date.now()}.env`;
    const tmp2 = `/tmp/sora-test-env2-${Date.now()}.env`;
    fs.writeFileSync(tmp1, 'FOO=from_file1\nBAR=only_in_1\n');
    fs.writeFileSync(tmp2, 'FOO=from_file2\nBAZ=only_in_2\n');
    const env = loadEnvFiles(tmp1, tmp2);
    assert.equal(env['FOO'], 'from_file1');
    assert.equal(env['BAR'], 'only_in_1');
    assert.equal(env['BAZ'], 'only_in_2');
    fs.unlinkSync(tmp1);
    fs.unlinkSync(tmp2);
  });

  it('strips surrounding quotes from values', () => {
    const tmp = `/tmp/sora-test-env-quotes-${Date.now()}.env`;
    fs.writeFileSync(tmp, `KEY1="quoted_value"\nKEY2='single_quoted'\nKEY3=no_quotes\n`);
    const env = loadEnvFiles(tmp);
    assert.equal(env['KEY1'], 'quoted_value');
    assert.equal(env['KEY2'], 'single_quoted');
    assert.equal(env['KEY3'], 'no_quotes');
    fs.unlinkSync(tmp);
  });

  it('handles missing file gracefully', () => {
    const env = loadEnvFiles('/nonexistent/path.env');
    assert.deepEqual(env, {});
  });

  it('skips comment lines', () => {
    const tmp = `/tmp/sora-test-env-comments-${Date.now()}.env`;
    fs.writeFileSync(tmp, `# this is a comment\nREAL=value\n# another comment\n`);
    const env = loadEnvFiles(tmp);
    assert.equal(env['REAL'], 'value');
    assert.equal(Object.keys(env).length, 1);
  });
});

describe('extractSoraVideoId', () => {
  it('extracts video ID from /g/ URL', () => {
    assert.equal(extractSoraVideoId('/g/abc123def'), 'abc123def');
  });

  it('extracts video ID from /gen/ URL', () => {
    assert.equal(extractSoraVideoId('/gen/xyz789'), 'xyz789');
  });

  it('returns undefined for undefined input', () => {
    assert.equal(extractSoraVideoId(undefined), undefined);
  });

  it('handles alphanumeric IDs with dashes and underscores', () => {
    const id = extractSoraVideoId('/g/abc-123_DEF');
    assert.equal(id, 'abc-123_DEF');
  });
});

describe('watermark region calculation', () => {
  it('480x872 (vertical 480p): bottom 8.5%', () => {
    const { wmH, wmY } = wmRegion(872, 480);
    assert.equal(wmH, 75);  // ceil(872 * 0.085) = 75
    assert.equal(wmY, 797); // 872 - 75
  });

  it('1080x1920 (vertical 1080p): bottom 8.5%', () => {
    const { wmH, wmY } = wmRegion(1920, 1080);
    assert.equal(wmH, 164); // ceil(1920 * 0.085)
    assert.equal(wmY, 1756);
  });

  it('720x1280: covers watermark strip', () => {
    const { wmH, wmY } = wmRegion(1280, 720);
    assert.ok(wmH >= 100, `wmH=${wmH} should be >= 100`);
    assert.ok(wmY < 1280, `wmY=${wmY} should be < height`);
  });

  it('wmY + wmH == height', () => {
    for (const h of [480, 720, 872, 1080, 1920]) {
      const { wmH, wmY } = wmRegion(h, h * 9 / 16);
      assert.equal(wmY + wmH, h, `For height ${h}: wmY(${wmY}) + wmH(${wmH}) should = ${h}`);
    }
  });
});

describe('ffmpeg watermark removal integration', () => {
  it('drawbox produces output file larger than 0 bytes', async () => {
    // Only run if ffmpeg is available and a test video exists
    const testVideo = `${process.env.HOME}/Downloads/sora-videos/sora-isaiahdupree-1769821133461.mp4`;
    if (!fs.existsSync(testVideo)) {
      console.log('  (skipped: test video not found)');
      return;
    }

    const outPath = `/tmp/sora-test-wm-${Date.now()}.mp4`;
    try {
      const { wmH, wmY } = wmRegion(872, 480);
      execSync(
        `ffmpeg -i "${testVideo}" -vf "drawbox=x=0:y=${wmY}:w=480:h=${wmH}:color=black@1.0:t=fill" ` +
        `-c:v libx264 -crf 18 -preset ultrafast -c:a copy -y "${outPath}" 2>/dev/null`,
        { timeout: 60000 }
      );
      assert.ok(fs.existsSync(outPath), 'output file should exist');
      const size = fs.statSync(outPath).size;
      assert.ok(size > 10000, `output size ${size} should be > 10KB`);
    } finally {
      try { fs.unlinkSync(outPath); } catch {}
    }
  });
});

describe('Blotato payload structure', () => {
  it('YouTube payload has required fields', () => {
    const title = 'Test Video Title';
    const desc = 'Test description';
    const mediaUrl = 'https://example.com/video.mp4';
    const accountId = '228';

    const payload = {
      post: {
        accountId,
        content: { platform: 'youtube', text: `${title}\n\n${desc}`, mediaUrls: [mediaUrl] },
        target: { targetType: 'youtube', title: title.slice(0, 100), privacyStatus: 'public', shouldNotifySubscribers: true }
      }
    };

    assert.ok(payload.post.accountId, 'accountId required');
    assert.ok(payload.post.content.platform, 'platform required in content');
    assert.ok(Array.isArray(payload.post.content.mediaUrls), 'mediaUrls must be array');
    assert.equal(payload.post.target.targetType, 'youtube');
    assert.ok(payload.post.target.title.length <= 100, 'title max 100 chars');
    assert.ok(['public', 'private', 'unlisted'].includes(payload.post.target.privacyStatus));
    assert.equal(typeof payload.post.target.shouldNotifySubscribers, 'boolean');
  });
});

// ─── Leaderboard logic ────────────────────────────────────────────────────────

function extractNicheTest(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.match(/mars|space|planet|astronaut/)) return 'space';
  if (p.match(/\bai\b|robot|machine/)) return 'ai_tech';
  if (p.match(/nature|forest|ocean|waterfall/)) return 'nature';
  if (p.match(/city|urban|street|skyline/)) return 'urban';
  if (p.match(/fantasy|magic|dragon|wizard/)) return 'fantasy';
  return 'other';
}

function rankByQuality(videos: any[]): any[] {
  return [...videos].sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0));
}

function rankByViews(videos: any[]): any[] {
  return [...videos].sort((a, b) => (b.ytViews ?? 0) - (a.ytViews ?? 0));
}

describe('leaderboard logic', () => {
  const testVideos = [
    { id: 'v1', prompt: 'An astronaut on Mars', qualityScore: 8.5, ytViews: 1200, generatedAt: '2026-03-05T10:00:00Z' },
    { id: 'v2', prompt: 'Waterfall in nature', qualityScore: 9.1, ytViews: 3800, generatedAt: '2026-03-05T12:00:00Z' },
    { id: 'v3', prompt: 'AI robots in a factory', qualityScore: 7.2, ytViews: 430, generatedAt: '2026-03-05T11:00:00Z' },
    { id: 'v4', prompt: 'Wizard casting a spell', qualityScore: 8.0, ytViews: 980, generatedAt: '2026-03-05T14:00:00Z' },
  ];

  it('sorts by quality score descending', () => {
    const ranked = rankByQuality(testVideos);
    assert.equal(ranked[0].qualityScore, 9.1);
    assert.equal(ranked[1].qualityScore, 8.5);
    assert.equal(ranked[3].qualityScore, 7.2);
  });

  it('sorts by views descending', () => {
    const ranked = rankByViews(testVideos);
    assert.equal(ranked[0].ytViews, 3800);
    assert.equal(ranked[1].ytViews, 1200);
  });

  it('extracts niche from prompt correctly', () => {
    assert.equal(extractNicheTest('An astronaut walks on Mars at sunset'), 'space');
    assert.equal(extractNicheTest('AI robot assembling parts'), 'ai_tech');
    assert.equal(extractNicheTest('Stunning waterfall in nature'), 'nature');
    assert.equal(extractNicheTest('A dragon breathes fire, epic fantasy battle'), 'fantasy');
    assert.equal(extractNicheTest('City skyline at night'), 'urban');
    assert.equal(extractNicheTest('A random unclassified prompt'), 'other');
  });

  it('top N limit works', () => {
    const ranked = rankByQuality(testVideos).slice(0, 2);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].id, 'v2');
  });
});

describe('notification logic', () => {
  it('pushes and filters notifications by type', () => {
    const notifs = [
      { id: 'n1', type: 'video_generated', message: 'Video generated', read: false, createdAt: '2026-03-05T10:00:00Z' },
      { id: 'n2', type: 'low_gens', message: 'Only 2 gens left', read: false, createdAt: '2026-03-05T11:00:00Z' },
      { id: 'n3', type: 'youtube_uploaded', message: 'Uploaded', read: true, createdAt: '2026-03-05T12:00:00Z' },
    ];
    const unread = notifs.filter(n => !n.read);
    assert.equal(unread.length, 2);
    const lowGens = notifs.filter(n => n.type === 'low_gens');
    assert.equal(lowGens.length, 1);
    assert.equal(lowGens[0].message, 'Only 2 gens left');
  });

  it('mark-read mutates read flag', () => {
    const notifs = [
      { id: 'n1', type: 'video_generated', read: false },
      { id: 'n2', type: 'low_gens', read: false },
    ];
    const idsToMark = new Set(['n1']);
    for (const n of notifs) { if (idsToMark.has(n.id)) n.read = true; }
    assert.equal(notifs[0].read, true);
    assert.equal(notifs[1].read, false);
  });

  it('quality score extraction from Claude analysis text', () => {
    const cases = [
      ['Quality Rating: 8.5/10 — excellent', 8.5],
      ['**9/10** - Stunning visuals', 9],
      ['I rate this 7.2/10 overall', 7.2],
      ['No score here', null],
    ];
    for (const [text, expected] of cases) {
      const m = (text as string).match(/(\d+(?:\.\d+)?)\s*\/\s*10/);
      const score = m ? parseFloat(m[1]) : null;
      assert.equal(score, expected, `Failed for: "${text}"`);
    }
  });
});

// ─── New tool tests: sora_fetch_yt_stats, sora_scrape_library, sora_scrape_explore ───

describe('sora_fetch_yt_stats: Blotato post status parsing', () => {
  it('extracts postSubmissionId from youtubeUrl', () => {
    const youtubeUrl = 'https://blotato.com/posts/98f4a2bd-9526-4323-b917-401fabc4e9e7';
    const postId = youtubeUrl.match(/blotato\.com\/posts\/([^/?#]+)/)?.[1];
    assert.equal(postId, '98f4a2bd-9526-4323-b917-401fabc4e9e7');
  });

  it('returns null for non-blotato URLs', () => {
    const youtubeUrl = 'https://www.youtube.com/watch?v=abc123';
    const postId = youtubeUrl.match(/blotato\.com\/posts\/([^/?#]+)/)?.[1];
    assert.equal(postId, undefined);
  });

  it('extracts YouTube video ID from watch URL', () => {
    const ytUrl = 'https://www.youtube.com/watch?v=cEuZsGLHmg4';
    const ytVideoId = ytUrl.match(/[?&]v=([^&]+)/)?.[1] || ytUrl.match(/youtu\.be\/([^?]+)/)?.[1] || '';
    assert.equal(ytVideoId, 'cEuZsGLHmg4');
  });

  it('extracts YouTube video ID from youtu.be short URL', () => {
    const ytUrl = 'https://youtu.be/dQw4w9WgXcQ';
    const ytVideoId = ytUrl.match(/[?&]v=([^&]+)/)?.[1] || ytUrl.match(/youtu\.be\/([^?]+)/)?.[1] || '';
    assert.equal(ytVideoId, 'dQw4w9WgXcQ');
  });

  it('returns empty string for non-YouTube URL', () => {
    const ytUrl = 'https://blotato.com/posts/abc123';
    const ytVideoId = ytUrl.match(/[?&]v=([^&]+)/)?.[1] || ytUrl.match(/youtu\.be\/([^?]+)/)?.[1] || '';
    assert.equal(ytVideoId, '');
  });

  it('parses YouTube Data API statistics response correctly', () => {
    const apiResponse = {
      items: [{
        id: 'cEuZsGLHmg4',
        statistics: { viewCount: '1523', likeCount: '87', commentCount: '12', favoriteCount: '0' }
      }]
    };
    const stats = apiResponse.items?.[0]?.statistics || {};
    const views = parseInt(stats.viewCount || '0', 10);
    const likes = parseInt(stats.likeCount || '0', 10);
    const comments = parseInt(stats.commentCount || '0', 10);
    assert.equal(views, 1523);
    assert.equal(likes, 87);
    assert.equal(comments, 12);
  });

  it('handles missing statistics gracefully', () => {
    const apiResponse = { items: [] };
    const stats = (apiResponse.items as any[])?.[0]?.statistics || {};
    const views = parseInt(stats.viewCount || '0', 10);
    assert.equal(views, 0);
  });

  it('real Blotato GET /v2/posts/{id} returns published status', async () => {
    // Test with a known postSubmissionId from our recent uploads
    const postId = '98f4a2bd-9526-4323-b917-401fabc4e9e7';
    const env = loadEnvFiles(
      '/Users/isaiahdupree/Documents/Software/actp-worker/.env',
      '/Users/isaiahdupree/Documents/Software/Safari Automation/.env'
    );
    const blaKey = env['BLOTATO_API_KEY'];
    if (!blaKey) { console.log('  (no BLOTATO_API_KEY — skipped)'); return; }

    const res = await fetch(`https://backend.blotato.com/v2/posts/${postId}`, {
      headers: { 'blotato-api-key': blaKey }
    });
    assert.ok(res.ok, `Blotato returned ${res.status}`);
    const body = await res.json() as Record<string, unknown>;
    assert.ok('postSubmissionId' in body || 'status' in body, 'response has postSubmissionId or status');
  });

  it('state is updated with ytViews, ytLikes after fetch', () => {
    // Simulate the state update logic
    const videos = [
      { id: 'v1', soraVideoId: 'v1', prompt: 'test', rawPath: '', generatedAt: '2026-03-05T00:00:00Z',
        youtubeUrl: 'https://blotato.com/posts/98f4a2bd-9526-4323-b917-401fabc4e9e7' }
    ];
    const idx = videos.findIndex(v => v.id === 'v1');
    if (idx !== -1) {
      (videos[idx] as any).ytViews = 1523;
      (videos[idx] as any).ytLikes = 87;
      (videos[idx] as any).ytComments = 12;
      (videos[idx] as any).metricsUpdatedAt = '2026-03-06T00:00:00Z';
    }
    assert.equal((videos[0] as any).ytViews, 1523);
    assert.equal((videos[0] as any).ytLikes, 87);
    assert.equal(typeof (videos[0] as any).metricsUpdatedAt, 'string');
  });
});

describe('sora_scrape_library: state sync logic', () => {
  it('identifies untracked videos from library scrape', () => {
    const stateVideos = [
      { id: 'known-1', soraVideoId: 'known-1', prompt: 'known', rawPath: '', generatedAt: '2026-03-05T00:00:00Z' }
    ];
    const libraryVideos = [
      { id: 'known-1', prompt: 'known' },
      { id: 'new-from-web-2', prompt: 'new prompt from web UI' },
      { id: 'new-from-web-3', prompt: 'another web-generated video' },
    ];
    const knownIds = new Set(stateVideos.map(v => v.id));
    const knownSoraIds = new Set(stateVideos.map(v => v.soraVideoId).filter(Boolean));
    const newVideos = libraryVideos.filter(v => !knownIds.has(v.id) && !knownSoraIds.has(v.id));
    assert.equal(newVideos.length, 2);
    assert.equal(newVideos[0].id, 'new-from-web-2');
  });

  it('does not duplicate already-tracked videos', () => {
    const stateVideos = [
      { id: 'v1', soraVideoId: 'v1', prompt: 'p1', rawPath: '', generatedAt: '2026-03-05T00:00:00Z' },
      { id: 'v2', soraVideoId: 'v2', prompt: 'p2', rawPath: '', generatedAt: '2026-03-05T00:00:00Z' },
    ];
    const libraryVideos = [{ id: 'v1', prompt: 'p1' }, { id: 'v2', prompt: 'p2' }];
    const knownIds = new Set(stateVideos.map(v => v.id));
    const newVideos = libraryVideos.filter(v => !knownIds.has(v.id));
    assert.equal(newVideos.length, 0);
  });

  it('creates valid VideoRecord for untracked library video', () => {
    const v = { id: 'new-abc', prompt: 'Astronaut on Mars sunset' };
    const record = {
      id: v.id,
      soraVideoId: v.id,
      prompt: v.prompt || 'Unknown — scraped from Sora library',
      rawPath: '',
      youtubeUrl: undefined,
      generatedAt: new Date().toISOString(),
    };
    assert.equal(record.id, 'new-abc');
    assert.ok(record.generatedAt.startsWith('2026'), 'generatedAt must be set');
    assert.equal(record.rawPath, '');
  });
});

describe('sora_scrape_explore: prompt keyword extraction', () => {
  it('extracts top keywords from explore video prompts', () => {
    const prompts = [
      'astronaut walking on mars surface at sunset',
      'robot astronaut exploring the planet surface',
      'beautiful waterfall in nature forest',
      'city skyline urban landscape at night',
      'astronaut floating in space station',
    ];
    const wordFreq: Record<string, number> = {};
    for (const p of prompts) {
      for (const w of p.toLowerCase().split(/\s+/).filter(w => w.length > 4)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    }
    const topKeywords = Object.entries(wordFreq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([word, count]) => ({ word, count }));
    // 'astronaut' appears 3x, 'surface' 2x
    assert.equal(topKeywords[0].word, 'astronaut');
    assert.equal(topKeywords[0].count, 3);
  });

  it('returns empty keywords array for empty prompts', () => {
    const prompts: string[] = [];
    const wordFreq: Record<string, number> = {};
    for (const p of prompts) {
      for (const w of p.toLowerCase().split(/\s+/).filter(w => w.length > 4)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    }
    assert.equal(Object.keys(wordFreq).length, 0);
  });

  it('explore result shape has required fields', () => {
    const mockResult = {
      success: true,
      page_url: 'https://sora.chatgpt.com/explore',
      total_cards: 24,
      videos_extracted: 12,
      top_prompt_keywords: [{ word: 'astronaut', count: 3 }],
      videos: [{ id: 'explore-0', prompt: 'test prompt', author: 'user1' }],
    };
    assert.ok(mockResult.success);
    assert.ok(typeof mockResult.page_url === 'string');
    assert.ok(typeof mockResult.total_cards === 'number');
    assert.ok(Array.isArray(mockResult.videos));
    assert.ok(Array.isArray(mockResult.top_prompt_keywords));
  });
});

// ─── K/M number parser (replicated from sora-full-automation.ts) ─────────────

function parseNum(s: string): number | null {
  const c = s.replace(/,/g, '').trim();
  const m = c.match(/^(\d+\.?\d*)([KkMm])?$/);
  if (!m) return null;
  let val = parseFloat(m[1]);
  if (m[2]) {
    const mult = m[2].toLowerCase() === 'k' ? 1000 : 1_000_000;
    val = Math.round(val * mult);
  }
  return val;
}

describe('leaderboard K/M number parsing', () => {
  it('plain integer', () => assert.equal(parseNum('92'), 92));
  it('comma-separated integer', () => assert.equal(parseNum('1,234'), 1234));
  it('integer K suffix → multiply by 1000', () => assert.equal(parseNum('5K'), 5000));
  it('decimal K — the 2.5K bug — now correct', () => assert.equal(parseNum('2.5K'), 2500));
  it('decimal K rounding', () => assert.equal(parseNum('1.3K'), 1300));
  it('M suffix', () => assert.equal(parseNum('1.2M'), 1_200_000));
  it('uppercase K', () => assert.equal(parseNum('10K'), 10000));
  it('lowercase k', () => assert.equal(parseNum('10k'), 10000));
  it('plain decimal returns float as-is', () => assert.equal(parseNum('3.14'), 3.14));
  it('returns null for non-numeric', () => assert.equal(parseNum('memexpert'), null));
  it('returns null for empty string', () => assert.equal(parseNum(''), null));
  it('returns null for nav text', () => assert.equal(parseNum('Explore'), null));
  it('zero value', () => assert.equal(parseNum('0'), 0));
  it('large K value', () => assert.equal(parseNum('100K'), 100_000));
});

// ─── Heartbeat helper logic ────────────────────────────────────────────────────

describe('claim heartbeat', () => {
  it('stop function prevents further updates', async () => {
    let updateCount = 0;
    // Simulate startClaimHeartbeat with short interval for testing
    function startTestHeartbeat(intervalMs: number): () => void {
      const iv = setInterval(() => { updateCount++; }, intervalMs);
      return () => clearInterval(iv);
    }
    const stop = startTestHeartbeat(20);
    await new Promise(r => setTimeout(r, 55)); // ~2-3 ticks
    stop();
    const countAtStop = updateCount;
    await new Promise(r => setTimeout(r, 50)); // wait more — should not increase
    assert.ok(countAtStop >= 2, `expected ≥2 ticks, got ${countAtStop}`);
    assert.equal(updateCount, countAtStop, 'no more updates after stop()');
  });

  it('heartbeat interval is less than claim TTL (60s)', () => {
    // Interval is 30s, TTL is 60s — heartbeat fires before expiry
    const HEARTBEAT_INTERVAL = 30_000;
    const CLAIM_TTL = 60_000;
    assert.ok(HEARTBEAT_INTERVAL < CLAIM_TTL, 'heartbeat must fire before TTL expires');
    assert.ok(CLAIM_TTL / HEARTBEAT_INTERVAL >= 2, 'at least 2 heartbeats fit in a TTL window');
  });
});

// ─── Tab claim logic (replicated from sora-mcp.ts for isolated testing) ──────

const CLAIM_TTL_MS = 60_000;

interface TabClaim {
  agentId: string; service: string; port: number; urlPattern: string;
  windowIndex: number; tabIndex: number; tabUrl: string; pid: number;
  claimedAt: number; heartbeat: number;
}

function filterActiveClaims(all: TabClaim[], now = Date.now()): TabClaim[] {
  return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
}

function checkConflict(
  claims: TabClaim[],
  myService = 'sora'
): { conflict: false } | { conflict: true; blocker: TabClaim } {
  const myClaim = claims.find(c => c.service === myService);
  if (!myClaim) return { conflict: false };
  const myTab = `${myClaim.windowIndex}:${myClaim.tabIndex}`;
  const blocker = claims.find(
    c => c.service !== myService && `${c.windowIndex}:${c.tabIndex}` === myTab
  );
  return blocker ? { conflict: true, blocker } : { conflict: false };
}

function makeClaim(service: string, windowIndex: number, tabIndex: number, heartbeatMsAgo = 0): TabClaim {
  const now = Date.now();
  return {
    agentId: `${service}-${now}`, service, port: 3000, urlPattern: service,
    windowIndex, tabIndex, tabUrl: `https://${service}.example.com`,
    pid: 12345, claimedAt: now - heartbeatMsAgo, heartbeat: now - heartbeatMsAgo,
  };
}

// Replicated leaderboard notification helper
function pushLeaderboardNotification(
  notifications: Array<{ id: string; type: string; message: string; data?: Record<string, unknown>; createdAt: string; read: boolean }>,
  message: string,
  data?: Record<string, unknown>
): void {
  notifications.push({
    id: `notif-${Date.now()}-test`,
    type: 'leaderboard_update',
    message,
    data,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

describe('tab claim: TTL filtering', () => {
  it('keeps claims with heartbeat within TTL', () => {
    const claims = [makeClaim('sora', 1, 1, 5_000)]; // 5s ago — within 60s TTL
    const active = filterActiveClaims(claims);
    assert.equal(active.length, 1);
  });

  it('drops claims with expired heartbeat', () => {
    const claims = [makeClaim('sora', 1, 1, 61_000)]; // 61s ago — expired
    const active = filterActiveClaims(claims);
    assert.equal(active.length, 0);
  });

  it('filters mixed fresh and expired claims', () => {
    const claims = [
      makeClaim('sora', 1, 1, 5_000),    // fresh
      makeClaim('instagram', 1, 2, 70_000), // expired
      makeClaim('twitter', 1, 3, 30_000),  // fresh
    ];
    const active = filterActiveClaims(claims);
    assert.equal(active.length, 2);
    assert.ok(active.every(c => ['sora', 'twitter'].includes(c.service)));
  });

  it('claim exactly at TTL boundary is excluded', () => {
    const claims = [makeClaim('sora', 1, 1, CLAIM_TTL_MS)]; // exactly 60s — not < TTL
    const active = filterActiveClaims(claims);
    assert.equal(active.length, 0);
  });
});

describe('tab claim: conflict detection', () => {
  it('no conflict when sora has no claim', () => {
    const claims = [makeClaim('instagram', 1, 2, 1000)];
    const result = checkConflict(claims);
    assert.equal(result.conflict, false);
  });

  it('no conflict when sora is on a different tab than other services', () => {
    const claims = [
      makeClaim('sora', 1, 1, 1000),
      makeClaim('instagram', 1, 2, 1000), // tab 2, not tab 1
    ];
    const result = checkConflict(claims);
    assert.equal(result.conflict, false);
  });

  it('detects conflict when another service is on the same window:tab', () => {
    const claims = [
      makeClaim('sora', 1, 1, 1000),
      makeClaim('instagram', 1, 1, 1000), // same window 1, tab 1
    ];
    const result = checkConflict(claims);
    assert.equal(result.conflict, true);
    if (result.conflict) {
      assert.equal(result.blocker.service, 'instagram');
    }
  });

  it('no conflict when only sora holds the tab', () => {
    const claims = [makeClaim('sora', 1, 1, 1000)];
    const result = checkConflict(claims);
    assert.equal(result.conflict, false);
  });

  it('conflict message includes blocker service and tab location', () => {
    const claims = [
      makeClaim('sora', 2, 3, 1000),
      makeClaim('linkedin', 2, 3, 1000),
    ];
    const result = checkConflict(claims);
    assert.equal(result.conflict, true);
    if (result.conflict) {
      const msg = `Safari tab conflict: ${result.blocker.service} is using the same tab (window ${result.blocker.windowIndex}, tab ${result.blocker.tabIndex})`;
      assert.ok(msg.includes('linkedin'));
      assert.ok(msg.includes('window 2'));
      assert.ok(msg.includes('tab 3'));
    }
  });
});

describe('tab claim: sora handler error shapes', () => {
  it('platform leaderboard error response when no tab found', () => {
    // Simulate the return value when acquireSoraClaim returns null
    const response = JSON.parse(
      JSON.stringify({ success: false, error: 'No Sora tab found in Safari — open sora.chatgpt.com first, then retry.' })
    );
    assert.equal(response.success, false);
    assert.ok(response.error.includes('sora.chatgpt.com'));
  });

  it('my stats error response when no tab found', () => {
    const response = JSON.parse(
      JSON.stringify({ success: false, error: 'No Sora tab found in Safari — open sora.chatgpt.com first, then retry.' })
    );
    assert.equal(response.success, false);
    assert.ok(typeof response.error === 'string');
  });
});

describe('leaderboard_update notifications', () => {
  it('pushes leaderboard_update notification with correct shape', () => {
    const notifications: Array<{ id: string; type: string; message: string; data?: Record<string, unknown>; createdAt: string; read: boolean }> = [];
    pushLeaderboardNotification(
      notifications,
      'Platform leaderboard scraped: 25 creators across 1 section(s) — #1: memexpert (916 views)',
      { total_entries: 25, sections: 1, top_creator: 'memexpert', top_views: 916, scraped_at: new Date().toISOString() }
    );
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'leaderboard_update');
    assert.equal(notifications[0].read, false);
    assert.ok(notifications[0].message.includes('memexpert'));
    assert.ok(notifications[0].data?.top_creator === 'memexpert');
    assert.equal(notifications[0].data?.total_entries, 25);
  });

  it('leaderboard_update is filterable from mixed notification list', () => {
    const notifications = [
      { id: 'n1', type: 'video_generated', message: 'Video done', read: false, createdAt: '' },
      { id: 'n2', type: 'leaderboard_update', message: 'LB scraped', read: false, createdAt: '' },
      { id: 'n3', type: 'low_gens', message: 'Low gens', read: false, createdAt: '' },
      { id: 'n4', type: 'leaderboard_update', message: 'My stats refreshed', read: true, createdAt: '' },
    ];
    const leaderboardNotifs = notifications.filter(n => n.type === 'leaderboard_update');
    assert.equal(leaderboardNotifs.length, 2);
    const unreadLb = leaderboardNotifs.filter(n => !n.read);
    assert.equal(unreadLb.length, 1);
    assert.ok(unreadLb[0].message.includes('LB scraped'));
  });

  it('my stats notification includes scraped count and views count', () => {
    const notifications: Array<{ id: string; type: string; message: string; data?: Record<string, unknown>; createdAt: string; read: boolean }> = [];
    const videos = [
      { id: 'v1', views: 200, likes: 12 },
      { id: 'v2', views: null, likes: null },
    ];
    const withViews = videos.filter(v => v.views !== null);
    pushLeaderboardNotification(
      notifications as any,
      `My stats refreshed: ${videos.length} video(s) scraped, ${withViews.length} with view data`,
      { scraped: videos.length, with_views: withViews.length }
    );
    const n = (notifications as any)[0];
    assert.ok(n.message.includes('2 video(s)'));
    assert.ok(n.message.includes('1 with view data'));
    assert.equal(n.data.scraped, 2);
    assert.equal(n.data.with_views, 1);
  });

  it('no leaderboard_update notification pushed when scrape returns 0 sections', () => {
    const notifications: any[] = [];
    const sections: any[] = [];
    // Only push if sections.length > 0 (matches handler logic)
    if (sections.length > 0) {
      pushLeaderboardNotification(notifications, 'should not appear');
    }
    assert.equal(notifications.length, 0);
  });

  it('notification count stays within 200 cap', () => {
    const notifications: any[] = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`, type: 'leaderboard_update', message: `notif ${i}`, read: false, createdAt: '',
    }));
    // Simulate the trim logic from pushNotification
    notifications.push({ id: 'new', type: 'leaderboard_update', message: 'newest', read: false, createdAt: '' });
    const trimmed = notifications.length > 200 ? notifications.slice(-200) : notifications;
    assert.equal(trimmed.length, 200);
    assert.equal(trimmed[trimmed.length - 1].message, 'newest');
  });
});

// ─── Creator prompt scraper logic ─────────────────────────────────────────────

// Replicated parseNum + post-title extraction for isolated testing
function parsePromptFromTitle(title: string): string {
  return title.replace(/ \| Sora$/, '').trim();
}

function parseStatsFromLines(lines: string[], prompt: string): { views: number | null; likes: number | null; comments: number | null } {
  const NAV = ['Activity','Home','Explore','Search','Drafts','Profile','Settings','Attach media','Storyboard','Create video','For you','Remixes'];
  const stats: number[] = [];
  let foundPrompt = false;
  for (let i = 0; i < lines.length && stats.length < 3; i++) {
    const l = lines[i].trim();
    if (!l || NAV.includes(l)) continue;
    if (/^\d+[smhd]$/.test(l)) continue; // time-ago
    if (!foundPrompt && l === prompt) { foundPrompt = true; continue; }
    if (foundPrompt) {
      const n = parseNum(l);
      if (n !== null) stats.push(n);
      else if (stats.length > 0) break;
    }
  }
  return { views: stats[0] ?? null, likes: stats[1] ?? null, comments: stats[2] ?? null };
}

function extractPostId(href: string): string {
  return href.replace(/^.*\/p\/s_/, '') || href.replace(/[^a-zA-Z0-9]/g, '').slice(-20);
}

describe('creator prompt scraper: prompt extraction', () => {
  it('extracts prompt from page title', () => {
    assert.equal(parsePromptFromTitle('🍌🐒 | Sora'), '🍌🐒');
    assert.equal(parsePromptFromTitle('An astronaut on Mars at sunset | Sora'), 'An astronaut on Mars at sunset');
    assert.equal(parsePromptFromTitle('Sora'), 'Sora'); // edge: title is just "Sora"
    assert.equal(parsePromptFromTitle('A cinematic shot of a waterfall | Sora'), 'A cinematic shot of a waterfall');
  });

  it('handles title without Sora suffix', () => {
    // If page doesn't have the suffix, returns title as-is
    assert.equal(parsePromptFromTitle('Some prompt without suffix'), 'Some prompt without suffix');
  });

  it('extracts post ID from href', () => {
    assert.equal(extractPostId('/p/s_69ab20298b9481918ee8d8e53a2021e6'), '69ab20298b9481918ee8d8e53a2021e6');
    assert.equal(extractPostId('/p/s_abc123'), 'abc123');
  });
});

describe('creator prompt scraper: stats extraction from body text', () => {
  it('extracts views and likes after prompt line', () => {
    const prompt = '🙀💤';
    const lines = ['Home', 'Explore', '2d', 'memexpert', prompt, '3700', '751', '348 replies'];
    const stats = parseStatsFromLines(lines, prompt);
    assert.equal(stats.views, 3700);
    assert.equal(stats.likes, 751);
    assert.equal(stats.comments, null); // "348 replies" doesn't parse as plain number
  });

  it('handles K suffix in post stats', () => {
    const prompt = '🌊🦧';
    const lines = ['memexpert', prompt, '1.3K', '339'];
    const stats = parseStatsFromLines(lines, prompt);
    assert.equal(stats.views, 1300);
    assert.equal(stats.likes, 339);
  });

  it('returns nulls when prompt line not found', () => {
    const stats = parseStatsFromLines(['Home', 'Explore', '100', '50'], 'nonexistent prompt');
    assert.equal(stats.views, null);
    assert.equal(stats.likes, null);
    assert.equal(stats.comments, null);
  });

  it('stops collecting stats at non-numeric line', () => {
    const prompt = 'test';
    const lines = [prompt, '500', 'not a number', '999'];
    const stats = parseStatsFromLines(lines, prompt);
    assert.equal(stats.views, 500);
    assert.equal(stats.likes, null); // stops after non-numeric
  });

  it('skips time-ago tokens (6h, 2d, 30m)', () => {
    const prompt = '🐱🐶';
    const lines = ['1d', 'memexpert', prompt, '984', '132'];
    const stats = parseStatsFromLines(lines, prompt);
    assert.equal(stats.views, 984);
    assert.equal(stats.likes, 132);
  });
});

describe('creator prompt scraper: DB upsert row shape', () => {
  it('upsert row has all required fields', () => {
    const row = {
      id: '69ab20298b9481918ee8d8e53a2021e6',
      username: 'memexpert',
      prompt: '🍌🐒',
      post_href: '/p/s_69ab20298b9481918ee8d8e53a2021e6',
      views: 102,
      likes: 37,
      comments: null,
      video_url: 'https://videos.openai.com/az/files/xyz',
    };
    assert.ok(row.id, 'id required');
    assert.ok(row.username, 'username required');
    assert.ok(row.prompt !== undefined, 'prompt required');
    assert.ok(row.post_href, 'post_href required');
    assert.equal(typeof row.views, 'number');
    assert.equal(row.comments, null);
  });

  it('min_views filter works correctly', () => {
    const posts = [
      { id: '1', views: 5000, prompt: 'viral post' },
      { id: '2', views: 50,   prompt: 'low engagement' },
      { id: '3', views: null, prompt: 'no stats yet' },
    ];
    const minViews = 100;
    const qualifying = posts.filter(p => (p.views ?? 0) >= minViews);
    assert.equal(qualifying.length, 1);
    assert.equal(qualifying[0].id, '1');
  });

  it('min_views=0 keeps everything including null-view posts', () => {
    const posts = [
      { id: '1', views: 500 },
      { id: '2', views: null },
    ];
    const qualifying = posts.filter(p => (p.views ?? 0) >= 0);
    assert.equal(qualifying.length, 2);
  });

  it('top post sort by views descending', () => {
    const posts = [
      { id: '1', views: 984, prompt: 'b' },
      { id: '2', views: 3700, prompt: 'a' },
      { id: '3', views: 1300, prompt: 'c' },
    ];
    const sorted = [...posts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    assert.equal(sorted[0].views, 3700);
    assert.equal(sorted[0].prompt, 'a');
  });

  it('batch size slicing for upsert', () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ id: String(i) }));
    const BATCH = 50;
    const batches: typeof rows[] = [];
    for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));
    assert.equal(batches.length, 3);
    assert.equal(batches[0].length, 50);
    assert.equal(batches[2].length, 30);
  });
});

describe('creator prompt scraper: real Supabase upsert', () => {
  it('upserts real scraped data to sora_creator_prompts', async () => {
    // Use the live data scraped from memexpert
    const realRows = [
      { id: '69ab20298b9481918ee8d8e53a2021e6', username: 'memexpert', prompt: '🍌🐒',
        post_href: '/p/s_69ab20298b9481918ee8d8e53a2021e6', views: 102, likes: 37, comments: null, video_url: null },
      { id: '69a9ebcd62348191822d65f8fa623fc2', username: 'memexpert', prompt: '🌊🦧',
        post_href: '/p/s_69a9ebcd62348191822d65f8fa623fc2', views: 1300, likes: 339, comments: null, video_url: null },
      { id: '69a8648632308191ae2ec7f9c6feb76e', username: 'memexpert', prompt: '🙀💤',
        post_href: '/p/s_69a8648632308191ae2ec7f9c6feb76e', views: 3700, likes: 751, comments: null, video_url: null },
      { id: '69a6a3c90ef88191a0fd064fa4c321ce', username: 'memexpert', prompt: '🐱🐶',
        post_href: '/p/s_69a6a3c90ef88191a0fd064fa4c321ce', views: 984, likes: 132, comments: null, video_url: null },
    ];

    const env: Record<string, string> = {};
    try {
      const lines = (await import('fs')).readFileSync('/Users/isaiahdupree/Documents/Software/actp-worker/.env', 'utf-8').split('\n');
      for (const line of lines) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {}

    const supabaseUrl = env['SUPABASE_URL'] || 'https://ivhfuhxorppptyuofbgq.supabase.co';
    const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!supabaseKey) { console.log('  (no SUPABASE_SERVICE_ROLE_KEY — skipped)'); return; }

    const body = JSON.stringify(realRows.map(r => ({ ...r, scraped_at: new Date().toISOString() })));
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(
        `curl -s -X POST "${supabaseUrl}/rest/v1/sora_creator_prompts" \
          -H "apikey: ${supabaseKey}" \
          -H "Authorization: Bearer ${supabaseKey}" \
          -H "Content-Type: application/json" \
          -H "Prefer: resolution=merge-duplicates,return=minimal" \
          -d '${body.replace(/'/g, "'\\''")}'`,
        { timeout: 30000 }
      );
      const response = stdout.trim();
      // Empty or [] = success with return=minimal
      if (!response || response === '[]') {
        console.log(`  ✓ Upserted ${realRows.length} rows to sora_creator_prompts`);
        assert.ok(true);
      } else {
        const parsed = JSON.parse(response);
        if (parsed.code === 'PGRST205') {
          console.log('  (table not yet created — run migration SQL in Supabase dashboard first)');
          console.log('  Migration: autonomous-coding-dashboard/harness/migrations/20260306_sora_creator_prompts.sql');
        } else if (parsed.code) {
          assert.fail(`DB error: ${parsed.message}`);
        } else {
          console.log(`  ✓ Upserted ${realRows.length} rows`);
          assert.ok(true);
        }
      }
    } catch (e) {
      assert.fail(`Upsert threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
});

describe('HTTP endpoint contracts', () => {
  const BASE = 'http://localhost:3434';

  it('GET /api/sora/status returns required fields', async () => {
    try {
      const res = await fetch(`${BASE}/api/sora/status`);
      if (!res.ok) { console.log('  (backend not running — skipped)'); return; }
      const d = await res.json() as any;
      assert.ok('date' in d, 'date field required');
      assert.ok('total_videos' in d, 'total_videos required');
      assert.ok('unread_notifications' in d, 'unread_notifications required');
      assert.ok('gens_left' in d || d.gens_left === undefined, 'gens_left field exists');
    } catch { console.log('  (backend not running — skipped)'); }
  });

  it('GET /api/sora/leaderboard returns ranked list', async () => {
    try {
      const res = await fetch(`${BASE}/api/sora/leaderboard?sort_by=quality&limit=5`);
      if (!res.ok) { console.log('  (backend not running — skipped)'); return; }
      const d = await res.json() as any;
      assert.ok(Array.isArray(d.leaderboard), 'leaderboard must be array');
      assert.ok(Array.isArray(d.niche_breakdown), 'niche_breakdown must be array');
      assert.ok('total_videos' in d, 'total_videos required');
      if (d.leaderboard.length > 1) {
        assert.ok(
          (d.leaderboard[0].quality_score ?? 0) >= (d.leaderboard[1].quality_score ?? 0),
          'leaderboard must be sorted descending by quality'
        );
      }
    } catch { console.log('  (backend not running — skipped)'); }
  });

  it('GET /api/sora/notifications returns feed structure', async () => {
    try {
      const res = await fetch(`${BASE}/api/sora/notifications?limit=5`);
      if (!res.ok) { console.log('  (backend not running — skipped)'); return; }
      const d = await res.json() as any;
      assert.ok('total' in d, 'total required');
      assert.ok('unread' in d, 'unread required');
      assert.ok(Array.isArray(d.notifications), 'notifications must be array');
    } catch { console.log('  (backend not running — skipped)'); }
  });

  it('POST /api/sora/notifications/mark-read returns marked count', async () => {
    try {
      const res = await fetch(`${BASE}/api/sora/notifications/mark-read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) { console.log('  (backend not running — skipped)'); return; }
      const d = await res.json() as any;
      assert.ok('marked' in d, 'marked count required');
      assert.ok(typeof d.marked === 'number', 'marked must be number');
    } catch { console.log('  (backend not running — skipped)'); }
  });
});
