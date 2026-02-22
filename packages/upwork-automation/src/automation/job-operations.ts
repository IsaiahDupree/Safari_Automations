/**
 * Upwork Job Discovery & Extraction Operations
 * High-level Safari automation for job search, extraction, and scoring.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  UpworkJob,
  JobSearchConfig,
  JobScore,
  NavigationResult,
  UPWORK_SELECTORS,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG } from './types.js';

const UPWORK_FIND_WORK = 'https://www.upwork.com/nx/find-work/best-matches';
const UPWORK_SEARCH = 'https://www.upwork.com/nx/search/jobs';
const UPWORK_MY_JOBS = 'https://www.upwork.com/nx/find-work/my-jobs';

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToFindWork(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(UPWORK_FIND_WORK);
  if (!success) return { success: false, error: 'Failed to navigate to Find Work' };

  await d.wait(3000);
  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) return { success: false, error: 'Not logged in to Upwork' };

  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

export async function navigateToMyJobs(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(UPWORK_MY_JOBS);
  if (!success) return { success: false, error: 'Failed to navigate to My Jobs' };
  await d.wait(3000);
  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

export async function navigateToJob(jobUrl: string, driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const url = jobUrl.startsWith('http') ? jobUrl : `https://www.upwork.com/jobs/${jobUrl}`;
  const success = await d.navigateTo(url);
  if (!success) return { success: false, error: 'Failed to navigate to job' };
  await d.wait(3000);
  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

// ─── Job Search ──────────────────────────────────────────────

export async function searchJobs(
  config: Partial<JobSearchConfig> = {},
  driver?: SafariDriver
): Promise<UpworkJob[]> {
  const d = driver || getDefaultDriver();
  const search = { ...DEFAULT_SEARCH_CONFIG, ...config };

  // Build search URL
  const params = new URLSearchParams();
  if (search.keywords.length > 0) params.set('q', search.keywords.join(' '));
  if (search.jobType !== 'both') params.set('t', search.jobType === 'hourly' ? '0' : '1');
  if (search.experienceLevel !== 'any') {
    const levelMap: Record<string, string> = { entry: '1', intermediate: '2', expert: '3' };
    params.set('contractor_tier', levelMap[search.experienceLevel] || '');
  }
  if (search.budgetMin) params.set('amount', String(search.budgetMin));
  const sortMap: Record<string, string> = { relevance: 'relevance', newest: 'recency', client_spending: 'client_total_charge' };
  params.set('sort', sortMap[search.sortBy] || 'recency');

  const searchUrl = `${UPWORK_SEARCH}?${params.toString()}`;
  const success = await d.navigateTo(searchUrl);
  if (!success) return [];

  await d.wait(4000);

  // Extract jobs from search results
  const jobsJson = await d.executeJS(`
    (function() {
      var jobs = [];
      var tiles = document.querySelectorAll('[data-test="job-tile"], .job-tile, article[data-ev-label="search_results_impression"]');
      if (tiles.length === 0) {
        tiles = document.querySelectorAll('section.up-card-section');
      }

      tiles.forEach(function(tile) {
        try {
          var titleEl = tile.querySelector('h2 a, [data-test="job-tile-title"] a, h3 a, a.job-title-link');
          var title = titleEl ? titleEl.innerText.trim() : '';
          var url = titleEl ? titleEl.href : '';

          var descEl = tile.querySelector('[data-test="description"], .job-description, p[data-test="UpCLineClamp JobDescription"]');
          var description = descEl ? descEl.innerText.trim().substring(0, 500) : '';

          var budgetEl = tile.querySelector('[data-test="budget"], [data-test="is-fixed-price"], .js-budget');
          var budgetText = budgetEl ? budgetEl.innerText.trim() : '';

          var skillEls = tile.querySelectorAll('[data-test="token"], .air3-token, .up-skill-badge');
          var skills = [];
          skillEls.forEach(function(s) { skills.push(s.innerText.trim()); });

          var proposalEl = tile.querySelector('[data-test="proposals"], .js-proposals');
          var proposalText = proposalEl ? proposalEl.innerText.trim() : '';
          var proposalMatch = proposalText.match(/(\\d+)/);
          var proposals = proposalMatch ? parseInt(proposalMatch[1]) : 0;

          var postedEl = tile.querySelector('[data-test="posted-on"], .js-posted, time');
          var posted = postedEl ? postedEl.innerText.trim() : '';

          var levelEl = tile.querySelector('[data-test="experience-level"], .js-experience-level');
          var level = levelEl ? levelEl.innerText.trim() : '';

          var clientEls = tile.querySelectorAll('[data-test="client-info"] li, .client-info span');
          var clientInfo = {};
          clientEls.forEach(function(c) {
            var text = c.innerText.trim();
            if (text.includes('$')) clientInfo.totalSpent = text;
            if (text.includes('%')) clientInfo.hireRate = text;
            if (text.includes('Payment')) clientInfo.paymentVerified = text.includes('verified');
          });

          if (title) {
            jobs.push(JSON.stringify({
              id: url.split('/').pop() || Date.now().toString(),
              title: title,
              description: description,
              url: url,
              budget: { text: budgetText },
              skills: skills,
              experienceLevel: level,
              postedAt: posted,
              proposals: proposals,
              clientInfo: clientInfo,
            }));
          }
        } catch(e) {}
      });

      return '[' + jobs.join(',') + ']';
    })()
  `);

  try {
    const raw = JSON.parse(jobsJson || '[]');
    return raw.map((j: any) => ({
      ...j,
      budget: parseBudget(j.budget?.text || ''),
      connectsCost: 0,
      isInviteOnly: false,
      category: '',
      scrapedAt: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function parseBudget(text: string): UpworkJob['budget'] {
  if (!text) return { type: 'fixed' };
  const fixed = text.match(/\$[\d,]+(?:\.\d+)?/g);
  if (text.toLowerCase().includes('/hr') || text.toLowerCase().includes('hourly')) {
    const nums = text.match(/[\d,.]+/g)?.map(n => parseFloat(n.replace(/,/g, ''))) || [];
    return { type: 'hourly', min: nums[0], max: nums[1] || nums[0] };
  }
  if (fixed && fixed.length >= 1) {
    const nums = fixed.map(n => parseFloat(n.replace(/[$,]/g, '')));
    return { type: 'fixed', amount: nums[0], min: nums[0], max: nums[1] || nums[0] };
  }
  return { type: 'fixed' };
}

// ─── Job Detail Extraction ───────────────────────────────────

export async function extractJobDetail(jobUrl: string, driver?: SafariDriver): Promise<UpworkJob | null> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToJob(jobUrl, d);
  if (!nav.success) return null;

  await d.wait(3000);

  const detailJson = await d.executeJS(`
    (function() {
      var title = '';
      var titleEl = document.querySelector('h1, [data-test="job-title"], .job-title');
      if (titleEl) title = titleEl.innerText.trim();

      var descEl = document.querySelector('[data-test="description"], .job-description, [data-cy="description"]');
      var description = descEl ? descEl.innerText.trim() : '';

      var budgetEl = document.querySelector('[data-test="budget"], [data-cy="budget"]');
      var budgetText = budgetEl ? budgetEl.innerText.trim() : '';

      var skillEls = document.querySelectorAll('[data-test="token"], .air3-token, .up-skill-badge');
      var skills = [];
      skillEls.forEach(function(s) { skills.push(s.innerText.trim()); });

      var proposalEl = document.querySelector('[data-test="proposals"]');
      var proposalText = proposalEl ? proposalEl.innerText.trim() : '';
      var proposalMatch = proposalText.match(/(\\d+)/);
      var proposals = proposalMatch ? parseInt(proposalMatch[1]) : 0;

      var levelEl = document.querySelector('[data-test="experience-level"]');
      var level = levelEl ? levelEl.innerText.trim() : '';

      var connectsEl = document.querySelector('[data-test="connects"]');
      var connectsText = connectsEl ? connectsEl.innerText.trim() : '';
      var connectsMatch = connectsText.match(/(\\d+)/);
      var connects = connectsMatch ? parseInt(connectsMatch[1]) : 0;

      var clientSection = document.querySelector('.client-info, [data-test="client-info"], [data-cy="client-info"]');
      var clientInfo = {};
      if (clientSection) {
        var items = clientSection.querySelectorAll('li, div, span');
        items.forEach(function(item) {
          var text = item.innerText.trim();
          if (text.includes('$')) clientInfo.totalSpent = text;
          if (text.includes('hire rate') || text.includes('%')) clientInfo.hireRate = text;
          if (text.includes('Payment verified')) clientInfo.paymentVerified = true;
          if (text.match(/\\d+ jobs? posted/)) clientInfo.jobsPosted = parseInt(text);
          if (text.match(/\\d\\.\\d/)) clientInfo.reviewScore = parseFloat(text);
        });
        var locEl = clientSection.querySelector('[data-test="location"], .client-location');
        if (locEl) clientInfo.location = locEl.innerText.trim();
      }

      return JSON.stringify({
        title: title,
        description: description,
        url: window.location.href,
        budget: { text: budgetText },
        skills: skills,
        experienceLevel: level,
        proposals: proposals,
        connectsCost: connects,
        clientInfo: clientInfo,
      });
    })()
  `);

  try {
    const raw = JSON.parse(detailJson || '{}');
    return {
      ...raw,
      id: jobUrl.split('/').pop() || Date.now().toString(),
      budget: parseBudget(raw.budget?.text || ''),
      isInviteOnly: false,
      category: '',
      postedAt: '',
      scrapedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Job Scoring ─────────────────────────────────────────────

export function scoreJob(
  job: UpworkJob,
  preferredSkills: string[] = [],
  minBudget: number = 0,
): JobScore {
  let totalScore = 0;
  const factors: JobScore['factors'] = {
    budgetMatch: 0,
    skillMatch: 0,
    clientQuality: 0,
    competition: 0,
    freshness: 0,
  };

  // Budget match (0-25)
  const budget = job.budget.amount || job.budget.max || job.budget.min || 0;
  if (budget > 0) {
    if (budget >= minBudget) factors.budgetMatch = Math.min(25, 15 + (budget / 100));
    else factors.budgetMatch = 5;
  } else {
    factors.budgetMatch = 10;
  }

  // Skill match (0-30)
  if (preferredSkills.length > 0 && job.skills.length > 0) {
    const jobSkillsLower = job.skills.map(s => s.toLowerCase());
    const matches = preferredSkills.filter(s => jobSkillsLower.includes(s.toLowerCase()));
    factors.skillMatch = Math.min(30, (matches.length / preferredSkills.length) * 30);
  } else {
    factors.skillMatch = 15;
  }

  // Client quality (0-20)
  const client = job.clientInfo;
  if (client.paymentVerified) factors.clientQuality += 8;
  if (client.reviewScore && client.reviewScore >= 4.5) factors.clientQuality += 7;
  const hireRate = parseFloat(String(client.hireRate || '0'));
  if (hireRate > 50) factors.clientQuality += 5;

  // Competition (0-15) — lower proposals = better
  if (job.proposals <= 5) factors.competition = 15;
  else if (job.proposals <= 15) factors.competition = 10;
  else if (job.proposals <= 30) factors.competition = 5;
  else factors.competition = 2;

  // Freshness (0-10)
  const posted = (job.postedAt || '').toLowerCase();
  if (posted.includes('minute') || posted.includes('hour')) factors.freshness = 10;
  else if (posted.includes('yesterday') || posted.includes('1 day')) factors.freshness = 7;
  else if (posted.includes('day')) factors.freshness = 4;
  else factors.freshness = 2;

  totalScore = factors.budgetMatch + factors.skillMatch + factors.clientQuality + factors.competition + factors.freshness;

  const recommendation: JobScore['recommendation'] =
    totalScore >= 70 ? 'apply' :
    totalScore >= 45 ? 'maybe' :
    'skip';

  const reasons: string[] = [];
  if (factors.skillMatch >= 20) reasons.push('Strong skill match');
  if (factors.budgetMatch >= 20) reasons.push('Good budget');
  if (factors.competition >= 12) reasons.push('Low competition');
  if (factors.clientQuality >= 15) reasons.push('Quality client');
  if (factors.freshness >= 8) reasons.push('Just posted');
  if (reasons.length === 0) reasons.push('Average opportunity');

  return {
    jobId: job.id,
    totalScore,
    factors,
    recommendation,
    reason: reasons.join(', '),
  };
}

// ─── Saved Jobs ──────────────────────────────────────────────

export async function saveJob(jobUrl: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  await navigateToJob(jobUrl, d);
  await d.wait(2000);

  const result = await d.executeJS(`
    (function() {
      var btn = document.querySelector('[data-test="save-job"]') ||
                document.querySelector('[aria-label*="Save"]') ||
                document.querySelector('button[title*="Save"]');
      if (btn) { btn.click(); return 'saved'; }
      return 'not_found';
    })()
  `);

  return result === 'saved';
}

// ─── Application Status ──────────────────────────────────────

export async function getApplications(driver?: SafariDriver): Promise<any[]> {
  const d = driver || getDefaultDriver();
  await d.navigateTo(UPWORK_MY_JOBS);
  await d.wait(3000);

  const appsJson = await d.executeJS(`
    (function() {
      var apps = [];
      var rows = document.querySelectorAll('.my-job-item, [data-test="application"], tr[data-test]');
      rows.forEach(function(row) {
        try {
          var titleEl = row.querySelector('a');
          var statusEl = row.querySelector('[data-test="status"], .status, .badge');
          apps.push(JSON.stringify({
            jobTitle: titleEl ? titleEl.innerText.trim() : '',
            url: titleEl ? titleEl.href : '',
            status: statusEl ? statusEl.innerText.trim() : '',
          }));
        } catch(e) {}
      });
      return '[' + apps.join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(appsJson || '[]');
  } catch {
    return [];
  }
}
