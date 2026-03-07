/**
 * Threads Poller — reads from safari_platform_cache ONLY.
 * The threads-comments SelfPollCron writes fresh data to the cache 24/7.
 * This poller never calls Safari services directly.
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment } from '../types';
import { getCloudSupabase } from '../supabase';

export class ThreadsPoller extends BasePoller {
  constructor() {
    super('threads', 3004, process.env.THREADS_AUTH_TOKEN || process.env.AUTH_TOKEN || 'threads-local-dev-token');
  }

  private async readCache<T>(dataType: string): Promise<T[] | null> {
    try {
      const db = getCloudSupabase();
      return await db.getPlatformCache('threads', dataType) as T[] | null;
    } catch (e) {
      console.error(`[Poller:threads] cache read error (${dataType}):`, (e as Error).message);
      return null;
    }
  }

  async pollDMs(): Promise<PlatformDM[]> {
    // Threads doesn't support DMs via Safari automation
    return [];
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const cached = await this.readCache<PlatformNotification>('notifications');
    if (!cached) {
      console.log('[Poller:threads] pollNotifications — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const cached = await this.readCache<PostStats>('post_stats');
    if (!cached) {
      console.log('[Poller:threads] pollPostStats — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const cached = await this.readCache<PlatformComment>('comments');
    if (!cached) {
      console.log('[Poller:threads] pollComments — cache miss, returning []');
      return [];
    }
    return cached;
  }
}
