/**
 * Cloud Sync Types — shared across pollers, sync engine, and API
 */

// ─── Platform enum ───────────────────────────────────────
export type Platform = 'instagram' | 'twitter' | 'tiktok' | 'threads' | 'linkedin' | 'youtube';
export type DataType = 'notifications' | 'dms' | 'post_stats' | 'followers' | 'invitations' | 'comments';

// ─── Platform service ports ──────────────────────────────
export const PLATFORM_PORTS: Record<string, number> = {
  'instagram-dm': 3001,
  'twitter-dm': 3003,
  'tiktok-dm': 3102,
  'instagram-comments': 3005,
  'twitter-comments': 3007,
  'tiktok-comments': 3006,
  'threads-comments': 3004,
  'linkedin': 3105,
  'market-research': 3106,
};

// ─── Poll state ──────────────────────────────────────────
export interface PollState {
  id: string;
  platform: Platform;
  data_type: DataType;
  last_poll_at: string;
  last_cursor?: string;
  items_synced: number;
  error?: string;
  metadata: Record<string, unknown>;
}

// ─── Notification ────────────────────────────────────────
export interface PlatformNotification {
  platform: Platform;
  notification_type: string; // like, comment, follow, mention, repost, dm, connection
  actor_username?: string;
  actor_display_name?: string;
  content?: string;
  post_url?: string;
  post_id?: string;
  is_read?: boolean;
  raw_data?: Record<string, unknown>;
  platform_timestamp?: string;
}

// ─── DM ──────────────────────────────────────────────────
export interface PlatformDM {
  platform: Platform;
  conversation_id?: string;
  username: string;
  display_name?: string;
  direction: 'inbound' | 'outbound';
  message_text?: string;
  message_type?: string;
  is_read?: boolean;
  raw_data?: Record<string, unknown>;
  platform_timestamp?: string;
}

// ─── Post stats ──────────────────────────────────────────
export interface PostStats {
  platform: Platform;
  post_id: string;
  post_url?: string;
  post_type?: string;
  title?: string;
  caption?: string;
  published_at?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  impressions?: number;
  reach?: number;
  engagement_rate?: number;
  avg_watch_time_seconds?: number;
  completion_rate?: number;
  traffic_source?: Record<string, number>;
  hashtags?: string[];
  raw_data?: Record<string, unknown>;
}

// ─── Platform Comment ───────────────────────────────────
export interface PlatformComment {
  platform: Platform;
  post_id: string;
  post_url?: string;
  username: string;
  display_name?: string;
  comment_text: string;
  like_count?: number;
  platform_timestamp?: string;
  raw_data?: Record<string, unknown>;
}

// ─── Follower Event ─────────────────────────────────────
export interface FollowerEvent {
  platform: Platform;
  username: string;
  display_name?: string;
  event_type: 'follow' | 'unfollow';
  profile_url?: string;
  bio?: string;
  follower_count?: number;
  attributed_post_id?: string;
  attributed_post_url?: string;
  raw_data?: Record<string, unknown>;
  platform_timestamp?: string;
}

// ─── LinkedIn Invitation ────────────────────────────────
export interface LinkedInInvitation {
  direction: 'sent' | 'received';
  username?: string;
  name: string;
  headline?: string;
  profile_url?: string;
  sent_time?: string;
  note?: string;
  mutual_connections?: number;
  status?: string;
  raw_data?: Record<string, unknown>;
}

// ─── Cloud action ────────────────────────────────────────
export interface CloudAction {
  id: string;
  platform: Platform;
  action_type: string; // reply_dm, reply_comment, follow_back, like_post, post_content
  target_username?: string;
  target_post_url?: string;
  params: Record<string, unknown>;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

// ─── Poller interface ────────────────────────────────────
export interface PlatformPoller {
  platform: Platform;
  pollDMs(): Promise<PlatformDM[]>;
  pollNotifications(): Promise<PlatformNotification[]>;
  pollPostStats(): Promise<PostStats[]>;
  pollInvitations?(): Promise<LinkedInInvitation[]>;
  pollComments?(): Promise<PlatformComment[]>;
  isServiceHealthy(): Promise<boolean>;
}

// ─── Sync config ─────────────────────────────────────────
export interface SyncConfig {
  pollIntervalMs: number;       // how often to poll (default 60s)
  dmPollIntervalMs: number;     // DM poll interval (default 30s)
  statsPollIntervalMs: number;  // post stats interval (default 300s)
  invitationPollIntervalMs: number; // invitation poll interval (default 120s)
  commentsPollIntervalMs: number;    // comments poll interval (default 600s)
  platforms: Platform[];        // which platforms to poll
  enableActions: boolean;       // process cloud action queue
  enableLearning: boolean;      // run analytics/learning
  supabaseUrl: string;
  supabaseKey: string;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  pollIntervalMs: 60_000,
  dmPollIntervalMs: 30_000,
  statsPollIntervalMs: 300_000,
  invitationPollIntervalMs: 120_000,
  commentsPollIntervalMs: 600_000,
  platforms: ['instagram', 'twitter', 'tiktok', 'threads', 'linkedin', 'youtube'],
  enableActions: true,
  enableLearning: true,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_ANON_KEY || '',
};
