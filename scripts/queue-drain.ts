#!/usr/bin/env npx tsx
/**
 * Publish Queue Drain — Process queued videos until empty or limit hit
 * ====================================================================
 * Loops the Blotato queue processor with rate-limit awareness.
 *
 * Usage:
 *   npx tsx scripts/queue-drain.ts                    # Drain queue (default: 3 retries on rate limit)
 *   npx tsx scripts/queue-drain.ts --max-published 10 # Stop after 10 publishes
 *   npx tsx scripts/queue-drain.ts --max-rounds 20    # Max processing rounds
 *   npx tsx scripts/queue-drain.ts --wait 120         # Wait 120s between rate-limited rounds
 *   npx tsx scripts/queue-drain.ts --batch-size 3     # Process 3 per round
 *   npx tsx scripts/queue-drain.ts --status           # Show queue status only
 *   npx tsx scripts/queue-drain.ts --persistent       # Keep running until queue empty (long-running)
 */

const BACKEND = 'http://localhost:5555';

async function api(ep: string, method = 'GET', body?: any): Promise<any> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${BACKEND}${ep}`, opts);
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

async function getQueueStatus(): Promise<{ queued: number; published: number; items: any[] }> {
  const [queued, published] = await Promise.all([
    api('/api/publish-controls/queue?status=queued'),
    api('/api/publish-controls/queue?status=published'),
  ]);
  return {
    queued: (queued.items || []).length,
    published: (published.items || []).length,
    items: queued.items || [],
  };
}

async function showStatus(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   📊 PUBLISH QUEUE STATUS                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  try {
    const status = await getQueueStatus();
    console.log(`\n  Queued:    ${status.queued}`);
    console.log(`  Published: ${status.published}`);

    if (status.items.length > 0) {
      console.log(`\n  📋 Queued items:`);
      for (const i of status.items) {
        console.log(`    [${i.platform}] ${(i.title || '?').slice(0, 55)}`);
      }
    }

    const controlStatus = await api('/api/publish-controls/status');
    const daily = controlStatus.daily_summary || {};
    console.log(`\n  Daily published: ${daily.global_published || 0}/${daily.global_limit || '∞'}`);
    const windows = controlStatus.config?.posting_windows;
    if (windows) {
      console.log(`  Posting window:  ${windows.start} - ${windows.end} ${windows.tz}`);
    }
  } catch (e: any) {
    console.log(`\n  ❌ Backend unavailable: ${e.message}`);
  }
}

interface DrainOptions {
  maxPublished: number;
  maxRounds: number;
  waitMs: number;
  batchSize: number;
  persistent: boolean;
  maxRateLimitRetries: number;
}

async function drain(opts: DrainOptions): Promise<{ published: number; remaining: number; rounds: number }> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   📤 QUEUE DRAIN — Processing publish queue                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Pre-flight check
  const initial = await getQueueStatus();
  log(`Queue: ${initial.queued} queued, ${initial.published} published`);

  if (initial.queued === 0) {
    log('✅ Queue is empty — nothing to drain');
    return { published: 0, remaining: 0, rounds: 0 };
  }

  log(`Config: batch=${opts.batchSize}, maxPublished=${opts.maxPublished}, maxRounds=${opts.maxRounds}, wait=${opts.waitMs}ms`);
  if (opts.persistent) log('🔄 Persistent mode — will keep retrying until queue empty');

  let totalPublished = 0;
  let consecutiveRateLimits = 0;
  let remaining = initial.queued;

  for (let round = 1; round <= opts.maxRounds; round++) {
    log(`\n── Round ${round}/${opts.maxRounds} ──`);

    try {
      const result = await api(`/api/publish-controls/process/batch?max_items=${opts.batchSize}`, 'POST');
      const published = result.published || 0;
      const processed = result.processed || 0;

      for (const r of result.results || []) {
        if (r.success) {
          const platform = r.result?.steps?.publish?.platform || 'ok';
          const postId = r.result?.post_submission_id?.slice(0, 12) || '';
          log(`  ✅ Published → ${platform} (${postId}...)`);
          consecutiveRateLimits = 0;
        } else if (r.reason === 'rate_limited') {
          log(`  ⏳ Rate limited`);
          consecutiveRateLimits++;
        } else {
          log(`  ❌ ${r.reason || 'failed'}`);
        }
      }

      totalPublished += published;

      // Check remaining
      const status = await getQueueStatus();
      remaining = status.queued;
      log(`  📊 Published: ${totalPublished} total | Remaining: ${remaining}`);

      // Exit conditions
      if (remaining === 0) {
        log('\n✅ Queue fully drained!');
        break;
      }

      if (totalPublished >= opts.maxPublished) {
        log(`\n⏸️  Hit publish limit (${opts.maxPublished}). ${remaining} items remaining.`);
        break;
      }

      if (!opts.persistent && consecutiveRateLimits >= opts.maxRateLimitRetries) {
        log(`\n⏸️  Rate limited ${opts.maxRateLimitRetries}x. ${remaining} items will process later.`);
        break;
      }

      // Wait between rounds
      if (published > 0) {
        // Just published — short wait to respect rate limit
        const shortWait = Math.max(35_000, opts.waitMs / 2);
        log(`  Waiting ${Math.round(shortWait / 1000)}s...`);
        await sleep(shortWait);
      } else if (consecutiveRateLimits > 0) {
        // Rate limited — longer wait
        const longWait = opts.persistent ? opts.waitMs : opts.waitMs * consecutiveRateLimits;
        log(`  Rate limited — waiting ${Math.round(longWait / 1000)}s...`);
        await sleep(longWait);
      }
    } catch (e: any) {
      log(`  ❌ Error: ${e.message}`);
      if (!opts.persistent) break;
      log(`  Retrying in ${Math.round(opts.waitMs / 1000)}s...`);
      await sleep(opts.waitMs);
    }
  }

  log(`\n${'═'.repeat(64)}`);
  log(`  DRAIN COMPLETE: ${totalPublished} published, ${remaining} remaining`);
  log(`${'═'.repeat(64)}\n`);

  return { published: totalPublished, remaining, rounds: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    await showStatus();
    return;
  }

  const maxPublished = parseInt(args[args.indexOf('--max-published') + 1] || '20');
  const maxRounds = parseInt(args[args.indexOf('--max-rounds') + 1] || '15');
  const waitMs = parseInt(args[args.indexOf('--wait') + 1] || '120') * 1000;
  const batchSize = parseInt(args[args.indexOf('--batch-size') + 1] || '4');
  const persistent = args.includes('--persistent');
  const maxRateLimitRetries = persistent ? 999 : 3;

  // Check backend
  try { await api('/health'); } catch {
    console.log('❌ Backend not running at ' + BACKEND);
    process.exit(1);
  }

  const result = await drain({
    maxPublished,
    maxRounds: persistent ? 100 : maxRounds,
    waitMs,
    batchSize,
    persistent,
    maxRateLimitRetries,
  });

  process.exit(result.remaining > 0 && !persistent ? 0 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
