/**
 * Upwork Job Operations — Unit + Integration Tests
 * 
 * Unit tests: scoring, connects recommendation, URL building (no Safari needed)
 * Integration tests: live Safari automation (require Upwork login)
 * 
 * Run unit tests:   npx tsx packages/upwork-automation/src/__tests__/job-operations.test.ts
 * Run with Safari:  npx tsx packages/upwork-automation/src/__tests__/job-operations.test.ts --live
 */

import {
  scoreJob,
  recommendConnects,
  searchJobs,
  getJobsFromTab,
  extractJobDetail,
  extractJobsFromCurrentPage,
  navigateToTab,
  navigateToFindWork,
  saveJob,
  getAvailableFilters,
} from '../automation/job-operations.js';
import type { UpworkJob, JobScore, JobTab } from '../automation/types.js';

const isLive = process.argv.includes('--live');

// ─── Test Helpers ────────────────────────────────────────────

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function skip(message: string) {
  console.log(`  ⏭️  SKIP: ${message}`);
  skipped++;
}

function section(name: string) {
  console.log(`\n═══ ${name} ═══`);
}

// ─── Mock Job Data ───────────────────────────────────────────

const mockJob: UpworkJob = {
  id: 'test_001',
  title: 'Senior TypeScript Developer for SaaS Platform',
  description: 'Looking for an experienced TypeScript developer to build our SaaS dashboard.',
  url: 'https://www.upwork.com/jobs/~0123456789',
  budget: { type: 'fixed', amount: 3000, min: 3000, max: 3000 },
  skills: ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
  experienceLevel: 'Expert',
  postedAt: '2 hours ago',
  proposals: 8,
  clientInfo: {
    totalSpent: '$50K+',
    reviewScore: 4.8,
    location: 'United States',
    paymentVerified: true,
    hireRate: '85%',
    jobsPosted: 25,
  },
  connectsCost: 16,
  isInviteOnly: false,
  category: 'Web Development',
  scrapedAt: new Date().toISOString(),
};

const lowBudgetJob: UpworkJob = {
  ...mockJob,
  id: 'test_002',
  title: 'Simple Website Fix',
  budget: { type: 'fixed', amount: 25, min: 25, max: 25 },
  skills: ['HTML', 'CSS'],
  experienceLevel: 'Entry Level',
  postedAt: '3 days ago',
  proposals: 45,
  clientInfo: {
    totalSpent: '$0',
    reviewScore: 0,
    location: '',
    paymentVerified: false,
    hireRate: '0%',
    jobsPosted: 1,
  },
};

const hourlyJob: UpworkJob = {
  ...mockJob,
  id: 'test_003',
  title: 'Full-Stack Developer - Ongoing',
  budget: { type: 'hourly', min: 60, max: 100 },
  skills: ['TypeScript', 'React', 'AWS', 'Python'],
  proposals: 3,
  postedAt: '15 minutes ago',
  clientInfo: {
    ...mockJob.clientInfo,
    totalSpent: '$200K+',
    reviewScore: 5.0,
    hireRate: '95%',
  },
};

// ─── Unit Tests: Scoring ─────────────────────────────────────

async function testScoring() {
  section('Job Scoring');

  const preferredSkills = ['TypeScript', 'React', 'Node.js', 'Python', 'AWS'];

  // High-value job should score well
  const score1 = scoreJob(mockJob, preferredSkills, 500, 100);
  assert(score1.totalScore >= 45, `Good job scores >= 45 (got ${score1.totalScore})`);
  assert(score1.recommendation !== 'skip', `Good job not skipped (got ${score1.recommendation})`);
  assert(score1.connectsRecommendation.suggestedConnects > 0, `Connects recommended > 0`);

  // Low-budget unverified job should score poorly
  const score2 = scoreJob(lowBudgetJob, preferredSkills, 500, 100);
  assert(score2.totalScore < 45, `Low job scores < 45 (got ${score2.totalScore})`);
  assert(score2.recommendation === 'skip', `Low job is skip (got ${score2.recommendation})`);

  // Excellent job should score highest
  const score3 = scoreJob(hourlyJob, preferredSkills, 50, 100);
  assert(score3.totalScore >= 55, `Excellent job scores >= 55 (got ${score3.totalScore})`);
  assert(score3.factors.competition >= 12, `Low competition factor (got ${score3.factors.competition})`);
  assert(score3.factors.freshness >= 8, `Fresh posting factor (got ${score3.factors.freshness})`);
}

