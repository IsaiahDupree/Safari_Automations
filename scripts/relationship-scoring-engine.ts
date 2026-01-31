#!/usr/bin/env npx tsx
/**
 * Relationship Scoring Engine
 * 
 * Calculates relationship health scores and suggests next-best-actions
 * Based on the Revio-style relationship-first CRM framework
 * 
 * Usage:
 *   npx tsx scripts/relationship-scoring-engine.ts
 *   npx tsx scripts/relationship-scoring-engine.ts --contact "Sarah Ashley"
 *   npx tsx scripts/relationship-scoring-engine.ts --suggest
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === SCORING WEIGHTS ===
const WEIGHTS = {
  recency: 20,        // Days since meaningful touch
  resonance: 20,      // Reply depth
  needClarity: 15,    // Do we know their goal/pain?
  valueDelivered: 20, // Have we helped lately?
  reliability: 15,    // Did we do what we said?
  consent: 10,        // Do they welcome updates?
};

// === INTERFACES ===

interface Contact {
  id: string;
  instagram_username: string;
  display_name: string;
  last_message_at: string | null;
  last_meaningful_touch: string | null;
  total_messages_sent: number;
  total_messages_received: number;
  what_theyre_building: string | null;
  current_friction: string | null;
  asks_opinion: boolean;
  shares_updates: boolean;
  refers_others: boolean;
  pipeline_stage: string;
  relationship_score: number;
  fit_signals: string[];
}

interface Template {
  id: string;
  lane: string;
  stage: string | null;
  template_text: string;
  description: string;
}

interface FitConfig {
  product: string;
  signal_keywords: string[];
  offer_template: string;
}

// === SCORING FUNCTIONS ===

function calculateRecencyScore(lastTouch: string | null): number {
  if (!lastTouch) return 0;
  
  const daysSince = Math.floor((Date.now() - new Date(lastTouch).getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysSince <= 3) return 100;
  if (daysSince <= 7) return 80;
  if (daysSince <= 14) return 60;
  if (daysSince <= 30) return 40;
  if (daysSince <= 60) return 20;
  return 0;
}

function calculateResonanceScore(contact: Contact): number {
  let score = 50; // Base score
  
  if (contact.total_messages_received > 5) score += 20;
  if (contact.total_messages_received > 10) score += 15;
  if (contact.asks_opinion) score += 15;
  
  return Math.min(score, 100);
}

function calculateNeedClarityScore(contact: Contact): number {
  let score = 0;
  
  if (contact.what_theyre_building) score += 40;
  if (contact.current_friction) score += 40;
  if (contact.fit_signals && contact.fit_signals.length > 0) score += 20;
  
  return Math.min(score, 100);
}

async function calculateValueDeliveredScore(contactId: string): Promise<number> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('value_delivered_log')
    .select('id')
    .eq('contact_id', contactId)
    .gte('delivered_at', thirtyDaysAgo);
  
  if (error || !data) return 0;
  
  const count = data.length;
  if (count >= 3) return 100;
  if (count >= 2) return 70;
  if (count >= 1) return 40;
  return 0;
}

function calculateReliabilityScore(contact: Contact): number {
  // For now, base on pipeline progression
  const stages = [
    'first_touch', 'context_captured', 'micro_win_delivered', 
    'cadence_established', 'trust_signals', 'fit_repeats', 
    'permissioned_offer', 'post_win_expansion'
  ];
  
  const stageIndex = stages.indexOf(contact.pipeline_stage);
  if (stageIndex <= 0) return 30;
  if (stageIndex <= 2) return 50;
  if (stageIndex <= 4) return 70;
  return 90;
}

function calculateConsentScore(contact: Contact): number {
  let score = 30; // Base - they're in our DMs
  
  if (contact.shares_updates) score += 30;
  if (contact.asks_opinion) score += 20;
  if (contact.refers_others) score += 20;
  
  return Math.min(score, 100);
}

async function calculateRelationshipScore(contact: Contact): Promise<number> {
  const recency = calculateRecencyScore(contact.last_meaningful_touch || contact.last_message_at);
  const resonance = calculateResonanceScore(contact);
  const needClarity = calculateNeedClarityScore(contact);
  const valueDelivered = await calculateValueDeliveredScore(contact.id);
  const reliability = calculateReliabilityScore(contact);
  const consent = calculateConsentScore(contact);
  
  const weightedScore = 
    (recency * WEIGHTS.recency / 100) +
    (resonance * WEIGHTS.resonance / 100) +
    (needClarity * WEIGHTS.needClarity / 100) +
    (valueDelivered * WEIGHTS.valueDelivered / 100) +
    (reliability * WEIGHTS.reliability / 100) +
    (consent * WEIGHTS.consent / 100);
  
  return Math.round(weightedScore);
}

// === NEXT-BEST-ACTION LOGIC ===

function determineLane(contact: Contact): string {
  const score = contact.relationship_score;
  const stage = contact.pipeline_stage;
  
  // Post-win expansion = retention
  if (stage === 'post_win_expansion') return 'retention';
  
  // Fit repeats = offer
  if (stage === 'fit_repeats' || stage === 'permissioned_offer') return 'offer';
  
  // Low score = rewarm
  if (score < 40) return 'rewarm';
  
  // Mid score with context = service
  if (score >= 40 && score < 70 && contact.what_theyre_building) return 'service';
  
  // Default = friendship
  return 'friendship';
}

async function suggestNextAction(contact: Contact): Promise<{ template: Template; reason: string } | null> {
  const lane = determineLane(contact);
  
  // Get templates for this lane
  const { data: templates, error } = await supabase
    .from('nba_templates')
    .select('*')
    .eq('lane', lane);
  
  if (error || !templates || templates.length === 0) return null;
  
  // Pick based on stage or random
  const stageTemplates = templates.filter(t => 
    !t.stage || t.stage === 'any' || t.stage === contact.pipeline_stage
  );
  
  // Use stage-matched templates or fall back to all templates for this lane
  const pool = stageTemplates.length > 0 ? stageTemplates : templates;
  if (pool.length === 0) return null;
  
  const template = pool[Math.floor(Math.random() * pool.length)];
  
  const reasons: Record<string, string> = {
    friendship: `Score ${contact.relationship_score} - nurture relationship`,
    service: `Has context (${contact.what_theyre_building?.substring(0, 30)}...) - deliver value`,
    offer: `Fit signals detected - ready for permissioned offer`,
    retention: `Post-win - maintain relationship`,
    rewarm: `Score ${contact.relationship_score} - needs re-engagement`,
  };
  
  return {
    template,
    reason: reasons[lane] || `Lane: ${lane}`,
  };
}

async function detectFitSignals(contact: Contact, messages: string[]): Promise<string[]> {
  const { data: configs } = await supabase
    .from('fit_signal_config')
    .select('*');
  
  if (!configs) return [];
  
  const detectedSignals: string[] = [];
  const allText = messages.join(' ').toLowerCase();
  
  for (const config of configs as FitConfig[]) {
    for (const keyword of config.signal_keywords) {
      if (allText.includes(keyword.toLowerCase())) {
        detectedSignals.push(`${config.product}:${keyword}`);
      }
    }
  }
  
  return [...new Set(detectedSignals)];
}

// === MAIN FUNCTIONS ===

async function scoreAllContacts(): Promise<void> {
  console.log('📊 Calculating relationship scores for all contacts...\n');
  
  const { data: contacts, error } = await supabase
    .from('instagram_contacts')
    .select('*')
    .order('last_message_at', { ascending: false });
  
  if (error || !contacts) {
    console.error('Error fetching contacts:', error?.message);
    return;
  }
  
  const results: Array<{ name: string; oldScore: number; newScore: number; lane: string }> = [];
  
  for (const contact of contacts as Contact[]) {
    const newScore = await calculateRelationshipScore(contact);
    const lane = determineLane({ ...contact, relationship_score: newScore });
    
    // Update score in database
    await supabase
      .from('instagram_contacts')
      .update({ 
        relationship_score: newScore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id);
    
    results.push({
      name: contact.display_name || contact.instagram_username,
      oldScore: contact.relationship_score,
      newScore,
      lane,
    });
  }
  
  // Display results
  console.log('═'.repeat(70));
  console.log('RELATIONSHIP SCORES');
  console.log('═'.repeat(70));
  console.log(`${'Name'.padEnd(35)} ${'Score'.padEnd(8)} ${'Change'.padEnd(10)} Lane`);
  console.log('─'.repeat(70));
  
  results
    .sort((a, b) => b.newScore - a.newScore)
    .forEach(r => {
      const change = r.newScore - r.oldScore;
      const changeStr = change > 0 ? `+${change}` : change.toString();
      console.log(
        `${r.name.substring(0, 34).padEnd(35)} ${r.newScore.toString().padEnd(8)} ${changeStr.padEnd(10)} ${r.lane}`
      );
    });
  
  console.log('═'.repeat(70));
  console.log(`\n✅ Updated ${results.length} contacts\n`);
}

async function scoreContact(username: string): Promise<void> {
  const { data: contact, error } = await supabase
    .from('instagram_contacts')
    .select('*')
    .ilike('instagram_username', `%${username}%`)
    .single();
  
  if (error || !contact) {
    console.error(`Contact not found: ${username}`);
    return;
  }
  
  const c = contact as Contact;
  const newScore = await calculateRelationshipScore(c);
  const suggestion = await suggestNextAction({ ...c, relationship_score: newScore });
  
  console.log('\n' + '═'.repeat(60));
  console.log(`RELATIONSHIP PROFILE: ${c.display_name || c.instagram_username}`);
  console.log('═'.repeat(60));
  console.log(`\n📊 Relationship Score: ${newScore}/100`);
  console.log(`📍 Pipeline Stage: ${c.pipeline_stage}`);
  console.log(`🎯 Recommended Lane: ${determineLane({ ...c, relationship_score: newScore })}`);
  
  if (c.what_theyre_building) {
    console.log(`\n🔨 What they're building: ${c.what_theyre_building}`);
  }
  if (c.current_friction) {
    console.log(`⚡ Current friction: ${c.current_friction}`);
  }
  
  console.log('\n📈 Trust Signals:');
  console.log(`   • Asks opinion: ${c.asks_opinion ? '✓' : '✗'}`);
  console.log(`   • Shares updates: ${c.shares_updates ? '✓' : '✗'}`);
  console.log(`   • Refers others: ${c.refers_others ? '✓' : '✗'}`);
  
  if (suggestion) {
    console.log('\n💡 SUGGESTED NEXT ACTION');
    console.log('─'.repeat(60));
    console.log(`Template [${suggestion.template.id}]: ${suggestion.template.description}`);
    console.log(`\n"${suggestion.template.template_text}"`);
    console.log(`\nReason: ${suggestion.reason}`);
  }
  
  console.log('\n' + '═'.repeat(60) + '\n');
  
  // Update score
  await supabase
    .from('instagram_contacts')
    .update({ relationship_score: newScore })
    .eq('id', c.id);
}

async function generateSuggestions(): Promise<void> {
  console.log('💡 Generating next-best-action suggestions...\n');
  
  const { data: contacts, error } = await supabase
    .from('instagram_contacts')
    .select('*')
    .order('relationship_score', { ascending: false })
    .limit(20);
  
  if (error || !contacts) {
    console.error('Error:', error?.message);
    return;
  }
  
  console.log('═'.repeat(80));
  console.log('SUGGESTED ACTIONS (Top 20 by relationship score)');
  console.log('═'.repeat(80));
  
  for (const contact of contacts as Contact[]) {
    const suggestion = await suggestNextAction(contact);
    if (!suggestion) continue;
    
    const name = (contact.display_name || contact.instagram_username).substring(0, 25);
    
    console.log(`\n${name} (Score: ${contact.relationship_score})`);
    console.log(`  → [${suggestion.template.lane.toUpperCase()}] ${suggestion.template.description}`);
    console.log(`  → "${suggestion.template.template_text.substring(0, 60)}..."`);
    
    // Save suggestion
    await supabase
      .from('suggested_actions')
      .insert({
        contact_id: contact.id,
        template_id: suggestion.template.id,
        reason: suggestion.reason,
        priority: contact.relationship_score,
      });
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('\n✅ Suggestions saved to suggested_actions table\n');
}

// === CLI ===

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🎯 Relationship Scoring Engine                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (args.includes('--contact') || args.includes('-c')) {
    const idx = args.indexOf('--contact') !== -1 ? args.indexOf('--contact') : args.indexOf('-c');
    const username = args[idx + 1];
    if (username) {
      await scoreContact(username);
    } else {
      console.error('Please provide a contact name');
    }
  } else if (args.includes('--suggest') || args.includes('-s')) {
    await scoreAllContacts();
    await generateSuggestions();
  } else {
    await scoreAllContacts();
  }
}

main().catch(console.error);
