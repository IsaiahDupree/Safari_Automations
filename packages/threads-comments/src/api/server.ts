/**
 * Threads Comment API Server
 * 
 * REST API for Threads comment automation via Safari.
 * Port: 3004
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { ThreadsDriver, DEFAULT_CONFIG, type ThreadsConfig } from '../automation/threads-driver.js';
import { ThreadsAutoCommenter } from '../automation/threads-auto-commenter.js';
import { ThreadsAICommentGenerator } from '../automation/ai-comment-generator.js';
import { CommentLogger } from '../db/comment-logger.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.THREADS_COMMENTS_PORT || process.env.PORT || '3004');

// Singleton driver
let driver: ThreadsDriver | null = null;

function getDriver(): ThreadsDriver {
  if (!driver) {
    driver = new ThreadsDriver();
  }
  return driver;
}

// === HEALTH ===

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'threads-comments',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

// === STATUS ===

app.get('/api/threads/status', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const status = await d.getStatus();
    const rateLimits = d.getRateLimits();
    
    res.json({
      ...status,
      commentsThisHour: rateLimits.commentsThisHour,
      commentsToday: rateLimits.commentsToday,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === RATE LIMITS ===

app.get('/api/threads/rate-limits', (req: Request, res: Response) => {
  const d = getDriver();
  const limits = d.getRateLimits();
  res.json(limits);
});

app.put('/api/threads/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<ThreadsConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ rateLimits: d.getConfig() });
});

// === NAVIGATION ===

app.post('/api/threads/navigate', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    
    const d = getDriver();
    const success = await d.navigateToPost(url);
    res.json({ success, url });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === POST DETAILS ===

app.get('/api/threads/post', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const details = await d.getPostDetails();
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === COMMENTS ===

app.get('/api/threads/comments', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const d = getDriver();
    const comments = await d.getComments(limit);
    res.json({ comments, count: comments.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/threads/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl } = req.body;
    
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    
    const d = getDriver();
    
    // Navigate to post if URL provided
    if (postUrl) {
      const navSuccess = await d.navigateToPost(postUrl);
      if (!navSuccess) {
        res.status(500).json({ error: 'Failed to navigate to post' });
        return;
      }
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    const result = await d.postComment(text);
    
    if (result.success) {
      res.json({
        success: true,
        commentId: result.commentId,
        text: text.substring(0, 100),
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === ENGAGEMENT DISCOVERY ===

app.get('/api/threads/posts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const d = getDriver();
    const posts = await d.findPosts(limit);
    res.json({ posts, count: posts.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/threads/context', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const context = await d.getContext();
    res.json(context);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/threads/scroll', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const success = await d.scroll();
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/threads/click-post', async (req: Request, res: Response) => {
  try {
    const { index } = req.body;
    if (index === undefined) {
      res.status(400).json({ error: 'index is required' });
      return;
    }
    const d = getDriver();
    const success = await d.clickPost(index);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === AUTO ENGAGEMENT ===

let autoCommenter: ThreadsAutoCommenter | null = null;
function getAutoCommenter(): ThreadsAutoCommenter {
  if (!autoCommenter) { autoCommenter = new ThreadsAutoCommenter(); }
  return autoCommenter;
}

let aiGenerator: ThreadsAICommentGenerator | null = null;
function getAIGenerator(): ThreadsAICommentGenerator {
  if (!aiGenerator) {
    aiGenerator = new ThreadsAICommentGenerator({
      provider: process.env.OPENAI_API_KEY ? 'openai' : 'local',
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return aiGenerator;
}

let commentLogger: CommentLogger | null = null;
function getCommentLogger(): CommentLogger {
  if (!commentLogger) {
    commentLogger = new CommentLogger();
  }
  return commentLogger;
}

app.post('/api/threads/engage', async (req: Request, res: Response) => {
  try {
    const { postUrl } = req.body;
    const ac = getAutoCommenter();
    const result = await ac.engageWithPost(postUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/threads/engage/loop', async (req: Request, res: Response) => {
  try {
    const { count = 1, delayBetween = 60000 } = req.body;
    const ac = getAutoCommenter();
    const results = await ac.runEngagementLoop(count, delayBetween);
    res.json({ results, count: results.length, successful: results.filter(r => r.success).length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/threads/engage/history', (req: Request, res: Response) => {
  const ac = getAutoCommenter();
  res.json({ commentedUrls: ac.getCommentedUrls() });
});

app.delete('/api/threads/engage/history', (req: Request, res: Response) => {
  const ac = getAutoCommenter();
  ac.clearCommentedUrls();
  res.json({ success: true });
});

// === MULTI-POST COMMENTING ===

app.post('/api/threads/engage/multi', async (req: Request, res: Response) => {
  try {
    const { count = 5, delayBetween = 30000, useAI = true } = req.body;
    const d = getDriver();
    const ai = getAIGenerator();
    
    const commentGenerator = async (context: { mainPost: string; username: string; replies?: string[] }) => {
      if (useAI) {
        // Use AI to analyze post and generate contextual comment
        // Based on python/utils/ai_comment_generator.py
        const analysis = ai.analyzePost({
          mainPost: context.mainPost,
          username: context.username,
          replies: context.replies || [],
        });
        
        console.log(`[AI] Post: @${context.username}`);
        console.log(`[AI] Content: "${context.mainPost.substring(0, 50)}..."`);
        console.log(`[AI] Analysis: sentiment=${analysis.sentiment}, topics=${analysis.topics.join(',')}, tone=${analysis.tone}`);
        console.log(`[AI] Existing comments: ${(context.replies || []).length}`);
        
        // Check for inappropriate content (thirst traps, spam, etc.)
        if (analysis.isInappropriate) {
          console.log(`[AI] ⚠️ SKIPPING - Inappropriate content: ${analysis.skipReason}`);
          return `__SKIP__:${analysis.skipReason}`;
        }
        
        const comment = await ai.generateComment(analysis);
        console.log(`[AI] Generated comment: "${comment}"`);
        return comment;
      } else {
        // Fallback to simple templates
        const templates = [
          "This is amazing! 🔥",
          "Love this! 👏",
          "So good! ✨",
          "Incredible work! 🎨",
        ];
        return templates[Math.floor(Math.random() * templates.length)];
      }
    };
    
    const { maxRetries = 2, captureScreenshots = false } = req.body;
    const result = await d.commentOnMultiplePosts(count, commentGenerator, delayBetween, {
      maxRetries,
      captureScreenshots,
    });
    
    // Log results to database
    const logger = getCommentLogger();
    const dbResult = await logger.logSession(result.results, 'threads');
    
    res.json({
      success: true,
      useAI,
      ...result.summary,
      results: result.results,
      logs: result.logs,
      database: {
        sessionId: logger.getSessionId(),
        logged: dbResult.logged,
        failed: dbResult.failed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// === DATABASE ENDPOINTS ===

app.get('/api/threads/db/history', async (req: Request, res: Response) => {
  try {
    const { limit = '50', sessionId } = req.query;
    const logger = getCommentLogger();
    const history = await logger.getHistory({
      platform: 'threads',
      limit: parseInt(limit as string),
      sessionId: sessionId as string,
    });
    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/threads/db/stats', async (req: Request, res: Response) => {
  try {
    const logger = getCommentLogger();
    const stats = await logger.getStats('threads');
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// AI Analysis endpoint
app.post('/api/threads/analyze', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const ai = getAIGenerator();
    
    // Get current post context
    const context = await d.getContext();
    const comments = await d.getComments(10);
    
    // Analyze
    const analysis = ai.analyzePost({
      mainPost: context.mainPost,
      username: context.username,
      replies: comments.map(c => c.text),
    });
    
    // Generate suggested comment
    const suggestedComment = await ai.generateComment(analysis);
    
    res.json({
      analysis,
      suggestedComment,
      context,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/threads/back', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const result = await d.clickBack();
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// === CONFIG ===

app.get('/api/threads/config', (req: Request, res: Response) => {
  const d = getDriver();
  res.json({ config: d.getConfig() });
});

app.put('/api/threads/config', (req: Request, res: Response) => {
  const updates = req.body as Partial<ThreadsConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ config: d.getConfig() });
});

// === EXECUTE JS (Advanced) ===

app.post('/api/threads/execute', async (req: Request, res: Response) => {
  try {
    const { script } = req.body;
    if (!script) {
      res.status(400).json({ error: 'script is required' });
      return;
    }
    
    // Execute via osascript
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const { stdout } = await execAsync(
      `osascript -e 'tell application "Safari" to do JavaScript "${escaped}" in current tab of front window'`
    );
    
    res.json({ result: stdout.trim() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Start server
export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`🧵 Threads Comments API running on http://localhost:${port}`);
    console.log(`   Health:   GET  /health`);
    console.log(`   Status:   GET  /api/threads/status`);
    console.log(`   Post:     POST /api/threads/comments/post`);
    console.log(`   Comments: GET  /api/threads/comments`);
  });
}

// Auto-start if run directly
if (process.argv[1]?.includes('server')) {
  startServer();
}

export { app };
