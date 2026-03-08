/**
 * Instagram DM API Server
 * REST API for DM operations - can be called from CRM server.
 * Now with AI-powered message generation!
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';

// AI for DM generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_API_KEY) {
  console.log('[AI] ✅ OpenAI API key loaded - AI DMs enabled');
}

// Supabase CRM logging (optional)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
if (SUPABASE_ENABLED) {
  console.log('[CRM] ✅ Supabase logging enabled');
}

/**
 * Log a DM send to Supabase CRM (fire-and-forget).
 */
async function logToSupabase(data: { platform: string; to_user: string; content: string; sent_at: string; status: string }): Promise<void> {
  if (!SUPABASE_ENABLED) return;

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/crm_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(data),
    });
  } catch (err) {
    // Fire-and-forget: don't throw errors
    console.error('[CRM] Supabase logging failed:', err);
  }
}

export async function generateAIDM(context: { recipientUsername: string; purpose: string; topic?: string }): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Hey! Wanted to connect with you about ${context.topic || 'your content'}. Let me know if you're interested!`;
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
          { role: 'system', content: 'Generate a SHORT, personalized Instagram DM (max 150 chars). Be friendly, authentic, not salesy.' },
          { role: 'user', content: `DM to @${context.recipientUsername} for ${context.purpose}. ${context.topic ? `Topic: ${context.topic}` : ''}` }
        ],
        max_tokens: 80,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      console.error(`[AI] OpenAI returned ${response.status}`);
      return `Hey! Love your content, wanted to connect! 🙌`;
    }
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || `Hey! Love your content, wanted to connect! 🙌`;
  } catch {
    clearTimeout(timeout);
    return `Hey! Love your content, wanted to connect! 🙌`;
  }
}
import cors from 'cors';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import {
  SafariDriver,
  navigateToInbox,
  listConversations,
  switchTab,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMFromProfile,
  sendDMToThread,
  smartSendDM,
  registerThread,
  getThreadId,
  getAllThreads,
  getAllConversations,
  getUnreadConversations,
  acceptMessageRequest,
  declineMessageRequest,
  enrichContact,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { DMTab, RateLimitConfig } from '../automation/types.js';
import { initDMLogger, logDM, getDMStats } from '../utils/dm-logger.js';
import { initScoringService, recalculateScore, recalculateAllScores, getTopContacts } from '../utils/scoring-service.js';
import { initTemplateEngine, getNextBestAction, getTemplates, detectFitSignals, getPendingActions, queueOutreachAction, markActionSent, markActionFailed, getOutreachStats, check31Rule, determineLane, fillTemplate, isAlreadySuggested, insertProspectSuggestion, countSuggestedProspects, getTopSuggestedProspects, promoteToOutreachQueue, listSuggestedProspects, removeProspectSuggestion, getProspectStats, generatePersonalizedMessage, scheduleProspectDM, markProspectQueued, getPipelineStatus } from '../utils/template-engine.js';
import { discoverProspects, scoreICP, SOURCE_PRIORITY_BONUS, fetchTopPostCreators, type DiscoverParams } from './prospect-discovery.js';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize CRM logging + scoring + templates
initDMLogger();
initScoringService();
initTemplateEngine();

// Rate limiting state — persisted to disk so restarts don't lose daily count
import { readFileSync, writeFileSync } from 'fs';
const RL_STATE_FILE = new URL('../../.rate-limit-state.json', import.meta.url).pathname;

function todayDateStr() { return new Date().toISOString().slice(0, 10); }

function loadRLState() {
  try {
    const d = JSON.parse(readFileSync(RL_STATE_FILE, 'utf8'));
    if (d.date === todayDateStr()) return d;
  } catch { /* first run */ }
  return { date: todayDateStr(), sentToday: 0, sentThisHour: 0, hourStart: Date.now() };
}

function saveRLState() {
  try { writeFileSync(RL_STATE_FILE, JSON.stringify({ date: todayDateStr(), sentToday: messagesSentToday, sentThisHour: messagesSentThisHour, hourStart: lastHourReset })); } catch { /* non-fatal */ }
}

const _rl = loadRLState();
let messagesSentToday = _rl.sentToday;
let messagesSentThisHour = _rl.sentThisHour;
let lastHourReset = _rl.hourStart;
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

// Safari driver instance
let driver: SafariDriver | null = null;

// URL pattern that identifies the Instagram DM Safari session
const SESSION_URL_PATTERN = 'instagram.com';
const SERVICE_NAME = 'instagram-dm';
const SERVICE_PORT = parseInt(process.env.PORT || '3100', 10);

// Active tab coordinators by agentId (in-process map; file is cross-process)
const activeCoordinators = new Map<string, TabCoordinator>();

function getDriver(): SafariDriver {
  if (!driver) {
    driver = new SafariDriver({
      verbose: process.env.VERBOSE === 'true',
    });
  }
  return driver;
}

/**
 * Ensure the Instagram Safari tab is the active/front tab before any operation.
 * Scans all Safari windows, finds the instagram.com tab, and activates it.
 * Falls back to navigating if not found.
 */
async function ensureInstagramSession(): Promise<{ ok: boolean; windowIndex: number; tabIndex: number; url: string }> {
  const info = await getDriver().ensureActiveSession(SESSION_URL_PATTERN);
  return { ok: info.found, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url };
}

/**
 * Express middleware: activate the correct Instagram Safari tab before the request handler runs.
 * Skips for non-automating routes (health, rate-limits, session status).
 */
async function requireActiveSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const info = await ensureInstagramSession();
    if (!info.ok) {
      res.status(503).json({
        error: 'Instagram Safari session not found',
        fix: 'Open Safari and navigate to instagram.com, then retry',
        session: info,
      });
      return;
    }
    next();
  } catch (err) {
    res.status(503).json({ error: `Session activation failed: ${err}` });
  }
}

