/**
 * LinkedIn Automation API Server
 * REST API for connections, messaging, profile extraction, and lead scoring.
 * Port: 3105
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
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
  getUnreadCount,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { RateLimitConfig, ConnectionRequest, PeopleSearchConfig } from '../automation/types.js';

const PORT = process.env.LINKEDIN_PORT || 3105;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting state
let connectionsToday = 0;
let messagesToday = 0;
let actionsThisHour = 0;
let lastHourReset = Date.now();
let lastDayReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

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

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    platform: 'linkedin',
    status: 'running',
    port: PORT,
    uptime: process.uptime(),
    withinActiveHours: isWithinActiveHours(),
    counters: { connectionsToday, messagesToday, actionsThisHour },
  });
});

app.get('/api/linkedin/status', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
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
  try {
    const result = await navigateToNetwork();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/linkedin/navigate/messaging', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMessaging();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/linkedin/navigate/profile', async (req: Request, res: Response) => {
  try {
    const { profileUrl } = req.body;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
    const result = await navigateToProfile(profileUrl);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Profile Extraction ──────────────────────────────────────

app.get('/api/linkedin/profile/:username', async (req: Request, res: Response) => {
  try {
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const profile = await extractProfile(req.params.username);
    if (!profile) return res.status(404).json({ error: 'Could not extract profile' });
    res.json(profile);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
  try {
    const profileUrl = req.query.profileUrl as string;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl query param required' });
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const status = await getConnectionStatus(profileUrl);
    res.json(status);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/connections/request', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (connectionsToday >= rateLimits.connectionRequestsPerDay) {
      return res.status(429).json({ error: 'Daily connection request limit reached', limit: rateLimits.connectionRequestsPerDay });
    }
    if (!isWithinActiveHours()) {
      return res.status(403).json({ error: 'Outside active hours', activeHours: `${rateLimits.activeHoursStart}-${rateLimits.activeHoursEnd}` });
    }

    const request: ConnectionRequest = {
      profileUrl: req.body.profileUrl,
      note: req.body.note,
      skipIfConnected: req.body.skipIfConnected !== false,
      skipIfPending: req.body.skipIfPending !== false,
    };

    if (!request.profileUrl) return res.status(400).json({ error: 'profileUrl required' });

    const result = await sendConnectionRequest(request);
    if (result.success && result.status === 'sent') connectionsToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/connections/pending', async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as 'sent' | 'received') || 'received';
    const requests = await listPendingRequests(type);
    res.json({ requests, count: requests.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/connections/accept', async (req: Request, res: Response) => {
  try {
    const { profileUrl } = req.body;
    if (!profileUrl) return res.status(400).json({ error: 'profileUrl required' });
    const accepted = await acceptRequest(profileUrl);
    res.json({ success: accepted });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Search ──────────────────────────────────────────────────

app.post('/api/linkedin/search/people', async (req: Request, res: Response) => {
  try {
    if (!checkHourlyLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const config: Partial<PeopleSearchConfig> = req.body;
    const results = await searchPeople(config);
    res.json({ results, count: results.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Messages ────────────────────────────────────────────────

app.get('/api/linkedin/conversations', async (_req: Request, res: Response) => {
  try {
    const nav = await navigateToMessaging();
    if (!nav.success) return res.status(500).json(nav);
    const convos = await listConversations();
    res.json({ conversations: convos, count: convos.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const msgs = await readMessages(limit);
    res.json({ messages: msgs, count: msgs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/linkedin/messages/unread', async (_req: Request, res: Response) => {
  try {
    const count = await getUnreadCount();
    res.json({ unreadCount: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/open', async (req: Request, res: Response) => {
  try {
    const { participantName } = req.body;
    if (!participantName) return res.status(400).json({ error: 'participantName required' });
    const opened = await openConversation(participantName);
    res.json({ success: opened });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/send', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (messagesToday >= rateLimits.messagesPerDay) {
      return res.status(429).json({ error: 'Daily message limit reached' });
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const result = await sendMessage(text);
    if (result.success) messagesToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/linkedin/messages/send-to', async (req: Request, res: Response) => {
  try {
    resetCountersIfNeeded();
    if (messagesToday >= rateLimits.messagesPerDay) {
      return res.status(429).json({ error: 'Daily message limit reached' });
    }
    const { profileUrl, text } = req.body;
    if (!profileUrl || !text) return res.status(400).json({ error: 'profileUrl and text required' });
    const result = await sendMessageToProfile(profileUrl, text);
    if (result.success) messagesToday++;
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
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
    });

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    res.json({
      text: text || `Hi ${profile.name?.split(' ')[0]}, would love to connect!`,
      confidence: text ? 0.85 : 0.3,
      aiGenerated: !!text,
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
  console.log(`   Rate limits: connections ${rateLimits.connectionRequestsPerDay}/day, messages ${rateLimits.messagesPerDay}/day`);
  console.log(`   Active hours: ${rateLimits.activeHoursStart}:00 - ${rateLimits.activeHoursEnd}:00`);
  console.log('');
});

export default app;
