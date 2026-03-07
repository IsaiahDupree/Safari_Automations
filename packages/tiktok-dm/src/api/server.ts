/**
 * TikTok DM API Server
 * Express REST API for TikTok DM automation
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
} else {
  console.log('[CRM] ⚠️ Supabase not configured - DM logging disabled');
}

/**
 * Log DM send to Supabase CRM (fire-and-forget, non-fatal)
 */
async function logDMToSupabase(username: string, content: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;

  try {
    const payload = {
      platform: 'tiktok',
      to_user: username,
      content,
      sent_at: new Date().toISOString(),
      status: 'sent',
    };

    // Fire-and-forget POST to Supabase
    fetch(`${SUPABASE_URL}/rest/v1/crm_messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(payload),
    }).catch((err) => {
      console.error('[CRM] Supabase log failed (non-fatal):', err.message);
    });
  } catch (error) {
    // Non-fatal: don't throw, just log
    console.error('[CRM] Supabase log error (non-fatal):', error);
  }
}

export async function generateAIDM(context: { recipientUsername: string; purpose: string; topic?: string }): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Hey! Your content is 🔥 Wanted to connect about ${context.topic || 'collab opportunities'}!`;
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
          { role: 'system', content: 'Generate a SHORT, casual TikTok DM (max 150 chars). Be trendy, friendly, use emojis.' },
          { role: 'user', content: `DM to @${context.recipientUsername} for ${context.purpose}. ${context.topic ? `Topic: ${context.topic}` : ''}` }
        ],
        max_tokens: 80,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || `Hey! Your content is 🔥 Let's connect!`;
  } catch {
    clearTimeout(timeout);
    return `Hey! Your content is 🔥 Let's connect!`;
  }
}
import cors from 'cors';
import {
  SafariDriver,
  checkAndRetryError,
  hasErrorState,
  detectTikTokRateLimit,
  navigateToInbox,
  listConversations,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  scrollConversations,
  enrichContact,
  DEFAULT_RATE_LIMITS,
  RateLimitConfig,
} from '../automation/index.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { isWithinActiveHours, getRandomDelay } from '../utils/index.js';
import { initDMLogger, logDM, getDMStats } from '../utils/dm-logger.js';
import { initScoringService, recalculateScore, recalculateAllScores, getTopContacts } from '../utils/scoring-service.js';
import { initTemplateEngine, getNextBestAction, getTemplates, detectFitSignals, getPendingActions, queueOutreachAction, markActionSent, markActionFailed, getOutreachStats, check31Rule } from '../utils/template-engine.js';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize CRM logging + scoring + templates
initDMLogger();
initScoringService();
initTemplateEngine();

// Configuration
const PORT = parseInt(process.env.PORT || process.env.TIKTOK_DM_PORT || '3102');
const VERBOSE = process.env.VERBOSE === 'true';

// Rate limit state
let rateLimitConfig: RateLimitConfig = {
  messagesPerHour: parseInt(process.env.CRM_RATE_MESSAGES_PER_HOUR || '') || DEFAULT_RATE_LIMITS.messagesPerHour,
  messagesPerDay: parseInt(process.env.CRM_RATE_MESSAGES_PER_DAY || '') || DEFAULT_RATE_LIMITS.messagesPerDay,
  minDelayMs: parseInt(process.env.CRM_RATE_MIN_DELAY_MS || '') || DEFAULT_RATE_LIMITS.minDelayMs,
  maxDelayMs: parseInt(process.env.CRM_RATE_MAX_DELAY_MS || '') || DEFAULT_RATE_LIMITS.maxDelayMs,
  activeHoursStart: parseInt(process.env.CRM_ACTIVE_HOURS_START || '') || DEFAULT_RATE_LIMITS.activeHoursStart,
  activeHoursEnd: parseInt(process.env.CRM_ACTIVE_HOURS_END || '') || DEFAULT_RATE_LIMITS.activeHoursEnd,
};

// Message tracking
const messageLog: { timestamp: Date }[] = [];

function getMessagesSentThisHour(): number {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return messageLog.filter(m => m.timestamp > oneHourAgo).length;
}

function getMessagesSentToday(): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return messageLog.filter(m => m.timestamp > today).length;
}

function recordMessage(): void {
  messageLog.push({ timestamp: new Date() });
  // Clean old entries (keep last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  while (messageLog.length > 0 && messageLog[0].timestamp < sevenDaysAgo) {
    messageLog.shift();
  }
}

