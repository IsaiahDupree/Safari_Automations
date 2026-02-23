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
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { DMTab, RateLimitConfig } from '../automation/types.js';
import { initDMLogger, logDM, getDMStats } from '../utils/dm-logger.js';
import { initScoringService, recalculateScore, recalculateAllScores, getTopContacts } from '../utils/scoring-service.js';
import { initTemplateEngine, getNextBestAction, getTemplates, detectFitSignals, getPendingActions, queueOutreachAction, markActionSent, markActionFailed, getOutreachStats, check31Rule, determineLane, fillTemplate } from '../utils/template-engine.js';

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

// Navigate to inbox
app.post('/api/inbox/navigate', async (req, res) => {
  try {
    const result = await navigateToInbox(getDriver());
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// List conversations
app.get('/api/conversations', async (req, res) => {
  try {
    const conversations = await listConversations(getDriver());
    res.json({ conversations, count: conversations.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Get all conversations from all tabs
app.get('/api/conversations/all', async (req, res) => {
  try {
    const allConversations = await getAllConversations(getDriver());
    const totalCount = Object.values(allConversations).reduce((sum, arr) => sum + arr.length, 0);
    res.json({ conversations: allConversations, totalCount });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Switch tab
app.post('/api/inbox/tab', async (req, res) => {
  try {
    const { tab } = req.body as { tab: DMTab };
    const success = await switchTab(tab, getDriver());
    res.json({ success, tab });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Open conversation
app.post('/api/conversations/open', async (req, res) => {
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
app.get('/api/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = await readMessages(limit, getDriver());
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Send message (rate limited)
app.post('/api/messages/send', checkRateLimit, async (req, res) => {
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
      if (username) {
        logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
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
app.post('/api/conversations/new', async (req, res) => {
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
app.post('/api/messages/send-to', checkRateLimit, async (req, res) => {
  try {
    const { username, text } = req.body;
    
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    
    // Try to open existing conversation first
    let opened = await openConversation(username, getDriver());
    
    // If not found, start new conversation
    if (!opened) {
      opened = await startNewConversation(username, getDriver());
    }
    
    if (!opened) {
      res.status(404).json({ error: 'Could not open or create conversation' });
      return;
    }
    
    const result = await sendMessage(text, getDriver());
    
    if (result.success) {
      messagesSentToday++;
      messagesSentThisHour++;
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
    }
    
    res.json({
      ...result,
      username,
      rateLimits: {
        messagesSentToday,
        messagesSentThisHour,
      }
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
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
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
      logDM({ platform: 'instagram', username, messageText: text, isOutbound: true });
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
      logDM({ platform: 'instagram', username: `thread:${threadId}`, messageText: text, isOutbound: true });
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

// Start server
const PORT = parseInt(process.env.PORT || '3100');

export function startServer(port: number = PORT): void {
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
