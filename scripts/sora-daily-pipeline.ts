#!/usr/bin/env npx tsx
/**
 * Sora Daily Pipeline — Full Automated Flow
 * ==========================================
 * End-to-end: Generate → Clean → Register → Catalog → Queue → Drain
 *
 * Usage:
 *   npx tsx scripts/sora-daily-pipeline.ts                          # Full daily run
 *   npx tsx scripts/sora-daily-pipeline.ts --dry-run                # Preview everything
 *   npx tsx scripts/sora-daily-pipeline.ts --skip-generate          # Queue + drain only (use existing catalog)
 *   npx tsx scripts/sora-daily-pipeline.ts --skip-drain             # Generate + queue, don't drain
 *   npx tsx scripts/sora-daily-pipeline.ts --generate-only          # Generate new videos only
 *   npx tsx scripts/sora-daily-pipeline.ts --drain-only             # Drain publish queue only
 *   npx tsx scripts/sora-daily-pipeline.ts --mode offers --count 4  # Override generation params
 *   npx tsx scripts/sora-daily-pipeline.ts --queue-count 6          # Override queue count
 *   npx tsx scripts/sora-daily-pipeline.ts --platforms youtube,tiktok
 *   npx tsx scripts/sora-daily-pipeline.ts --status                 # Show pipeline status
 */

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BACKEND = 'http://localhost:5555';

const EXEC_OPTS: ExecSyncOptionsWithStringEncoding = {
  cwd: PROJECT_ROOT,
  encoding: 'utf-8',
  stdio: 'pipe',
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(msg); }
function section(title: string) {
  log(`\n${'═'.repeat(64)}`);
  log(`  ${title}`);
  log(`${'═'.repeat(64)}`);
}

