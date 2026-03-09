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
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { UpworkJob } from '../types/index.js';
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabase.js';

const UPWORK_AUTOMATION_URL = process.env.UPWORK_AUTOMATION_URL || 'http://localhost:3104';

// ─── Live-reloaded keywords config ────────────────────────────────────────────
// Reads from UPWORK_KEYWORDS_FILE env (default: harness/upwork-keywords.json).
// Reloaded every 10 min so you can edit keywords without restarting the service.

const KEYWORDS_FILE = process.env.UPWORK_KEYWORDS_FILE ||
  path.join(os.homedir(), 'Documents/Software/autonomous-coding-dashboard/harness/upwork-keywords.json');

interface KeywordsConfig {
  searchQueries?: string[];
  icpStrongKeywords?: string[];
  icpWeakKeywords?: string[];
  excludeKeywords?: string[];
  filters?: {
    minFixedBudget?: number;
    minHourlyRate?: number;
    sortBy?: string;
    postedWithin?: string;
    paymentVerified?: boolean;
    experienceLevel?: string[];
  };
}

let _kwConfig: KeywordsConfig = {};
let _kwLoadedAt = 0;
const KEYWORDS_TTL_MS = 10 * 60 * 1000;

export function loadKeywordsConfig(): KeywordsConfig {
  if (Date.now() - _kwLoadedAt < KEYWORDS_TTL_MS) return _kwConfig;
  try {
    _kwConfig = JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf-8')) as KeywordsConfig;
    _kwLoadedAt = Date.now();
    console.log(`[job-scraper] Loaded keywords: ${_kwConfig.searchQueries?.length ?? 0} queries from ${KEYWORDS_FILE}`);
  } catch {
    // File missing or parse error — keep last loaded config (or empty defaults)
    _kwLoadedAt = Date.now(); // don't retry for another TTL window
  }
  return _kwConfig;
}

export function getKeywordsFilePath(): string { return KEYWORDS_FILE; }

// Fallback defaults (used when config file is absent or query list is empty)
const ICP_SEARCH_QUERIES_DEFAULT = [
  'ai automation',
  'workflow automation saas',
  'browser automation scraping',
  'n8n zapier integration',
  'claude openai api integration',
  'claude api developer',
  'anthropic claude automation',
  'make.com automation',
  'crm automation integration',
  'ai agent development',
];

const EXCLUDED_KEYWORDS_DEFAULT = [
  'wordpress', 'shopify', 'data entry', 'logo design', 'graphic design',
  'video editing', 'gis', 'esri', 'figma', 'webflow', 'java developer',
  'mobile app developer', '.net developer', 'php developer',
  'senior devops', 'devops engineer', 'gis developer', 'web developer',
  'senior backend', 'senior frontend', 'senior fullstack', 'ios developer',
  'android developer', 'react developer', 'angular developer',
];

const ICP_STRONG_DEFAULT = [
  'ai automation', 'workflow automation', 'browser automation',
  'claude', 'openai', 'anthropic', 'n8n', 'zapier', 'make.com',
  'api integration', 'crm integration', 'marketing automation',
];

const ICP_WEAK_DEFAULT = [
  'automation', 'saas', 'founder', 'startup', 'scraping',
  'chatbot', 'ai agent', 'llm', 'prompt', 'webhook',
];

function getSearchQueries(): string[] {
  const cfg = loadKeywordsConfig();
  return cfg.searchQueries?.length ? cfg.searchQueries : ICP_SEARCH_QUERIES_DEFAULT;
}

function getExcludeKeywords(): string[] {
  const cfg = loadKeywordsConfig();
  return cfg.excludeKeywords?.length ? cfg.excludeKeywords : EXCLUDED_KEYWORDS_DEFAULT;
}

function getStrongKeywords(): string[] {
  const cfg = loadKeywordsConfig();
  return cfg.icpStrongKeywords?.length ? cfg.icpStrongKeywords : ICP_STRONG_DEFAULT;
}

function getWeakKeywords(): string[] {
  const cfg = loadKeywordsConfig();
  return cfg.icpWeakKeywords?.length ? cfg.icpWeakKeywords : ICP_WEAK_DEFAULT;
}

// Fetch fresh most_recent tab from Upwork Safari (run before keyword searches)
const ALSO_FETCH_MOST_RECENT = true;

// RSS feeds — AI/automation focused only (devops/sysadmin removed — too many false positives)
const WWR_RSS_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://remotive.com/remote-jobs/feed/software-dev',
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

// ─── Hard budget/rate filters (pulled from config, with hardcoded fallbacks) ──
function getMinFixedBudget(): number { return loadKeywordsConfig().filters?.minFixedBudget ?? 500; }
function getMinHourlyRate():  number { return loadKeywordsConfig().filters?.minHourlyRate  ?? 29;  }

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
  if (hourlyRate !== null) return hourlyRate >= getMinHourlyRate();
  const budgetNum = parseBudgetAmount(job.budget || '');
  if (budgetNum > 0) return budgetNum >= getMinFixedBudget();
  return true; // no explicit budget visible — don't exclude
}

