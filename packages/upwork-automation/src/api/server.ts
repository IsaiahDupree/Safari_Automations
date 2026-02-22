/**
 * Upwork Automation API Server
 * REST API for job discovery, applications, messaging, and scoring.
 * Port: 3104
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import {
  SafariDriver,
  getDefaultDriver,
  navigateToFindWork,
  navigateToTab,
  navigateToMyJobs,
  navigateToJob,
  searchJobs,
  extractJobDetail,
  extractJobsFromCurrentPage,
  getJobsFromTab,
  getAvailableFilters,
  scoreJob,
  recommendConnects,
  saveJob,
  submitProposal,
  getApplications,
  navigateToMessages,
  listConversations,
  readMessages,
  openConversation,
  sendMessage,
  getUnreadCount,
  DEFAULT_RATE_LIMITS,
} from '../automation/index.js';
import type { RateLimitConfig, JobSearchConfig, JobTab } from '../automation/types.js';

const PORT = process.env.UPWORK_PORT || 3104;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// Enable verbose logging for debugging
getDefaultDriver().setConfig({ verbose: true });

// Rate limiting state
let actionCount = 0;
let lastActionReset = Date.now();
let rateLimits: RateLimitConfig = { ...DEFAULT_RATE_LIMITS };

function checkRateLimit(): boolean {
  const now = Date.now();
  if (now - lastActionReset > 3600000) {
    actionCount = 0;
    lastActionReset = now;
  }
  if (actionCount >= rateLimits.searchesPerHour) return false;
  actionCount++;
  return true;
}

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    platform: 'upwork',
    status: 'running',
    port: PORT,
    uptime: process.uptime(),
    actionsThisHour: actionCount,
  });
});

app.get('/api/upwork/status', async (_req: Request, res: Response) => {
  try {
    const driver = getDefaultDriver();
    const isOnUpwork = await driver.isOnUpwork();
    const isLoggedIn = isOnUpwork ? await driver.isLoggedIn() : false;
    const url = await driver.getCurrentUrl();

    res.json({
      isOnUpwork,
      isLoggedIn,
      currentUrl: url,
      rateLimits: { actionsThisHour: actionCount, limit: rateLimits.searchesPerHour },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Navigation ──────────────────────────────────────────────

app.post('/api/upwork/navigate/find-work', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToFindWork();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/tab', async (req: Request, res: Response) => {
  try {
    const { tab } = req.body;
    const validTabs: JobTab[] = ['best_matches', 'most_recent', 'us_only', 'saved_jobs'];
    if (!tab || !validTabs.includes(tab)) {
      return res.status(400).json({ error: 'tab required (best_matches | most_recent | us_only | saved_jobs)' });
    }
    const result = await navigateToTab(tab);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/my-jobs', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMyJobs();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/job', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    const result = await navigateToJob(url);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/upwork/navigate/messages', async (_req: Request, res: Response) => {
  try {
    const result = await navigateToMessages();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Job Search ──────────────────────────────────────────────

app.post('/api/upwork/jobs/search', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    const config: Partial<JobSearchConfig> = req.body;
    const jobs = await searchJobs(config);
    res.json({ jobs, count: jobs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get jobs from a specific tab (best_matches, most_recent, us_only, saved_jobs)
app.post('/api/upwork/jobs/tab', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const { tab } = req.body;
    const validTabs: JobTab[] = ['best_matches', 'most_recent', 'us_only', 'saved_jobs'];
    if (!tab || !validTabs.includes(tab)) {
      return res.status(400).json({ error: 'tab required (best_matches | most_recent | us_only | saved_jobs)' });
    }
    const result = await getJobsFromTab(tab);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Extract jobs from whatever page Safari is currently on
app.get('/api/upwork/jobs/current-page', async (_req: Request, res: Response) => {
  try {
    const jobs = await extractJobsFromCurrentPage();
    res.json({ jobs, count: jobs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Get available filters from current search page
app.get('/api/upwork/jobs/filters', async (_req: Request, res: Response) => {
  try {
    const filters = await getAvailableFilters();
    res.json(filters);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Full job detail page extraction — click into a job and get everything
app.get('/api/upwork/jobs/detail', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: 'url query param required' });
    const detail = await extractJobDetail(url);
    if (!detail) return res.status(404).json({ error: 'Could not extract job detail' });
    res.json(detail);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy: get job by ID
app.get('/api/upwork/jobs/:id', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) return res.status(429).json({ error: 'Rate limit exceeded' });
    const jobUrl = `https://www.upwork.com/jobs/${req.params.id}`;
    const job = await extractJobDetail(jobUrl);
    if (!job) return res.status(404).json({ error: 'Job not found or could not extract' });
    res.json(job);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Score a job with connects recommendation
app.post('/api/upwork/jobs/score', async (req: Request, res: Response) => {
  try {
    const { job, preferredSkills, minBudget, availableConnects } = req.body;
    if (!job) return res.status(400).json({ error: 'job object required' });
    const score = scoreJob(job, preferredSkills || [], minBudget || 0, availableConnects || 100);
    res.json(score);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Score + recommend connects for multiple jobs at once
app.post('/api/upwork/jobs/score-batch', async (req: Request, res: Response) => {
  try {
    const { jobs, preferredSkills, minBudget, availableConnects } = req.body;
    if (!jobs || !Array.isArray(jobs)) return res.status(400).json({ error: 'jobs array required' });
    const scores = jobs.map((job: any) => scoreJob(job, preferredSkills || [], minBudget || 0, availableConnects || 100));
    // Sort by score descending
    scores.sort((a: any, b: any) => b.totalScore - a.totalScore);
    res.json({
      scores,
      count: scores.length,
      applyCount: scores.filter((s: any) => s.recommendation === 'apply').length,
      maybeCount: scores.filter((s: any) => s.recommendation === 'maybe').length,
      skipCount: scores.filter((s: any) => s.recommendation === 'skip').length,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/jobs/:id/save', async (req: Request, res: Response) => {
  try {
    const jobUrl = `https://www.upwork.com/jobs/${req.params.id}`;
    const saved = await saveJob(jobUrl);
    res.json({ success: saved });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Proposal Submission ────────────────────────────────────

app.post('/api/upwork/proposals/submit', async (req: Request, res: Response) => {
  try {
    if (!checkRateLimit()) {
      return res.status(429).json({ error: 'Application rate limit reached' });
    }

    const {
      jobUrl,
      coverLetter,
      hourlyRate,
      fixedPrice,
      screeningAnswers,
      boostConnects,
      dryRun = true, // Default to dry run for safety
    } = req.body;

    if (!jobUrl) return res.status(400).json({ error: 'jobUrl required' });
    if (!coverLetter) return res.status(400).json({ error: 'coverLetter required' });

    const result = await submitProposal({
      jobUrl,
      coverLetter,
      hourlyRate,
      fixedPrice,
      screeningAnswers,
      boostConnects,
      dryRun,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Applications ────────────────────────────────────────────

app.get('/api/upwork/applications', async (_req: Request, res: Response) => {
  try {
    const apps = await getApplications();
    res.json({ applications: apps, count: apps.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Messages ────────────────────────────────────────────────

app.get('/api/upwork/conversations', async (_req: Request, res: Response) => {
  try {
    const nav = await navigateToMessages();
    if (!nav.success) return res.status(500).json(nav);
    const convos = await listConversations();
    res.json({ conversations: convos, count: convos.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/messages', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const msgs = await readMessages(limit);
    res.json({ messages: msgs, count: msgs.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/upwork/messages/unread', async (_req: Request, res: Response) => {
  try {
    const count = await getUnreadCount();
    res.json({ unreadCount: count });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/messages/open', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.body;
    if (!clientName) return res.status(400).json({ error: 'clientName required' });
    const opened = await openConversation(clientName);
    res.json({ success: opened });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/upwork/messages/send', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text required' });
    const result = await sendMessage(text);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── AI Proposal Generation ─────────────────────────────────

app.post('/api/upwork/proposals/generate', async (req: Request, res: Response) => {
  try {
    const { job, customInstructions, highlightSkills } = req.body;
    if (!job) return res.status(400).json({ error: 'job object required' });

    if (!OPENAI_API_KEY) {
      return res.json({
        coverLetter: `I'm excited about your project "${job.title}". With my expertise in ${(job.skills || []).slice(0, 3).join(', ')}, I'm confident I can deliver excellent results. Let's discuss the details!`,
        suggestedQuestions: ['What is the expected timeline?', 'Do you have existing code/assets?'],
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
            content: `You are a professional freelancer writing an Upwork proposal. Write a concise, personalized cover letter (150-250 words). Be specific about the client's needs, show understanding of the project, and demonstrate relevant expertise. Do NOT be generic or salesy. End with 2-3 clarifying questions.${customInstructions ? `\n\nAdditional instructions: ${customInstructions}` : ''}`,
          },
          {
            role: 'user',
            content: `Job: ${job.title}\nDescription: ${(job.description || '').substring(0, 1000)}\nSkills: ${(job.skills || []).join(', ')}\nBudget: ${JSON.stringify(job.budget)}\n${highlightSkills ? `My strengths: ${highlightSkills.join(', ')}` : ''}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim() || '';

    // Split into cover letter and questions
    const parts = text.split(/(?:questions?|clarif)/i);
    const coverLetter = parts[0]?.trim() || text;
    const questionsRaw = parts[1] || '';
    const suggestedQuestions = questionsRaw
      .split(/\d+[\.\)]\s*/)
      .filter(q => q.trim().length > 10)
      .map(q => q.trim());

    res.json({
      coverLetter,
      suggestedQuestions: suggestedQuestions.length > 0 ? suggestedQuestions : ['What is the expected timeline?'],
      confidence: 0.8,
      aiGenerated: true,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rate Limits ─────────────────────────────────────────────

app.get('/api/upwork/rate-limits', (_req: Request, res: Response) => {
  res.json({
    config: rateLimits,
    current: { actionsThisHour: actionCount },
  });
});

app.put('/api/upwork/rate-limits', (req: Request, res: Response) => {
  rateLimits = { ...rateLimits, ...req.body };
  res.json({ updated: true, config: rateLimits });
});

// ─── Start Server ────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🏢 Upwork Automation API running on http://localhost:${PORT}`);
  console.log(`   Health: GET http://localhost:${PORT}/health`);
  console.log(`   Status: GET http://localhost:${PORT}/api/upwork/status`);
  console.log(`   Search: POST http://localhost:${PORT}/api/upwork/jobs/search`);
  console.log(`   Tabs:   POST http://localhost:${PORT}/api/upwork/jobs/tab`);
  console.log(`   Detail: GET  http://localhost:${PORT}/api/upwork/jobs/detail?url=...`);
  console.log(`   Score:  POST http://localhost:${PORT}/api/upwork/jobs/score`);
  console.log(`   Batch:  POST http://localhost:${PORT}/api/upwork/jobs/score-batch`);
  console.log(`   Messages: GET http://localhost:${PORT}/api/upwork/conversations`);
  if (OPENAI_API_KEY) console.log(`   AI Proposals: POST http://localhost:${PORT}/api/upwork/proposals/generate`);
  console.log('');
});

export default app;
