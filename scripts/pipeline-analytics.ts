#!/usr/bin/env npx tsx
/**
 * Pipeline Analytics Dashboard
 * 
 * Shows real-time metrics for your relationship pipeline:
 * - Stage distribution
 * - Score trends
 * - Activity metrics
 * - Contacts needing attention
 * 
 * Usage:
 *   npx tsx scripts/pipeline-analytics.ts
 *   npx tsx scripts/pipeline-analytics.ts --detailed
 *   npx tsx scripts/pipeline-analytics.ts --snapshot
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === ANALYTICS FUNCTIONS ===

async function getPipelineOverview(): Promise<void> {
  const { data: contacts } = await supabase
    .from('instagram_contacts')
    .select('pipeline_stage, relationship_score, last_message_at');
  
  if (!contacts) return;
  
  // Calculate stage distribution
  const stages: Record<string, { count: number; avgScore: number; scores: number[] }> = {};
  const stageOrder = [
    'first_touch', 'context_captured', 'micro_win_delivered', 
    'cadence_established', 'trust_signals', 'fit_repeats', 
    'permissioned_offer', 'post_win_expansion'
  ];
  
  for (const stage of stageOrder) {
    stages[stage] = { count: 0, avgScore: 0, scores: [] };
  }
  
  for (const contact of contacts) {
    const stage = contact.pipeline_stage || 'first_touch';
    if (stages[stage]) {
      stages[stage].count++;
      stages[stage].scores.push(contact.relationship_score || 0);
    }
  }
  
  // Calculate averages
  for (const stage of stageOrder) {
    if (stages[stage].scores.length > 0) {
      stages[stage].avgScore = Math.round(
        stages[stage].scores.reduce((a, b) => a + b, 0) / stages[stage].scores.length
      );
    }
  }
  
  // Display
  console.log('\n' + '═'.repeat(70));
  console.log('PIPELINE OVERVIEW');
  console.log('═'.repeat(70));
  
  const stageLabels: Record<string, string> = {
    first_touch: '1. First Touch',
    context_captured: '2. Context Captured',
    micro_win_delivered: '3. Micro-Win Delivered',
    cadence_established: '4. Cadence Established',
    trust_signals: '5. Trust Signals',
    fit_repeats: '6. Fit Repeats',
    permissioned_offer: '7. Permissioned Offer',
    post_win_expansion: '8. Post-Win Expansion',
  };
  
  console.log(`\n${'Stage'.padEnd(28)} ${'Count'.padEnd(8)} ${'Avg Score'.padEnd(12)} Visual`);
  console.log('─'.repeat(70));
  
  for (const stage of stageOrder) {
    const data = stages[stage];
    const bar = '█'.repeat(Math.min(data.count, 20)) + '░'.repeat(Math.max(0, 20 - data.count));
    console.log(
      `${stageLabels[stage].padEnd(28)} ${data.count.toString().padEnd(8)} ${(data.avgScore + '/100').padEnd(12)} ${bar}`
    );
  }
  
  // Summary stats
  const totalContacts = contacts.length;
  const avgScore = Math.round(contacts.reduce((a, c) => a + (c.relationship_score || 0), 0) / totalContacts);
  const highScorers = contacts.filter(c => (c.relationship_score || 0) >= 80).length;
  const lowScorers = contacts.filter(c => (c.relationship_score || 0) < 40).length;
  
  console.log('\n' + '─'.repeat(70));
  console.log(`Total Contacts: ${totalContacts} | Avg Score: ${avgScore}/100`);
  console.log(`High Scorers (80+): ${highScorers} | Low Scorers (<40): ${lowScorers}`);
}

async function getScoreDistribution(): Promise<void> {
  const { data: contacts } = await supabase
    .from('instagram_contacts')
    .select('relationship_score');
  
  if (!contacts) return;
  
  const buckets = [
    { label: '90-100 🌟', min: 90, max: 100, count: 0 },
    { label: '80-89  ⭐', min: 80, max: 89, count: 0 },
    { label: '70-79  👍', min: 70, max: 79, count: 0 },
    { label: '60-69  📈', min: 60, max: 69, count: 0 },
    { label: '50-59  📊', min: 50, max: 59, count: 0 },
    { label: '40-49  ⚠️', min: 40, max: 49, count: 0 },
    { label: '30-39  🔧', min: 30, max: 39, count: 0 },
    { label: '0-29   ❄️', min: 0, max: 29, count: 0 },
  ];
  
  for (const contact of contacts) {
    const score = contact.relationship_score || 0;
    for (const bucket of buckets) {
      if (score >= bucket.min && score <= bucket.max) {
        bucket.count++;
        break;
      }
    }
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('SCORE DISTRIBUTION');
  console.log('═'.repeat(50));
  
  const maxCount = Math.max(...buckets.map(b => b.count));
  
  for (const bucket of buckets) {
    const barLength = maxCount > 0 ? Math.round((bucket.count / maxCount) * 20) : 0;
    const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
    console.log(`${bucket.label.padEnd(12)} ${bar} ${bucket.count}`);
  }
}

async function getContactsNeedingAttention(): Promise<void> {
  const { data: contacts } = await supabase
    .from('instagram_contacts')
    .select('*')
    .or('relationship_score.lt.60,pipeline_stage.eq.first_touch,pipeline_stage.eq.fit_repeats')
    .order('relationship_score', { ascending: true })
    .limit(15);
  
  if (!contacts) return;
  
  console.log('\n' + '═'.repeat(80));
  console.log('CONTACTS NEEDING ATTENTION');
  console.log('═'.repeat(80));
  
  console.log(`\n${'Name'.padEnd(30)} ${'Score'.padEnd(8)} ${'Stage'.padEnd(20)} Action`);
  console.log('─'.repeat(80));
  
  for (const contact of contacts) {
    const name = (contact.display_name || contact.instagram_username).substring(0, 29);
    const score = contact.relationship_score || 0;
    const stage = contact.pipeline_stage || 'first_touch';
    
    let action = '';
    if (score < 40) action = '👋 Re-warm';
    else if (stage === 'first_touch') action = '📝 Capture context';
    else if (stage === 'fit_repeats') action = '💼 Make offer';
    else action = '🎁 Deliver value';
    
    console.log(`${name.padEnd(30)} ${score.toString().padEnd(8)} ${stage.padEnd(20)} ${action}`);
  }
}

async function getActivityMetrics(): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  // Messages this week
  const { count: messagesSent } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true })
    .eq('is_outbound', true)
    .gte('sent_at', weekAgo.toISOString());
  
  const { count: automationMessages } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true })
    .eq('is_outbound', true)
    .eq('sent_by_automation', true)
    .gte('sent_at', weekAgo.toISOString());
  
  // Value delivered this week
  const { count: valueDelivered } = await supabase
    .from('value_delivered_log')
    .select('*', { count: 'exact', head: true })
    .gte('delivered_at', weekAgo.toISOString());
  
  // Pending actions
  const { count: pendingActions } = await supabase
    .from('suggested_actions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  
  console.log('\n' + '═'.repeat(50));
  console.log('ACTIVITY METRICS (Last 7 Days)');
  console.log('═'.repeat(50));
  
  console.log(`\n📤 Messages Sent:      ${messagesSent || 0}`);
  console.log(`🤖 Via Automation:     ${automationMessages || 0}`);
  console.log(`🎁 Value Delivered:    ${valueDelivered || 0}`);
  console.log(`📋 Pending Actions:    ${pendingActions || 0}`);
}

async function saveDailySnapshot(): Promise<void> {
  const { data: contacts } = await supabase
    .from('instagram_contacts')
    .select('pipeline_stage, relationship_score');
  
  if (!contacts) return;
  
  // Calculate stats
  const stageCount: Record<string, number> = {};
  let totalScore = 0;
  let highCount = 0, midCount = 0, lowCount = 0;
  
  for (const contact of contacts) {
    const stage = contact.pipeline_stage || 'first_touch';
    stageCount[stage] = (stageCount[stage] || 0) + 1;
    
    const score = contact.relationship_score || 0;
    totalScore += score;
    
    if (score >= 80) highCount++;
    else if (score >= 40) midCount++;
    else lowCount++;
  }
  
  const avgScore = contacts.length > 0 ? totalScore / contacts.length : 0;
  
  // Get message counts
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { count: messagesSent } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true })
    .eq('is_outbound', true)
    .gte('sent_at', today.toISOString());
  
  const { count: automationMessages } = await supabase
    .from('instagram_messages')
    .select('*', { count: 'exact', head: true })
    .eq('sent_by_automation', true)
    .gte('sent_at', today.toISOString());
  
  // Save snapshot
  const { error } = await supabase
    .from('pipeline_daily_stats')
    .upsert({
      stat_date: today.toISOString().split('T')[0],
      total_contacts: contacts.length,
      contacts_by_stage: stageCount,
      avg_relationship_score: avgScore,
      high_score_count: highCount,
      mid_score_count: midCount,
      low_score_count: lowCount,
      messages_sent: messagesSent || 0,
      automation_messages: automationMessages || 0,
    }, {
      onConflict: 'stat_date',
    });
  
  if (error) {
    console.error('Error saving snapshot:', error.message);
  } else {
    console.log('\n✅ Daily snapshot saved');
  }
}

// === CLI ===

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     📊 Pipeline Analytics Dashboard                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
  
  await getPipelineOverview();
  
  if (args.includes('--detailed') || args.includes('-d')) {
    await getScoreDistribution();
    await getActivityMetrics();
  }
  
  await getContactsNeedingAttention();
  
  if (args.includes('--snapshot') || args.includes('-s')) {
    await saveDailySnapshot();
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log('Commands:');
  console.log('  --detailed, -d    Show score distribution & activity');
  console.log('  --snapshot, -s    Save daily stats snapshot');
  console.log('═'.repeat(50) + '\n');
}

main().catch(console.error);
