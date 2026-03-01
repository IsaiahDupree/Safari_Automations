/**
 * LinkedIn Poller — polls LinkedIn automation service (3105)
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, LinkedInInvitation } from '../types';

export class LinkedInPoller extends BasePoller {
  constructor() {
    super('linkedin', 3105);
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const result: PlatformDM[] = [];

    const convos = await this.get<{ conversations: any[] }>('/api/linkedin/conversations');
    if (!convos?.conversations) return result;

    for (const c of convos.conversations.slice(0, 20)) {
      const username = c.username || c.profileUrl || c.participantName || c.name || c.fullName || c.participantNames || '';
      if (!username) continue; // skip conversations we can't identify
      result.push({
        platform: 'linkedin',
        conversation_id: c.conversationId || c.id || c.threadId || username,
        username,
        display_name: c.participantName || c.name || c.fullName || c.participantNames || username,
        direction: c.lastMessageIsMe ? 'outbound' : 'inbound',
        message_text: c.lastMessage || c.snippet,
        message_type: 'text',
        is_read: !c.unread,
        raw_data: c,
        platform_timestamp: c.lastMessageAt || c.timestamp || new Date().toISOString(),
      });
    }

    return result;
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const result: PlatformNotification[] = [];

    // Check for unread conversations
    const convos = await this.get<{ conversations: any[] }>('/api/linkedin/conversations');
    if (convos?.conversations) {
      for (const c of convos.conversations) {
        if (c.unread) {
          result.push({
            platform: 'linkedin',
            notification_type: 'dm',
            actor_username: c.username || c.profileUrl,
            actor_display_name: c.name || c.fullName,
            content: c.lastMessage || c.snippet,
            raw_data: c,
            platform_timestamp: c.timestamp || new Date().toISOString(),
          });
        }
      }
    }

    // Check for new connections
    const connections = await this.get<{ connections?: any[] }>('/api/linkedin/connections/pending');
    if (connections?.connections) {
      for (const conn of connections.connections) {
        result.push({
          platform: 'linkedin',
          notification_type: 'connection',
          actor_username: conn.profileUrl || conn.username,
          actor_display_name: conn.name || conn.fullName,
          content: `Connection request from ${conn.name || conn.fullName}`,
          raw_data: conn,
        });
      }
    }

    return result;
  }

  async pollInvitations(): Promise<LinkedInInvitation[]> {
    const result: LinkedInInvitation[] = [];

    // Poll sent invitations
    const sent = await this.get<{ requests: any[] }>('/api/linkedin/connections/pending?type=sent');
    if (sent?.requests) {
      for (const r of sent.requests) {
        result.push({
          direction: 'sent',
          username: r.username || undefined,
          name: r.name,
          headline: r.headline || undefined,
          profile_url: r.profileUrl || undefined,
          sent_time: r.sentTime || undefined,
          note: r.note || undefined,
          mutual_connections: r.mutualConnections || 0,
          status: 'pending',
          raw_data: r,
        });
      }
    }

    // Poll received invitations
    const received = await this.get<{ requests: any[] }>('/api/linkedin/connections/pending?type=received');
    if (received?.requests) {
      for (const r of received.requests) {
        result.push({
          direction: 'received',
          username: r.username || undefined,
          name: r.name,
          headline: r.headline || undefined,
          profile_url: r.profileUrl || undefined,
          sent_time: r.sentTime || undefined,
          note: r.note || undefined,
          mutual_connections: r.mutualConnections || 0,
          status: 'pending',
          raw_data: r,
        });
      }
    }

    return result;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const result: PostStats[] = [];

    try {
      const postsRes = await this.get<{ posts?: any[]; success?: boolean }>('/api/linkedin/posts/recent?limit=5');
      if (!postsRes?.posts?.length) return result;

      for (const post of postsRes.posts) {
        const postId = post.postId || '';
        // Must have a numeric post ID (LinkedIn activity URN digits)
        if (!postId || postId.length < 5 || !/^\d+$/.test(postId)) continue;
        const postUrl = post.url || `https://www.linkedin.com/feed/update/urn:li:activity:${postId}`;
        // URL must be LinkedIn
        if (postUrl && !postUrl.includes('linkedin.com')) continue;

        result.push({
          platform: 'linkedin',
          post_id: postId,
          post_url: postUrl,
          post_type: 'post',
          caption: (post.caption || '').substring(0, 500),
          views: 0, // LinkedIn doesn't show views on activity feed
          likes: post.reactions || 0,
          comments: post.comments || 0,
          shares: post.reposts || 0,
          saves: 0,
          engagement_rate: 0,
          raw_data: post,
        });
      }
    } catch (e) {
      console.error(`[Poller:linkedin] pollPostStats error:`, (e as Error).message);
    }

    return result;
  }
}
