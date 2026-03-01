/**
 * Cloud Sync Engine — orchestrates platform polling and Supabase sync
 * 
 * CRITICAL: Uses Safari Gateway lock to prevent tab-switching chaos.
 * Polls platforms SEQUENTIALLY (one at a time) with lock acquisition
 * per platform, so only one platform's Safari tab is active at a time.
 * 
 * Architecture:
 *   - Single unified poll loop (not parallel per-type timers)
 *   - Gateway lock acquired before each platform, released after
 *   - 3s settle delay between platforms
 *   - Polling mutex prevents overlapping poll cycles
 *   - Action queue checked only between full poll cycles (no Safari needed)
 */
import { Platform, SyncConfig, DEFAULT_SYNC_CONFIG, PLATFORM_PORTS } from './types';
import { CloudSupabase, getCloudSupabase } from './supabase';
import { getPoller, BasePoller } from './pollers';
import { runAnomalyDetection } from './anomaly-detector';
import { runMentionMonitor } from './mention-monitor';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const LOCK_HOLDER = 'cloud-sync';
const SETTLE_DELAY_MS = 3000; // wait between platform switches
const LOCK_TIMEOUT_MS = 60000; // max time to hold lock per platform
const LOCK_WAIT_MS = 30000; // max time to wait for lock

interface PollResult {
  platform: Platform;
  dataType: string;
  itemsSynced: number;
  error?: string;
  durationMs: number;
}

export class SyncEngine {
  private config: SyncConfig;
  private db: CloudSupabase;
  private pollers: Map<Platform, BasePoller> = new Map();
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;
  private polling = false; // mutex — prevents overlapping poll cycles
  private lastResults: PollResult[] = [];
  private lastDMPoll = 0;
  private lastNotifPoll = 0;
  private lastStatsPoll = 0;
  private lastInvitationPoll = 0;
  private lastCommentsPoll = 0;
  private lastFollowerPoll = 0;
  private gatewayAvailable = false;

  constructor(config?: Partial<SyncConfig>) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.db = getCloudSupabase();

    for (const platform of this.config.platforms) {
      this.pollers.set(platform, getPoller(platform));
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log(`\n🔄 Cloud Sync Engine starting (SEQUENTIAL mode)...`);
    console.log(`   Platforms: ${this.config.platforms.join(', ')}`);
    console.log(`   DM poll: ${this.config.dmPollIntervalMs / 1000}s`);
    console.log(`   Notification poll: ${this.config.pollIntervalMs / 1000}s`);
    console.log(`   Stats poll: ${this.config.statsPollIntervalMs / 1000}s`);
    console.log(`   Comments poll: ${this.config.commentsPollIntervalMs / 1000}s`);
    console.log(`   Settle delay: ${SETTLE_DELAY_MS / 1000}s between platforms`);

    // Check gateway availability
    this.gatewayAvailable = await this.isGatewayAvailable();
    console.log(`   Safari Gateway: ${this.gatewayAvailable ? '✅ available (lock protocol ON)' : '⚠️  unavailable (sequential-only mode)'}`);

    // Check which services are healthy
    const healthChecks = await this.checkHealth();
    console.log(`\n   Health checks:`);
    for (const [platform, healthy] of Object.entries(healthChecks)) {
      console.log(`     ${healthy ? '✅' : '❌'} ${platform}`);
    }

    // Single unified poll loop — runs every 15s, checks what's due
    this.pollTimer = setInterval(() => this.pollCycle(), 15_000);

    // Run initial poll cycle
    this.pollCycle();

    console.log(`\n✅ Sync engine running (sequential, lock-aware)\n`);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Release any held lock
    await this.releaseLock().catch(() => {});
    console.log('🛑 Sync engine stopped');
  }

