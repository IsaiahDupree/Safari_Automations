/**
 * TikTok DM API Client
 * For calling the TikTok DM API from other services (e.g., CRM)
 */

import { DMConversation, DMMessage, RateLimitConfig } from '../automation/types.js';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StatusResponse {
  isOnTikTok: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
}

export interface RateLimitsResponse {
  limits: RateLimitConfig;
  messagesSentToday: number;
  messagesSentThisHour: number;
  activeHours: {
    start: number;
    end: number;
    isActive: boolean;
  };
}

export interface ConversationsResponse {
  conversations: DMConversation[];
  count: number;
}

export interface MessagesResponse {
  messages: DMMessage[];
  count: number;
}

export interface SendMessageResponse {
  success: boolean;
  username?: string;
  error?: string;
  rateLimits?: {
    hourly: number;
    daily: number;
  };
}

export class TikTokDMClient {
  private baseUrl: string;
  private timeout: number;

  constructor(baseUrl: string = 'http://localhost:3102', timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = await response.json();
      
      if (!response.ok) {
        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
        };
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request('GET', '/health');
  }

  /**
   * Get TikTok status (logged in, current URL, etc.)
   */
  async getStatus(): Promise<ApiResponse<StatusResponse>> {
    return this.request('GET', '/api/tiktok/status');
  }

  /**
   * Get rate limit status
   */
  async getRateLimits(): Promise<ApiResponse<RateLimitsResponse>> {
    return this.request('GET', '/api/tiktok/rate-limits');
  }

  /**
   * Update rate limits
   */
  async updateRateLimits(
    limits: Partial<RateLimitConfig>
  ): Promise<ApiResponse<RateLimitsResponse>> {
    return this.request('PUT', '/api/tiktok/rate-limits', limits);
  }

  /**
   * Navigate to inbox
   */
  async navigateToInbox(): Promise<ApiResponse<{ currentUrl: string }>> {
    return this.request('POST', '/api/tiktok/inbox/navigate');
  }

  /**
   * List conversations
   */
  async listConversations(): Promise<ApiResponse<ConversationsResponse>> {
    return this.request('GET', '/api/tiktok/conversations');
  }

  /**
   * Open a conversation
   */
  async openConversation(
    username: string
  ): Promise<ApiResponse<{ currentUrl: string }>> {
    return this.request('POST', '/api/tiktok/conversations/open', { username });
  }

  /**
   * Read messages from current conversation
   */
  async readMessages(limit: number = 50): Promise<ApiResponse<MessagesResponse>> {
    return this.request('GET', `/api/tiktok/messages?limit=${limit}`);
  }

  /**
   * Send message in current conversation
   */
  async sendMessage(message: string): Promise<ApiResponse<SendMessageResponse>> {
    return this.request('POST', '/api/tiktok/messages/send', { message });
  }

  /**
   * Send message to a specific user (profile-to-DM flow)
   */
  async sendMessageTo(
    username: string,
    message: string
  ): Promise<ApiResponse<SendMessageResponse>> {
    return this.request('POST', '/api/tiktok/messages/send-to', { username, message });
  }

  /**
   * Send message via profile URL
   */
  async sendMessageToUrl(
    profileUrl: string,
    message: string
  ): Promise<ApiResponse<SendMessageResponse>> {
    return this.request('POST', '/api/tiktok/messages/send-to-url', { profileUrl, message });
  }

  /**
   * Start a new conversation
   */
  async startNewConversation(
    username: string,
    message: string
  ): Promise<ApiResponse<SendMessageResponse>> {
    return this.request('POST', '/api/tiktok/conversations/new', { username, message });
  }

  /**
   * Scroll to load more conversations
   */
  async scrollConversations(): Promise<ApiResponse<{ newCount: number }>> {
    return this.request('POST', '/api/tiktok/conversations/scroll');
  }

  /**
   * Execute raw JavaScript (for advanced usage)
   */
  async executeScript(script: string): Promise<ApiResponse<{ output: string }>> {
    return this.request('POST', '/api/execute', { script });
  }
}

/**
 * Create a TikTok DM client
 */
export function createTikTokDMClient(
  baseUrl: string = 'http://localhost:3102'
): TikTokDMClient {
  return new TikTokDMClient(baseUrl);
}
