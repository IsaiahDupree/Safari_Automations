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

// RSS feeds — WeWorkRemotely + Remotive (AI/automation categories)
const WWR_RSS_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://remotive.com/remote-jobs/feed/software-dev',
  'https://remotive.com/remote-jobs/feed/all',
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

// ─── Hard budget/rate filters ─────────────────────────────────────────────────
const MIN_FIXED_BUDGET = 500;  // $500 minimum fixed-price budget
const MIN_HOURLY_RATE  = 29;   // $29/hr minimum hourly rate

function parseHourlyRate(text: string): number | null {
  const m = /\$?([\d.]+)\s*(?:[-\u2013]\s*\$?[\d.]+)?\s*\/?\s*(?:hr|hour|per\s+hour)/i.exec(text);
  return m ? parseFloat(m[1]) : null;
}

function parseBudgetAmount(budgetStr: string): number {
  const clean = (budgetStr || '').replace(/[$,]/g, '');
  return parseInt(clean.split(/[-\u2013]/)[0], 10) || 0;
}

/**
 * Hard-filter: returns false when job explicitly advertises rate/budget below minimums.
 * If no rate/budget is visible, passes (Upwork often hides pricing until you click in).
 */
function passesMinimumBudget(job: { description: string; budget?: string }): boolean {
  const combined = `${job.description} ${job.budget || ''}`;
  const hourlyRate = parseHourlyRate(combined);
  if (hourlyRate !== null) return hourlyRate >= MIN_HOURLY_RATE;
  const budgetNum = parseBudgetAmount(job.budget || '');
  if (budgetNum > 0) return budgetNum >= MIN_FIXED_BUDGET;
  return true; // no explicit budget visible — don't exclude
}

function scoreJob(job: { title: string; description: string; budget?: string; pubDate?: string }): number {
  const text = `${job.title} ${job.description}`.toLowerCase();

  for (const kw of EXCLUDED_KEYWORDS) {
    if (text.includes(kw)) return 0;
  }

  // Must have at least 1 strong ICP keyword — prevents budget-only false positives
  let strongHits = 0;
  for (const kw of ICP_STRONG_KEYWORDS) {
    if (text.includes(kw)) strongHits++;
  }
  if (strongHits === 0) return 0;

  let score = 0;

  // Strong ICP keywords — 20pts each, capped at 60
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

function httpPost(url: string, body: unknown, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = (mod as typeof http).request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve(raw));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
    req.write(data);
    req.end();
  });
}

async function fetchFromUpworkAutomation(): Promise<UpworkJob[]> {
  try {
    const healthRaw = await httpGet(`${UPWORK_AUTOMATION_URL}/health`, 4000).catch(() => '');
    if (!healthRaw.includes('ok') && !healthRaw.includes('running')) {
      console.log('[job-scraper] upwork-automation not running, skipping Safari source');
      return [];
    }

    const jobs: UpworkJob[] = [];

    // 1. Fetch from Best Matches tab (Safari browser, requires Upwork login)
    try {
      const tabRaw = await httpPost(
        `${UPWORK_AUTOMATION_URL}/api/upwork/jobs/tab`,
        { tab: 'best_matches' },
        30000,
      );
      const data = JSON.parse(tabRaw) as {
        jobs?: Array<{ title?: string; url?: string; id?: string; description?: string; budget?: { min?: number; max?: number; amount?: number }; postedAt?: string }>;
        error?: string;
      };
      for (const j of data.jobs || []) {
        if (!j.title || (!j.url && !j.id)) continue;
        const url = j.url || `https://www.upwork.com/jobs/${j.id}`;
        const budgetText = j.budget ? `${j.budget.min || 0}–${j.budget.max || j.budget.amount || 0}` : '';
        const score = scoreJob({ title: j.title, description: j.description || '', budget: budgetText, pubDate: j.postedAt });
        jobs.push({ job_id: jobId(url), title: j.title, url, description: j.description || '', budget: budgetText, pub_date: j.postedAt || '', score });
      }
      console.log(`[job-scraper] upwork-automation best_matches: ${jobs.length} jobs`);
    } catch (err) {
      console.log('[job-scraper] best_matches tab error:', err instanceof Error ? err.message : err);
    }

    // 2. Keyword searches for ICP queries
    for (const query of ICP_SEARCH_QUERIES) {
      try {
        const raw = await httpPost(
          `${UPWORK_AUTOMATION_URL}/api/upwork/jobs/search`,
          { query, sortBy: 'newest', postedWithin: '24h', paymentVerified: true },
          25000,
        );
        const data = JSON.parse(raw) as {
          jobs?: Array<{ title?: string; url?: string; id?: string; description?: string; budget?: { min?: number; max?: number; amount?: number }; postedAt?: string }>;
        };
        for (const j of data.jobs || []) {
          if (!j.title || (!j.url && !j.id)) continue;
          const url = j.url || `https://www.upwork.com/jobs/${j.id}`;
          const budgetText = j.budget ? `${j.budget.min || 0}–${j.budget.max || j.budget.amount || 0}` : '';
          const score = scoreJob({ title: j.title, description: j.description || '', budget: budgetText, pubDate: j.postedAt });
          jobs.push({ job_id: jobId(url), title: j.title, url, description: j.description || '', budget: budgetText, pub_date: j.postedAt || '', score });
        }
      } catch {
        // ignore per-query errors
      }
    }

    console.log(`[job-scraper] upwork-automation total: ${jobs.length} jobs from Safari`);
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

export function clearJobCache(): void {
  _cache = null;
  console.log('[job-scraper] Cache cleared');
}

export { jobId };
