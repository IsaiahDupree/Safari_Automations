/**
 * Shared DM Logger - Supabase CRM Integration
 * 
 * Import from any platform DM server:
 *   import { initDMLogger, logDM } from '../../shared/dm-logger.js';
 * 
 * Tables: dm_contacts, dm_messages, dm_sessions (in Supabase)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

let supabase: SupabaseClient | null = null;
let loggerEnabled = false;

/**
 * Initialize the DM logger. Call once at server startup.
 * If credentials missing, logger becomes a silent no-op.
 */
export function initDMLogger(url?: string, key?: string): boolean {
  const supabaseUrl = url || process.env.SUPABASE_URL || process.env.CRM_SUPABASE_URL;
  const supabaseKey = key || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.CRM_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('[DM Logger] ⚠️ No Supabase credentials - CRM logging disabled');
    loggerEnabled = false;
    return false;
  }

  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    loggerEnabled = true;
    console.log('[DM Logger] ✅ Supabase connected - CRM logging enabled');
    return true;
  } catch (error) {
    console.error('[DM Logger] ❌ Init failed:', error);
    loggerEnabled = false;
    return false;
  }
}

export function isLoggerEnabled(): boolean {
  return loggerEnabled;
}

/**
 * Get or create a contact. Returns contact ID or null.
 */
async function getOrCreateContact(platform: DMPlatform, username: string): Promise<string | null> {
  if (!supabase) return null;

  try {
    const { data: existing } = await supabase
      .from('dm_contacts')
      .select('id')
      .eq('platform', platform)
      .eq('platform_username', username)
      .single();

    if (existing) return existing.id;

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
      console.error('[DM Logger] Contact create error:', error.message);
      return null;
    }
    return created?.id || null;
  } catch (error) {
    console.error('[DM Logger] getOrCreateContact error:', error);
    return null;
  }
}

/**
 * Log a DM (sent or received). Non-blocking, never throws.
 */
export async function logDM(entry: DMLogEntry): Promise<void> {
  if (!supabase || !loggerEnabled) return;

  try {
    const contactId = await getOrCreateContact(entry.platform, entry.username);

    await supabase.from('dm_messages').insert({
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

    // Update contact stats
    if (contactId) {
      const field = entry.isOutbound ? 'total_messages_sent' : 'total_messages_received';
      const { data: contact } = await supabase
        .from('dm_contacts')
        .select(field)
        .eq('id', contactId)
        .single();

      if (contact) {
        await supabase.from('dm_contacts').update({
          [field]: (contact[field] || 0) + 1,
          last_message_at: new Date().toISOString(),
        }).eq('id', contactId);
      }
    }
  } catch (error) {
    console.error('[DM Logger] logDM error:', error);
  }
}

/**
 * Get CRM stats for a platform. Returns null if logger disabled.
 */
export async function getDMStats(platform: DMPlatform): Promise<{
  totalContacts: number;
  messagesSentTotal: number;
  messagesToday: number;
} | null> {
  if (!supabase || !loggerEnabled) return null;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [contacts, sent, sentToday] = await Promise.all([
      supabase.from('dm_contacts').select('id', { count: 'exact', head: true }).eq('platform', platform),
      supabase.from('dm_messages').select('id', { count: 'exact', head: true }).eq('platform', platform).eq('is_outbound', true),
      supabase.from('dm_messages').select('id', { count: 'exact', head: true }).eq('platform', platform).eq('is_outbound', true).gte('created_at', today.toISOString()),
    ]);

    return {
      totalContacts: contacts.count || 0,
      messagesSentTotal: sent.count || 0,
      messagesToday: sentToday.count || 0,
    };
  } catch {
    return null;
  }
}
