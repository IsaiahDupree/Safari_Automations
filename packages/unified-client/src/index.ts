/**
 * Unified Social Automation Client
 * 
 * Multi-platform DM client that provides a single interface for:
 * - Instagram DM automation
 * - Twitter/X DM automation
 * - TikTok DM automation
 * - (Future) Threads, etc.
 * 
 * @example
 * ```typescript
 * import { SocialAutomationClient } from '@safari-automation/unified-client';
 * 
 * const client = new SocialAutomationClient({
 *   safariApiUrl: 'http://localhost:3100',
 * });
 * 
 * // Send DM to any platform
 * await client.sendDM('instagram', 'username', 'Hello!');
 * await client.sendDM('twitter', 'username', 'Hello!');
 * await client.sendDM('tiktok', 'username', 'Hello!');
 * 
 * // Get unified status
 * const status = await client.getAllStatus();
 * console.log(status.instagram.isLoggedIn);
 * console.log(status.twitter.isLoggedIn);
 * console.log(status.tiktok.isLoggedIn);
 * ```
 */

import { 
  InstagramDMClient, 
  createDMClient as createInstagramClient,
  type ApiResponse as InstagramApiResponse,
} from '@safari-automation/instagram-dm';

import { 
  TwitterDMClient, 
  createTwitterDMClient,
  type ApiResponse as TwitterApiResponse,
} from '@safari-automation/twitter-dm';

import { 
  TikTokDMClient, 
  createTikTokDMClient,
  type ApiResponse as TikTokApiResponse,
} from '@safari-automation/tiktok-dm';

export type Platform = 'instagram' | 'twitter' | 'tiktok';

export interface UnifiedClientConfig {
  safariApiUrl: string;
  instagramPort?: number;
  twitterPort?: number;
  tiktokPort?: number;
  timeout?: number;
}

export interface PlatformStatus {
  isOnPlatform: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
}

export interface UnifiedStatus {
  instagram: PlatformStatus | null;
  twitter: PlatformStatus | null;
  tiktok: PlatformStatus | null;
}

export interface RateLimitInfo {
  messagesSentToday: number;
  messagesSentThisHour: number;
  maxPerHour: number;
  maxPerDay: number;
  isActive: boolean;
}

export interface UnifiedRateLimits {
  instagram: RateLimitInfo | null;
  twitter: RateLimitInfo | null;
  tiktok: RateLimitInfo | null;
  combined: {
    totalToday: number;
    totalThisHour: number;
  };
}

export interface SendDMResult {
  success: boolean;
  platform: Platform;
  username?: string;
  error?: string;
}

export interface Conversation {
  platform: Platform;
  username: string;
  displayName?: string;
  lastMessage?: string;
  unreadCount?: number;
}

export class SocialAutomationClient {
  private instagram: InstagramDMClient;
  private twitter: TwitterDMClient;
  private tiktok: TikTokDMClient;
  private config: UnifiedClientConfig;

  constructor(config: UnifiedClientConfig) {
    this.config = config;
    
    const baseUrl = config.safariApiUrl.replace(/\/$/, '');
    const baseHost = baseUrl.replace(/:\d+$/, '');
    
    const instagramUrl = config.instagramPort 
      ? `${baseHost}:${config.instagramPort}`
      : baseUrl;
    const twitterUrl = config.twitterPort
      ? `${baseHost}:${config.twitterPort}`
      : `${baseHost}:3101`;
    const tiktokUrl = config.tiktokPort
      ? `${baseHost}:${config.tiktokPort}`
      : `${baseHost}:3102`;

    this.instagram = createInstagramClient(instagramUrl);
    this.twitter = createTwitterDMClient(twitterUrl);
    this.tiktok = createTikTokDMClient(tiktokUrl);
  }

  /**
   * Get client for a specific platform.
   */
  getClient(platform: Platform): InstagramDMClient | TwitterDMClient | TikTokDMClient {
    switch (platform) {
      case 'instagram': return this.instagram;
      case 'twitter': return this.twitter;
      case 'tiktok': return this.tiktok;
    }
  }

