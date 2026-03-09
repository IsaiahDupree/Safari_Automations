/**
 * LinkedIn Automation API Server
 * REST API for connections, messaging, profile extraction, and lead scoring.
 * Port: 3105
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  SafariDriver,
  getDefaultDriver,
  navigateToNetwork,
  navigateToProfile,
  navigateToMessaging,
  extractProfile,
  getConnectionStatus,
  sendConnectionRequest,
  listPendingRequests,
  acceptRequest,
  searchPeople,
  scoreProfile,
  listConversations,
  readMessages,
  openConversation,
  sendMessage,
  sendMessageToProfile,
  openNewCompose,
  getUnreadCount,
  runProspectingPipeline,
  searchAndScore,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { RateLimitConfig, ConnectionRequest, PeopleSearchConfig } from '../automation/types.js';
import type { ProspectingConfig } from '../automation/prospecting-pipeline.js';
import {
  createCampaign, getCampaigns, getCampaign,
  getProspects, getStats, getRecentRuns,
  runOutreachCycle,
  markConverted, markOptedOut, addProspectNote, tagProspect,
} from '../automation/outreach-engine.js';
import type { ProspectStage } from '../automation/outreach-engine.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { ChromeTabCoordinator } from '../automation/chrome-tab-coordinator.js';

const PORT = process.env.LINKEDIN_PORT || 3105;
const SERVICE_NAME_TAB = 'linkedin-automation';
const SERVICE_PORT_TAB = 3105;
const SESSION_URL_PATTERN = 'linkedin.com';
const activeCoordinators = new Map<string, TabCoordinator>();
const chromeCoordinators = new Map<string, ChromeTabCoordinator>();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AUTH_TOKEN = process.env.LINKEDIN_AUTH_TOKEN || 'test-token-12345';
const REPLY_POLL_INTERVAL_MS = parseInt(process.env.REPLY_POLL_INTERVAL_MS || '300000', 10); // 5 min default
const SESSION_HEALTH_INTERVAL_MS = parseInt(process.env.SESSION_HEALTH_INTERVAL_MS || '1800000', 10); // 30 min default
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// Reply watcher state
let replyWatcherInterval: NodeJS.Timeout | null = null;
let conversationSnapshot = new Map<string, number>(); // conversationId -> lastMessageTimestamp
let unreadReplies: Array<{ conversationId: string; senderHandle: string; messagePreview: string; detectedAt: string }> = [];

// Session health state
let sessionHealthInterval: NodeJS.Timeout | null = null;
let sessionHealthy: boolean = true;
let lastSessionHealthCheck: string = new Date().toISOString();

// Authentication middleware
function requireAuth(req: Request, res: Response, next: any): void {
  // Skip auth for OPTIONS preflight requests
  if (req.method === 'OPTIONS') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Missing Authorization header', message: 'Authorization required' });
    return;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(400).json({ error: 'Malformed Authorization header', message: 'Expected format: Bearer <token>' });
    return;
  }

  const token = parts[1];
  if (!token || token.trim() === '') {
    res.status(400).json({ error: 'Empty token', message: 'Token cannot be empty' });
    return;
  }

  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Invalid token', message: 'Authentication failed' });
    return;
  }

  next();
}

// Rate limiting state
let connectionsToday = 0;
let messagesToday = 0;
let messagesSentToday = 0;
let messagesSentThisHour = 0;
let actionsThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

// Reset messagesSentThisHour every hour
setInterval(() => {
  messagesSentThisHour = 0;
}, 3_600_000);

// Reset messagesSentToday every 24 hours
setInterval(() => {
  messagesSentToday = 0;
}, 86_400_000);

// In-memory pipeline state for prospect discovery
let pipelineState: { running: boolean; step: string; stats: Record<string, number> } = {
  running: false,
  step: 'idle',
  stats: { discovered: 0, qualified: 0, stored: 0, skipped: 0 },
};

// Safari command mutex — prevents concurrent Safari operations from crashing each other
let safariLocked = false;
let safariLockedSince = 0;
const SAFARI_LOCK_TIMEOUT_MS = 120_000; // auto-release stale locks after 2 min

function acquireSafariLock(): boolean {
  const now = Date.now();
  // Auto-release stale locks (crashed/hung operations)
  if (safariLocked && now - safariLockedSince > SAFARI_LOCK_TIMEOUT_MS) {
    console.warn('[SafariLock] Auto-releasing stale lock (timeout exceeded)');
    safariLocked = false;
  }
  if (safariLocked) return false;
  safariLocked = true;
  safariLockedSince = now;
  return true;
}

function releaseSafariLock(): void {
  safariLocked = false;
  safariLockedSince = 0;
}

async function withSafariLock<T>(
  res: Response,
  label: string,
  fn: () => Promise<T>,
): Promise<T | void> {
  if (!acquireSafariLock()) {
    const heldForSec = Math.round((Date.now() - safariLockedSince) / 1000);
    const retryAfter = Math.max(5, Math.ceil((SAFARI_LOCK_TIMEOUT_MS / 1000) - heldForSec));
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Safari busy — another operation is in progress',
      lockedFor: `${heldForSec}s`,
      retryAfter: `${retryAfter}s`,
    });
    return;
  }
  console.log(`[SafariLock] Acquired for: ${label}`);
  try {
    return await fn();
  } finally {
    releaseSafariLock();
    console.log(`[SafariLock] Released: ${label}`);
  }
}

function resetCountersIfNeeded() {
  const now = Date.now();
  if (now - lastHourReset > 3600000) {
    actionsThisHour = 0;
    lastHourReset = now;
  }
  if (now - lastDayReset > 86400000) {
    connectionsToday = 0;
    messagesToday = 0;
    lastDayReset = now;
  }
}

function checkHourlyLimit(): boolean {
  resetCountersIfNeeded();
  if (actionsThisHour >= rateLimits.searchesPerHour) return false;
  actionsThisHour++;
  return true;
}

function isWithinActiveHours(): boolean {
  const hour = new Date().getHours();
  return hour >= rateLimits.activeHoursStart && hour < rateLimits.activeHoursEnd;
}

// Test accounts — always bypass active hours restrictions
const TEST_PROFILE_URLS = new Set([
  'https://www.linkedin.com/in/isaiah-dupree33/',
  'https://www.linkedin.com/in/isaiah-dupree33',
]);
function isTestAccount(profileUrl?: string, username?: string): boolean {
  if (profileUrl && TEST_PROFILE_URLS.has(profileUrl.split('?')[0].replace(/\/$/, '') + '/')) return true;
  if (username && (username === 'isaiah-dupree33' || username === 'isaiah-dupree33/')) return true;
  return false;
}

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// Uses a single STABLE agentId so the same tab is reused across all requests,
// rather than creating a new auto-ID on each request which would race with other tabs.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.linkedin.com/messaging/';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;
const STABLE_AGENT_ID = 'linkedin-automation-stable';

// Module-level stable coordinator — persists across requests, renewed every 30s
let stableCoord: InstanceType<typeof TabCoordinator> | null = null;

// Heartbeat loop: keeps the claim alive so it never expires (TTL=60s, heartbeat=30s)
setInterval(async () => {
  try {
    if (stableCoord) await stableCoord.heartbeat();
  } catch { /* claim gone, next request will re-claim */ }
}, 30_000);

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  // Check if our stable claim is still registered in the shared registry
  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.agentId === STABLE_AGENT_ID);

  if (myClaim) {
    // Reuse existing stable claim — no new tab gets grabbed
    getDefaultDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  // No stable claim — create or re-use the stable coordinator and claim now
  if (!stableCoord) {
    stableCoord = new TabCoordinator(STABLE_AGENT_ID, SERVICE_NAME_TAB, Number(PORT), SESSION_URL_PATTERN);
    activeCoordinators.set(STABLE_AGENT_ID, stableCoord);
  }
  try {
    const claim = await stableCoord.claim();
    getDefaultDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Stable claim: w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for linkedin-automation',
      detail: String(err),
      fix: `Open Safari and navigate to https://www.linkedin.com/messaging/, or POST /api/tabs/claim with { agentId, openUrl: "https://www.linkedin.com/messaging/" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────

  res.json({
    status: 'ok',
    service: 'linkedin-automation',
    timestamp: new Date().toISOString(),
    platform: 'linkedin',
    port: PORT,
    uptime: process.uptime(),
    withinActiveHours: isWithinActiveHours(),
    rateLimits: {
      messagesSentToday,
      messagesSentThisHour,
      limits: {
        messagesPerHour: rateLimits.messagesPerDay > 0 ? Math.ceil(rateLimits.messagesPerDay / 24) : 10,
        messagesPerDay: rateLimits.messagesPerDay || 20,
        activeHoursStart: rateLimits.activeHoursStart,
        activeHoursEnd: rateLimits.activeHoursEnd,
      },
    },
    counters: { connectionsToday, messagesToday, actionsThisHour },
    safari: { locked: safariLocked, lockedForMs: safariLocked ? Date.now() - safariLockedSince : 0 },
  });
});

// Apply authentication to all /api/* routes
app.use('/api/*', requireAuth);

app.get('/api/linkedin/status', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    // Status is CLAIM_EXEMPT so requireTabClaim never runs — pin the driver's
    // tracked tab manually so getCurrentUrl() reads the LinkedIn tab, not Safari's
    // front document (which could be TikTok/Upwork/etc running in another tab).
    const claims = await TabCoordinator.listClaims();
    const myClaim = claims.find(c => c.service === SERVICE_NAME_TAB);
    if (myClaim) {
      driver.setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    }
    const isOnLinkedIn = await driver.isOnLinkedIn();
    const isLoggedIn = isOnLinkedIn ? await driver.isLoggedIn() : false;
    const url = await driver.getCurrentUrl();

    res.json({
      isOnLinkedIn,
      isLoggedIn,
      currentUrl: url,
      withinActiveHours: isWithinActiveHours(),
      rateLimits: { connectionsToday, messagesToday, actionsThisHour },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Navigation ──────────────────────────────────────────────

app.post('/api/linkedin/navigate/network', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'navigate/network', async () => {
    const result = await navigateToNetwork();
    res.json(result);
  });
});

app.post('/api/linkedin/navigate/messaging', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'navigate/messaging', async () => {
    const result = await navigateToMessaging();
    res.json(result);
  });
});

app.post('/api/linkedin/navigate/profile', async (req: Request, res: Response) => {
  const { profileUrl } = req.body;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
  await withSafariLock(res, 'navigate/profile', async () => {
    const result = await navigateToProfile(profileUrl);
    res.json(result);
  });
});

app.post('/api/linkedin/navigate/via-google', async (req: Request, res: Response) => {
  const { profileUrl } = req.body;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
  await withSafariLock(res, 'navigate/via-google', async () => {
    const d = getDefaultDriver();
    const success = await d.navigateViaGoogle(profileUrl);
    res.json({ success, profileUrl, method: 'google_search' });
  });
});

// ─── Debug ───────────────────────────────────────────────────

app.post('/api/linkedin/debug/js', async (req: Request, res: Response) => {
  const { js } = req.body;
  if (!js) return res.status(400).json({ error: 'js required' });
  await withSafariLock(res, 'debug/js', async () => {
    const d = getDefaultDriver();
    const result = await d.executeJS(js);
    res.json({ result });
  });
});

app.post('/api/linkedin/debug/click', async (req: Request, res: Response) => {
  const { x, y } = req.body;
  if (typeof x !== 'number' || typeof y !== 'number') {
    return res.status(400).json({ error: 'x and y coordinates required as numbers' });
  }
  await withSafariLock(res, 'debug/click', async () => {
    const d = getDefaultDriver();
    const clicked = await d.clickAtViewportPosition(x, y);
    res.json({ success: clicked, x, y, timestamp: Date.now() });
  });
});

app.get('/api/linkedin/debug/screenshot', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'debug/screenshot', async () => {
    const d = getDefaultDriver();
    const tempPath = `/tmp/linkedin-screenshot-${Date.now()}.png`;
    const success = await d.takeScreenshot(tempPath);
    if (!success) {
      return res.status(500).json({ success: false, error: 'Screenshot failed' });
    }
    try {
      const fs = await import('fs/promises');
      const imageBuffer = await fs.readFile(tempPath);
      const imageBase64 = imageBuffer.toString('base64');
      await fs.unlink(tempPath).catch(() => {});
      res.json({ success: true, imageBase64, timestamp: Date.now() });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

// ─── Tab Management ──────────────────────────────────────────

app.post('/api/linkedin/tabs/open', async (req: Request, res: Response) => {
  try {
    const { purpose, url } = req.body;
    if (!purpose) {
      return res.status(400).json({ error: 'Missing purpose parameter' });
    }

    const d = getDefaultDriver();
    const tab = await d.openTab(purpose, url);

    if (!tab) {
      return res.status(500).json({ error: 'Failed to open tab' });
    }

    res.json({
      success: true,
      purpose,
      windowIndex: tab.windowIndex,
      tabIndex: tab.tabIndex,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/tabs/list', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const tabs = d.getTabPool();
    res.json({ tabs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/linkedin/tabs/:purpose', async (req: Request, res: Response) => {
  try {
    const { purpose } = req.params;
    const d = getDefaultDriver();
    const success = await d.closeTab(purpose);

    if (!success) {
      return res.status(404).json({ error: 'Tab not found or failed to close' });
    }

    res.json({ success: true, purpose });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/debug/wait-for-selector', async (req: Request, res: Response) => {
  await withSafariLock(res, 'debug/wait-for-selector', async () => {
    const { selector, timeoutMs } = req.body;
    if (!selector) {
      return res.status(400).json({ error: 'Missing selector parameter' });
    }

    const d = getDefaultDriver();
    const startTime = Date.now();
    const found = await d.waitForSelector(selector, timeoutMs || 10000);
    const elapsed = Date.now() - startTime;

    res.json({
      found,
      selector,
      elapsed,
      method: 'MutationObserver',
    });
  });
});

app.get('/api/linkedin/debug/selector-health', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'debug/selector-health', async () => {
    const d = getDefaultDriver();
    const { LINKEDIN_SELECTORS } = await import('../automation/types.js');
    const results: Record<string, boolean> = {};

    for (const [key, selector] of Object.entries(LINKEDIN_SELECTORS)) {
      const found = await d.executeJS(`
        document.querySelector('${selector.replace(/'/g, "\\'")}') !== null ? 'true' : 'false'
      `);
      results[key] = found === 'true';
    }

    const healthy = Object.values(results).every(v => v);

    res.json({
      healthy,
      results,
      timestamp: new Date().toISOString(),
    });
  });
});

app.post('/api/linkedin/debug/type-test', async (req: Request, res: Response) => {
  await withSafariLock(res, 'debug/type-test', async () => {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Missing text parameter' });
    }

    const d = getDefaultDriver();
    const result = await d.typeViaClipboard(text);

    res.json({
      success: result.success,
      method: result.method,
      text: text.substring(0, 50),
    });
  });
});

// ─── Profile Extraction ──────────────────────────────────────

app.get('/api/linkedin/profile/extract-current', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const url = await d.getCurrentUrl();
    const raw = await d.executeJS(`
      (function() {
        var mainEl = document.querySelector('main');
        if (!mainEl) return JSON.stringify({error: 'no main'});
        var mainText = mainEl.innerText;
        var NL = String.fromCharCode(10);
        var h2s = mainEl.querySelectorAll('h2');
        var name = '';
        var sectionHeadings = ['activity','experience','education','skills','interests','languages','certifications','recommendations','courses','projects','publications','honors','organizations','volunteering','about'];
        for (var i = 0; i < h2s.length; i++) {
          var t = h2s[i].innerText.trim();
          if (t.length > 2 && t.length < 60 && sectionHeadings.indexOf(t.toLowerCase()) === -1 && t.indexOf('notification') === -1) { name = t; break; }
        }
        var lines = mainText.split(NL).map(function(l){return l.trim();}).filter(function(l){return l.length > 0;});
        var nameIdx = -1;
        for (var ni = 0; ni < lines.length; ni++) { if (lines[ni] === name) { nameIdx = ni; break; } }
        var headline = '';
        var location = '';
        var connectionDegree = 'out_of_network';
        var mutualConnections = 0;
        if (nameIdx >= 0) {
          for (var li = nameIdx + 1; li < Math.min(nameIdx + 15, lines.length); li++) {
            var line = lines[li];
            if (line.match(/[123](?:st|nd|rd)/i) && line.length < 10) { connectionDegree = line.replace(/[^123]/g,'') === '1' ? '1st' : line.replace(/[^123]/g,'') === '2' ? '2nd' : '3rd'; continue; }
            if (line.toLowerCase() === 'contact info' || line === 'Connect' || line === 'Message' || line === 'Follow') continue;
            var mutMatch = line.match(/(\\d+).*mutual/i);
            if (mutMatch) { mutualConnections = parseInt(mutMatch[1]) || 0; continue; }
            if (line.toLowerCase().indexOf('mutual') !== -1) continue;
            if (sectionHeadings.indexOf(line.toLowerCase()) !== -1) break;
            if (line === 'Activity' || line === 'Show all') break;
            if (!headline && line.length > 5 && line !== name) { headline = line; continue; }
            if (headline && !location && (line.indexOf(',') !== -1 || line.indexOf('United States') !== -1)) { location = line; continue; }
          }
        }
        var currentPosition = null;
        for (var eh = 0; eh < h2s.length; eh++) {
          if (h2s[eh].innerText.trim() === 'Experience') {
            var expSection = h2s[eh].closest('section') || h2s[eh].parentElement;
            if (expSection) {
              var expLis = expSection.querySelectorAll('li');
              if (expLis.length > 0) {
                var expLines = expLis[0].innerText.trim().split(NL).map(function(l){return l.trim();}).filter(function(l){return l.length > 0;});
                if (expLines.length >= 2) { currentPosition = { title: expLines[0], company: expLines[1], duration: expLines.length > 2 ? expLines[2] : '' }; }
              }
            }
            break;
          }
        }
        var skills = [];
        for (var sh = 0; sh < h2s.length; sh++) {
          if (h2s[sh].innerText.trim() === 'Skills') {
            var skillSec = h2s[sh].closest('section') || h2s[sh].parentElement;
            if (skillSec) {
              var sLis = skillSec.querySelectorAll('li');
              for (var si = 0; si < Math.min(10, sLis.length); si++) {
                var sText = sLis[si].innerText.trim().split(NL)[0];
                if (sText.length > 1 && sText.length < 60 && sText !== 'Show all') skills.push(sText);
              }
            }
            break;
          }
        }
        var canConnect = false; var canMessage = false;
        var btns = document.querySelectorAll('button');
        for (var bi = 0; bi < btns.length; bi++) {
          var bLabel = (btns[bi].getAttribute('aria-label') || '') + ' ' + btns[bi].innerText;
          if (bLabel.match(/Connect|Invite.*connect/i)) canConnect = true;
          if (bLabel.match(/^Message/i)) canMessage = true;
        }
        var ancs = document.querySelectorAll('a');
        for (var ai = 0; ai < ancs.length; ai++) {
          var aLabel = (ancs[ai].getAttribute('aria-label') || '') + ' ' + ancs[ai].innerText.trim();
          var aHref = ancs[ai].href || '';
          if (aLabel.match(/Connect|Invite.*connect/i) || aHref.indexOf('custom-invite') !== -1) canConnect = true;
          if (aLabel.match(/^Message/i) || aHref.indexOf('/messaging/compose') !== -1) canMessage = true;
        }
        var isOpenToWork = mainText.indexOf('Open to work') !== -1 || mainText.indexOf('#OpenToWork') !== -1;
        var isHiring = mainText.indexOf('Hiring') !== -1 || mainText.indexOf('#Hiring') !== -1;
        var connectionCount = 0;
        var connMatches = mainText.match(/(\\d+[,\\d]*)\\s*connections?/i);
        if (connMatches) {
          connectionCount = parseInt(connMatches[1].replace(/,/g, '')) || 0;
        }
        var company = currentPosition ? currentPosition.company : '';
        var role = currentPosition ? currentPosition.title : '';
        var seniority = '';
        if (role) {
          var roleLower = role.toLowerCase();
          if (roleLower.indexOf('senior') !== -1 || roleLower.indexOf('sr.') !== -1 || roleLower.indexOf('lead') !== -1) seniority = 'senior';
          else if (roleLower.indexOf('junior') !== -1 || roleLower.indexOf('jr.') !== -1 || roleLower.indexOf('entry') !== -1) seniority = 'junior';
          else if (roleLower.indexOf('manager') !== -1 || roleLower.indexOf('director') !== -1 || roleLower.indexOf('vp') !== -1 || roleLower.indexOf('chief') !== -1 || roleLower.indexOf('head') !== -1) seniority = 'management';
          else seniority = 'mid';
        }
        return JSON.stringify({ name: name, headline: headline, location: location, connectionDegree: connectionDegree, mutualConnections: mutualConnections, currentPosition: currentPosition, company: company, role: role, seniority: seniority, connectionCount: connectionCount, skills: skills, canConnect: canConnect, canMessage: canMessage, isOpenToWork: isOpenToWork, isHiring: isHiring, nameIdx: nameIdx, linesCount: lines.length });
      })()
    `);
    const parsed = JSON.parse(raw || '{}');
    res.json({ url, ...parsed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/profile/:username', async (req: Request, res: Response) => {
  if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
  await withSafariLock(res, `profile/${req.params.username}`, async () => {
    const profile = await extractProfile(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Could not extract profile' });
    res.json(profile);
  });
});

app.post('/api/linkedin/profile/score', async (req: Request, res: Response) => {
  try {
    const { profile, targetTitles, targetCompanies, targetLocations } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile object required' });
    const score = scoreProfile(profile, targetTitles, targetCompanies, targetLocations);
    res.json(score);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Connections ─────────────────────────────────────────────

app.get('/api/linkedin/connections/status', async (req: Request, res: Response) => {
  const profileUrl = req.query.profileUrl as string;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl query param required' });
  if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
  await withSafariLock(res, 'connections/status', async () => {
    const status = await getConnectionStatus(profileUrl);
    res.json(status);
  });
});

app.post('/api/linkedin/connections/request', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (connectionsToday >= rateLimits.connectionRequestsPerDay) {
      return res.status(429).json({ error: 'Daily connection request limit reached', limit: rateLimits.connectionRequestsPerDay });
    }
    if (!isWithinActiveHours() && !req.body.force) {
      return res.status(403).json({ error: 'Outside active hours', activeHours: `${rateLimits.activeHoursStart}-${rateLimits.activeHoursEnd}`, hint: 'Add "force": true to bypass' });
    }

    const request: ConnectionRequest = {
      profileUrl: req.body.profileUrl,
      note: req.body.note,
      skipIfConnected: req.body.skipIfConnected !== false,
      skipIfPending: req.body.skipIfPending !== false,
    };

    if (!request.profileUrl) return res.status(400).json({ error: 'profileUrl required' });

    await withSafariLock(res, 'connections/request', async () => {
      const result = await sendConnectionRequest(request);
      if (result.success && result.status === 'sent') connectionsToday++;
      res.json(result);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/connections/pending', async (req: Request, res: Response) => {
  const type = (req.query.type as 'sent' | 'received') || 'received';
  await withSafariLock(res, 'connections/pending', async () => {
    const requests = await listPendingRequests(type);
    res.json({ requests, count: requests.length });
  });
});

app.post('/api/linkedin/connections/accept', async (req: Request, res: Response) => {
  const { profileUrl } = req.body;
  if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
  await withSafariLock(res, 'connections/accept', async () => {
    const accepted = await acceptRequest(profileUrl);
    res.json({ success: accepted });
  });
});

app.delete('/api/linkedin/connections/request/:requestId', async (req: Request, res: Response) => {
  const { requestId } = req.params;
  if (!requestId) return res.status(400).json({ error: 'requestId required' });

  await withSafariLock(res, 'connections/withdraw', async () => {
    try {
      const d = getDefaultDriver();

      // Navigate to sent connection requests page
      await d.navigateTo('https://www.linkedin.com/mynetwork/invitation-manager/sent/');
      await new Promise(r => setTimeout(r, 3000));

      // Try to withdraw the request by finding and clicking the "Withdraw" button
      const withdrawn = await d.executeJS(`
        (function() {
          var buttons = document.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var text = (btn.innerText || '').toLowerCase();
            var ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (text.indexOf('withdraw') !== -1 || ariaLabel.indexOf('withdraw') !== -1) {
              // Check if this button is for the right request (simplified - in production would need better matching)
              btn.click();
              return true;
            }
          }
          return false;
        })()
      `);

      if (withdrawn === 'true') {
        res.json({ success: true, message: 'Connection request withdrawn' });
      } else {
        res.json({ success: false, message: 'Could not find withdraw button' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message, success: false });
    }
  });
});

// ─── Search ──────────────────────────────────────────────────

app.post('/api/linkedin/search/people', async (req: Request, res: Response) => {
  if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
  await withSafariLock(res, 'search/people', async () => {
    const config: Partial<PeopleSearchConfig> = req.body;
    const results = await searchPeople(config);
    res.json({ results, count: results.length });
  });
});

app.get('/api/linkedin/search/extract-current', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const url = await d.getCurrentUrl();
    const raw = await d.executeJS(`
      (function() {
        var results = [];
        var processedLis = [];
        var mainEl = document.querySelector('main, [role="main"]');
        if (!mainEl) return JSON.stringify({ error: 'no main', liCount: 0 });
        var allLis = mainEl.querySelectorAll('li');

        for (var i = 0; i < allLis.length; i++) {
          var li = allLis[i];
          if (processedLis.indexOf(li) !== -1) continue;
          var links = li.querySelectorAll('a[href*="/in/"]');
          if (links.length === 0) continue;
          var href = '';
          for (var x = 0; x < links.length; x++) {
            var h = links[x].href.split('?')[0];
            if (h.indexOf('ACoAA') === -1) { href = h; break; }
          }
          if (!href) href = links[0].href.split('?')[0];
          processedLis.push(li);

          var nameSpans = [];
          var spans = li.querySelectorAll('span[aria-hidden="true"]');
          for (var j = 0; j < spans.length; j++) {
            var cl = spans[j].className || '';
            if (cl.indexOf('visually-hidden') !== -1) continue;
            var st = spans[j].innerText.trim();
            if (st.length > 2 && st.length < 150 && st.indexOf('Status') !== 0) nameSpans.push(st);
          }

          var name = '';
          for (var k = 0; k < nameSpans.length; k++) {
            if (nameSpans[k].charAt(0) !== '\\u2022' && nameSpans[k].indexOf('degree') === -1) {
              name = nameSpans[k]; break;
            }
          }

          var degree = '';
          for (var dd = 0; dd < nameSpans.length; dd++) {
            if (nameSpans[dd].indexOf('1st') !== -1) { degree = '1st'; break; }
            if (nameSpans[dd].indexOf('2nd') !== -1) { degree = '2nd'; break; }
            if (nameSpans[dd].indexOf('3rd') !== -1) { degree = '3rd'; break; }
          }

          var headline = '';
          var location = '';
          var divs = li.querySelectorAll('div');
          for (var di = 0; di < divs.length; di++) {
            var div = divs[di];
            if (div.children.length > 0) continue;
            var dt = div.innerText.trim();
            if (dt.length < 5 || dt.length > 200) continue;
            if (dt === name || dt.indexOf('degree') !== -1 || dt === 'Connect' || dt === 'Message' || dt === 'Follow') continue;
            if (!headline) { headline = dt; }
            else if (!location && dt.length < 60) { location = dt; break; }
          }

          if (name && href) {
            results.push({ name: name, profileUrl: href, headline: headline.substring(0, 150), location: location, connectionDegree: degree, mutualConnections: 0 });
          }
        }
        return JSON.stringify({ count: results.length, liTotal: allLis.length, results: results.slice(0, 20) });
      })()
    `);
    const parsed = JSON.parse(raw || '{}');
    res.json({ url, ...parsed });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Messages ────────────────────────────────────────────────

app.get('/api/linkedin/conversations', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'conversations', async () => {
    const nav = await navigateToMessaging();
    if (!nav.success) return res.status(500).json(nav);
    const convos = await listConversations();
    res.json({ conversations: convos, count: convos.length });
  });
});

app.get('/api/linkedin/messages', async (req: Request, res: Response) => {
  await withSafariLock(res, 'messages/list', async () => {
    const limit = parseInt(req.query.limit as string) || 20;
    const msgs = await readMessages(limit);
    res.json({ messages: msgs, count: msgs.length });
  });
});

app.get('/api/linkedin/messages/unread', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'messages/unread', async () => {
    const count = await getUnreadCount();
    res.json({ unreadCount: count });
  });
});

app.post('/api/linkedin/messages/open', async (req: Request, res: Response) => {
  const { participantName } = req.body;
  if (!participantName) return res.status(400).json({ error: 'participantName required' });
  await withSafariLock(res, 'messages/open', async () => {
    const opened = await openConversation(participantName);
    res.json({ success: opened });
  });
});

app.post('/api/linkedin/messages/send', async (req: Request, res: Response) => {
  resetCountersIfNeeded();
  if (messagesToday >= rateLimits.messagesPerDay && !req.body.force) {
    return res.status(429).json({ error: 'Daily message limit reached', hint: 'Add "force": true to bypass' });
  }
  const hour = new Date().getHours();
  if ((hour < 9 || hour >= 21) && !req.body.force && !isTestAccount(undefined, req.body.username)) {
    return res.status(429).json({ error: 'outside_active_hours', message: 'DMs only sent 9am–9pm' });
  }
  const { text, username, name } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  await withSafariLock(res, 'messages/send', async () => {
    const result = await sendMessage(text);
    if (result.success) {
      messagesToday++;
      messagesSentToday++;
      messagesSentThisHour++;
      // Sync to CRMLite — non-fatal
      if (username) {
        try {
          await fetch('https://crmlite-isaiahduprees-projects.vercel.app/api/sync/dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CRMLITE_API_KEY! },
            body: JSON.stringify({
              platform: 'linkedin',
              conversations: [{ username, display_name: name || username, messages: [{ text, is_outbound: true, sent_at: new Date().toISOString() }] }],
            }),
          });
        } catch (syncErr) {
          console.warn('[CRMLite] sync failed (non-fatal):', syncErr);
        }
      }
    }
    res.json(result);
  });
});

app.post('/api/linkedin/messages/send-to', async (req: Request, res: Response) => {
  resetCountersIfNeeded();
  if (messagesToday >= rateLimits.messagesPerDay && !req.body.force) {
    return res.status(429).json({ error: 'Daily message limit reached', hint: 'Add "force": true to bypass' });
  }
  const hour = new Date().getHours();
  if ((hour < 9 || hour >= 21) && !req.body.force && !isTestAccount(req.body.profileUrl, req.body.username)) {
    return res.status(429).json({ error: 'outside_active_hours', message: 'DMs only sent 9am–9pm' });
  }
  const { profileUrl, text, username, name } = req.body;
  if (!profileUrl || !text) return res.status(400).json({ error: 'profileUrl and text required' });
  await withSafariLock(res, 'messages/send-to', async () => {
    const result = await sendMessageToProfile(profileUrl, text);
    if (result.success) {
      messagesToday++;
      messagesSentToday++;
      messagesSentThisHour++;
      // Sync to CRMLite — non-fatal
      const recipient = username || profileUrl.split('/in/')[1]?.replace(/\/$/, '') || profileUrl;
      try {
        await fetch('https://crmlite-isaiahduprees-projects.vercel.app/api/sync/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CRMLITE_API_KEY! },
          body: JSON.stringify({
            platform: 'linkedin',
            conversations: [{ username: recipient, display_name: name || recipient, messages: [{ text, is_outbound: true, sent_at: new Date().toISOString() }] }],
          }),
        });
      } catch (syncErr) {
        console.warn('[CRMLite] sync failed (non-fatal):', syncErr);
      }
    }
    res.json(result);
  });
});

app.post('/api/linkedin/messages/new-compose', async (req: Request, res: Response) => {
  resetCountersIfNeeded();
  if (messagesToday >= rateLimits.messagesPerDay && !req.body.force && !req.body.dryRun) {
    return res.status(429).json({ error: 'Daily message limit reached', hint: 'Add "force": true to bypass' });
  }
  const hour = new Date().getHours();
  if ((hour < 9 || hour >= 21) && !req.body.force && !req.body.dryRun && !isTestAccount(req.body.profileUrl, req.body.username)) {
    return res.status(429).json({ error: 'outside_active_hours', message: 'DMs only sent 9am–9pm' });
  }
  const { recipientName, message, dryRun, username } = req.body;
  if (!recipientName || !message) {
    return res.status(400).json({ error: 'recipientName and message required' });
  }
  if (dryRun) {
    return res.json({ success: true, dryRun: true, recipientName, message: message.substring(0, 100) });
  }
  await withSafariLock(res, 'messages/new-compose', async () => {
    const result = await openNewCompose(recipientName, message);
    if (result.success) {
      messagesToday++;
      messagesSentToday++;
      messagesSentThisHour++;
      // Sync to CRMLite — non-fatal
      const recipient = username || recipientName.replace(/\s+/g, '-').toLowerCase();
      try {
        await fetch('https://crmlite-isaiahduprees-projects.vercel.app/api/sync/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CRMLITE_API_KEY! },
          body: JSON.stringify({
            platform: 'linkedin',
            conversations: [{ username: recipient, display_name: recipientName, messages: [{ text: message, is_outbound: true, sent_at: new Date().toISOString() }] }],
          }),
        });
      } catch (syncErr) {
        console.warn('[CRMLite] sync failed (non-fatal):', syncErr);
      }
    }
    res.json(result);
  });
});

// ─── AI Message Generation ───────────────────────────────────

app.post('/api/linkedin/ai/generate-message', async (req: Request, res: Response) => {
  try {
    const { profile, purpose, tone, context } = req.body;
    if (!profile) return res.status(400).json({ error: 'profile object required' });

    const purposeLabel = purpose || 'connection_note';
    const toneLabel = tone || 'professional';

    if (!OPENAI_API_KEY) {
      return res.json({
        text: `Hi ${profile.name?.split(' ')[0] || 'there'}, I came across your profile and would love to connect. ${profile.headline ? `Your work as ${profile.headline.substring(0, 50)} is impressive.` : ''} Looking forward to connecting!`,
        confidence: 0.3,
        aiGenerated: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const fallbackText = `Hi ${profile.name?.split(' ')[0] || 'there'}, would love to connect!`;
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `Generate a SHORT, personalized LinkedIn ${purposeLabel.replace(/_/g, ' ')} (max 280 chars for notes, 500 for messages). Tone: ${toneLabel}. Be specific, not generic. Reference their actual role/company. No emojis unless friendly tone.`,
            },
            {
              role: 'user',
              content: `Profile: ${profile.name}, ${profile.headline || ''}, ${profile.currentPosition?.company || ''}. Location: ${profile.location || ''}. ${context ? `Context: ${context}` : ''}`,
            },
          ],
          max_tokens: 150,
          temperature: 0.8,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[AI] OpenAI returned ${response.status}`);
        return res.json({ text: fallbackText, confidence: 0.3, aiGenerated: false });
      }

      const data = await response.json() as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content?.trim() || '';

      res.json({
        text: text || fallbackText,
        confidence: text ? 0.85 : 0.3,
        aiGenerated: !!text,
      });
    } catch (aiError) {
      clearTimeout(timeout);
      console.error('[AI] OpenAI request failed:', aiError instanceof Error ? aiError.message : aiError);
      res.json({ text: fallbackText, confidence: 0.3, aiGenerated: false });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Post Analytics ──────────────────────────────────────────

app.get('/api/linkedin/posts/recent', async (req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const limit = parseInt(req.query.limit as string) || 5;

    // Navigate to own activity feed
    await d.navigateTo('https://www.linkedin.com/in/me/recent-activity/all/');
    await new Promise(r => setTimeout(r, 4000));

    // Verify we're on LinkedIn
    const currentUrl = await d.getCurrentUrl();
    if (!currentUrl || !currentUrl.includes('linkedin.com')) {
      return res.json({ success: false, posts: [], error: 'Not on LinkedIn' });
    }

    // Extract posts with engagement metrics from the activity feed
    const raw = await d.executeJS(`(function(){` +
      `var posts=[];` +
      `var items=document.querySelectorAll('div.feed-shared-update-v2,div[data-urn*="activity"],li.profile-creator-shared-feed-update__container,div[data-view-name="feed-full-update"],article.feed-shared-update-v2,div.update-components-text');` +
      `for(var i=0;i<Math.min(items.length,${limit});i++){` +
        `var el=items[i];` +
        `var text=(el.innerText||'').trim();` +
        `var urn=el.getAttribute('data-urn')||'';` +
        `var postId=urn.replace(/.*:activity:/,'').replace(/[^0-9]/g,'');` +
        `if(!postId){var m=text.match(/activity:(\\d+)/);if(m)postId=m[1];}` +
        `if(!postId||postId.length<5)continue;` +
        `var reactions=0,comments=0,reposts=0;` +
        `var socialCounts=el.querySelectorAll('span.social-details-social-counts__reactions-count,button[aria-label*="reaction"],button[aria-label*="comment"],button[aria-label*="repost"]');` +
        `for(var j=0;j<socialCounts.length;j++){` +
          `var sc=socialCounts[j].textContent.trim();` +
          `var num=parseInt(sc.replace(/,/g,''));` +
          `if(!isNaN(num)&&num>0){` +
            `var label=(socialCounts[j].getAttribute('aria-label')||'').toLowerCase();` +
            `if(label.indexOf('reaction')>=0||label.indexOf('like')>=0)reactions=num;` +
            `else if(label.indexOf('comment')>=0)comments=num;` +
            `else if(label.indexOf('repost')>=0||label.indexOf('share')>=0)reposts=num;` +
          `}` +
        `}` +
        `if(reactions===0&&comments===0){` +
          `var nums=text.match(/(\\d+)\\s*(reactions?|likes?|comments?|reposts?)/gi)||[];` +
          `for(var k=0;k<nums.length;k++){` +
            `var pm=nums[k].match(/(\\d+)\\s*(\\w+)/);` +
            `if(pm){` +
              `var val=parseInt(pm[1]);` +
              `var typ=pm[2].toLowerCase();` +
              `if(typ.indexOf('reaction')>=0||typ.indexOf('like')>=0)reactions=val;` +
              `else if(typ.indexOf('comment')>=0)comments=val;` +
              `else if(typ.indexOf('repost')>=0)reposts=val;` +
            `}` +
          `}` +
        `}` +
        `var caption=text.substring(0,200);` +
        `var link=el.querySelector('a[href*="/feed/update/"]');` +
        `var url=link?link.href:'';` +
        `posts.push({postId:postId,url:url,caption:caption,reactions:reactions,comments:comments,reposts:reposts});` +
      `}` +
      `return JSON.stringify(posts);` +
    `})()`);

    const posts = JSON.parse(raw || '[]');
    res.json({ success: true, posts, count: posts.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── InMail Credits ──────────────────────────────────────────

app.get('/api/linkedin/credits', async (_req: Request, res: Response) => {
  try {
    const d = getDefaultDriver();
    const currentUrl = await d.getCurrentUrl();

    // Try to extract InMail credits from the current page
    const raw = await d.executeJS(`
      (function() {
        var text = document.body.innerText || '';
        var inmailMatch = text.match(/(\\d+)\\s*InMail.*(?:credit|message)/i);
        var credits = inmailMatch ? parseInt(inmailMatch[1]) || 0 : 0;

        // Also check for premium messaging credits
        var premiumMatch = text.match(/(\\d+)\\s*(?:premium|messaging)\\s*credit/i);
        if (premiumMatch && !inmailMatch) {
          credits = parseInt(premiumMatch[1]) || 0;
        }

        return JSON.stringify({
          inmailCredits: credits,
          source: currentUrl,
          found: credits > 0 || inmailMatch !== null || premiumMatch !== null
        });
      })()
    `);

    const parsed = JSON.parse(raw || '{}');

    res.json({
      inmailCredits: parsed.inmailCredits || 0,
      found: parsed.found || false,
      note: parsed.found ? 'Credits found on current page' : 'No InMail credits detected (may need to navigate to messaging or premium settings)',
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rate Limits ─────────────────────────────────────────────

app.get('/api/linkedin/rate-limits', (_req: Request, res: Response) => {
  resetCountersIfNeeded();
  res.json({
    config: rateLimits,
    current: { connectionsToday, messagesToday, actionsThisHour },
    withinActiveHours: isWithinActiveHours(),
  });
});

app.put('/api/linkedin/rate-limits', (req: Request, res: Response) => {
  rateLimits = { ...rateLimits, ...req.body };
  res.json({ updated: true, config: rateLimits });
});

// ─── Prospecting Pipeline ────────────────────────────────────

app.post('/api/linkedin/prospect/search-score', async (req: Request, res: Response) => {
  if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
  const { search, targetTitles, targetCompanies, targetLocations } = req.body;
  if (!search) return res.status(400).json({ error: 'search config required' });
  await withSafariLock(res, 'prospect/search-score', async () => {
    const results = await searchAndScore(search, targetTitles, targetCompanies, targetLocations);
    res.json({
      results,
      count: results.length,
      qualified: results.filter((r: any) => r.score.recommendation !== 'skip').length,
    });
  });
});

app.post('/api/linkedin/prospect/pipeline', async (req: Request, res: Response) => {
  try {
    if (!isWithinActiveHours() && !req.body.force) {
      return res.status(403).json({ error: 'Outside active hours', activeHours: `${rateLimits.activeHoursStart}-${rateLimits.activeHoursEnd}` });
    }

    const config: ProspectingConfig = {
      search: req.body.search || {},
      scoring: {
        targetTitles: req.body.targetTitles || [],
        targetCompanies: req.body.targetCompanies || [],
        targetLocations: req.body.targetLocations || [],
        minScore: req.body.minScore || 30,
      },
      connection: {
        sendRequest: req.body.sendConnections !== false,
        noteTemplate: req.body.noteTemplate || 'Hi {firstName}, I came across your work as {headline} and would love to connect.',
        skipIfConnected: true,
        skipIfPending: true,
      },
      dm: {
        enabled: req.body.sendDMs || false,
        messageTemplate: req.body.dmTemplate || 'Hi {firstName}, I noticed your experience in {headline}. I work on automation tools and thought we might have some synergies. Would love to chat!',
        onlyIfConnected: true,
      },
      maxProspects: req.body.maxProspects || 5,
      dryRun: req.body.dryRun !== false,
      delayBetweenActions: req.body.delayMs || 30000,
    };

    await withSafariLock(res, 'prospect/pipeline', async () => {
      const result = await runProspectingPipeline(config);
      if (result.summary.connectionsSent > 0) connectionsToday += result.summary.connectionsSent;
      if (result.summary.messagesSent > 0) messagesToday += result.summary.messagesSent;
      res.json(result);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Prospect Discovery Pipeline (orchestrator-compatible) ──

// GET /api/prospect/pipeline-status — returns { running, step, stats } from in-memory state
app.get('/api/prospect/pipeline-status', (_req: Request, res: Response) => {
  res.json(pipelineState);
});

// POST /api/prospect/run-pipeline — kicks off full ICP discovery → score → batch cycle
app.post('/api/prospect/run-pipeline', async (req: Request, res: Response) => {
  if (pipelineState.running) {
    return res.status(409).json({ error: 'Pipeline already running', step: pipelineState.step });
  }

  const {
    keywords = ['aiautomation', 'saasfounder', 'buildinpublic'],
    targetTitles = [],
    targetCompanies = [],
    targetLocations = [],
    maxProspects = 20,
    minScore = 30,
    dryRun = false,
  } = req.body as {
    keywords?: string[];
    targetTitles?: string[];
    targetCompanies?: string[];
    targetLocations?: string[];
    maxProspects?: number;
    minScore?: number;
    dryRun?: boolean;
  };

  if (dryRun) {
    return res.json({ discovered: 0, qualified: 0, stored: 0, skipped: 0, dryRun: true });
  }

  // Kick off async — respond immediately
  pipelineState = { running: true, step: 'starting', stats: { discovered: 0, qualified: 0, stored: 0, skipped: 0 } };
  res.json({ started: true, message: 'Pipeline started. Poll /api/prospect/pipeline-status for progress.' });

  // Run pipeline in background
  (async () => {
    const agentId = `linkedin-pipeline-${Date.now()}`;
    let coord: InstanceType<typeof TabCoordinator> | null = null;
    try {
      coord = new TabCoordinator(agentId, SERVICE_NAME_TAB, SERVICE_PORT_TAB, SESSION_URL_PATTERN);
      try {
        const claim = await coord.claim();
        console.log(`[prospect/run-pipeline] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex}`);
      } catch {
        console.warn('[prospect/run-pipeline] Tab claim failed (using current tab)');
        coord = null;
      }

      pipelineState.step = 'searching';
      const config: ProspectingConfig = {
        search: { keywords: keywords as string[] },
        scoring: { targetTitles, targetCompanies, targetLocations, minScore },
        connection: {
          sendRequest: false,
          noteTemplate: '',
          skipIfConnected: true,
          skipIfPending: true,
        },
        dm: {
          enabled: false,
          messageTemplate: '',
          onlyIfConnected: true,
        },
        maxProspects,
        dryRun: false,
        delayBetweenActions: 5000,
      };

      const result = await runProspectingPipeline(config);
      pipelineState.step = 'storing';

      const discovered = result.prospects?.length ?? result.summary.extracted;
      const qualified = result.summary.qualified;
      const stored = result.summary.qualified;
      const skipped = result.summary.skipped;

      pipelineState = { running: false, step: 'done', stats: { discovered, qualified, stored, skipped } };
      console.log(`[prospect/run-pipeline] Done: discovered=${discovered} qualified=${qualified} stored=${stored} skipped=${skipped}`);
    } catch (err) {
      console.error('[prospect/run-pipeline] Error:', err);
      pipelineState = { running: false, step: 'error', stats: { ...pipelineState.stats } };
    } finally {
      if (coord) { try { await coord.release(); } catch { /* ignore */ } }
    }
  })();
});

// POST /api/prospect/schedule-batch — schedules batched discovery run
app.post('/api/prospect/schedule-batch', async (req: Request, res: Response) => {
  const {
    limit = 5,
    dryRun = false,
    delayMinutes = 60,
  } = req.body as { limit?: number; dryRun?: boolean; delayMinutes?: number };

  const scheduledFor = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  if (dryRun) {
    return res.json({
      scheduled: true,
      dryRun: true,
      scheduledFor,
      limit,
      message: `[dryRun] Would schedule ${limit} prospect discovery batch at ${scheduledFor}`,
    });
  }

  // Queue via CRMLite safari_command_queue if available, else fire immediate pipeline
  setTimeout(async () => {
    console.log(`[prospect/schedule-batch] Firing scheduled batch (limit=${limit})`);
    try {
      await fetch(`http://localhost:${SERVICE_PORT_TAB}/api/prospect/run-pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH_TOKEN}` },
        body: JSON.stringify({ maxProspects: limit }),
      });
    } catch (err) {
      console.warn('[prospect/schedule-batch] Deferred trigger failed:', err);
    }
  }, delayMinutes * 60_000);

  res.json({
    scheduled: true,
    scheduledFor,
    limit,
    message: `Batch of ${limit} prospects scheduled in ${delayMinutes} minutes`,
  });
});

// ─── Outreach Engine ─────────────────────────────────────────

// Campaigns
app.post('/api/linkedin/outreach/campaigns', (req: Request, res: Response) => {
  try {
    const campaign = createCampaign(req.body);
    res.json({ success: true, campaign });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get('/api/linkedin/outreach/campaigns', (_req: Request, res: Response) => {
  res.json({ campaigns: getCampaigns() });
});

app.get('/api/linkedin/outreach/campaigns/:id', (req: Request, res: Response) => {
  const c = getCampaign(req.params.id);
  if (!c) return res.status(404).json({ error: 'Campaign not found' });
  res.json(c);
});

// Prospects
app.get('/api/linkedin/outreach/prospects', (req: Request, res: Response) => {
  const filters: any = {};
  if (req.query.campaign) filters.campaign = req.query.campaign;
  if (req.query.stage) filters.stage = (req.query.stage as string).split(',') as ProspectStage[];
  if (req.query.minScore) filters.minScore = parseInt(req.query.minScore as string);
  res.json({ prospects: getProspects(filters) });
});

// Stats
app.get('/api/linkedin/outreach/stats', (req: Request, res: Response) => {
  const campaign = req.query.campaign as string | undefined;
  res.json(getStats(campaign));
});

// Runs
app.get('/api/linkedin/outreach/runs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 10;
  res.json({ runs: getRecentRuns(limit) });
});

// Run outreach cycle
app.post('/api/linkedin/outreach/run', async (req: Request, res: Response) => {
  const { campaignId, dryRun, skipDiscovery, skipFollowUps } = req.body;
  if (!campaignId) return res.status(400).json({ error: 'campaignId required' });
  await withSafariLock(res, `outreach/run:${campaignId}`, async () => {
    const result = await runOutreachCycle(campaignId, { dryRun, skipDiscovery, skipFollowUps });
    if (result.summary.connectionsSent > 0) connectionsToday += result.summary.connectionsSent;
    if (result.summary.dmsSent > 0) messagesToday += result.summary.dmsSent;
    res.json(result);
  });
});

// Manual prospect actions
app.post('/api/linkedin/outreach/prospects/:id/convert', (req: Request, res: Response) => {
  const p = markConverted(req.params.id, req.body.notes);
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/opt-out', (req: Request, res: Response) => {
  const p = markOptedOut(req.params.id);
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/note', (req: Request, res: Response) => {
  const p = addProspectNote(req.params.id, req.body.note || '');
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

app.post('/api/linkedin/outreach/prospects/:id/tag', (req: Request, res: Response) => {
  const p = tagProspect(req.params.id, req.body.tag || '');
  if (!p) return res.status(404).json({ error: 'Prospect not found' });
  res.json({ success: true, prospect: p });
});

// ─── Supabase Integration ───────────────────────────────────

import { getSupabaseMock } from '../automation/supabase-mock.js';
const supabaseMock = getSupabaseMock();

// Test endpoints for Supabase data
app.get('/api/linkedin/test/supabase/actions', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseMock.getRecentActions(100);
  if (error) return res.status(500).json({ error });
  res.json({ actions: data, count: data.length });
});

app.get('/api/linkedin/test/supabase/contacts', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseMock.getContacts();
  if (error) return res.status(500).json({ error });
  res.json({ contacts: data, count: data.length });
});

app.get('/api/linkedin/test/supabase/conversations', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseMock.getConversations();
  if (error) return res.status(500).json({ error });
  res.json({ conversations: data, count: data.length });
});

app.get('/api/linkedin/test/supabase/messages', async (_req: Request, res: Response) => {
  const { data, error } = await supabaseMock.getMessages();
  if (error) return res.status(500).json({ error });
  res.json({ messages: data, count: data.length });
});

app.post('/api/linkedin/test/supabase/clear', (_req: Request, res: Response) => {
  supabaseMock.clearAll();
  res.json({ success: true, message: 'All Supabase mock data cleared' });
});

// ─── Session Management ──────────────────────────────────────

import { getSessionManager } from '../automation/session-manager.js';
const sessionManager = getSessionManager();

app.post('/api/linkedin/sessions', (req: Request, res: Response) => {
  try {
    const { ttlMs, config } = req.body;
    const session = sessionManager.createSession(config, ttlMs);
    res.json({
      success: true,
      sessionId: session.id,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/sessions', (_req: Request, res: Response) => {
  try {
    const sessions = sessionManager.listSessions();
    res.json({ sessions, count: sessions.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/sessions/:id', (req: Request, res: Response) => {
  try {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }
    res.json({
      id: session.id,
      createdAt: session.createdAt,
      lastAccessedAt: session.lastAccessedAt,
      expiresAt: session.expiresAt,
      timeToExpire: Math.max(0, session.expiresAt - Date.now()),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/linkedin/sessions/:id', (req: Request, res: Response) => {
  try {
    const removed = sessionManager.closeSession(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ success: true, message: 'Session closed' });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/sessions/:id/extend', (req: Request, res: Response) => {
  try {
    const { ttlMs } = req.body;
    const extended = sessionManager.extendSession(req.params.id, ttlMs);
    if (!extended) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }
    const session = sessionManager.getSession(req.params.id);
    res.json({
      success: true,
      expiresAt: session?.expiresAt,
      timeToExpire: session ? Math.max(0, session.expiresAt - Date.now()) : 0,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Reply Watcher ───────────────────────────────────────────

async function checkForNewReplies(): Promise<void> {
  // Skip if no stable tab claim — avoids executing JS in wrong window (front document)
  if (!stableCoord) return;
  try {
    const conversations = await listConversations();
    const now = new Date().toISOString();

    for (const convo of conversations) {
      const lastTimestamp = conversationSnapshot.get(convo.conversationId);
      const currentTimestamp = new Date(convo.lastMessageAt || now).getTime();

      if (lastTimestamp && currentTimestamp > lastTimestamp) {
        // New reply detected
        const senderHandle = convo.participantName.replace(/\s+/g, '-').toLowerCase();
        const reply = {
          conversationId: convo.conversationId,
          senderHandle,
          messagePreview: convo.lastMessage.substring(0, 100),
          detectedAt: now,
        };

        unreadReplies.push(reply);
        console.log(`[REPLY WATCHER] New reply from @${senderHandle}`);

        // Insert to Supabase if configured
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
          try {
            const response = await fetch(`${SUPABASE_URL}/rest/v1/linkedin_replies`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify(reply),
            });

            if (!response.ok) {
              console.error(`[REPLY WATCHER] Failed to insert to Supabase: ${response.statusText}`);
            }
          } catch (supabaseError) {
            console.error('[REPLY WATCHER] Supabase error:', supabaseError);
          }
        }
      }

      // Update snapshot
      conversationSnapshot.set(convo.conversationId, currentTimestamp);
    }
  } catch (error) {
    console.error('[REPLY WATCHER] Error checking for replies:', error);
  }
}

export function startReplyWatcher(): void {
  if (replyWatcherInterval) {
    console.log('[REPLY WATCHER] Already running');
    return;
  }

  console.log(`[REPLY WATCHER] Starting (interval: ${REPLY_POLL_INTERVAL_MS}ms)`);
  replyWatcherInterval = setInterval(checkForNewReplies, REPLY_POLL_INTERVAL_MS);

  // Initial check after 10 seconds
  setTimeout(checkForNewReplies, 10000);
}

export function stopReplyWatcher(): void {
  if (replyWatcherInterval) {
    clearInterval(replyWatcherInterval);
    replyWatcherInterval = null;
    console.log('[REPLY WATCHER] Stopped');
  }
}

app.get('/api/linkedin/replies/unread', (_req: Request, res: Response) => {
  res.json({
    count: unreadReplies.length,
    replies: unreadReplies,
  });
});

app.post('/api/linkedin/replies/watcher/start', (_req: Request, res: Response) => {
  startReplyWatcher();
  res.json({ success: true, status: 'started', interval: REPLY_POLL_INTERVAL_MS });
});

app.post('/api/linkedin/replies/watcher/stop', (_req: Request, res: Response) => {
  stopReplyWatcher();
  res.json({ success: true, status: 'stopped' });
});

app.delete('/api/linkedin/replies/unread', (_req: Request, res: Response) => {
  const count = unreadReplies.length;
  unreadReplies = [];
  res.json({ success: true, cleared: count });
});

// ─── Session Health Monitor ──────────────────────────────────

async function checkSessionHealth(): Promise<void> {
  // Skip if no stable tab claim — avoids executing JS in wrong window (front document)
  if (!stableCoord) return;
  try {
    const d = getDefaultDriver();
    const loggedIn = await d.isLoggedInToLinkedIn();
    const now = new Date().toISOString();

    lastSessionHealthCheck = now;

    if (!loggedIn) {
      sessionHealthy = false;
      console.log('[SESSION HEALTH] ⚠️ LinkedIn session expired');

      // Insert to Supabase if configured
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        try {
          const response = await fetch(`${SUPABASE_URL}/rest/v1/service_health`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              service: 'linkedin',
              healthy: false,
              checked_at: now,
            }),
          });

          if (!response.ok) {
            console.error(`[SESSION HEALTH] Failed to update Supabase: ${response.statusText}`);
          }
        } catch (supabaseError) {
          console.error('[SESSION HEALTH] Supabase error:', supabaseError);
        }
      }
    } else {
      if (!sessionHealthy) {
        console.log('[SESSION HEALTH] ✅ LinkedIn session restored');
      }
      sessionHealthy = true;

      // Update Supabase
      if (SUPABASE_URL && SUPABASE_ANON_KEY) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/service_health`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
              'Prefer': 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
              service: 'linkedin',
              healthy: true,
              checked_at: now,
            }),
          });
        } catch {
          // Silently skip Supabase update errors
        }
      }
    }
  } catch (error) {
    console.error('[SESSION HEALTH] Error checking session:', error);
  }
}

export function startSessionHealthMonitor(): void {
  if (sessionHealthInterval) {
    console.log('[SESSION HEALTH] Already running');
    return;
  }

  console.log(`[SESSION HEALTH] Starting (interval: ${SESSION_HEALTH_INTERVAL_MS}ms)`);
  sessionHealthInterval = setInterval(checkSessionHealth, SESSION_HEALTH_INTERVAL_MS);

  // Initial check after 5 seconds
  setTimeout(checkSessionHealth, 5000);
}

export function stopSessionHealthMonitor(): void {
  if (sessionHealthInterval) {
    clearInterval(sessionHealthInterval);
    sessionHealthInterval = null;
    console.log('[SESSION HEALTH] Stopped');
  }
}

app.get('/api/linkedin/health/session', async (_req: Request, res: Response) => {
  res.json({
    healthy: sessionHealthy,
    lastChecked: lastSessionHealthCheck,
    loginUrl: 'https://www.linkedin.com/login',
  });
});

app.get('/api/linkedin/health/full', async (_req: Request, res: Response) => {
  await withSafariLock(res, 'health/full', async () => {
    const d = getDefaultDriver();
    const { LINKEDIN_SELECTORS } = await import('../automation/types.js');

    // Selector health
    const selectorResults: Record<string, boolean> = {};
    for (const [key, selector] of Object.entries(LINKEDIN_SELECTORS)) {
      try {
        const found = await d.executeJS(`
          document.querySelector('${selector.replace(/'/g, "\\'")}') !== null ? 'true' : 'false'
        `);
        selectorResults[key] = found === 'true';
      } catch {
        selectorResults[key] = false;
      }
    }
    const selectorsHealthy = Object.values(selectorResults).every(v => v);

    // Tab pool status
    const tabs = d.getTabPool();

    res.json({
      session: {
        healthy: sessionHealthy,
        lastChecked: lastSessionHealthCheck,
      },
      selectors: {
        healthy: selectorsHealthy,
        results: selectorResults,
      },
      tabs: {
        count: tabs.length,
        tabs: tabs,
      },
      timestamp: new Date().toISOString(),
    });
  });
});

// ─── Tab Coordination Endpoints ──────────────────────────────

app.get('/api/tabs/claims', async (_req, res) => {
  const claims = await TabCoordinator.listClaims();
  res.json({ claims, count: claims.length });
});

app.post('/api/tabs/claim', async (req, res) => {
  const { agentId, windowIndex, tabIndex } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME_TAB, SERVICE_PORT_TAB, SESSION_URL_PATTERN);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    res.json({ ok: true, claim });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

app.post('/api/tabs/release', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
  res.json({ ok: true });
});

app.post('/api/tabs/heartbeat', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (!coord) { res.status(404).json({ error: `No claim for '${agentId}'` }); return; }
  await coord.heartbeat();
  res.json({ ok: true, heartbeat: Date.now() });
});

// ─── Chrome Tab Coordination Endpoints ──────────────────────────────────────

app.get('/api/chrome/tabs/claims', async (_req, res) => {
  const claims = await ChromeTabCoordinator.listClaims();
  res.json({ claims, count: claims.length });
});

app.post('/api/chrome/tabs/claim', async (req, res) => {
  const { agentId, windowIndex, tabIndex, openUrl } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = chromeCoordinators.get(agentId);
    if (!coord) {
      coord = new ChromeTabCoordinator(agentId, 'linkedin-chrome', SERVICE_PORT_TAB, SESSION_URL_PATTERN, openUrl);
      chromeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    res.json({ ok: true, claim });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

app.post('/api/chrome/tabs/release', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = chromeCoordinators.get(agentId);
  if (coord) { await coord.release(); chromeCoordinators.delete(agentId); }
  res.json({ ok: true });
});

app.post('/api/chrome/tabs/heartbeat', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = chromeCoordinators.get(agentId);
  if (!coord) { res.status(404).json({ error: `No Chrome claim for '${agentId}'` }); return; }
  await coord.heartbeat();
  res.json({ ok: true, heartbeat: Date.now() });
});

app.get('/api/session/status', (req, res) => {
  const info = getDefaultDriver().getSessionInfo();
  res.json({
    tracked: !!(info?.windowIndex),
    windowIndex: info?.windowIndex ?? null,
    tabIndex: info?.tabIndex ?? null,
    sessionUrlPattern: SESSION_URL_PATTERN,
  });
});

app.post('/api/session/ensure', async (req, res) => {
  try {
    const info = await getDefaultDriver().ensureActiveSession(SESSION_URL_PATTERN);
    res.json({
      ok: info.found,
      windowIndex: info.windowIndex,
      tabIndex: info.tabIndex,
      url: info.url,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/session/clear', (req, res) => {
  getDefaultDriver().clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

app.post('/api/debug/eval', async (req, res) => {
  try {
    const { js } = req.body;
    if (!js) { res.status(400).json({ error: 'js required' }); return; }
    const result = await getDefaultDriver().executeJS(js);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Discovery: Hashtag / Niche Feed ─────────────────────────
// GET /api/linkedin/discover/hashtag?tag=aiautomation&limit=20
// Returns top posts + authors from a hashtag feed.
app.get('/api/linkedin/discover/hashtag', async (req: Request, res: Response) => {
  await withSafariLock(res, 'discover/hashtag', async () => {
    const d = getDefaultDriver();
    const tag = (req.query.tag as string || '').replace(/^#/, '').trim();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    if (!tag) { res.status(400).json({ error: 'tag required' }); return; }

    await d.navigateTo(`https://www.linkedin.com/feed/hashtag/${encodeURIComponent(tag)}/`);
    await d.wait(4000);
    // Scroll to load more posts
    await d.executeJS(`(function(){var i=0;var t=setInterval(function(){window.scrollBy(0,700);if(++i>=6)clearInterval(t);},400);})();`);
    await d.wait(3000);

    const raw = await d.executeJS(`(function(){
      var posts=[];
      var seen={};
      var feed=document.querySelector('main .scaffold-finite-scroll__content, main [data-finite-scroll-hotkey-context]');
      var containers=feed?feed.children:document.querySelectorAll('div[data-urn*="activity"]');
      for(var i=0;i<Math.min(containers.length,${limit}*2);i++){
        var el=containers[i];
        var urn=el.getAttribute('data-urn')||'';
        if(!urn.includes('activity'))continue;
        var postId=urn.replace(/.*activity:/,'');
        if(seen[postId])continue;
        seen[postId]=1;
        var authorLink=el.querySelector('a[href*="/in/"]');
        if(!authorLink)continue;
        var authorUrl=authorLink.href.split('?')[0];
        var authorName=(authorLink.querySelector('span[aria-hidden]')||authorLink).innerText.trim().split('\\n')[0];
        var headline='';
        var headlineEl=el.querySelector('.update-components-actor__description span[aria-hidden],.feed-shared-actor__description span[aria-hidden]');
        if(headlineEl)headline=headlineEl.innerText.trim();
        var text='';
        var textEl=el.querySelector('.feed-shared-update-v2__description,.update-components-text');
        if(textEl)text=textEl.innerText.trim().substring(0,300);
        var reactions=0,comments=0;
        var rEl=el.querySelector('button[aria-label*="reaction"] span,.social-details-social-counts__reactions-count');
        if(rEl){var m=rEl.innerText.match(/\\d+/);if(m)reactions=parseInt(m[0]);}
        var cEl=el.querySelector('button[aria-label*="comment"]');
        if(cEl){var m2=cEl.innerText.match(/\\d+/);if(m2)comments=parseInt(m2[0]);}
        var postUrl='https://www.linkedin.com/feed/update/urn:li:activity:'+postId+'/';
        if(authorUrl&&authorUrl.includes('/in/')){
          posts.push(JSON.stringify({postId:postId,postUrl:postUrl,authorName:authorName,authorUrl:authorUrl,headline:headline.substring(0,150),text:text,reactions:reactions,comments:comments}));
        }
        if(posts.length>=${limit})break;
      }
      return '['+posts.join(',')+']';
    })()`);

    let posts: any[] = [];
    try { posts = JSON.parse(raw || '[]'); } catch {}
    // Deduplicate by authorUrl to find unique creators
    const creatorsMap: Record<string,any> = {};
    for (const p of posts) {
      if (!creatorsMap[p.authorUrl] || (p.reactions + p.comments) > (creatorsMap[p.authorUrl].reactions + creatorsMap[p.authorUrl].comments)) {
        creatorsMap[p.authorUrl] = p;
      }
    }
    const creators = Object.values(creatorsMap).sort((a:any,b:any) => (b.reactions+b.comments)-(a.reactions+a.comments));
    res.json({ tag, posts, creators, postCount: posts.length, creatorCount: creators.length });
  });
});

// ─── Discovery: Post Commenters ───────────────────────────────
// POST /api/linkedin/discover/commenters  { postUrl, limit }
// Navigate to a post and extract all visible commenters.
app.post('/api/linkedin/discover/commenters', async (req: Request, res: Response) => {
  await withSafariLock(res, 'discover/commenters', async () => {
    const d = getDefaultDriver();
    const { postUrl, limit = 30 } = req.body;
    if (!postUrl) { res.status(400).json({ error: 'postUrl required' }); return; }

    await d.navigateTo(postUrl);
    await d.wait(4000);
    // Scroll to expand comments
    await d.executeJS(`(function(){var i=0;var t=setInterval(function(){window.scrollBy(0,500);if(++i>=10)clearInterval(t);},400);})();`);
    await d.wait(3000);
    // Click "Load more comments" buttons
    await d.executeJS(`(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){var t=(btns[i].innerText||'').trim().toLowerCase();if(t.includes('load more comment')||t.includes('show more comment')){btns[i].click();}}})()`);
    await d.wait(2000);

    const raw = await d.executeJS(`(function(){
      var commenters=[];
      var seen={};
      var commentEls=document.querySelectorAll('.comments-comment-item,.comments-comment-list__comment-item');
      for(var i=0;i<Math.min(commentEls.length,${limit});i++){
        var el=commentEls[i];
        var link=el.querySelector('a[href*="/in/"]');
        if(!link)continue;
        var url=link.href.split('?')[0];
        if(seen[url]||!url.includes('/in/'))continue;
        seen[url]=1;
        var nameEl=link.querySelector('span[aria-hidden],.comments-post-meta__name-text');
        var name=nameEl?nameEl.innerText.trim():link.innerText.trim().split('\\n')[0];
        var headlineEl=el.querySelector('.comments-post-meta__headline,.comments-post-meta__description');
        var headline=headlineEl?headlineEl.innerText.trim():'';
        var text='';
        var textEl=el.querySelector('.comments-comment-item__main-content,.update-components-text');
        if(textEl)text=textEl.innerText.trim().substring(0,200);
        var likes=0;
        var likeEl=el.querySelector('button[aria-label*="reaction"] span,[data-reaction-type]');
        if(likeEl){var m=(likeEl.innerText||'').match(/\\d+/);if(m)likes=parseInt(m[0]);}
        if(name)commenters.push(JSON.stringify({name:name,profileUrl:url,headline:headline.substring(0,150),comment:text,likes:likes}));
      }
      return '['+commenters.join(',')+']';
    })()`);

    let commenters: any[] = [];
    try { commenters = JSON.parse(raw || '[]'); } catch {}
    res.json({ postUrl, commenters, count: commenters.length });
  });
});

// ─── Discovery: My Connections List ──────────────────────────
// GET /api/linkedin/discover/my-connections?limit=40&page=1
// Scrapes your own 1st-degree connection list.
app.get('/api/linkedin/discover/my-connections', async (req: Request, res: Response) => {
  await withSafariLock(res, 'discover/connections', async () => {
    const d = getDefaultDriver();
    const limit = Math.min(parseInt(req.query.limit as string) || 40, 100);
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const start = (page - 1) * limit;

    // LinkedIn connections search URL (1st degree only, sortBy RECENTLY_ADDED)
    const url = `https://www.linkedin.com/search/results/people/?network=%5B%22F%22%5D&origin=MEMBER_PROFILE_CANNED_SEARCH&start=${start}`;
    await d.navigateTo(url);
    await d.wait(4000);
    await d.executeJS(`(function(){var i=0;var t=setInterval(function(){window.scrollBy(0,600);if(++i>=6)clearInterval(t);},400);})();`);
    await d.wait(2500);

    const raw = await d.executeJS(`(function(){
      var results=[];
      var seen={};
      var mainEl=document.querySelector('main');
      if(!mainEl)return'[]';
      var links=mainEl.querySelectorAll('a[href*="/in/"]');
      for(var i=0;i<links.length;i++){
        var url=links[i].href.split('?')[0];
        if(seen[url]||!url.includes('/in/')||url.includes('ACoAA'))continue;
        seen[url]=1;
        var card=links[i];
        for(var p=0;p<4;p++){if(card.parentElement)card=card.parentElement;}
        var cardText=card.innerText||'';
        var nameEl=links[i].querySelector('span[aria-hidden]');
        var name=nameEl?nameEl.innerText.trim().split('\\n')[0]:links[i].innerText.trim().split('\\n')[0];
        name=name.replace(/\\s*(1st|2nd|3rd)\\s*$/i,'').trim();
        if(!name||name.length<2||name.length>80)continue;
        var lines=cardText.split('\\n').map(function(l){return l.trim();}).filter(function(l){return l.length>3;});
        var headline='';
        for(var j=0;j<lines.length;j++){var l=lines[j];if(l===name)continue;if(l.match(/\u2022\s*(1st|2nd|3rd)/i))continue;if(l.match(/^(Connect|Message|Follow|1st|2nd|3rd|Withdraw|Ignore|Accept)$/i))continue;if(l.match(/^\d+\s*mutual/i))continue;if(l.length>5&&l.length<200){headline=l;break;}}
        if(name&&url)results.push(JSON.stringify({name:name,profileUrl:url,headline:headline.substring(0,150),connectionDegree:'1st'}));
        if(results.length>=${limit})break;
      }
      return '['+results.join(',')+']';
    })()`);

    let connections: any[] = [];
    try { connections = JSON.parse(raw || '[]'); } catch {}
    res.json({ page, start, connections, count: connections.length });
  });
});

// ─── Discovery: Profile Network (People Also Viewed) ────────────────────────
// POST /api/linkedin/discover/profile-connections  { profileUrl, limit }
// Scrapes the "People Also Viewed" sidebar from a profile page (always visible).
app.post('/api/linkedin/discover/profile-connections', async (req: Request, res: Response) => {
  await withSafariLock(res, 'discover/profile-connections', async () => {
    const d = getDefaultDriver();
    const { profileUrl, limit = 40 } = req.body;
    if (!profileUrl) { res.status(400).json({ error: 'profileUrl required' }); return; }

    const vnMatch = profileUrl.match(/\/in\/([^/?]+)/);
    const vanityName = vnMatch ? vnMatch[1].replace(/\/$/, '') : '';
    if (!vanityName) { res.status(400).json({ error: 'Could not extract vanityName' }); return; }

    await d.navigateTo(`https://www.linkedin.com/in/${vanityName}/`);
    await d.wait(4000);
    await d.executeJS(`(function(){var i=0;var t=setInterval(function(){window.scrollBy(0,400);if(++i>=5)clearInterval(t);},350);})();`);
    await d.wait(2000);

    // Extract profile links, filtering out the profile's own section URLs.
    const raw = await d.executeJS(`(function(){
      var vanity='${vanityName}'.toLowerCase();
      var skipNames=['show all','contact info','link','experience','skills','education','recommendations','publications','honors','interests','top voices','browse','message','connect','follow','more','people also viewed','people you may know'];
      var results=[];
      var seen={};
      var links=document.querySelectorAll('a[href*="/in/"]');
      for(var i=0;i<links.length;i++){
        var url=links[i].href.split('?')[0];
        if(!url.includes('/in/'))continue;
        var path=url.replace(/https?:\/\/[^/]+/,'');
        if(path.toLowerCase().startsWith('/in/'+vanity+'/'))continue;
        if(url.includes('ACoAA')||url.includes('miniProfile'))continue;
        if(seen[url])continue;
        seen[url]=1;
        var card=links[i];
        for(var p=0;p<5;p++){if(card.parentElement)card=card.parentElement;}
        var nameEl=links[i].querySelector('span[aria-hidden]');
        var name=nameEl?nameEl.innerText.trim():links[i].innerText.trim().split('\\n')[0];
        name=name.replace(/\\s*(1st|2nd|3rd|\\u2022).*$/,'').trim();
        if(skipNames.indexOf(name.toLowerCase())!==-1)continue;
        if(!name||name.length<3||name.length>80)continue;
        var cardText=(card.innerText||'').trim();
        var lines=cardText.split('\\n').map(function(l){return l.trim();}).filter(function(l){return l.length>3;});
        var headline='';
        for(var j=0;j<lines.length;j++){
          var l=lines[j];
          if(l===name||skipNames.indexOf(l.toLowerCase())!==-1||l.match(/^(1st|2nd|3rd|\\d+)$/i))continue;
          if(l.length>5&&l.length<200&&!l.match(/^\\d+ mutual/i)){headline=l.substring(0,150);break;}
        }
        results.push(JSON.stringify({name:name,profileUrl:url,headline:headline}));
        if(results.length>=${limit})break;
      }
      return '['+results.join(',')+']';
    })()`);

    let connections: any[] = [];
    try { connections = JSON.parse(raw || '[]'); } catch {}
    const currentUrl = await d.getCurrentUrl();
    res.json({ profileUrl, vanityName, method: 'peopleAlsoViewed', navigatedUrl: currentUrl, connections, count: connections.length });
  });
});

// ─── Self-Poll Endpoint (SDPA-008) ───────────────────────────────────────────
// POST /api/linkedin/self-poll
// Called by cron-manager during quiet hours. Fetches DMs, invitations, post stats
// and writes results to safari_platform_cache for cloud-sync to consume.
app.post('/api/linkedin/self-poll', async (_req: Request, res: Response) => {
  const result = { dms: 0, invitations: 0, posts: 0 };

  try {
    const d = getDefaultDriver();

    // 1. Fetch conversations (DMs)
    let convos: any[] = [];
    try {
      const r = await listConversations(d);
      convos = Array.isArray(r) ? r : [];
      result.dms = convos.length;
    } catch (e) {
      console.warn('[self-poll:linkedin] conversations error:', (e as Error).message);
    }

    // 2. Fetch pending invitations
    let invitations: any[] = [];
    try {
      invitations = await listPendingRequests('received', d);
      result.invitations = invitations.length;
    } catch (e) {
      console.warn('[self-poll:linkedin] invitations error:', (e as Error).message);
    }

    // Write to safari_platform_cache if we have Supabase creds
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      const sbHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      };
      const ttlMap: Record<string, number> = { dms: 1_800_000, invitations: 7_200_000, post_stats: 21_600_000 };

      // Helper to upsert one cache row
      const writeCache = async (dataType: string, payload: any[]) => {
        if (!payload.length) return;
        // Delete old rows
        await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache?platform=eq.linkedin&data_type=eq.${dataType}`, {
          method: 'DELETE', headers: sbHeaders,
        }).catch(() => {});
        // Insert fresh row
        const expiresAt = new Date(Date.now() + ttlMap[dataType]).toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({ platform: 'linkedin', data_type: dataType, payload, expires_at: expiresAt, source_service_port: 3105 }),
        }).catch(() => {});
      };

      await Promise.all([
        writeCache('dms', convos),
        writeCache('invitations', invitations),
      ]);
    }

    res.json({ success: true, fetched: result });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[self-poll:linkedin] error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/self-poll/trigger — alias used by external health checks (SDPA-008)
app.get('/api/self-poll/trigger', async (_req: Request, res: Response) => {
  try {
    const { SelfPollCron } = await import('../self-poll-cron.js');
    const poller = new SelfPollCron(Number(PORT), AUTH_TOKEN);
    const result = await poller.tick();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Global 30s heartbeat refresh — Safari
setInterval(async () => {
  for (const [id, coord] of activeCoordinators) {
    try { await coord.heartbeat(); }
    catch { activeCoordinators.delete(id); }
  }
}, 30_000);

// Global 30s heartbeat refresh — Chrome
setInterval(async () => {
  for (const [id, coord] of chromeCoordinators) {
    try { await coord.heartbeat(); }
    catch { chromeCoordinators.delete(id); }
  }
}, 30_000);

// ─── Start Server ────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🔗 LinkedIn Automation API running on http://localhost:${PORT}`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
  console.log(`   Status: GET http://localhost:${PORT}/api/linkedin/status`);
  console.log(`   Profile: GET http://localhost:${PORT}/api/linkedin/profile/:username`);
  console.log(`   Connect: POST http://localhost:${PORT}/api/linkedin/connections/request`);
  console.log(`   Search: POST http://localhost:${PORT}/api/linkedin/search/people`);
  console.log(`   Messages: GET http://localhost:${PORT}/api/linkedin/conversations`);
  if (OPENAI_API_KEY) console.log(`   AI: POST http://localhost:${PORT}/api/linkedin/ai/generate-message`);
  console.log(`   Prospect: POST http://localhost:${PORT}/api/linkedin/prospect/search-score`);
  console.log(`   Pipeline: POST http://localhost:${PORT}/api/linkedin/prospect/pipeline`);
  console.log(`   ── Outreach Engine ──`);
  console.log(`   Campaigns: POST/GET http://localhost:${PORT}/api/linkedin/outreach/campaigns`);
  console.log(`   Prospects: GET http://localhost:${PORT}/api/linkedin/outreach/prospects`);
  console.log(`   Stats:     GET http://localhost:${PORT}/api/linkedin/outreach/stats`);
  console.log(`   Run Cycle: POST http://localhost:${PORT}/api/linkedin/outreach/run`);
  console.log(`   Runs:      GET http://localhost:${PORT}/api/linkedin/outreach/runs`);
  console.log(`   Rate limits: connections ${rateLimits.connectionRequestsPerDay}/day, messages ${rateLimits.messagesPerDay}/day`);
  console.log(`   Active hours: ${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00`);
  console.log('');

  // Startup selector health check
  setTimeout(async () => {
    try {
      const d = getDefaultDriver();
      const { LINKEDIN_SELECTORS } = await import('../automation/types.js');
      const brokenSelectors: string[] = [];

      for (const [key, selector] of Object.entries(LINKEDIN_SELECTORS)) {
        try {
          const found = await d.executeJS(`
            document.querySelector('${selector.replace(/'/g, "\\'")}') !== null ? 'true' : 'false'
          `);
          if (found !== 'true') {
            brokenSelectors.push(key);
          }
        } catch {
          // Ignore errors during health check (might not be on LinkedIn yet)
        }
      }

      if (brokenSelectors.length > 0) {
        console.warn(`⚠️  [SELECTOR HEALTH] ${brokenSelectors.length} broken selectors detected:`, brokenSelectors);
      } else {
        console.log(`✅ [SELECTOR HEALTH] All ${Object.keys(LINKEDIN_SELECTORS).length} selectors healthy`);
      }
    } catch (error) {
      // Silently skip health check if Safari isn't ready
    }
  }, 3000);
});

export default app;
