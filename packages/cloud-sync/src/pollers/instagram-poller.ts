/**
 * Instagram Poller — reads from safari_platform_cache ONLY.
 * The instagram-dm SelfPollCron writes fresh data to the cache 24/7.
 * This poller never calls Safari services directly.
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent } from '../types';
import { getCloudSupabase } from '../supabase';

export class InstagramPoller extends BasePoller {
  constructor() {
    super('instagram', 3100);
  }

  private async readCache<T>(dataType: string): Promise<T[] | null> {
    try {
      const db = getCloudSupabase();
      return await db.getPlatformCache('instagram', dataType) as T[] | null;
    } catch (e) {
      console.error(`[Poller:instagram] cache read error (${dataType}):`, (e as Error).message);
      return null;
    }
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const cached = await this.readCache<PlatformDM>('dms');
    if (!cached) {
      console.log('[Poller:instagram] pollDMs — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const cached = await this.readCache<PlatformNotification>('notifications');
    if (!cached) {
      console.log('[Poller:instagram] pollNotifications — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const cached = await this.readCache<PostStats>('post_stats');
    if (!cached) {
      console.log('[Poller:instagram] pollPostStats — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const cached = await this.readCache<PlatformComment>('comments');
    if (!cached) {
      console.log('[Poller:instagram] pollComments — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollFollowers(): Promise<FollowerEvent[]> {
    const cached = await this.readCache<FollowerEvent>('followers');
    if (!cached) {
      console.log('[Poller:instagram] pollFollowers — cache miss, returning []');
      return [];
    }
    return cached;
  }
}