function scoreJob(job: { title: string; description: string; budget?: string; pubDate?: string }): number {
  const text = `${job.title} ${job.description}`.toLowerCase();

  for (const kw of getExcludeKeywords()) {
    if (text.includes(kw)) return 0;
  }

  // Hard budget/rate filter — below minimums → score 0
  if (!passesMinimumBudget(job)) return 0;

  // Must have at least 1 strong ICP keyword — prevents budget-only false positives
  let strongHits = 0;
  for (const kw of getStrongKeywords()) {
    if (text.includes(kw)) strongHits++;
  }
  if (strongHits === 0) return 0;

  let score = 0;

  // Strong ICP keywords — 20pts each, capped at 60
  score += Math.min(strongHits * 20, 60);

  // Weak supporting keywords — 8pts each, capped at 24
  let weakHits = 0;
  for (const kw of getWeakKeywords()) {
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

    // 1a. Fetch from Best Matches tab (Safari browser, requires Upwork login)
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
      if (data.error?.toLowerCase().includes('not logged in') || data.error?.toLowerCase().includes('login')) {
        console.error('[job-scraper] Upwork session expired — please log in via Safari');
        sendLoginExpiryAlert().catch(() => {});
      }
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

    // 1b. Fetch from Most Recent tab — catches brand-new postings before they get proposals
    if (ALSO_FETCH_MOST_RECENT) {
      try {
        const recentRaw = await httpPost(
          `${UPWORK_AUTOMATION_URL}/api/upwork/jobs/tab`,
          { tab: 'most_recent' },
          30000,
        );
        const recentData = JSON.parse(recentRaw) as {
          jobs?: Array<{ title?: string; url?: string; id?: string; description?: string; budget?: { min?: number; max?: number; amount?: number }; postedAt?: string }>;
          error?: string;
        };
        const beforeCount = jobs.length;
        for (const j of recentData.jobs || []) {
          if (!j.title || (!j.url && !j.id)) continue;
          const url = j.url || `https://www.upwork.com/jobs/${j.id}`;
          const budgetText = j.budget ? `${j.budget.min || 0}–${j.budget.max || j.budget.amount || 0}` : '';
          const score = scoreJob({ title: j.title, description: j.description || '', budget: budgetText, pubDate: j.postedAt });
          jobs.push({ job_id: jobId(url), title: j.title, url, description: j.description || '', budget: budgetText, pub_date: j.postedAt || '', score });
        }
        console.log(`[job-scraper] upwork-automation most_recent: +${jobs.length - beforeCount} jobs`);
      } catch (err) {
        console.log('[job-scraper] most_recent tab error:', err instanceof Error ? err.message : err);
      }
    }

    // 2. Keyword searches — pass all filters from config to Safari driver
    const cfg = loadKeywordsConfig();
    const searchFilters = cfg.filters ?? {};
    for (const query of getSearchQueries()) {
      try {
        const raw = await httpPost(
          `${UPWORK_AUTOMATION_URL}/api/upwork/jobs/search`,
          {
            query,
            sortBy: searchFilters.sortBy ?? 'newest',
            postedWithin: searchFilters.postedWithin ?? '24h',
            paymentVerified: searchFilters.paymentVerified ?? true,
            experienceLevel: searchFilters.experienceLevel ?? ['intermediate', 'expert'],
            fixedPriceMin: searchFilters.minFixedBudget ?? 500,
            hourlyRateMin: searchFilters.minHourlyRate ?? 35,
          },
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

// ─── Login expiry alert ────────────────────────────────────────────────────────

let _loginAlertSentAt = 0;
const LOGIN_ALERT_COOLDOWN_MS = 60 * 60 * 1000; // max 1 alert per hour

async function sendLoginExpiryAlert(): Promise<void> {
  if (Date.now() - _loginAlertSentAt < LOGIN_ALERT_COOLDOWN_MS) return;
  _loginAlertSentAt = Date.now();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat  = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  const text = '⚠️ Upwork session expired — please open Safari and log back in to Upwork so job scanning can resume.';
  const data = JSON.stringify({ chat_id: chat, text });
  const { request } = await import('https');
  const req = request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
  });
  req.write(data);
  req.end();
}

// ─── Cloud storage: persist all discovered jobs to Supabase ───────────────────

export async function storeDiscoveredJobs(jobs: UpworkJob[]): Promise<void> {
  if (!isSupabaseConfigured() || jobs.length === 0) return;
  try {
    const supabase = getSupabaseClient();
    const rows = jobs.map((j) => ({
      job_id: j.job_id,
      title: j.title,
      url: j.url,
      description: j.description,
      budget: j.budget,
      score: j.score,
      pub_date: j.pub_date,
      source: j.url.includes('upwork.com') ? 'upwork' : 'wwr',
      last_seen_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('upwork_jobs')
      .upsert(rows, { onConflict: 'job_id', ignoreDuplicates: false });
    if (error) {
      console.warn('[job-scraper] storeDiscoveredJobs error:', error.message);
    } else {
      console.log(`[job-scraper] Stored ${jobs.length} jobs to upwork_jobs`);
    }
  } catch (err) {
    console.warn('[job-scraper] storeDiscoveredJobs failed:', err instanceof Error ? err.message : err);
  }
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

  // Persist all discovered jobs to cloud DB (fire-and-forget)
  storeDiscoveredJobs(allJobs).catch(() => {/* logged inside */});

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