async function api(ep: string, method = 'GET', body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND}${ep}`, opts);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function backendHealthy(): Promise<boolean> {
  try { await api('/health'); return true; } catch { return false; }
}

function run(cmd: string, opts?: { timeout?: number; inherit?: boolean }): string {
  try {
    if (opts?.inherit) {
      execSync(cmd, { ...EXEC_OPTS, stdio: 'inherit', timeout: opts.timeout });
      return '';
    }
    return execSync(cmd, { ...EXEC_OPTS, timeout: opts?.timeout }).toString().trim();
  } catch (e: any) {
    const output = e.stdout?.toString() || '';
    const err = e.stderr?.toString() || e.message;
    log(`  ❌ Command failed: ${err.slice(0, 200)}`);
    return output;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: GENERATE NEW SORA VIDEOS
// ─────────────────────────────────────────────────────────────────────────────

async function stepGenerate(mode: string, count: number, dryRun: boolean): Promise<boolean> {
  section('STEP 1: Generate New Sora Videos');
  log(`  Mode: ${mode} | Count: ${count}${dryRun ? ' | DRY RUN' : ''}`);

  const flags = dryRun ? '--dry-run' : '--generate';
  const cmd = `npx tsx scripts/sora-content-generator.ts --mode ${mode} --count ${count} ${flags}`;
  log(`  Running: ${cmd}\n`);

  run(cmd, { timeout: 45 * 60 * 1000, inherit: true }); // 45 min for Sora gen + watermarks
  log('\n  ✅ Generation step complete');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: REBUILD CATALOG
// ─────────────────────────────────────────────────────────────────────────────

function stepCatalog(): boolean {
  section('STEP 2: Rebuild Content Catalog');
  run('npx tsx scripts/daily-content-pipeline.ts --catalog', { timeout: 30_000, inherit: true });
  log('\n  ✅ Catalog rebuilt');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: QUEUE VIDEOS FOR PUBLISHING
// ─────────────────────────────────────────────────────────────────────────────

function stepQueue(count: number, platforms: string[], dryRun: boolean): boolean {
  section('STEP 3: Queue Videos for Publishing');
  log(`  Count: ${count} | Platforms: ${platforms.join(', ')}${dryRun ? ' | DRY RUN' : ''}`);

  const dryFlag = dryRun ? ' --dry-run' : '';
  for (const platform of platforms) {
    const cmd = `npx tsx scripts/daily-content-pipeline.ts --count ${count} --platform ${platform}${dryFlag}`;
    log(`\n  Running: ${cmd}\n`);
    run(cmd, { timeout: 60_000, inherit: true });
  }
  log('\n  ✅ Queuing step complete');
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: DRAIN PUBLISH QUEUE
// ─────────────────────────────────────────────────────────────────────────────

async function stepDrain(maxItems: number, dryRun: boolean): Promise<{ published: number; remaining: number }> {
  section('STEP 4: Drain Publish Queue');

  if (dryRun) {
    log('  🧪 DRY RUN — skipping drain');
    return { published: 0, remaining: 0 };
  }

  let totalPublished = 0;
  let consecutiveRateLimits = 0;
  const MAX_RATE_LIMIT_RETRIES = 3;
  const RATE_LIMIT_WAIT_MS = 2 * 60 * 1000; // 2 min between retry bursts
  let remaining = 0;

  for (let round = 1; round <= 10; round++) {
    log(`\n  📤 Drain round ${round}...`);
    try {
      const result = await api(`/api/publish-controls/process/batch?max_items=${maxItems}`, 'POST');
      const published = result.published || 0;
      const processed = result.processed || 0;
      totalPublished += published;

      log(`    Processed: ${processed}, Published: ${published}`);
      for (const r of result.results || []) {
        if (r.success) {
          log(`    ✅ ${r.result?.steps?.publish?.platform || 'ok'} → ${r.result?.post_submission_id?.slice(0, 12) || ''}...`);
          consecutiveRateLimits = 0;
        } else {
          log(`    ⏳ ${r.reason || 'failed'}`);
          if (r.reason === 'rate_limited') consecutiveRateLimits++;
        }
      }

      // Check remaining queue
      const queueStatus = await api('/api/publish-controls/queue?status=queued');
      remaining = (queueStatus.items || []).length;
      log(`    📊 Remaining in queue: ${remaining}`);

      if (remaining === 0) {
        log('\n  ✅ Queue fully drained!');
        break;
      }

      if (consecutiveRateLimits >= MAX_RATE_LIMIT_RETRIES) {
        log(`\n  ⏸️  Hit rate limit ${MAX_RATE_LIMIT_RETRIES}x — stopping drain (${remaining} items will process later)`);
        break;
      }

      if (published > 0) {
        log(`    Waiting 35s for rate limit cooldown...`);
        await sleep(35_000);
      } else {
        log(`    Waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry...`);
        await sleep(RATE_LIMIT_WAIT_MS);
      }
    } catch (e: any) {
      log(`    ❌ Error: ${e.message}`);
      break;
    }
  }

  log(`\n  📊 Drain complete: ${totalPublished} published, ${remaining} remaining`);
  return { published: totalPublished, remaining };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────────────────────────────────────

async function showStatus(): Promise<void> {
  section('SORA PIPELINE STATUS');

  // Backend
  const healthy = await backendHealthy();
  log(`  Backend: ${healthy ? '✅ running' : '❌ down'}`);

  if (healthy) {
    try {
      const status = await api('/api/publish-controls/status');
      const daily = status.daily_summary || {};
      const queue = status.queue_stats || {};
      log(`  Published today: ${daily.global_published || 0}/${daily.global_limit || '∞'}`);
      log(`  Queue: ${JSON.stringify(queue.by_status || {})}`);
    } catch { /* ignore */ }

    try {
      const queued = await api('/api/publish-controls/queue?status=queued');
      const items = queued.items || [];
      log(`\n  📋 Queued (${items.length}):`);
      for (const i of items) log(`    [${i.platform}] ${i.title?.slice(0, 50)}`);
    } catch { /* ignore */ }
  }

  // Catalog
  const fs = await import('fs');
  const catalogPath = path.join(process.env.HOME || '', 'sora-videos', 'daily-pipeline-catalog.json');
  if (fs.existsSync(catalogPath)) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    log(`\n  📊 Catalog: ${catalog.totalAvailable} available / ${catalog.totalVideos} total`);
    for (const [batch, count] of Object.entries(catalog.batches || {})) {
      log(`    ${batch}: ${count}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Flags
  const dryRun = args.includes('--dry-run');
  const skipGenerate = args.includes('--skip-generate');
  const skipDrain = args.includes('--skip-drain');
  const generateOnly = args.includes('--generate-only');
  const drainOnly = args.includes('--drain-only');
  const statusOnly = args.includes('--status');

  // Params
  const mode = args[args.indexOf('--mode') + 1] || 'mix';
  const count = parseInt(args[args.indexOf('--count') + 1] || '6');
  const queueCount = parseInt(args[args.indexOf('--queue-count') + 1] || '4');
  const drainMax = parseInt(args[args.indexOf('--drain-max') + 1] || '4');
  const platformsArg = args[args.indexOf('--platforms') + 1] || 'youtube';
  const platforms = platformsArg.split(',');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🚀 SORA DAILY PIPELINE — @isaiahdupree                   ║');
  console.log('║   Generate → Clean → Register → Catalog → Queue → Publish  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toISOString().split('T')[0]} ${new Date().toLocaleTimeString()}`);

  if (statusOnly) { await showStatus(); return; }

  console.log(`🎯 Generate: ${mode} × ${count} | Queue: ${queueCount} | Platforms: ${platforms.join(', ')}`);
  if (dryRun) console.log('🧪 DRY RUN MODE');
  if (skipGenerate) console.log('⏩ Skipping generation');
  if (skipDrain) console.log('⏩ Skipping queue drain');
  if (generateOnly) console.log('🎬 Generate only mode');
  if (drainOnly) console.log('📤 Drain only mode');

  // Check backend
  const healthy = await backendHealthy();
  if (!healthy && !dryRun) {
    if (!generateOnly) {
      console.log('\n❌ MediaPoster backend not running at ' + BACKEND);
      console.log('   Start it: cd ~/Documents/Software/MediaPoster/Backend && bash start.sh');
      process.exit(1);
    }
  }

  const startTime = Date.now();
  let genResult = true;
  let drainResult = { published: 0, remaining: 0 };

  // Step 1: Generate
  if (!skipGenerate && !drainOnly) {
    genResult = await stepGenerate(mode, count, dryRun);
  }

  // Step 2: Catalog
  if (!drainOnly) {
    stepCatalog();
  }

  // Step 3: Queue
  if (!generateOnly && !drainOnly) {
    stepQueue(queueCount, platforms, dryRun);
  }

  // Step 4: Drain
  if (!skipDrain && !generateOnly) {
    drainResult = await stepDrain(drainMax, dryRun);
  }

  // Summary
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  section('PIPELINE SUMMARY');
  log(`  Generated:   ${skipGenerate || drainOnly ? 'skipped' : genResult ? '✅' : '❌'}`);
  log(`  Catalog:     ${drainOnly ? 'skipped' : '✅ rebuilt'}`);
  log(`  Queue:       ${generateOnly || drainOnly ? 'skipped' : `${queueCount} targeted → ${platforms.join(', ')}`}`);
  log(`  Published:   ${drainResult.published}`);
  log(`  Remaining:   ${drainResult.remaining}`);
  log(`  Duration:    ${Math.floor(elapsed / 60)}m ${elapsed % 60}s`);
  if (dryRun) log('  Mode:        DRY RUN');
  log('');
}

main().catch(e => { console.error(e); process.exit(1); });
