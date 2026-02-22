/**
 * Commands Router — bridges ACTP workflow tasks to Safari automation capabilities.
 * 
 * POST /v1/commands         — submit a command → 202 + command_id
 * GET  /v1/commands/:id     — poll status + result
 * GET  /v1/commands         — list recent commands
 * 
 * Command types:
 *   research.competitor_content — browse platform, extract trending content
 *   research.hashtag_trends     — collect hashtag performance data
 *   upload.tiktok/instagram/... — upload video to platform via browser automation
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Command {
  id: string;
  type: string;
  payload: Record<string, any>;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  result?: Record<string, any>;
  error?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// In-memory command store (last 100 commands)
const commands: Map<string, Command> = new Map();
const MAX_COMMANDS = 100;

function pruneOldCommands() {
  if (commands.size > MAX_COMMANDS) {
    const entries = [...commands.entries()];
    const toRemove = entries.slice(0, entries.length - MAX_COMMANDS);
    for (const [id] of toRemove) {
      commands.delete(id);
    }
  }
}

// ─── Command Executors ───────────────────────────────────────────────────────

async function executeResearch(command: Command): Promise<void> {
  const { payload } = command;
  const platform = payload.platform || 'tiktok';
  const maxItems = payload.max_items || 20;
  const query = payload.query || '';
  const researchType = command.type.replace('research.', '');

  logger.info(`[commands] Executing research: ${researchType} on ${platform} (max=${maxItems})`);

  command.status = 'RUNNING';
  command.started_at = new Date().toISOString();

  try {
    // Use Puppeteer/Playwright to browse the platform
    // For now, use the platform's public feeds
    const items = await scrapePublicFeed(platform, maxItems, query);

    command.status = 'SUCCEEDED';
    command.result = {
      items,
      item_count: items.length,
      platform,
      research_type: researchType,
    };
    command.completed_at = new Date().toISOString();

    logger.info(`[commands] Research complete: ${items.length} items from ${platform}`);
  } catch (err: any) {
    command.status = 'FAILED';
    command.error = err.message;
    command.completed_at = new Date().toISOString();
    logger.error(`[commands] Research failed: ${err.message}`);
  }
}

async function scrapePublicFeed(platform: string, maxItems: number, query: string): Promise<any[]> {
  // Attempt to use Puppeteer for real browser scraping
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    let items: any[] = [];

    if (platform === 'tiktok') {
      items = await scrapeTikTokFeed(page, maxItems, query);
    } else if (platform === 'instagram') {
      items = await scrapeInstagramFeed(page, maxItems, query);
    } else {
      // Generic: just note the platform
      items = [{
        platform,
        note: `Research for ${platform} not yet implemented in browser automation`,
        scraped_at: new Date().toISOString(),
      }];
    }

    await browser.close();
    return items;
  } catch (err: any) {
    logger.warn(`[commands] Puppeteer scrape failed, using API fallback: ${err.message}`);
    // Fallback: return empty with error note
    return [{
      platform,
      error: `Browser automation unavailable: ${err.message}`,
      scraped_at: new Date().toISOString(),
    }];
  }
}

async function scrapeTikTokFeed(page: any, maxItems: number, query: string): Promise<any[]> {
  const items: any[] = [];
  const url = query
    ? `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`
    : 'https://www.tiktok.com/explore';

  logger.info(`[commands] Browsing TikTok: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000)); // Wait for dynamic content

  // Extract video data from the page
  const videoData = await page.evaluate((max: number) => {
    const videos: any[] = [];
    const elements = document.querySelectorAll('[data-e2e="recommend-list-item-container"], [class*="DivItemContainer"], article, [class*="video-feed-item"]');

    for (let i = 0; i < Math.min(elements.length, max); i++) {
      const el = elements[i];
      const link = el.querySelector('a[href*="/video/"]');
      const caption = el.querySelector('[data-e2e="video-desc"], [class*="caption"], [class*="desc"]');
      const author = el.querySelector('[data-e2e="video-author-uniqueid"], [class*="author"], a[href*="/@"]');
      const stats = el.querySelectorAll('[data-e2e="like-count"], [data-e2e="comment-count"], [data-e2e="share-count"], [class*="count"]');

      videos.push({
        url: link?.getAttribute('href') || '',
        caption: caption?.textContent?.trim() || '',
        author: author?.textContent?.trim() || '',
        stats: Array.from(stats).map((s: any) => s.textContent?.trim()),
        scraped_at: new Date().toISOString(),
      });
    }
    return videos;
  }, maxItems);

  for (const v of videoData) {
    items.push({
      platform: 'tiktok',
      url: v.url?.startsWith('http') ? v.url : `https://www.tiktok.com${v.url}`,
      caption: v.caption,
      author: v.author,
      views: parseMetric(v.stats?.[0]),
      likes: parseMetric(v.stats?.[1]),
      shares: parseMetric(v.stats?.[2]),
      content_type: 'video',
      scraped_at: v.scraped_at,
    });
  }

  return items;
}

async function scrapeInstagramFeed(page: any, maxItems: number, query: string): Promise<any[]> {
  const items: any[] = [];
  const url = query
    ? `https://www.instagram.com/explore/tags/${encodeURIComponent(query.replace('#', ''))}/`
    : 'https://www.instagram.com/explore/';

  logger.info(`[commands] Browsing Instagram: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(3000);

    const postData = await page.evaluate((max: number) => {
      const posts: any[] = [];
      const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');

      for (let i = 0; i < Math.min(links.length, max); i++) {
        const link = links[i] as HTMLAnchorElement;
        const img = link.querySelector('img');
        posts.push({
          url: link.href,
          alt: img?.alt || '',
          scraped_at: new Date().toISOString(),
        });
      }
      return posts;
    }, maxItems);

    for (const p of postData) {
      items.push({
        platform: 'instagram',
        url: p.url,
        caption: p.alt,
        content_type: p.url.includes('/reel/') ? 'reel' : 'post',
        scraped_at: p.scraped_at,
      });
    }
  } catch (err: any) {
    logger.warn(`[commands] Instagram scrape error: ${err.message}`);
  }

  return items;
}

function parseMetric(str: string | undefined): number {
  if (!str) return 0;
  const clean = str.replace(/[,\s]/g, '').toLowerCase();
  const num = parseFloat(clean);
  if (clean.endsWith('k')) return num * 1000;
  if (clean.endsWith('m')) return num * 1000000;
  if (clean.endsWith('b')) return num * 1000000000;
  return isNaN(num) ? 0 : num;
}

// ─── Upload Executor ─────────────────────────────────────────────────────────

async function executeUpload(command: Command): Promise<void> {
  const { payload } = command;
  const platform = command.type.replace('upload.', '');

  logger.info(`[commands] Executing upload to ${platform}`);

  command.status = 'RUNNING';
  command.started_at = new Date().toISOString();

  try {
    // Upload via browser automation
    const postUrl = await uploadViaBrowser(platform, payload);

    command.status = 'SUCCEEDED';
    command.result = {
      post_url: postUrl,
      platform,
    };
    command.completed_at = new Date().toISOString();

    logger.info(`[commands] Upload complete: ${postUrl}`);
  } catch (err: any) {
    command.status = 'FAILED';
    command.error = err.message;
    command.completed_at = new Date().toISOString();
    logger.error(`[commands] Upload failed: ${err.message}`);
  }
}

async function uploadViaBrowser(platform: string, payload: Record<string, any>): Promise<string> {
  // Placeholder — actual upload automation requires platform-specific Puppeteer flows
  throw new Error(`Upload to ${platform} via browser automation not yet implemented. Use Blotato or MPLite API instead.`);
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

export const commandsRouter = {
  async submitCommand(req: any, res: any, body: any) {
    const { type, payload } = body || {};

    if (!type) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "type" field' }));
      return;
    }

    const command: Command = {
      id: uuidv4(),
      type,
      payload: payload || {},
      status: 'QUEUED',
      created_at: new Date().toISOString(),
    };

    commands.set(command.id, command);
    pruneOldCommands();

    logger.info(`[commands] Command queued: ${command.id} type=${type}`);

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ command_id: command.id, status: 'QUEUED' }));

    // Execute asynchronously
    setImmediate(async () => {
      try {
        if (type.startsWith('research.')) {
          await executeResearch(command);
        } else if (type.startsWith('upload.')) {
          await executeUpload(command);
        } else {
          command.status = 'FAILED';
          command.error = `Unknown command type: ${type}`;
          command.completed_at = new Date().toISOString();
        }
      } catch (err: any) {
        command.status = 'FAILED';
        command.error = err.message;
        command.completed_at = new Date().toISOString();
      }
    });
  },

  async getCommand(req: any, res: any, commandId: string) {
    const command = commands.get(commandId);

    if (!command) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Command not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(command));
  },

  async listCommands(req: any, res: any) {
    const list = [...commands.values()]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 20);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ commands: list, total: commands.size }));
  },
};
