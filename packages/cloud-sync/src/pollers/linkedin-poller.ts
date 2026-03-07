/**
 * LinkedIn Poller — reads from safari_platform_cache ONLY.
 * The linkedin-automation SelfPollCron writes fresh data to the cache 24/7.
 * This poller never calls the Safari service directly.
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, LinkedInInvitation } from '../types';
import { getCloudSupabase } from '../supabase';

export class LinkedInPoller extends BasePoller {
  constructor() {
    super('linkedin', 3105, process.env.LINKEDIN_AUTH_TOKEN || 'test-token-12345');
  }

  private async readCache<T>(dataType: string): Promise<T[] | null> {
    try {
      const db = getCloudSupabase();
      return await db.getPlatformCache('linkedin', dataType) as T[] | null;
    } catch (e) {
      console.error(`[Poller:linkedin] cache read error (${dataType}):`, (e as Error).message);
      return null;
    }
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const cached = await this.readCache<PlatformDM>('dms');
    if (!cached) {
      console.log('[Poller:linkedin] pollDMs — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const cached = await this.readCache<PlatformNotification>('notifications');
    if (!cached) {
      console.log('[Poller:linkedin] pollNotifications — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollInvitations(): Promise<LinkedInInvitation[]> {
    const cached = await this.readCache<LinkedInInvitation>('invitations');
    if (!cached) {
      console.log('[Poller:linkedin] pollInvitations — cache miss, returning []');
      return [];
    }
    return cached;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const cached = await this.readCache<PostStats>('post_stats');
    if (!cached) {
      console.log('[Poller:linkedin] pollPostStats — cache miss, returning []');
      return [];
    }
    return cached;
  }
}
