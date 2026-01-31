#!/usr/bin/env npx tsx
/**
 * DM Coaching Engine
 * 
 * Analyzes Instagram DM conversations and provides coaching feedback
 * Based on relationship-first sales best practices
 * 
 * Usage:
 *   npx tsx scripts/dm-coaching-engine.ts
 *   npx tsx scripts/dm-coaching-engine.ts --contact "Sarah Ashley"
 *   npx tsx scripts/dm-coaching-engine.ts --conversation <id>
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === INTERFACES ===

interface Message {
  id: string;
  message_text: string;
  is_outbound: boolean;
  sent_at: string;
}

interface CoachingRule {
  id: string;
  category: string;
  rule_name: string;
  description: string;
  positive_pattern: string | null;
  negative_pattern: string | null;
  weight: number;
  feedback_if_missing: string | null;
  feedback_if_present: string | null;
}

interface CoachingResult {
  overallScore: number;
  curiosityScore: number;
  valueScore: number;
  permissionScore: number;
  personalizationScore: number;
  pacingScore: number;
  strengths: string[];
  improvements: string[];
  nextActionSuggestion: string;
}

// === COACHING ANALYSIS ===

function analyzeMessages(messages: Message[], rules: CoachingRule[]): CoachingResult {
  const outboundMessages = messages.filter(m => m.is_outbound);
  const inboundMessages = messages.filter(m => !m.is_outbound);
  const outboundText = outboundMessages.map(m => m.message_text || '').join(' ').toLowerCase();
  
  const scores: Record<string, number[]> = {
    curiosity: [],
    value: [],
    permission: [],
    personalization: [],
    pacing: [],
  };
  
  const strengths: string[] = [];
  const improvements: string[] = [];
  
  // Apply each rule
  for (const rule of rules) {
    let ruleScore = 50; // Base score
    let matched = false;
    
    // Check positive pattern
    if (rule.positive_pattern) {
      const regex = new RegExp(rule.positive_pattern, 'i');
      if (regex.test(outboundText)) {
        ruleScore = 100;
        matched = true;
        if (rule.feedback_if_present) {
          strengths.push(rule.feedback_if_present);
        }
      } else {
        ruleScore = 30;
        if (rule.feedback_if_missing) {
          improvements.push(rule.feedback_if_missing);
        }
      }
    }
    
    // Check negative pattern
    if (rule.negative_pattern && !matched) {
      const regex = new RegExp(rule.negative_pattern, 'i');
      if (regex.test(outboundText)) {
        ruleScore = 20;
        if (rule.feedback_if_present) {
          improvements.push(rule.feedback_if_present);
        }
      } else {
        ruleScore = 80;
      }
    }
    
    // Add to category scores
    if (scores[rule.category]) {
      scores[rule.category].push(ruleScore);
    }
  }
  
  // Calculate category averages
  const avgScore = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 50;
  
  const curiosityScore = avgScore(scores.curiosity);
  const valueScore = avgScore(scores.value);
  const permissionScore = avgScore(scores.permission);
  const personalizationScore = avgScore(scores.personalization);
  const pacingScore = avgScore(scores.pacing);
  
  // Overall score (weighted)
  const overallScore = Math.round(
    (curiosityScore * 0.2) +
    (valueScore * 0.25) +
    (permissionScore * 0.25) +
    (personalizationScore * 0.15) +
    (pacingScore * 0.15)
  );
  
  // Pacing analysis
  if (outboundMessages.length > 0) {
    const avgLength = outboundText.length / outboundMessages.length;
    if (avgLength > 500) {
      improvements.push('Messages are quite long - try to be more concise');
    } else if (avgLength < 20) {
      improvements.push('Messages are very short - add more context when helpful');
    } else {
      strengths.push('Good message length');
    }
  }
  
  // Response ratio
  if (outboundMessages.length > 0 && inboundMessages.length > 0) {
    const ratio = outboundMessages.length / inboundMessages.length;
    if (ratio > 3) {
      improvements.push('You\'re sending many more messages than receiving - wait for responses');
    } else if (ratio < 0.5) {
      strengths.push('Good listening - you let them talk');
    }
  }
  
  // Question analysis
  const questionCount = (outboundText.match(/\?/g) || []).length;
  if (questionCount === 0 && outboundMessages.length > 2) {
    improvements.push('Ask questions to learn about their situation');
  } else if (questionCount > outboundMessages.length * 2) {
    improvements.push('Too many questions can feel like an interrogation');
  }
  
  // Generate next action suggestion
  let nextActionSuggestion = '';
  if (overallScore < 40) {
    nextActionSuggestion = 'Focus on asking open-ended questions and providing value before any offers';
  } else if (overallScore < 60) {
    nextActionSuggestion = 'Good start! Try to personalize more and always ask permission before offering';
  } else if (overallScore < 80) {
    nextActionSuggestion = 'Solid conversation! Consider sharing a helpful resource to add more value';
  } else {
    nextActionSuggestion = 'Excellent conversation! Keep nurturing this relationship';
  }
  
  return {
    overallScore,
    curiosityScore,
    valueScore,
    permissionScore,
    personalizationScore,
    pacingScore,
    strengths: [...new Set(strengths)].slice(0, 5),
    improvements: [...new Set(improvements)].slice(0, 5),
    nextActionSuggestion,
  };
}

// === MAIN FUNCTIONS ===

async function analyzeConversation(conversationId: string): Promise<void> {
  // Get conversation details
  const { data: conversation, error: convError } = await supabase
    .from('instagram_conversations')
    .select('*, contact:instagram_contacts(*)')
    .eq('id', conversationId)
    .single();
  
  if (convError || !conversation) {
    console.error('Conversation not found');
    return;
  }
  
  // Get messages
  const { data: messages, error: msgError } = await supabase
    .from('instagram_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });
  
  if (msgError) {
    console.error('Error fetching messages:', msgError.message);
    return;
  }
  
  // Get coaching rules
  const { data: rules } = await supabase
    .from('coaching_rules')
    .select('*');
  
  if (!rules || rules.length === 0) {
    console.error('No coaching rules found');
    return;
  }
  
  // Analyze
  const result = analyzeMessages(messages as Message[], rules as CoachingRule[]);
  
  // Display results
  const contact = conversation.contact;
  console.log('\n' + '═'.repeat(70));
  console.log(`CONVERSATION COACHING: ${contact?.display_name || contact?.instagram_username || 'Unknown'}`);
  console.log('═'.repeat(70));
  
  console.log(`\n📊 OVERALL SCORE: ${result.overallScore}/100 ${getScoreEmoji(result.overallScore)}`);
  
  console.log('\n📈 Component Scores:');
  console.log(`   Curiosity:       ${result.curiosityScore}/100 ${getBar(result.curiosityScore)}`);
  console.log(`   Value:           ${result.valueScore}/100 ${getBar(result.valueScore)}`);
  console.log(`   Permission:      ${result.permissionScore}/100 ${getBar(result.permissionScore)}`);
  console.log(`   Personalization: ${result.personalizationScore}/100 ${getBar(result.personalizationScore)}`);
  console.log(`   Pacing:          ${result.pacingScore}/100 ${getBar(result.pacingScore)}`);
  
  if (result.strengths.length > 0) {
    console.log('\n✅ Strengths:');
    result.strengths.forEach(s => console.log(`   • ${s}`));
  }
  
  if (result.improvements.length > 0) {
    console.log('\n🔧 Areas to Improve:');
    result.improvements.forEach(i => console.log(`   • ${i}`));
  }
  
  console.log(`\n💡 Next Action: ${result.nextActionSuggestion}`);
  console.log('\n' + '═'.repeat(70) + '\n');
  
  // Save coaching result
  await supabase
    .from('conversation_coaching')
    .upsert({
      conversation_id: conversationId,
      contact_id: contact?.id,
      overall_score: result.overallScore,
      curiosity_score: result.curiosityScore,
      value_score: result.valueScore,
      permission_score: result.permissionScore,
      personalization_score: result.personalizationScore,
      pacing_score: result.pacingScore,
      strengths: result.strengths,
      improvements: result.improvements,
      next_action_suggestion: result.nextActionSuggestion,
      messages_analyzed: messages?.length || 0,
      analyzed_at: new Date().toISOString(),
    }, {
      onConflict: 'conversation_id',
    });
}

async function analyzeByContact(username: string): Promise<void> {
  // Find contact
  const { data: contact, error } = await supabase
    .from('instagram_contacts')
    .select('id, instagram_username, display_name')
    .ilike('instagram_username', `%${username}%`)
    .single();
  
  if (error || !contact) {
    console.error(`Contact not found: ${username}`);
    return;
  }
  
  // Get their conversations
  const { data: conversations } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contact.id);
  
  if (!conversations || conversations.length === 0) {
    console.log(`No conversations found for ${contact.display_name || contact.instagram_username}`);
    return;
  }
  
  // Analyze each conversation
  for (const conv of conversations) {
    await analyzeConversation(conv.id);
  }
}

async function analyzeAllConversations(): Promise<void> {
  console.log('🎯 Analyzing all conversations...\n');
  
  const { data: conversations, error } = await supabase
    .from('instagram_conversations')
    .select('id, contact:instagram_contacts(display_name, instagram_username)')
    .order('updated_at', { ascending: false })
    .limit(20);
  
  if (error || !conversations) {
    console.error('Error:', error?.message);
    return;
  }
  
  // Get rules once
  const { data: rules } = await supabase
    .from('coaching_rules')
    .select('*');
  
  if (!rules) return;
  
  const results: Array<{ name: string; score: number; suggestion: string }> = [];
  
  for (const conv of conversations) {
    const { data: messages } = await supabase
      .from('instagram_messages')
      .select('*')
      .eq('conversation_id', conv.id);
    
    if (!messages || messages.length === 0) continue;
    
    const result = analyzeMessages(messages as Message[], rules as CoachingRule[]);
    const contact = conv.contact as any;
    
    results.push({
      name: contact?.display_name || contact?.instagram_username || 'Unknown',
      score: result.overallScore,
      suggestion: result.nextActionSuggestion,
    });
    
    // Save to DB
    await supabase
      .from('conversation_coaching')
      .upsert({
        conversation_id: conv.id,
        contact_id: contact?.id,
        overall_score: result.overallScore,
        curiosity_score: result.curiosityScore,
        value_score: result.valueScore,
        permission_score: result.permissionScore,
        personalization_score: result.personalizationScore,
        pacing_score: result.pacingScore,
        strengths: result.strengths,
        improvements: result.improvements,
        next_action_suggestion: result.nextActionSuggestion,
        messages_analyzed: messages.length,
      }, {
        onConflict: 'conversation_id',
      });
  }
  
  // Display summary
  console.log('═'.repeat(80));
  console.log('CONVERSATION COACHING SUMMARY');
  console.log('═'.repeat(80));
  console.log(`${'Contact'.padEnd(35)} ${'Score'.padEnd(10)} Next Action`);
  console.log('─'.repeat(80));
  
  results
    .sort((a, b) => b.score - a.score)
    .forEach(r => {
      console.log(
        `${r.name.substring(0, 34).padEnd(35)} ${(r.score + '/100').padEnd(10)} ${r.suggestion.substring(0, 35)}...`
      );
    });
  
  console.log('═'.repeat(80));
  
  // Stats
  const avgScore = Math.round(results.reduce((a, b) => a + b.score, 0) / results.length);
  console.log(`\n📊 Average Score: ${avgScore}/100`);
  console.log(`✅ Analyzed: ${results.length} conversations\n`);
}

// === HELPERS ===

function getScoreEmoji(score: number): string {
  if (score >= 80) return '🌟';
  if (score >= 60) return '👍';
  if (score >= 40) return '📈';
  return '🔧';
}

function getBar(score: number): string {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// === CLI ===

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🎯 DM Coaching Engine                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (args.includes('--contact') || args.includes('-c')) {
    const idx = args.indexOf('--contact') !== -1 ? args.indexOf('--contact') : args.indexOf('-c');
    const username = args[idx + 1];
    if (username) {
      await analyzeByContact(username);
    } else {
      console.error('Please provide a contact name');
    }
  } else if (args.includes('--conversation') || args.includes('-v')) {
    const idx = args.indexOf('--conversation') !== -1 ? args.indexOf('--conversation') : args.indexOf('-v');
    const convId = args[idx + 1];
    if (convId) {
      await analyzeConversation(convId);
    } else {
      console.error('Please provide a conversation ID');
    }
  } else {
    await analyzeAllConversations();
  }
}

main().catch(console.error);
