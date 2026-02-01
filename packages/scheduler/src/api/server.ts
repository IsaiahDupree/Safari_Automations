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
import type { Platform, TaskPriority } from '../types.js';

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

// Start server
const PORT = parseInt(process.env.SCHEDULER_PORT || process.env.PORT || '3010');

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`📅 Scheduler API running on http://localhost:${port}`);
    console.log(`   Health:    GET  /health`);
    console.log(`   Status:    GET  /api/scheduler/status`);
    console.log(`   Queue:     GET  /api/scheduler/queue`);
    console.log(`   Resources: GET  /api/resources`);
    console.log(`   Sora:      POST /api/sora/queue-trilogy`);
    console.log(`   Comments:  POST /api/comments/threads/multi`);
  });
}

// Auto-start if run directly
const isMainModule = process.argv[1]?.includes('server');
if (isMainModule) {
  startServer();
}

export { app };
