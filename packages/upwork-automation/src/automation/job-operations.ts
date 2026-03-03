/**
 * Upwork Job Discovery & Extraction Operations
 * High-level Safari automation for job search, extraction, and scoring.
 * All selectors verified against live Upwork DOM (Feb 2026).
 */

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  UpworkJob,
  UpworkJobDetail,
  JobSearchConfig,
  JobScore,
  JobTab,
  NavigationResult,
} from './types.js';
import { DEFAULT_SEARCH_CONFIG, JOB_TAB_URLS } from './types.js';

const UPWORK_SEARCH = 'https://www.upwork.com/nx/search/jobs';
const UPWORK_MY_JOBS = 'https://www.upwork.com/nx/find-work/my-jobs';

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToFindWork(driver?: SafariDriver): Promise<NavigationResult> {
  return navigateToTab('best_matches', driver);
}

export async function navigateToTab(tab: JobTab, driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const url = JOB_TAB_URLS[tab];
  const success = await d.navigateTo(url);
  if (!success) return { success: false, error: `Failed to navigate to ${tab}` };

  await d.wait(3000);

  // Handle Cloudflare CAPTCHA if present
  await d.handleCaptchaIfPresent();

  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) return { success: false, error: 'Not logged in to Upwork' };

  // For tabs that use buttons instead of URL navigation, click the button
  if (tab !== 'saved_jobs') {
    const tabNames: Record<string, string> = {
      best_matches: 'Best Matches',
      most_recent: 'Most Recent',
      us_only: 'U.S. Only',
    };
    await d.executeJS(`
      (function() {
        var btns = document.querySelectorAll('button');
        for (var b of btns) {
          if (b.innerText.trim().startsWith('${tabNames[tab]}')) {
            b.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);
    await d.wait(2000);
  }

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
  // Handle Cloudflare CAPTCHA if present
  await d.handleCaptchaIfPresent();
  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

// ─── Build Search URL with ALL Filters ───────────────────────

function buildSearchUrl(config: JobSearchConfig): string {
  const params = new URLSearchParams();

  // Keywords
  if (config.keywords.length > 0) params.set('q', config.keywords.join(' '));

  // Sort
  const sortMap: Record<string, string> = {
    relevance: 'relevance',
    newest: 'recency',
    client_spending: 'client_total_charge',
  };
  params.set('sort', sortMap[config.sortBy] || 'recency');

  // Job type: t=0 (hourly), t=1 (fixed), t=0,1 (both)
  if (config.jobType === 'hourly') params.set('t', '0');
  else if (config.jobType === 'fixed') params.set('t', '1');

  // Experience levels (can select multiple): contractor_tier=1,2,3
  if (config.experienceLevel !== 'any') {
    const levelMap: Record<string, string> = { entry: '1', intermediate: '2', expert: '3' };
    if (Array.isArray(config.experienceLevel)) {
      const tiers = config.experienceLevel.map(l => levelMap[l]).filter(Boolean);
      if (tiers.length > 0) params.set('contractor_tier', tiers.join(','));
    }
  }

  // Category
  if (config.category) params.set('category2_uid', config.category);

  // Hourly rate range: amount=MIN-MAX
  if (config.hourlyRateMin || config.hourlyRateMax) {
    const min = config.hourlyRateMin || '';
    const max = config.hourlyRateMax || '';
    params.set('amount', `${min}-${max}`);
  }

  // Fixed price ranges
  if (config.fixedPriceRange) {
    const fpMap: Record<string, string> = {
      less_100: '-100',
      '100_500': '100-500',
      '500_1k': '500-1000',
      '1k_5k': '1000-5000',
      '5k_plus': '5000-',
    };
    params.set('amount', fpMap[config.fixedPriceRange] || '');
  } else if (config.fixedPriceMin || config.fixedPriceMax) {
    const min = config.fixedPriceMin || '';
    const max = config.fixedPriceMax || '';
    params.set('amount', `${min}-${max}`);
  }

  // Proposal ranges
  if (config.proposalRange) {
    const propMap: Record<string, string> = {
      less_5: '0-4',
      '5_10': '5-9',
      '10_15': '10-14',
      '15_20': '15-19',
      '20_50': '20-49',
    };
    params.set('proposals', propMap[config.proposalRange] || '');
  }

  // Client info
  if (config.paymentVerified) params.set('payment_verified', '1');
  if (config.previousClients) params.set('previous_clients', 'all');

  // Client history (hires)
  if (config.clientHires) {
    const hiresMap: Record<string, string> = {
      no_hires: '0',
      '1_9': '1-9',
      '10_plus': '10-',
    };
    params.set('client_hires', hiresMap[config.clientHires] || '');
  }

  // Client location
  if (config.clientLocation) params.set('location', config.clientLocation);

  // Client timezone
  if (config.clientTimezone) params.set('timezone', config.clientTimezone);

  // Project length
  if (config.projectLength) {
    const plMap: Record<string, string> = {
      less_month: 'week',
      '1_3_months': 'month',
      '3_6_months': 'semester',
      '6_plus_months': 'ongoing',
    };
    params.set('project_length', plMap[config.projectLength] || '');
  }

  // Hours per week
  if (config.hoursPerWeek) {
    params.set('hours_per_week', config.hoursPerWeek === 'less_30' ? 'less' : 'more');
  }

  // Contract to hire
  if (config.contractToHire) params.set('contract_to_hire', '1');

  // US only
  if (config.usOnly) params.set('location', 'United States');

  // Posted within
  if (config.postedWithin) {
    const pwMap: Record<string, string> = {
      '24h': '1', '3d': '3', '7d': '7', '14d': '14', '30d': '30',
    };
    params.set('per_page', '50');
    params.set('days', pwMap[config.postedWithin] || '');
  }

  return `${UPWORK_SEARCH}?${params.toString()}`;
}

// ─── Shared Job Tile Extraction JS ───────────────────────────

// Universal extractor that works on both search results (article.job-tile)
// and find-work tabs (section.air3-card-hover). Verified Feb 2026.
const JOB_TILE_EXTRACTION_JS = `
(function() {
  var jobs = [];

  // Strategy 1: Search results page (article.job-tile with data-test attrs)
  var tiles = document.querySelectorAll('article.job-tile');

  if (tiles.length > 0) {
    var maxTiles = Math.min(tiles.length, 30);
    for (var ti = 0; ti < maxTiles; ti++) { var tile = tiles[ti];
      try {
        var titleEl = tile.querySelector('[data-test*="job-tile-title-link"]');
        var title = titleEl ? titleEl.innerText.trim() : '';
        var url = titleEl ? titleEl.href : '';

        var descEl = tile.querySelector('[data-test*="JobDescription"]');
        var description = descEl ? descEl.innerText.trim().substring(0, 300) : '';

        var budgetEl = tile.querySelector('[data-test="is-fixed-price"]') ||
                       tile.querySelector('[data-test="job-type-label"]');
        var budgetText = budgetEl ? budgetEl.innerText.trim() : '';

        var skillEls = tile.querySelectorAll('[data-test="token"]');
        var skills = [];
        skillEls.forEach(function(s) { skills.push(s.innerText.trim()); });

        var proposalEl = tile.querySelector('[data-test="proposals-tier"]');
        var proposalText = proposalEl ? proposalEl.innerText.trim() : '';
        var proposalMatch = proposalText.match(/(\\d+)/);
        var proposals = proposalMatch ? parseInt(proposalMatch[1]) : 0;

        var postedEl = tile.querySelector('[data-test="job-pubilshed-date"]');
        var posted = postedEl ? postedEl.innerText.trim() : '';

        var levelEl = tile.querySelector('[data-test="experience-level"]');
        var level = levelEl ? levelEl.innerText.trim() : '';

        var spentEl = tile.querySelector('[data-test="total-spent"]');
        var ratingEl = tile.querySelector('[data-test*="feedback-rating"]');
        var locEl = tile.querySelector('[data-test="location"]');
        var verifiedEl = tile.querySelector('[data-test="payment-verified"]');

        var clientInfo = {
          totalSpent: spentEl ? spentEl.innerText.trim().split(String.fromCharCode(10))[0] : '',
          reviewScore: ratingEl ? (function(){ var m = ratingEl.innerText.trim().match(/[\\d.]+/); return m ? parseFloat(m[0]) : 0; })() : 0,
          location: locEl ? locEl.innerText.trim().replace('Location ', '') : '',
          paymentVerified: !!verifiedEl,
          hireRate: '',
          jobsPosted: 0,
        };

        var idMatch = url.match(/~(\\d+)/);
        var jobId = idMatch ? idMatch[1] : Date.now().toString();

        if (title) {
          jobs.push(JSON.stringify({
            id: jobId,
            title: title,
            description: description,
            url: url.split('?')[0],
            budget: { text: budgetText },
            skills: skills,
            experienceLevel: level,
            postedAt: posted,
            proposals: proposals,
            proposalTier: proposalText,
            clientInfo: clientInfo,
          }));
        }
      } catch(e) {}
    }
  }

  // Strategy 2: Find-work tabs (section.air3-card-hover with text parsing)
  if (jobs.length === 0) {
    var sections = document.querySelectorAll('section.air3-card-hover');
    sections.forEach(function(sec) {
      try {
        var titleEl = sec.querySelector('h3 a, h4 a, h2 a');
        var title = titleEl ? titleEl.innerText.trim() : '';
        var url = titleEl ? titleEl.href : '';
        if (!title || !url.includes('/jobs/')) return;

        // Description
        var descEl = sec.querySelector('.air3-line-clamp-wrapper, [class*=description]');
        var description = descEl ? descEl.innerText.trim().replace(/^Job Description:\\s*/i, '').substring(0, 500) : '';

        // Posted
        var postedEl = sec.querySelector('[data-test="posted-on"]');
        var posted = postedEl ? postedEl.innerText.trim() : '';

        // Skills
        var skillEls = sec.querySelectorAll('.air3-token, [data-test="token"]');
        var skills = [];
        skillEls.forEach(function(s) { skills.push(s.innerText.trim()); });

        // Parse budget, level, proposals, client info from full text
        var fullText = sec.innerText;

        // Budget
        var budgetText = '';
        var budgetMatch = fullText.match(/(Fixed-price|Hourly)[^\\n]*(\\$[\\d,]+(?:\\.\\d+)?(?:\\s*-\\s*\\$[\\d,]+(?:\\.\\d+)?)?)/i);
        if (budgetMatch) budgetText = budgetMatch[0].trim();
        else {
          var estMatch = fullText.match(/Est\\.?\\s*Budget:\\s*(\\$[\\d,.]+)/i);
          if (estMatch) budgetText = 'Fixed-price - Est. Budget: ' + estMatch[1];
          var hourlyMatch = fullText.match(/(\\$[\\d.]+)\\s*-\\s*(\\$[\\d.]+).*?\\/hr/i);
          if (hourlyMatch) budgetText = hourlyMatch[0];
        }

        // Experience level
        var level = '';
        if (fullText.includes('Expert')) level = 'Expert';
        else if (fullText.includes('Intermediate')) level = 'Intermediate';
        else if (fullText.includes('Entry Level') || fullText.includes('Entry level')) level = 'Entry Level';

        // Proposals
        var proposals = 0;
        var propMatch = fullText.match(/Proposals:\\s*(\\d+)\\s*(?:to\\s*(\\d+))?/i);
        if (propMatch) proposals = parseInt(propMatch[2] || propMatch[1]);
        var proposalTier = propMatch ? propMatch[0] : '';

        // Client info from text
        var paymentVerified = fullText.includes('Payment verified');
        var spentMatch = fullText.match(/(\\$[\\d,.]+K?\\+?)\\s*(?:total\\s*)?spent/i);
        var totalSpent = spentMatch ? spentMatch[1] : '';
        var ratingMatch = fullText.match(/(\\d\\.\\d+)\\s*(?:of|out|star)/i);
        var reviewScore = ratingMatch ? parseFloat(ratingMatch[1]) : 0;
        var locMatch = fullText.match(/(?:Location|from)\\s+([A-Z][\\w\\s,]+?)(?:\\n|$)/i);
        var location = locMatch ? locMatch[1].trim() : '';

        var clientInfo = {
          totalSpent: totalSpent,
          reviewScore: reviewScore,
          location: location,
          paymentVerified: paymentVerified,
          hireRate: '',
          jobsPosted: 0,
        };

        var idMatch = url.match(/~(\\d+)/);
        var jobId = idMatch ? idMatch[1] : url.split('/').filter(Boolean).pop() || Date.now().toString();

        jobs.push(JSON.stringify({
          id: jobId,
          title: title,
          description: description,
          url: url.split('?')[0],
          budget: { text: budgetText },
          skills: skills,
          experienceLevel: level,
          postedAt: posted,
          proposals: proposals,
          proposalTier: proposalTier,
          clientInfo: clientInfo,
        }));
      } catch(e) {}
    });
  }

  return '[' + jobs.join(',') + ']';
})()
`;

function parseJobTiles(raw: any[]): UpworkJob[] {
  return raw.map((j: any) => ({
    ...j,
    budget: parseBudget(j.budget?.text || ''),
    connectsCost: 0,
    isInviteOnly: false,
    category: '',
    scrapedAt: new Date().toISOString(),
  }));
}

// ─── Job Search (Full Filter Support) ────────────────────────

export async function searchJobs(
  config: Partial<JobSearchConfig> = {},
  driver?: SafariDriver
): Promise<UpworkJob[]> {
  const d = driver || getDefaultDriver();
  const search: JobSearchConfig = { ...DEFAULT_SEARCH_CONFIG, ...config };

  const searchUrl = buildSearchUrl(search);
  const success = await d.navigateTo(searchUrl);
  if (!success) return [];

  await d.wait(4000);

  // Handle Cloudflare CAPTCHA if present
  const captchaCleared = await d.handleCaptchaIfPresent();
  if (!captchaCleared) return [];

  // Wait for job tiles to appear (up to 10s)
  const hasContent = await d.waitForElement('article.job-tile, section.air3-card-hover', 10000);
  if (!hasContent) {
    await d.wait(3000); // extra grace period
  }

  const jobsJson = await d.executeJS(JOB_TILE_EXTRACTION_JS);

  try {
    const raw = JSON.parse(jobsJson || '[]');
    return parseJobTiles(raw);
  } catch {
    return [];
  }
}

// ─── Extract Jobs from Current Page (for tabs) ──────────────

export async function extractJobsFromCurrentPage(driver?: SafariDriver): Promise<UpworkJob[]> {
  const d = driver || getDefaultDriver();
  const jobsJson = await d.executeJS(JOB_TILE_EXTRACTION_JS);

  try {
    const raw = JSON.parse(jobsJson || '[]');
    return parseJobTiles(raw);
  } catch {
    return [];
  }
}

// ─── Browse Tab + Extract ────────────────────────────────────

export async function getJobsFromTab(tab: JobTab, driver?: SafariDriver): Promise<{
  success: boolean;
  tab: string;
  jobs: UpworkJob[];
  count: number;
}> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToTab(tab, d);
  if (!nav.success) return { success: false, tab, jobs: [], count: 0 };

  await d.wait(2000);
  const jobs = await extractJobsFromCurrentPage(d);
  return { success: true, tab, jobs, count: jobs.length };
}

// ─── Budget Parser ───────────────────────────────────────────

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

// ─── Expand Truncated Description ────────────────────────────

/**
 * Click "more" / "View more" / truncation expand button on the job detail page
 * so the full description text is revealed before extraction.
 * Upwork uses an air3-truncation-btn or a "more"/"View more" link to collapse long descriptions.
 */
async function expandJobDescription(d: SafariDriver): Promise<void> {
  const clicked = await d.executeJS(`
    (function() {
      // Strategy 1: Upwork's truncation button (air3-truncation-btn)
      var truncBtn = document.querySelector('.air3-truncation-btn, button.air3-truncation-btn');
      if (truncBtn) {
        var r = truncBtn.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          truncBtn.click();
          return 'truncation_btn';
        }
      }

      // Strategy 2: "more" / "View more" link inside or near description
      var descSection = document.querySelector('[data-test="Description"]') || document.body;
      var links = descSection.querySelectorAll('a, button, span[role="button"]');
      for (var l of links) {
        var txt = l.innerText.trim().toLowerCase();
        if (txt === 'more' || txt === 'view more' || txt === 'read more' || txt === 'show more' || txt === '...more') {
          var lr = l.getBoundingClientRect();
          if (lr.width > 0 && lr.height > 0) {
            l.click();
            return 'more_link';
          }
        }
      }

      // Strategy 3: Any button/link on the page with "more" text near the description
      var allBtns = document.querySelectorAll('button, a, span[role="button"]');
      for (var b of allBtns) {
        var bt = b.innerText.trim().toLowerCase();
        if ((bt === 'more' || bt === 'view more' || bt === 'read more') && !bt.includes('profile') && !bt.includes('nav')) {
          var br = b.getBoundingClientRect();
          // Only click if it's in the main content area (y > 100, y < 1000)
          if (br.width > 0 && br.height > 0 && br.y > 100 && br.y < 1000) {
            b.click();
            return 'fallback_btn';
          }
        }
      }

      return 'no_expand_needed';
    })()
  `);
  if (clicked !== 'no_expand_needed') {
    console.log(`[Upwork] Expanded description: ${clicked}`);
    await d.wait(800);
  }
}

// ─── Full Job Detail Page Extraction ─────────────────────────

export async function extractJobDetail(jobUrl: string, driver?: SafariDriver): Promise<UpworkJobDetail | null> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToJob(jobUrl, d);
  if (!nav.success) return null;

  await d.wait(3000);

  // Click "more" / "View more" / truncation button to reveal full description
  await expandJobDescription(d);

  const detailJson = await d.executeJS(`
(function() {
  var result = {};

  // Title — Upwork job detail uses h4, not h1
  var titleEl = document.querySelector('h4') || document.querySelector('h1');
  result.title = titleEl ? titleEl.innerText.trim() : '';

  // Full description — [data-test="Description"]
  var descEl = document.querySelector('[data-test="Description"]');
  result.fullDescription = descEl ? descEl.innerText.trim() : '';

  // Skills/tokens — detail page uses .air3-badge, search uses .air3-token
  var skillEls = document.querySelectorAll('.air3-badge, .air3-token, [data-test="token"]');
  result.skills = [];
  var seen = {};
  skillEls.forEach(function(s) {
    var t = s.innerText.trim();
    if (t && t.length > 1 && t.length < 50 && !seen[t]) {
      seen[t] = true;
      result.skills.push(t);
    }
  });

  // Parse all <li> elements — Upwork puts project metadata and client info in li items
  var lis = document.querySelectorAll('li');
  result.experienceLevel = '';
  result.budgetText = '';
  result.projectType = '';
  result.projectLength = '';
  result.weeklyHours = '';
  result.proposalsCount = 0;
  result.interviewing = 0;
  result.invitesSent = 0;
  result.unansweredInvites = 0;

  lis.forEach(function(li) {
    var t = li.innerText.trim();

    // Experience level: "Intermediate\\nI am looking for..."
    if (t.match(/^(Entry Level|Intermediate|Expert)/)) {
      result.experienceLevel = t.split(String.fromCharCode(10))[0].trim();
    }

    // Hours/week + job type: "Less than 30 hrs/week\\nHourly"
    if (t.match(/hrs\\/week/i)) {
      result.weeklyHours = t.split(String.fromCharCode(10))[0].trim();
      if (t.toLowerCase().includes('hourly')) result.budgetText = 'Hourly';
    }

    // Duration: "1 to 3 months\\nDuration"
    if (t.match(/Duration$/im)) {
      result.projectLength = t.split(String.fromCharCode(10))[0].trim();
    }

    // Project type: "Project Type:Ongoing project"
    if (t.match(/^Project Type:/i)) {
      result.projectType = t.replace(/^Project Type:/i, '').trim();
    }

    // Proposals: "Proposals:\\n10 to 15"
    if (t.match(/^Proposals:/i)) {
      var pm = t.match(/(\\d+)\\s*(?:to\\s*(\\d+))?/);
      if (pm) result.proposalsCount = parseInt(pm[2] || pm[1]);
    }

    // Interviewing
    if (t.match(/^Interviewing:/i)) {
      var im = t.match(/(\\d+)/);
      if (im) result.interviewing = parseInt(im[1]);
    }

    // Invites sent
    if (t.match(/^Invites sent:/i)) {
      var isM = t.match(/(\\d+)/);
      if (isM) result.invitesSent = parseInt(isM[1]);
    }

    // Unanswered invites
    if (t.match(/^Unanswered invites:/i)) {
      var ui = t.match(/(\\d+)/);
      if (ui) result.unansweredInvites = parseInt(ui[1]);
    }

    // Fixed-price budget from li text
    if (t.match(/^\\$[\\d,.]+$/) && !result.budgetText) {
      result.budgetText = 'Fixed-price - ' + t;
    }
  });

  // Build activity summary
  result.activityOnJob = 'Proposals: ' + result.proposalsCount +
    ', Interviewing: ' + result.interviewing +
    ', Invites: ' + result.invitesSent +
    ', Unanswered: ' + result.unansweredInvites;

  // Connects required + available — scan for "connects" text
  result.connectsRequired = 0;
  result.availableConnects = 0;
  var allSpans = document.querySelectorAll('span, p, div, strong');
  for (var cel of allSpans) {
    var ct = cel.innerText.trim();
    if (ct.length > 5 && ct.length < 80) {
      if (ct.match(/(\\d+)\\s*connects?\\s*(?:required|to submit|needed)/i)) {
        var cm = ct.match(/(\\d+)/);
        if (cm) result.connectsRequired = parseInt(cm[1]);
      }
      if (ct.match(/(?:you have|available)[^\\d]*(\\d+)\\s*connect/i)) {
        var am = ct.match(/(\\d+)/);
        if (am) result.availableConnects = parseInt(am[1]);
      }
      if (ct.match(/(\\d+)\\s*connect/i) && !result.connectsRequired) {
        var cm2 = ct.match(/(\\d+)\\s*connect/i);
        if (cm2) result.connectsRequired = parseInt(cm2[1]);
      }
    }
  }

  // Questions for freelancer
  result.questionsForFreelancer = [];
  var questionEls = document.querySelectorAll('[data-test*="question"], .question-text');
  questionEls.forEach(function(q) {
    var qt = q.innerText.trim();
    if (qt) result.questionsForFreelancer.push(qt);
  });

  // Attachments
  result.attachments = [];
  var attachEls = document.querySelectorAll('[data-test*="attachment"] a, .attachment a');
  attachEls.forEach(function(a) {
    result.attachments.push(a.innerText.trim() || a.href);
  });

  // Client info — [data-test="about-client-container"]
  var clientSection = document.querySelector('[data-test="about-client-container"]');
  result.clientInfo = { paymentVerified: false, location: '', totalSpent: '', hireRate: '', jobsPosted: 0, reviewScore: 0 };
  if (clientSection) {
    var cText = clientSection.innerText;

    result.clientInfo.paymentVerified = cText.includes('Payment') && cText.includes('verified');

    var spentMatch = cText.match(/(\\$[\\d,.]+K?\\+?)\\s*total\\s*spent/i);
    if (spentMatch) result.clientInfo.totalSpent = spentMatch[1];

    var rateMatch = cText.match(/(\\d+)%\\s*hire\\s*rate/i);
    if (rateMatch) result.clientInfo.hireRate = rateMatch[1] + '%';

    var postedMatch = cText.match(/(\\d+)\\s*jobs?\\s*posted/i);
    if (postedMatch) result.clientInfo.jobsPosted = parseInt(postedMatch[1]);

    var openMatch = cText.match(/(\\d+)\\s*open\\s*job/i);
    if (openMatch) result.clientOpenJobs = parseInt(openMatch[1]);

    var ratingMatch = cText.match(/Rating is (\\d\\.\\d+)/i) || cText.match(/(\\d\\.\\d+)\\s*of\\s*\\d/i);
    if (ratingMatch) result.clientInfo.reviewScore = parseFloat(ratingMatch[1]);

    // Location — scan lines for country (skip "Payment method verified" line)
    var cLines = cText.split(String.fromCharCode(10)).map(function(l) { return l.trim(); });
    for (var li = 0; li < cLines.length; li++) {
      var cl = cLines[li];
      if (cl.match(/^(United States|Canada|United Kingdom|Australia|Germany|France|India|Philippines|Pakistan|Brazil|Nigeria|[A-Z][a-z]+ [A-Z][a-z]+)/) && !cl.match(/Payment|Rating|Member|review/i)) {
        result.clientInfo.location = cl;
        break;
      }
    }
    var locMatch = null; // Already handled above
    if (locMatch) result.clientInfo.location = locMatch[1];

    var joinedMatch = cText.match(/Member since\\s*(.+?)(?:\\n|$)/i);
    if (joinedMatch) result.clientJoined = joinedMatch[1].trim();

    var avgRateMatch = cText.match(/(\\$[\\d.]+)\\s*\\/hr\\s*avg/i);
    if (avgRateMatch) result.clientAvgHourlyRate = avgRateMatch[1];

    var totalSpentMatch = cText.match(/(\\$[\\d,.]+K?\\+?)\\s*total/i);
    if (totalSpentMatch) result.clientTotalSpent = totalSpentMatch[1];

    var hiresMatch = cText.match(/(\\d+)\\s*hires?,/i);
    if (hiresMatch) result.clientHires = parseInt(hiresMatch[1]);
  }

  // Posted date — look for "Posted X ago" text
  result.postedAt = '';
  var timeEls = document.querySelectorAll('span, small, time');
  for (var te of timeEls) {
    var tt = te.innerText.trim();
    if (tt.match(/^Posted\\s+/i) || tt.match(/\\d+\\s*(minute|hour|day|week)s?\\s*ago/i)) {
      result.postedAt = tt.replace(/^Posted\\s+/i, '');
      break;
    }
  }

  result.url = window.location.href.split('?')[0];
  var idMatch = result.url.match(/~(\\d+)/);
  result.id = idMatch ? idMatch[1] : '';

  return JSON.stringify(result);
})()
  `);

  try {
    const raw = JSON.parse(detailJson || '{}');
    return {
      ...raw,
      id: raw.id || jobUrl.match(/~(\d+)/)?.[1] || Date.now().toString(),
      budget: parseBudget(raw.budgetText || ''),
      description: raw.fullDescription?.substring(0, 500) || '',
      connectsCost: raw.connectsRequired || 0,
      isInviteOnly: false,
      category: '',
      scrapedAt: new Date().toISOString(),
    } as UpworkJobDetail;
  } catch {
    return null;
  }
}

// ─── Smart Connects Recommendation Engine ────────────────────

export function recommendConnects(
  job: UpworkJob,
  score: JobScore,
  availableConnects: number = 100,
): JobScore['connectsRecommendation'] {
  const proposals = job.proposals || 0;
  const budget = job.budget.amount || job.budget.max || job.budget.min || 0;

  // Determine competition level
  let competitionLevel: 'low' | 'medium' | 'high' | 'very_high';
  if (proposals <= 5) competitionLevel = 'low';
  else if (proposals <= 15) competitionLevel = 'medium';
  else if (proposals <= 30) competitionLevel = 'high';
  else competitionLevel = 'very_high';

  // Base connects by competition
  let suggestedConnects: number;
  if (competitionLevel === 'low') suggestedConnects = 2;
  else if (competitionLevel === 'medium') suggestedConnects = 6;
  else if (competitionLevel === 'high') suggestedConnects = 10;
  else suggestedConnects = 16;

  // Adjust for budget (higher budget = worth more connects)
  if (budget >= 5000) suggestedConnects = Math.min(suggestedConnects + 6, 16);
  else if (budget >= 1000) suggestedConnects = Math.min(suggestedConnects + 4, 16);
  else if (budget >= 500) suggestedConnects = Math.min(suggestedConnects + 2, 16);

  // Adjust for score (high score jobs = bid more aggressively)
  if (score.totalScore >= 70) suggestedConnects = Math.min(suggestedConnects + 4, 16);
  else if (score.totalScore >= 55) suggestedConnects = Math.min(suggestedConnects + 2, 16);
  else if (score.totalScore < 35) suggestedConnects = Math.max(suggestedConnects - 4, 2);

  // Adjust for client quality
  if (job.clientInfo.paymentVerified && (job.clientInfo.reviewScore || 0) >= 4.5) {
    suggestedConnects = Math.min(suggestedConnects + 2, 16);
  }

  // Cap at available connects
  suggestedConnects = Math.min(suggestedConnects, availableConnects);

  // Build reasoning
  const reasons: string[] = [];
  reasons.push(`Competition: ${competitionLevel} (${proposals} proposals)`);
  if (budget > 0) reasons.push(`Budget: $${budget}`);
  if (score.totalScore >= 70) reasons.push('High score — bid aggressively');
  else if (score.totalScore < 35) reasons.push('Low score — conserve connects');
  if (job.clientInfo.paymentVerified) reasons.push('Payment verified client');

  return {
    suggestedConnects,
    reasoning: reasons.join('. '),
    competitionLevel,
  };
}

// ─── Job Scoring (with Connects) ─────────────────────────────

export function scoreJob(
  job: UpworkJob,
  preferredSkills: string[] = [],
  minBudget: number = 0,
  availableConnects: number = 100,
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

  const partialScore: Omit<JobScore, 'connectsRecommendation'> = {
    jobId: job.id,
    totalScore,
    factors,
    recommendation,
    reason: reasons.join(', '),
  };

  const connectsRecommendation = recommendConnects(job, partialScore as JobScore, availableConnects);

  return {
    ...partialScore,
    connectsRecommendation,
  };
}

// ─── Saved Jobs ──────────────────────────────────────────────

export async function saveJob(jobUrl: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  await navigateToJob(jobUrl, d);
  await d.wait(2000);

  const result = await d.executeJS(`
    (function() {
      var btn = document.querySelector('[data-test="JobActionSave"]') ||
                document.querySelector('[data-test="save-job"]') ||
                document.querySelector('[aria-label*="Save"]');
      if (btn) { btn.click(); return 'saved'; }
      return 'not_found';
    })()
  `);

  return result === 'saved';
}

export async function unsaveJob(jobUrl: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  await navigateToJob(jobUrl, d);
  await d.wait(2000);

  const result = await d.executeJS(`
    (function() {
      var btn = document.querySelector('[data-test="JobActionUnsave"]') ||
                document.querySelector('[data-test="unsave-job"]') ||
                document.querySelector('[aria-label*="Unsave"]') ||
                document.querySelector('[aria-label*="Remove"]');
      if (btn) { btn.click(); return 'unsaved'; }
      // If already unsaved, the button might show "Save" instead
      var saveBtn = document.querySelector('[data-test="JobActionSave"]');
      if (saveBtn && !saveBtn.classList.contains('active')) return 'already_unsaved';
      return 'not_found';
    })()
  `);

  return result === 'unsaved' || result === 'already_unsaved';
}

export async function getSavedJobs(driver?: SafariDriver): Promise<UpworkJob[]> {
  const d = driver || getDefaultDriver();

  // Navigate to saved jobs tab
  await navigateToTab('saved_jobs', d);
  await d.wait(3000);

  // Extract jobs from the saved jobs page
  const jobs = await extractJobsFromCurrentPage(d);

  return jobs;
}

// ─── Rate Limit Detection ────────────────────────────────────

export interface RateLimitStatus {
  limited: boolean;
  captcha: boolean;
  message: string;
}

export async function detectUpworkRateLimit(driver?: SafariDriver): Promise<RateLimitStatus> {
  const d = driver || getDefaultDriver();

  const result = await d.executeJS(`
    (function() {
      var bodyText = document.body.innerText || document.body.textContent || '';
      var lowerText = bodyText.toLowerCase();

      // Check for rate limit keywords
      var rateLimitKeywords = ['robot', 'unusual activity', 'verify', 'captcha', 'too many requests', 'rate limit'];
      var hasRateLimitText = rateLimitKeywords.some(function(keyword) {
        return lowerText.includes(keyword);
      });

      // Check for captcha elements
      var captchaSelectors = [
        '[class*="captcha"]',
        '#px-captcha',
        '[id*="captcha"]',
        'iframe[src*="captcha"]',
        '[data-test*="captcha"]'
      ];

      var hasCaptcha = false;
      for (var selector of captchaSelectors) {
        if (document.querySelector(selector)) {
          hasCaptcha = true;
          break;
        }
      }

      // Determine message
      var message = '';
      if (hasCaptcha) {
        message = 'CAPTCHA detected - manual verification required';
      } else if (hasRateLimitText) {
        message = 'Rate limit or unusual activity detected';
      } else {
        message = 'No rate limit detected';
      }

      return JSON.stringify({
        limited: hasRateLimitText || hasCaptcha,
        captcha: hasCaptcha,
        message: message
      });
    })()
  `);

  try {
    return JSON.parse(result as string);
  } catch {
    return {
      limited: false,
      captcha: false,
      message: 'Could not detect rate limit status',
    };
  }
}

// ─── Connects Balance ────────────────────────────────────────

export interface ConnectsBalance {
  balance: number;
  lastChecked: string;
}

export async function getConnectsBalance(driver?: SafariDriver): Promise<ConnectsBalance> {
  const d = driver || getDefaultDriver();

  // Navigate to Upwork homepage to ensure we're on the site
  const currentUrl = await d.getCurrentUrl();
  if (!currentUrl.includes('upwork.com')) {
    await d.navigateTo('https://www.upwork.com/nx/find-work/');
    await d.wait(2000);
  }

  // Extract connects balance from the page
  const balanceStr = await d.executeJS(`
    (function() {
      // Try multiple selectors for connects count
      var selectors = [
        '[data-test="connects-count"]',
        '[class*="connects"]',
        '[aria-label*="connects"]',
        'div:contains("Connects")',
        'span:contains("Connects")'
      ];

      for (var selector of selectors) {
        var el = document.querySelector(selector);
        if (el) {
          var text = el.innerText || el.textContent || '';
          // Extract number from text like "120 Connects" or "Connects: 120"
          var match = text.match(/\\d+/);
          if (match) return match[0];
        }
      }

      // Fallback: search for text containing number and "connect"
      var allText = document.body.innerText || '';
      var connectMatch = allText.match(/(\\d+)\\s*(?:Connects?|available)/i);
      if (connectMatch) return connectMatch[1];

      return '0';
    })()
  `);

  const balance = parseInt(balanceStr as string, 10) || 0;

  return {
    balance,
    lastChecked: new Date().toISOString(),
  };
}

// ─── Proposal Submission ─────────────────────────────────────

export interface ProposalSubmission {
  jobUrl: string;
  coverLetter: string;
  hourlyRate?: number;           // e.g. 75 for $75/hr (hourly jobs only)
  fixedPrice?: number;           // e.g. 1200 for $1200 (fixed-price jobs only)
  milestoneDescription?: string; // e.g. "Complete project deliverables"
  projectDuration?: string;      // e.g. "Less than a month", "1 to 3 months"
  paymentMode?: 'milestone' | 'project'; // "milestone" = by milestone, "project" = by project (one lump)
  screeningAnswers?: string[];   // answers in order of questions shown
  attachments?: string[];        // absolute file paths to attach (max 10, max 25MB each)
  boostConnects?: number;        // additional connects for boosting (0 = no boost)
  dryRun?: boolean;              // if true, fills form but does NOT click submit
}

export interface ProposalResult {
  success: boolean;
  submitted: boolean;
  jobTitle: string;
  connectsCost: number;
  bidAmount: string;
  coverLetterLength: number;
  questionsAnswered: number;
  filesAttached: number;
  formType: 'hourly' | 'fixed' | 'unknown';
  error?: string;
  dryRun: boolean;
}

/**
 * Helper: set a value on an input via OS-level click + clipboard paste.
 * Works on Upwork's masked/formatted inputs that ignore programmatic JS changes.
 */
async function setInputViaClipboard(
  d: SafariDriver, selector: string, value: string
): Promise<boolean> {
  const coordsJson = await d.executeJS(`
    (function() {
      var input = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (!input) return JSON.stringify({ found: false });
      input.scrollIntoView({ block: 'center' });
      var r = input.getBoundingClientRect();
      return JSON.stringify({ found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()
  `);
  try {
    const coords = JSON.parse(coordsJson);
    if (!coords.found) return false;
    await d.clickAtViewportPosition(coords.x, coords.y);
    await d.wait(400);
    await d.executeJS(`(function(){ var el = document.activeElement; if(el && el.select) el.select(); })()`);
    await d.wait(200);
    await d.typeViaClipboard(value);
    await d.wait(300);
    await d.pressTab();
    await d.wait(500);
    return true;
  } catch { return false; }
}

/**
 * Helper: set a currency input via OS-level click + Cmd+A + Delete + type digits.
 * More reliable than clipboard paste for Upwork's currency fields that have
 * custom formatting (adds $, commas, decimal) and React state binding.
 */
async function setCurrencyInput(
  d: SafariDriver, selector: string, amount: number
): Promise<boolean> {
  // Ensure amount is positive
  const value = String(Math.abs(Math.round(amount)));
  const coordsJson = await d.executeJS(`
    (function() {
      var input = document.querySelector('${selector.replace(/'/g, "\\'")}');
      if (!input) return JSON.stringify({ found: false });
      input.scrollIntoView({ block: 'center' });
      var r = input.getBoundingClientRect();
      return JSON.stringify({ found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    })()
  `);
  try {
    const coords = JSON.parse(coordsJson);
    if (!coords.found) return false;

    // Click field to focus
    await d.clickAtViewportPosition(coords.x, coords.y);
    await d.wait(300);

    // Triple-click to select all content in the field
    await d.clickAtViewportPosition(coords.x, coords.y);
    await d.wait(50);
    await d.clickAtViewportPosition(coords.x, coords.y);
    await d.wait(200);

    // Cmd+A to ensure full selection, then Delete to clear
    await d.executeJS(`(function(){ var el = document.activeElement; if(el && el.select) el.select(); })()`);
    await d.wait(100);

    // Delete selected content
    await execAsync(
      `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke (ASCII character 127)'`
    );
    await d.wait(300);

    // Type digits one by one via AppleScript keystrokes
    for (const char of value) {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "${char}"'`
      );
      await d.wait(80);
    }
    await d.wait(300);

    // Tab out to trigger Upwork's formatting + validation
    await d.pressTab();
    await d.wait(500);
    return true;
  } catch { return false; }
}

/**
 * Helper: set a textarea value using native setter + React-compatible events.
 */
function buildTextareaSetter(escapedText: string, selectorOrIndex: string | number): string {
  const finder = typeof selectorOrIndex === 'number'
    ? `document.querySelectorAll('textarea')[${selectorOrIndex}]`
    : `document.querySelector('${selectorOrIndex}')`;
  return `
    (function() {
      var ta = ${finder};
      if (!ta) return 'not_found';
      var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSet.call(ta, '${escapedText}');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new Event('change', { bubbles: true }));
      ta.dispatchEvent(new Event('blur', { bubbles: true }));
      return 'filled';
    })()
  `;
}

function escapeForJS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

export async function submitProposal(
  submission: ProposalSubmission,
  driver?: SafariDriver
): Promise<ProposalResult> {
  const d = driver || getDefaultDriver();
  const result: ProposalResult = {
    success: false,
    submitted: false,
    jobTitle: '',
    connectsCost: 0,
    bidAmount: '',
    coverLetterLength: submission.coverLetter.length,
    questionsAnswered: 0,
    filesAttached: 0,
    formType: 'unknown',
    dryRun: submission.dryRun ?? false,
  };

  try {
    // ── Step 1: Navigate to job detail page ──
    const nav = await navigateToJob(submission.jobUrl, d);
    if (!nav.success) {
      result.error = 'Failed to navigate to job';
      return result;
    }
    await d.wait(3000);

    // Expand truncated description before reading the page
    await expandJobDescription(d);

    // Get job title
    result.jobTitle = await d.executeJS(`
      (function() {
        var h = document.querySelector('h4') || document.querySelector('h1');
        return h ? h.innerText.trim() : '';
      })()
    `);

    // ── Step 2: Click "Apply now" button ──
    const clickResult = await d.executeJS(`
      (function() {
        if (window.location.href.includes('/apply')) return 'already_on_apply';
        var btn = document.querySelector('button[aria-label="Apply now"]') ||
                  document.querySelector('button.air3-btn-primary');
        if (btn && btn.innerText.trim().toLowerCase().includes('apply')) {
          btn.click();
          return 'clicked';
        }
        return 'not_found';
      })()
    `);

    if (clickResult === 'not_found') {
      result.error = 'Apply button not found — job may be closed or already applied';
      return result;
    }

    await d.wait(5000);

    // Check if we landed on the proposal form
    const onProposalPage = await d.executeJS(`
      window.location.href.includes('/apply') ||
      document.title.includes('Submit a Proposal') ? 'yes' : 'no'
    `);

    if (onProposalPage !== 'yes') {
      await d.handleCaptchaIfPresent();
      await d.wait(3000);
    }

    // Expand truncated job description on the proposal form page ("more/Less about" button)
    await expandJobDescription(d);

    // ── Step 3: Detect form type (hourly vs fixed-price) ──
    const formType = await d.executeJS(`
      (function() {
        var milestoneRadio = document.querySelector('input[name="milestoneMode"]');
        var rateInput = document.getElementById('step-rate') ||
                        document.querySelector('input[id*="rate"]');
        if (milestoneRadio) return 'fixed';
        if (rateInput) return 'hourly';
        // Fallback: check page text
        var body = document.body.innerText;
        if (body.includes('By milestone') || body.includes('Milestone')) return 'fixed';
        if (body.includes('Hourly Rate') || body.includes('Your rate')) return 'hourly';
        return 'unknown';
      })()
    `);
    result.formType = formType as 'hourly' | 'fixed' | 'unknown';
    console.log(`[Upwork] Form type detected: ${formType}`);

    // ── Step 4: Fill pricing based on form type ──
    if (formType === 'fixed') {
      const price = Math.max(submission.fixedPrice || 0, 5); // Minimum $5
      const mode = submission.paymentMode || 'milestone';
      const milestoneDesc = submission.milestoneDescription || 'Complete project deliverables per requirements';

      // 4a: Select payment mode ("By project" = default radio, "By milestone" = milestone radio)
      const modeValue = mode === 'milestone' ? 'milestone' : 'default';
      await d.executeJS(`
        (function() {
          var radios = document.querySelectorAll('input[name="milestoneMode"]');
          for (var r of radios) {
            if (r.value === '${modeValue}') {
              r.click();
              r.dispatchEvent(new Event('change', { bubbles: true }));
              return 'selected_' + r.value;
            }
          }
          return 'no_radio';
        })()
      `);
      await d.wait(1000);

      // 4b: Fill milestone description (only in "By milestone" mode)
      if (mode === 'milestone') {
        const descInput = await d.executeJS(`
          (function() {
            var input = document.querySelector('[data-test="milestone-description"] input') ||
                        document.querySelector('input.milestone-description');
            if (!input) {
              var ms = document.querySelector('[data-test="milestones"], .up-fe-milestones, div[class*="milestone"]');
              if (ms) input = ms.querySelector('input[type="text"]');
            }
            if (!input) return 'not_found';
            var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSet.call(input, '${escapeForJS(milestoneDesc)}');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            return 'filled';
          })()
        `);
        console.log(`[Upwork] Milestone description: ${descInput}`);
        await d.wait(500);
      }

      // 4c: Set total price / milestone amount via OS-level keystroke typing
      // In "By project" mode, target #charged-amount-id (total price the client sees)
      // In "By milestone" mode, target the milestone amount input
      const priceSelector = mode === 'project'
        ? '#charged-amount-id, input[id="charged-amount-id"]'
        : 'input#milestone-amount-1, [data-test="currency-input"]';
      const amountSet = await setCurrencyInput(d, priceSelector, price);
      if (amountSet) {
        console.log(`[Upwork] Price set: $${price} (${mode} mode)`);
      } else {
        console.log(`[Upwork] ⚠️ Currency input not found for selector: ${priceSelector}`);
      }
      await d.wait(500);

      result.bidAmount = `$${price} fixed`;

      // 4d: Select project duration from dropdown
      // Upwork options: "Less than 1 month", "1 to 3 months", "3 to 6 months", "More than 6 months"
      const duration = submission.projectDuration || 'Less than 1 month';
      const durationOpened = await d.executeJS(`
        (function() {
          // Find the duration dropdown — the last combobox/toggle (not nav, not profile)
          var toggles = document.querySelectorAll('div.air3-dropdown-toggle[role="combobox"]');
          var durationToggle = null;
          for (var t of toggles) {
            var text = t.innerText.trim();
            if (text.includes('duration') || text.includes('month') || text.includes('week') || text.includes('Select')) {
              // Exclude nav dropdowns and profile selector
              if (!text.includes('profile') && !text.includes('Profile') && !text.includes('General')) {
                durationToggle = t;
              }
            }
          }
          if (!durationToggle) return 'no_duration_dropdown';
          durationToggle.scrollIntoView({ block: 'center' });
          durationToggle.click();
          return 'opened';
        })()
      `);
      await d.wait(800);

      // Click the matching duration option (only from the duration dropdown, not nav)
      const durationResult = await d.executeJS(`
        (function() {
          // Get dropdown menu that's currently visible (last opened)
          var menus = document.querySelectorAll('ul.air3-dropdown-menu, div.air3-dropdown-menu');
          var visibleMenu = null;
          for (var m of menus) {
            var r = m.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) visibleMenu = m;
          }
          if (!visibleMenu) return 'no_visible_menu';
          var options = visibleMenu.querySelectorAll('li, [role="option"]');
          var target = '${escapeForJS(duration)}'.toLowerCase();
          for (var opt of options) {
            var text = opt.innerText.trim().toLowerCase();
            if (text.includes(target) || target.includes(text.replace(' selected', ''))) {
              opt.click();
              return 'selected: ' + opt.innerText.trim();
            }
          }
          // Fuzzy match: extract key words
          var keywords = target.split(/\\s+/);
          for (var opt of options) {
            var t = opt.innerText.trim().toLowerCase();
            var matches = keywords.filter(function(k) { return t.includes(k); });
            if (matches.length >= 2) {
              opt.click();
              return 'fuzzy: ' + opt.innerText.trim();
            }
          }
          return 'no_match (options: ' + Array.from(options).map(function(o){return o.innerText.trim()}).join(', ').substring(0,200) + ')';
        })()
      `);
      console.log(`[Upwork] Duration: ${durationOpened} → ${durationResult}`);
      await d.wait(500);

    } else if (formType === 'hourly') {
      // Hourly form: set rate via OS-level keystroke typing (clipboard paste unreliable on currency inputs)
      const rate = Math.max(submission.hourlyRate || 50, 3); // Minimum $3/hr
      const rateSet = await setCurrencyInput(
        d,
        '#step-rate, input[id*="rate"], input[id*="bid"]',
        rate
      );
      if (rateSet) console.log(`[Upwork] Rate set: $${rate}/hr`);
      result.bidAmount = `$${rate}/hr`;
      await d.wait(500);

      // Handle optional rate-increase frequency dropdown
      // Options: "Never selected", "Every 3 months", "Every 6 months", "Every 12 months"
      // Select "Never" to dismiss the form validation error
      const freqDropResult = await d.executeJS(`
        (function() {
          var toggles = document.querySelectorAll('div.air3-dropdown-toggle[role="combobox"]');
          for (var t of toggles) {
            var text = t.innerText.trim();
            if (text === 'Select a frequency' || text === 'Never') {
              t.scrollIntoView({ block: 'center' });
              t.click();
              return 'opened';
            }
          }
          return 'not_found';
        })()
      `);
      if (freqDropResult === 'opened') {
        await d.wait(600);
        const freqSelected = await d.executeJS(`
          (function() {
            var menus = document.querySelectorAll('ul.air3-dropdown-menu, div.air3-dropdown-menu');
            for (var m of menus) {
              var r = m.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                var opts = m.querySelectorAll('li, [role="option"]');
                for (var o of opts) {
                  if (o.innerText.trim().toLowerCase().includes('never')) {
                    o.click();
                    return 'selected: ' + o.innerText.trim();
                  }
                }
                // Fallback: first option
                if (opts.length > 0) { opts[0].click(); return 'fallback: ' + opts[0].innerText.trim(); }
              }
            }
            return 'no_menu';
          })()
        `);
        console.log(`[Upwork] Rate-increase frequency: ${freqSelected}`);
        await d.wait(400);
      }
    }

    // ── Step 5: Fill cover letter ──
    // On fixed-price forms, textarea is the cover letter (only textarea on page)
    const coverEscaped = escapeForJS(submission.coverLetter);
    const coverResult = await d.executeJS(buildTextareaSetter(coverEscaped, 0));
    console.log(`[Upwork] Cover letter: ${coverResult} (${submission.coverLetter.length} chars)`);
    await d.wait(500);

    // ── Step 6: Answer screening questions (subsequent textareas) ──
    if (submission.screeningAnswers && submission.screeningAnswers.length > 0) {
      for (let i = 0; i < submission.screeningAnswers.length; i++) {
        const ansEscaped = escapeForJS(submission.screeningAnswers[i]);
        const ansResult = await d.executeJS(buildTextareaSetter(ansEscaped, i + 1));
        if (ansResult === 'filled') result.questionsAnswered++;
        await d.wait(300);
      }
    }

    // ── Step 6.5: Attach files (optional, max 10, max 25MB each) ──
    if (submission.attachments && submission.attachments.length > 0) {
      const maxFiles = Math.min(submission.attachments.length, 10);
      for (let i = 0; i < maxFiles; i++) {
        const filePath = submission.attachments[i];
        // Verify file exists before trying to upload
        try {
          const { stdout: exists } = await execAsync(`test -f "${filePath}" && echo "yes" || echo "no"`);
          if (exists.trim() !== 'yes') {
            console.log(`[Upwork] ⚠️ File not found, skipping: ${filePath}`);
            continue;
          }
          // Check file size (max 25MB)
          const { stdout: sizeStr } = await execAsync(`stat -f%z "${filePath}"`);
          const sizeBytes = parseInt(sizeStr.trim());
          if (sizeBytes > 25 * 1024 * 1024) {
            console.log(`[Upwork] ⚠️ File too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > 25MB), skipping: ${filePath}`);
            continue;
          }
        } catch {
          console.log(`[Upwork] ⚠️ Cannot check file, skipping: ${filePath}`);
          continue;
        }

        const uploaded = await d.uploadFile('input[type="file"]', filePath);
        if (uploaded) {
          result.filesAttached++;
          console.log(`[Upwork] 📎 Attached file ${i + 1}/${maxFiles}: ${filePath.split('/').pop()}`);
        } else {
          console.log(`[Upwork] ⚠️ Failed to attach: ${filePath.split('/').pop()}`);
        }
        await d.wait(1500);
      }
    }

    // ── Step 7: Set boost connects and click "Set bid" ──
    // The boost section has: input for connects + "Set bid" button to confirm.
    // Upwork pre-fills a suggested bid (e.g., 31). We must clear it to our desired value.
    const boostAmount = submission.boostConnects && submission.boostConnects > 0
      ? submission.boostConnects : 0;

    // Clear the boost input and set to our desired value
    const boostSet = await d.executeJS(`
      (function() {
        var input = document.querySelector('input[type="number"]');
        if (!input) return 'no_input';
        input.scrollIntoView({ block: 'center' });
        var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSet.call(input, '${boostAmount}');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        return 'set_to_' + ${boostAmount};
      })()
    `);
    console.log(`[Upwork] Boost connects: ${boostSet}`);
    await d.wait(500);

    // Click "Set bid" button to confirm the bid amount
    const setBidResult = await d.executeJS(`
      (function() {
        var btns = document.querySelectorAll('button');
        for (var b of btns) {
          if (b.innerText.trim() === 'Set bid') {
            b.scrollIntoView({ block: 'center' });
            b.click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);
    console.log('[Upwork] Set bid button: ' + setBidResult);
    await d.wait(1000);

    // ── Step 8: Scroll to bottom and read connects cost + check for errors ──
    const pageState = await d.executeJS(`
      (function() {
        window.scrollTo(0, document.body.scrollHeight);
        var result = {};
        // Find submit button
        var btns = document.querySelectorAll('button.air3-btn-primary, button[type="submit"]');
        var submitBtn = null;
        for (var b of btns) {
          var txt = b.innerText.trim().toLowerCase();
          if (txt.includes('send') || txt.includes('submit') || txt.includes('connect')) {
            submitBtn = b;
            break;
          }
        }
        result.submitText = submitBtn ? submitBtn.innerText.trim() : '';
        result.submitDisabled = submitBtn ? submitBtn.disabled : true;
        // Read connects from summary
        var summaryEls = document.querySelectorAll('[data-test*="summary"], .summary-amount, div[class*="summary"]');
        var summaryText = '';
        summaryEls.forEach(function(el) { summaryText += el.innerText + ' '; });
        result.summary = summaryText.substring(0, 300);
        // Check for validation errors (only VISIBLE ones — hidden DOM errors are not blocking)
        var errors = [];
        var errEls = document.querySelectorAll('.text-danger, .air3-form-message-error, .air3-alert');
        errEls.forEach(function(el) {
          var r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return; // Skip hidden errors
          var t = el.innerText.trim();
          if (t && t.length > 2 && t.length < 200) errors.push(t);
        });
        result.errors = errors.slice(0, 5);
        return JSON.stringify(result);
      })()
    `);

    try {
      const state = JSON.parse(pageState);
      const connectsMatch = state.submitText.match(/(\d+)\s*Connects/i) ||
                            state.summary.match(/Total[:\s]*(\d+)\s*Connects/i);
      if (connectsMatch) result.connectsCost = parseInt(connectsMatch[1]);

      if (state.errors && state.errors.length > 0) {
        console.log(`[Upwork] Form errors: ${state.errors.join(' | ')}`);
      }
      console.log(`[Upwork] Submit button: "${state.submitText}" disabled=${state.submitDisabled}`);
    } catch {}

    // ── Step 9: Submit or dry-run ──
    if (submission.dryRun) {
      result.success = true;
      result.submitted = false;
      console.log(`[Upwork] DRY RUN — proposal filled but NOT submitted (${result.connectsCost} connects)`);
      return result;
    }

    // Click Submit
    const submitResult = await d.executeJS(`
      (function() {
        var btns = document.querySelectorAll('button.air3-btn-primary, button[type="submit"]');
        for (var btn of btns) {
          var text = btn.innerText.trim().toLowerCase();
          if (text.includes('send') || text.includes('submit') || text.includes('connect')) {
            if (btn.disabled) return 'disabled: ' + btn.innerText.trim();
            btn.click();
            return 'submitted';
          }
        }
        return 'no_submit_button';
      })()
    `);

    if (submitResult !== 'submitted') {
      result.error = `Submit failed: ${submitResult}`;
      return result;
    }

    await d.wait(3000);

    // ── Step 9b: Handle "3 things you need to know" modal (fixed-price only) ──
    // Upwork shows a confirmation modal with a "Yes, I understand." checkbox.
    // The "Continue" button is DISABLED until the checkbox is checked.
    // JS .click() does NOT work on modal buttons — must use OS-level click.
    const modalCheck = await d.executeJS(`
      (function() {
        var modal = document.querySelector('.air3-modal');
        if (!modal) return 'no_modal';
        var r = modal.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return 'no_modal';
        return 'found';
      })()
    `);

    if (modalCheck === 'found') {
      console.log('[Upwork] Fixed-price confirmation modal detected');

      // Step 1: Check the "Yes, I understand." checkbox
      const checkboxResult = await d.executeJS(`
        (function() {
          var modal = document.querySelector('.air3-modal');
          if (!modal) return 'no_modal';
          // Find checkbox input inside the modal
          var cb = modal.querySelector('input[type="checkbox"]');
          if (cb && !cb.checked) {
            cb.click();
            return 'checked';
          }
          if (cb && cb.checked) return 'already_checked';
          // Fallback: find the label containing "Yes, I understand" and click it
          var labels = modal.querySelectorAll('label, span, div');
          for (var l of labels) {
            if (l.innerText.trim().includes('Yes, I understand')) {
              l.click();
              return 'label_clicked';
            }
          }
          return 'no_checkbox';
        })()
      `);
      console.log(`[Upwork] Checkbox: ${checkboxResult}`);
      await d.wait(1000);

      // If JS click didn't work on checkbox, try OS-level click
      if (checkboxResult === 'no_checkbox' || checkboxResult === 'no_modal') {
        // Try clicking the checkbox area via OS-level click
        const cbPos = await d.executeJS(`
          (function() {
            var modal = document.querySelector('.air3-modal');
            if (!modal) return JSON.stringify({found: false});
            var cb = modal.querySelector('input[type="checkbox"]');
            if (!cb) {
              var labels = modal.querySelectorAll('label');
              for (var l of labels) {
                if (l.innerText.trim().includes('Yes')) { cb = l; break; }
              }
            }
            if (!cb) return JSON.stringify({found: false});
            var r = cb.getBoundingClientRect();
            return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
          })()
        `);
        try {
          const pos = JSON.parse(cbPos);
          if (pos.found) {
            await d.clickAtViewportPosition(pos.x, pos.y);
            console.log(`[Upwork] OS-level checkbox click at (${pos.x}, ${pos.y})`);
            await d.wait(1000);
          }
        } catch {}
      }

      // Step 2: Click "Continue" button (should now be enabled)
      // Try JS click first since checkbox may have enabled it
      const continueResult = await d.executeJS(`
        (function() {
          var modal = document.querySelector('.air3-modal');
          if (!modal) return 'no_modal';
          var btns = modal.querySelectorAll('button');
          for (var b of btns) {
            if (b.innerText.trim() === 'Continue') {
              if (b.disabled) return 'still_disabled';
              b.click();
              return 'clicked';
            }
          }
          return 'no_button';
        })()
      `);
      console.log(`[Upwork] Continue button: ${continueResult}`);

      if (continueResult === 'still_disabled' || continueResult === 'no_button') {
        // OS-level click as fallback
        const btnPos = await d.executeJS(`
          (function() {
            var modal = document.querySelector('.air3-modal');
            if (!modal) return JSON.stringify({found: false});
            var btns = modal.querySelectorAll('button');
            for (var b of btns) {
              if (b.innerText.trim() === 'Continue') {
                var r = b.getBoundingClientRect();
                return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
              }
            }
            return JSON.stringify({found: false});
          })()
        `);
        try {
          const pos = JSON.parse(btnPos);
          if (pos.found) {
            await d.clickAtViewportPosition(pos.x, pos.y);
            console.log(`[Upwork] OS-level Continue click at (${pos.x}, ${pos.y})`);
          }
        } catch {}
      }

      await d.wait(5000);
    }

    // ── Step 10: Verify submission ──
    const verification = await d.executeJS(`
      (function() {
        var url = window.location.href;
        var title = document.title;
        var body = document.body.innerText.substring(0, 800);

        // Success: redirected to proposals list or success page
        if (url.includes('/proposals') && !url.includes('/apply')) return 'success_url';
        if (body.includes('Proposal sent') || body.includes('proposal has been submitted')) return 'success_text';
        if (title.includes('Proposals') && !title.includes('Submit')) return 'success_title';
        // Success: redirected to find-work or home after submit
        if (url.includes('/find-work') || url.includes('/nx/find-work')) return 'success_redirect';

        // Still on apply page = form errors
        if (url.includes('/apply')) {
          var errors = [];
          var errEls = document.querySelectorAll('.text-danger, [class*="error"]');
          errEls.forEach(function(el) {
            var t = el.innerText.trim();
            if (t && t.length > 2) errors.push(t);
          });
          return 'form_errors: ' + errors.join(' | ');
        }

        return 'unknown: ' + title + ' | ' + url.substring(0, 80);
      })()
    `);

    console.log(`[Upwork] Verification: ${verification}`);

    if (verification.startsWith('success')) {
      result.success = true;
      result.submitted = true;
    } else {
      result.error = `Verification: ${verification}`;
      result.submitted = true;
    }

    return result;

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
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

// ─── Get Available Filters (reads from current page) ─────────

export async function getAvailableFilters(driver?: SafariDriver): Promise<Record<string, any>> {
  const d = driver || getDefaultDriver();

  const filtersJson = await d.executeJS(`
(function() {
  var result = {};

  // Get search result count
  var countEl = document.querySelector('[data-test*="total"], .search-count, h1');
  if (countEl) result.totalResults = countEl.innerText.trim();

  // Get currently active filters
  var activeFilters = [];
  var pills = document.querySelectorAll('[data-test*="filter-pill"], .air3-tag, .search-filter-tag');
  pills.forEach(function(p) { activeFilters.push(p.innerText.trim()); });
  result.activeFilters = activeFilters;

  // Detect current tab
  var btns = document.querySelectorAll('button');
  for (var b of btns) {
    var text = b.innerText.trim();
    if (b.classList.contains('active') || b.getAttribute('aria-selected') === 'true') {
      if (text.includes('Best') || text.includes('Recent') || text.includes('U.S.') || text.includes('Saved')) {
        result.activeTab = text;
      }
    }
  }

  // Current URL params
  result.currentUrl = window.location.href;

  return JSON.stringify(result);
})()
  `);

  try {
    return JSON.parse(filtersJson || '{}');
  } catch {
    return {};
  }
}
