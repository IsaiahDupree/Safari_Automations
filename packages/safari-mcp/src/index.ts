#!/usr/bin/env node
/**
 * Safari Automation MCP Server
 * =============================
 * Exposes all 4 Safari automation test capabilities as MCP tools:
 *   1. send_dm         — DM a user on Instagram / Twitter / TikTok / LinkedIn
 *   2. post_comment    — Comment on a feed post (IG / Twitter / TikTok / Threads)
 *   3. market_research — Sync keyword search, returns first-post stats immediately
 *   4. competitor_research — Async niche job, polls until done, returns top creators
 *
 * Port map (canonical — matches SAFARI-AUTOMATION-TESTING-PLAYBOOK.md):
 *   DM services:
 *     instagram  → 3100   POST /api/messages/send-to
 *     twitter    → 3003   POST /api/twitter/messages/send-to
 *     tiktok     → 3102   POST /api/tiktok/messages/send-to
 *     linkedin   → 3105   POST /api/linkedin/messages/send-to
 *   Comment services:
 *     instagram  → 3005   POST /api/instagram/comments/post
 *     twitter    → 3007   POST /api/twitter/comments/post
 *     tiktok     → 3006   POST /api/tiktok/comments/post
 *     threads    → 3004   POST /api/threads/comments/post
 *   Market Research hub:
 *     all        → 3106   POST /api/research/:platform/search  (sync)
 *                         POST /api/research/:platform/niche   (async, returns jobId)
 *                         GET  /api/research/status/:jobId     (poll)
 *
 * Usage (stdio transport — for Claude Desktop / Windsurf MCP):
 *   npx tsx src/index.ts
 *   node dist/index.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

// ─── Platform config ──────────────────────────────────────────────────────────

const DM_CONFIG: Record<string, { port: number; path: string }> = {
  instagram: { port: 3001, path: '/api/messages/send-to' },  // 3100 has auth; 3001 is open
  twitter:   { port: 3003, path: '/api/twitter/messages/send-to' },
  tiktok:    { port: 3102, path: '/api/tiktok/messages/send-to' },
  linkedin:  { port: 3105, path: '/api/linkedin/messages/send-to' },
};

const COMMENT_CONFIG: Record<string, { port: number; path: string }> = {
  instagram: { port: 3005, path: '/api/instagram/comments/post' },
  twitter:   { port: 3007, path: '/api/twitter/comments/post' },
  tiktok:    { port: 3006, path: '/api/tiktok/comments/post' },
  threads:   { port: 3004, path: '/api/threads/comments/post' },
};

const DM_SESSION_PORTS: Record<string, number> = {
  instagram: 3100,
  twitter:   3003,
  tiktok:    3102,
  linkedin:  3105,
};

const RESEARCH_PORT = 3106;
const RESEARCH_BASE = `http://localhost:${RESEARCH_PORT}`;

async function httpCall(
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function dmServiceCall(
  platform: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const port = DM_SESSION_PORTS[platform.toLowerCase()];
  if (!port) throw new Error(`Unknown DM platform '${platform}'. Supported: ${Object.keys(DM_SESSION_PORTS).join(', ')}`);
  return httpCall(`http://localhost:${port}${path}`, method, body);
}

async function pollJob(jobId: string, maxWaitMs = 120_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const status = await httpCall(`${RESEARCH_BASE}/api/research/status/${jobId}`) as Record<string, unknown>;
    if (['completed', 'failed', 'error'].includes(status.status as string)) return status;
    await new Promise(r => setTimeout(r, 3000));
  }
  return { status: 'timeout', error: `Job ${jobId} did not complete within ${maxWaitMs / 1000}s` };
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS: Tool[] = [

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYBOOK TEST 1 — DM on All Platforms
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_send_dm',
    description: [
      'Send a direct message (DM) to a user via Safari automation.',
      '',
      'Platforms & ports:',
      '  instagram (3100) — navigates to profile, clicks Message, types and sends',
      '  twitter   (3003) — profile Message button → inbox compose fallback for restricted accounts',
      '  tiktok    (3102) — inbox search → profile fallback → compose-new fallback',
      '  linkedin  (3105) — profile Message button',
      '',
      'Returns: { success, verified, verifiedRecipient, strategy, rateLimits }',
      '',
      'Rate limits are enforced per-service. If a target has DMs restricted,',
      'the service automatically falls back to inbox compose flow (Twitter/TikTok).',
      '',
      'Example: dm("instagram", "sarah_ashley_hunt", "Hey Sarah!")',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok', 'linkedin'],
          description: 'Platform to send the DM on.',
        },
        username: {
          type: 'string',
          description: 'Target username without @ (e.g. "sarah_ashley_hunt").',
        },
        text: {
          type: 'string',
          description: 'Message text to send.',
        },
      },
      required: ['platform', 'username', 'text'],
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYBOOK TEST 2 — Comment on a Feed Post
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_post_comment',
    description: [
      'Post a comment on a social media feed post via Safari automation.',
      '',
      'Platforms & ports:',
      '  instagram (3005) — navigates to post URL, finds comment input, types + submits',
      '  twitter   (3007) — navigates to tweet, clicks reply, types + submits; supports useAI=true',
      '  tiktok    (3006) — navigates to direct video URL (required), comments below video',
      '  threads   (3004) — navigates to post URL, comments',
      '',
      'Twitter supports AI-generated comments: set useAI=true and omit text.',
      '',
      'TikTok REQUIRES a direct video URL like:',
      '  https://www.tiktok.com/@username/video/1234567890123456789',
      '',
      'Returns: { success, commentId } or { success: false, error }',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok', 'threads'],
          description: 'Platform to comment on.',
        },
        postUrl: {
          type: 'string',
          description: 'Full URL of the post to comment on.',
        },
        text: {
          type: 'string',
          description: 'Comment text. Optional if useAI=true (Twitter only).',
        },
        useAI: {
          type: 'boolean',
          description: 'Twitter only: let GPT-4o write the comment automatically.',
          default: false,
        },
      },
      required: ['platform', 'postUrl'],
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYBOOK TEST 3 — Market Research: 1 Keyword, First Post Stats
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_market_research',
    description: [
      'Run a synchronous keyword search on a platform and return first-post engagement stats.',
      '',
      'Navigates Safari to the platform search for the given keyword,',
      'extracts the first visible post(s), and returns immediately.',
      'No long scroll — fast single-pass extraction.',
      '',
      'All platforms hit the Market Research hub at port 3106.',
      'Supported platforms: instagram, twitter, tiktok, threads',
      '',
      'Returns:',
      '  { posts: [{ author, likes, views, comments, shares, url, text }], count }',
      '',
      'Use competitor_research for deeper niche analysis with top-creator ranking.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok', 'threads'],
          description: 'Platform to search on.',
        },
        keyword: {
          type: 'string',
          description: 'Search keyword or phrase (e.g. "ai automation", "solopreneur").',
        },
        maxPosts: {
          type: 'number',
          description: 'Max posts to extract (default 5). Keep low for speed.',
          default: 5,
        },
      },
      required: ['platform', 'keyword'],
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // PLAYBOOK TEST 4 — Competitor Research: Top Creators (Async)
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_competitor_research',
    description: [
      'Run a full niche research job and return the top creators with engagement data.',
      '',
      'This is an ASYNC operation: starts a background job, polls until complete,',
      'and returns the top creators list (with post counts and engagement scores).',
      'Polling timeout is 120 seconds — increase maxWaitSeconds for large niches.',
      '',
      'All platforms hit the Market Research hub at port 3106.',
      'Supported platforms: instagram, twitter, tiktok, threads',
      '',
      'Request shape sent to service:',
      '  { niche, config: { creatorsPerNiche, postsPerNiche, maxScrollsPerSearch } }',
      '',
      'Returns:',
      '  { niche, topCreators: [{ handle, totalEngagement, topPost, postCount }] }',
      '',
      'Example: competitor_research("twitter", "solopreneur", maxCreators=5)',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok', 'threads'],
          description: 'Platform to run niche research on.',
        },
        niche: {
          type: 'string',
          description: 'Niche/keyword to research (e.g. "ai automation", "solopreneur").',
        },
        maxCreators: {
          type: 'number',
          description: 'Number of top creators to return (default 5).',
          default: 5,
        },
        maxPosts: {
          type: 'number',
          description: 'Posts to collect per niche before ranking (default 50).',
          default: 50,
        },
        maxWaitSeconds: {
          type: 'number',
          description: 'Max seconds to wait for job completion (default 120).',
          default: 120,
        },
      },
      required: ['platform', 'niche'],
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK — Verify all services
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_health_check',
    description: [
      'Check which Safari automation services are running and healthy.',
      '',
      'Polls /health on every known service port and returns a summary.',
      'Use this first when debugging: a failing tool usually means its service is down.',
      '',
      'Start missing services with:',
      '  cd "Safari Automation"',
      '  PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts &',
      '  PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts &',
      '  PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &',
      '  PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts &',
      '  PORT=3005 npx tsx packages/instagram-comments/src/api/server.ts &',
      '  SAFARI_RESEARCH_ENABLED=true PORT=3007 npx tsx packages/twitter-comments/src/api/server.ts &',
      '  PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &',
      '  PORT=3004 npx tsx packages/threads-comments/src/api/server.ts &',
      '  PORT=3106 npx tsx packages/market-research/src/api/server.ts &',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ════════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT (DM services)
  // ════════════════════════════════════════════════════════════════════════════
  {
    name: 'safari_session_ensure',
    description: [
      'Ensure the Safari browser has the correct tab active for a given platform BEFORE running any automation.',
      '',
      'Scans all open Safari windows and tabs, finds the one matching the platform URL',
      '(e.g. instagram.com, twitter.com), brings it to front, and locks it as the active session.',
      '',
      'Self-healing: if the tracked tab has navigated away or been closed, it automatically',
      're-scans and re-locks the correct tab. If no matching tab exists, it navigates the',
      'front document to the platform URL.',
      '',
      'Call this at the start of any workflow involving Safari automation.',
      'All other safari_* tools call this automatically — you only need to call it explicitly',
      'when you want to pre-warm the session or diagnose session issues.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok'],
          description: 'The platform whose Safari tab should be activated.',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'safari_session_status',
    description: [
      'Get the current Safari session status for a platform without activating anything.',
      '',
      'Returns which window + tab index is currently tracked, the URL pattern in use,',
      'and how recently the session was last verified.',
      '',
      'Use this to check if a session is already active before starting a workflow,',
      'or to diagnose why automation is running on the wrong page.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok'],
          description: 'The platform to check.',
        },
      },
      required: ['platform'],
    },
  },
  {
    name: 'safari_session_clear',
    description: [
      'Clear the tracked Safari session for a platform.',
      '',
      'Forces the next operation to do a full window/tab scan instead of reusing the cached tab.',
      '',
      'Use this after:',
      '  - Restarting Safari',
      '  - Logging out and back into a platform',
      '  - Moving tabs between windows',
      '  - Any situation where the automation seems to be targeting the wrong tab',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'twitter', 'tiktok'],
          description: 'The platform session to clear.',
        },
      },
      required: ['platform'],
    },
  },

  // ── Reading / inbox utilities ───────────────────────────────────────────────
  {
    name: 'safari_get_conversations',
    description: 'List DM conversations visible in the inbox for a platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['instagram', 'twitter', 'tiktok'] },
      },
      required: ['platform'],
    },
  },
  {
    name: 'safari_navigate_inbox',
    description: 'Navigate Safari to the DM inbox for a platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['instagram', 'twitter', 'tiktok'] },
      },
      required: ['platform'],
    },
  },
  {
    name: 'safari_execute_js',
    description: [
      'Execute arbitrary JavaScript in the active Safari tab (ADVANCED — for debugging).',
      'Returns the JS result as a string.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['instagram', 'twitter', 'tiktok'] },
        script:   { type: 'string', description: 'JS expression or IIFE to execute.' },
      },
      required: ['platform', 'script'],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const platform = ((args.platform as string) || 'instagram').toLowerCase();

  switch (name) {

    // ── Playbook Test 1: DM ───────────────────────────────────────────────────
    case 'safari_send_dm': {
      const username = args.username as string;
      const text = args.text as string;
      if (!username) throw new Error('username is required');
      if (!text) throw new Error('text is required');
      const cfg = DM_CONFIG[platform];
      if (!cfg) throw new Error(`DM not supported for platform '${platform}'. Use: ${Object.keys(DM_CONFIG).join(', ')}`);
      return httpCall(`http://localhost:${cfg.port}${cfg.path}`, 'POST', { username, text });
    }

    // ── Playbook Test 2: Comments ─────────────────────────────────────────────
    case 'safari_post_comment': {
      const postUrl = args.postUrl as string;
      const text = args.text as string | undefined;
      const useAI = (args.useAI as boolean | undefined) ?? false;
      if (!postUrl) throw new Error('postUrl is required');
      if (!text && !useAI) throw new Error('text is required (or set useAI=true for Twitter)');
      const cfg = COMMENT_CONFIG[platform];
      if (!cfg) throw new Error(`Comments not supported for platform '${platform}'. Use: ${Object.keys(COMMENT_CONFIG).join(', ')}`);
      const body: Record<string, unknown> = { postUrl };
      if (text) body.text = text;
      if (useAI) body.useAI = true;
      return httpCall(`http://localhost:${cfg.port}${cfg.path}`, 'POST', body);
    }

    // ── Playbook Test 3: Market Research (sync) ───────────────────────────────
    case 'safari_market_research': {
      const keyword = args.keyword as string;
      const maxPosts = (args.maxPosts as number | undefined) ?? 5;
      if (!keyword) throw new Error('keyword is required');
      const validPlatforms = ['instagram', 'twitter', 'tiktok', 'threads'];
      if (!validPlatforms.includes(platform)) throw new Error(`Research not supported for '${platform}'. Use: ${validPlatforms.join(', ')}`);
      const configKey = platform === 'twitter' ? 'tweetsPerNiche' : 'postsPerNiche';
      return httpCall(
        `${RESEARCH_BASE}/api/research/${platform}/search`,
        'POST',
        { query: keyword, config: { [configKey]: maxPosts } },
        60_000,
      );
    }

    // ── Playbook Test 4: Competitor Research (async + poll) ───────────────────
    case 'safari_competitor_research': {
      const niche = args.niche as string;
      const maxCreators = (args.maxCreators as number | undefined) ?? 5;
      const maxPosts = (args.maxPosts as number | undefined) ?? 50;
      const maxWaitMs = ((args.maxWaitSeconds as number | undefined) ?? 120) * 1000;
      if (!niche) throw new Error('niche is required');
      const validPlatforms = ['instagram', 'twitter', 'tiktok', 'threads'];
      if (!validPlatforms.includes(platform)) throw new Error(`Research not supported for '${platform}'. Use: ${validPlatforms.join(', ')}`);
      const configKey = platform === 'twitter' ? 'tweetsPerNiche' : 'postsPerNiche';
      const jobRes = await httpCall(
        `${RESEARCH_BASE}/api/research/${platform}/niche`,
        'POST',
        { niche, config: { creatorsPerNiche: maxCreators, [configKey]: maxPosts, maxScrollsPerSearch: 10 } },
        30_000,
      ) as Record<string, unknown>;
      const jobId = jobRes.jobId as string;
      if (!jobId) return { error: 'Service did not return a jobId', raw: jobRes };
      const result = await pollJob(jobId, maxWaitMs);
      if (result.status !== 'completed') return result;
      const creators = ((result.result as Record<string, unknown>)?.creators as unknown[]) ?? [];
      return {
        niche,
        platform,
        jobId,
        topCreators: creators.slice(0, maxCreators).map((c: unknown) => {
          const cr = c as Record<string, unknown>;
          return { handle: cr.handle, totalEngagement: cr.totalEngagement, topPost: cr.topTweetUrl ?? cr.topPostUrl, postCount: cr.postCount };
        }),
      };
    }

    // ── Health check ──────────────────────────────────────────────────────────
    case 'safari_health_check': {
      const allServices: Record<string, { port: number; label: string }> = {
        'instagram-dm':       { port: 3100, label: 'Instagram DM' },
        'twitter-dm':         { port: 3003, label: 'Twitter DM' },
        'tiktok-dm':          { port: 3102, label: 'TikTok DM' },
        'linkedin-dm':        { port: 3105, label: 'LinkedIn DM' },
        'instagram-comments': { port: 3005, label: 'Instagram Comments' },
        'twitter-comments':   { port: 3007, label: 'Twitter Comments' },
        'tiktok-comments':    { port: 3006, label: 'TikTok Comments' },
        'threads-comments':   { port: 3004, label: 'Threads Comments' },
        'market-research':    { port: 3106, label: 'Market Research' },
      };
      const results: Record<string, unknown> = {};
      let live = 0;
      for (const [key, { port, label }] of Object.entries(allServices)) {
        try {
          const data = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json());
          results[key] = { status: 'up', port, label, ...(data as object) };
          live++;
        } catch {
          results[key] = { status: 'down', port, label };
        }
      }
      return { live, total: Object.keys(allServices).length, services: results };
    }

    // ── Session (DM service endpoints) ────────────────────────────────────────
    case 'safari_session_ensure':
      return dmServiceCall(platform, 'POST', '/api/session/ensure');

    case 'safari_session_status':
      return dmServiceCall(platform, 'GET', '/api/session/status');

    case 'safari_session_clear':
      return dmServiceCall(platform, 'POST', '/api/session/clear');

    case 'safari_navigate_inbox':
      return dmServiceCall(platform, 'POST', '/api/inbox/navigate');

    case 'safari_get_conversations':
      return dmServiceCall(platform, 'GET', '/api/conversations');

    // ── Advanced: execute JS via DM service ───────────────────────────────────
    case 'safari_execute_js': {
      const script = args.script as string;
      if (!script) throw new Error('script is required');
      return dmServiceCall(platform, 'POST', '/api/execute', { script });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

async function main() {
  const server = new Server(
    { name: 'safari-automation', version: '2.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      const result = await handleTool(name, args as Record<string, unknown>);
      return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isConnErr = msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('503');
      const fix = isConnErr
        ? `\n\nService is not running. Start it:\n  npx tsx packages/<platform>-dm/src/api/server.ts`
        : '';
      return {
        content: [{ type: 'text', text: `Error: ${msg}${fix}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[safari-mcp] v2.0 ready — 4 playbook capabilities, 9 services');
}

main().catch((err) => {
  console.error('[safari-mcp] Fatal:', err);
  process.exit(1);
});
