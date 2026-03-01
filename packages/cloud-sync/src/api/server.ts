/**
 * Cloud Sync API Server — port 3200
 * 
 * Provides:
 *   - Sync engine status + manual triggers
 *   - Notification/DM/PostStats queries
 *   - Cloud action queue management
 *   - Analytics + content brief
 */
import express from 'express';
import { SyncEngine } from '../sync-engine';
import { PostAnalytics } from '../analytics';
import { getCloudSupabase } from '../supabase';
import { Platform } from '../types';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3200');

// Initialize
const engine = new SyncEngine({
  platforms: (process.env.SYNC_PLATFORMS?.split(',') as Platform[]) || ['instagram', 'twitter', 'tiktok', 'threads', 'linkedin'],
  dmPollIntervalMs: parseInt(process.env.DM_POLL_MS || '30000'),
  pollIntervalMs: parseInt(process.env.NOTIF_POLL_MS || '60000'),
  statsPollIntervalMs: parseInt(process.env.STATS_POLL_MS || '300000'),
  enableActions: process.env.ENABLE_ACTIONS !== 'false',
  enableLearning: process.env.ENABLE_LEARNING !== 'false',
});
const analytics = new PostAnalytics();
const db = getCloudSupabase();

// ═══════════════════════════════════════════════════════
// HEALTH + STATUS
// ═══════════════════════════════════════════════════════

app.get('/health', async (_req, res) => {
  const health = await engine.checkHealth();
  res.json({
    status: 'ok',
    service: 'cloud-sync',
    port: PORT,
    timestamp: new Date().toISOString(),
    platformHealth: health,
    engine: engine.getStatus(),
  });
});

app.get('/api/status', async (_req, res) => {
  const [health, dashboard] = await Promise.all([
    engine.checkHealth(),
    db.getDashboardStats(),
  ]);
  res.json({
    engine: engine.getStatus(),
    health,
    dashboard,
  });
});

// ═══════════════════════════════════════════════════════
// SYNC CONTROLS
// ═══════════════════════════════════════════════════════

app.post('/api/sync/start', async (_req, res) => {
  await engine.start();
  res.json({ success: true, message: 'Sync engine started' });
});

app.post('/api/sync/stop', async (_req, res) => {
  await engine.stop();
  res.json({ success: true, message: 'Sync engine stopped' });
});

app.post('/api/sync/poll-now', async (req, res) => {
  const { platform, dataType } = req.body as { platform?: Platform; dataType?: string };
  
  let results;
  if (dataType === 'dms') {
    results = await engine.pollAllDMs();
  } else if (dataType === 'notifications') {
    results = await engine.pollAllNotifications();
  } else if (dataType === 'post_stats') {
    results = await engine.pollAllPostStats();
  } else {
    results = await engine.runAllPolls();
  }
  
  res.json({ success: true, results });
});

// ═══════════════════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════════════════

app.get('/api/notifications', async (req, res) => {
  const platform = req.query.platform as Platform | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const notifications = await db.getUnactionedNotifications(platform, limit);
  res.json({ notifications, count: notifications.length });
});

app.post('/api/notifications/:id/action', async (req, res) => {
  const { action } = req.body;
  await db.markNotificationActioned(req.params.id, action || 'acknowledged');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// DMs
// ═══════════════════════════════════════════════════════

app.get('/api/dms', async (req, res) => {
  const platform = req.query.platform as Platform | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const dms = await db.getUnrepliedDMs(platform, limit);
  res.json({ dms, count: dms.length });
});

app.post('/api/dms/:id/replied', async (req, res) => {
  await db.markDMReplied(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// POST STATS
// ═══════════════════════════════════════════════════════

app.get('/api/posts', async (req, res) => {
  const platform = req.query.platform as Platform | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const posts = await db.getPostStats(platform, limit);
  res.json({ posts, count: posts.length });
});

app.get('/api/posts/top', async (req, res) => {
  const platform = req.query.platform as Platform | undefined;
  const limit = parseInt(req.query.limit as string) || 10;
  const posts = await db.getTopPosts(platform, limit);
  res.json({ posts, count: posts.length });
});

// ═══════════════════════════════════════════════════════
// CLOUD ACTIONS
// ═══════════════════════════════════════════════════════

app.get('/api/actions/pending', async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const actions = await db.getPendingActions(limit);
  res.json({ actions, count: actions.length });
});

app.post('/api/actions/queue', async (req, res) => {
  const { platform, action_type, target_username, target_post_url, params, priority } = req.body;
  if (!platform || !action_type) {
    res.status(400).json({ error: 'platform and action_type required' });
    return;
  }
  const id = await db.queueAction({
    platform,
    action_type,
    target_username,
    target_post_url,
    params: params || {},
    priority: priority || 5,
  });
  res.json({ success: !!id, action_id: id });
});

app.post('/api/actions/process', async (_req, res) => {
  await engine.processActionQueue();
  res.json({ success: true, message: 'Action queue processed' });
});

// ═══════════════════════════════════════════════════════
// ANALYTICS + LEARNINGS
// ═══════════════════════════════════════════════════════

app.post('/api/analytics/run', async (req, res) => {
  const platform = req.body.platform as Platform | undefined;
  const result = await analytics.runAnalysis(platform);
  res.json({ success: true, ...result });
});

app.get('/api/analytics/learnings', async (req, res) => {
  const platform = req.query.platform as string | undefined;
  const learnings = await db.getActiveLearnings(platform);
  res.json({ learnings, count: learnings.length });
});

app.get('/api/analytics/brief', async (req, res) => {
  const platform = req.query.platform as Platform | undefined;
  const brief = await analytics.getContentBrief(platform);
  res.json(brief);
});

app.get('/api/analytics/dashboard', async (_req, res) => {
  const stats = await db.getDashboardStats();
  res.json(stats);
});

// ═══════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`\n☁️  Cloud Sync API running on http://localhost:${PORT}`);
  console.log(`   GET  /health`);
  console.log(`   GET  /api/status`);
  console.log(`   POST /api/sync/start`);
  console.log(`   POST /api/sync/stop`);
  console.log(`   POST /api/sync/poll-now`);
  console.log(`   GET  /api/notifications`);
  console.log(`   GET  /api/dms`);
  console.log(`   GET  /api/posts`);
  console.log(`   GET  /api/posts/top`);
  console.log(`   POST /api/actions/queue`);
  console.log(`   POST /api/analytics/run`);
  console.log(`   GET  /api/analytics/brief`);
  console.log(`   GET  /api/analytics/dashboard\n`);

  // Auto-start sync engine
  if (process.env.AUTO_START !== 'false') {
    engine.start().catch(e => console.error('Engine start error:', e));
  }
});

export { app, engine, analytics };
