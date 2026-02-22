/**
 * Upwork Job Discovery & Extraction Operations
 * High-level Safari automation for job search, extraction, and scoring.
 * All selectors verified against live Upwork DOM (Feb 2026).
 */

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
    tiles.forEach(function(tile) {
      try {
        var titleEl = tile.querySelector('[data-test*="job-tile-title-link"]');
        var title = titleEl ? titleEl.innerText.trim() : '';
        var url = titleEl ? titleEl.href : '';

        var descEl = tile.querySelector('[data-test*="JobDescription"]');
        var description = descEl ? descEl.innerText.trim().substring(0, 500) : '';

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
    });
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

// ─── Full Job Detail Page Extraction ─────────────────────────

export async function extractJobDetail(jobUrl: string, driver?: SafariDriver): Promise<UpworkJobDetail | null> {
  const d = driver || getDefaultDriver();
  const nav = await navigateToJob(jobUrl, d);
  if (!nav.success) return null;

  await d.wait(3000);

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

// ─── Proposal Submission ─────────────────────────────────────

export interface ProposalSubmission {
  jobUrl: string;
  coverLetter: string;
  hourlyRate?: number;         // e.g. 75 for $75/hr (hourly jobs only)
  fixedPrice?: number;         // e.g. 2000 for $2000 (fixed-price jobs only)
  screeningAnswers?: string[]; // answers in order of questions shown
  boostConnects?: number;      // additional connects for boosting (0 = no boost)
  dryRun?: boolean;            // if true, fills form but does NOT click submit
}

export interface ProposalResult {
  success: boolean;
  submitted: boolean;
  jobTitle: string;
  connectsCost: number;
  bidAmount: string;
  coverLetterLength: number;
  questionsAnswered: number;
  error?: string;
  dryRun: boolean;
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
    dryRun: submission.dryRun ?? false,
  };

  try {
    // Step 1: Navigate to job detail page
    const nav = await navigateToJob(submission.jobUrl, d);
    if (!nav.success) {
      result.error = 'Failed to navigate to job';
      return result;
    }
    await d.wait(3000);

    // Get job title
    result.jobTitle = await d.executeJS(`
      (function() {
        var h = document.querySelector('h4') || document.querySelector('h1');
        return h ? h.innerText.trim() : '';
      })()
    `);

    // Step 2: Click "Apply now" button
    const clickResult = await d.executeJS(`
      (function() {
        var btn = document.querySelector('button.air3-btn-primary[aria-label="Apply now"]') ||
                  document.querySelector('button.air3-btn-primary');
        if (btn && btn.innerText.trim().toLowerCase().includes('apply')) {
          btn.click();
          return 'clicked';
        }
        // Check if already on proposal page
        if (window.location.href.includes('/apply')) return 'already_on_apply';
        return 'not_found';
      })()
    `);

    if (clickResult === 'not_found') {
      result.error = 'Apply button not found — job may be closed or already applied';
      return result;
    }

    await d.wait(4000);

    // Check if we landed on the proposal form
    const onProposalPage = await d.executeJS(`
      window.location.href.includes('/apply') || 
      document.title.includes('Submit a Proposal') ? 'yes' : 'no'
    `);

    if (onProposalPage !== 'yes') {
      // Might have hit a CAPTCHA
      await (d as any).handleCaptchaIfPresent?.();
      await d.wait(3000);
    }

    // Step 3: Set hourly rate or fixed price
    // Upwork uses a masked/formatted input that ignores programmatic value changes.
    // We must use OS-level click + select-all + clipboard paste to set the rate.
    if (submission.hourlyRate || submission.fixedPrice) {
      const rateValue = submission.hourlyRate || submission.fixedPrice || 0;
      const rateSelector = 'step-rate';

      // Scroll input into view and get its viewport coordinates
      const coordsJson = await d.executeJS(`
        (function() {
          var input = document.getElementById('${rateSelector}');
          if (!input) {
            input = document.querySelector('input[id*="bid"], input[id*="amount"], input[id*="price"]');
          }
          if (!input) return JSON.stringify({ found: false });
          input.scrollIntoView({ block: 'center' });
          var r = input.getBoundingClientRect();
          return JSON.stringify({ found: true, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
        })()
      `);

      try {
        const coords = JSON.parse(coordsJson);
        if (coords.found) {
          // OS-level click into the input field
          await d.clickAtViewportPosition(coords.x, coords.y);
          await d.wait(400);
          // Select all text via JS (works after OS-level click gave us focus)
          await d.executeJS(`
            (function() {
              var input = document.activeElement;
              if (input && input.select) input.select();
            })()
          `);
          await d.wait(200);
          // Paste the new rate value via clipboard (OS-level Cmd+V)
          await d.typeViaClipboard(String(Math.round(rateValue)));
          await d.wait(300);
          // Tab out to trigger formatting
          await d.pressTab();
          await d.wait(500);
        }
      } catch {}

      result.bidAmount = submission.hourlyRate ? `$${submission.hourlyRate}/hr` : `$${submission.fixedPrice} fixed`;
    }

    // Step 4: Fill cover letter (first textarea)
    const coverLetterEscaped = submission.coverLetter
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n');

    await d.executeJS(`
      (function() {
        var textareas = document.querySelectorAll('textarea');
        if (textareas.length === 0) return 'no_textarea';
        var ta = textareas[0]; // First textarea is cover letter
        var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        nativeSet.call(ta, '${coverLetterEscaped}');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
        return 'filled';
      })()
    `);
    await d.wait(500);

    // Step 5: Answer screening questions (second+ textareas)
    if (submission.screeningAnswers && submission.screeningAnswers.length > 0) {
      for (let i = 0; i < submission.screeningAnswers.length; i++) {
        const answerEscaped = submission.screeningAnswers[i]
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/\n/g, '\\n');

        const answerResult = await d.executeJS(`
          (function() {
            var textareas = document.querySelectorAll('textarea');
            var idx = ${i + 1}; // Skip first (cover letter)
            if (idx >= textareas.length) return 'no_textarea_' + idx;
            var ta = textareas[idx];
            var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSet.call(ta, '${answerEscaped}');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.dispatchEvent(new Event('change', { bubbles: true }));
            return 'answered';
          })()
        `);
        if (answerResult === 'answered') result.questionsAnswered++;
        await d.wait(300);
      }
    }

    // Step 6: Set boost connects (optional, 0 = no boost)
    if (submission.boostConnects !== undefined) {
      await d.executeJS(`
        (function() {
          var input = document.querySelector('input[type="number"]');
          if (!input) return 'no_boost_input';
          var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSet.call(input, '${submission.boostConnects}');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return 'set';
        })()
      `);
      await d.wait(300);
    }

    // Step 7: Read the final connects cost from the submit button
    const submitInfo = await d.executeJS(`
      (function() {
        var btn = document.querySelector('button.air3-btn-primary');
        if (!btn) return JSON.stringify({ text: '', disabled: true });
        return JSON.stringify({
          text: btn.innerText.trim(),
          disabled: btn.disabled,
        });
      })()
    `);

    try {
      const info = JSON.parse(submitInfo);
      const connectsMatch = info.text.match(/(\d+)\s*Connects/i);
      if (connectsMatch) result.connectsCost = parseInt(connectsMatch[1]);
    } catch {}

    // Step 8: Submit (unless dry run)
    if (submission.dryRun) {
      result.success = true;
      result.submitted = false;
      console.log(`[Upwork] DRY RUN — proposal filled but NOT submitted (${result.connectsCost} connects)`);
      return result;
    }

    // Click Submit
    const submitResult = await d.executeJS(`
      (function() {
        var btn = document.querySelector('button.air3-btn-primary');
        if (!btn) return 'no_button';
        if (btn.disabled) return 'disabled';
        var text = btn.innerText.trim().toLowerCase();
        if (!text.includes('send') && !text.includes('submit')) return 'wrong_button: ' + btn.innerText.trim();
        btn.click();
        return 'submitted';
      })()
    `);

    if (submitResult !== 'submitted') {
      result.error = `Submit failed: ${submitResult}`;
      return result;
    }

    await d.wait(5000);

    // Step 9: Verify submission
    const verification = await d.executeJS(`
      (function() {
        var url = window.location.href;
        var title = document.title;
        var body = document.body.innerText.substring(0, 500);
        
        // Check for success indicators
        if (url.includes('/proposals/') && !url.includes('/apply')) return 'success_url';
        if (body.includes('submitted') || body.includes('Proposal sent') || title.includes('Proposals')) return 'success_text';
        if (body.includes('error') || body.includes('Error')) return 'error: ' + body.substring(0, 100);
        
        return 'unknown: ' + title + ' | ' + url.substring(0, 60);
      })()
    `);

    if (verification.startsWith('success')) {
      result.success = true;
      result.submitted = true;
    } else {
      result.error = `Verification: ${verification}`;
      result.submitted = true; // Button was clicked, outcome unclear
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