function checkRateLimits(): { allowed: boolean; reason?: string } {
  if (!isWithinActiveHours(rateLimitConfig)) {
    return { allowed: false, reason: 'Outside active hours' };
  }
  
  const hourly = getMessagesSentThisHour();
  if (hourly >= rateLimitConfig.messagesPerHour) {
    return { allowed: false, reason: 'Hourly limit reached' };
  }
  
  const daily = getMessagesSentToday();
  if (daily >= rateLimitConfig.messagesPerDay) {
    return { allowed: false, reason: 'Daily limit reached' };
  }
  
  return { allowed: true };
}

// Rate limit middleware
function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'POST' && req.path.includes('/messages/send')) {
    // Check for force flag to bypass active-hours
    const body = req.body as { force?: boolean };
    if (body.force === true) {
      console.log('[FORCE] ⚠️ Active-hours bypass enabled for this send');
      next();
      return;
    }

    const check = checkRateLimits();
    if (!check.allowed) {
      res.status(429).json({
        success: false,
        error: check.reason,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
          limits: rateLimitConfig,
        },
      });
      return;
    }
  }
  next();
}

app.use(rateLimitMiddleware);

// Create Safari driver
const driver = new SafariDriver({ verbose: VERBOSE });

// URL pattern that identifies the TikTok Safari session
const SESSION_URL_PATTERN = 'tiktok.com';

// Service identity for tab coordination
const SERVICE_NAME = 'tiktok-dm';
const SERVICE_PORT = 3102;

// Active tab coordinators by agentId (in-process map; file is cross-process)
const activeCoordinators = new Map<string, InstanceType<typeof TabCoordinator>>();

/**
 * Ensure the TikTok Safari tab is the active/front tab before any operation.
 * Scans all Safari windows, finds the tiktok.com tab, and activates it.
 */
async function ensureTikTokSession(): Promise<{ ok: boolean; windowIndex: number; tabIndex: number; url: string }> {
  const info = await driver.ensureActiveSession(SESSION_URL_PATTERN);
  return { ok: info.found, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url };
}

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tiktok.com tab OR opens one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/session/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.tiktok.com/messages';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/session|^\/api\/[^/]+\/status$|^\/api\/[^/]+\/rate-limits/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  try {
    const claims = await TabCoordinator.listClaims();
    const myClaim = claims.find(c => c.service === SERVICE_NAME);

    if (myClaim) {
      driver.setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
      next();
      return;
    }

    // No claim — auto-claim existing tiktok.com tab only (never opens a new window)
    const autoId = `tiktok-dm-auto-${Date.now()}`;
    const coord = new TabCoordinator(autoId, SERVICE_NAME, PORT, SESSION_URL_PATTERN);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    driver.setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: 'No Safari tab available for tiktok-dm',
      detail: String(err),
      fix: 'Open Safari and navigate to https://www.tiktok.com/messages',
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────

// Health check (exempt from tab claim)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'tiktok-dm', platform: 'tiktok', port: PORT });
});

// === SESSION MANAGEMENT ===

app.get('/api/session/status', (_req: Request, res: Response) => {
  const info = driver.getSessionInfo();
  res.json({
    tracked: !!info.windowIndex,
    windowIndex: info.windowIndex,
    tabIndex: info.tabIndex,
    urlPattern: info.urlPattern,
    lastVerifiedMs: info.lastVerified ? Date.now() - info.lastVerified : null,
    sessionUrlPattern: SESSION_URL_PATTERN,
  });
});

