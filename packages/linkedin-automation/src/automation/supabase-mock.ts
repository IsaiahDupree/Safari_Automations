/**
 * Mock Supabase Client for Testing
 * Stores data in memory for integration tests
 */

import type { StoredAction, StoredContact, StoredConversation, StoredMessage } from './supabase-client.js';

interface MockDatabase {
  linkedin_actions: Array<StoredAction & { id: string; created_at: string }>;
  crm_contacts: Array<StoredContact & { id: string; created_at: string; updated_at: string }>;
  crm_conversations: Array<StoredConversation & { id: string; created_at: string }>;
  crm_messages: Array<StoredMessage & { id: string; created_at: string }>;
}

export class SupabaseMock {
  private db: MockDatabase = {
    linkedin_actions: [],
    crm_contacts: [],
    crm_conversations: [],
    crm_messages: [],
  };

  /**
   * Store a LinkedIn action
   */
  async storeAction(action: StoredAction): Promise<{ data: any; error: any }> {
    if (!action.success) {
      // Don't store failed actions
      return { data: null, error: null };
    }

    const record = {
      ...action,
      id: this.generateId(),
      created_at: action.created_at || new Date().toISOString(),
    };

    this.db.linkedin_actions.push(record);
    return { data: record, error: null };
  }

  /**
   * Upsert a contact
   */
  async upsertContact(contact: StoredContact): Promise<{ data: any; error: any }> {
    // Check for existing contact with same profile_url
    const existingIndex = this.db.crm_contacts.findIndex(
      c => c.platform === contact.platform && c.profile_url === contact.profile_url
    );

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      // Update existing
      this.db.crm_contacts[existingIndex] = {
        ...this.db.crm_contacts[existingIndex],
        ...contact,
        updated_at: now,
      };
      return { data: this.db.crm_contacts[existingIndex], error: null };
    } else {
      // Insert new
      const record = {
        ...contact,
        id: this.generateId(),
        created_at: contact.created_at || now,
        updated_at: now,
      };
      this.db.crm_contacts.push(record);
      return { data: record, error: null };
    }
  }

  /**
   * Store a conversation
   */
  async storeConversation(conversation: StoredConversation): Promise<{ data: any; error: any }> {
    const record = {
      ...conversation,
      id: this.generateId(),
      created_at: conversation.created_at || new Date().toISOString(),
    };

    this.db.crm_conversations.push(record);
    return { data: record, error: null };
  }

  /**
   * Store a message
   */
  async storeMessage(message: StoredMessage): Promise<{ data: any; error: any }> {
    const record = {
      ...message,
      id: this.generateId(),
      created_at: message.created_at || new Date().toISOString(),
    };

    this.db.crm_messages.push(record);
    return { data: record, error: null };
  }

  /**
   * Query recent actions
   */
  async getRecentActions(limit: number = 10): Promise<{ data: any[]; error: any }> {
    const actions = [...this.db.linkedin_actions]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
    return { data: actions, error: null };
  }

  /**
   * Get all data (for testing)
   */
  getAllData(): MockDatabase {
    return this.db;
  }

  /**
   * Clear all data (for testing)
   */
  clearAll(): void {
    this.db = {
      linkedin_actions: [],
      crm_contacts: [],
      crm_conversations: [],
      crm_messages: [],
    };
  }

  /**
   * Get contacts
   */
  async getContacts(): Promise<{ data: any[]; error: any }> {
    return { data: [...this.db.crm_contacts], error: null };
  }

  /**
   * Get conversations
   */
  async getConversations(): Promise<{ data: any[]; error: any }> {
    return { data: [...this.db.crm_conversations], error: null };
  }

  /**
   * Get messages
   */
  async getMessages(): Promise<{ data: any[]; error: any }> {
    return { data: [...this.db.crm_messages], error: null };
  }

  private generateId(): string {
    return `mock-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}

// Singleton instance
let instance: SupabaseMock | null = null;

export function getSupabaseMock(): SupabaseMock {
  if (!instance) {
    instance = new SupabaseMock();
  }
  return instance;
}
