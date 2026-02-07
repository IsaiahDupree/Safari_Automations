/**
 * DM Template Engine
 * 
 * Selects and personalizes message templates from the nba_templates table.
 * Supports lane-based routing, score filtering, placeholder filling, and fit signal detection.
 * 
 * Tables used:
 *   - nba_templates: 18 templates across 5 lanes (friendship, service, offer, retention, rewarm)
 *   - fit_signal_config: keyword→product mapping for detecting needs
 *   - suggested_actions: outreach queue with scheduling
 * 
 * References:
 *   - PRD_DM_Playbook.md (template definitions, lanes, 3:1 rule)
 *   - PRD_DM_Outreach_System.md (phases, sequencing)
 *   - PRD_DM_Automation.md (scoring, pipeline stages, context cards)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface Template {
  id: string;
  lane: string;
  stage: string;
  action_type: string;
  template_text: string;
  description: string;
  variables: string[];
  min_score: number;
  max_score: number;
}

export interface FitSignal {
  product: string;
  signal_keywords: string[];
  offer_template: string;
}

export interface ContactContext {
  username: string;
  display_name?: string;
  platform: 'instagram' | 'tiktok' | 'twitter';
  relationship_score?: number;
  pipeline_stage?: string;
  building?: string;
  struggles?: string;
  goal?: string;
  resource?: string;
  project?: string;
  topic?: string;
  pain_point?: string;
}

export interface TemplateResult {
  template_id: string;
  lane: string;
  action_type: string;
  raw_template: string;
  personalized_message: string;
  reason: string;
}

export interface FitDetectionResult {
  detected: boolean;
  signals: { product: string; keyword: string; offer_template: string }[];
}

export interface OutreachAction {
  id?: string;
  contact_id: string;
  platform: string;
  template_id: string;
  lane: string;
  message: string;
  personalized_message: string;
  priority: number;
  phase: string;
  status: string;
  scheduled_for?: string;
}

// ============================================================================
// TEMPLATE ENGINE
// ============================================================================

let supabase: SupabaseClient | null = null;

export function initTemplateEngine(): void {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[TEMPLATES] ⚠️ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY — template engine disabled');
    return;
  }

  supabase = createClient(url, key);
  console.log('[TEMPLATES] ✅ Template engine initialized');
}

/**
 * Determine which lane a contact should be in based on score and stage.
 * Lanes: friendship, service, offer, retention, rewarm
 */
export function determineLane(score: number, stage?: string): string {
  if (stage === 'post_win_expansion') return 'retention';
  if (stage === 'fit_repeats' || stage === 'permissioned_offer') return 'offer';
  if (score < 40) return 'rewarm';
  if (score >= 40 && score < 70) return 'service';
  return 'friendship';
}

/**
 * Determine outreach phase based on pipeline stage.
 * Phases: introduction, value_delivery, relationship_deepening, offer_introduction
 */
export function determinePhase(stage?: string): string {
  if (!stage || stage === 'first_touch') return 'introduction';
  if (stage === 'context_captured' || stage === 'micro_win_delivered') return 'value_delivery';
  if (stage === 'cadence_established' || stage === 'trust_signals') return 'relationship_deepening';
  if (stage === 'fit_repeats' || stage === 'permissioned_offer' || stage === 'post_win_expansion') return 'offer_introduction';
  return 'introduction';
}

/**
 * Fill template placeholders with contact context.
 * Placeholders: ___ or {variable_name}
 */
export function fillTemplate(template: string, context: ContactContext): string {
  let result = template;

  const replacements: Record<string, string | undefined> = {
    name: context.display_name || context.username,
    username: context.username,
    goal: context.goal,
    resource: context.resource,
    project: context.project,
    topic: context.topic || context.building,
    pain_point: context.pain_point || context.struggles,
    their_topic: context.building,
    interest: context.building,
  };

  // Replace {variable} placeholders
  for (const [key, value] of Object.entries(replacements)) {
    if (value) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
  }

  // Replace ___ with best available context
  const fallback = context.building || context.goal || context.topic || context.struggles || 'that';
  result = result.replace(/___/g, fallback);

  return result;
}

/**
 * Get templates for a specific lane, filtered by score range and stage.
 */
export async function getTemplates(opts: {
  lane?: string;
  score?: number;
  stage?: string;
  platform?: string;
}): Promise<Template[]> {
  if (!supabase) return [];

  let query = supabase.from('nba_templates').select('*').eq('active', true);

  if (opts.lane) query = query.eq('lane', opts.lane);
  if (opts.platform) {
    query = query.or(`platform.eq.all,platform.eq.${opts.platform}`);
  }
  if (opts.score !== undefined) {
    query = query.lte('min_score', opts.score).gte('max_score', opts.score);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[TEMPLATES] Error fetching templates:', error.message);
    return [];
  }

  let templates = (data || []) as Template[];

  // Filter by stage if provided
  if (opts.stage) {
    const stageMatched = templates.filter(t => t.stage === opts.stage || t.stage === 'any');
    if (stageMatched.length > 0) templates = stageMatched;
  }

  return templates;
}

