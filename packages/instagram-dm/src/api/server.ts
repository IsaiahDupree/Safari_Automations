/**
 * Instagram DM API Server
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
  getAllConversations,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { DMTab, RateLimitConfig } from '../automation/types.js';

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