// ─── Unit Tests: Connects Recommendation ─────────────────────

async function testConnectsRecommendation() {
  section('Connects Recommendation');

  const dummyScore: JobScore = {
    jobId: 'test',
    totalScore: 70,
    factors: { budgetMatch: 20, skillMatch: 25, clientQuality: 15, competition: 10, freshness: 10 },
    recommendation: 'apply',
    reason: 'test',
    connectsRecommendation: { suggestedConnects: 0, reasoning: '', competitionLevel: 'low' },
  };

  // Low competition → low connects
  const lowComp = recommendConnects({ ...mockJob, proposals: 3 }, dummyScore, 100);
  assert(lowComp.competitionLevel === 'low', `3 proposals = low competition`);
  assert(lowComp.suggestedConnects <= 14, `Low comp suggests <= 14 connects (got ${lowComp.suggestedConnects})`);

  // Very high competition → high connects
  const highComp = recommendConnects({ ...mockJob, proposals: 40 }, dummyScore, 100);
  assert(highComp.competitionLevel === 'very_high', `40 proposals = very_high competition`);
  assert(highComp.suggestedConnects >= 12, `High comp suggests >= 12 connects (got ${highComp.suggestedConnects})`);

  // Capped by available connects
  const capped = recommendConnects({ ...mockJob, proposals: 40 }, dummyScore, 5);
  assert(capped.suggestedConnects <= 5, `Capped at 5 available (got ${capped.suggestedConnects})`);

  // High budget bumps connects
  const bigBudget = recommendConnects(
    { ...mockJob, budget: { type: 'fixed', amount: 10000 }, proposals: 3 },
    dummyScore, 100
  );
  assert(bigBudget.suggestedConnects > lowComp.suggestedConnects,
    `$10K job gets more connects than small budget (${bigBudget.suggestedConnects} > ${lowComp.suggestedConnects})`);
}

// ─── Integration Tests: Live Safari ──────────────────────────

async function testLiveSearch() {
  section('Live Search (Safari)');

  const jobs = await searchJobs({
    keywords: ['TypeScript'],
    experienceLevel: ['expert'],
    sortBy: 'newest',
  });

  assert(jobs.length > 0, `Search returned ${jobs.length} jobs`);
  if (jobs.length > 0) {
    const j = jobs[0];
    assert(!!j.title, `First job has title: ${j.title.substring(0, 50)}`);
    assert(!!j.url, `First job has URL`);
    assert(!!j.id, `First job has ID: ${j.id}`);
    assert(j.budget?.type !== undefined, `First job has budget type: ${j.budget.type}`);
  }
}

async function testLiveTabs() {
  section('Live Tab Navigation (Safari)');

  const tabs: JobTab[] = ['best_matches', 'most_recent', 'us_only'];
  for (const tab of tabs) {
    const result = await getJobsFromTab(tab);
    assert(result.success, `Tab ${tab}: navigation success`);
    assert(result.count > 0, `Tab ${tab}: ${result.count} jobs found`);
  }
}

async function testLiveJobDetail() {
  section('Live Job Detail Extraction (Safari)');

  // First get a job URL from search
  const jobs = await searchJobs({ keywords: ['React'], sortBy: 'newest' });
  if (jobs.length === 0) {
    skip('No jobs found to test detail extraction');
    return;
  }

  const jobUrl = jobs[0].url;
  console.log(`  Testing detail for: ${jobs[0].title.substring(0, 50)}...`);

  const detail = await extractJobDetail(jobUrl);
  assert(detail !== null, `Detail extraction succeeded`);
  if (detail) {
    assert(!!detail.title, `Has title: ${detail.title.substring(0, 50)}`);
    assert(!!detail.fullDescription, `Has description (${detail.fullDescription.length} chars)`);
    assert(detail.connectsCost !== undefined, `Has connects cost: ${detail.connectsCost}`);
    assert(!!detail.experienceLevel, `Has experience level: ${detail.experienceLevel}`);
    assert(detail.clientInfo?.paymentVerified !== undefined, `Has client verified status`);
  }
}

async function testLiveFilters() {
  section('Live Filters (Safari)');

  // Navigate to search first
  await searchJobs({ keywords: ['Python'], paymentVerified: true });
  const filters = await getAvailableFilters();
  assert(!!filters.currentUrl, `Got current URL: ${filters.currentUrl?.substring(0, 60)}`);
}

