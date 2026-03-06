/**
 * Upwork Hunter API Server
 *
 * Autonomous Upwork proposal factory: RSS job scraping, ICP scoring,
 * Claude AI proposal generation, Telegram approval gate, Supabase tracking.
 *
 * Port: 3107
 *
 * Endpoints:
 *   GET  /health                             — { status: 'ok', service: 'upwork-hunter' }
 *   GET  /api/jobs/search                    — fetch+score RSS jobs, return top 10
 *   GET  /api/jobs/pending                   — list pending proposals from Supabase
 *   GET  /api/proposals/:jobId               — full proposal text
 *   POST /api/proposals/generate             — generate proposal: { jobId, offerType }
 *   POST /api/proposals/approve/:jobId       — manually approve
 *   POST /api/proposals/reject/:jobId        — manually reject
 *   GET  /api/proposals/stats                — { pending, approved, rejected, submitted, won }
 *   POST /api/scan                           — full pipeline: search → score → generate → telegram
 *
 * Start:
 *   npx tsx packages/upwork-hunter/src/api/server.ts
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { fetchAndScoreJobs } from './job-scraper.js';
import { generateAndStoreProposal } from './proposal-gen.js';
import { sendProposalToTelegram, startPollingLoop, isTelegramConfigured } from './telegram-gate.js';
import { getSupabaseClient, isSupabaseConfigured, applyMigration } from '../lib/supabase.js';
import type { UpworkJob, OfferType, ScanSummary } from '../types/index.js';

const PORT = parseInt(process.env.PORT || '3107', 10);
// 30 = minimum for a relevant job with 1-2 strong ICP keyword hits
// (Upwork jobs with budget easily reach 60+; WWR jobs peak ~44 without budget)
const SCORE_THRESHOLD = 30;
const AUTO_APPROVE_THRESHOLD = 70;

const app = express();
app.use(cors());
app.use(express.json());

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'upwork-hunter',
    port: PORT,
    supabase: isSupabaseConfigured(),
    telegram: isTelegramConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Jobs ─────────────────────────────────────────────────────────────────────

app.get('/api/jobs/search', async (_req: Request, res: Response) => {
  try {
    const jobs = await fetchAndScoreJobs();
    const top10 = jobs.slice(0, 10);
    res.json({ jobs: top10, total: jobs.length });
  } catch (err) {
    console.error('[jobs/search] Error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs', details: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/jobs/pending', async (_req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('upwork_proposals')
      .select('*')
      .eq('status', 'pending')
      .order('score', { ascending: false });
    if (error) throw error;
    res.json({ proposals: data || [] });
  } catch (err) {
    console.error('[jobs/pending] Error:', err);
    res.status(500).json({ error: 'Failed to fetch pending jobs', details: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Proposals ────────────────────────────────────────────────────────────────

app.get('/api/proposals/stats', async (_req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    return res.json({ pending: 0, approved: 0, rejected: 0, submitted: 0, won: 0 });
  }
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('upwork_proposals')
      .select('status');
    if (error) throw error;

    const stats = { pending: 0, approved: 0, rejected: 0, submitted: 0, won: 0 };
    for (const row of data || []) {
      const s = row.status as keyof typeof stats;
      if (s in stats) stats[s]++;
    }
    res.json(stats);
  } catch (err) {
    const errObj = err as { code?: string };
    if (errObj?.code === 'PGRST205' || errObj?.code === '42P01') {
      return res.json({ pending: 0, approved: 0, rejected: 0, submitted: 0, won: 0 });
    }
    console.error('[proposals/stats] Error:', err);
    res.status(500).json({ error: 'Failed to fetch stats', details: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/proposals/:jobId', async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('upwork_proposals')
      .select('*')
      .eq('job_id', req.params.jobId)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Proposal not found' });
    res.json(data);
  } catch (err) {
    console.error('[proposals/:jobId] Error:', err);
    res.status(500).json({ error: 'Failed to fetch proposal', details: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/proposals/generate', async (req: Request, res: Response) => {
  const { jobId, offerType = 'audit_build' } = req.body as { jobId: string; offerType?: OfferType };
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });

  try {
    let job: UpworkJob | null = null;

    if (isSupabaseConfigured()) {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from('upwork_proposals')
        .select('job_id, job_title, job_url, job_description, budget, score')
        .eq('job_id', jobId)
        .single();
      if (data) {
        job = {
          job_id: data.job_id,
          title: data.job_title,
          url: data.job_url,
          description: data.job_description || '',
          budget: data.budget || '',
          pub_date: '',
          score: data.score,
        };
      }
    }

    if (!job) {
      const jobs = await fetchAndScoreJobs();
      job = jobs.find((j) => j.job_id === jobId) || null;
    }

    if (!job) return res.status(404).json({ error: 'Job not found' });

    const proposal = await generateAndStoreProposal(job, offerType as OfferType);
    res.json({ jobId, proposal_text: proposal.proposal_text, status: proposal.status });
  } catch (err) {
    console.error('[proposals/generate] Error:', err);
    res.status(500).json({ error: 'Failed to generate proposal', details: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/proposals/approve/:jobId', async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('upwork_proposals')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('job_id', req.params.jobId);
    if (error) throw error;
    res.json({ success: true, jobId: req.params.jobId, status: 'approved' });
  } catch (err) {
    console.error('[proposals/approve] Error:', err);
    res.status(500).json({ error: 'Failed to approve proposal', details: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/proposals/reject/:jobId', async (req: Request, res: Response) => {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('upwork_proposals')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('job_id', req.params.jobId);
    if (error) throw error;
    res.json({ success: true, jobId: req.params.jobId, status: 'rejected' });
  } catch (err) {
    console.error('[proposals/reject] Error:', err);
    res.status(500).json({ error: 'Failed to reject proposal', details: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Full Pipeline Scan ────────────────────────────────────────────────────────

export async function runFullScan(): Promise<ScanSummary> {
  const summary: ScanSummary = { jobs_found: 0, above_threshold: 0, proposals_generated: 0, errors: [] };
  console.log('[scan] Starting full pipeline scan...');

  let jobs: UpworkJob[];
  try {
    jobs = await fetchAndScoreJobs();
    summary.jobs_found = jobs.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push(`RSS fetch failed: ${msg}`);
    console.error('[scan] RSS fetch failed:', msg);
    return summary;
  }

  const qualified = jobs.filter((j) => j.score >= SCORE_THRESHOLD);
  summary.above_threshold = qualified.length;
  console.log(`[scan] Found ${jobs.length} jobs, ${qualified.length} above threshold (${SCORE_THRESHOLD})`);

  const existingIds = new Set<string>();
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseClient();
      const { data } = await supabase.from('upwork_proposals').select('job_id');
      for (const row of data || []) existingIds.add(row.job_id);
    } catch (err) {
      console.warn('[scan] Could not check existing proposals:', err instanceof Error ? err.message : String(err));
    }
  }

  for (const job of qualified) {
    if (existingIds.has(job.job_id)) {
      console.log(`[scan] Skipping duplicate job_id=${job.job_id}`);
      continue;
    }

    try {
      const proposal = await generateAndStoreProposal(job, 'audit_build');
      summary.proposals_generated++;

      if (!isTelegramConfigured() && job.score >= AUTO_APPROVE_THRESHOLD && isSupabaseConfigured()) {
        const supabase = getSupabaseClient();
        await supabase
          .from('upwork_proposals')
          .update({ status: 'approved', updated_at: new Date().toISOString() })
          .eq('job_id', job.job_id);
        console.log(`[scan] Auto-approved job_id=${job.job_id} (score ${job.score} >= ${AUTO_APPROVE_THRESHOLD})`);
      } else if (isTelegramConfigured()) {
        await sendProposalToTelegram(proposal);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`job_id=${job.job_id}: ${msg}`);
      console.error(`[scan] Failed to process job_id=${job.job_id}:`, msg);
    }
  }

  console.log(`[scan] Complete — jobs_found=${summary.jobs_found}, above_threshold=${summary.above_threshold}, proposals_generated=${summary.proposals_generated}`);
  return summary;
}

app.post('/api/scan', async (_req: Request, res: Response) => {
  try {
    const summary = await runFullScan();
    res.json(summary);
  } catch (err) {
    console.error('[scan] Unexpected error:', err);
    res.status(500).json({ error: 'Scan failed', details: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Error Handler ─────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ─────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await applyMigration();

  app.listen(PORT, () => {
    console.log(`[server] Upwork Hunter running on :${PORT}`);
    console.log(`[server] Supabase: ${isSupabaseConfigured() ? 'configured' : 'not configured'}`);
    console.log(`[server] Telegram: ${isTelegramConfigured() ? 'configured' : 'not configured — auto-approve mode'}`);
  });

  if (isTelegramConfigured()) {
    startPollingLoop(5000);
  }

  const SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000;
  setInterval(runFullScan, SCAN_INTERVAL_MS);
  console.log(`[server] Autonomous scan loop scheduled every 4 hours`);

  // Run initial scan on startup (don't wait 4h for first proposals)
  setTimeout(() => {
    console.log('[server] Running startup scan...');
    runFullScan().catch((err) => console.error('[server] Startup scan failed:', err));
  }, 3000);
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});

export default app;