  /**
   * Health check for all platforms.
   */
  async healthCheck(): Promise<{ instagram: boolean; twitter: boolean; tiktok: boolean }> {
    const [igHealth, twHealth, tkHealth] = await Promise.allSettled([
      this.instagram.healthCheck(),
      this.twitter.healthCheck(),
      this.tiktok.healthCheck(),
    ]);

    return {
      instagram: igHealth.status === 'fulfilled' && igHealth.value.success,
      twitter: twHealth.status === 'fulfilled' && twHealth.value.success,
      tiktok: tkHealth.status === 'fulfilled' && tkHealth.value.success,
    };
  }

  /**
   * Get status for all platforms.
   */
  async getAllStatus(): Promise<UnifiedStatus> {
    const [igStatus, twStatus, tkStatus] = await Promise.allSettled([
      this.instagram.getStatus(),
      this.twitter.getStatus(),
      this.tiktok.getStatus(),
    ]);

    return {
      instagram: igStatus.status === 'fulfilled' && igStatus.value.success
        ? {
            isOnPlatform: igStatus.value.data?.isOnInstagram ?? false,
            isLoggedIn: igStatus.value.data?.isLoggedIn ?? false,
            currentUrl: igStatus.value.data?.currentUrl ?? '',
          }
        : null,
      twitter: twStatus.status === 'fulfilled' && twStatus.value.success
        ? {
            isOnPlatform: twStatus.value.data?.isOnTwitter ?? false,
            isLoggedIn: twStatus.value.data?.isLoggedIn ?? false,
            currentUrl: twStatus.value.data?.currentUrl ?? '',
          }
        : null,
      tiktok: tkStatus.status === 'fulfilled' && tkStatus.value.success
        ? {
            isOnPlatform: tkStatus.value.data?.isOnTikTok ?? false,
            isLoggedIn: tkStatus.value.data?.isLoggedIn ?? false,
            currentUrl: tkStatus.value.data?.currentUrl ?? '',
          }
        : null,
    };
  }

  /**
   * Get rate limits for all platforms.
   */
  async getAllRateLimits(): Promise<UnifiedRateLimits> {
    const [igLimits, twLimits, tkLimits] = await Promise.allSettled([
      this.instagram.getRateLimits(),
      this.twitter.getRateLimits(),
      this.tiktok.getRateLimits(),
    ]);

    const instagram: RateLimitInfo | null = 
      igLimits.status === 'fulfilled' && igLimits.value.success && igLimits.value.data
        ? {
            messagesSentToday: igLimits.value.data.messagesSentToday,
            messagesSentThisHour: igLimits.value.data.messagesSentThisHour,
            maxPerHour: igLimits.value.data.limits.messagesPerHour,
            maxPerDay: igLimits.value.data.limits.messagesPerDay,
            isActive: igLimits.value.data.activeHours.isActive,
          }
        : null;

    const twitter: RateLimitInfo | null = 
      twLimits.status === 'fulfilled' && twLimits.value.success && twLimits.value.data
        ? {
            messagesSentToday: twLimits.value.data.messagesSentToday,
            messagesSentThisHour: twLimits.value.data.messagesSentThisHour,
            maxPerHour: twLimits.value.data.limits.messagesPerHour,
            maxPerDay: twLimits.value.data.limits.messagesPerDay,
            isActive: twLimits.value.data.activeHours.isActive,
          }
        : null;

    const tiktok: RateLimitInfo | null = 
      tkLimits.status === 'fulfilled' && tkLimits.value.success && tkLimits.value.data
        ? {
            messagesSentToday: tkLimits.value.data.messagesSentToday,
            messagesSentThisHour: tkLimits.value.data.messagesSentThisHour,
            maxPerHour: tkLimits.value.data.limits.messagesPerHour,
            maxPerDay: tkLimits.value.data.limits.messagesPerDay,
            isActive: tkLimits.value.data.activeHours.isActive,
          }
        : null;

    return {
      instagram,
      twitter,
      tiktok,
      combined: {
        totalToday: (instagram?.messagesSentToday ?? 0) + (twitter?.messagesSentToday ?? 0) + (tiktok?.messagesSentToday ?? 0),
        totalThisHour: (instagram?.messagesSentThisHour ?? 0) + (twitter?.messagesSentThisHour ?? 0) + (tiktok?.messagesSentThisHour ?? 0),
      },
    };
  }

