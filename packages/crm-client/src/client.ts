/**
 * CRM Client
 * 
 * HTTP client for CRMLite — the cross-platform CRM service.
 * Connects to the CRMLite REST API for contacts, conversations,
 * interactions, campaigns, RevenueCat, and DM sync.
 */

import type { Contact, Interaction, Campaign, CRMConfig, Platform } from './types.js';

export class CRMClient {
  private config: CRMConfig;
  private apiKey: string;

  constructor(config: Partial<CRMConfig & { apiKey?: string }> = {}) {
    this.config = {
      apiUrl: config.apiUrl || process.env.CRMLITE_URL || 'http://localhost:3020',
      timeout: config.timeout || 30000,
    };
    this.apiKey = config.apiKey || process.env.CRMLITE_KEY || '';
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.apiUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${body.slice(0, 200)}`);
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // === HEALTH ===

  async healthCheck(): Promise<{ status: string; service: string }> {
    return this.fetch('/api/health');
  }

  // === CONTACTS ===

  async getContact(id: string): Promise<Contact | null> {
    try {
      return await this.fetch<Contact>(`/api/contacts/${id}`);
    } catch {
      return null;
    }
  }

  async getContactByUsername(platform: string, username: string): Promise<Contact | null> {
    try {
      return await this.fetch<Contact>(
        `/api/contacts/by-username/${encodeURIComponent(platform)}/${encodeURIComponent(username)}`
      );
    } catch {
      return null;
    }
  }

  async listContacts(options?: {
    platform?: string;
    stage?: string;
    tag?: string;
    search?: string;
    revcat_status?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }): Promise<{ contacts: Contact[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.platform) params.set('platform', options.platform);
    if (options?.stage) params.set('stage', options.stage);
    if (options?.tag) params.set('tag', options.tag);
    if (options?.search) params.set('search', options.search);
    if (options?.revcat_status) params.set('revcat_status', options.revcat_status);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.order) params.set('order', options.order);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    return this.fetch(`/api/contacts?${params}`);
  }

  async createContact(contact: Partial<Contact> & {
    platform_accounts?: Array<{
      platform: Platform;
      username: string;
      display_name?: string;
      platform_user_id?: string;
      is_primary?: boolean;
    }>;
  }): Promise<Contact> {
    return this.fetch<Contact>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(contact),
    });
  }

  async updateContact(id: string, updates: Partial<Contact>): Promise<Contact> {
    return this.fetch<Contact>(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteContact(id: string): Promise<void> {
    await this.fetch(`/api/contacts/${id}`, { method: 'DELETE' });
  }

  async addTag(contactId: string, tag: string): Promise<{ tags: string[] }> {
    return this.fetch(`/api/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    });
  }

  async removeTag(contactId: string, tag: string): Promise<{ tags: string[] }> {
    return this.fetch(`/api/contacts/${contactId}/tags`, {
      method: 'DELETE',
      body: JSON.stringify({ tag }),
    });
  }

  // === INTERACTIONS ===

  async logInteraction(contactId: string, interaction: {
    type: string;
    platform?: string;
    summary?: string;
    outcome?: string;
    sentiment?: string;
    value_delivered?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<Interaction> {
    return this.fetch<Interaction>(`/api/contacts/${contactId}/interactions`, {
      method: 'POST',
      body: JSON.stringify(interaction),
    });
  }

  async getInteractions(contactId: string, limit = 50): Promise<{ interactions: Interaction[] }> {
    return this.fetch(`/api/contacts/${contactId}/interactions?limit=${limit}`);
  }

  // === CONVERSATIONS ===

  async listConversations(options?: {
    platform?: string;
    contact_id?: string;
    active?: boolean;
    limit?: number;
  }): Promise<{ conversations: unknown[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.platform) params.set('platform', options.platform);
    if (options?.contact_id) params.set('contact_id', options.contact_id);
    if (options?.active !== undefined) params.set('active', String(options.active));
    if (options?.limit) params.set('limit', String(options.limit));
    return this.fetch(`/api/conversations?${params}`);
  }

  async getConversationMessages(conversationId: string, limit = 50): Promise<{ messages: unknown[] }> {
    return this.fetch(`/api/conversations/${conversationId}/messages?limit=${limit}`);
  }

  // === CAMPAIGNS ===

  async listCampaigns(status?: string): Promise<{ campaigns: Campaign[] }> {
    const params = status ? `?status=${status}` : '';
    return this.fetch(`/api/campaigns${params}`);
  }

  async createCampaign(campaign: {
    name: string;
    description?: string;
    type?: string;
    target_criteria?: Record<string, unknown>;
    message_templates?: Record<string, unknown>[];
    platforms?: string[];
  }): Promise<Campaign> {
    return this.fetch<Campaign>('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(campaign),
    });
  }

  // === REVCAT ===

  async getSubscriber(appUserId: string): Promise<{
    contact: Contact | null;
    events: unknown[];
    live_subscriber: unknown;
  }> {
    return this.fetch(`/api/revcat/subscriber/${encodeURIComponent(appUserId)}`);
  }

  async linkRevCatUser(appUserId: string, contactId: string): Promise<{ linked: boolean; contact: Contact }> {
    return this.fetch(`/api/revcat/subscriber/${encodeURIComponent(appUserId)}`, {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId }),
    });
  }

  // === DM SYNC ===

  async syncDMs(platform: string, conversations: unknown[]): Promise<{
    synced: boolean;
    contacts_created: number;
    contacts_updated: number;
    conversations_synced: number;
    messages_synced: number;
  }> {
    return this.fetch('/api/sync/dm', {
      method: 'POST',
      body: JSON.stringify({ platform, conversations }),
    });
  }

  async getSyncHistory(): Promise<{ sync_history: unknown[] }> {
    return this.fetch('/api/sync/dm');
  }

  // === STATS ===

  async getStats(): Promise<{
    contacts: { total: number; by_stage: Record<string, number>; by_platform: Record<string, number> };
    revenue: { active_subscribers: number; total_revenue: number };
    conversations: { active: number; total_messages: number };
    last_sync: unknown;
  }> {
    return this.fetch('/api/stats');
  }

  // === PLATFORM ACCOUNTS ===

  async addPlatformAccount(contactId: string, account: {
    platform: Platform;
    username: string;
    display_name?: string;
    platform_user_id?: string;
    is_primary?: boolean;
  }): Promise<unknown> {
    return this.fetch('/api/platform-accounts', {
      method: 'POST',
      body: JSON.stringify({ contact_id: contactId, ...account }),
    });
  }

  async listPlatformAccounts(options?: {
    platform?: string;
    contact_id?: string;
  }): Promise<{ accounts: unknown[] }> {
    const params = new URLSearchParams();
    if (options?.platform) params.set('platform', options.platform);
    if (options?.contact_id) params.set('contact_id', options.contact_id);
    return this.fetch(`/api/platform-accounts?${params}`);
  }

  // === CONFIG ===

  isConnected(): boolean {
    return !!this.config.apiUrl;
  }

  setApiUrl(apiUrl: string): void {
    this.config.apiUrl = apiUrl;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }
}