// Rate limit check middleware
function checkRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  
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
  
  // Check active hours
  const hour = new Date().getHours();
  if (hour < rateLimits.activeHoursStart || hour >= rateLimits.activeHoursEnd) {
    res.status(429).json({
      error: 'Outside active hours',
      activeHours: `${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00`
    });
    return;
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

// === ROUTES ===

// Health check
app.get('/health', (req, res) => {

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.instagram.com/direct/inbox/';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;

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
  const autoId = `instagram-dm-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for instagram-dm',
      detail: String(err),
      fix: `Open Safari and navigate to https://www.instagram.com/direct/inbox/, or POST /api/tabs/claim with { agentId, openUrl: "https://www.instagram.com/direct/inbox/" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────

  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    rateLimits: {
      messagesSentToday,
      messagesSentThisHour,
      limits: rateLimits,
    }
  });
});

// Get rate limit status
app.get('/api/rate-limits', (req, res) => {
  res.json({
    messagesSentToday,
    messagesSentThisHour,
    limits: rateLimits,
    activeHours: {
      start: rateLimits.activeHoursStart,
      end: rateLimits.activeHoursEnd,
      currentHour: new Date().getHours(),
      isActive: new Date().getHours() >= rateLimits.activeHoursStart && 
                new Date().getHours() < rateLimits.activeHoursEnd,
    }
  });
});

// Update rate limits
app.put('/api/rate-limits', (req, res) => {
  rateLimits = { ...rateLimits, ...req.body };
  res.json({ success: true, rateLimits });
});

// === SESSION MANAGEMENT ===