/**
 * Get the next-best-action template for a contact.
 * Uses lane determination, score filtering, and stage matching.
 */
export async function getNextBestAction(context: ContactContext): Promise<TemplateResult | null> {
  if (!supabase) return null;

  const score = context.relationship_score ?? 50;
  const lane = determineLane(score, context.pipeline_stage);

  const templates = await getTemplates({
    lane,
    score,
    stage: context.pipeline_stage,
    platform: context.platform,
  });

  if (templates.length === 0) return null;

  // Pick a random template from the pool
  const template = templates[Math.floor(Math.random() * templates.length)];
  const personalized = fillTemplate(template.template_text, context);

  const reasons: Record<string, string> = {
    friendship: `Score ${score} — nurture relationship`,
    service: `Score ${score}, has context — deliver value`,
    offer: `Fit signals detected — ready for permissioned offer`,
    retention: `Post-win — maintain relationship`,
    rewarm: `Score ${score} — needs re-engagement`,
  };

  return {
    template_id: template.id,
    lane,
    action_type: template.action_type,
    raw_template: template.template_text,
    personalized_message: personalized,
    reason: reasons[lane] || `Lane: ${lane}`,
  };
}

/**
 * Detect fit signals in conversation text.
 * Scans for keywords mapped to products in fit_signal_config.
 */
export async function detectFitSignals(conversationText: string): Promise<FitDetectionResult> {
  if (!supabase) return { detected: false, signals: [] };

  const { data: configs, error } = await supabase
    .from('fit_signal_config')
    .select('*');

  if (error || !configs) return { detected: false, signals: [] };

  const lowerText = conversationText.toLowerCase();
  const signals: { product: string; keyword: string; offer_template: string }[] = [];

  for (const config of configs as FitSignal[]) {
    for (const keyword of config.signal_keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        signals.push({
          product: config.product,
          keyword,
          offer_template: config.offer_template,
        });
      }
    }
  }

  // Deduplicate by product
  const unique = signals.filter((s, i, arr) => arr.findIndex(x => x.product === s.product) === i);

  return { detected: unique.length > 0, signals: unique };
}

/**
 * Queue an outreach action for a contact.
 */
export async function queueOutreachAction(action: OutreachAction): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!supabase) return { success: false, error: 'Template engine not initialized' };

  const { data, error } = await supabase
    .from('suggested_actions')
    .insert({
      contact_id: action.contact_id,
      platform: action.platform,
      template_id: action.template_id,
      lane: action.lane,
      message: action.message,
      personalized_message: action.personalized_message,
      priority: action.priority,
      phase: action.phase,
      status: action.status || 'pending',
      scheduled_for: action.scheduled_for || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: (data as Record<string, string>)?.id };
}

/**
 * Get pending outreach actions for a platform.
 */
export async function getPendingActions(platform: string, limit = 10): Promise<OutreachAction[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('suggested_actions')
    .select('*')
    .eq('platform', platform)
    .eq('status', 'pending')
    .order('priority', { ascending: false })
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[TEMPLATES] Error fetching actions:', error.message);
    return [];
  }

  return (data || []) as OutreachAction[];
}

/**
 * Mark an outreach action as sent.
 */
export async function markActionSent(actionId: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('suggested_actions')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);

  return !error;
}

/**
 * Mark an outreach action as failed.
 */
export async function markActionFailed(actionId: string, errorMsg: string): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from('suggested_actions')
    .update({
      status: 'failed',
      error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId);

  return !error;
}

/**
 * Get outreach stats for a platform.
 */
export async function getOutreachStats(platform: string): Promise<Record<string, number>> {
  if (!supabase) return {};

  const statuses = ['pending', 'sent', 'failed', 'skipped'];
  const stats: Record<string, number> = {};

  for (const status of statuses) {
    const { count } = await supabase
      .from('suggested_actions')
      .select('*', { count: 'exact', head: true })
      .eq('platform', platform)
      .eq('status', status);

    stats[status] = count || 0;
  }

  return stats;
}

/**
 * Check 3:1 rule compliance for a contact.
 * For every 1 offer touch, there should be 3 non-offer touches.
 */
export async function check31Rule(contactId: string): Promise<{ compliant: boolean; ratio: string; offerAllowed: boolean }> {
  if (!supabase) return { compliant: true, ratio: 'N/A', offerAllowed: true };

  const { data } = await supabase
    .from('suggested_actions')
    .select('lane')
    .eq('contact_id', contactId)
    .eq('status', 'sent');

  if (!data || data.length === 0) return { compliant: true, ratio: '0:0', offerAllowed: false };

  const offerCount = data.filter((a: Record<string, string>) => a.lane === 'offer').length;
  const nonOfferCount = data.filter((a: Record<string, string>) => a.lane !== 'offer').length;
  const ratio = `${nonOfferCount}:${offerCount}`;
  const compliant = offerCount === 0 || nonOfferCount / offerCount >= 3;

  return { compliant, ratio, offerAllowed: compliant && nonOfferCount >= 3 };
}
