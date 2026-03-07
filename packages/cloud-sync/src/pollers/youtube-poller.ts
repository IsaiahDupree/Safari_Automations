/**
 * YouTube Poller — uses YouTube Data API v3 (no Safari navigation)
 * Tracks channel stats (subscribers, views, videos) and recent video performance.
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats } from '../types';

const BASE = 'https://www.googleapis.com/youtube/v3';

function apiKey() { return process.env.YOUTUBE_API_KEY || ''; }
function channelId() { return process.env.YOUTUBE_CHANNEL_ID || ''; }

export class YouTubePoller extends BasePoller {
  constructor() {
    // Port 0 — no local Safari service; all calls go to googleapis.com
    super('youtube', 0);
  }

  // YouTube has no DMs
  async pollDMs(): Promise<PlatformDM[]> { return []; }

  // YouTube has no real-time notifications via this API
  async pollNotifications(): Promise<PlatformNotification[]> { return []; }

  // Override health check — no local service; check that API key + channel ID are set
  async isServiceHealthy(): Promise<boolean> {
    return !!(apiKey() && channelId());
  }

  async pollPostStats(): Promise<PostStats[]> {
    const API_KEY = apiKey();
    const CHANNEL_ID = channelId();
    if (!API_KEY || !CHANNEL_ID) {
      console.warn('[Poller:youtube] Missing YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID — skipping');
      return [];
    }

    const result: PostStats[] = [];

    try {
      // 1. Channel-level stats as a synthetic "channel" post
      const chanRes = await fetch(
        `${BASE}/channels?part=statistics,snippet&id=${CHANNEL_ID}&key=${API_KEY}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (chanRes.ok) {
        const chanData = await chanRes.json() as { items?: any[] };
        const ch = chanData.items?.[0];
        if (ch) {
          result.push({
            platform: 'youtube',
            post_id: `channel_${CHANNEL_ID}`,
            post_url: `https://www.youtube.com/channel/${CHANNEL_ID}`,
            post_type: 'channel',
            title: ch.snippet?.title || 'YouTube Channel',
            views: parseInt(ch.statistics?.viewCount || '0'),
            likes: 0,
            comments: parseInt(ch.statistics?.commentCount || '0'),
            shares: 0,
            saves: parseInt(ch.statistics?.subscriberCount || '0'), // subscribers in "saves"
            raw_data: { channelStats: ch.statistics, snippet: ch.snippet },
          });
        }
      }

      // 2. Recent videos (up to 10)
      const searchRes = await fetch(
        `${BASE}/search?part=snippet&channelId=${CHANNEL_ID}&order=date&maxResults=10&type=video&key=${API_KEY}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!searchRes.ok) return result;

      const searchData = await searchRes.json() as { items?: any[] };
      const videoIds = (searchData.items || [])
        .map((v: any) => v.id?.videoId)
        .filter(Boolean)
        .join(',');

      if (!videoIds) return result;

      // 3. Fetch stats for those videos in one batch call
      const statsRes = await fetch(
        `${BASE}/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!statsRes.ok) return result;

      const statsData = await statsRes.json() as { items?: any[] };
      for (const v of statsData.items || []) {
        const videoId = v.id;
        result.push({
          platform: 'youtube',
          post_id: videoId,
          post_url: `https://www.youtube.com/watch?v=${videoId}`,
          post_type: 'video',
          title: v.snippet?.title,
          caption: v.snippet?.description?.substring(0, 500),
          published_at: v.snippet?.publishedAt,
          views: parseInt(v.statistics?.viewCount || '0'),
          likes: parseInt(v.statistics?.likeCount || '0'),
          comments: parseInt(v.statistics?.commentCount || '0'),
          shares: 0,
          raw_data: { statistics: v.statistics, snippet: v.snippet },
        });
      }
    } catch (e) {
      console.error('[Poller:youtube] pollPostStats error:', (e as Error).message);
    }

    return result;
  }
}
