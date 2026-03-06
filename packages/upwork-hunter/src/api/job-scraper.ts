/**
 * Job scraper for upwork-hunter.
 *
 * Primary source: upwork-automation service (port 3104, Safari-based scraping).
 * Fallback source: WeWorkRemotely RSS feed (publicly accessible, no auth).
 *
 * Upwork's public RSS feed was permanently removed (HTTP 410) — do not use.
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import type { UpworkJob } from '../types/index.js';

const UPWORK_AUTOMATION_URL = process.env.UPWORK_AUTOMATION_URL || 'http://localhost:3104';

const ICP_SEARCH_QUERIES = [
  'ai automation',
  'workflow automation saas',
  'browser automation scraping',
  'n8n zapier integration',
  'claude openai api integration',
];

// WeWorkRemotely RSS categories that match our ICP
const WWR_RSS_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
];

const EXCLUDED_KEYWORDS = [
  'wordpress', 'shopify', 'data entry', 'logo design', 'graphic design',
  'video editing', 'gis', 'esri', 'figma', 'webflow', 'java developer',
  'mobile app developer', '.net developer', 'php developer',
  'senior devops', 'devops engineer', 'gis developer', 'web developer',
  'senior backend', 'senior frontend', 'senior fullstack', 'ios developer',
  'android developer', 'react developer', 'angular developer',
];

// High-signal ICP keywords (20pts each) — strongly indicate AI automation consulting work
const ICP_STRONG_KEYWORDS = [
  'ai automation', 'workflow automation', 'browser automation',
  'claude', 'openai', 'anthropic', 'n8n', 'zapier', 'make.com',
  'api integration', 'crm integration', 'marketing automation',
];

// Supporting keywords (8pts each) — useful signals but not decisive alone
const ICP_WEAK_KEYWORDS = [
  'automation', 'saas', 'founder', 'startup', 'scraping',
  'chatbot', 'ai agent', 'llm', 'prompt', 'webhook',
];

interface JobCache {
  timestamp: number;
  jobs: UpworkJob[];
}

let _cache: JobCache | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

function jobId(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function httpGet(url: string, timeoutMs = 12000): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function parseXmlValue(xml: string, tag: string): string {
  const cdataMatch = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i').exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (plainMatch) return plainMatch[1].trim();
  return '';
}

function scoreJob(job: { title: string; description: string; budget?: string; pubDate?: string }): number {
  const text = `${job.title} ${job.description}`.toLowerCase();

  for (const kw of EXCLUDED_KEYWORDS) {
    if (text.includes(kw)) return 0;
  }

  let score = 0;

  // Strong ICP keywords — 20pts each, capped at 60
  let strongHits = 0;
  for (const kw of ICP_STRONG_KEYWORDS) {
    if (text.includes(kw)) strongHits++;
  }
  score += Math.min(strongHits * 20, 60);

  // Weak supporting keywords — 8pts each, capped at 24
  let weakHits = 0;
  for (const kw of ICP_WEAK_KEYWORDS) {
    if (text.includes(kw)) weakHits++;
  }
  score += Math.min(weakHits * 8, 24);

  // Budget signal
  const budgetText = (job.budget || '').replace(/[\$,]/g, '');
  const budgetNum = parseInt(budgetText.split(/[-–]/)[0], 10);
  if (!isNaN(budgetNum) && budgetNum >= 1000) score += 20;
  else if (!isNaN(budgetNum) && budgetNum >= 500) score += 10;

  // Contract type
  const descLower = (job.description || '').toLowerCase();
  if (descLower.includes('hourly')) score += 8;
  else if (descLower.includes('fixed')) score += 4;

  // Recency
  if (job.pubDate) {
    const ageMs = Date.now() - new Date(job.pubDate).getTime();
    if (ageMs < 4 * 60 * 60 * 1000) score += 15;
    else if (ageMs < 24 * 60 * 60 * 1000) score += 8;
  }

  return Math.min(score, 100);
}

// ─── Source 1: upwork-automation Safari scraper ───────────────────────────────

async function fetchFromUpworkAutomation(): Promise<UpworkJob[]> {
  try {
    // Check if upwork-automation is running
    const healthRaw = await httpGet(`${UPWORK_AUTOMATION_URL}/health`, 4000).catch(() => '');
    if (!healthRaw.includes('ok')) {
      console.log('[job-scraper] upwork-automation not running, skipping Safari source');
      return [];
    }

    const jobs: UpworkJob[] = [];
    for (const query of ICP_SEARCH_QUERIES) {
      try {
        const raw = await httpGet(
          `${UPWORK_AUTOMATION_URL}/api/upwork/jobs/search`,
          20000,
        );
        // upwork-automation returns JSON from a POST, we use GET tab endpoint instead
        void raw; // unused — Safari search needs POST
        break;
      } catch {
        break;
      }
    }

    // Use the tab-based job fetch (Best Matches tab)
    const tabRaw = await httpGet(`${UPWORK_AUTOMATION_URL}/api/upwork/jobs/tab?tab=best_matches`, 25000).catch(() => '');
    if (tabRaw) {
      try {
        const data = JSON.parse(tabRaw) as { jobs?: Array<{ title?: string; url?: string; description?: string; budget?: string; pub_date?: string }> };
        for (const j of data.jobs || []) {
          if (!j.title || !j.url) continue;
          const score = scoreJob({ title: j.title, description: j.description || '', budget: j.budget, pubDate: j.pub_date });
          jobs.push({ job_id: jobId(j.url), title: j.title, url: j.url, description: j.description || '', budget: j.budget || '', pub_date: j.pub_date || '', score });
        }
        console.log(`[job-scraper] upwork-automation: ${jobs.length} jobs from Safari`);
      } catch {
        // ignore parse errors
      }
    }

    return jobs;
  } catch (err) {
    console.log('[job-scraper] upwork-automation unavailable:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ─── Source 2: WeWorkRemotely RSS (public fallback) ────────────────────────────

async function fetchFromWeWorkRemotely(): Promise<UpworkJob[]> {
  const jobs: UpworkJob[] = [];
  for (const feedUrl of WWR_RSS_FEEDS) {
    try {
      const xml = await httpGet(feedUrl);
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let match: RegExpExecArray | null;
      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];
        const title = parseXmlValue(itemXml, 'title');
        const link = parseXmlValue(itemXml, 'link');
        const description = parseXmlValue(itemXml, 'description');
        const pubDate = parseXmlValue(itemXml, 'pubDate');
        if (!title || !link) continue;
        const score = scoreJob({ title, description, pubDate });
        if (score === 0) continue; // excluded keyword hit
        jobs.push({ job_id: jobId(link), title, url: link, description, budget: '', pub_date: pubDate, score });
      }
    } catch (err) {
      console.error(`[job-scraper] WWR feed failed: ${feedUrl}`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[job-scraper] WeWorkRemotely: ${jobs.length} jobs`);
  return jobs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchAndScoreJobs(): Promise<UpworkJob[]> {
  if (_cache && Date.now() - _cache.timestamp < CACHE_TTL_MS) {
    console.log('[job-scraper] Returning cached jobs');
    return _cache.jobs;
  }

  const seenIds = new Set<string>();
  const allJobs: UpworkJob[] = [];

  const [safariJobs, wwrJobs] = await Promise.allSettled([
    fetchFromUpworkAutomation(),
    fetchFromWeWorkRemotely(),
  ]);

  for (const result of [safariJobs, wwrJobs]) {
    if (result.status === 'fulfilled') {
      for (const job of result.value) {
        if (!seenIds.has(job.job_id)) {
          seenIds.add(job.job_id);
          allJobs.push(job);
        }
      }
    }
  }

  allJobs.sort((a, b) => b.score - a.score);
  _cache = { timestamp: Date.now(), jobs: allJobs };
  console.log(`[job-scraper] Total: ${allJobs.length} unique jobs (${safariJobs.status === 'fulfilled' ? safariJobs.value.length : 0} Safari + ${wwrJobs.status === 'fulfilled' ? wwrJobs.value.length : 0} WWR)`);
  return allJobs;
}

export function scoreUpworkJob(job: { title: string; description: string; budget: string; pubDate: string }): number {
  return scoreJob(job);
}

export { jobId };