async function testLiveBatchScore() {
  section('Live Batch Score (Safari)');

  const jobs = await searchJobs({ keywords: ['Node.js'], sortBy: 'newest' });
  if (jobs.length === 0) {
    skip('No jobs to batch score');
    return;
  }

  const scores = jobs.slice(0, 5).map(j =>
    scoreJob(j, ['Node.js', 'TypeScript', 'React', 'Express'], 500, 80)
  );

  assert(scores.length > 0, `Scored ${scores.length} jobs`);
  assert(scores.every(s => s.totalScore >= 0 && s.totalScore <= 100), 'All scores in 0-100 range');
  assert(scores.every(s => s.connectsRecommendation.suggestedConnects >= 2), 'All have connects >= 2');

  const apply = scores.filter(s => s.recommendation === 'apply').length;
  const maybe = scores.filter(s => s.recommendation === 'maybe').length;
  const skipCount = scores.filter(s => s.recommendation === 'skip').length;
  console.log(`  📊 Results: ${apply} apply, ${maybe} maybe, ${skipCount} skip`);
}

// ─── API Endpoint Tests ──────────────────────────────────────

async function testAPIEndpoints() {
  section('API Endpoint Tests (port 3104)');

  const BASE = 'http://localhost:3104';

  // Health
  try {
    const health = await fetch(`${BASE}/health`).then(r => r.json()) as any;
    assert(health.status === 'running', `Health endpoint: ${health.status}`);
  } catch {
    skip('Server not running on port 3104 — skipping API tests');
    return;
  }

  // Status
  const status = await fetch(`${BASE}/api/upwork/status`).then(r => r.json()) as any;
  assert(status.isOnUpwork !== undefined, `Status reports isOnUpwork: ${status.isOnUpwork}`);

  // Search
  const search = await fetch(`${BASE}/api/upwork/jobs/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: ['Python'], sortBy: 'newest' }),
  }).then(r => r.json()) as any;
  assert(search.count !== undefined, `Search returns count: ${search.count}`);

  // Tabs
  const tabResult = await fetch(`${BASE}/api/upwork/jobs/tab`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tab: 'best_matches' }),
  }).then(r => r.json()) as any;
  assert(tabResult.success !== undefined, `Tab endpoint works: ${tabResult.count} jobs`);

  // Score
  const scoreResult = await fetch(`${BASE}/api/upwork/jobs/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job: mockJob, preferredSkills: ['TypeScript'], minBudget: 500 }),
  }).then(r => r.json()) as any;
  assert(scoreResult.totalScore !== undefined, `Score endpoint: ${scoreResult.totalScore}`);
  assert(scoreResult.connectsRecommendation !== undefined, `Score has connects recommendation`);

  // Batch Score
  const batchResult = await fetch(`${BASE}/api/upwork/jobs/score-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobs: [mockJob, lowBudgetJob, hourlyJob], preferredSkills: ['TypeScript', 'React'] }),
  }).then(r => r.json()) as any;
  assert(batchResult.count === 3, `Batch scored 3 jobs`);
  assert(batchResult.applyCount !== undefined, `Batch has apply count`);

  // Rate limits
  const limits = await fetch(`${BASE}/api/upwork/rate-limits`).then(r => r.json()) as any;
  assert(limits.config !== undefined, `Rate limits endpoint works`);
}

// ─── Runner ──────────────────────────────────────────────────

async function main() {
  console.log('🧪 Upwork Automation Test Suite\n');
  console.log(`Mode: ${isLive ? '🔴 LIVE (Safari automation)' : '🟢 UNIT (no Safari)'}\n`);

  // Always run unit tests
  await testScoring();
  await testConnectsRecommendation();

  // API tests (if server running)
  await testAPIEndpoints();

  // Live tests (require --live flag + Safari + Upwork login)
  if (isLive) {
    await testLiveSearch();
    await testLiveTabs();
    await testLiveJobDetail();
    await testLiveFilters();
    await testLiveBatchScore();
  } else {
    console.log('\n⏭️  Skipping live Safari tests (pass --live to enable)\n');
  }

  // Summary
  console.log('\n════════════════════════════════════');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  ⏭️  Skipped: ${skipped}`);
  console.log('════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