  /**
   * Send DM to a user on a specific platform.
   */
  async sendDM(platform: Platform, username: string, message: string): Promise<SendDMResult> {
    try {
      if (platform === 'instagram') {
        const result = await this.instagram.sendMessageTo(username, message);
        return {
          success: result.success,
          platform,
          username,
          error: result.error,
        };
      } else if (platform === 'twitter') {
        const result = await this.twitter.sendMessageTo(username, message);
        return {
          success: result.success,
          platform,
          username: result.data?.username,
          error: result.error,
        };
      } else {
        const result = await this.tiktok.sendMessageTo(username, message);
        return {
          success: result.success,
          platform,
          username: result.data?.username,
          error: result.error,
        };
      }
    } catch (error) {
      return {
        success: false,
        platform,
        username,
        error: String(error),
      };
    }
  }

  /**
   * Get conversations from all platforms.
   */
  async getAllConversations(): Promise<Conversation[]> {
    const [igConvos, twConvos, tkConvos] = await Promise.allSettled([
      this.instagram.listConversations(),
      this.twitter.listConversations(),
      this.tiktok.listConversations(),
    ]);

    const conversations: Conversation[] = [];

    if (igConvos.status === 'fulfilled' && igConvos.value.success && igConvos.value.data) {
      for (const c of igConvos.value.data.conversations) {
        conversations.push({
          platform: 'instagram',
          username: c.username,
          displayName: c.displayName,
          lastMessage: c.lastMessage,
          unreadCount: c.unreadCount,
        });
      }
    }

    if (twConvos.status === 'fulfilled' && twConvos.value.success && twConvos.value.data) {
      for (const c of twConvos.value.data.conversations) {
        conversations.push({
          platform: 'twitter',
          username: c.username,
          displayName: c.displayName,
          lastMessage: c.lastMessage,
          unreadCount: c.unreadCount,
        });
      }
    }

    if (tkConvos.status === 'fulfilled' && tkConvos.value.success && tkConvos.value.data) {
      for (const c of tkConvos.value.data.conversations) {
        conversations.push({
          platform: 'tiktok',
          username: c.username,
          displayName: c.displayName,
          lastMessage: c.lastMessage,
        });
      }
    }

    return conversations;
  }

  /**
   * Navigate to inbox on a specific platform.
   */
  async navigateToInbox(platform: Platform): Promise<boolean> {
    const client = this.getClient(platform);
    const result = await client.navigateToInbox();
    return result.success;
  }

  /**
   * Open a conversation on a specific platform.
   */
  async openConversation(platform: Platform, username: string): Promise<boolean> {
    const client = this.getClient(platform);
    const result = await client.openConversation(username);
    return result.success;
  }

  /**
   * Execute raw script on a platform (advanced).
   */
  async executeScript(platform: Platform, script: string): Promise<string | null> {
    const client = this.getClient(platform);
    const result = await client.executeScript(script);
    return result.success ? result.data?.output ?? null : null;
  }
}

/**
 * Create a unified client with default configuration.
 */
export function createUnifiedClient(safariApiUrl: string = 'http://localhost:3100'): SocialAutomationClient {
  return new SocialAutomationClient({ safariApiUrl });
}

// Re-export platform clients for direct access
export { InstagramDMClient, TwitterDMClient, TikTokDMClient };
export { createInstagramClient, createTwitterDMClient, createTikTokDMClient };
