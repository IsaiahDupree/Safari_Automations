/**
 * Instagram Comment API Server
 * 
 * REST API for Instagram comment automation via Safari.
 * Port: 3005
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { InstagramDriver, DEFAULT_CONFIG, type InstagramConfig } from '../automation/instagram-driver.js';
import { InstagramAICommentGenerator, isInappropriateContent } from '../automation/ai-comment-generator.js';
import { CommentLogger } from '../db/comment-logger.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.INSTAGRAM_COMMENTS_PORT || process.env.PORT || '3005');

let driver: InstagramDriver | null = null;

function getDriver(): InstagramDriver {
  if (!driver) {
    driver = new InstagramDriver();
  }
  return driver;
}

let aiGenerator: InstagramAICommentGenerator | null = null;
function getAIGenerator(): InstagramAICommentGenerator {
  if (!aiGenerator) {
    aiGenerator = new InstagramAICommentGenerator({
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

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'instagram-comments',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/instagram/status', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const status = await d.getStatus();
    const rateLimits = d.getRateLimits();
    res.json({ ...status, commentsThisHour: rateLimits.commentsThisHour, commentsToday: rateLimits.commentsToday });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/rate-limits', (req: Request, res: Response) => {
  const d = getDriver();
  res.json(d.getRateLimits());
});

app.put('/api/instagram/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ rateLimits: d.getConfig() });
});

app.post('/api/instagram/navigate', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const d = getDriver();
    const success = await d.navigateToPost(url);
    res.json({ success, url });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/post', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const details = await d.getPostDetails();
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/comments', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const d = getDriver();
    const comments = await d.getComments(limit);
    res.json({ comments, count: comments.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/instagram/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl } = req.body;
    if (!text) { res.status(400).json({ error: 'text is required' }); return; }
    const d = getDriver();
    if (postUrl) {
      const navSuccess = await d.navigateToPost(postUrl);
      if (!navSuccess) { res.status(500).json({ error: 'Failed to navigate to post' }); return; }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const result = await d.postComment(text);
    if (result.success) {
      res.json({ success: true, commentId: result.commentId, text: text.substring(0, 100) });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/config', (req: Request, res: Response) => {
  const d = getDriver();
  res.json({ config: d.getConfig() });
});

app.put('/api/instagram/config', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ config: d.getConfig() });
});

// === MULTI-POST COMMENTING WITH AI ===

app.post('/api/instagram/engage/multi', async (req: Request, res: Response) => {
  try {
    const { count = 5, delayBetween = 30000, useAI = true } = req.body;
    const d = getDriver();
    const ai = getAIGenerator();
    const logger = getCommentLogger();
    
    const results: Array<{ success: boolean; username: string; comment: string; postUrl?: string; error?: string }> = [];
    const logs: string[] = [];
    const startTime = Date.now();
    
    const log = (msg: string) => {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      const formatted = `[${timestamp}] ${msg}`;
      console.log(formatted);
      logs.push(formatted);
    };
    
    log(`[Instagram] 🚀 Starting multi-post commenting (${count} posts)`);
    
    // Navigate to Instagram feed
    await d.navigateToPost('https://www.instagram.com');
    await new Promise(r => setTimeout(r, 3000));
    
    // Step 1: Collect all post URLs first
    log(`[Instagram] � Collecting ${count} post URLs from feed...`);
    let allPosts: Array<{ username: string; url?: string }> = [];
    let scrollAttempts = 0;
    while (allPosts.length < count && scrollAttempts < 5) {
      const posts = await d.findPosts(count * 2);
      for (const post of posts) {
        if (post.url && !allPosts.find(p => p.url === post.url)) {
          allPosts.push(post);
        }
      }
      if (allPosts.length < count) {
        await d.scroll();
        await new Promise(r => setTimeout(r, 1500));
        scrollAttempts++;
      }
    }
    
    const targetPosts = allPosts.slice(0, count);
    log(`[Instagram] ✅ Found ${targetPosts.length} unique posts`);
    for (let i = 0; i < targetPosts.length; i++) {
      log(`[Instagram]   ${i + 1}. @${targetPosts[i].username || 'unknown'}: ${targetPosts[i].url}`);
    }
    
    // Step 2: Visit each post individually
    for (let i = 0; i < targetPosts.length; i++) {
      const targetPost = targetPosts[i];
      log(`\n[Instagram] ═══════════════════════════════════════`);
      log(`[Instagram] 📝 Post ${i + 1}/${targetPosts.length}`);
      log(`[Instagram] ═══════════════════════════════════════`);
      
      try {
        if (!targetPost.url) {
          log(`[Instagram] ❌ No URL for post`);
          results.push({ success: false, username: '', comment: '', error: 'No post URL' });
          continue;
        }
        
        // Navigate directly to post URL
        log(`[Instagram] 🔗 Navigating to: ${targetPost.url}`);
        await d.navigateToPost(targetPost.url);
        await new Promise(r => setTimeout(r, 3000));
        
        // Get post details
        const details = await d.getPostDetails();
        log(`[Instagram] 👤 Author: @${details.username}`);
        log(`[Instagram] 📄 Caption: "${(details.caption || '').substring(0, 50)}..."`);
        
        // Get existing comments for context
        log(`[Instagram] 💬 Getting existing comments...`);
        const existingComments = await d.getComments(10);
        log(`[Instagram]   Found ${existingComments.length} comments`);
        
        // Check if we already commented (duplicate detection)
        const ourUsername = 'isaiahdupree'; // TODO: Get from config
        const alreadyCommented = existingComments.some(c => 
          c.username?.toLowerCase() === ourUsername.toLowerCase()
        );
        
        if (alreadyCommented) {
          log(`[Instagram] ⚠️ SKIPPED - Already commented on this post`);
          results.push({
            success: false,
            username: details.username || '',
            comment: '',
            postUrl: targetPost?.url,
            error: 'Already commented',
          });
          continue;
        }
        
        // Analyze with AI using post + existing comments context
        const analysis = ai.analyzePost({
          mainPost: details.caption || '',
          username: details.username || 'unknown',
          replies: existingComments.map(c => `@${c.username}: ${c.text}`),
        });
        
        log(`[Instagram] 🧠 Analysis: sentiment=${analysis.sentiment}, topics=${analysis.topics.join(',')}`);
        
        // Check for inappropriate content
        if (analysis.isInappropriate) {
          log(`[Instagram] ⚠️ SKIPPED - ${analysis.skipReason}`);
          results.push({
            success: false,
            username: details.username || '',
            comment: '',
            postUrl: targetPost?.url,
            error: `Skipped: ${analysis.skipReason}`,
          });
          continue;
        }
        
        // Generate comment with context
        let comment: string;
        if (useAI) {
          comment = await ai.generateComment(analysis);
        } else {
          const templates = ["This is amazing! 🔥", "Love this! 👏", "So good! ✨"];
          comment = templates[Math.floor(Math.random() * templates.length)];
        }
        
        log(`[Instagram] ✏️ Generated: "${comment}"`);
        
        // Post comment
        const result = await d.postComment(comment);
        
        if (result.success) {
          log(`[Instagram] ✅ Comment posted!`);
          
          // Verify comment was posted
          log(`[Instagram] 🔍 Verifying comment...`);
          await new Promise(r => setTimeout(r, 2000));
          const newComments = await d.getComments(5);
          const verified = newComments.some(c => 
            c.text?.includes(comment.substring(0, 20)) || 
            c.username?.toLowerCase() === ourUsername.toLowerCase()
          );
          
          if (verified) {
            log(`[Instagram] ✅ Comment verified!`);
          } else {
            log(`[Instagram] ⚠️ Comment not found in verification (may still be posted)`);
          }
          
          results.push({
            success: true,
            username: details.username || '',
            comment,
            postUrl: targetPost?.url,
          });
        } else {
          log(`[Instagram] ❌ Failed: ${result.error}`);
          results.push({
            success: false,
            username: details.username || '',
            comment,
            postUrl: targetPost?.url,
            error: result.error,
          });
        }
        
        // Delay between posts
        if (i < targetPosts.length - 1) {
          log(`[Instagram] ⏳ Waiting ${delayBetween / 1000}s...`);
          await new Promise(r => setTimeout(r, delayBetween));
        }
        
      } catch (error) {
        log(`[Instagram] ❌ Error: ${error}`);
        results.push({
          success: false,
          username: '',
          comment: '',
          error: String(error),
        });
        // Try to recover
        await d.clickBack();
      }
    }
    
    const duration = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    
    log(`\n[Instagram] 🏁 COMPLETE: ${successful}/${count} successful`);
    
    // Log to database
    const dbResult = await logger.logSession(results, 'instagram');
    
    res.json({
      success: true,
      total: count,
      successful,
      failed: count - successful,
      duration,
      useAI,
      results,
      logs,
      database: {
        sessionId: logger.getSessionId(),
        logged: dbResult.logged,
        failed: dbResult.failed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === DATABASE ENDPOINTS ===

app.get('/api/instagram/db/history', async (req: Request, res: Response) => {
  try {
    const { limit = '50' } = req.query;
    const logger = getCommentLogger();
    const history = await logger.getHistory({
      platform: 'instagram',
      limit: parseInt(limit as string),
    });
    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/db/stats', async (req: Request, res: Response) => {
  try {
    const logger = getCommentLogger();
    const stats = await logger.getStats('instagram');
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// === ANALYZE ===

app.post('/api/instagram/analyze', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const ai = getAIGenerator();
    
    const details = await d.getPostDetails();
    const analysis = ai.analyzePost({
      mainPost: details.caption || '',
      username: details.username || '',
      replies: [],
    });
    
    const suggestedComment = await ai.generateComment(analysis);
    
    res.json({ analysis, suggestedComment, details });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`📸 Instagram Comments API running on http://localhost:${port}`);
    console.log(`   Health:   GET  /health`);
    console.log(`   Status:   GET  /api/instagram/status`);
    console.log(`   Post:     POST /api/instagram/comments/post`);
  });
}

if (process.argv[1]?.includes('server')) {
  startServer();
}

export { app };
