/**
 * Upwork Automation API Server
 * REST API for job discovery, applications, messaging, and scoring.
 * Port: 3104
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  SafariDriver,
  getDefaultDriver,
  navigateToFindWork,
  navigateToTab,
  navigateToMyJobs,
  navigateToJob,
  searchJobs,
  extractJobDetail,
  extractJobsFromCurrentPage,
  getJobsFromTab,
  getAvailableFilters,
  scoreJob,
  recommendConnects,
  saveJob,
  unsaveJob,
  getSavedJobs,
  getConnectsBalance,
  detectUpworkRateLimit,
  submitProposal,
  getApplications,
  navigateToMessages,
  listConversations,
  readMessages,
  openConversation,
  sendMessage,
  getUnreadCount,
  getUnreadMessages,
  DEFAULT_RATE_LIMITS,
  addWatch,
  removeWatch,
  updateWatch,
  listWatches,
  getMonitorStatus,
  scanAllWatches,
  scanWatch,
  setupDefaultWatches,
  PRESET_WATCHES,
} from '../automation/index.js';
import type { RateLimitConfig, JobSearchConfig, JobTab } from '../automation/types.js';
import {
  listTemplates,
  getTemplateById,
  createTemplate,
  deleteTemplate,
} from '../automation/template-manager.js';
import { getAnalyticsSummary } from '../automation/analytics-tracker.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import type { NextFunction } from 'express';

const PORT = process.env.UPWORK_PORT || 3104;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SERVICE_NAME = 'upwork-automation';
const SERVICE_PORT = Number(PORT);
const SESSION_URL_PATTERN = 'upwork.com';
const OPEN_URL = 'https://www.upwork.com/nx/find-work/';
const CLAIM_EXEMPT = /^\/(health|api\/tabs\/.*|api\/upwork\/status|api\/upwork\/rate-limits)$/;

const activeCoordinators = new Map<string, InstanceType<typeof TabCoordinator>>();

const app = express();
app.use(cors());
app.use(express.json());

// Enable verbose logging for debugging
getDefaultDriver().setConfig({ verbose: true });

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);

  if (myClaim) {
    getDefaultDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  const autoId = `upwork-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getDefaultDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for upwork-automation',
      detail: String(err),
      fix: `Open Safari and navigate to ${OPEN_URL}`,
    });
  }
}

app.use(requireTabClaim);

// Global 30s heartbeat refresh
setInterval(async () => {
  for (const [id, coord] of activeCoordinators) {
    try { await coord.heartbeat(); }
    catch { activeCoordinators.delete(id); }
  }
}, 30_000);

// Rate limiting state
let actionCount = 0;
let lastActionReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastActionReset > 3600000) {
    actionCount = 0;
    lastActionReset = now;
  }
  if (actionCount >= rateLimits.searchesPerHour) return false;
  actionCount++;
  return true;
}

// ─── Session & Tab Claim Management ─────────────────────────

app.post('/api/session/ensure', async (_req: Request, res: Response) => {
  try {
    const info = await getDefaultDriver().ensureActiveSession(SESSION_URL_PATTERN);
    res.json({ ok: info.found, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/session/clear', (_req: Request, res: Response) => {
  getDefaultDriver().clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

app.get('/api/session/status', (_req: Request, res: Response) => {
  const info = getDefaultDriver().getSessionInfo();
  res.json({
    tracked: !!(info?.windowIndex),
    windowIndex: info?.windowIndex ?? null,
    tabIndex: info?.tabIndex ?? null,
    sessionUrlPattern: SESSION_URL_PATTERN,
  });
});

app.get('/api/tabs/claims', async (_req: Request, res: Response) => {
  try {
    const claims = await TabCoordinator.listClaims();
    res.json({ claims, count: claims.length });
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/tabs/claim', async (req: Request, res: Response) => {
  const { agentId, openUrl } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, openUrl);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim();
    getDefaultDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    res.json(claim);
  } catch (error: any) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/tabs/release', async (req: Request, res: Response) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const coord = activeCoordinators.get(agentId);
  if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
  res.json({ ok: true });
});

app.post('/api/tabs/heartbeat', async (req: Request, res: Response) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });
  const coord = activeCoordinators.get(agentId);
  if (!coord) return res.status(404).json({ error: 'No claim for agentId' });
  await coord.heartbeat();
  res.json({ ok: true, heartbeat: Date.now() });
});

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    platform: 'upwork',
    status: 'running',
    port: PORT,
    uptime: process.uptime(),
    actionsThisHour: actionCount,
  });
});

app.get('/api/upwork/status', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    // Pin to claimed tab before reading — ensures we read the upwork tab, not active tab
    const claims = await TabCoordinator.listClaims();
    const myClaim = claims.find(c => c.service === SERVICE_NAME);
    if (myClaim) {
      driver.setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    }
    const url = await driver.getCurrentUrl();
    const isOnUpwork = url.includes('upwork.com');
    const loginState = isOnUpwork ? await driver.detectLoginState() : 'unknown';

    res.json({
      isOnUpwork,
      isLoggedIn: loginState === 'logged_in',
      loginState,
      currentUrl: url,
      rateLimits: { actionsThisHour: actionCount, limit: rateLimits.searchesPerHour },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Auth ─────────────────────────────────────────────────────

app.post('/api/upwork/signin', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    const email = process.env.UPWORK_EMAIL || '';
    const password = process.env.UPWORK_PASSWORD || '';
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'UPWORK_EMAIL/UPWORK_PASSWORD not set' });
    }
    const result = await driver.signIn(email, password);
    const loginState = await driver.detectLoginState();
    res.json({ success: result === 'success' || result === 'already_logged_in', result, loginState });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/ensure-login', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    const loggedIn = await driver.ensureLoggedIn();
    const loginState = await driver.detectLoginState();
    res.json({ success: loggedIn, loginState });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Navigation ──────────────────────────────────────────────

app.post('/api/upwork/navigate/find-work', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToFindWork();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/tab', async (req: Request, res: Response) => {
  try {
    const { tab } = req.body;
    const validTabs: JobTab[] = ['best_matches', 'most_recent', 'us_only', 'saved_jobs'];
    if (!tab || !validTabs.includes(tab)) {
      return res.status(400).json({ error: 'tab required (best_matches | most_recent | us_only | saved_jobs)' });
    }
    const result = await navigateToTab(tab);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/my-jobs', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMyJobs();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/job', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const result = await navigateToJob(url);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/messages', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMessages();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Job Search ──────────────────────────────────────────────

app.post('/api/upwork/jobs/search', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    // Auto-recover session if not logged in
    const driver = getDefaultDriver();
    const loginState = await driver.detectLoginState();
    if (loginState !== 'logged_in') {
      console.log(`[server] Not logged in (${loginState}), attempting auto-signin...`);
      await driver.ensureLoggedIn();
    }
    const config: Partial<JobSearchConfig> = req.body;
    const jobs = await searchJobs(config);
    res.json({ jobs, count: jobs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get jobs from a specific tab (best_matches, most_recent, us_only, saved_jobs)
app.post('/api/upwork/jobs/tab', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    // Auto-recover session if not logged in
    const driver = getDefaultDriver();
    const loginState = await driver.detectLoginState();
    if (loginState !== 'logged_in') {
      console.log(`[server] Not logged in (${loginState}), attempting auto-signin...`);
      await driver.ensureLoggedIn();
    }
    const { tab } = req.body;
    const validTabs: JobTab[] = ['best_matches', 'most_recent', 'us_only', 'saved_jobs'];
    if (!tab || !validTabs.includes(tab)) {
      return res.status(400).json({ error: 'tab required (best_matches | most_recent | us_only | saved_jobs)' });
    }
    const result = await getJobsFromTab(tab);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Extract jobs from whatever page Safari is currently on
app.get('/api/upwork/jobs/current-page', async (_req: Request, res: Response) => {
  try {
    const jobs = await extractJobsFromCurrentPage();
    res.json({ jobs, count: jobs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get available filters from current search page
app.get('/api/upwork/jobs/filters', async (_req: Request, res: Response) => {
  try {
    const filters = await getAvailableFilters();
    res.json(filters);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Full job detail page extraction — click into a job and get everything
app.get('/api/upwork/jobs/detail', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: 'url query param required' });
    const detail = await extractJobDetail(url);
    if (!detail) return res.status(404).json({ error: 'Could not extract job detail' });
    res.json(detail);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy: get job by ID
app.get('/api/upwork/jobs/:id', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const jobUrl = `https://www.upwork.com/jobs/${req.params.id}`;
    const job = await extractJobDetail(jobUrl);
    if (!job) return res.status(404).json({ error: 'Job not found or could not extract' });
    res.json(job);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Score a job with connects recommendation
app.post('/api/upwork/jobs/score', async (req: Request, res: Response) => {
  try {
    const { job, preferredSkills, minBudget, availableConnects } = req.body;
    if (!job) return res.status(400).json({ error: 'job object required' });
    const score = scoreJob(job, preferredSkills || [], minBudget || 0, availableConnects || 100);
    res.json(score);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Score + recommend connects for multiple jobs at once
app.post('/api/upwork/jobs/score-batch', async (req: Request, res: Response) => {
  try {
    const { jobs, preferredSkills, minBudget, availableConnects } = req.body;
    if (!jobs || !Array.isArray(jobs)) return res.status(400).json({ error: 'jobs array required' });
    const scores = jobs.map((job: any) => scoreJob(job, preferredSkills || [], minBudget || 0, availableConnects || 100));
    // Sort by score descending
    scores.sort((a: any, b: any) => b.totalScore - a.totalScore);
    res.json({
      scores,
      count: scores.length,
      applyCount: scores.filter((s: any) => s.recommendation === 'apply').length,
      maybeCount: scores.filter((s: any) => s.recommendation === 'maybe').length,
      skipCount: scores.filter((s: any) => s.recommendation === 'skip').length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/jobs/:id/save', async (req: Request, res: Response) => {
  try {
    const jobUrl = `https://www.upwork.com/jobs/${req.params.id}`;
    const saved = await saveJob(jobUrl);
    res.json({ success: saved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/jobs/save', async (req: Request, res: Response) => {
  try {
    const { jobUrl } = req.body;
    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });
    const saved = await saveJob(jobUrl);
    res.json({ success: saved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/jobs/unsave', async (req: Request, res: Response) => {
  try {
    const { jobUrl } = req.body;
    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });
    const unsaved = await unsaveJob(jobUrl);
    res.json({ success: unsaved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/jobs/saved', async (_req: Request, res: Response) => {
  try {
    const jobs = await getSavedJobs();
    res.json({ jobs, count: jobs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Connects Balance ────────────────────────────────────────

app.get('/api/upwork/connects', async (_req: Request, res: Response) => {
  try {
    // Pin to claimed tab before reading balance
    const claims = await TabCoordinator.listClaims();
    const myClaim = claims.find(c => c.service === SERVICE_NAME);
    if (myClaim) {
      getDefaultDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    }
    const result = await getConnectsBalance();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rate Limit Detection ────────────────────────────────────

app.get('/api/upwork/rate-status', async (_req: Request, res: Response) => {
  try {
    const result = await detectUpworkRateLimit();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Proposal Submission ────────────────────────────────────

app.post('/api/upwork/proposals/submit', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) {
      return res.status(429).json({ error: 'Application rate limit reached' });
    }

    const {
      jobUrl,
      coverLetter,
      hourlyRate,
      fixedPrice,
      milestoneDescription,
      projectDuration,
      paymentMode,
      screeningAnswers,
      attachments,
      boostConnects,
      dryRun = true, // Default to dry run for safety
    } = req.body;

    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });
    if (!coverLetter) return res.status(400).json({ error: 'coverLetter required' });

    const result = await submitProposal({
      jobUrl,
      coverLetter,
      hourlyRate,
      fixedPrice,
      milestoneDescription,
      projectDuration,
      paymentMode,
      screeningAnswers,
      attachments,
      boostConnects,
      dryRun,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Applications ────────────────────────────────────────────

app.get('/api/upwork/applications', async (_req: Request, res: Response) => {
  try {
    const apps = await getApplications();
    res.json({ applications: apps, count: apps.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Proposal History Scraper ────────────────────────────────

app.get('/api/upwork/proposal-history', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();

    // Navigate to archived proposals page
    await driver.navigateTo('https://www.upwork.com/nx/proposals/?status=archived');
    await driver.wait(3500);

    // Scrape proposal cards from the archived list
    const listJson = await driver.executeJS(`
      (function() {
        var proposals = [];
        var cards = document.querySelectorAll(
          '[data-test="proposal-tile"], .proposal-item, article[data-cy], ' +
          'section[data-test="proposals-list"] > div, .up-card-section'
        );

        if (!cards.length) {
          // Fallback: try all list items with links to jobs
          cards = document.querySelectorAll('li');
        }

        cards.forEach(function(card) {
          try {
            var titleEl = card.querySelector('h3, h4, [data-test="job-title"], a[href*="/jobs/"]');
            var statusEl = card.querySelector('[data-test="status"], .badge, [class*="status"]');
            var linkEl = card.querySelector('a[href*="/jobs/"], a[href*="/proposals/"]');
            var amountEl = card.querySelector('[data-test="amount"], [class*="budget"], [class*="amount"]');

            var title = titleEl ? titleEl.innerText.trim() : '';
            var status = statusEl ? statusEl.innerText.trim().toLowerCase() : '';
            var url = linkEl ? linkEl.href : '';
            var amount = amountEl ? amountEl.innerText.trim() : '';

            if (title && url) {
              proposals.push(JSON.stringify({
                title: title,
                status: status,
                url: url,
                amount: amount,
                contractId: url.replace(/[^a-z0-9]/gi, '_').slice(-30)
              }));
            }
          } catch(e) {}
        });

        return '[' + proposals.join(',') + ']';
      })()
    `);

    let cards: Array<{ title: string; status: string; url: string; amount: string; contractId: string }> = [];
    try { cards = JSON.parse(listJson || '[]'); } catch { cards = []; }

    const results = [];

    for (const card of cards.slice(0, 20)) {
      const outcome: 'hired' | 'rejected' | 'ghosted' | 'unknown' =
        card.status.includes('hired') || card.status.includes('contract') ? 'hired' :
        card.status.includes('declin') || card.status.includes('not hired') ? 'rejected' :
        card.status.includes('withdrawn') ? 'ghosted' : 'unknown';

      // Navigate to proposal detail page to get actual text
      let proposalText = '';
      let jobDescription = '';
      let clientFeedback = '';

      if (card.url) {
        try {
          await driver.navigateTo(card.url);
          await driver.wait(2500);

          const detailJson = await driver.executeJS(`
            (function() {
              var out = {};

              // Proposal text — the cover letter
              var coverEl = document.querySelector(
                '[data-test="cover-letter"], [data-cy="cover-letter"], ' +
                '.cover-letter, [class*="coverLetter"], [class*="cover-letter"]'
              );
              out.proposalText = coverEl ? coverEl.innerText.trim() : '';

              // Job description
              var descEl = document.querySelector(
                '[data-test="job-description"], .job-description, [class*="jobDescription"]'
              );
              out.jobDescription = descEl ? descEl.innerText.trim().slice(0, 600) : '';

              // Client feedback (if contract was completed)
              var fbEl = document.querySelector(
                '[data-test="feedback"], .feedback-comment, [class*="feedbackComment"]'
              );
              out.clientFeedback = fbEl ? fbEl.innerText.trim().slice(0, 200) : '';

              // Bid amount
              var bidEl = document.querySelector(
                '[data-test="bid-amount"], [class*="bidAmount"], [class*="bid-amount"]'
              );
              out.bidAmount = bidEl ? bidEl.innerText.trim() : '';

              // Actual earned amount (for hired)
              var earnedEl = document.querySelector(
                '[data-test="total-earned"], [class*="totalEarned"], [class*="total-earned"]'
              );
              out.earnedAmount = earnedEl ? earnedEl.innerText.trim() : '';

              return JSON.stringify(out);
            })()
          `);

          const detail = JSON.parse(detailJson || '{}');
          proposalText = detail.proposalText || '';
          jobDescription = detail.jobDescription || '';
          clientFeedback = detail.clientFeedback || '';

          const bidNum = parseFloat((detail.bidAmount || '').replace(/[^0-9.]/g, ''));
          const earnedNum = parseFloat((detail.earnedAmount || '').replace(/[^0-9.]/g, ''));

          if (proposalText) {
            results.push({
              outcome,
              job_title: card.title,
              job_description: jobDescription || undefined,
              proposal_text: proposalText,
              bid_amount: isNaN(bidNum) ? undefined : bidNum,
              actual_amount_paid: isNaN(earnedNum) ? undefined : earnedNum,
              client_feedback: clientFeedback || undefined,
              upwork_job_url: card.url,
              upwork_contract_id: `upwork_${card.contractId}`,
            });
          }
        } catch (e) {
          // Skip proposal if navigation fails
        }
      }

      // Back to list
      await driver.navigateTo('https://www.upwork.com/nx/proposals/?status=archived');
      await driver.wait(2000);
    }

    res.json({ proposals: results, scraped: results.length, cards_found: cards.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message, proposals: [] });
  }
});

// ─── Messages ────────────────────────────────────────────────

app.get('/api/upwork/conversations', async (_req: Request, res: Response) => {
  try {
    const nav = await navigateToMessages();
    if (!nav.success) return res.status(500).json(nav);
    const convos = await listConversations();
    res.json({ conversations: convos, count: convos.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const msgs = await readMessages(limit);
    res.json({ messages: msgs, count: msgs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/messages/unread', async (_req: Request, res: Response) => {
  try {
    const result = await getUnreadMessages();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/messages/open', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.body;
    if (!clientName) return res.status(400).json({ error: 'clientName required' });
    const opened = await openConversation(clientName);
    res.json({ success: opened });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/messages/send', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const result = await sendMessage(text);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI Proposal Improvement ────────────────────────────────

app.post('/api/upwork/proposals/improve', async (req: Request, res: Response) => {
  try {
    const { existingProposal, jobDescription, feedback } = req.body;
    if (!existingProposal) return res.status(400).json({ error: 'existingProposal required' });

    if (!OPENAI_API_KEY) {
      return res.json({
        improvedProposal: existingProposal,
        changes: ['No OpenAI API key configured - returning original proposal'],
        confidence: 0.1,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: `You are an expert Upwork proposal editor. Review and improve the given proposal. Make it more concise, professional, and compelling. Focus on: 1) Clear value proposition, 2) Specific relevant experience, 3) Understanding of client needs, 4) Professional tone. Return ONLY the improved proposal text, without any preamble or explanation.${feedback ? `\n\nClient feedback: ${feedback}` : ''}`,
            },
            {
              role: 'user',
              content: `Job description:\n${(jobDescription || '').substring(0, 800)}\n\nCurrent proposal:\n${existingProposal}`,
            },
          ],
          max_tokens: 600,
          temperature: 0.6,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[AI] OpenAI returned ${response.status}`);
        return res.json({ improvedProposal: existingProposal, changes: ['API error'], confidence: 0.1 });
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const improved = data.choices?.[0]?.message?.content?.trim() || existingProposal;

      // Detect changes
      const changes: string[] = [];
      if (improved.length < existingProposal.length) changes.push('Made more concise');
      if (improved.length > existingProposal.length) changes.push('Added more detail');
      if (improved !== existingProposal) changes.push('Improved tone and structure');

      res.json({
        improvedProposal: improved,
        changes: changes.length > 0 ? changes : ['Minor improvements'],
        confidence: 0.85,
      });
    } catch (aiError) {
      clearTimeout(timeout);
      console.error('[AI] OpenAI request failed:', aiError instanceof Error ? aiError.message : aiError);
      res.json({ improvedProposal: existingProposal, changes: ['Request timeout or error'], confidence: 0.1 });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI Proposal Generation ─────────────────────────────────

app.post('/api/upwork/proposals/generate', async (req: Request, res: Response) => {
  try {
    const { job, customInstructions, highlightSkills } = req.body;
    if (!job) return res.status(400).json({ error: 'job object required' });

    if (!OPENAI_API_KEY) {
      return res.json({
        coverLetter: `I'm excited about your project "${job.title}". With my expertise in ${(job.skills || []).slice(0, 3).join(', ')}, I'm confident I can deliver excellent results. Let's discuss the details!`,
        suggestedQuestions: ['What is the expected timeline?', 'Do you have existing code/assets?'],
        confidence: 0.3,
        aiGenerated: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fallbackLetter = `I'm excited about your project "${job.title}". With my expertise in ${(job.skills || []).slice(0, 3).join(', ')}, I'm confident I can deliver excellent results. Let's discuss the details!`;
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `You are a professional freelancer writing an Upwork proposal. Write a concise, personalized cover letter (150-250 words). Be specific about the client's needs, show understanding of the project, and demonstrate relevant expertise. Do NOT be generic or salesy. End with 2-3 clarifying questions.${customInstructions ? `\n\nAdditional instructions: ${customInstructions}` : ''}`,
            },
            {
              role: 'user',
              content: `Job: ${job.title}\nDescription: ${(job.description || '').substring(0, 1000)}\nSkills: ${(job.skills || []).join(', ')}\nBudget: ${JSON.stringify(job.budget)}\n${highlightSkills ? `My strengths: ${highlightSkills.join(', ')}` : ''}`,
            },
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[AI] OpenAI returned ${response.status}`);
        return res.json({ coverLetter: fallbackLetter, suggestedQuestions: ['What is the expected timeline?'], confidence: 0.3, aiGenerated: false });
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim() || '';

      // Split into cover letter and questions
      const parts = text.split(/(?:questions?|clarif)/i);
      const coverLetter = parts[0]?.trim() || text;
      const questionsRaw = parts[1] || '';
      const suggestedQuestions = questionsRaw
        .split(/\d+[\.\)]\s*/)
        .filter(q => q.trim().length > 10)
        .map(q => q.trim());

      res.json({
        coverLetter: coverLetter || fallbackLetter,
        suggestedQuestions: suggestedQuestions.length > 0 ? suggestedQuestions : ['What is the expected timeline?'],
        confidence: 0.8,
        aiGenerated: true,
      });
    } catch (aiError) {
      clearTimeout(timeout);
      console.error('[AI] OpenAI request failed:', aiError instanceof Error ? aiError.message : aiError);
      res.json({ coverLetter: fallbackLetter, suggestedQuestions: ['What is the expected timeline?'], confidence: 0.3, aiGenerated: false });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rate Limits ─────────────────────────────────────────────

app.get('/api/upwork/rate-limits', (_req: Request, res: Response) => {
  res.json({
    config: rateLimits,
    current: { actionsThisHour: actionCount },
  });
});

app.put('/api/upwork/rate-limits', (req: Request, res: Response) => {
  rateLimits = { ...rateLimits, ...req.body };
  res.json({ updated: true, config: rateLimits });
});

// ─── Job Monitor ─────────────────────────────────────────────

app.get('/api/upwork/monitor/status', async (_req: Request, res: Response) => {
  try {
    const status = await getMonitorStatus();
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/monitor/watches', async (_req: Request, res: Response) => {
  try {
    const watches = await listWatches();
    res.json({ watches, count: watches.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/monitor/watches', async (req: Request, res: Response) => {
  try {
    const watch = await addWatch(req.body);
    res.json(watch);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/upwork/monitor/watches/:id', async (req: Request, res: Response) => {
  try {
    const watch = await updateWatch(req.params.id, req.body);
    if (!watch) return res.status(404).json({ error: 'Watch not found' });
    res.json(watch);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/upwork/monitor/watches/:id', async (req: Request, res: Response) => {
  try {
    const removed = await removeWatch(req.params.id);
    res.json({ removed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/monitor/scan', async (_req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const results = await scanAllWatches();
    const totalNew = results.reduce((s, r) => s + r.newJobs, 0);
    const totalNotified = results.reduce((s, r) => s + r.notified, 0);
    res.json({ results, totalNew, totalNotified });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/monitor/setup', async (_req: Request, res: Response) => {
  try {
    const added = await setupDefaultWatches();
    const all = await listWatches();
    res.json({ added: added.length, total: all.length, watches: all });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/monitor/presets', (_req: Request, res: Response) => {
  res.json({ presets: Object.keys(PRESET_WATCHES).map(k => ({ key: k, ...PRESET_WATCHES[k] })) });
});

// ─── Analytics ───────────────────────────────────────────────

app.get('/api/upwork/analytics', (_req: Request, res: Response) => {
  try {
    const analytics = getAnalyticsSummary();
    res.json(analytics);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Proposal Templates ──────────────────────────────────────

app.get('/api/upwork/templates', (_req: Request, res: Response) => {
  try {
    const templates = listTemplates();
    res.json({ templates, count: templates.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/templates/:id', (req: Request, res: Response) => {
  try {
    const template = getTemplateById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json(template);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/templates', (req: Request, res: Response) => {
  try {
    const { name, category, template, tone } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!category) return res.status(400).json({ error: 'category required' });
    if (!template) return res.status(400).json({ error: 'template required' });
    if (!tone) return res.status(400).json({ error: 'tone required (professional | friendly | technical)' });

    const newTemplate = createTemplate(name, category, template, tone);
    res.json(newTemplate);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/upwork/templates/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteTemplate(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ deleted: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Start Server ────────────────────────────────────────────

TabCoordinator.listClaims().then(claims => {
  const stale = claims.filter(c => c.service === SERVICE_NAME);
  if (stale.length > 0) {
    console.log(`[startup] Clearing ${stale.length} stale ${SERVICE_NAME} claim(s) from previous process`);
    import('fs/promises').then(fsp => {
      fsp.writeFile('/tmp/safari-tab-claims.json', JSON.stringify(claims.filter(c => c.service !== SERVICE_NAME), null, 2)).catch(() => {});
    });
  }
}).catch(() => {});

app.listen(PORT, () => {
  console.log(`\n🏢 Upwork Automation API running on http://localhost:${PORT}`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
  console.log(`   Status: GET http://localhost:${PORT}/api/upwork/status`);
  console.log(`   Search: POST http://localhost:${PORT}/api/upwork/jobs/search`);
  console.log(`   Tabs:   POST http://localhost:${PORT}/api/upwork/jobs/tab`);
  console.log(`   Detail: GET  http://localhost:${PORT}/api/upwork/jobs/detail?url=...`);
  console.log(`   Score:  POST http://localhost:${PORT}/api/upwork/jobs/score`);
  console.log(`   Batch:  POST http://localhost:${PORT}/api/upwork/jobs/score-batch`);
  console.log(`   Messages: GET http://localhost:${PORT}/api/upwork/conversations`);
  if (OPENAI_API_KEY) console.log(`   AI Proposals: POST http://localhost:${PORT}/api/upwork/proposals/generate`);
  console.log(`   Monitor: GET  http://localhost:${PORT}/api/upwork/monitor/status`);
  console.log(`   Watches: GET  http://localhost:${PORT}/api/upwork/monitor/watches`);
  console.log(`   Scan:    POST http://localhost:${PORT}/api/upwork/monitor/scan`);
  console.log(`   Setup:   POST http://localhost:${PORT}/api/upwork/monitor/setup`);
  console.log('');
});

export default app;
