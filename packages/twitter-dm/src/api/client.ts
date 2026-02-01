/**
 * Twitter/X DM API Client
 * Client library for calling the DM API from CRM server.
 */

import type {
  DMConversation,
  DMMessage,
  DMTab,
  SendMessageResult,
  NavigationResult,
  ProfileDMResult,
  AutomationConfig,
  RateLimitConfig,
} from '../automation/types.js';

export interface DMApiClientConfig {
  baseUrl: string;
  timeout?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class TwitterDMClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: DMApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeout),
      });

      const data = await response.json() as T & { error?: string };

      if (!response.ok) {
        return { success: false, error: data.error || response.statusText };
      }

      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  // === STATUS ===

  async healthCheck(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    return this.request('GET', '/health');
  }

  async getStatus(): Promise<ApiResponse<{
    isOnTwitter: boolean;
    isLoggedIn: boolean;
    currentUrl: string;
    driverConfig: AutomationConfig;
  }>> {
    return this.request('GET', '/api/twitter/status');
  }

  async getRateLimits(): Promise<ApiResponse<{
    messagesSentToday: number;
    messagesSentThisHour: number;
    limits: RateLimitConfig;
    activeHours: { start: number; end: number; currentHour: number; isActive: boolean };
  }>> {
    return this.request('GET', '/api/twitter/rate-limits');
  }

  async updateRateLimits(limits: Partial<RateLimitConfig>): Promise<ApiResponse<{ rateLimits: RateLimitConfig }>> {
    return this.request('PUT', '/api/twitter/rate-limits', limits);
  }

  // === NAVIGATION ===

  async navigateToInbox(): Promise<ApiResponse<NavigationResult>> {
    return this.request('POST', '/api/twitter/inbox/navigate');
  }

  async switchTab(tab: DMTab): Promise<ApiResponse<{ success: boolean; tab: DMTab }>> {
    return this.request('POST', '/api/twitter/inbox/tab', { tab });
  }

  // === CONVERSATIONS ===

  async listConversations(): Promise<ApiResponse<{ conversations: DMConversation[]; count: number }>> {
    return this.request('GET', '/api/twitter/conversations');
  }

  async getAllConversations(): Promise<ApiResponse<{
    conversations: Record<DMTab, DMConversation[]>;
    totalCount: number;
  }>> {
    return this.request('GET', '/api/twitter/conversations/all');
  }

  async openConversation(username: string): Promise<ApiResponse<{ success: boolean; username: string }>> {
    return this.request('POST', '/api/twitter/conversations/open', { username });
  }

  async startNewConversation(username: string): Promise<ApiResponse<{ success: boolean; username: string }>> {
    return this.request('POST', '/api/twitter/conversations/new', { username });
  }

  async getUnreadConversations(): Promise<ApiResponse<{ conversations: DMConversation[]; count: number }>> {
    return this.request('GET', '/api/twitter/conversations/unread');
  }

  // === MESSAGES ===

  async readMessages(limit: number = 20): Promise<ApiResponse<{ messages: DMMessage[]; count: number }>> {
    return this.request('GET', `/api/twitter/messages?limit=${limit}`);
  }

  async sendMessage(text: string): Promise<ApiResponse<SendMessageResult & {
    rateLimits: { messagesSentToday: number; messagesSentThisHour: number };
  }>> {
    return this.request('POST', '/api/twitter/messages/send', { text });
  }

  async sendMessageTo(username: string, text: string): Promise<ApiResponse<ProfileDMResult & {
    rateLimits: { messagesSentToday: number; messagesSentThisHour: number };
  }>> {
    return this.request('POST', '/api/twitter/messages/send-to', { username, text });
  }

  async sendMessageToUrl(profileUrl: string, text: string): Promise<ApiResponse<ProfileDMResult & {
    rateLimits: { messagesSentToday: number; messagesSentThisHour: number };
  }>> {
    return this.request('POST', '/api/twitter/messages/send-to-url', { profileUrl, text });
  }

  // === ADVANCED ===

  async executeScript(script: string): Promise<ApiResponse<{ output: string }>> {
    return this.request('POST', '/api/twitter/execute', { script });
  }

  async updateConfig(config: Partial<AutomationConfig>): Promise<ApiResponse<{ config: AutomationConfig }>> {
    return this.request('PUT', '/api/twitter/config', config);
  }

  async scrollConversation(scrollCount: number = 3): Promise<ApiResponse<{ totalMessages: number }>> {
    return this.request('POST', '/api/twitter/conversations/scroll', { scrollCount });
  }
}

/**
 * Create a client instance with default configuration.
 */
export function createTwitterDMClient(baseUrl: string = 'http://localhost:3100'): TwitterDMClient {
  return new TwitterDMClient({ baseUrl });
}
