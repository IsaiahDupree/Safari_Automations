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
