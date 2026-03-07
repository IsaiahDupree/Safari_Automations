/**
 * Twitter/X DM API Server
 * REST API for DM operations - can be called from CRM server.
 * Now with AI-powered message generation!
 */

import { config as _dotenv } from 'dotenv'; _dotenv({ override: true });
import express, { Request, Response, NextFunction } from 'express';

// AI for DM generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_API_KEY) {
  console.log('[AI] ✅ OpenAI API key loaded - AI DMs enabled');
}

// Supabase CRM logging (optional)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  console.log('[CRM] ✅ Supabase credentials loaded - CRM logging enabled');
}

async function logToSupabase(username: string, text: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/crm_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        platform: 'twitter',
        to_user: username,
        content: text,
        sent_at: new Date().toISOString(),
        status: 'sent'
      })
    }).catch(() => {}); // Fire and forget
  } catch {
    // Non-fatal - don't block DM send on CRM logging failure
  }
}

export async function generateAIDM(context: { recipientUsername: string; purpose: string; topic?: string }): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Hey! Really enjoy your takes on ${context.topic || 'things'}. Would love to connect and chat more about it.`;
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Generate a SHORT, personalized Twitter/X DM (max 150 chars). Be professional yet witty, direct, and genuine. Match the conversational tone of Twitter.' },
          { role: 'user', content: `DM to @${context.recipientUsername} for ${context.purpose}. ${context.topic ? `Topic: ${context.topic}` : ''}` }
        ],
        max_tokens: 80,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || `Hey! Your tweets are solid. Would love to connect.`;
  } catch {
    clearTimeout(timeout);
    return `Hey! Your tweets are solid. Would love to connect.`;
  }
}
import cors from 'cors';
import {
  SafariDriver,
  navigateToInbox,
  listConversations,
  switchTab,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  getUnreadConversations,
  scrollConversation,
  getAllConversations,
  detectTwitterRateLimit,
  searchConversations,
  getProfileInfo,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { DMTab, RateLimitConfig } from '../automation/types.js';
import { isWithinActiveHours } from '../utils/index.js';
import { initDMLogger, logDM, getDMStats } from '../utils/dm-logger.js';
import { initScoringService, recalculateScore, recalculateAllScores, getTopContacts } from '../utils/scoring-service.js';
import { initTemplateEngine, getNextBestAction, getTemplates, detectFitSignals, getPendingActions, queueOutreachAction, markActionSent, markActionFailed, getOutreachStats, check31Rule } from '../utils/template-engine.js';
import { discoverProspects, scoreICP, ICP_KEYWORDS } from './prospect-discovery.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize CRM logging + scoring + templates
initDMLogger();
initScoringService();
initTemplateEngine();

// Rate limiting state
let messagesSentToday = 0;
let messagesSentThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

// Safari driver instance
let driver: SafariDriver | null = null;

// URL pattern that identifies the Twitter Safari session
// x.com is the canonical domain (twitter.com redirects to x.com in Safari)
const SESSION_URL_PATTERN = 'x.com';
const SERVICE_NAME = 'twitter-dm';
const SERVICE_PORT = 3003;

// Active tab coordinators by agentId (in-process map; file is cross-process)
const activeCoordinators = new Map<string, InstanceType<typeof TabCoordinator>>();

function getDriver(): SafariDriver {
  if (!driver) {
    driver = new SafariDriver({
      verbose: process.env.VERBOSE === 'true',
    });
  }
  return driver;
}

/**
 * Ensure the Twitter Safari tab is the active/front tab before any operation.
 * Scans all Safari windows, finds the twitter.com tab, and activates it.
 */
async function ensureTwitterSession(): Promise<{ ok: boolean; windowIndex: number; tabIndex: number; url: string }> {
  const info = await getDriver().ensureActiveSession(SESSION_URL_PATTERN);
  return { ok: info.found, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url };
}

// Rate limit check middleware
function checkRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const force = req.body?.force === true;

  // Reset hourly counter
  if (now - lastHourReset > 60 * 60 * 1000) {
    messagesSentThisHour = 0;
    lastHourReset = now;
  }

  // Reset daily counter
  if (now - lastDayReset > 24 * 60 * 60 * 1000) {
    messagesSentToday = 0;
    lastDayReset = now;
  }

  // Check active hours (can be bypassed with force flag)
  if (!isWithinActiveHours(rateLimits.activeHoursStart, rateLimits.activeHoursEnd)) {
    if (force) {
      console.log('[FORCE] ⚠️  Active hours check bypassed by force flag');
    } else {
      res.status(429).json({
        error: 'Outside active hours',
        activeHours: `${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00`
      });
      return;
    }
  }
  
  // Check limits
  if (messagesSentThisHour >= rateLimits.messagesPerHour) {
    res.status(429).json({ error: 'Hourly rate limit exceeded' });
    return;
  }
  
  if (messagesSentToday >= rateLimits.messagesPerDay) {
    res.status(429).json({ error: 'Daily rate limit exceeded' });
    return;
  }
  
  next();
}

function recordMessageSent(): void {
  messagesSentThisHour++;
  messagesSentToday++;
}

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://x.com/messages';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/session|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);

  if (myClaim) {
    // Claim exists — pin driver to the claimed tab and proceed
    getDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  // No claim — auto-claim now (open new tab if needed)
  const autoId = `twitter-dm-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for twitter-dm',
      detail: String(err),
      fix: `Open Safari and navigate to https://x.com/messages, or POST /api/tabs/claim with { agentId, openUrl: "https://x.com/messages" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────

// === HEALTH ===

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'twitter-dm',
    timestamp: new Date().toISOString()
  });
});

// ── Cross-agent tab claim registry ──────────────────────────────────────────
// All Safari services share /tmp/safari-tab-claims.json.
// These endpoints let any agent register/release its tab claim.

// GET /api/tabs/claims — list all live tab claims across all services
app.get('/api/tabs/claims', async (_req: Request, res: Response) => {
  try {
    const claims = await TabCoordinator.listClaims();
    res.json({ claims, count: claims.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/claim — claim a Safari tab for this service
// Body: { agentId: string, windowIndex?: number, tabIndex?: number, openUrl?: string }
app.post('/api/tabs/claim', async (req: Request, res: Response) => {
  const { agentId, windowIndex, tabIndex, openUrl } = req.body as {
    agentId: string;
    windowIndex?: number;
    tabIndex?: number;
    openUrl?: string;
  };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, openUrl);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    res.json({ ok: true, claim, message: `Tab ${claim.windowIndex}:${claim.tabIndex} claimed by '${agentId}'` });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

// POST /api/tabs/release — release tab claim
app.post('/api/tabs/release', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    const coord = activeCoordinators.get(agentId);
    if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
    res.json({ ok: true, message: `Claim released for '${agentId}'` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/heartbeat — keep claim alive
app.post('/api/tabs/heartbeat', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    const coord = activeCoordinators.get(agentId);
    if (!coord?.activeClaim) { res.status(404).json({ error: `No active claim for '${agentId}'` }); return; }
    await coord.heartbeat();
    res.json({ ok: true, heartbeat: Date.now() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
// ────────────────────────────────────────────────────────────────────────────


// === SESSION MANAGEMENT ===

app.get('/api/session/status', (req: Request, res: Response) => {
  const info = getDriver().getSessionInfo();
  res.json({
    tracked: !!info.windowIndex,
    windowIndex: info.windowIndex,
    tabIndex: info.tabIndex,
    urlPattern: info.urlPattern,
    lastVerifiedMs: info.lastVerified ? Date.now() - info.lastVerified : null,
    sessionUrlPattern: SESSION_URL_PATTERN,
  });
});

app.post('/api/session/ensure', async (req: Request, res: Response) => {
  try {
    const info = await ensureTwitterSession();
    res.json({
      ok: info.ok,
      windowIndex: info.windowIndex,
      tabIndex: info.tabIndex,
      url: info.url,
      message: info.ok
        ? `Twitter session active at window ${info.windowIndex}, tab ${info.tabIndex}`
        : 'Twitter tab not found — open Safari and navigate to twitter.com',
    });
  } catch (error) {
    const msg = String(error);
    if (msg.includes('No tab found') || msg.includes("No 'x.com'") || msg.includes('x.com')) {
      res.json({ ok: false, error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

app.post('/api/session/clear', (req: Request, res: Response) => {
  getDriver().clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

// === STATUS ===

app.get('/api/twitter/status', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const currentUrl = await d.getCurrentUrl();
    const isOnTwitter = currentUrl.includes('twitter.com') || currentUrl.includes('x.com');
    const isLoggedIn = isOnTwitter ? await d.isLoggedIn() : false;

    res.json({
      isOnTwitter,
      isLoggedIn,
      currentUrl,
      driverConfig: d.getConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === RATE LIMITS ===

app.get('/api/twitter/rate-limits', (req: Request, res: Response) => {
  const hour = new Date().getHours();
  res.json({
    messagesSentToday,
    messagesSentThisHour,
    limits: rateLimits,
    activeHours: {
      start: rateLimits.activeHoursStart,
      end: rateLimits.activeHoursEnd,
      currentHour: hour,
      isActive: isWithinActiveHours(rateLimits.activeHoursStart, rateLimits.activeHoursEnd),
    },
  });
});

app.put('/api/twitter/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<RateLimitConfig>;
  rateLimits = { ...rateLimits, ...updates };
  res.json({ rateLimits });
});

app.get('/api/twitter/rate-status', async (req: Request, res: Response) => {
  try {
    const result = await detectTwitterRateLimit(getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ limited: false, suspended: false, message: String(error) });
  }
});

// === NAVIGATION ===

app.post('/api/twitter/inbox/navigate', async (req: Request, res: Response) => {
  try {
    const result = await navigateToInbox(getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/inbox/tab', async (req: Request, res: Response) => {
  try {
    const { tab } = req.body as { tab: DMTab };
    const success = await switchTab(tab, getDriver());
    res.json({ success, tab });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === CONVERSATIONS ===

app.get('/api/twitter/conversations', async (req: Request, res: Response) => {
  try {
    const conversations = await listConversations(getDriver());
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/twitter/conversations/all', async (req: Request, res: Response) => {
  try {
    const conversations = await getAllConversations(getDriver());
    const totalCount = Object.values(conversations).reduce((sum, arr) => sum + arr.length, 0);
    res.json({ conversations, totalCount });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/twitter/conversations/unread', async (req: Request, res: Response) => {
  try {
    const conversations = await getUnreadConversations(getDriver());
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/twitter/conversations/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }
    const conversations = await searchConversations(query, getDriver());
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/twitter/conversations/open', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    const success = await openConversation(username, getDriver());
    res.json({ success, username });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/conversations/new', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    const success = await startNewConversation(username, getDriver());
    res.json({ success, username });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/conversations/scroll', async (req: Request, res: Response) => {
  try {
    const { scrollCount = 3 } = req.body as { scrollCount?: number };
    const totalMessages = await scrollConversation(scrollCount, getDriver());
    res.json({ totalMessages });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === MESSAGES ===

app.get('/api/twitter/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = await readMessages(limit, getDriver());
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/twitter/messages/send', checkRateLimit, async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text: string };
    const result = await sendMessage(text, getDriver());
    
    if (result.success) {
      recordMessageSent();
    }
    
    res.json({
      ...result,
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/messages/send-to', checkRateLimit, async (req: Request, res: Response) => {
  try {
    const { username, text } = req.body as { username: string; text: string };

    if (!username || !text) {
      res.status(400).json({ success: false, error: 'username and text required' });
      return;
    }

    const result = await sendDMByUsername(username, text, getDriver());

    if (result.success) {
      recordMessageSent();
      logDM({ platform: 'twitter', username, messageText: text, isOutbound: true });
      logToSupabase(username, text); // Fire and forget
    }

    res.json({
      ...result,
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/messages/send-to-url', checkRateLimit, async (req: Request, res: Response) => {
  try {
    const { profileUrl, text } = req.body as { profileUrl: string; text: string };
    const result = await sendDMFromProfileUrl(profileUrl, text, getDriver());
    
    if (result.success) {
      recordMessageSent();
      const username = profileUrl.replace(/.*\.com\//, '').replace(/\/.*/, '');
      logDM({ platform: 'twitter', username, messageText: text, isOutbound: true });
      logToSupabase(username, text); // Fire and forget
    }

    res.json({
      ...result,
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === CRM STATS ===

app.get('/api/twitter/crm/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getDMStats('twitter');
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/twitter/crm/score', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.body as { contactId: string };
    if (!contactId) { res.status(400).json({ error: 'contactId required' }); return; }
    const result = await recalculateScore(contactId);
    res.json({ success: !!result, score: result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/crm/score-all', async (_req: Request, res: Response) => {
  try {
    const result = await recalculateAllScores('twitter');
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/twitter/crm/top-contacts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const contacts = await getTopContacts('twitter', limit);
    res.json({ success: true, contacts });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// === TEMPLATE ENGINE ===

app.get('/api/twitter/templates', async (req: Request, res: Response) => {
  try {
    const { lane, stage } = req.query as { lane?: string; stage?: string };
    const templates = await getTemplates({ lane, stage, platform: 'twitter' });
    res.json({ success: true, templates, count: templates.length });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/templates/next-action', async (req: Request, res: Response) => {
  try {
    const context = { ...req.body, platform: 'twitter' as const };
    if (!context.username) { res.status(400).json({ error: 'username required' }); return; }
    const result = await getNextBestAction(context);
    res.json({ success: true, result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/templates/fit-signals', async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text: string };
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const result = await detectFitSignals(text);
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/twitter/templates/rule-check/:contactId', async (req: Request, res: Response) => {
  try {
    const result = await check31Rule(req.params.contactId);
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// === OUTREACH QUEUE ===

app.get('/api/twitter/outreach/pending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const actions = await getPendingActions('twitter', limit);
    res.json({ success: true, actions, count: actions.length });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/outreach/queue', async (req: Request, res: Response) => {
  try {
    const action = { ...req.body, platform: 'twitter' };
    if (!action.contact_id || !action.message) { res.status(400).json({ error: 'contact_id and message required' }); return; }
    const result = await queueOutreachAction(action);
    res.json(result);
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/outreach/:actionId/sent', async (req: Request, res: Response) => {
  try { res.json({ success: await markActionSent(req.params.actionId) }); }
  catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/twitter/outreach/:actionId/failed', async (req: Request, res: Response) => {
  try { res.json({ success: await markActionFailed(req.params.actionId, req.body.error || 'Unknown') }); }
  catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/twitter/outreach/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getOutreachStats('twitter');
    res.json({ success: true, stats });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// === PROFILE ===

app.get('/api/twitter/profile/:handle', async (req: Request, res: Response) => {
  try {
    const { handle } = req.params;
    if (!handle) {
      res.status(400).json({ error: 'Handle parameter is required' });
      return;
    }
    const profile = await getProfileInfo(handle, getDriver());
    // Restore inbox so the tracked tab isn't left stranded on the profile page
    await navigateToInbox(getDriver());
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === AI DM GENERATION ===

app.post('/api/twitter/ai/generate', async (req: Request, res: Response) => {
  try {
    const { username, purpose, topic } = req.body as { username: string; purpose?: string; topic?: string };
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    const message = await generateAIDM({
      recipientUsername: username,
      purpose: purpose || 'networking',
      topic,
    });
    res.json({ success: true, message, aiEnabled: !!OPENAI_API_KEY });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === PROSPECT DISCOVERY ===

app.post('/api/twitter/prospect/discover', async (req: Request, res: Response) => {
  const params = req.body || {};
  if (params.dryRun) {
    const result = await discoverProspects(params);
    res.json({ success: true, ...result });
    return;
  }
  const agentId = `prospect-discovery-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    await getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[prospect-discover] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex}`);
  } catch (err) {
    res.status(503).json({ success: false, error: 'Tab claim required but failed', detail: String(err) }); return;
  }
  try {
    const result = await discoverProspects(params);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  } finally {
    if (coord) {
      try { await coord.release(); } catch { /* ignore */ }
    }
  }
});

app.get('/api/twitter/prospect/score/:handle', async (req: Request, res: Response) => {
  try {
    const { handle } = req.params;
    if (!handle) { res.status(400).json({ error: 'handle required' }); return; }
    const profile = await getProfileInfo(handle, getDriver());
    const { score, signals } = scoreICP(profile as Parameters<typeof scoreICP>[0], 'direct');
    res.json({ success: true, username: handle, ...profile, icpScore: score, icpSignals: signals, icpKeywords: ICP_KEYWORDS });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === ADVANCED ===

app.post('/api/twitter/execute', async (req: Request, res: Response) => {
  try {
    const { script } = req.body as { script: string };
    const output = await getDriver().executeJS(script);
    res.json({ output });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.put('/api/twitter/config', (req: Request, res: Response) => {
  const updates = req.body as Record<string, unknown>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ config: d.getConfig() });
});

// POST /api/debug/eval — execute JS in the tracked Safari tab (debugging only)
app.post('/api/debug/eval', async (req: Request, res: Response) => {
  try {
    const { js } = req.body as { js: string };
    if (!js) { res.status(400).json({ error: 'js required' }); return; }
    const result = await getDriver().executeJS(js);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Self-Poll Endpoint (SDPA-012) ───────────────────────────────────────────
// POST /api/twitter/self-poll
// Called by cron-manager. Fetches DM conversations + unread notifications
// and writes results to safari_platform_cache for cloud-sync to consume.
app.post('/api/twitter/self-poll', async (_req: Request, res: Response) => {
  const result = { dms: 0, notifications: 0 };

  try {
    const { SelfPollCron } = await import('../self-poll-cron.js');
    const poller = new SelfPollCron(parseInt(process.env.TWITTER_DM_PORT || process.env.PORT || '3003'));
    const { fetched } = await poller.tick(true);
    result.dms = fetched.dms || 0;
    result.notifications = fetched.notifications || 0;
    res.json({ success: true, fetched: result });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[self-poll:twitter] error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/self-poll/trigger — alias for external trigger
app.get('/api/self-poll/trigger', async (_req: Request, res: Response) => {
  try {
    const { SelfPollCron } = await import('../self-poll-cron.js');
    const poller = new SelfPollCron(parseInt(process.env.TWITTER_DM_PORT || process.env.PORT || '3003'));
    const result = await poller.tick(true);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Start server
const PORT = parseInt(process.env.TWITTER_DM_PORT || process.env.PORT || '3003');

export function startServer(port: number = PORT): void {
  TabCoordinator.listClaims().then(claims => {
    const stale = claims.filter(c => c.service === SERVICE_NAME);
    if (stale.length > 0) {
      console.log(`[startup] Clearing ${stale.length} stale ${SERVICE_NAME} claim(s) from previous process`);
      import('fs/promises').then(fsp => {
        fsp.writeFile('/tmp/safari-tab-claims.json', JSON.stringify(claims.filter(c => c.service !== SERVICE_NAME), null, 2)).catch(() => {});
      });
    }
  }).catch(() => {});

  app.listen(port, () => {
    console.log(`🐦 Twitter DM API server running on http://localhost:${port}`);
    console.log(`   Health: GET /health`);
    console.log(`   Status: GET /api/twitter/status`);
    console.log(`   Send DM: POST /api/twitter/messages/send-to`);
    console.log(`   AI Generate: POST /api/twitter/ai/generate`);
    console.log(`   AI Enabled: ${!!OPENAI_API_KEY}`);
  });

  // Refresh all active tab claim heartbeats every 30s
  setInterval(async () => {
    for (const [agentId, coord] of activeCoordinators) {
      try {
        await coord.heartbeat();
      } catch {
        activeCoordinators.delete(agentId);
      }
    }
  }, 30_000);
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
