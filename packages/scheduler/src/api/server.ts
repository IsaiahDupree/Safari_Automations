/**
 * Safari Task Scheduler REST API
 * 
 * Provides HTTP endpoints for managing scheduled tasks, checking resources,
 * and controlling the scheduler daemon.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { TaskScheduler } from '../task-scheduler.js';
import { SoraCreditMonitor } from '../sora-credit-monitor.js';
import type { Platform, TaskPriority, TaskType } from '../types.js';

const app = express();
app.use(cors());
app.use(express.json());

// Singleton scheduler instance
let scheduler: TaskScheduler | null = null;
const soraMonitor = new SoraCreditMonitor();

function getScheduler(): TaskScheduler {
  if (!scheduler) {
    scheduler = new TaskScheduler({
      persistPath: '/Users/isaiahdupree/sora-videos/scheduler-state.json',
      checkIntervalMs: 10000,
      enableSoraMonitor: true,
    });
  }
  return scheduler;
}

// === HEALTH ===

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'scheduler',
    timestamp: new Date().toISOString(),
  });
});

// === SCHEDULER STATUS ===

app.get('/api/scheduler/status', (req: Request, res: Response) => {
  const s = getScheduler();
  const status = s.getStatus();
  res.json(status);
});

app.post('/api/scheduler/start', (req: Request, res: Response) => {
  const s = getScheduler();
  s.start();
  res.json({ success: true, message: 'Scheduler started' });
});

app.post('/api/scheduler/stop', (req: Request, res: Response) => {
  const s = getScheduler();
  s.stop();
  res.json({ success: true, message: 'Scheduler stopped' });
});

app.post('/api/scheduler/pause', (req: Request, res: Response) => {
  const s = getScheduler();
  s.pause();
  res.json({ success: true, message: 'Scheduler paused' });
});

app.post('/api/scheduler/resume', (req: Request, res: Response) => {
  const s = getScheduler();
  s.resume();
  res.json({ success: true, message: 'Scheduler resumed' });
});

// === TASK QUEUE ===

app.get('/api/scheduler/queue', (req: Request, res: Response) => {
  const s = getScheduler();
  res.json({
    queue: s.getQueue(),
    running: s.getRunning(),
  });
});

app.get('/api/scheduler/completed', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const s = getScheduler();
  res.json({
    completed: s.getCompleted(limit),
  });
});

// === TASK MANAGEMENT ===

app.post('/api/scheduler/task', (req: Request, res: Response) => {
  try {
    const { type, name, platform, priority, scheduledFor, payload } = req.body;
    
    if (!type || !name) {
      res.status(400).json({ error: 'type and name are required' });
      return;
    }
    
    const s = getScheduler();
    const taskId = s.schedule({
      type,
      name,
      platform,
      priority: priority || 3,
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      payload: payload || {},
    });
    
    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.delete('/api/scheduler/task/:id', (req: Request, res: Response) => {
  const s = getScheduler();
  const success = s.cancel(req.params.id);
  res.json({ success });
});

// === SORA ===

app.get('/api/resources/sora', async (req: Request, res: Response) => {
  try {
    const credits = await soraMonitor.checkCredits();
    res.json({
      credits,
      timeUntilRefresh: soraMonitor.getTimeUntilRefresh(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/sora/queue-trilogy', (req: Request, res: Response) => {
  try {
    const { trilogyId, trilogyName, waitForCredits, priority } = req.body;
    
    if (!trilogyId) {
      res.status(400).json({ error: 'trilogyId is required' });
      return;
    }
    
    const s = getScheduler();
    const taskId = s.scheduleSoraTrilogy(
      trilogyId,
      trilogyName || trilogyId,
      {
        priority: (priority || 2) as TaskPriority,
        waitForCredits: waitForCredits || 3,
      }
    );
    
    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === THREADS COMMENTING ===

app.post('/api/threads/schedule', async (req: Request, res: Response) => {
  try {
    const { count, interval, startTime, priority } = req.body;
    
    const s = getScheduler();
    const taskId = s.schedule({
      type: 'comment',
      name: `Threads commenting session (${count || 5} comments)`,
      platform: 'threads' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      payload: {
        count: count || 5,
        intervalMs: (interval || 30) * 1000, // Default 30 seconds between comments
        useAI: true,
      },
    });
    
    res.json({ success: true, taskId, message: `Scheduled ${count || 5} Threads comments` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === INSTAGRAM COMMENTING ===

app.post('/api/instagram/schedule', async (req: Request, res: Response) => {
  try {
    const { count, interval, keyword, startTime, priority } = req.body;
    
    const s = getScheduler();
    const taskId = s.schedule({
      type: 'comment',
      name: `Instagram commenting${keyword ? ` (#${keyword})` : ''} (${count || 5} comments)`,
      platform: 'instagram' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      payload: {
        count: count || 5,
        intervalMs: (interval || 30) * 1000,
        keyword,
        useAI: true,
      },
    });
    
    res.json({ success: true, taskId, message: `Scheduled ${count || 5} Instagram comments` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === SORA AUTO-GENERATION ===

app.post('/api/sora/auto-generate', async (req: Request, res: Response) => {
  try {
    const { theme, creditsRequired, priority } = req.body;
    
    if (!theme) {
      res.status(400).json({ error: 'theme is required' });
      return;
    }
    
    // Check current credits
    const credits = await soraMonitor.checkCredits();
    const needed = creditsRequired || 3;
    
    if (credits && credits.totalCredits >= needed) {
      // Have credits - schedule immediately
      const s = getScheduler();
      const taskId = s.schedule({
        type: 'sora',
        name: `Sora trilogy: ${theme}`,
        platform: 'sora' as Platform,
        priority: (priority || 1) as TaskPriority,
        scheduledFor: new Date(),
        payload: { theme, useAI: true, creditsRequired: needed },
      });
      
      res.json({ 
        success: true, 
        taskId, 
        immediate: true,
        credits: credits.totalCredits,
        message: `Scheduled immediately - ${credits.totalCredits} credits available` 
      });
    } else {
      // No credits - register callback for when credits are available
      const s = getScheduler();
      const taskId = s.schedule({
        type: 'sora',
        name: `Sora trilogy (waiting for credits): ${theme}`,
        platform: 'sora' as Platform,
        priority: (priority || 1) as TaskPriority,
        scheduledFor: new Date(Date.now() + 24 * 60 * 60 * 1000), // Schedule for tomorrow
        payload: { theme, useAI: true, creditsRequired: needed, waitingForCredits: true },
      });
      
      // Register callback
      soraMonitor.onCreditsAvailable(needed, () => {
        console.log(`[SORA] Credits available! Auto-generating: ${theme}`);
      });
      
      res.json({ 
        success: true, 
        taskId, 
        immediate: false,
        currentCredits: credits?.totalCredits || 0,
        waitingFor: needed,
        timeUntilRefresh: soraMonitor.getTimeUntilRefresh(),
        message: `Queued - waiting for ${needed} credits (currently ${credits?.totalCredits || 0})` 
      });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === DM SESSIONS ===

app.post('/api/dm/schedule', (req: Request, res: Response) => {
  try {
    const { platform, duration, startTime, priority } = req.body;
    
    if (!platform || !['tiktok', 'instagram', 'twitter'].includes(platform)) {
      res.status(400).json({ error: 'Valid platform required: tiktok, instagram, twitter' });
      return;
    }
    
    const s = getScheduler();
    const taskId = s.scheduleDMSession(platform as Platform, {
      priority: (priority || 3) as TaskPriority,
      duration: (duration || 60) * 60 * 1000,
      startTime: startTime ? new Date(startTime) : undefined,
    });
    
    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === RESOURCES OVERVIEW ===

app.get('/api/resources', async (req: Request, res: Response) => {
  try {
    const credits = await soraMonitor.checkCredits();
    const s = getScheduler();
    const status = s.getStatus();
    
    res.json({
      sora: {
        credits,
        timeUntilRefresh: soraMonitor.getTimeUntilRefresh(),
      },
      scheduler: {
        isRunning: status.isRunning,
        tasksInQueue: status.tasksInQueue,
        tasksRunning: status.tasksRunning,
      },
      platforms: status.platforms,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === COMMENT AUTOMATION ===

app.post('/api/comments/threads/multi', async (req: Request, res: Response) => {
  try {
    const { count = 5, delayBetween = 30000, useAI = true } = req.body;
    
    // Forward to Threads comments API
    const response = await fetch('http://localhost:3004/api/threads/engage/multi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, delayBetween, useAI }),
    });
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/comments/status', async (req: Request, res: Response) => {
  try {
    const platforms = [
      { name: 'threads', port: 3004 },
      { name: 'instagram', port: 3005 },
      { name: 'tiktok', port: 3006 },
      { name: 'twitter', port: 3007 },
    ];
    
    const results = await Promise.all(
      platforms.map(async (p) => {
        try {
          const response = await fetch(`http://localhost:${p.port}/api/${p.name}/status`, {
            signal: AbortSignal.timeout(2000),
          });
          const data = await response.json();
          return { platform: p.name, port: p.port, online: true, ...data };
        } catch {
          return { platform: p.name, port: p.port, online: false };
        }
      })
    );
    
    res.json({ platforms: results });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === DAILY CONTENT PUBLISHING ===

app.post('/api/publish/daily', (req: Request, res: Response) => {
  try {
    const { count = 4, platform = 'youtube', startTime, priority } = req.body;
    
    const s = getScheduler();
    const taskId = s.schedule({
      type: 'publish' as TaskType,
      name: `Daily Content Pipeline: ${count} videos → ${platform}`,
      platform: platform as Platform,
      priority: (priority || 2) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      payload: { count, platform },
    });
    
    res.json({ 
      success: true, 
      taskId, 
      message: `Scheduled daily publish: ${count} videos to ${platform}` 
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/publish/daily/recurring', (req: Request, res: Response) => {
  try {
    const { 
      count = 4, 
      platform = 'youtube', 
      hour = 10,
      days = 7,
      priority = 2 
    } = req.body;
    
    const s = getScheduler();
    const taskIds: string[] = [];
    
    for (let d = 0; d < days; d++) {
      const scheduledFor = new Date();
      scheduledFor.setDate(scheduledFor.getDate() + d);
      scheduledFor.setHours(hour, 0, 0, 0);
      
      // Skip if time has passed today
      if (d === 0 && scheduledFor < new Date()) {
        scheduledFor.setDate(scheduledFor.getDate() + 1);
      }
      
      const taskId = s.schedule({
        type: 'publish' as TaskType,
        name: `Daily Publish (Day ${d + 1}): ${count} videos → ${platform}`,
        platform: platform as Platform,
        priority: priority as TaskPriority,
        scheduledFor,
        payload: { count, platform, dayNumber: d + 1 },
      });
      taskIds.push(taskId);
    }
    
    res.json({ 
      success: true, 
      taskIds, 
      message: `Scheduled ${days} days of daily publishing: ${count} videos/day to ${platform} at ${hour}:00` 
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === SORA CONTENT GENERATION ===

app.post('/api/sora/generate', (req: Request, res: Response) => {
  try {
    const { mode = 'mix', count = 5, generate = true, startTime, priority } = req.body;

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'sora-generate' as TaskType,
      name: `Sora Content Gen: ${count} ${mode} videos`,
      platform: 'sora' as Platform,
      priority: (priority || 2) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      resourceRequirements: { soraCredits: count, safariExclusive: true },
      payload: { mode, count, generate },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled Sora content generation: ${count} ${mode} videos${generate ? ' + Safari generation' : ' (prompts only)'}`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === SORA DAILY PIPELINE (full: generate → catalog → queue → drain) ===

app.post('/api/sora/daily-pipeline', (req: Request, res: Response) => {
  try {
    const {
      mode = 'mix', count = 6, queueCount = 4, platforms = 'youtube',
      skipGenerate = false, skipDrain = false, generateOnly = false, drainOnly = false,
      startTime, priority,
    } = req.body;

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'sora-daily-pipeline' as TaskType,
      name: `Sora Daily Pipeline: ${mode} × ${count} → ${platforms}`,
      platform: 'sora' as Platform,
      priority: (priority || 2) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      resourceRequirements: { soraCredits: skipGenerate || drainOnly ? 0 : count, safariExclusive: !skipGenerate && !drainOnly },
      payload: { mode, count, queueCount, platforms, skipGenerate, skipDrain, generateOnly, drainOnly },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled Sora Daily Pipeline: ${mode} × ${count}, queue ${queueCount} to ${platforms}`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Schedule recurring daily pipeline
app.post('/api/sora/daily-pipeline/recurring', (req: Request, res: Response) => {
  try {
    const {
      mode = 'mix', count = 6, queueCount = 4, platforms = 'youtube',
      hour = 10, days = 7, skipGenerate = false, priority,
    } = req.body;

    const s = getScheduler();
    const taskIds: string[] = [];

    for (let d = 0; d < days; d++) {
      const runAt = new Date();
      runAt.setDate(runAt.getDate() + d);
      runAt.setHours(hour, 0, 0, 0);
      if (runAt <= new Date()) continue;

      const taskId = s.schedule({
        type: 'sora-daily-pipeline' as TaskType,
        name: `Daily Pipeline Day ${d + 1}: ${mode} × ${count}`,
        platform: 'sora' as Platform,
        priority: (priority || 2) as TaskPriority,
        scheduledFor: runAt,
        resourceRequirements: { soraCredits: skipGenerate ? 0 : count, safariExclusive: !skipGenerate },
        payload: { mode, count, queueCount, platforms, skipGenerate },
      });
      taskIds.push(taskId);
    }

    res.json({
      success: true,
      taskIds,
      message: `Scheduled ${taskIds.length} daily pipeline runs at ${hour}:00 for ${days} days`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === QUEUE DRAIN ===

app.post('/api/queue/drain', (req: Request, res: Response) => {
  try {
    const {
      maxPublished = 10, maxRounds = 15, wait = 120, batchSize = 4,
      persistent = false, startTime, priority,
    } = req.body;

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'queue-drain' as TaskType,
      name: `Queue Drain: max ${maxPublished} publishes`,
      platform: 'youtube' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: startTime ? new Date(startTime) : new Date(),
      resourceRequirements: { safariExclusive: false },
      payload: { maxPublished, maxRounds, wait, batchSize, persistent },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled queue drain: max ${maxPublished} publishes, ${maxRounds} rounds`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Schedule recurring queue drain (e.g., every 2 hours)
app.post('/api/queue/drain/recurring', (req: Request, res: Response) => {
  try {
    const {
      maxPublished = 5, intervalHours = 2, times = 6, batchSize = 4, priority,
    } = req.body;

    const s = getScheduler();
    const taskIds: string[] = [];

    for (let i = 0; i < times; i++) {
      const runAt = new Date();
      runAt.setTime(runAt.getTime() + i * intervalHours * 60 * 60 * 1000);
      if (i === 0) runAt.setTime(runAt.getTime() + 5 * 60 * 1000); // 5min offset for first

      const taskId = s.schedule({
        type: 'queue-drain' as TaskType,
        name: `Queue Drain #${i + 1}: max ${maxPublished}`,
        platform: 'youtube' as Platform,
        priority: (priority || 3) as TaskPriority,
        scheduledFor: runAt,
        resourceRequirements: { safariExclusive: false },
        payload: { maxPublished, maxRounds: 10, wait: 120, batchSize },
      });
      taskIds.push(taskId);
    }

    res.json({
      success: true,
      taskIds,
      message: `Scheduled ${taskIds.length} queue drains every ${intervalHours}h`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === MARKET RESEARCH ===

app.post('/api/research/daily', (req: Request, res: Response) => {
  try {
    const { maxAds = 30, skipScrape = false, priority, scheduledFor } = req.body;
    const s = getScheduler();
    const runAt = scheduledFor ? new Date(scheduledFor) : new Date();
    const taskId = s.schedule({
      type: 'daily-research' as TaskType,
      name: 'Daily Market Research Pipeline',
      priority: (priority || 3) as TaskPriority,
      scheduledFor: runAt,
      resourceRequirements: { safariExclusive: true },
      payload: { maxAds, skipScrape },
    });
    res.json({ success: true, taskId, scheduledFor: runAt.toISOString() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/research/daily/recurring', (req: Request, res: Response) => {
  try {
    const { days = 7, hour = 8, maxAds = 30 } = req.body;
    const s = getScheduler();
    const taskIds: string[] = [];
    for (let i = 0; i < days; i++) {
      const runAt = new Date();
      runAt.setDate(runAt.getDate() + i);
      runAt.setHours(hour, 0, 0, 0);
      if (runAt > new Date()) {
        const taskId = s.schedule({
          type: 'daily-research' as TaskType,
          name: `Daily Research — Day ${i + 1}`,
          priority: 3 as TaskPriority,
          scheduledFor: runAt,
          resourceRequirements: { safariExclusive: true },
          payload: { maxAds },
        });
        taskIds.push(taskId);
      }
    }
    res.json({ success: true, taskIds, message: `Scheduled ${taskIds.length} daily research runs at ${hour}:00` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/research/ad-library', (req: Request, res: Response) => {
  try {
    const {
      keywords, maxAds = 30, downloadTop = 5,
      country = 'US', allStatus = false, priority, scheduledFor,
    } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array is required' });
    }

    const s = getScheduler();
    const runAt = scheduledFor ? new Date(scheduledFor) : new Date();

    const taskId = s.schedule({
      type: 'meta-ad-library' as TaskType,
      name: `Ad Library: ${keywords.join(', ').substring(0, 50)}`,
      platform: 'instagram' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: runAt,
      resourceRequirements: { safariExclusive: true },
      payload: { keywords, maxAds, downloadTop, country, allStatus },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled Meta Ad Library research for: ${keywords.join(', ')}`,
      keywords,
      scheduledFor: runAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/research/facebook/search', (req: Request, res: Response) => {
  try {
    const {
      keywords, maxPosts = 50, downloadTop = 10,
      searchType = 'posts', dateFilter, priority, scheduledFor,
    } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array is required' });
    }

    const s = getScheduler();
    const runAt = scheduledFor ? new Date(scheduledFor) : new Date();

    const taskId = s.schedule({
      type: 'market-research' as TaskType,
      name: `FB Research: ${keywords.join(', ').substring(0, 50)}`,
      platform: 'instagram' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: runAt,
      resourceRequirements: { safariExclusive: true },
      payload: { keywords, maxPosts, downloadTop, searchType, dateFilter },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled Facebook research for: ${keywords.join(', ')}`,
      keywords,
      scheduledFor: runAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/research/instagram/search', (req: Request, res: Response) => {
  try {
    const {
      keywords, maxPosts = 50, downloadTop = 10,
      searchType = 'hashtag', detail = false, priority, scheduledFor,
    } = req.body;

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ error: 'keywords array is required' });
    }

    const s = getScheduler();
    const runAt = scheduledFor ? new Date(scheduledFor) : new Date();

    const taskId = s.schedule({
      type: 'market-research-instagram' as TaskType,
      name: `IG Research: ${keywords.join(', ').substring(0, 50)}`,
      platform: 'instagram' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: runAt,
      resourceRequirements: { safariExclusive: true },
      payload: { keywords, maxPosts, downloadTop, searchType, detail },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled Instagram research for: ${keywords.join(', ')}`,
      keywords,
      scheduledFor: runAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/research/ad-brief', (req: Request, res: Response) => {
  try {
    const {
      keyword, product, platform = 'facebook',
      skipScrape = false, priority, scheduledFor,
    } = req.body;

    if (!keyword) return res.status(400).json({ error: 'keyword is required' });
    if (!product) return res.status(400).json({ error: 'product is required' });

    const s = getScheduler();
    const runAt = scheduledFor ? new Date(scheduledFor) : new Date();

    const taskId = s.schedule({
      type: 'ad-brief' as TaskType,
      name: `Ad Brief: ${product} × "${keyword}"`,
      platform: 'instagram' as Platform,
      priority: (priority || 3) as TaskPriority,
      scheduledFor: runAt,
      resourceRequirements: { safariExclusive: false },
      payload: { keyword, product, platform, skipScrape },
    });

    res.json({
      success: true,
      taskId,
      message: `Scheduled ad brief: ${product} × "${keyword}"`,
      scheduledFor: runAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/research/status', async (req: Request, res: Response) => {
  try {
    const { execSync } = await import('child_process');
    const result = execSync(
      'python3 python/market_research/run_facebook.py status',
      { cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation', encoding: 'utf8', timeout: 10000 }
    );
    const s = getScheduler();
    const researchTasks = s.getQueue().filter(t =>
      ['market-research', 'market-research-instagram', 'ad-brief'].includes(t.type)
    );
    res.json({
      status: result,
      pendingTasks: researchTasks.length,
      tasks: researchTasks.map(t => ({ id: t.id, name: t.name, type: t.type, scheduledFor: t.scheduledFor })),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/publish/status', async (req: Request, res: Response) => {
  try {
    // Check MediaPoster backend publishing status
    const backendResponse = await fetch('http://localhost:5555/api/publish-controls/status', {
      signal: AbortSignal.timeout(3000),
    });
    const backendStatus = await backendResponse.json();
    
    // Get local scheduler publish tasks
    const s = getScheduler();
    const queue = s.getQueue().filter(t => t.type === 'publish');
    const completed = s.getCompleted(10).filter(t => t.type === 'publish');
    
    res.json({
      backend: backendStatus,
      scheduler: {
        pendingPublishTasks: queue.length,
        recentPublishTasks: completed.length,
        queue: queue.map(t => ({ id: t.id, name: t.name, scheduledFor: t.scheduledFor, status: t.status })),
        recent: completed.map(t => ({ id: t.id, name: t.name, completedAt: t.completedAt, status: t.status })),
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === UPWORK JOB SCANNING ===

app.post('/api/upwork/scan', (req: Request, res: Response) => {
  try {
    const {
      keywords = ['TypeScript', 'React'],
      preferredSkills = ['TypeScript', 'React', 'Node.js', 'Python'],
      minBudget = 500,
      availableConnects = 100,
      tab,
      filters = {},
      priority = 2,
    } = req.body;

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'upwork-job-scan' as TaskType,
      name: `Upwork Scan: ${tab || keywords.join(', ')}`,
      platform: 'upwork' as Platform,
      priority: priority as TaskPriority,
      resourceRequirements: { platform: 'upwork' as Platform, safariExclusive: true },
      payload: { keywords, preferredSkills, minBudget, availableConnects, tab, filters },
    });

    res.json({ success: true, taskId, message: `Upwork job scan scheduled` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/upwork/scan/recurring', (req: Request, res: Response) => {
  try {
    const {
      keywords = ['TypeScript', 'React'],
      preferredSkills = ['TypeScript', 'React', 'Node.js', 'Python'],
      minBudget = 500,
      availableConnects = 100,
      tab,
      filters = {},
      intervalHours = 4,
      count = 6,
      priority = 3,
    } = req.body;

    const s = getScheduler();
    const taskIds: string[] = [];

    for (let i = 0; i < count; i++) {
      const scheduledFor = new Date(Date.now() + i * intervalHours * 60 * 60 * 1000);
      const taskId = s.schedule({
        type: 'upwork-job-scan' as TaskType,
        name: `Upwork Scan #${i + 1}: ${tab || keywords.join(', ')}`,
        platform: 'upwork' as Platform,
        priority: priority as TaskPriority,
        scheduledFor,
        resourceRequirements: { platform: 'upwork' as Platform, safariExclusive: true },
        payload: { keywords, preferredSkills, minBudget, availableConnects, tab, filters },
      });
      taskIds.push(taskId);
    }

    res.json({
      success: true,
      taskIds,
      message: `Scheduled ${count} Upwork scans every ${intervalHours}h`,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/upwork/apply', (req: Request, res: Response) => {
  try {
    const { jobUrl, highlightSkills, customInstructions, priority = 2 } = req.body;
    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'upwork-apply' as TaskType,
      name: `Upwork Apply: ${jobUrl.substring(0, 50)}`,
      platform: 'upwork' as Platform,
      priority: priority as TaskPriority,
      resourceRequirements: { platform: 'upwork' as Platform, safariExclusive: true },
      payload: { jobUrl, highlightSkills, customInstructions },
    });

    res.json({ success: true, taskId, message: `Upwork apply task scheduled` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === UPWORK MONITOR ===

app.post('/api/upwork/monitor', (req: Request, res: Response) => {
  try {
    const { priority = 2 } = req.body;
    const s = getScheduler();
    const taskId = s.schedule({
      type: 'upwork-monitor-scan' as TaskType,
      name: 'Upwork Monitor Scan',
      platform: 'upwork' as Platform,
      priority: priority as TaskPriority,
      resourceRequirements: { platform: 'upwork' as Platform, safariExclusive: true },
      payload: {},
    });
    res.json({ success: true, taskId, message: 'Upwork monitor scan scheduled' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/upwork/monitor/recurring', (req: Request, res: Response) => {
  try {
    const { intervalHours = 3, count = 8, priority = 3 } = req.body;
    const s = getScheduler();
    const taskIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const scheduledFor = new Date(Date.now() + i * intervalHours * 60 * 60 * 1000);
      const taskId = s.schedule({
        type: 'upwork-monitor-scan' as TaskType,
        name: `Upwork Monitor #${i + 1}`,
        platform: 'upwork' as Platform,
        priority: priority as TaskPriority,
        scheduledFor,
        resourceRequirements: { platform: 'upwork' as Platform, safariExclusive: true },
        payload: {},
      });
      taskIds.push(taskId);
    }
    res.json({ success: true, taskIds, message: `Scheduled ${count} monitor scans every ${intervalHours}h` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === LINKEDIN PROSPECT ===

app.post('/api/linkedin/prospect', (req: Request, res: Response) => {
  try {
    const { search, targetTitles, targetLocations, minScore, maxProspects, dryRun, noteTemplate, sendConnections, sendDMs, priority = 2 } = req.body;
    const s = getScheduler();
    const taskId = s.schedule({
      type: 'linkedin-prospect' as TaskType,
      name: `LinkedIn Prospect: ${search?.keywords?.[0] || 'default'}`,
      platform: 'linkedin' as Platform,
      priority: priority as TaskPriority,
      resourceRequirements: { platform: 'linkedin' as Platform, safariExclusive: true },
      payload: { search, targetTitles, targetLocations, minScore, maxProspects, dryRun, noteTemplate, sendConnections, sendDMs },
    });
    res.json({ success: true, taskId, message: 'LinkedIn prospect pipeline scheduled' });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/linkedin/prospect/recurring', (req: Request, res: Response) => {
  try {
    const { search, targetTitles, targetLocations, minScore, maxProspects, dryRun = true, noteTemplate, sendConnections, sendDMs, intervalHours = 8, count = 3, priority = 3 } = req.body;
    const s = getScheduler();
    const taskIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const scheduledFor = new Date(Date.now() + i * intervalHours * 60 * 60 * 1000);
      const taskId = s.schedule({
        type: 'linkedin-prospect' as TaskType,
        name: `LinkedIn Prospect #${i + 1}`,
        platform: 'linkedin' as Platform,
        priority: priority as TaskPriority,
        scheduledFor,
        resourceRequirements: { platform: 'linkedin' as Platform, safariExclusive: true },
        payload: { search, targetTitles, targetLocations, minScore, maxProspects, dryRun, noteTemplate, sendConnections, sendDMs },
      });
      taskIds.push(taskId);
    }
    res.json({ success: true, taskIds, message: `Scheduled ${count} LinkedIn prospect runs every ${intervalHours}h` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === LINKEDIN OUTREACH ===

app.post('/api/linkedin/outreach', (req: Request, res: Response) => {
  try {
    const { action = 'search', searchConfig, profileUrl, note, priority = 3 } = req.body;

    const s = getScheduler();
    const taskId = s.schedule({
      type: 'linkedin-outreach' as TaskType,
      name: `LinkedIn ${action}`,
      platform: 'linkedin' as Platform,
      priority: priority as TaskPriority,
      resourceRequirements: { platform: 'linkedin' as Platform, safariExclusive: true },
      payload: { action, searchConfig, profileUrl, note },
    });

    res.json({ success: true, taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === CONTENT PACKAGING ===

app.post('/api/content/package', async (req: Request, res: Response) => {
  try {
    const { platforms, keywords, minEngagement, topN = 50, formats, sendTo } = req.body;

    // Dynamically import the packager (cross-package, resolved at runtime)
    const packagerPath = require('path').resolve(__dirname, '..', '..', '..', '..', 'content-packager', 'src', 'packager.ts');
    const { packageResearchData, enrichWithAdBriefs, saveBatch } = await import(packagerPath);

    let batch = packageResearchData({
      platforms: platforms || ['facebook', 'instagram', 'meta_ad_library'],
      keywords,
      minEngagementScore: minEngagement || 0,
      topN,
      contentFormats: formats,
    });

    batch = enrichWithAdBriefs(batch);
    const outputFile = saveBatch(batch);

    let sendResult = null;
    if (sendTo) {
      try {
        const resp = await fetch(`${sendTo}/api/packages/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
        });
        sendResult = { sent: true, status: resp.status, ok: resp.ok };
      } catch (e: any) {
        sendResult = { sent: false, error: e.message };
      }
    }

    res.json({
      success: true,
      batchId: batch.id,
      totalPackages: batch.summary.totalPackages,
      byPlatform: batch.summary.byPlatform,
      topPerformers: batch.summary.topPerformers,
      outputFile,
      sendResult,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/content/package/send', async (req: Request, res: Response) => {
  try {
    const { batchFile, serverUrl } = req.body;
    if (!batchFile || !serverUrl) {
      return res.status(400).json({ error: 'batchFile and serverUrl required' });
    }

    const fs = await import('fs');
    const batch = JSON.parse(fs.readFileSync(batchFile, 'utf-8'));

    const resp = await fetch(`${serverUrl}/api/packages/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });

    res.json({
      success: resp.ok,
      status: resp.status,
      batchId: batch.id,
      packageCount: batch.packages?.length || 0,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Start server
const PORT = parseInt(process.env.SCHEDULER_PORT || process.env.PORT || '3010');

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`📅 Scheduler API running on http://localhost:${port}`);
    console.log(`   Health:      GET  /health`);
    console.log(`   Status:      GET  /api/scheduler/status`);
    console.log(`   Queue:       GET  /api/scheduler/queue`);
    console.log(`   Resources:   GET  /api/resources`);
    console.log(`   Sora:        POST /api/sora/queue-trilogy`);
    console.log(`   SoraGen:     POST /api/sora/generate`);
    console.log(`   Pipeline:    POST /api/sora/daily-pipeline`);
    console.log(`   PipeRecur:   POST /api/sora/daily-pipeline/recurring`);
    console.log(`   Drain:       POST /api/queue/drain`);
    console.log(`   DrainRecur:  POST /api/queue/drain/recurring`);
    console.log(`   Comments:    POST /api/comments/threads/multi`);
    console.log(`   Publish:     POST /api/publish/daily`);
    console.log(`   Recurring:   POST /api/publish/daily/recurring`);
    console.log(`   PubStatus:   GET  /api/publish/status`);
    console.log(`   DailyRes:    POST /api/research/daily`);
    console.log(`   DailyRecur:  POST /api/research/daily/recurring`);
    console.log(`   AdLibrary:   POST /api/research/ad-library`);
    console.log(`   FBResearch:  POST /api/research/facebook/search`);
    console.log(`   IGResearch:  POST /api/research/instagram/search`);
    console.log(`   AdBrief:     POST /api/research/ad-brief`);
    console.log(`   ResStatus:   GET  /api/research/status`);
    console.log(`   UpworkScan:  POST /api/upwork/scan`);
    console.log(`   UpworkRecur: POST /api/upwork/scan/recurring`);
    console.log(`   UpworkApply: POST /api/upwork/apply`);
    console.log(`   Monitor:     POST /api/upwork/monitor`);
    console.log(`   MonRecur:    POST /api/upwork/monitor/recurring`);
    console.log(`   Prospect:    POST /api/linkedin/prospect`);
    console.log(`   ProsRecur:   POST /api/linkedin/prospect/recurring`);
    console.log(`   LinkedIn:    POST /api/linkedin/outreach`);
    console.log(`   ContentPkg:  POST /api/content/package`);
    console.log(`   ContentSend: POST /api/content/package/send`);
  });
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
