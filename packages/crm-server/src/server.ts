/**
 * CRM Server
 * Central coordination server connecting Safari Automation, CRM DB, and MediaPoster.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { 
  initSafariClient, 
  getSafariClient,
  initCRMDatabase,
  initMediaPosterDatabase,
  isMediaPosterConfigured,
  getContacts,
  getContactByUsername,
  getMessages,
  upsertContact,
  getVideos,
  getScheduledPosts,
  getRecentlyPosted,
} from './clients/index.js';

import {
  calculateScore,
  updateScore,
  batchUpdateScores,
} from './services/scoring-service.js';

import {
  getQueue,
  queueMessage,
  removeFromQueue,
  clearQueue,
  processNextMessage,
  processAllPending,
} from './services/outreach-service.js';

import {
  syncConversations,
  syncMessages,
  fullSync,
} from './services/sync-service.js';

// Load environment
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ===== INITIALIZATION =====

function initialize() {
  // Safari Automation client
  const safariUrl = process.env.SAFARI_API_URL || 'http://localhost:3100';
  initSafariClient({ baseUrl: safariUrl });
  console.log(`[CRM] Safari client: ${safariUrl}`);
  
  // CRM Database
  const crmUrl = process.env.CRM_SUPABASE_URL || process.env.SUPABASE_URL;
  const crmKey = process.env.CRM_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  
  if (crmUrl && crmKey) {
    initCRMDatabase({ url: crmUrl, key: crmKey });
    console.log(`[CRM] CRM database connected`);
  } else {
    console.warn('[CRM] CRM database not configured');
  }
  
  // MediaPoster Database (optional)
  const mpUrl = process.env.MEDIAPOSTER_SUPABASE_URL;
  const mpKey = process.env.MEDIAPOSTER_SUPABASE_KEY;
  
  if (mpUrl && mpKey) {
    initMediaPosterDatabase({ url: mpUrl, key: mpKey });
    console.log(`[CRM] MediaPoster database connected`);
  } else {
    console.log('[CRM] MediaPoster database not configured (optional)');
  }
}

// ===== HEALTH & STATUS =====

app.get('/health', async (req: Request, res: Response) => {
  const safari = getSafariClient();
  const safariAvailable = await safari.isAvailable();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      safari: safariAvailable ? 'connected' : 'unavailable',
      crm_database: 'connected',
      mediaposter: isMediaPosterConfigured() ? 'connected' : 'not_configured',
    },
  });
});

app.get('/api/status', async (req: Request, res: Response) => {
  try {
    const safari = getSafariClient();
    const safariStatus = await safari.getStatus();
    const rateLimits = await safari.getRateLimits();
    
    res.json({
      safari: safariStatus,
      rateLimits,
      queue: {
        pending: getQueue().filter(m => m.status === 'pending').length,
        total: getQueue().length,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== CONTACTS =====

app.get('/api/contacts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const contacts = await getContacts(limit);
    res.json({ contacts, count: contacts.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/contacts/:username', async (req: Request, res: Response) => {
  try {
    const contact = await getContactByUsername(req.params.username);
    if (!contact) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    
    const messages = await getMessages(contact.id);
    res.json({ contact, messages, messageCount: messages.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/contacts', async (req: Request, res: Response) => {
  try {
    const { username, ...data } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    
    const contact = await upsertContact({
      instagram_username: username,
      relationship_score: 50,
      pipeline_stage: 'first_touch',
      fit_signals: [],
      ...data,
    });
    
    res.json({ contact });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== SCORING =====

app.get('/api/contacts/:username/score', async (req: Request, res: Response) => {
  try {
    const score = await calculateScore(req.params.username);
    if (!score) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json({ score });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/contacts/:username/score', async (req: Request, res: Response) => {
  try {
    const result = await updateScore(req.params.username);
    if (!result) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/scoring/batch', async (req: Request, res: Response) => {
  try {
    const { usernames } = req.body;
    if (!usernames || !Array.isArray(usernames)) {
      res.status(400).json({ error: 'usernames array required' });
      return;
    }
    
    const result = await batchUpdateScores(usernames);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== OUTREACH QUEUE =====

app.get('/api/outreach/queue', (req: Request, res: Response) => {
  const queue = getQueue();
  res.json({
    queue,
    stats: {
      total: queue.length,
      pending: queue.filter(m => m.status === 'pending').length,
      sent: queue.filter(m => m.status === 'sent').length,
      failed: queue.filter(m => m.status === 'failed').length,
      rateLimited: queue.filter(m => m.status === 'rate_limited').length,
    },
  });
});

app.post('/api/outreach/queue', (req: Request, res: Response) => {
  try {
    const { username, text, priority = 50, scheduled_at } = req.body;
    
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    
    const message = queueMessage({ username, text, priority, scheduled_at });
    res.json({ message, queueLength: getQueue().length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/outreach/queue/:id', (req: Request, res: Response) => {
  const removed = removeFromQueue(req.params.id);
  res.json({ removed, queueLength: getQueue().length });
});

app.delete('/api/outreach/queue', (req: Request, res: Response) => {
  const cleared = clearQueue();
  res.json({ cleared });
});

app.post('/api/outreach/process', async (req: Request, res: Response) => {
  try {
    const result = await processNextMessage();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/outreach/process-all', async (req: Request, res: Response) => {
  try {
    const result = await processAllPending();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== DIRECT DM (via Safari) =====

app.post('/api/dm/send', async (req: Request, res: Response) => {
  try {
    const { username, text } = req.body;
    
    if (!username || !text) {
      res.status(400).json({ error: 'username and text required' });
      return;
    }
    
    const safari = getSafariClient();
    const result = await safari.sendMessageTo(username, text);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/dm/conversations', async (req: Request, res: Response) => {
  try {
    const safari = getSafariClient();
    const result = await safari.getAllConversations();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== SYNC =====

app.post('/api/sync/conversations', async (req: Request, res: Response) => {
  try {
    const result = await syncConversations();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/sync/messages/:username', async (req: Request, res: Response) => {
  try {
    const result = await syncMessages(req.params.username);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/sync/full', async (req: Request, res: Response) => {
  try {
    const result = await fullSync();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== MEDIAPOSTER INTEGRATION =====

app.get('/api/mediaposter/videos', async (req: Request, res: Response) => {
  try {
    if (!isMediaPosterConfigured()) {
      res.status(503).json({ error: 'MediaPoster not configured' });
      return;
    }
    
    const limit = parseInt(req.query.limit as string) || 20;
    const videos = await getVideos(limit);
    res.json({ videos, count: videos.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/mediaposter/schedule', async (req: Request, res: Response) => {
  try {
    if (!isMediaPosterConfigured()) {
      res.status(503).json({ error: 'MediaPoster not configured' });
      return;
    }
    
    const schedule = await getScheduledPosts();
    res.json({ schedule, count: schedule.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/mediaposter/recent', async (req: Request, res: Response) => {
  try {
    if (!isMediaPosterConfigured()) {
      res.status(503).json({ error: 'MediaPoster not configured' });
      return;
    }
    
    const hours = parseInt(req.query.hours as string) || 24;
    const videos = await getRecentlyPosted(hours);
    res.json({ videos, count: videos.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ===== START SERVER =====

const PORT = parseInt(process.env.CRM_SERVER_PORT || process.env.PORT || '3200');

initialize();

app.listen(PORT, () => {
  console.log(`
🚀 CRM Server running on http://localhost:${PORT}

Endpoints:
  GET  /health                     - Health check
  GET  /api/status                 - Full status with Safari & queue

  GET  /api/contacts               - List contacts
  GET  /api/contacts/:username     - Get contact with messages
  POST /api/contacts               - Create/update contact

  GET  /api/contacts/:username/score  - Calculate score
  POST /api/contacts/:username/score  - Update score
  POST /api/scoring/batch             - Batch update scores

  GET  /api/outreach/queue         - View queue
  POST /api/outreach/queue         - Add to queue
  POST /api/outreach/process       - Process next message
  POST /api/outreach/process-all   - Process all pending

  POST /api/dm/send                - Send DM directly
  GET  /api/dm/conversations       - List Instagram convos

  POST /api/sync/conversations     - Sync contacts from Instagram
  POST /api/sync/messages/:user    - Sync messages for user
  POST /api/sync/full              - Full sync

  GET  /api/mediaposter/videos     - List videos
  GET  /api/mediaposter/schedule   - Get posting schedule
  GET  /api/mediaposter/recent     - Recent posts
`);
});

export { app };