  // ─── Safari Gateway Lock ─────────────────────────────────
  private async isGatewayAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${GATEWAY_URL}/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  private async acquireLock(platform: Platform, task: string): Promise<boolean> {
    if (!this.gatewayAvailable) return true; // no gateway = proceed without lock
    try {
      const r = await fetch(`${GATEWAY_URL}/gateway/lock/acquire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holder: LOCK_HOLDER,
          platform,
          task: `cloud-sync: ${task}`,
          timeoutMs: LOCK_TIMEOUT_MS,
          waitMs: LOCK_WAIT_MS,
        }),
        signal: AbortSignal.timeout(LOCK_WAIT_MS + 5000),
      });
      if (!r.ok) return false;
      const data = await r.json() as { acquired?: boolean; success?: boolean };
      return data.acquired !== false && data.success !== false;
    } catch (e) {
      console.warn(`  ⚠️  Lock acquire failed for ${platform}: ${(e as Error).message}`);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (!this.gatewayAvailable) return;
    try {
      await fetch(`${GATEWAY_URL}/gateway/lock/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holder: LOCK_HOLDER }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {}
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Health ────────────────────────────────────────────
  async checkHealth(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [platform, poller] of this.pollers) {
      results[platform] = await poller.isServiceHealthy();
    }
    return results;
  }

  // ─── Unified Poll Cycle ────────────────────────────────
  // Runs every 15s. Checks what's due, then polls SEQUENTIALLY
  // with lock acquisition per platform.
  private async pollCycle(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;

    const now = Date.now();
    const dmsDue = now - this.lastDMPoll >= this.config.dmPollIntervalMs;
    const notifsDue = now - this.lastNotifPoll >= this.config.pollIntervalMs;
    const statsDue = now - this.lastStatsPoll >= this.config.statsPollIntervalMs;
    const invitationsDue = now - this.lastInvitationPoll >= this.config.invitationPollIntervalMs;
    const commentsDue = now - this.lastCommentsPoll >= this.config.commentsPollIntervalMs;
    const followersDue = now - this.lastFollowerPoll >= this.config.commentsPollIntervalMs; // same interval as comments

    if (!dmsDue && !notifsDue && !statsDue && !invitationsDue && !commentsDue && !followersDue) {
      // Nothing due — just check action queue (no Safari needed)
      if (this.config.enableActions) {
        await this.processActionQueue();
      }
      this.polling = false;
      return;
    }

    const results: PollResult[] = [];

    // Poll each platform SEQUENTIALLY
    for (const [platform, poller] of this.pollers) {
      if (!this.running) break;

      // Skip if service is offline (no need to acquire lock)
      if (!(await poller.isServiceHealthy())) {
        if (dmsDue) results.push({ platform, dataType: 'dms', itemsSynced: 0, error: 'service offline', durationMs: 0 });
        if (notifsDue) results.push({ platform, dataType: 'notifications', itemsSynced: 0, error: 'service offline', durationMs: 0 });
        if (statsDue) results.push({ platform, dataType: 'post_stats', itemsSynced: 0, error: 'service offline', durationMs: 0 });
        if (invitationsDue && platform === 'linkedin') results.push({ platform, dataType: 'invitations', itemsSynced: 0, error: 'service offline', durationMs: 0 });
        if (commentsDue && platform !== 'linkedin') results.push({ platform, dataType: 'comments', itemsSynced: 0, error: 'service offline', durationMs: 0 });
        continue;
      }

      // Acquire Safari Gateway lock for this platform
      const lockAcquired = await this.acquireLock(platform, `polling ${platform}`);
      if (!lockAcquired) {
        console.log(`  ⏳ [${platform}] Could not acquire lock, skipping this cycle`);
        results.push({ platform, dataType: 'all', itemsSynced: 0, error: 'lock busy', durationMs: 0 });
        continue;
      }

      try {
        console.log(`  🔒 [${platform}] Lock acquired, polling...`);

        // Poll all due data types for this platform while we hold the lock
        if (dmsDue) {
          results.push(await this.pollDataType(platform, poller, 'dms'));
        }
        if (notifsDue) {
          results.push(await this.pollDataType(platform, poller, 'notifications'));
        }
        if (statsDue) {
          results.push(await this.pollDataType(platform, poller, 'post_stats'));
        }
        if (invitationsDue && platform === 'linkedin') {
          results.push(await this.pollDataType(platform, poller, 'invitations'));
        }
        if (commentsDue && platform !== 'linkedin') {
          results.push(await this.pollDataType(platform, poller, 'comments'));
        }
        if (followersDue && poller.pollFollowers) {
          results.push(await this.pollDataType(platform, poller, 'followers'));
        }
      } finally {
        // Always release the lock
        await this.releaseLock();
        console.log(`  🔓 [${platform}] Lock released`);
      }

      // Settle delay between platforms — give Safari time to stabilize
      if (this.running) {
        await this.sleep(SETTLE_DELAY_MS);
      }
    }

    // Update last-poll timestamps
    if (dmsDue) this.lastDMPoll = Date.now();
    if (notifsDue) this.lastNotifPoll = Date.now();
    if (statsDue) this.lastStatsPoll = Date.now();
    if (invitationsDue) this.lastInvitationPoll = Date.now();
    if (commentsDue) this.lastCommentsPoll = Date.now();
    if (followersDue) this.lastFollowerPoll = Date.now();

    this.lastResults = results;

    // Run anomaly detection after post_stats sync (no Safari needed — pure DB)
    if (statsDue) {
      try {
        const anomalyResult = await runAnomalyDetection(this.db.getClient());
        if (anomalyResult.detected > 0) {
          console.log(`  🔍 Anomaly detection: ${anomalyResult.detected} detected, ${anomalyResult.persisted} persisted, ${anomalyResult.queued} queued`);
        }
      } catch (e) {
        console.error(`  ⚠️ Anomaly detection error: ${(e as Error).message}`);
      }
    }

    // Run mention monitoring after comments sync (scans DB + live services)
    if (commentsDue) {
      try {
        const mentionResult = await runMentionMonitor(this.db.getClient(), this.config.platforms);
        if (mentionResult.newMentions > 0) {
          console.log(`  📣 Mention monitor: ${mentionResult.newMentions} new mentions across ${mentionResult.scanned} platforms`);
        }
      } catch (e) {
        console.error(`  ⚠️ Mention monitor error: ${(e as Error).message}`);
      }
    }

    // Process action queue (no Safari lock needed — just reads from Supabase)
    if (this.config.enableActions) {
      await this.processActionQueue();
    }

    this.polling = false;
  }

  // ─── Poll a single data type for a single platform ────
  private async pollDataType(platform: Platform, poller: BasePoller, dataType: 'dms' | 'notifications' | 'post_stats' | 'invitations' | 'comments' | 'followers'): Promise<PollResult> {
    const start = Date.now();
    try {
      let synced = 0;

      switch (dataType) {
        case 'dms': {
          const dms = await poller.pollDMs();
          synced = await this.db.syncDMs(dms);
          break;
        }
        case 'notifications': {
          const notifs = await poller.pollNotifications();
          synced = await this.db.syncNotifications(notifs);
          break;
        }
        case 'post_stats': {
          const stats = await poller.pollPostStats();
          synced = await this.db.syncPostStats(stats);
          break;
        }
        case 'invitations': {
          if (poller.pollInvitations) {
            const invitations = await poller.pollInvitations();
            synced = await this.db.syncInvitations(invitations);
          }
          break;
        }
        case 'comments': {
          if (poller.pollComments) {
            const comments = await poller.pollComments();
            synced = await this.db.syncComments(comments);
          }
          break;
        }
        case 'followers': {
          if (poller.pollFollowers) {
            const followers = await poller.pollFollowers();
            synced = await this.db.syncFollowerEvents(followers);
          }
          break;
        }
      }

      await this.db.upsertPollState(platform, dataType, {
        items_synced: synced,
        last_poll_at: new Date().toISOString(),
      });

      const icons: Record<string, string> = { dms: '📨', notifications: '🔔', post_stats: '📊', invitations: '🤝', comments: '💬', followers: '👥' };
      if (synced > 0) console.log(`  ${icons[dataType] || '📋'} [${platform}] Synced ${synced} ${dataType}`);
      return { platform, dataType, itemsSynced: synced, durationMs: Date.now() - start };
    } catch (e) {
      const err = (e as Error).message;
      console.error(`  ❌ [${platform}] ${dataType} poll error: ${err}`);
      await this.db.upsertPollState(platform, dataType as any, { error: err });
      return { platform, dataType, itemsSynced: 0, error: err, durationMs: Date.now() - start };
    }
  }

  // ─── Run all polls (manual trigger) ────────────────────
  async runAllPolls(): Promise<PollResult[]> {
    // Force all timestamps to 0 so everything is "due"
    this.lastDMPoll = 0;
    this.lastNotifPoll = 0;
    this.lastStatsPoll = 0;
    this.lastCommentsPoll = 0;
    // Wait for current cycle to finish if one is running
    while (this.polling) await this.sleep(500);
    await this.pollCycle();
    return this.lastResults;
  }

  async pollAllDMs(): Promise<PollResult[]> {
    this.lastDMPoll = 0;
    while (this.polling) await this.sleep(500);
    await this.pollCycle();
    return this.lastResults.filter(r => r.dataType === 'dms');
  }

  async pollAllNotifications(): Promise<PollResult[]> {
    this.lastNotifPoll = 0;
    while (this.polling) await this.sleep(500);
    await this.pollCycle();
    return this.lastResults.filter(r => r.dataType === 'notifications');
  }

  async pollAllPostStats(): Promise<PollResult[]> {
    this.lastStatsPoll = 0;
    while (this.polling) await this.sleep(500);
    await this.pollCycle();
    return this.lastResults.filter(r => r.dataType === 'post_stats');
  }

  // ─── Action Queue Processing ───────────────────────────
  // Actions DO need the Safari lock since they perform browser actions
  async processActionQueue(): Promise<void> {
    const actions = await this.db.getPendingActions(5);
    if (!actions.length) return;

    for (const action of actions) {
      // Acquire lock for the action's platform
      const lockAcquired = await this.acquireLock(action.platform as Platform, `action: ${action.action_type}`);
      if (!lockAcquired) {
        console.log(`  ⏳ Action ${action.id} skipped — lock busy`);
        continue;
      }

      try {
        console.log(`  ⚡ Executing action: ${action.action_type} on ${action.platform}`);
        await this.db.updateAction(action.id, 'running');
        const result = await this.executeAction(action);
        await this.db.updateAction(action.id, 'completed', result);
        console.log(`  ✅ Action ${action.id} completed`);
      } catch (e) {
        const err = (e as Error).message;
        await this.db.updateAction(action.id, 'failed', undefined, err);
        console.error(`  ❌ Action ${action.id} failed: ${err}`);
      } finally {
        await this.releaseLock();
      }

      await this.sleep(SETTLE_DELAY_MS);
    }
  }

  private async executeAction(action: any): Promise<any> {
    const servicePort = this.getServicePort(action.platform, action.action_type);
    const baseUrl = `http://localhost:${servicePort}`;

    switch (action.action_type) {
      case 'reply_dm': {
        const r = await fetch(`${baseUrl}/api/messages/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: action.target_username,
            text: action.params.message || action.params.text,
          }),
        });
        return await r.json();
      }
      case 'reply_comment': {
        const r = await fetch(`${baseUrl}/api/comment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postUrl: action.target_post_url,
            text: action.params.message || action.params.text,
          }),
        });
        return await r.json();
      }
      case 'follow_back': {
        const r = await fetch(`${baseUrl}/api/follow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: action.target_username }),
        });
        return await r.json();
      }
      case 'like_post': {
        const r = await fetch(`${baseUrl}/api/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postUrl: action.target_post_url }),
        });
        return await r.json();
      }
      default:
        throw new Error(`Unknown action type: ${action.action_type}`);
    }
  }

  private getServicePort(platform: Platform, actionType: string): number {
    if (actionType === 'reply_dm') {
      return PLATFORM_PORTS[`${platform}-dm`] || 3100;
    }
    if (['reply_comment', 'like_post'].includes(actionType)) {
      return PLATFORM_PORTS[`${platform}-comments`] || 3005;
    }
    return PLATFORM_PORTS[`${platform}-dm`] || PLATFORM_PORTS[platform] || 3100;
  }

  // ─── Status ────────────────────────────────────────────
  getStatus(): {
    running: boolean;
    polling: boolean;
    platforms: string[];
    gatewayLock: boolean;
    lastResults: PollResult[];
  } {
    return {
      running: this.running,
      polling: this.polling,
      platforms: this.config.platforms,
      gatewayLock: this.gatewayAvailable,
      lastResults: this.lastResults,
    };
  }
}
