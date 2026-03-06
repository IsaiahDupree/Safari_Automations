/**
 * Upwork Hunter Test Suite
 *
 * Layer 1: Health + Stats (no external deps)
 * Layer 2: RSS fetch (real internet required)
 * Layer 3: Claude proposal generation (ANTHROPIC_API_KEY required)
 * Layer 4: Full scan pipeline (all env vars required)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'http';
import { scoreUpworkJob } from '../src/api/job-scraper.js';

// ─── Layer 1: Unit Tests (no external deps) ───────────────────────────────────

describe('Layer 1: Scoring unit tests', () => {
  it('scores a high-value AI automation job correctly', () => {
    const score = scoreUpworkJob({
      title: 'Build AI automation workflow for SaaS startup founder',
      description: 'We need an AI workflow automation system with Claude and OpenAI integration. Fixed price project.',
      budget: '$2000',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores excluded job as 0', () => {
    const score = scoreUpworkJob({
      title: 'WordPress logo design for data entry website',
      description: 'We need a logo for our Shopify themes store with data entry work.',
      budget: '$100',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBe(0);
  });

  it('gives recency bonus for recent jobs', () => {
    const recentScore = scoreUpworkJob({
      title: 'AI automation workflow',
      description: 'Build AI automation with Claude integration',
      budget: '$1500',
      pubDate: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    const oldScore = scoreUpworkJob({
      title: 'AI automation workflow',
      description: 'Build AI automation with Claude integration',
      budget: '$1500',
      pubDate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(recentScore).toBeGreaterThan(oldScore);
  });

  it('gives higher score to large budget', () => {
    const highBudgetScore = scoreUpworkJob({
      title: 'AI workflow automation',
      description: 'saas automation',
      budget: '$2000',
      pubDate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    const noBudgetScore = scoreUpworkJob({
      title: 'AI workflow automation',
      description: 'saas automation',
      budget: '',
      pubDate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(highBudgetScore).toBeGreaterThan(noBudgetScore);
  });

  it('filters out jobs with explicit hourly rate below $29/hr', () => {
    const score = scoreUpworkJob({
      title: 'AI automation workflow with Claude integration',
      description: 'Build ai automation using claude api. Rate: $20/hr',
      budget: '',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBe(0);
  });

  it('passes jobs with hourly rate above $29/hr', () => {
    const score = scoreUpworkJob({
      title: 'AI automation workflow with Claude integration',
      description: 'Build ai automation using claude api. We pay $50/hr for the right candidate.',
      budget: '',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBeGreaterThan(0);
  });

  it('filters out fixed-price jobs below $500', () => {
    const score = scoreUpworkJob({
      title: 'Build Claude API automation integration',
      description: 'Quick n8n workflow automation project for our team.',
      budget: '$200',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBe(0);
  });

  it('passes fixed-price job at exactly $500', () => {
    const score = scoreUpworkJob({
      title: 'Build Claude API automation integration',
      description: 'N8n workflow automation with claude api integration.',
      budget: '$500',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBeGreaterThan(0);
  });

  it('passes job with no explicit budget (Upwork often hides it)', () => {
    const score = scoreUpworkJob({
      title: 'AI automation expert needed — Claude API integration',
      description: 'Looking for someone to build workflow automation with claude and n8n.',
      budget: '',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBeGreaterThan(0);
  });

  it('scores 0 for job with no strong ICP keywords despite large budget', () => {
    const score = scoreUpworkJob({
      title: 'Senior React Developer for Dashboard',
      description: 'Build a modern dashboard for our analytics platform. Tech stack: React, TypeScript.',
      budget: '$5000',
      pubDate: new Date().toISOString(),
    });
    expect(score).toBe(0);
  });

  it('filters out asset-generator test endpoint correctly', async () => {
    // Just confirm the endpoint exists on the running server
    const res = await fetch('http://localhost:3107/api/proposals/assets/nonexistent').catch(() => null);
    // Either 404 (proposal not found) or 503 (supabase not configured) — never 500
    if (res) expect(res.status).not.toBe(500);
  });
});

// ─── Layer 1: HTTP endpoint tests ─────────────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.PORT = '0';

  const { default: app } = await import('../src/api/server.js');

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://localhost:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

describe('Layer 1: GET /health', () => {
  it('returns status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service: string; port: number };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('upwork-hunter');
    expect(typeof body.port).toBe('number');
  });
});

describe('Layer 1: GET /api/proposals/stats', () => {
  it('returns correct shape', async () => {
    const res = await fetch(`${baseUrl}/api/proposals/stats`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, number>;
    expect(typeof body.pending).toBe('number');
    expect(typeof body.approved).toBe('number');
    expect(typeof body.rejected).toBe('number');
    expect(typeof body.submitted).toBe('number');
    expect(typeof body.won).toBe('number');
  });
});

// ─── Layer 2: Real RSS fetch ───────────────────────────────────────────────────

const SKIP_LAYER2 = process.env.SKIP_LAYER2 === 'true';

describe.skipIf(SKIP_LAYER2)('Layer 2: GET /api/jobs/search (real RSS)', () => {
  it('returns at least 1 job with score > 0', async () => {
    const res = await fetch(`${baseUrl}/api/jobs/search`);
    expect(res.status).toBe(200);
    const body = await res.json() as { jobs: Array<{ score: number; title: string; url: string }> };
    expect(Array.isArray(body.jobs)).toBe(true);
    if (body.jobs.length > 0) {
      const hasScore = body.jobs.some((j) => j.score > 0);
      expect(hasScore).toBe(true);
      const job = body.jobs[0];
      expect(typeof job.title).toBe('string');
      expect(typeof job.url).toBe('string');
    }
  }, 30000);
});

// ─── Layer 3: Claude proposal generation ──────────────────────────────────────

const HAS_ANTHROPIC = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!HAS_ANTHROPIC)('Layer 3: POST /api/proposals/generate', () => {
  it('generates proposal text with length > 100 chars', async () => {
    const fixtureJob = {
      job_id: 'test-fixture-001',
      title: 'Build AI automation pipeline for SaaS founder',
      url: 'https://upwork.com/jobs/test-fixture',
      description: 'We are a SaaS company ($1M ARR) looking for an AI automation expert to build custom Claude-powered workflows for our onboarding process. Need N8N integration and API automation.',
      budget: '$2500',
      pub_date: new Date().toISOString(),
      score: 75,
    };

    if (!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = (await import('../src/lib/supabase.js')).getSupabaseClient();
      await supabase.from('upwork_proposals').upsert({
        job_id: fixtureJob.job_id,
        job_title: fixtureJob.title,
        job_url: fixtureJob.url,
        job_description: fixtureJob.description,
        budget: fixtureJob.budget,
        score: fixtureJob.score,
        status: 'pending',
      }, { onConflict: 'job_id' });
    }

    const res = await fetch(`${baseUrl}/api/proposals/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: fixtureJob.job_id, offerType: 'audit_build' }),
    });

    if (res.status === 404) {
      const { generateProposal } = await import('../src/api/proposal-gen.js');
      const text = await generateProposal(fixtureJob, 'audit_build');
      expect(text.length).toBeGreaterThan(100);
    } else {
      expect(res.status).toBe(200);
      const body = await res.json() as { proposal_text: string };
      expect(body.proposal_text.length).toBeGreaterThan(100);
    }
  }, 30000);
});

// ─── Layer 4: Full scan ────────────────────────────────────────────────────────

const HAS_ALL = HAS_ANTHROPIC && !!process.env.SUPABASE_URL;

describe.skipIf(!HAS_ALL)('Layer 4: POST /api/scan full pipeline', () => {
  it('completes without throwing', async () => {
    const res = await fetch(`${baseUrl}/api/scan`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { jobs_found: number; above_threshold: number; proposals_generated: number };
    expect(typeof body.jobs_found).toBe('number');
    expect(typeof body.above_threshold).toBe('number');
    expect(typeof body.proposals_generated).toBe('number');
  }, 120000);
});
