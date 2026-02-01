/**
 * Twitter/X DM API Server
 * REST API for DM operations - can be called from CRM server.
 */

import express, { Request, Response, NextFunction } from 'express';
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

const app = express();
app.use(cors());
app.use(express.json());

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
    }
    
    res.json({
      ...result,
      rateLimits: { messagesSentToday, messagesSentThisHour },
    });
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
  });
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
