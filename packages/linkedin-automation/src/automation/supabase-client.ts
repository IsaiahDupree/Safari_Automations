/**
 * Supabase Client for LinkedIn Automation
 * Stores DMs, connections, profiles, and actions in Supabase
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

export interface StoredAction {
  id?: string;
  platform: 'linkedin';
  action_type: 'dm' | 'connection' | 'profile_view' | 'search';
  profile_url?: string;
  profile_name?: string;
  content?: string;
  metadata?: Record<string, any>;
  success: boolean;
  error_message?: string;
  created_at?: string;
}

export interface StoredContact {
  id?: string;
  platform: 'linkedin';
  profile_url: string;
  name?: string;
  headline?: string;
  company?: string;
  location?: string;
  connection_degree?: string;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface StoredConversation {
  id?: string;
  platform: 'linkedin';
  participant_name: string;
  participant_profile_url?: string;
  last_message_at?: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export interface StoredMessage {
  id?: string;
  conversation_id: string;
  platform: 'linkedin';
  sender: 'me' | 'them';
  content: string;
  sent_at: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

export class SupabaseClient {
  private config: SupabaseConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: SupabaseConfig) {
    this.config = config;
    this.baseUrl = config.url;
    this.headers = {
      'Content-Type': 'application/json',
      'apikey': config.anonKey,
      'Authorization': `Bearer ${config.serviceRoleKey || config.anonKey}`,
    };
  }

  /**
   * Store a LinkedIn action (DM, connection, etc.)
   */
  async storeAction(action: StoredAction): Promise<{ data: any; error: any }> {
    // Only store successful actions
    if (!action.success) {
      return { data: null, error: null };
    }

    const payload = {
      platform: action.platform,
      action_type: action.action_type,
      profile_url: action.profile_url,
      profile_name: action.profile_name,
      content: action.content,
      metadata: action.metadata,
      success: action.success,
      error_message: action.error_message,
      created_at: action.created_at || new Date().toISOString(),
    };

    try {
      const response = await fetch(`${this.baseUrl}/rest/v1/linkedin_actions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        return { data: null, error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }

  /**
   * Upsert a contact (avoid duplicates)
   */
  async upsertContact(contact: StoredContact): Promise<{ data: any; error: any }> {
    const payload = {
      platform: contact.platform,
      profile_url: contact.profile_url,
      name: contact.name,
      headline: contact.headline,
      company: contact.company,
      location: contact.location,
      connection_degree: contact.connection_degree,
      metadata: contact.metadata,
      created_at: contact.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    try {
      // Use upsert with profile_url as unique key
      const response = await fetch(`${this.baseUrl}/rest/v1/crm_contacts?on_conflict=platform,profile_url`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        return { data: null, error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }

  /**
   * Store a conversation
   */
  async storeConversation(conversation: StoredConversation): Promise<{ data: any; error: any }> {
    const payload = {
      platform: conversation.platform,
      participant_name: conversation.participant_name,
      participant_profile_url: conversation.participant_profile_url,
      last_message_at: conversation.last_message_at || new Date().toISOString(),
      metadata: conversation.metadata,
      created_at: conversation.created_at || new Date().toISOString(),
    };

    try {
      const response = await fetch(`${this.baseUrl}/rest/v1/crm_conversations`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        return { data: null, error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }

  /**
   * Store a message
   */
  async storeMessage(message: StoredMessage): Promise<{ data: any; error: any }> {
    const payload = {
      conversation_id: message.conversation_id,
      platform: message.platform,
      sender: message.sender,
      content: message.content,
      sent_at: message.sent_at,
      metadata: message.metadata,
      created_at: message.created_at || new Date().toISOString(),
    };

    try {
      const response = await fetch(`${this.baseUrl}/rest/v1/crm_messages`, {
        method: 'POST',
        headers: { ...this.headers, 'Prefer': 'return=representation' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.text();
        return { data: null, error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: null, error: e.message };
    }
  }

  /**
   * Query recent actions
   */
  async getRecentActions(limit: number = 10): Promise<{ data: any[]; error: any }> {
    try {
      const response = await fetch(`${this.baseUrl}/rest/v1/linkedin_actions?order=created_at.desc&limit=${limit}`, {
        method: 'GET',
        headers: this.headers,
      });

      if (!response.ok) {
        const error = await response.text();
        return { data: [], error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (e: any) {
      return { data: [], error: e.message };
    }
  }
}

// Singleton instance
let instance: SupabaseClient | null = null;

export function getSupabaseClient(config?: SupabaseConfig): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    // Supabase not configured, return null (tests will handle this)
    return null;
  }

  if (!instance) {
    instance = new SupabaseClient({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
  }

  return instance;
}
