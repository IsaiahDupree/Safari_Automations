/**
 * Twitter/X DM API Server
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
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { DMTab, RateLimitConfig } from '../automation/types.js';
import { isWithinActiveHours } from '../utils/index.js';
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

// Rate limiting state
let messagesSentToday = 0;
let messagesSentThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

// Safari driver instance
let driver: SafariDriver | null = null;

function getDriver(): SafariDriver {
  if (!driver) {
    driver = new SafariDriver({
      verbose: process.env.VERBOSE === 'true',
    });
  }
  return driver;
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
  if (!isWithinActiveHours(rateLimits.activeHoursStart, rateLimits.activeHoursEnd)) {
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

function recordMessageSent(): void {
  messagesSentThisHour++;
  messagesSentToday++;
}

// === HEALTH ===

app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    service: 'twitter-dm',
    timestamp: new Date().toISOString() 
  });
});

// === STATUS ===

app.get('/api/twitter/status', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const isOnTwitter = await d.isOnTwitter();
    const isLoggedIn = isOnTwitter ? await d.isLoggedIn() : false;
    const currentUrl = await d.getCurrentUrl();
    
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
    const result = await sendDMByUsername(username, text, getDriver());
    
    if (result.success) {
      recordMessageSent();
      logDM({ platform: 'twitter', username, messageText: text, isOutbound: true });
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

// Start server
const PORT = parseInt(process.env.TWITTER_DM_PORT || process.env.PORT || '3003');

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`🐦 Twitter DM API server running on http://localhost:${port}`);
    console.log(`   Health: GET /health`);
    console.log(`   Status: GET /api/twitter/status`);
    console.log(`   Send DM: POST /api/twitter/messages/send-to`);
    console.log(`   AI Generate: POST /api/twitter/ai/generate`);
    console.log(`   AI Enabled: ${!!OPENAI_API_KEY}`);
  });
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
