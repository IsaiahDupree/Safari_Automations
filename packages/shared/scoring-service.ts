/**
 * Scoring Service - Relationship Score Calculator
 * 
 * Connects the crm-core scoring engine to Supabase dm_contacts/dm_messages.
 * Import from any DM server to recalculate scores after interactions.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// === Inline scoring logic (from crm-core/scoring-engine) ===
// Inlined to avoid cross-package rootDir issues with TypeScript

interface ScoreResult {
  overall: number;
  recency: number;
  resonance: number;
  tier: string;
  emoji: string;
}

function calcRecency(lastMessageAt?: string): number {
  if (!lastMessageAt) return 20;
  const days = Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / 86400000);
  if (days <= 3) return 100;
  if (days <= 7) return 85;
  if (days <= 14) return 70;
  if (days <= 30) return 50;
  if (days <= 60) return 30;
  return 10;
}

function calcResonance(inboundMessages: { text: string }[]): number {
  if (inboundMessages.length === 0) return 20;
  let total = 0;
  for (const msg of inboundMessages) {
    let s = 30;
    if (msg.text.length > 100) s += 20;
    if (msg.text.length > 200) s += 10;
    if (msg.text.includes('?')) s += 15;
    if (/i('m| am)|my |we |our /i.test(msg.text)) s += 15;
    if (/love|great|awesome|excited|happy|thanks/i.test(msg.text)) s += 10;
    total += Math.min(100, s);
  }
  return Math.round(total / inboundMessages.length);
}

function calcActivityBonus(sent: number, received: number): number {
  const total = sent + received;
  if (total === 0) return 10;
  if (total <= 2) return 30;
  if (total <= 5) return 50;
  if (total <= 10) return 70;
  if (total <= 20) return 85;
  return 100;
}

function getTier(score: number): { tier: string; emoji: string } {
  if (score >= 80) return { tier: 'Strong', emoji: '🌟' };
  if (score >= 60) return { tier: 'Growing', emoji: '📈' };
  if (score >= 40) return { tier: 'Building', emoji: '📊' };
  if (score >= 20) return { tier: 'New', emoji: '🌱' };
  return { tier: 'Cold', emoji: '❄️' };
}

// === Supabase integration ===

let supabase: SupabaseClient | null = null;
let enabled = false;

export function initScoringService(url?: string, key?: string): boolean {
  const supabaseUrl = url || process.env.SUPABASE_URL || process.env.CRM_SUPABASE_URL;
  const supabaseKey = key || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return false;
  try {
    supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    enabled = true;
    return true;
  } catch { return false; }
}

/**
 * Recalculate and store the relationship score for a contact.
 */
export async function recalculateScore(contactId: string): Promise<ScoreResult | null> {
  if (!supabase || !enabled) return null;

  try {
    // Get contact data
    const { data: contact } = await supabase
      .from('dm_contacts')
      .select('*')
      .eq('id', contactId)
      .single();
    if (!contact) return null;

    // Get inbound messages for resonance
    const { data: messages } = await supabase
      .from('dm_messages')
      .select('message_text, is_outbound')
      .eq('contact_id', contactId)
      .eq('is_outbound', false)
      .order('created_at', { ascending: false })
      .limit(50);

    const inbound = (messages || []).map(m => ({ text: m.message_text || '' }));

    // Calculate scores
    const recency = calcRecency(contact.last_message_at);
    const resonance = calcResonance(inbound);
    const activity = calcActivityBonus(
      contact.total_messages_sent || 0,
      contact.total_messages_received || 0
    );

    // Weighted: recency 30%, resonance 35%, activity 35%
    const overall = Math.round(recency * 0.30 + resonance * 0.35 + activity * 0.35);
    const clamped = Math.max(0, Math.min(100, overall));
    const { tier, emoji } = getTier(clamped);

    // Store back to contact
    await supabase.from('dm_contacts').update({
      relationship_score: clamped,
    }).eq('id', contactId);

    return { overall: clamped, recency, resonance, tier, emoji };
  } catch (error) {
    console.error('[Scoring] recalculateScore error:', error);
    return null;
  }
}

/**
 * Recalculate scores for all contacts on a platform.
 */
export async function recalculateAllScores(platform: 'instagram' | 'tiktok' | 'twitter'): Promise<{
  updated: number;
  errors: number;
}> {
  if (!supabase || !enabled) return { updated: 0, errors: 0 };

  try {
    const { data: contacts } = await supabase
      .from('dm_contacts')
      .select('id')
      .eq('platform', platform);

    let updated = 0;
    let errors = 0;

    for (const contact of (contacts || [])) {
      const result = await recalculateScore(contact.id);
      if (result) updated++;
      else errors++;
    }

    return { updated, errors };
  } catch {
    return { updated: 0, errors: 0 };
  }
}

/**
 * Get top contacts by score for a platform.
 */
export async function getTopContacts(platform: 'instagram' | 'tiktok' | 'twitter', limit = 10): Promise<Array<{
  id: string;
  username: string;
  score: number;
  lastMessage: string | null;
  messagesSent: number;
}>> {
  if (!supabase || !enabled) return [];

  try {
    const { data } = await supabase
      .from('dm_contacts')
      .select('id, platform_username, relationship_score, last_message_at, total_messages_sent')
      .eq('platform', platform)
      .order('relationship_score', { ascending: false })
      .limit(limit);

    return (data || []).map(c => ({
      id: c.id,
      username: c.platform_username,
      score: c.relationship_score || 0,
      lastMessage: c.last_message_at,
      messagesSent: c.total_messages_sent || 0,
    }));
  } catch { return []; }
}