app.post('/api/session/ensure', async (_req: Request, res: Response) => {
  try {
    const info = await ensureTikTokSession();
    res.json({
      ok: info.ok,
      windowIndex: info.windowIndex,
      tabIndex: info.tabIndex,
      url: info.url,
      message: info.ok
        ? `TikTok session active at window ${info.windowIndex}, tab ${info.tabIndex}`
        : 'TikTok tab not found — open Safari and navigate to tiktok.com',
    });
  } catch (error) {
    // No TikTok tab found — return ok:false rather than a 500 so callers can handle gracefully
    const msg = String(error);
    if (msg.includes('No') && msg.includes('tab found')) {
      res.json({ ok: false, message: 'TikTok tab not found — open Safari and navigate to tiktok.com' });
    } else {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

app.post('/api/session/clear', (_req: Request, res: Response) => {
  driver.clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

// Get TikTok status
app.get('/api/tiktok/status', async (_req: Request, res: Response) => {
  try {
    const currentUrl = await driver.getCurrentUrl();
    const isOnTikTok = currentUrl.includes('tiktok.com');
    const isLoggedIn = await driver.isLoggedIn();
    
    res.json({ isOnTikTok, isLoggedIn, currentUrl });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Check for error state and auto-retry
app.get('/api/tiktok/error-check', async (_req: Request, res: Response) => {
  try {
    const hasError = await hasErrorState(driver);
    res.json({ hasError });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/tiktok/error-retry', async (_req: Request, res: Response) => {
  try {
    const retried = await checkAndRetryError(driver);
    const hasError = await hasErrorState(driver);
    res.json({ retried, hasError });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get rate limits
app.get('/api/tiktok/rate-limits', (_req: Request, res: Response) => {
  res.json({
    limits: rateLimitConfig,
    messagesSentToday: getMessagesSentToday(),
    messagesSentThisHour: getMessagesSentThisHour(),
    activeHours: {
      start: rateLimitConfig.activeHoursStart,
      end: rateLimitConfig.activeHoursEnd,
      isActive: isWithinActiveHours(rateLimitConfig),
    },
    nextDelay: getRandomDelay(rateLimitConfig),
  });
});

// Detect TikTok rate limit UI
app.get('/api/tiktok/rate-status', async (_req: Request, res: Response) => {
  try {
    const status = await detectTikTokRateLimit(driver);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Update rate limits
app.put('/api/tiktok/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<RateLimitConfig>;
  rateLimitConfig = { ...rateLimitConfig, ...updates };
  res.json({
    limits: rateLimitConfig,
    messagesSentToday: getMessagesSentToday(),
    messagesSentThisHour: getMessagesSentThisHour(),
  });
});

// Navigate to inbox
app.post('/api/tiktok/inbox/navigate', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToInbox(driver);
    if (result.success) {
      res.json({ success: true, currentUrl: result.currentUrl });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// List conversations
app.get('/api/tiktok/conversations', async (_req: Request, res: Response) => {
  try {
    const conversations = await listConversations(driver);
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List unread conversations — navigates to inbox first, then reads DOM
app.get('/api/tiktok/conversations/unread', async (_req: Request, res: Response) => {
  try {
    // Ensure we're on the inbox page before reading
    const navResult = await navigateToInbox(driver);
    if (!navResult.success) {
      res.status(503).json({ error: `Failed to navigate to inbox: ${navResult.error}` });
      return;
    }
    // Small wait for conversation list to render
    await driver.wait(1500);

    const result = await driver.executeJS(`
      (function() {
        var unreadConvos = [];
        var items = document.querySelectorAll('[data-e2e="message-item"], [data-e2e="chat-list-item"], [class*="ConversationItem"], [class*="conversation-item"]');

        items.forEach(function(item) {
          var hasUnread = !!item.querySelector('[class*="unread"], [class*="badge"], [class*="Unread"], [class*="Badge"], [class*="dot"]');
          if (hasUnread) {
            var text = item.innerText.trim().split("\\n").filter(function(l) { return l.trim(); });
            var username = text[0] || 'Unknown';
            var preview = text[1] ? text[1].substring(0, 100) : '';
            unreadConvos.push({ username: username, preview: preview });
          }
        });

        var allItems = document.querySelectorAll('[data-e2e="message-item"], [data-e2e="chat-list-item"], [class*="ConversationItem"], [class*="conversation-item"]');
        return JSON.stringify({ count: unreadConvos.length, total: allItems.length, conversations: unreadConvos });
      })()
    `);

    let parsed: { count: number; total: number; conversations: { username: string; preview: string }[] };
    try {
      parsed = JSON.parse(result);
    } catch {
      parsed = { count: 0, total: 0, conversations: [] };
    }
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Open conversation
app.post('/api/tiktok/conversations/open', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }

    const result = await openConversation(driver, username);
    if (result.success) {
      // conversationId = username — used by dm-followup-engine to fetch messages
      res.json({ success: true, currentUrl: result.currentUrl, conversationId: username });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Start new conversation
app.post('/api/tiktok/conversations/new', async (req: Request, res: Response) => {
  try {
    const { username, message } = req.body as { username: string; message: string };
    if (!username || !message) {
      res.status(400).json({ error: 'username and message are required' });
      return;
    }
    
    const result = await startNewConversation(driver, username, message);
    if (result.success) {
      recordMessage();
      res.json({
        success: true,
        username,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Scroll conversations
app.post('/api/tiktok/conversations/scroll', async (_req: Request, res: Response) => {
  try {
    const newCount = await scrollConversations(driver);
    res.json({ newCount });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Read messages
app.get('/api/tiktok/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const conversationId = req.query.conversationId as string | undefined;

    // If a conversationId (username) is provided, open that conversation first.
    // This is required by dm-followup-engine which passes conversationId after opening.
    if (conversationId) {
      const opened = await openConversation(driver, conversationId);
      if (!opened.success) {
        res.status(404).json({ error: `Conversation not found: ${conversationId}` });
        return;
      }
      await driver.wait(1500);
    }

    const raw = await readMessages(driver, limit);
    // Normalise to the schema dm-followup-engine expects:
    // { text, isOwn, from, id, timestamp }
    const messages = raw.map((m: { content?: string; sender?: string; text?: string; isOwn?: boolean; from?: string; id?: string; timestamp?: string }, i: number) => ({
      text:      m.text ?? m.content ?? '',
      isOwn:     m.isOwn ?? (m.sender === 'me'),
      from:      m.from ?? (m.sender === 'me' ? 'me' : 'them'),
      id:        m.id ?? `msg-${i}`,
      timestamp: m.timestamp ?? new Date().toISOString(),
    }));
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send message in current conversation
app.post('/api/tiktok/messages/send', async (req: Request, res: Response) => {
  try {
    const { text, message } = req.body as { text?: string; message?: string };
    const msg = text || message;
    if (!msg) {
      res.status(400).json({ error: 'text (or message) is required' });
      return;
    }
    
    const result = await sendMessage(driver, msg);
    if (result.success) {
      recordMessage();
      res.json({
        success: true,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Send message to specific user (profile-to-DM)
app.post('/api/tiktok/messages/send-to', async (req: Request, res: Response) => {
  try {
    const { username, text, message } = req.body as { username: string; text?: string; message?: string };
    const msg = text || message;
    if (!username || !msg) {
      res.status(400).json({ error: 'username and text (or message) are required' });
      return;
    }

    // Check for TikTok rate limit UI before attempting to send
    const rateLimitStatus = await detectTikTokRateLimit(driver);
    if (rateLimitStatus.limited) {
      res.status(429).json({
        success: false,
        rateLimited: true,
        error: `TikTok rate limited: ${rateLimitStatus.message || 'detected'}`,
        captcha: rateLimitStatus.captcha,
      });
      return;
    }

    const result = await sendDMByUsername(username, msg, driver);
    if (result.success) {
      recordMessage();
      logDM({ platform: 'tiktok', username, messageText: msg, isOutbound: true });
      logDMToSupabase(username, msg); // Fire-and-forget Supabase logging
      res.json({
        success: true,
        username: result.username,
        verified: result.verified,
        verifiedRecipient: result.verifiedRecipient,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error, username: result.username });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Send message via profile URL
app.post('/api/tiktok/messages/send-to-url', async (req: Request, res: Response) => {
  try {
    const { profileUrl, message } = req.body as { profileUrl: string; message: string };
    if (!profileUrl || !message) {
      res.status(400).json({ error: 'profileUrl and message are required' });
      return;
    }
    
    const result = await sendDMFromProfileUrl(profileUrl, message, driver);
    if (result.success) {
      recordMessage();
      const extractedUsername = profileUrl.replace(/.*\.com\/@?/, '').replace(/\/.*/, '');
      const finalUsername = result.username || extractedUsername;
      logDM({ platform: 'tiktok', username: finalUsername, messageText: message, isOutbound: true });
      logDMToSupabase(finalUsername, message); // Fire-and-forget Supabase logging
      res.json({
        success: true,
        username: result.username,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// CRM stats
app.get('/api/tiktok/crm/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getDMStats('tiktok');
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/tiktok/crm/score', async (req: Request, res: Response) => {
  try {
    const { contactId } = req.body as { contactId: string };
    if (!contactId) { res.status(400).json({ error: 'contactId required' }); return; }
    const result = await recalculateScore(contactId);
    res.json({ success: !!result, score: result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/crm/score-all', async (_req: Request, res: Response) => {
  try {
    const result = await recalculateAllScores('tiktok');
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/tiktok/crm/top-contacts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const contacts = await getTopContacts('tiktok', limit);
    res.json({ success: true, contacts });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// === TEMPLATE ENGINE ===

app.get('/api/tiktok/templates', async (_req: Request, res: Response) => {
  try {
    const { lane, stage } = _req.query as { lane?: string; stage?: string };
    const templates = await getTemplates({ lane, stage, platform: 'tiktok' });
    res.json({ success: true, templates, count: templates.length });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/templates/next-action', async (req: Request, res: Response) => {
  try {
    const context = { ...req.body, platform: 'tiktok' as const };
    if (!context.username) { res.status(400).json({ error: 'username required' }); return; }
    const result = await getNextBestAction(context);
    res.json({ success: true, result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/templates/fit-signals', async (req: Request, res: Response) => {
  try {
    const { text } = req.body as { text: string };
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const result = await detectFitSignals(text);
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/tiktok/templates/rule-check/:contactId', async (req: Request, res: Response) => {
  try {
    const result = await check31Rule(req.params.contactId);
    res.json({ success: true, ...result });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// === OUTREACH QUEUE ===

app.get('/api/tiktok/outreach/pending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const actions = await getPendingActions('tiktok', limit);
    res.json({ success: true, actions, count: actions.length });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/outreach/queue', async (req: Request, res: Response) => {
  try {
    const action = { ...req.body, platform: 'tiktok' };
    if (!action.contact_id || !action.message) { res.status(400).json({ error: 'contact_id and message required' }); return; }
    const result = await queueOutreachAction(action);
    res.json(result);
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/outreach/:actionId/sent', async (req: Request, res: Response) => {
  try { res.json({ success: await markActionSent(req.params.actionId) }); }
  catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.post('/api/tiktok/outreach/:actionId/failed', async (req: Request, res: Response) => {
  try { res.json({ success: await markActionFailed(req.params.actionId, req.body.error || 'Unknown') }); }
  catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

app.get('/api/tiktok/outreach/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getOutreachStats('tiktok');
    res.json({ success: true, stats });
  } catch (error) { res.status(500).json({ success: false, error: String(error) }); }
});

// AI DM generation
app.post('/api/tiktok/ai/generate', async (req: Request, res: Response) => {
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

// Get TikTok user profile by username
app.get('/api/tiktok/profile/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username.replace('@', '');
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }

    const profile = await enrichContact(username, driver);
    const hasData = !!(profile.followers || profile.following || profile.fullName);
    if (!hasData) {
      await navigateToInbox(driver);
      res.status(404).json({
        success: false,
        error: 'Profile not found or failed to load',
        username
      });
      return;
    }

    // Restore inbox so the tracked tab isn't left stranded on the profile page
    await navigateToInbox(driver);
    res.json({
      username,
      displayName: profile.fullName,
      bio: profile.bio,
      followers: profile.followers,
      following: profile.following,
      likes: profile.likes,
      verified: false // TikTok doesn't expose verified status in DOM easily
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Enrich a TikTok creator profile (followers, following, likes)
app.post('/api/tiktok/profile/enrich', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }
    const profile = await enrichContact(username.replace('@', ''), driver);
    const hasData = !!(profile.followers || profile.following || profile.fullName);
    if (!hasData) {
      res.status(400).json({ success: false, error: 'Empty profile — Safari may not have TikTok session or profile page failed to load', username });
      return;
    }
    res.json({ success: true, username, profile });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Execute raw script (advanced)
app.post('/api/execute', async (req: Request, res: Response) => {
  try {
    const { script } = req.body as { script: string };
    if (!script) {
      res.status(400).json({ error: 'script is required' });
      return;
    }

    const output = await driver.executeJS(script);
    res.json({ output });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === DM API ENDPOINTS (for test compatibility) ===

// Send DM - test-compatible endpoint
app.post('/api/tiktok/dm/send', async (req: Request, res: Response) => {
  try {
    const { username, message } = req.body as { username: string; message: string };
    if (!username || !message) {
      res.status(400).json({ error: 'username and message are required' });
      return;
    }

    const result = await sendDMByUsername(username, message, driver);
    if (result.success) {
      recordMessage();
      logDM({ platform: 'tiktok', username, messageText: message, isOutbound: true });
      logDMToSupabase(username, message); // Fire-and-forget Supabase logging
      res.json({
        success: true,
        username: result.username,
        verified: result.verified,
        rateLimits: {
          hourly: getMessagesSentThisHour(),
          daily: getMessagesSentToday(),
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error, username: result.username });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Get DM conversations - test-compatible endpoint
app.get('/api/tiktok/dm/conversations', async (_req: Request, res: Response) => {
  try {
    const conversations = await listConversations(driver);
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get DM messages in conversation
app.get('/api/tiktok/dm/messages/:id', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await readMessages(driver, limit);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Search DM conversations
app.post('/api/tiktok/dm/search', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    if (!username) {
      res.status(400).json({ error: 'username is required' });
      return;
    }

    const result = await openConversation(driver, username);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === CLEAN PATH ALIASES (per PRD spec) ===

// GET /api/status — alias for /api/tiktok/status
app.get('/api/status', async (_req: Request, res: Response) => {
  try {
    const currentUrl = await driver.getCurrentUrl();
    const isOnTikTok = currentUrl.includes('tiktok.com');
    const isLoggedIn = await driver.isLoggedIn();
    res.json({ isOnTikTok, isLoggedIn, currentUrl });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/inbox/navigate
app.post('/api/inbox/navigate', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToInbox(driver);
    if (result.success) {
      res.json({ success: true, currentUrl: result.currentUrl });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/conversations — alias for /api/tiktok/conversations
app.get('/api/conversations', async (_req: Request, res: Response) => {
  try {
    const conversations = await listConversations(driver);
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/conversations/open — alias
app.post('/api/conversations/open', async (req: Request, res: Response) => {
  try {
    const { username } = req.body as { username: string };
    if (!username) { res.status(400).json({ error: 'username is required' }); return; }
    const result = await openConversation(driver, username);
    if (result.success) {
      res.json({ success: true, currentUrl: result.currentUrl });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// GET /api/messages — alias for /api/tiktok/messages
app.get('/api/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = await readMessages(driver, limit);
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET /api/profile/:username — alias for /api/tiktok/profile/:username
app.get('/api/profile/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username.replace('@', '');
    const profile = await enrichContact(username, driver);
    const hasData = !!(profile.followers || profile.following || profile.fullName);
    if (!hasData) {
      res.status(404).json({ success: false, error: 'Profile not found or failed to load', username });
      return;
    }
    res.json({
      username,
      displayName: profile.fullName,
      bio: profile.bio,
      followers: profile.followers,
      following: profile.following,
      likes: profile.likes,
      verified: false,
      isPrivate: false,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// GET /api/search — search TikTok users
app.get('/api/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }

    await driver.navigateTo(`https://www.tiktok.com/search/user?q=${encodeURIComponent(q)}`);
    await driver.wait(3000);

    const raw = await driver.executeJS(`(function() {
      var results = [];
      var seen = {};
      // User result cards — TikTok search/user page
      var cards = document.querySelectorAll('[data-e2e="search-user-container"], [data-e2e="search_top-item"]');
      if (cards.length === 0) {
        // Fallback: scrape username links from user search page
        var links = document.querySelectorAll('a[href*="/@"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          var m = href.match(/\\/@([a-zA-Z0-9_.]+)/);
          if (m && !seen[m[1].toLowerCase()]) {
            seen[m[1].toLowerCase()] = 1;
            var container = links[i].closest('[class*="UserCard"], [class*="user-card"], div');
            var text = container ? container.innerText : links[i].innerText;
            var lines = text.trim().split('\\n').filter(function(l) { return l.trim(); });
            results.push({ username: m[1], displayName: lines[0] || m[1], followers: '', verified: false });
          }
          if (results.length >= 10) break;
        }
      } else {
        cards.forEach(function(card) {
          var link = card.querySelector('a[href*="/@"]');
          if (!link) return;
          var href = link.getAttribute('href') || '';
          var m = href.match(/\\/@([a-zA-Z0-9_.]+)/);
          if (!m || seen[m[1].toLowerCase()]) return;
          seen[m[1].toLowerCase()] = 1;
          var lines = card.innerText.trim().split('\\n').filter(function(l) { return l.trim(); });
          results.push({ username: m[1], displayName: lines[0] || m[1], followers: lines[1] || '', verified: false });
        });
      }
      return JSON.stringify(results.slice(0, 10));
    })()`);

    const users = JSON.parse(raw || '[]') as { username: string; displayName: string; followers: string; verified: boolean }[];
    res.json({ users, count: users.length, query: q });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/messages/send-to — with dryRun support
// Note: tab claim already enforced by requireTabClaim middleware
app.post('/api/messages/send-to', async (req: Request, res: Response) => {
  const { username, text, message, dryRun } = req.body as { username: string; text?: string; message?: string; dryRun?: boolean };
  const msg = text || message;
  if (!username || !msg) {
    res.status(400).json({ error: 'username and text (or message) are required' });
    return;
  }

  if (dryRun === true) {
    console.log(`[send-to] DryRun: would send to @${username}: "${msg.substring(0, 50)}..."`);
    res.json({ success: true, dryRun: true, username, message: msg });
    return;
  }

  try {
    const rateLimitStatus = await detectTikTokRateLimit(driver);
    if (rateLimitStatus.limited) {
      res.status(429).json({
        success: false, rateLimited: true,
        error: `TikTok rate limited: ${rateLimitStatus.message || 'detected'}`,
        captcha: rateLimitStatus.captcha,
      });
      return;
    }

    const result = await sendDMByUsername(username, msg, driver);
    if (result.success) {
      recordMessage();
      logDM({ platform: 'tiktok', username, messageText: msg, isOutbound: true });
      logDMToSupabase(username, msg);
      syncToCRMLite(username, msg);
      res.json({
        success: true, username: result.username, verified: result.verified,
        verifiedRecipient: result.verifiedRecipient,
        rateLimits: { hourly: getMessagesSentThisHour(), daily: getMessagesSentToday() },
      });
    } else {
      res.status(400).json({ success: false, error: result.error, username: result.username });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// === ICP SCORING ===

const ICP_BIO_KEYWORDS = ['founder', 'saas', 'build', 'software', 'ai', 'startup', 'indie', 'developer'];

function parseFollowerCount(str: string): number {
  if (!str) return 0;
  const s = str.replace(/,/g, '').trim();
  const m = s.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  return Math.round(n);
}

function scoreTikTokICP(profile: { bio?: string; followers?: string; likes?: string; verified?: boolean; isPrivate?: boolean }): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  const bio = (profile.bio || '').toLowerCase();
  const followers = parseFollowerCount(profile.followers || '');
  const likes = parseFollowerCount(profile.likes || '');

  // Bio keyword match: +15 per keyword (max 45)
  const matched = ICP_BIO_KEYWORDS.filter(k => bio.includes(k));
  if (matched.length > 0) {
    score += Math.min(matched.length * 15, 45);
    signals.push(...matched.map(k => `bio:${k}`));
  }

  // Follower range
  if (followers >= 1_000 && followers <= 50_000) {
    score += 25;
    signals.push('follower_range:1K-50K');
  } else if (followers > 50_000 && followers <= 500_000) {
    score += 15;
    signals.push('follower_range:50K-500K');
  }

  // Engagement ratio: likes / followers
  if (followers > 0 && likes / followers > 0.1) {
    score += 20;
    signals.push('high_engagement');
  }

  // Not verified: +5
  if (!profile.verified) {
    score += 5;
    signals.push('not_verified');
  }

  return { score: Math.min(score, 100), signals };
}

// GET /api/prospect/score/:username
app.get('/api/prospect/score/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username.replace('@', '');
    const profile = await enrichContact(username, driver);
    const { score, signals } = scoreTikTokICP(profile);
    res.json({
      username,
      score,
      signals,
      icp: { qualifies: score >= 50 },
      profile: {
        displayName: profile.fullName,
        bio: profile.bio,
        followers: profile.followers,
        following: profile.following,
        likes: profile.likes,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/prospect/discover
// Note: tab claim already enforced by requireTabClaim middleware
app.post('/api/prospect/discover', async (req: Request, res: Response) => {

  try {
    const {
      hashtags = ['buildinpublic'],
      minFollowers = 1000,
      maxFollowers = 500000,
      maxCandidates = 20,
    } = req.body as { hashtags?: string[]; minFollowers?: number; maxFollowers?: number; maxCandidates?: number };

    const seen = new Set<string>();
    const candidates: { username: string; displayName: string; score: number; signals: string[]; qualifies: boolean; source: string }[] = [];

    for (const hashtag of hashtags) {
      const tag = hashtag.replace(/^#/, '');
      console.log(`[prospect-discover] Navigating to #${tag}...`);
      await driver.navigateTo(`https://www.tiktok.com/tag/${encodeURIComponent(tag)}`);
      await driver.wait(3500);

      // Scroll to load more
      for (let s = 0; s < 2; s++) {
        try { await driver.executeJS('window.scrollTo(0, document.body.scrollHeight)'); } catch { /* ignore */ }
        await driver.wait(1200);
      }

      // Extract creator usernames from video links
      const raw = await driver.executeJS(`(function() {
        var seen = {};
        var usernames = [];
        var links = document.querySelectorAll('a[href*="/@"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          var m = href.match(/\\/@([a-zA-Z0-9_.]+)/);
          if (m && !seen[m[1].toLowerCase()]) {
            seen[m[1].toLowerCase()] = 1;
            usernames.push(m[1]);
          }
          if (usernames.length >= 30) break;
        }
        return JSON.stringify(usernames);
      })()`);

      const usernames: string[] = JSON.parse(raw || '[]');
      console.log(`[prospect-discover] #${tag}: ${usernames.length} creators found`);

      for (const u of usernames) {
        if (seen.has(u.toLowerCase())) continue;
        seen.add(u.toLowerCase());
        if (candidates.length >= maxCandidates) break;

        try {
          const profile = await enrichContact(u, driver);
          const followerCount = parseFollowerCount(profile.followers || '');
          if (followerCount < minFollowers || followerCount > maxFollowers) continue;
          const { score, signals } = scoreTikTokICP(profile);
          candidates.push({
            username: u,
            displayName: profile.fullName || u,
            score,
            signals,
            qualifies: score >= 50,
            source: `hashtag:#${tag}`,
          });
          console.log(`[prospect-discover] @${u} score=${score} followers=${profile.followers}`);
        } catch {
          // skip failed enrichment
        }
        await driver.wait(500);
      }

      if (candidates.length >= maxCandidates) break;
    }

    candidates.sort((a, b) => b.score - a.score);
    res.json({ candidates, total: candidates.length, hashtags });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === TAB MANAGEMENT ===

// GET /api/tabs/claims — list all live tab claims across all services
app.get('/api/tabs/claims', async (_req: Request, res: Response) => {
  const claims = await TabCoordinator.listClaims();
  res.json({ claims, count: claims.length });
});

// POST /api/tabs/claim — claim a Safari tab for this service
app.post('/api/tabs/claim', async (req: Request, res: Response) => {
  const { agentId, windowIndex, tabIndex } = req.body as {
    agentId: string; windowIndex?: number; tabIndex?: number;
  };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    driver.setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    res.json({ ok: true, claim, message: `Tab ${claim.windowIndex}:${claim.tabIndex} claimed by '${agentId}'` });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

// POST /api/tabs/release — release a tab claim
app.post('/api/tabs/release', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
  res.json({ ok: true, message: `Claim released for '${agentId}'` });
});

// POST /api/tabs/heartbeat — refresh claim TTL
app.post('/api/tabs/heartbeat', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (!coord) { res.status(404).json({ error: `No claim for '${agentId}'` }); return; }
  await coord.heartbeat();
  res.json({ ok: true, heartbeat: Date.now() });
});

// POST /api/debug/eval — execute JS in the tracked Safari tab (debugging only)
app.post('/api/debug/eval', async (req: Request, res: Response) => {
  try {
    const { js } = req.body as { js: string };
    if (!js) { res.status(400).json({ error: 'js required' }); return; }
    const result = await driver.executeJS(js);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === CRMLITE SYNC ===

const CRMLITE_BASE = 'https://crmlite-isaiahduprees-projects.vercel.app';

function syncToCRMLite(username: string, message: string): void {
  const apiKey = process.env.CRMLITE_API_KEY;
  if (!apiKey) return;
  fetch(`${CRMLITE_BASE}/api/sync/dm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      platform: 'tiktok',
      conversations: [{ username, display_name: username, messages: [{ text: message, direction: 'outbound', sent_at: new Date().toISOString() }] }],
    }),
  }).catch(err => console.error('[crmlite] sync failed (non-fatal):', err.message));
}

// Start server
export function startServer(port: number = PORT): void {
  // On startup: evict any stale claims left by a previous process for this service.
  // This prevents the new process from inheriting a dead window/tab reference.
  TabCoordinator.listClaims().then(claims => {
    const myStale = claims.filter(c => c.service === SERVICE_NAME);
    if (myStale.length > 0) {
      console.log(`[startup] Clearing ${myStale.length} stale tiktok-dm claim(s) from previous process`);
      // Write back claims without our service's entries
      import('fs/promises').then(fsp => {
        const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
        const remaining = claims.filter(c => c.service !== SERVICE_NAME);
        fsp.writeFile(CLAIMS_FILE, JSON.stringify(remaining, null, 2)).catch(() => {});
      });
    }
  }).catch(() => {});

  app.listen(port, () => {
    console.log(`🎵 TikTok DM API server running on http://localhost:${port}`);
    console.log(`   Health: GET /health`);
    console.log(`   Status: GET /api/tiktok/status`);
    console.log(`   Send DM: POST /api/tiktok/messages/send-to`);
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
