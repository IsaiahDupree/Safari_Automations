/**
 * DM Logger - Supabase CRM Integration
 * 
 * Shared module for logging all DM activity to Supabase.
 * Import this from any platform server to wire CRM logging.
 * 
 * Tables: dm_contacts, dm_messages, dm_sessions
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type DMPlatform = 'instagram' | 'tiktok' | 'twitter';

export interface DMLogEntry {
  platform: DMPlatform;
  username: string;
  messageText: string;
  isOutbound: boolean;
  sentByAutomation?: boolean;
  aiGenerated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DMSessionEntry {
  platform: DMPlatform;
  messagesSent?: number;
  messagesRead?: number;
  errors?: number;
  metadata?: Record<string, unknown>;
}

let supabase: SupabaseClient | null = null;
let loggerEnabled = false;

/**
 * Initialize the DM logger with Supabase credentials.
 * Call once at server startup. If credentials missing, logger is a no-op.
 */
export function initDMLogger(url?: string, key?: string): boolean {
  const supabaseUrl = url || process.env.SUPABASE_URL || process.env.CRM_SUPABASE_URL;
  const supabaseKey = key || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.CRM_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('[DM Logger] ⚠️ Supabase credentials not found - CRM logging disabled');
    loggerEnabled = false;
    return false;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    loggerEnabled = true;
    console.log('[DM Logger] ✅ Connected to Supabase - CRM logging enabled');
    return true;
  } catch (error) {
    console.error('[DM Logger] ❌ Failed to initialize:', error);
    loggerEnabled = false;
    return false;
  }
}

/**
 * Check if the logger is active.
 */
export function isLoggerEnabled(): boolean {
  return loggerEnabled;
}

/**
 * Get or create a contact by platform + username.
 */
export async function getOrCreateContact(
  platform: DMPlatform,
  username: string
): Promise<string | null> {
  if (!supabase || !loggerEnabled) return null;

  try {
    // Try to find existing contact
    const { data: existing } = await supabase
      .from('dm_contacts')
      .select('id')
      .eq('platform', platform)
      .eq('platform_username', username)
      .single();

    if (existing) return existing.id;

    // Create new contact
    const { data: created, error } = await supabase
      .from('dm_contacts')
      .insert({
        platform,
        platform_username: username,
        pipeline_stage: 'first_touch',
        first_touch_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[DM Logger] Error creating contact:', error.message);
      return null;
    }

    return created?.id || null;
  } catch (error) {
    console.error('[DM Logger] getOrCreateContact error:', error);
    return null;
  }
}

/**
 * Log a DM message (sent or received).
 */
export async function logDM(entry: DMLogEntry): Promise<boolean> {
  if (!supabase || !loggerEnabled) return false;

  try {
    const contactId = await getOrCreateContact(entry.platform, entry.username);

    const { error } = await supabase.from('dm_messages').insert({
      contact_id: contactId,
      platform: entry.platform,
      platform_username: entry.username,
      message_text: entry.messageText,
      message_type: 'text',
      is_outbound: entry.isOutbound,
      sent_by_automation: entry.sentByAutomation ?? true,
      ai_generated: entry.aiGenerated ?? false,
      metadata: entry.metadata || {},
    });

    if (error) {
      console.error('[DM Logger] Error logging DM:', error.message);
      return false;
    }

    // Update contact stats
    if (contactId) {
      const field = entry.isOutbound ? 'total_messages_sent' : 'total_messages_received';
      const { data: contact } = await supabase
        .from('dm_contacts')
        .select(field)
        .eq('id', contactId)
        .single();

      if (contact) {
        await supabase
          .from('dm_contacts')
          .update({
            [field]: (contact[field] || 0) + 1,
            last_message_at: new Date().toISOString(),
          })
          .eq('id', contactId);
      }
    }

    return true;
  } catch (error) {
    console.error('[DM Logger] logDM error:', error);
    return false;
  }
}

/**
 * Start a DM session (track automation run).
 */
export async function startSession(platform: DMPlatform): Promise<string | null> {
  if (!supabase || !loggerEnabled) return null;

  try {
    const { data, error } = await supabase
      .from('dm_sessions')
      .insert({ platform })
      .select('id')
      .single();

    if (error) {
      console.error('[DM Logger] Error starting session:', error.message);
      return null;
    }

    return data?.id || null;
  } catch (error) {
    console.error('[DM Logger] startSession error:', error);
    return null;
  }
}

/**
 * End a DM session with stats.
 */
export async function endSession(
  sessionId: string,
  stats: Partial<DMSessionEntry>
): Promise<boolean> {
  if (!supabase || !loggerEnabled || !sessionId) return false;

  try {
    const { error } = await supabase
      .from('dm_sessions')
      .update({
        ended_at: new Date().toISOString(),
        messages_sent: stats.messagesSent ?? 0,
        messages_read: stats.messagesRead ?? 0,
        errors: stats.errors ?? 0,
        metadata: stats.metadata || {},
      })
      .eq('id', sessionId);

    if (error) {
      console.error('[DM Logger] Error ending session:', error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[DM Logger] endSession error:', error);
    return false;
  }
}

/**
 * Get recent DM stats for a platform.
 */
export async function getDMStats(platform: DMPlatform): Promise<{
  totalContacts: number;
  totalMessagesSent: number;
  totalMessagesReceived: number;
  messagesToday: number;
} | null> {
  if (!supabase || !loggerEnabled) return null;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [contactsResult, sentResult, receivedResult, todayResult] = await Promise.all([
      supabase.from('dm_contacts').select('id', { count: 'exact', head: true }).eq('platform', platform),
      supabase.from('dm_messages').select('id', { count: 'exact', head: true }).eq('platform', platform).eq('is_outbound', true),
      supabase.from('dm_messages').select('id', { count: 'exact', head: true }).eq('platform', platform).eq('is_outbound', false),
      supabase.from('dm_messages').select('id', { count: 'exact', head: true }).eq('platform', platform).eq('is_outbound', true).gte('created_at', today.toISOString()),
    ]);

    return {
      totalContacts: contactsResult.count || 0,
      totalMessagesSent: sentResult.count || 0,
      totalMessagesReceived: receivedResult.count || 0,
      messagesToday: todayResult.count || 0,
    };
  } catch (error) {
    console.error('[DM Logger] getDMStats error:', error);
    return null;
  }
}
