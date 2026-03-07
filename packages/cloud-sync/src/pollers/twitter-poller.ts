/**
 * Twitter Poller — reads from safari_platform_cache ONLY.
 * The twitter-dm SelfPollCron writes fresh data to the cache 24/7.
 * This poller never calls Safari services directly.
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent } from '../types';
import { getCloudSupabase } from '../supabase';

export class TwitterPoller extends BasePoller {
  constructor() {
    super('twitter', 3003);
  }

  private async readCache<T>(dataType: string): Promise<T[] | null> {
    try {
      const db = getCloudSupabase();
      return await db.getPlatformCache('twitter', dataType) as T[] | null;
    } catch (e) {
      console.error(`[Poller:twitter] cache read error (${dataType}):`, (e as Error).message);
      return null;
    }
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const cached = await this.readCache<PlatformDM>('dms');
    if (!cached) {
      console.log('[Poller:twitter] pollDMs — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const cached = await this.readCache<PlatformNotification>('notifications');
    if (!cached) {
      console.log('[Poller:twitter] pollNotifications — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const cached = await this.readCache<PostStats>('post_stats');
    if (!cached) {
      console.log('[Poller:twitter] pollPostStats — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const cached = await this.readCache<PlatformComment>('comments');
    if (!cached) {
      console.log('[Poller:twitter] pollComments — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollFollowers(): Promise<FollowerEvent[]> {
    const cached = await this.readCache<FollowerEvent>('followers');
    if (!cached) {
      console.log('[Poller:twitter] pollFollowers — cache miss, returning []');
      return [];
    }
    return cached;
  }
}
