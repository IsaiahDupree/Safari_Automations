/**
 * Safari Automation Client
 * Communicates with the Safari Automation server for Instagram DM operations.
 */

export interface SafariClientConfig {
  baseUrl: string;
  timeout?: number;
}

export interface DMConversation {
  username: string;
  lastMessage?: string;
}

export interface DMMessage {
  text: string;
  isOutbound: boolean;
  messageType: string;
}

export interface RateLimitStatus {
  messagesSentToday: number;
  messagesSentThisHour: number;
  limits: {
    messagesPerHour: number;
    messagesPerDay: number;
  };
  activeHours: {
    isActive: boolean;
    currentHour: number;
  };
}

export class SafariClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: SafariClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeout),
    });

    const data = await response.json() as T & { error?: string };

    if (!response.ok) {
      throw new Error(data.error || response.statusText);
    }

    return data;
  }

  // Health & Status
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    return this.request('GET', '/health');
  }

  async getStatus(): Promise<{ isOnInstagram: boolean; isLoggedIn: boolean; currentUrl: string }> {
    return this.request('GET', '/api/status');
  }

  async getRateLimits(): Promise<RateLimitStatus> {
    return this.request('GET', '/api/rate-limits');
  }

  // Navigation
  async navigateToInbox(): Promise<{ success: boolean }> {
    return this.request('POST', '/api/inbox/navigate');
  }

  async switchTab(tab: 'primary' | 'general' | 'requests' | 'hidden_requests'): Promise<{ success: boolean }> {
    return this.request('POST', '/api/inbox/tab', { tab });
  }

  // Conversations
  async listConversations(): Promise<{ conversations: DMConversation[]; count: number }> {
    return this.request('GET', '/api/conversations');
  }

  async getAllConversations(): Promise<{ 
    conversations: Record<string, DMConversation[]>; 
    totalCount: number;
  }> {
    return this.request('GET', '/api/conversations/all');
  }

  async openConversation(username: string): Promise<{ success: boolean }> {
    return this.request('POST', '/api/conversations/open', { username });
  }

  // Messages
  async readMessages(limit: number = 20): Promise<{ messages: DMMessage[]; count: number }> {
    return this.request('GET', `/api/messages?limit=${limit}`);
  }

  async sendMessage(text: string): Promise<{ success: boolean; error?: string }> {
    return this.request('POST', '/api/messages/send', { text });
  }

  async sendMessageTo(username: string, text: string): Promise<{ success: boolean; error?: string }> {
    return this.request('POST', '/api/messages/send-to', { username, text });
  }

  // Check if Safari server is available
  async isAvailable(): Promise<boolean> {
    try {
      await this.healthCheck();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
let safariClient: SafariClient | null = null;

export function initSafariClient(config: SafariClientConfig): SafariClient {
  safariClient = new SafariClient(config);
  return safariClient;
}

export function getSafariClient(): SafariClient {
  if (!safariClient) {
    throw new Error('Safari client not initialized. Call initSafariClient first.');
  }
  return safariClient;
}
