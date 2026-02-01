/**
 * CRM Client
 * 
 * Thin client for CRM operations. Currently wraps the local crm-core package,
 * but designed to be easily switched to an HTTP client when CRM is offloaded
 * to its own repository and API.
 */

import type { Contact, Interaction, Campaign, CRMConfig, DEFAULT_CRM_CONFIG } from './types.js';

export class CRMClient {
  private config: CRMConfig;
  private useLocalMode: boolean;

  constructor(config: Partial<CRMConfig> = {}) {
    this.config = {
      apiUrl: 'http://localhost:3020',
      timeout: 30000,
      ...config,
    };
    // For now, use local mode since CRM API doesn't exist yet
    this.useLocalMode = true;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    if (this.useLocalMode) {
      throw new Error('CRM API not available. Using local mode.');
    }

    const url = `${this.config.apiUrl}${path}`;
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

  // === CONTACTS ===

  async getContact(id: string): Promise<Contact | null> {
    if (this.useLocalMode) {
      // TODO: Import from crm-core when available
      console.log(`[CRM] Would fetch contact: ${id}`);
      return null;
    }
    return this.fetch<Contact>(`/api/contacts/${id}`);
  }

  async getContactByUsername(platform: string, username: string): Promise<Contact | null> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would fetch contact: ${platform}/${username}`);
      return null;
    }
    return this.fetch<Contact>(`/api/contacts/by-username/${platform}/${username}`);
  }

  async listContacts(options?: {
    platform?: string;
    tags?: string[];
    limit?: number;
    offset?: number;
  }): Promise<Contact[]> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would list contacts with options:`, options);
      return [];
    }
    const params = new URLSearchParams();
    if (options?.platform) params.set('platform', options.platform);
    if (options?.tags) params.set('tags', options.tags.join(','));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.offset) params.set('offset', String(options.offset));
    return this.fetch<Contact[]>(`/api/contacts?${params}`);
  }

  async createContact(contact: Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>): Promise<Contact> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would create contact:`, contact.username);
      return {
        ...contact,
        id: `temp_${Date.now()}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Contact;
    }
    return this.fetch<Contact>('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(contact),
    });
  }

  async updateContact(id: string, updates: Partial<Contact>): Promise<Contact> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would update contact ${id}:`, updates);
      return { id, ...updates } as Contact;
    }
    return this.fetch<Contact>(`/api/contacts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async addTag(contactId: string, tag: string): Promise<void> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would add tag ${tag} to contact ${contactId}`);
      return;
    }
    await this.fetch(`/api/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    });
  }

  // === INTERACTIONS ===

  async logInteraction(interaction: Omit<Interaction, 'id'>): Promise<Interaction> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would log interaction:`, interaction.type);
      return {
        ...interaction,
        id: `temp_${Date.now()}`,
      } as Interaction;
    }
    return this.fetch<Interaction>('/api/interactions', {
      method: 'POST',
      body: JSON.stringify(interaction),
    });
  }

  async getInteractions(contactId: string, limit = 50): Promise<Interaction[]> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would get interactions for contact ${contactId}`);
      return [];
    }
    return this.fetch<Interaction[]>(`/api/contacts/${contactId}/interactions?limit=${limit}`);
  }

  // === CAMPAIGNS ===

  async getCampaign(id: string): Promise<Campaign | null> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would fetch campaign: ${id}`);
      return null;
    }
    return this.fetch<Campaign>(`/api/campaigns/${id}`);
  }

  async listCampaigns(): Promise<Campaign[]> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would list campaigns`);
      return [];
    }
    return this.fetch<Campaign[]>('/api/campaigns');
  }

  // === UTILITY ===

  async syncFromPlatform(platform: string): Promise<{ synced: number }> {
    if (this.useLocalMode) {
      console.log(`[CRM] Would sync from platform: ${platform}`);
      return { synced: 0 };
    }
    return this.fetch<{ synced: number }>(`/api/sync/${platform}`, {
      method: 'POST',
    });
  }

  isConnected(): boolean {
    return !this.useLocalMode;
  }

  setApiMode(apiUrl: string): void {
    this.config.apiUrl = apiUrl;
    this.useLocalMode = false;
  }

  setLocalMode(): void {
    this.useLocalMode = true;
  }
}
