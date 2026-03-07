/**
 * Medium MCP Server
 *
 * Exposes Medium automation as MCP tools callable from Claude.
 * Proxies to the REST server on port 3108.
 *
 * Tools:
 *   medium_status           — check login status + active tab
 *   medium_publish          — create & publish (or draft) a post
 *   medium_my_posts         — list your published posts
 *   medium_stats            — your overall Medium stats
 *   medium_story_stats      — per-story view/read/clap stats
 *   medium_earnings         — monetization earnings summary
 *   medium_monetize         — analyze + execute monetization strategy
 *   medium_clap             — clap on any article (1-50 claps)
 *   medium_comment          — comment/respond on any article
 *   medium_follow           — follow an author
 *   medium_read_article     — extract full article content + metrics
 *   medium_search           — search Medium articles
 *   medium_feed             — read your personalised feed
 *   medium_research_niche   — research a niche (top authors, trending articles)
 *   medium_research_news    — news summary across multiple niches
 *
 * Start: npx tsx packages/medium-automation/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const MEDIUM_BASE = `http://localhost:${process.env.MEDIUM_PORT || '3108'}`;

// ── MCP protocol helpers ──────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin });
const pending = new Map<number | string, (line: string) => void>();

function send(obj: unknown) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

rl.on('line', (line) => {
  let msg: any;
  try { msg = JSON.parse(line); } catch { return; }
  const id = msg.id;
  if (pending.has(id)) { pending.get(id)!(line); pending.delete(id); return; }
  handleRequest(msg);
});

async function handleRequest(msg: any) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'medium-mcp', version: '1.0.0' },
    }});
    return;
  }

  if (method === 'notifications/initialized') return;

  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await dispatch(name, args || {});
      send({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
      }});
    } catch (e: any) {
      send({ jsonrpc: '2.0', id, result: {
        content: [{ type: 'text', text: `Error: ${e.message}` }],
        isError: true,
      }});
    }
    return;
  }

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
}

// ── REST helpers ──────────────────────────────────────────────────────────────

async function get(path: string): Promise<any> {
  const res = await fetch(`${MEDIUM_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function post(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${MEDIUM_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function dispatch(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'medium_status':
      return get('/api/medium/status');

    case 'medium_publish':
      return post('/api/medium/posts/create', {
        title: args.title,
        body: args.body,
        subtitle: args.subtitle,
        tags: args.tags,
        publishImmediately: args.publish ?? true,
      });

    case 'medium_my_posts':
      return get('/api/medium/posts/mine');

    case 'medium_stats':
      return get('/api/medium/stats');

    case 'medium_story_stats': {
      const stories: string[] = args.story_ids
        ? (Array.isArray(args.story_ids) ? args.story_ids : [args.story_ids])
        : (await get('/api/medium/stories/all-ids')).storyIds?.slice(0, 20) || [];
      const results: any[] = [];
      for (const id of stories) {
        try { results.push(await get(`/api/medium/stories/${id}/stats`)); } catch {}
      }
      return results;
    }

    case 'medium_earnings':
      return get('/api/medium/monetization/earnings');

    case 'medium_monetize':
      if (args.execute) {
        return post('/api/medium/monetization/execute', { strategy: args.strategy || 'auto' });
      }
      return get('/api/medium/monetization/analyze' + (args.days ? `?days=${args.days}` : ''));

    case 'medium_clap':
      return post('/api/medium/articles/clap', { url: args.url, claps: args.claps ?? 50 });

    case 'medium_comment':
      return post('/api/medium/articles/respond', { url: args.url, comment: args.comment });

    case 'medium_follow':
      return post('/api/medium/users/follow', { username: args.username });

    case 'medium_read_article':
      return post('/api/medium/articles/read', { url: args.url });

    case 'medium_search':
      return post('/api/medium/search', { query: args.query, limit: args.limit ?? 10 });

    case 'medium_feed':
      return get('/api/medium/feed');

    case 'medium_research_niche':
      return post('/api/medium/research/niche', { niche: args.niche });

    case 'medium_research_news':
      return post('/api/medium/research/news', {
        niches: args.niches ?? ['ai automation', 'saas', 'content creation'],
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'medium_status',
    description: 'Check Medium login status and active Safari tab',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'medium_publish',
    description: 'Create and publish (or save as draft) a Medium post',
    inputSchema: {
      type: 'object',
      required: ['title', 'body'],
      properties: {
        title: { type: 'string', description: 'Post title' },
        body: { type: 'string', description: 'Post body (plain text or markdown)' },
        subtitle: { type: 'string', description: 'Optional subtitle' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 tags' },
        publish: { type: 'boolean', description: 'true=publish now, false=save as draft (default true)' },
      },
    },
  },
  {
    name: 'medium_my_posts',
    description: 'List your published Medium posts',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'medium_stats',
    description: 'Get your overall Medium stats (views, reads, claps, earnings)',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'medium_story_stats',
    description: 'Get per-story stats (views, reads, claps). Fetches all stories if no IDs given.',
    inputSchema: {
      type: 'object',
      properties: {
        story_ids: { description: 'Story ID or array of story IDs (optional)' },
      },
    },
  },
  {
    name: 'medium_earnings',
    description: 'Get Medium Partner Program earnings summary',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'medium_monetize',
    description: 'Analyze or execute monetization strategy (paywall placement, SEO)',
    inputSchema: {
      type: 'object',
      properties: {
        execute: { type: 'boolean', description: 'true=execute strategy, false=analyze only (default false)' },
        strategy: { type: 'string', description: 'Strategy name when executing (default: auto)' },
        days: { type: 'number', description: 'Days of data to analyze (default 30)' },
      },
    },
  },
  {
    name: 'medium_clap',
    description: 'Clap on a Medium article',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Article URL' },
        claps: { type: 'number', description: 'Number of claps 1-50 (default 50)' },
      },
    },
  },
  {
    name: 'medium_comment',
    description: 'Post a comment/response on a Medium article',
    inputSchema: {
      type: 'object',
      required: ['url', 'comment'],
      properties: {
        url: { type: 'string', description: 'Article URL' },
        comment: { type: 'string', description: 'Comment text' },
      },
    },
  },
  {
    name: 'medium_follow',
    description: 'Follow a Medium author',
    inputSchema: {
      type: 'object',
      required: ['username'],
      properties: {
        username: { type: 'string', description: 'Medium username (without @)' },
      },
    },
  },
  {
    name: 'medium_read_article',
    description: 'Extract full content and metrics from a Medium article',
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Article URL' },
      },
    },
  },
  {
    name: 'medium_search',
    description: 'Search Medium articles by keyword',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: 'medium_feed',
    description: 'Read your personalised Medium feed',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'medium_research_niche',
    description: 'Research a Medium niche: top authors, trending articles, related topics',
    inputSchema: {
      type: 'object',
      required: ['niche'],
      properties: {
        niche: { type: 'string', description: 'Niche/topic to research (e.g. "ai automation")' },
      },
    },
  },
  {
    name: 'medium_research_news',
    description: 'Aggregate trending news across multiple Medium niches',
    inputSchema: {
      type: 'object',
      properties: {
        niches: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of niches (default: ai automation, saas, content creation)',
        },
      },
    },
  },
];
