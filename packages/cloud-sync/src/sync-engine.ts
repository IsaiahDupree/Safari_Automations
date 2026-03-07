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
import { writePlatformCache, CACHE_TTLS } from './cache-writer';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3085';
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
  // Runs every 15s. Checks what's due, then polls SEQUENTIALLY.
  // All data types run 24/7 — pollers read from safari_platform_cache only.
  private async pollCycle(): Promise<void> {
    if (!this.running || this.polling) return;
    this.polling = true;

    const now = Date.now();
    const dmsDue = now - this.lastDMPoll >= this.config.dmPollIntervalMs;
    const notifsDue = now - this.lastNotifPoll >= this.config.pollIntervalMs;
    const statsDue = now - this.lastStatsPoll >= this.config.statsPollIntervalMs;
    const invitationsDue = now - this.lastInvitationPoll >= this.config.invitationPollIntervalMs;
    const commentsDue = now - this.lastCommentsPoll >= this.config.commentsPollIntervalMs;
    const followersDue = now - this.lastFollowerPoll >= this.config.commentsPollIntervalMs;

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

      // YouTube uses a pure REST API — no Safari navigation, no lock needed
      if (platform === 'youtube') {
        const youtubeStatsDue = now - this.lastStatsPoll >= this.config.statsPollIntervalMs;
        if (youtubeStatsDue) {
          results.push(await this.pollDataType(platform, poller, 'post_stats'));
          this.lastStatsPoll = Date.now();
        }
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
      // ── Cache-first strategy (SDPA-013) ──────────────────
      // 1. Check safari_platform_cache for non-expired data
      // 2. If fresh cache → sync from cache
      // 3. If cache miss → call poller (which is cache-only — returns [] on miss)
      const cached = await this.db.getPlatformCache(platform, dataType);
      if (cached !== null && cached.length > 0) {
        console.log(`  📦 [${platform}] Cache hit for ${dataType} (${cached.length} items)`);
        let synced = 0;
        switch (dataType) {
          case 'dms':           synced = await this.db.syncDMs(cached); break;
          case 'notifications': synced = await this.db.syncNotifications(cached); break;
          case 'post_stats':    synced = await this.db.syncPostStats(cached); break;
          case 'invitations':   synced = await this.db.syncInvitations(cached); break;
          case 'comments':      synced = await this.db.syncComments(cached); break;
          case 'followers':     synced = await this.db.syncFollowerEvents(cached); break;
        }
        await this.db.upsertPollState(platform, dataType, { items_synced: synced, last_poll_at: new Date().toISOString() });
        return { platform, dataType, itemsSynced: synced, durationMs: Date.now() - start };
      }

      let synced = 0;

      switch (dataType) {
        case 'dms': {
          const dms = await poller.pollDMs();
          synced = await this.db.syncDMs(dms);
          if (dms.length > 0) await writePlatformCache(platform, dataType, dms, CACHE_TTLS.dms);
          break;
        }
        case 'notifications': {
          const notifs = await poller.pollNotifications();
          synced = await this.db.syncNotifications(notifs);
          if (notifs.length > 0) await writePlatformCache(platform, dataType, notifs, CACHE_TTLS.notifications);
          break;
        }
        case 'post_stats': {
          const stats = await poller.pollPostStats();
          synced = await this.db.syncPostStats(stats);
          if (stats.length > 0) await writePlatformCache(platform, dataType, stats, CACHE_TTLS.post_stats);
          break;
        }
        case 'invitations': {
          if (poller.pollInvitations) {
            const invitations = await poller.pollInvitations();
            synced = await this.db.syncInvitations(invitations);
            if (invitations.length > 0) await writePlatformCache(platform, dataType, invitations, CACHE_TTLS.invitations);
          }
          break;
        }
        case 'comments': {
          if (poller.pollComments) {
            const comments = await poller.pollComments();
            synced = await this.db.syncComments(comments);
            if (comments.length > 0) await writePlatformCache(platform, dataType, comments, CACHE_TTLS.comments);
          }
          break;
        }
        case 'followers': {
          if (poller.pollFollowers) {
            const followers = await poller.pollFollowers();
            synced = await this.db.syncFollowerEvents(followers);
            if (followers.length > 0) await writePlatformCache(platform, dataType, followers, CACHE_TTLS.followers);
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

  // Read-only actions that don't navigate Safari — skip lock acquisition
  private readonly NO_LOCK_ACTIONS = new Set([
    'get_crm_top', 'get_conversations', 'fetch_profile',
    'get_tweet_metrics', 'get_upwork_jobs', 'get_research_results',
    'get_post_metrics', 'get_profile_posts',
  ]);

  // ─── Action Queue Processing ───────────────────────────
  // Write/navigation actions acquire the Safari Gateway lock.
  // Read-only actions (NO_LOCK_ACTIONS) run immediately without lock.
  async processActionQueue(): Promise<void> {
    const actions = await this.db.getPendingActions(5);
    if (!actions.length) return;

    for (const action of actions) {
      const needsLock = !this.NO_LOCK_ACTIONS.has(action.action_type);

      if (needsLock) {
        const lockAcquired = await this.acquireLock(action.platform as Platform, `action: ${action.action_type}`);
        if (!lockAcquired) {
          console.log(`  ⏳ Action ${action.id} (${action.action_type}) skipped — lock busy`);
          continue;
        }
      }

      try {
        console.log(`  ⚡ Executing action: ${action.action_type} on ${action.platform} ${needsLock ? '(lock)' : '(no-lock)'}`);
        await this.db.updateAction(action.id, 'running');
        const result = await this.executeAction(action);
        await this.db.updateAction(action.id, 'completed', result);
        console.log(`  ✅ Action ${action.id} completed`);
      } catch (e) {
        const err = (e as Error).message;
        await this.db.updateAction(action.id, 'failed', undefined, err);
        console.error(`  ❌ Action ${action.id} failed: ${err}`);
      } finally {
        if (needsLock) await this.releaseLock();
      }

      if (needsLock) await this.sleep(SETTLE_DELAY_MS);
    }
  }

  // ── Accurate endpoint map — verified against each service's server.ts ──────
  // Port reference:
  //   instagram-dm:      3100  twitter-dm:    3003  tiktok-dm:     3102
  //   linkedin-dm:       3105  threads-dm:    3004
  //   instagram-comments:3005  twitter-comments:3007 tiktok-comments:3006
  //   upwork-automation: 3107  market-research: 3106
  private readonly DM_PORTS: Record<string, number> = {
    instagram: 3100, twitter: 3003, tiktok: 3102, linkedin: 3105, threads: 3004,
  };
  private readonly COMMENT_PORTS: Record<string, number> = {
    instagram: 3005, twitter: 3007, tiktok: 3006, threads: 3004,
  };

  private async executeAction(action: any): Promise<any> {
    const { platform, action_type, target_username, target_post_url, params = {} } = action;
    const text = params.message || params.text || '';

    const dmBase  = `http://localhost:${this.DM_PORTS[platform] || 3100}`;
    const cmtBase = `http://localhost:${this.COMMENT_PORTS[platform] || 3005}`;

    const post = async (base: string, path: string, body: object) => {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token-12345' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}${path}`);
      return r.json();
    };

    const get = async (base: string, path: string) => {
      const r = await fetch(`${base}${path}`, {
        headers: { 'Authorization': 'Bearer test-token-12345' },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${base}${path}`);
      return r.json();
    };

    switch (action_type) {

      // ── DMs ────────────────────────────────────────────────────────────────
      case 'send_dm':
      case 'reply_dm': {
        // Each platform has its own send-to endpoint path
        const dmPaths: Record<string, string> = {
          instagram: '/api/messages/send-to',           // body: {username, text}
          twitter:   '/api/twitter/messages/send-to',  // body: {username, text}
          tiktok:    '/api/tiktok/messages/send-to',   // body: {username, text}
          linkedin:  '/api/linkedin/messages/send-to', // body: {profileUrl, text}
          threads:   '/api/messages/send-to',          // body: {username, text}
        };
        const path = dmPaths[platform] || dmPaths.instagram;
        return post(dmBase, path, { username: target_username, profileUrl: params.profileUrl, text });
      }

      // ── Comments ───────────────────────────────────────────────────────────
      case 'reply_comment':
      case 'post_comment': {
        const commentPaths: Record<string, string> = {
          instagram: '/api/instagram/comments/post',  // body: {postUrl, text}
          twitter:   '/api/twitter/tweet/reply',      // body: {tweetUrl, text}
          tiktok:    '/api/tiktok/comments/post',     // body: {videoUrl, text}
          threads:   '/api/threads/comments/post',    // body: {postUrl, text}
        };
        const path = commentPaths[platform] || commentPaths.instagram;
        const body = platform === 'twitter'
          ? { tweetUrl: target_post_url, text }
          : platform === 'tiktok'
          ? { videoUrl: target_post_url, text }
          : { postUrl: target_post_url, text };
        return post(cmtBase, path, body);
      }

      // ── Twitter-specific ───────────────────────────────────────────────────
      case 'compose_tweet': {
        return post(cmtBase, '/api/twitter/tweet', { text, options: params.options });
      }
      case 'search_and_reply': {
        return post(cmtBase, '/api/twitter/search-and-reply', {
          query: params.query,
          replyText: text,
          maxReplies: params.maxReplies || 3,
        });
      }
      case 'like_tweet': {
        return post(cmtBase, '/api/twitter/tweet/like', { tweetUrl: target_post_url });
      }
      case 'retweet': {
        return post(cmtBase, '/api/twitter/tweet/retweet', { tweetUrl: target_post_url });
      }
      case 'get_tweet_metrics': {
        return get(cmtBase, `/api/twitter/tweet/metrics?tweetUrl=${encodeURIComponent(target_post_url || '')}`);
      }
      case 'twitter_comment_sweep': {
        return post(cmtBase, '/api/twitter/comment-sweep', {
          postUrl: target_post_url,
          maxComments: params.maxComments || 50,
        });
      }

      // ── Instagram-specific ─────────────────────────────────────────────────
      case 'get_post_metrics': {
        // Navigate to post then fetch metrics
        await post(cmtBase, '/api/instagram/navigate', { url: target_post_url });
        return get(cmtBase, '/api/instagram/post/metrics');
      }
      case 'get_profile_posts': {
        return get(cmtBase, `/api/instagram/profile/posts?username=${encodeURIComponent(target_username || '')}`);
      }

      // ── Prospect discovery ─────────────────────────────────────────────────
      case 'discover_prospects': {
        return post(dmBase, '/api/prospect/discover', {
          hashtag: params.hashtag,
          keyword: params.keyword,
          maxProfiles: params.maxProfiles || 10,
        });
      }
      case 'dm_top_prospects': {
        return post(dmBase, '/api/prospect/dm-top-n', { n: params.n || 5, message: text });
      }

      // ── Upwork ────────────────────────────────────────────────────────────
      case 'find_upwork_jobs': {
        return post('http://localhost:3107', '/api/upwork/jobs/search', {
          query: params.query,
          category: params.category,
        });
      }
      case 'score_upwork_jobs': {
        return post('http://localhost:3107', '/api/upwork/jobs/score-batch', {
          jobIds: params.jobIds || [],
        });
      }
      case 'get_upwork_jobs': {
        return get('http://localhost:3107', '/api/upwork/jobs/current-page');
      }

      // ── Market research ───────────────────────────────────────────────────
      case 'run_research': {
        const researchPlatform = params.platform || platform || 'twitter';
        const researchType = params.type || 'search'; // search | niche | full | top100
        const path = researchType === 'niche'
          ? `/api/research/${researchPlatform}/niche`
          : researchType === 'full'
          ? `/api/research/${researchPlatform}/full`
          : `/api/research/${researchPlatform}/search`;
        return post('http://localhost:3106', path, { query: params.query, keyword: params.query });
      }
      case 'get_research_results': {
        const resPlatform = params.platform || platform;
        return get('http://localhost:3106',
          resPlatform ? `/api/research/results/latest/${resPlatform}` : '/api/research/results'
        );
      }

      // ── Data fetch (read-only) ────────────────────────────────────────────
      case 'fetch_profile': {
        if (platform === 'instagram') return get(dmBase, `/api/profile/${encodeURIComponent(target_username || '')}`);
        if (platform === 'tiktok') return get(cmtBase, '/api/tiktok/profile');
        return get(dmBase, `/api/profile/${encodeURIComponent(target_username || '')}`);
      }
      case 'get_conversations': {
        const convPaths: Record<string, string> = {
          instagram: '/api/conversations',
          twitter:   '/api/twitter/conversations',
          tiktok:    '/api/tiktok/conversations',
        };
        return get(dmBase, convPaths[platform] || convPaths.instagram);
      }
      case 'get_crm_top': {
        const crmPaths: Record<string, string> = {
          instagram: '/api/crm/top-contacts',
          twitter:   '/api/twitter/crm/top-contacts',
          tiktok:    '/api/tiktok/crm/top-contacts',
        };
        return get(dmBase, crmPaths[platform] || crmPaths.instagram);
      }

      default:
        throw new Error(`Unknown action type: ${action_type}`);
    }
  }

  // getServicePort retained for health checks
  private getServicePort(platform: Platform, actionType: string): number {
    if (['reply_comment', 'post_comment', 'like_tweet', 'retweet', 'compose_tweet',
         'search_and_reply', 'get_tweet_metrics', 'twitter_comment_sweep',
         'get_post_metrics', 'get_profile_posts'].includes(actionType)) {
      return this.COMMENT_PORTS[platform] || 3005;
    }
    if (['find_upwork_jobs', 'score_upwork_jobs', 'get_upwork_jobs'].includes(actionType)) return 3107;
    if (['run_research', 'get_research_results'].includes(actionType)) return 3106;
    return this.DM_PORTS[platform] || 3100;
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