// GET /api/session/status — return tracked session info without activating
app.get('/api/session/status', (req, res) => {
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

// POST /api/session/ensure — find + activate the correct Instagram tab
app.post('/api/session/ensure', async (req, res) => {
  try {
    const info = await ensureInstagramSession();
    res.json({
      ok: info.ok,
      windowIndex: info.windowIndex,
      tabIndex: info.tabIndex,
      url: info.url,
      message: info.ok
        ? `Instagram session active at window ${info.windowIndex}, tab ${info.tabIndex}`
        : 'Instagram tab not found — open Safari and navigate to instagram.com',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/session/clear — reset tracked session (use after Safari restart)
app.post('/api/session/clear', (req, res) => {
  getDriver().clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

// ─── Tab Coordination API ──────────────────────────────────────────────────
// Cross-agent tab claim registry. Agents call these to register ownership
// of a specific Safari window+tab, preventing other agents from interfering.

// GET /api/tabs/claims — list all live tab claims across all services
app.get('/api/tabs/claims', async (_req, res) => {
  try {
    const claims = await TabCoordinator.listClaims();
    res.json({ claims, count: claims.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/claim — agent claims a Safari tab for this service
// Body: { agentId: string, windowIndex?: number, tabIndex?: number }
// If windowIndex/tabIndex omitted, auto-discovers first available instagram.com tab.
app.post('/api/tabs/claim', async (req, res) => {
  const { agentId, windowIndex, tabIndex } = req.body as {
    agentId: string;
    windowIndex?: number;
    tabIndex?: number;
  };

  if (!agentId) {
    res.status(400).json({ error: 'agentId required' });
    return;
  }

  try {
    // Reuse or create coordinator
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
      activeCoordinators.set(agentId, coord);
    }

    const claim = await coord.claim(windowIndex, tabIndex);

    // Pin the SafariDriver to this window+tab so all JS runs there
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);

    res.json({
      ok: true,
      claim,
      message: `Tab ${claim.windowIndex}:${claim.tabIndex} claimed by '${agentId}'`,
    });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

// POST /api/tabs/release — agent releases its tab claim
// Body: { agentId: string }
app.post('/api/tabs/release', async (req, res) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) {
    res.status(400).json({ error: 'agentId required' });
    return;
  }

  try {
    const coord = activeCoordinators.get(agentId);
    if (coord) {
      await coord.release();
      activeCoordinators.delete(agentId);
    }
    res.json({ ok: true, message: `Claim released for '${agentId}'` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/heartbeat — refresh claim TTL to prevent expiry
// Body: { agentId: string }
app.post('/api/tabs/heartbeat', async (req, res) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) {
    res.status(400).json({ error: 'agentId required' });
    return;
  }

  try {
    const coord = activeCoordinators.get(agentId);
    if (!coord?.activeClaim) {
      res.status(404).json({ error: `No active claim for '${agentId}'` });
      return;
    }
    await coord.heartbeat();
    res.json({ ok: true, heartbeat: Date.now() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
// ──────────────────────────────────────────────────────────────────────────

// Navigate to inbox
app.post('/api/inbox/navigate', requireActiveSession, async (req, res) => {
  try {
    const result = await navigateToInbox(getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List conversations
app.get('/api/conversations', requireActiveSession, async (req, res) => {
  try {
    const scrollMore = req.query.scrollMore === 'true';
    let conversations = await listConversations(getDriver());

    if (scrollMore) {
      // Scroll and paginate to get more conversations
      const d = getDriver();
      let prevCount = conversations.length;
      let stableRounds = 0;
      const maxScrolls = 3;

      for (let i = 0; i < maxScrolls; i++) {
        // Scroll conversation list
        await d.executeJS(`
          (function() {
            var container = document.querySelector('[aria-label="Thread list"]') ||
                            document.querySelector('div[role="list"]') ||
                            document.querySelector('div[class*="inbox"]');
            if (container) {
              container.scrollTop += 600;
            } else {
              window.scrollBy(0, 600);
            }
          })()
        `);
        await d.wait(600);

        conversations = await listConversations(d);
        if (conversations.length === prevCount) {
          stableRounds++;
          if (stableRounds >= 2) break;
        } else {
          stableRounds = 0;
        }
        prevCount = conversations.length;
      }
    }

    res.json({ conversations, count: conversations.length, scrolled: scrollMore });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get all conversations from all tabs
app.get('/api/conversations/all', requireActiveSession, async (req, res) => {
  try {
    const allConversations = await getAllConversations(getDriver());
    const totalCount = Object.values(allConversations).reduce((sum, arr) => sum + arr.length, 0);
    res.json({ conversations: allConversations, totalCount });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get unread conversations
app.get('/api/conversations/unread', requireActiveSession, async (req, res) => {
  try {
    const result = await getUnreadConversations(getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Accept message request
app.post('/api/requests/:username/accept', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const success = await acceptMessageRequest(username, getDriver());
    res.json({ success, username, action: 'accepted' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Decline message request
app.post('/api/requests/:username/decline', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const success = await declineMessageRequest(username, getDriver());
    res.json({ success, username, action: 'declined' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get user profile information
app.get('/api/profile/:username', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const profile = await enrichContact(username, getDriver());
    // Restore inbox so the tracked tab isn't left stranded on the profile page
    await navigateToInbox(getDriver());
    res.json({ success: true, username, profile });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Switch tab
app.post('/api/inbox/tab', requireActiveSession, async (req, res) => {
  try {
    const { tab } = req.body as { tab: DMTab };
    const success = await switchTab(tab, getDriver());
    res.json({ success, tab });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Open conversation
app.post('/api/conversations/open', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const success = await openConversation(username, getDriver());
    res.json({ success, username });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Read messages from current conversation
app.get('/api/messages', requireActiveSession, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = await readMessages(limit, getDriver());
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send message (rate limited)
app.post('/api/messages/send', requireActiveSession, checkRateLimit, async (req, res) => {
  try {
    const { text, username } = req.body;
    
    if (!text) {
      res.status(400).json({ error: 'text required' });
      return;
    }
    
    // If username provided, open that conversation first
    if (username) {
      const opened = await openConversation(username, getDriver());
      if (!opened) {
        res.status(404).json({ error: 'Could not find conversation' });
        return;
      }
    }
    
    const result = await sendMessage(text, getDriver());

    if (result.success) {
      messagesSentToday++;
      messagesSentThisHour++;
      saveRLState();
      if (username) {
        logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
        // Log to Supabase if enabled
        logToSupabase({
          platform: 'instagram',
          to_user: username,
          content: text,
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      }
    }
    
    res.json({
      ...result,
      rateLimits: {
        messagesSentToday,
        messagesSentThisHour,
      }
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Start new conversation
app.post('/api/conversations/new', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const success = await startNewConversation(username, getDriver());
    res.json({ success, username });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send message to new user (combines new conversation + send)
app.post('/api/messages/send-to', requireActiveSession, checkRateLimit, async (req, res) => {
  try {
    const { username, text } = req.body;
    
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }

    // Strategy 1: Profile-page DM (navigate to profile, click Message, type, send)
    // Only commit if verified=true — otherwise fall through to inbox strategy which is
    // more reliable for existing conversations.
    const profileResult = await sendDMFromProfile(username, text, getDriver());
    if (profileResult.success && profileResult.verified) {
      messagesSentToday++;
      messagesSentThisHour++;
      saveRLState();
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
      logToSupabase({
        platform: 'instagram',
        to_user: username,
        content: text,
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
      res.json({
        ...profileResult,
        username,
        strategy: 'profile',
        rateLimits: { messagesSentToday, messagesSentThisHour },
      });
      return;
    }
    // Strategy 1 ran but could not verify delivery — log and try inbox strategy
    console.log(`[send-to] Strategy 1 unverified for @${username} (${profileResult.error || 'verified=false'}), trying inbox`);


    // Strategy 2: Open existing inbox conversation
    const opened = await openConversation(username, getDriver());
    if (opened) {
      const result = await sendMessage(text, getDriver());
      if (result.success) {
        messagesSentToday++;
        messagesSentThisHour++;
        logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
        logToSupabase({
          platform: 'instagram',
          to_user: username,
          content: text,
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      }
      res.json({
        ...result,
        username,
        strategy: 'inbox',
        rateLimits: { messagesSentToday, messagesSentThisHour },
      });
      return;
    }

    // Strategy 3: Start new conversation via compose flow
    const newConv = await startNewConversation(username, getDriver());
    if (newConv) {
      const result = await sendMessage(text, getDriver());
      if (result.success) {
        messagesSentToday++;
        messagesSentThisHour++;
        logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
        logToSupabase({
          platform: 'instagram',
          to_user: username,
          content: text,
          sent_at: new Date().toISOString(),
          status: 'sent',
        });
      }
      res.json({
        ...result,
        username,
        strategy: 'new_conversation',
        rateLimits: { messagesSentToday, messagesSentThisHour },
      });
      return;
    }

    res.status(404).json({
      error: 'Could not open or create conversation after all strategies',
      profileError: profileResult.error,
      username,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// CRM stats
app.get('/api/crm/stats', async (req, res) => {
  try {
    const stats = await getDMStats('instagram');
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/crm/score', async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) { res.status(400).json({ error: 'contactId required' }); return; }
    const result = await recalculateScore(contactId);
    res.json({ success: !!result, score: result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/crm/score-all', async (_req, res) => {
  try {
    const result = await recalculateAllScores('instagram');
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/crm/top-contacts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const contacts = await getTopContacts('instagram', limit);
    res.json({ success: true, contacts });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// Thread management endpoints
app.post('/api/threads/register', (req, res) => {
  const { username, threadId } = req.body;
  if (!username || !threadId) {
    res.status(400).json({ error: 'username and threadId required' });
    return;
  }
  registerThread(username, threadId);
  res.json({ success: true, username, threadId });
});

app.get('/api/threads', (_req, res) => {
  res.json({ threads: getAllThreads() });
});

app.get('/api/threads/:username', (req, res) => {
  const threadId = getThreadId(req.params.username);
  if (threadId) {
    res.json({ username: req.params.username, threadId });
  } else {
    res.status(404).json({ error: 'No thread ID cached for this user' });
  }
});

// Smart send: thread URL (if cached) → profile-to-DM fallback
app.post('/api/messages/smart-send', checkRateLimit, async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    
    const result = await smartSendDM(username, text, getDriver());

    if (result.success) {
      messagesSentToday++;
      messagesSentThisHour++;
      saveRLState();
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
      logToSupabase({
        platform: 'instagram',
        to_user: username,
        content: text,
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
    }
    
    res.json({
      ...result,
      username,
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send DM via profile-to-DM flow
app.post('/api/messages/send-from-profile', checkRateLimit, async (req, res) => {
  try {
    const { username, text } = req.body;
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    
    const result = await sendDMFromProfile(username, text, getDriver());

    if (result.success) {
      messagesSentToday++;
      messagesSentThisHour++;
      saveRLState();
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
      logToSupabase({
        platform: 'instagram',
        to_user: username,
        content: text,
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
    }

    res.json({
      ...result,
      username,
      method: 'profile-to-dm',
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send DM via direct thread URL (most reliable when threadId is known)
app.post('/api/messages/send-to-thread', checkRateLimit, async (req, res) => {
  try {
    const { threadId, text } = req.body;
    if (!threadId || !text) {
      res.status(400).json({ error: 'threadId and text required' });
      return;
    }
    
    const result = await sendDMToThread(threadId, text, getDriver());

    if (result.success) {
      messagesSentToday++;
      messagesSentThisHour++;
      saveRLState();
      logDM({ platform: 'instagram', username: `thread:${threadId}`, messageText: text, isOutbound: true });
      logToSupabase({
        platform: 'instagram',
        to_user: `thread:${threadId}`,
        content: text,
        sent_at: new Date().toISOString(),
        status: 'sent',
      });
    }
    
    res.json({
      ...result,
      threadId,
      method: 'thread-url',
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === TEMPLATE ENGINE ===

// Get all templates, optionally filtered by lane/stage
app.get('/api/templates', async (req, res) => {
  try {
    const { lane, stage } = req.query as { lane?: string; stage?: string };
    const templates = await getTemplates({ lane, stage, platform: 'instagram' });
    res.json({ success: true, templates, count: templates.length });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Get next-best-action for a contact
app.post('/api/templates/next-action', async (req, res) => {
  try {
    const context = { ...req.body, platform: 'instagram' as const };
    if (!context.username) { res.status(400).json({ error: 'username required' }); return; }
    const result = await getNextBestAction(context);
    if (!result) { res.json({ success: true, result: null, message: 'No matching template' }); return; }
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Detect fit signals in conversation text
app.post('/api/templates/fit-signals', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const result = await detectFitSignals(text);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Check 3:1 rule compliance
app.get('/api/templates/rule-check/:contactId', async (req, res) => {
  try {
    const result = await check31Rule(req.params.contactId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === OUTREACH QUEUE ===

// Get pending outreach actions
app.get('/api/outreach/pending', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const actions = await getPendingActions('instagram', limit);
    res.json({ success: true, actions, count: actions.length });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Queue a new outreach action
app.post('/api/outreach/queue', async (req, res) => {
  try {
    const action = { ...req.body, platform: 'instagram' };
    if (!action.contact_id || !action.message) {
      res.status(400).json({ error: 'contact_id and message required' }); return;
    }
    const result = await queueOutreachAction(action);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Mark action as sent/failed
app.post('/api/outreach/:actionId/sent', async (req, res) => {
  try {
    const ok = await markActionSent(req.params.actionId);
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/outreach/:actionId/failed', async (req, res) => {
  try {
    const ok = await markActionFailed(req.params.actionId, req.body.error || 'Unknown error');
    res.json({ success: ok });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Outreach stats
app.get('/api/outreach/stats', async (req, res) => {
  try {
    const stats = await getOutreachStats('instagram');
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === PROSPECT DISCOVERY ===

// Discover ICP prospects from hashtags/followers.
// Claims the Safari tab for the duration of the run so no other request
// navigates the same tab mid-discovery. Releases on completion or error.
app.post('/api/prospect/discover', async (req, res) => {
  const params = req.body as DiscoverParams;

  if (params.dryRun) {
    const result = await discoverProspects(params, undefined);
    res.json(result);
    return;
  }

  // Claim the instagram.com tab so discovery owns it for the full run
  const agentId = `prospect-discovery-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[prospect-discover] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex} (${agentId})`);
  } catch (err) {
    // No matching Instagram tab open — still attempt with whatever tab the driver has
    console.warn(`[prospect-discover] Tab claim failed (will use current tracked tab): ${err}`);
    coord = null;
  }

  try {
    const result = await discoverProspects(params, getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  } finally {
    if (coord) {
      try { await coord.release(); } catch { /* ignore */ }
      console.log(`[prospect-discover] Tab claim released (${agentId})`);
    }
  }
});

// Score a single prospect by username
app.get('/api/prospect/score/:username', requireActiveSession, async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) { res.status(400).json({ error: 'username required' }); return; }
    const profile = await enrichContact(username, getDriver());
    const { score, signals } = scoreICP(profile, 'manual');
    res.json({
      username, profile,
      icpScore: score, icpSignals: signals, priority: score,
      score, signals,
      icp: { qualifies: score >= 40, score, signals },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Scale-discover: accumulate prospects across multiple calls until targetTotal reached.
// Each call runs one discovery batch (up to MAX_ENRICH), persists new candidates to
// suggested_actions, deduplicates via DB, and returns progress.
app.post('/api/prospect/scale-discover', async (req, res) => {
  const {
    targetTotal = 500,
    keywords,
    topAccounts,
    topPostKeywords,
    followerScrollCount = 20,
    minScore = 30,
    maxRounds = 2,
    dryRun = false,
  } = req.body as {
    targetTotal?: number;
    keywords?: string[];
    topAccounts?: string[];
    topPostKeywords?: string[];
    followerScrollCount?: number;
    minScore?: number;
    maxRounds?: number;
    dryRun?: boolean;
  };

  const currentTotal = await countSuggestedProspects('instagram');
  if (currentTotal >= targetTotal) {
    res.json({ newFound: 0, totalSuggested: currentTotal, targetTotal, done: true, progress: `${currentTotal}/${targetTotal} (100%)` });
    return;
  }

  if (dryRun) {
    res.json({ newFound: 0, totalSuggested: currentTotal, targetTotal, done: false, progress: `${currentTotal}/${targetTotal} (dryRun)` });
    return;
  }

  const agentId = `scale-discover-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
  } catch (err) {
    throw new Error(`Tab claim required but failed: ${err}`);
  }

  let newFound = 0;
  try {
    const result = await discoverProspects({
      keywords,
      topAccounts,
      topPostKeywords,
      followerScrollCount,
      minScore,
      maxRounds,
    }, getDriver());

    for (const c of result.candidates) {
      const alreadyStored = await isAlreadySuggested(c.username, 'instagram');
      if (!alreadyStored) {
        await insertProspectSuggestion(c.username, c.priority, c.bio, 'instagram');
        newFound++;
      }
    }
  } finally {
    if (coord) { try { await coord.release(); } catch { /* ignore */ } }
  }

  const updatedTotal = await countSuggestedProspects('instagram');
  const done = updatedTotal >= targetTotal;
  const pct = Math.round((updatedTotal / targetTotal) * 100);
  const looping = newFound === 0 && !done;
  const loopReason = looping
    ? `No new prospects found — hashtag pages are exhausted or all candidates already stored. Try adding topAccounts (e.g. ["levelsio", "marc_louvion", "tdinh_me"]) or different keywords.`
    : undefined;
  res.json({ newFound, totalSuggested: updatedTotal, targetTotal, done, progress: `${updatedTotal}/${targetTotal} (${pct}%)`, looping, loopReason });
});

// Top-post pipeline: hashtag pages → rank posts by engagement → rank creators →
// scrape creator followers → enrich + ICP score → store as prospects.
// Returns all 3 intermediate layers so the caller can see what happened.
app.post('/api/prospect/discover-from-top-posts', async (req, res) => {
  const {
    keywords = ['buildinpublic', 'saasfounder', 'aiautomation', 'indiemaker'],
    maxPostsPerKeyword = 6,
    maxTopCreators = 5,
    minScore = 30,
    selfUsername = 'the_isaiah_dupree',
    dryRun = false,
  } = req.body as {
    keywords?: string[];
    maxPostsPerKeyword?: number;
    maxTopCreators?: number;
    minScore?: number;
    selfUsername?: string;
    dryRun?: boolean;
  };

  if (dryRun) {
    res.json({ dryRun: true, message: 'Dry run — no navigation performed.', topPosts: [], topCreators: [], candidates: [] });
    return;
  }

  console.log(`[discover-top-posts] Starting pipeline: keywords=[${keywords.join(', ')}] maxPostsPerKeyword=${maxPostsPerKeyword} maxTopCreators=${maxTopCreators} minScore=${minScore} selfUsername=@${selfUsername}`);

  const agentId = `top-posts-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
  } catch (err) {
    throw new Error(`Tab claim required but failed: ${err}`);
  }

  try {
    // Step 1 + 2: find top posts, rank creators by post engagement
    console.log('[discover-top-posts] Step 1/3: Scraping top posts from hashtag pages...');
    const { posts: topPosts, creators: topCreators } = await fetchTopPostCreators(
      keywords, getDriver(), maxPostsPerKeyword, selfUsername,
    );

    console.log(`[discover-top-posts] Step 2/3: Found ${topPosts.length} posts, ${topCreators.length} ranked creators`);
    const creatorUsernames = topCreators.slice(0, maxTopCreators).map(c => c.username);

    if (creatorUsernames.length === 0) {
      console.warn('[discover-top-posts] No top creators found — check that Safari is logged into Instagram and hashtag pages are accessible');
    } else {
      console.log(`[discover-top-posts] Top ${creatorUsernames.length} creators: ${creatorUsernames.map(u => '@' + u).join(', ')}`);
    }

    // Step 3: scrape followers of top creators → enrich → score → store
    console.log('[discover-top-posts] Step 3/3: Scraping followers of top creators...');
    const result = await discoverProspects({
      sources: ['top_accounts'],
      topAccounts: creatorUsernames,
      selfUsername,
      minScore,
      maxRounds: 1,
    }, getDriver());

    // Persist new candidates
    let newFound = 0;
    for (const c of result.candidates) {
      const alreadyStored = await isAlreadySuggested(c.username, 'instagram');
      if (!alreadyStored) {
        await insertProspectSuggestion(c.username, c.priority, c.bio, 'instagram');
        newFound++;
        console.log(`[discover-top-posts] Stored new prospect: @${c.username} priority=${c.priority}`);
      } else {
        console.log(`[discover-top-posts] Already in DB: @${c.username} — skipped`);
      }
    }

    const totalSuggested = await countSuggestedProspects('instagram');
    console.log(`[discover-top-posts] Done: ${newFound} new prospects added, ${totalSuggested} total in DB`);

    res.json({
      topPosts: topPosts.slice(0, 20),
      topCreators,
      candidates: result.candidates,
      newFound,
      totalSuggested,
      enrichedCount: result.enrichedCount,
      skippedLowScore: result.skippedLowScore,
    });
  } finally {
    if (coord) { try { await coord.release(); } catch { /* ignore */ } }
  }
});

// DM top-N: promote the top N suggested prospects to the outreach queue (status=pending).
// A message template is applied to each. Returns queued count + username list.
app.post('/api/prospect/dm-top-n', async (req, res) => {
  const {
    n = 100,
    messageTemplate = 'Hey {username}! Your work caught my eye — would love to connect about AI automation.',
    dryRun = false,
  } = req.body as { n?: number; messageTemplate?: string; dryRun?: boolean };

  const prospects = await getTopSuggestedProspects(n, 'instagram');
  if (prospects.length === 0) {
    res.json({ queued: 0, dryRun, message: 'No suggested prospects found. Run scale-discover first.' });
    return;
  }

  if (dryRun) {
    res.json({ queued: prospects.length, dryRun: true, sample: prospects.slice(0, 5).map(p => p.contact_id) });
    return;
  }

  let queued = 0;
  const failed: string[] = [];
  for (const prospect of prospects) {
    try {
      const msg = messageTemplate.replace(/{username}/g, prospect.contact_id);
      const ok = await promoteToOutreachQueue(prospect.id!, msg);
      if (ok) queued++;
    } catch {
      failed.push(prospect.contact_id);
    }
  }

  res.json({ queued, failed: failed.length > 0 ? failed : undefined, total: prospects.length, dryRun: false });
});

// Send queued prospect DMs — processes pending suggested_actions with rate limiting.
// Each DM send navigates Safari to the profile page, so keep batchSize small (≤5).
// Set sendDelay to at least 30s to avoid Instagram rate-limiting.
// Use dryRun:true first to preview what would be sent.
app.post('/api/prospect/send-queued', async (req, res) => {
  const {
    batchSize = 5,       // max DMs to send per call
    sendDelay = 45_000,  // ms between sends (45s default)
    dryRun = false,
  } = req.body as { batchSize?: number; sendDelay?: number; dryRun?: boolean };

  const cappedBatch = Math.min(batchSize, 10);
  const actions = await getPendingActions('instagram', cappedBatch);

  if (actions.length === 0) {
    res.json({ sent: 0, failed: 0, remaining: 0, message: 'No pending prospect DMs in queue. Run dm-top-n first.' });
    return;
  }

  if (dryRun) {
    const remaining = (await getPendingActions('instagram', 1000)).length;
    res.json({
      sent: 0, failed: 0, remaining, dryRun: true,
      preview: actions.map(a => ({ username: a.contact_id, message: (a.personalized_message || a.message || '').slice(0, 120) })),
    });
    return;
  }

  const agentId = `send-queued-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[send-queued] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex}`);
  } catch (err) {
    throw new Error(`Tab claim required but failed: ${err}`);
  }

  const results: { username: string; success: boolean; error?: string }[] = [];
  try {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];

      // Refresh rate limit counters
      const now = Date.now();
      if (now - lastHourReset > 60 * 60 * 1000) { messagesSentThisHour = 0; lastHourReset = now; }
      if (now - lastDayReset > 24 * 60 * 60 * 1000) { messagesSentToday = 0; lastDayReset = now; }

      if (messagesSentThisHour >= rateLimits.messagesPerHour) {
        console.log(`[send-queued] Hourly limit hit (${messagesSentThisHour}/${rateLimits.messagesPerHour}) — stopping`);
        break;
      }
      if (messagesSentToday >= rateLimits.messagesPerDay) {
        console.log(`[send-queued] Daily limit hit — stopping`);
        break;
      }

      const username = action.contact_id;
      const message = (action.personalized_message || action.message || '').trim();

      if (!username || !message) {
        await markActionFailed(action.id!, 'Missing username or message');
        results.push({ username: username || '?', success: false, error: 'missing message' });
        continue;
      }

      try {
        const result = await sendDMFromProfile(username, message, getDriver());
        if (result.success) {
          messagesSentThisHour++;
          messagesSentToday++;
          await markActionSent(action.id!);
          logDM({ platform: 'instagram', username, messageText: message, isOutbound: true });
          results.push({ username, success: true });
          console.log(`[send-queued] Sent DM to @${username}`);
        } else {
          await markActionFailed(action.id!, result.error || 'Send failed');
          results.push({ username, success: false, error: result.error });
          console.warn(`[send-queued] Failed DM to @${username}: ${result.error}`);
        }
      } catch (err) {
        await markActionFailed(action.id!, String(err));
        results.push({ username, success: false, error: String(err) });
      }

      // Wait between sends (skip delay after the last one)
      if (i < actions.length - 1) {
        await new Promise(r => setTimeout(r, sendDelay));
      }
    }
  } finally {
    if (coord) { try { await coord.release(); } catch { /* ignore */ } }
  }

  const sent = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const remaining = (await getPendingActions('instagram', 1000)).length;
  res.json({ sent, failed, remaining, results, rateLimits: { messagesSentToday, messagesSentThisHour, perHourLimit: rateLimits.messagesPerHour, perDayLimit: rateLimits.messagesPerDay } });
});

// GET /api/prospect/list — paginated browse of suggested prospects
// Query params: limit, offset, minScore, maxScore, sortBy (priority|created_at), order (asc|desc)
app.get('/api/prospect/list', async (req, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
    const minScore = req.query.minScore !== undefined ? parseInt(String(req.query.minScore), 10) : undefined;
    const maxScore = req.query.maxScore !== undefined ? parseInt(String(req.query.maxScore), 10) : undefined;
    const sortBy = (req.query.sortBy === 'created_at' ? 'created_at' : 'priority') as 'priority' | 'created_at';
    const order = (req.query.order === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
    const { prospects, total } = await listSuggestedProspects({ limit, offset, minScore, maxScore, sortBy, order });
    res.json({ prospects, total, limit, offset, page: Math.floor(offset / limit) + 1, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/prospect/:username — soft-delete (mark as 'skipped') a suggested prospect
app.delete('/api/prospect/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) { res.status(400).json({ error: 'username required' }); return; }
    const ok = await removeProspectSuggestion(username);
    if (ok) {
      res.json({ success: true, username, status: 'skipped' });
    } else {
      res.status(404).json({ success: false, error: 'Prospect not found or already removed' });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/prospect/score-batch — enrich + ICP-score multiple usernames without saving
// Body: { usernames: string[], checkCRM?: boolean }
// Requires active Safari session (each username navigates to its profile page).
app.post('/api/prospect/score-batch', requireActiveSession, async (req, res) => {
  const { usernames, checkCRM = false } = req.body as { usernames?: string[]; checkCRM?: boolean };
  if (!Array.isArray(usernames) || usernames.length === 0) {
    res.status(400).json({ error: 'usernames array required' });
    return;
  }
  const capped = usernames.slice(0, 20); // hard cap to protect Safari rate limits
  const results: Array<{
    username: string;
    icpScore: number;
    icpSignals: string[];
    priority: number;
    alreadyInCRM: boolean;
    profile: { fullName: string; bio: string; followers: string; following: string; posts: string; isPrivate: boolean } | null;
    error?: string;
  }> = [];

  for (const username of capped) {
    try {
      const profile = await enrichContact(username, getDriver());
      const { score, signals } = scoreICP(profile, 'search');
      const alreadyInCRM = checkCRM ? await isAlreadySuggested(username) : false;
      const sourceBonus = SOURCE_PRIORITY_BONUS['search'] ?? 10;
      results.push({
        username,
        icpScore: score,
        icpSignals: signals,
        priority: Math.min(score + sourceBonus, 140),
        alreadyInCRM,
        profile,
      });
    } catch (err) {
      results.push({ username, icpScore: 0, icpSignals: [], priority: 0, alreadyInCRM: false, profile: null, error: String(err) });
    }
  }

  const scored = results.filter(r => !r.error).length;
  res.json({ results, scored, total: capped.length, truncated: usernames.length > 20 });
});

// GET /api/prospect/stats — pipeline health: status counts + score distribution
app.get('/api/prospect/stats', async (req, res) => {
  try {
    const stats = await getProspectStats('instagram');
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/prospect/store-batch — store an array of discovered candidates in suggested_actions with dedup
app.post('/api/prospect/store-batch', async (req, res) => {
  const { candidates = [], platform = 'instagram' } = req.body as {
    candidates?: Array<{ username: string; icpScore?: number; priority?: number; bio?: string; followers?: string }>;
    platform?: string;
  };

  if (!Array.isArray(candidates) || candidates.length === 0) {
    res.status(400).json({ error: 'candidates array required' });
    return;
  }

  console.log(`[store-batch] Storing ${candidates.length} candidates for platform=${platform}`);
  let stored = 0;
  let skipped = 0;

  for (const c of candidates) {
    if (!c.username) { skipped++; continue; }
    try {
      const alreadyStored = await isAlreadySuggested(c.username, platform);
      if (alreadyStored) { skipped++; continue; }
      const score = c.priority ?? c.icpScore ?? 0;
      await insertProspectSuggestion(c.username, score, c.bio || '', platform);
      stored++;
    } catch (err) {
      console.warn(`[store-batch] Failed to store @${c.username}: ${err}`);
      skipped++;
    }
  }

  console.log(`[store-batch] Done: stored=${stored} skipped=${skipped}`);
  res.json({ stored, skipped, total: candidates.length });
});

// POST /api/prospect/run-pipeline — full discover + filter + store orchestrator
app.post('/api/prospect/run-pipeline', async (req, res) => {
  const {
    keywords = ['buildinpublic', 'saasfounder', 'aiautomation'],
    sources = ['hashtag', 'top_accounts', 'followers'],
    maxProspects = 30,
    minScore = 50,
    dryRun = false,
  } = req.body as {
    keywords?: string[];
    sources?: string[];
    maxProspects?: number;
    minScore?: number;
    dryRun?: boolean;
  };

  console.log(`[run-pipeline] Starting: keywords=[${keywords.join(', ')}] sources=[${sources.join(', ')}] maxProspects=${maxProspects} minScore=${minScore} dryRun=${dryRun}`);

  if (dryRun) {
    res.json({ discovered: 0, stored: 0, skipped_low_score: 0, skipped_duplicate: 0, top_prospects: [], dryRun: true });
    return;
  }

  const agentId = `run-pipeline-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[run-pipeline] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex}`);
  } catch (err) {
    res.status(503).json({ error: `Tab claim required: ${err}. Open an Instagram tab and retry.` });
    return;
  }

  let discovered = 0;
  let stored = 0;
  let skipped_low_score = 0;
  let skipped_duplicate = 0;

  try {
    const result = await discoverProspects({
      sources,
      keywords,
      targetCount: maxProspects,
      minScore,
      maxRounds: 2,
      checkCRM: true,
      selfUsername: 'the_isaiah_dupree',
    }, getDriver());

    discovered = result.total;
    skipped_low_score = result.skippedLowScore;
    console.log(`[run-pipeline] Discovered ${discovered} candidates (${skipped_low_score} below score)`);

    for (const c of result.candidates) {
      try {
        const alreadyStored = await isAlreadySuggested(c.username, 'instagram');
        if (alreadyStored) { skipped_duplicate++; continue; }
        await insertProspectSuggestion(c.username, c.priority, c.bio, 'instagram');
        stored++;
      } catch (err) {
        console.warn(`[run-pipeline] Failed to store @${c.username}: ${err}`);
      }
    }

    const topProspects = result.candidates.slice(0, 10).map(c => ({
      username: c.username,
      score: c.icpScore,
      signals: c.icpSignals,
      icp: { qualifies: c.icpScore >= 40, score: c.icpScore, signals: c.icpSignals },
    }));

    console.log(`[run-pipeline] Done: discovered=${discovered} stored=${stored} skipped_low_score=${skipped_low_score} skipped_duplicate=${skipped_duplicate}`);
    res.json({ discovered, stored, skipped_low_score, skipped_duplicate, top_prospects: topProspects });
  } catch (error) {
    console.error(`[run-pipeline] Error: ${error}`);
    res.json({ discovered, stored, skipped_low_score, skipped_duplicate, top_prospects: [], error: String(error) });
  } finally {
    if (coord) { try { await coord.release(); } catch { /* ignore */ } }
  }
});

// GET /api/prospect/pipeline-status — Supabase counts + next batch timing
app.get('/api/prospect/pipeline-status', async (_req, res) => {
  try {
    const status = await getPipelineStatus('instagram');
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/prospect/schedule-batch — select top suggested prospects, generate messages, queue DMs
app.post('/api/prospect/schedule-batch', async (req, res) => {
  const {
    limit = 5,
    template = 'cold_outreach_founder',
    dryRun = false,
  } = req.body as { limit?: number; template?: string; dryRun?: boolean };

  console.log(`[schedule-batch] Starting: limit=${limit} template=${template} dryRun=${dryRun}`);

  const prospects = await getTopSuggestedProspects(Math.min(limit, 20), 'instagram');
  if (prospects.length === 0) {
    res.json({ scheduled: [], skipped: 0, reason: 'No suggested prospects found. Run run-pipeline first.' });
    return;
  }

  const scheduled: Array<{ username: string; message_preview: string; scheduled_for: string }> = [];
  let skipped = 0;

  for (const prospect of prospects) {
    const username = prospect.contact_id || '';
    if (!username) { skipped++; continue; }

    try {
      const message = await generatePersonalizedMessage(
        { username, bio: prospect.message, priority: prospect.priority },
        template,
      );

      // Random delay: 5-30 minutes from now
      const delayMs = (Math.floor(Math.random() * 25) + 5) * 60 * 1000;
      const scheduledFor = new Date(Date.now() + delayMs).toISOString();

      if (!dryRun) {
        const result = await scheduleProspectDM(username, message, scheduledFor);
        if (!result.success) {
          console.warn(`[schedule-batch] Insert failed for @${username}: ${result.error}`);
          skipped++;
          continue;
        }
        await markProspectQueued(username);
      }

      scheduled.push({
        username,
        message_preview: message.slice(0, 120),
        scheduled_for: scheduledFor,
      });

      console.log(`[schedule-batch] ${dryRun ? '[dryRun]' : 'Queued'} DM for @${username} at ${scheduledFor}`);
    } catch (err) {
      console.warn(`[schedule-batch] Failed for @${username}: ${err}`);
      skipped++;
    }
  }

  console.log(`[schedule-batch] Done: scheduled=${scheduled.length} skipped=${skipped} dryRun=${dryRun}`);
  res.json({ scheduled, skipped, ...(dryRun ? { dryRun: true } : {}) });
});

// AI DM generation
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { username, purpose, topic } = req.body;
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

// Execute raw JavaScript (for advanced use)
app.post('/api/execute', async (req, res) => {
  try {
    const { script } = req.body;
    if (!script) {
      res.status(400).json({ error: 'script required' });
      return;
    }
    const output = await getDriver().executeJS(script);
    res.json({ output });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Check login status
app.get('/api/status', async (req, res) => {
  try {
    const d = getDriver();
    const isOnInstagram = await d.isOnInstagram();
    const isLoggedIn = isOnInstagram ? await d.isLoggedIn() : false;
    const currentUrl = await d.getCurrentUrl();
    
    res.json({
      isOnInstagram,
      isLoggedIn,
      currentUrl,
      driverConfig: d.getConfig(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Configure driver
app.put('/api/config', (req, res) => {
  try {
    const d = getDriver();
    d.setConfig(req.body);
    res.json({ success: true, config: d.getConfig() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Debug: run arbitrary JS in the Safari tab (dev only)
app.post('/api/debug/eval', requireActiveSession, async (req, res) => {
  try {
    const { js } = req.body;
    if (!js) { res.status(400).json({ error: 'js required' }); return; }
    const result = await getDriver().executeJS(js);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Self-Poll Endpoint (SDPA-011) ───────────────────────────────────────────
// POST /api/instagram/self-poll
// Called by cron-manager. Fetches DM conversations + unread notifications
// and writes results to safari_platform_cache for cloud-sync to consume.
app.post('/api/instagram/self-poll', async (_req: Request, res: Response) => {
  const result = { dms: 0, notifications: 0 };

  try {
    const { SelfPollCron } = await import('../self-poll-cron.js');
    const poller = new SelfPollCron(parseInt(process.env.PORT || '3100'));
    const { fetched } = await poller.tick();
    result.dms = fetched.dms || 0;
    result.notifications = fetched.notifications || 0;
    res.json({ success: true, fetched: result });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[self-poll:instagram] error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/self-poll/trigger — alias for external trigger
app.get('/api/self-poll/trigger', async (_req: Request, res: Response) => {
  try {
    const { SelfPollCron } = await import('../self-poll-cron.js');
    const poller = new SelfPollCron(parseInt(process.env.PORT || '3100'));
    const result = await poller.tick();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Start server
const PORT = parseInt(process.env.PORT || '3100');

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
    console.log(`\n🚀 Instagram DM API Server running on http://localhost:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health              - Health check`);
    console.log(`  GET  /api/status          - Check Instagram login status`);
    console.log(`  GET  /api/rate-limits     - Get rate limit status`);
    console.log(`  GET  /api/conversations   - List conversations`);
    console.log(`  GET  /api/conversations/all - Get all tabs`);
    console.log(`  POST /api/inbox/navigate  - Navigate to inbox`);
    console.log(`  POST /api/inbox/tab       - Switch tab`);
    console.log(`  POST /api/conversations/open - Open conversation`);
    console.log(`  POST /api/conversations/new  - Start new conversation`);
    console.log(`  GET  /api/messages        - Read messages`);
    console.log(`  POST /api/messages/send   - Send message`);
    console.log(`  POST /api/messages/send-to - Send to user`);
    console.log(`\nRate limits: ${rateLimits.messagesPerHour}/hour, ${rateLimits.messagesPerDay}/day`);
    console.log(`Active hours: ${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00\n`);
  });
}

export { app };

// Auto-start when run directly via: npx tsx src/api/server.ts
const isDirectRun = process.argv[1]?.includes('server');
if (isDirectRun && !process.env.NO_AUTO_START) {
  startServer();
}
