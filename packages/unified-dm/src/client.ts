/**
 * Unified DM Client
 * 
 * Single interface for sending and receiving DMs across TikTok, Instagram, and Twitter.
 */

import type {
  Platform,
  Conversation,
  Message,
  SendResult,
  PlatformStatus,
  UnifiedDMConfig,
  DEFAULT_CONFIG,
} from './types.js';

export class UnifiedDMClient {
  private config: UnifiedDMConfig;

  constructor(config: Partial<UnifiedDMConfig> = {}) {
    this.config = {
      tiktokApiUrl: 'http://localhost:3002',
      instagramApiUrl: 'http://localhost:3001',
      twitterApiUrl: 'http://localhost:3003',
      timeout: 30000,
      ...config,
    };
  }

  private getApiUrl(platform: Platform): string {
    switch (platform) {
      case 'tiktok':
        return this.config.tiktokApiUrl;
      case 'instagram':
        return this.config.instagramApiUrl;
      case 'twitter':
        return this.config.twitterApiUrl;
    }
  }

  private async fetch<T>(platform: Platform, path: string, options?: RequestInit): Promise<T> {
    const url = `${this.getApiUrl(platform)}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Check health of all platforms
   */
  async checkHealth(): Promise<Record<Platform, boolean>> {
    const platforms: Platform[] = ['tiktok', 'instagram', 'twitter'];
    const results: Record<Platform, boolean> = {
      tiktok: false,
      instagram: false,
      twitter: false,
    };

    await Promise.all(
      platforms.map(async (platform) => {
        try {
          const response = await this.fetch<{ status: string }>(platform, '/health');
          results[platform] = response.status === 'ok';
        } catch {
          results[platform] = false;
        }
      })
    );

    return results;
  }

  /**
   * Get status of a specific platform
   */
  async getPlatformStatus(platform: Platform): Promise<PlatformStatus> {
    try {
      const apiPath = platform === 'twitter' 
        ? '/api/twitter/status'
        : platform === 'tiktok'
        ? '/api/tiktok/status'
        : '/api/instagram/status';

      const data = await this.fetch<Record<string, unknown>>(platform, apiPath);
      
      return {
        platform,
        isOnline: true,
        isLoggedIn: Boolean(data.isLoggedIn),
        messagesThisHour: Number(data.messagesThisHour) || 0,
        messagesToday: Number(data.messagesToday) || 0,
      };
    } catch (error) {
      return {
        platform,
        isOnline: false,
        isLoggedIn: false,
        messagesThisHour: 0,
        messagesToday: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get status of all platforms
   */
  async getAllPlatformStatus(): Promise<PlatformStatus[]> {
    const platforms: Platform[] = ['tiktok', 'instagram', 'twitter'];
    return Promise.all(platforms.map((p) => this.getPlatformStatus(p)));
  }

  /**
   * List conversations from a platform
   */
  async listConversations(platform: Platform): Promise<Conversation[]> {
    const apiPath = platform === 'twitter'
      ? '/api/twitter/conversations'
      : platform === 'tiktok'
      ? '/api/tiktok/conversations'
      : '/api/instagram/conversations';

    const data = await this.fetch<{ conversations: unknown[] }>(platform, apiPath);
    
    return (data.conversations || []).map((conv: unknown) => {
      const c = conv as Record<string, unknown>;
      return {
        id: String(c.id || c.username || ''),
        platform,
        username: String(c.username || c.name || ''),
        displayName: String(c.displayName || c.name || ''),
        lastMessage: String(c.lastMessage || c.preview || ''),
        unread: Boolean(c.unread || c.hasUnread),
      };
    });
  }

  /**
   * List conversations from all platforms
   */
  async listAllConversations(): Promise<Conversation[]> {
    const platforms: Platform[] = ['tiktok', 'instagram', 'twitter'];
    const results = await Promise.allSettled(
      platforms.map((p) => this.listConversations(p))
    );

    return results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    );
  }

  /**
   * Send a DM to a user
   */
  async sendDM(
    platform: Platform,
    username: string,
    message: string
  ): Promise<SendResult> {
    try {
      const apiPath = platform === 'twitter'
        ? '/api/twitter/messages/send-to'
        : platform === 'tiktok'
        ? '/api/tiktok/messages/send-to'
        : '/api/instagram/messages/send-to';

      const body = platform === 'twitter'
        ? { username, text: message }
        : { username, message };

      const data = await this.fetch<{ success: boolean; messageId?: string }>(
        platform,
        apiPath,
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );

      return {
        success: data.success,
        platform,
        messageId: data.messageId,
      };
    } catch (error) {
      return {
        success: false,
        platform,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Read messages from current conversation
   */
  async readMessages(platform: Platform, limit = 20): Promise<Message[]> {
    const apiPath = platform === 'twitter'
      ? `/api/twitter/messages?limit=${limit}`
      : platform === 'tiktok'
      ? `/api/tiktok/messages?limit=${limit}`
      : `/api/instagram/messages?limit=${limit}`;

    const data = await this.fetch<{ messages: unknown[] }>(platform, apiPath);

    return (data.messages || []).map((msg: unknown, index: number) => {
      const m = msg as Record<string, unknown>;
      return {
        id: String(m.id || index),
        platform,
        conversationId: String(m.conversationId || ''),
        sender: m.isMe || m.sender === 'me' ? 'me' : 'them',
        text: String(m.text || m.content || m.message || ''),
        timestamp: m.timestamp ? new Date(String(m.timestamp)) : new Date(),
        type: 'text' as const,
      };
    });
  }

  /**
   * Open a conversation by username
   */
  async openConversation(platform: Platform, username: string): Promise<boolean> {
    try {
      const apiPath = platform === 'twitter'
        ? '/api/twitter/conversations/open'
        : platform === 'tiktok'
        ? '/api/tiktok/conversations/open'
        : '/api/instagram/conversations/open';

      const data = await this.fetch<{ success: boolean }>(platform, apiPath, {
        method: 'POST',
        body: JSON.stringify({ username }),
      });

      return data.success;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to inbox
   */
  async navigateToInbox(platform: Platform): Promise<boolean> {
    try {
      const apiPath = platform === 'twitter'
        ? '/api/twitter/inbox/navigate'
        : platform === 'tiktok'
        ? '/api/tiktok/inbox/navigate'
        : '/api/instagram/inbox/navigate';

      const data = await this.fetch<{ success: boolean }>(platform, apiPath, {
        method: 'POST',
      });

      return data.success;
    } catch {
      return false;
    }
  }
}
