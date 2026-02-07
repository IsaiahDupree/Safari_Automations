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

export async function generateAIDM(context: { recipientUsername: string; purpose: string; topic?: string }): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Hey! Your content is 🔥 Wanted to connect about ${context.topic || 'collab opportunities'}!`;
  }
  
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
    });
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || `Hey! Your content is 🔥 Let's connect!`;
  } catch {
    return `Hey! Your content is 🔥 Let's connect!`;
  }
}
import cors from 'cors';
import {
  SafariDriver,
  checkAndRetryError,
  hasErrorState,
  navigateToInbox,
  listConversations,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  scrollConversations,
  DEFAULT_RATE_LIMITS,
  RateLimitConfig,
} from '../automation/index.js';
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

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', platform: 'tiktok', port: PORT });
});

// Get TikTok status
app.get('/api/tiktok/status', async (_req: Request, res: Response) => {
  try {
    const [isOnTikTok, isLoggedIn, currentUrl] = await Promise.all([
      driver.isOnTikTok(),
      driver.isLoggedIn(),
      driver.getCurrentUrl(),
    ]);
    
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
      res.json({ success: true, currentUrl: result.currentUrl });
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
    const messages = await readMessages(driver, limit);
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
    
    const result = await sendDMByUsername(username, msg, driver);
    if (result.success) {
      recordMessage();
      logDM({ platform: 'tiktok', username, messageText: msg, isOutbound: true });
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
      logDM({ platform: 'tiktok', username: result.username || extractedUsername, messageText: message, isOutbound: true });
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

// Execute raw script (advanced)
app.post('/api/execute', async (req: Request, res: Response) => {
  try {
    const { script } = req.body as { script: string };
    if (!script) {
      res.status(400).json({ error: 'script is required' });
      return;
    }
    
    const output = await driver.executeScript(script);
    res.json({ output });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Start server
export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`🎵 TikTok DM API server running on http://localhost:${port}`);
    console.log(`   Health: GET /health`);
    console.log(`   Status: GET /api/tiktok/status`);
    console.log(`   Send DM: POST /api/tiktok/messages/send-to`);
  });
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
