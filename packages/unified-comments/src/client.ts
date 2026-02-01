/**
 * Unified Comments Client
 * Single interface for posting comments across Threads, Instagram, TikTok, Twitter
 */

import {
  type CommentPlatform,
  type Comment,
  type CommentResult,
  type PlatformStatus,
  type UnifiedCommentsConfig,
  PLATFORM_CONFIGS,
  DEFAULT_CONFIG,
} from './types.js';

export class UnifiedCommentsClient {
  private config: UnifiedCommentsConfig;

  constructor(config: Partial<UnifiedCommentsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getApiUrl(platform: CommentPlatform): string {
    switch (platform) {
      case 'threads': return this.config.threadsApiUrl;
      case 'instagram': return this.config.instagramApiUrl;
      case 'tiktok': return this.config.tiktokApiUrl;
      case 'twitter': return this.config.twitterApiUrl;
    }
  }

  private async fetch(url: string, options?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  async checkHealth(): Promise<Record<CommentPlatform, boolean>> {
    const platforms: CommentPlatform[] = ['threads', 'instagram', 'tiktok', 'twitter'];
    const results: Record<CommentPlatform, boolean> = {} as Record<CommentPlatform, boolean>;

    await Promise.all(
      platforms.map(async (platform) => {
        try {
          const response = await this.fetch(`${this.getApiUrl(platform)}/health`);
          results[platform] = response.ok;
        } catch {
          results[platform] = false;
        }
      })
    );

    return results;
  }

  async getStatus(platform: CommentPlatform): Promise<PlatformStatus | null> {
    try {
      const apiUrl = this.getApiUrl(platform);
      const response = await this.fetch(`${apiUrl}/api/${platform}/status`);
      if (!response.ok) return null;
      const data = await response.json();
      return { platform, isOnline: true, ...data };
    } catch {
      return null;
    }
  }

  async getAllStatus(): Promise<Record<CommentPlatform, PlatformStatus | null>> {
    const platforms: CommentPlatform[] = ['threads', 'instagram', 'tiktok', 'twitter'];
    const results: Record<CommentPlatform, PlatformStatus | null> = {} as Record<CommentPlatform, PlatformStatus | null>;

    await Promise.all(
      platforms.map(async (platform) => {
        results[platform] = await this.getStatus(platform);
      })
    );

    return results;
  }

  async getComments(platform: CommentPlatform, limit = 50): Promise<Comment[]> {
    try {
      const apiUrl = this.getApiUrl(platform);
      const response = await this.fetch(`${apiUrl}/api/${platform}/comments?limit=${limit}`);
      if (!response.ok) return [];
      const data = await response.json();
      return data.comments || [];
    } catch {
      return [];
    }
  }

  async postComment(platform: CommentPlatform, text: string, postUrl?: string): Promise<CommentResult> {
    try {
      const apiUrl = this.getApiUrl(platform);
      const response = await this.fetch(`${apiUrl}/api/${platform}/comments/post`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, postUrl }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return { success: true, platform, commentId: data.commentId };
      } else {
        return { success: false, platform, error: data.error || 'Unknown error' };
      }
    } catch (error) {
      return { success: false, platform, error: String(error) };
    }
  }

  async navigateToPost(platform: CommentPlatform, url: string): Promise<boolean> {
    try {
      const apiUrl = this.getApiUrl(platform);
      const response = await this.fetch(`${apiUrl}/api/${platform}/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      return data.success === true;
    } catch {
      return false;
    }
  }

  async getRateLimits(platform: CommentPlatform): Promise<Record<string, unknown> | null> {
    try {
      const apiUrl = this.getApiUrl(platform);
      const response = await this.fetch(`${apiUrl}/api/${platform}/rate-limits`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async postToAll(text: string, postUrls: Partial<Record<CommentPlatform, string>>): Promise<Record<CommentPlatform, CommentResult>> {
    const platforms = Object.keys(postUrls) as CommentPlatform[];
    const results: Record<CommentPlatform, CommentResult> = {} as Record<CommentPlatform, CommentResult>;

    for (const platform of platforms) {
      const postUrl = postUrls[platform];
      results[platform] = await this.postComment(platform, text, postUrl);
      // Add delay between platforms to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    return results;
  }
}
