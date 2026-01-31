#!/usr/bin/env npx tsx
/**
 * AI Copilot for DM Reply Suggestions
 * 
 * Generates personalized, relationship-first reply suggestions
 * based on conversation context, relationship score, and pipeline stage.
 * 
 * Usage:
 *   npx tsx scripts/ai-copilot-replies.ts --contact "Sarah Ashley"
 *   npx tsx scripts/ai-copilot-replies.ts --conversation <id>
 *   npx tsx scripts/ai-copilot-replies.ts --batch
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gqjgxltroyysjoxswbmn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || 
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxamd4bHRyb3l5c2pveHN3Ym1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3OTg3OTAsImV4cCI6MjA4MDM3NDc5MH0.H4LfkcbGPrMDM3CCaI5hGE1JWm7OO-jEZOiNPdNzh_s';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// === INTERFACES ===

interface Contact {
  id: string;
  instagram_username: string;
  display_name: string;
  relationship_score: number;
  pipeline_stage: string;
  what_theyre_building: string | null;
  current_friction: string | null;
  fit_signals: string[];
  asks_opinion: boolean;
  shares_updates: boolean;
  last_message_at: string | null;
}

interface Message {
  message_text: string;
  is_outbound: boolean;
  sent_at: string;
}

interface Template {
  id: string;
  lane: string;
  stage: string | null;
  template_text: string;
  description: string;
}

interface ReplySuggestion {
  type: 'friendship' | 'service' | 'offer' | 'retention' | 'rewarm';
  template: string;
  personalized: string;
  reason: string;
  priority: number;
}

// === COPILOT LOGIC ===

function determineLane(contact: Contact): string {
  const score = contact.relationship_score;
  const stage = contact.pipeline_stage;
  
  if (stage === 'post_win_expansion') return 'retention';
  if (stage === 'fit_repeats' || stage === 'permissioned_offer') return 'offer';
  if (score < 40) return 'rewarm';
  if (score >= 40 && score < 70 && contact.what_theyre_building) return 'service';
  return 'friendship';
}

function analyzeLastMessage(messages: Message[]): { sentiment: string; topic: string; needsResponse: boolean } {
  if (!messages || messages.length === 0) {
    return { sentiment: 'neutral', topic: 'general', needsResponse: true };
  }
  
  const lastInbound = [...messages].reverse().find(m => !m.is_outbound);
  if (!lastInbound) {
    return { sentiment: 'neutral', topic: 'general', needsResponse: false };
  }
  
  const text = (lastInbound.message_text || '').toLowerCase();
  
  // Sentiment detection
  let sentiment = 'neutral';
  if (text.match(/thanks|awesome|great|love|amazing|perfect/)) sentiment = 'positive';
  if (text.match(/frustrated|stuck|struggling|hard|difficult|problem/)) sentiment = 'negative';
  if (text.match(/\?/)) sentiment = 'curious';
  
  // Topic detection
  let topic = 'general';
  if (text.match(/content|post|video|reel|story/)) topic = 'content';
  if (text.match(/follow|grow|engagement|reach/)) topic = 'growth';
  if (text.match(/automat|system|tool|app|software/)) topic = 'automation';
  if (text.match(/money|revenue|sales|client|customer/)) topic = 'business';
  if (text.match(/time|busy|overwhelm|schedule/)) topic = 'productivity';
  
  // Check if we were the last to message
  const lastMessage = messages[messages.length - 1];
  const needsResponse = !lastMessage.is_outbound;
  
  return { sentiment, topic, needsResponse };
}

function generatePersonalizedReply(
  template: string, 
  contact: Contact, 
  context: { sentiment: string; topic: string }
): string {
  let reply = template;
  
  // Replace placeholders
  const name = contact.display_name?.split(' ')[0] || contact.instagram_username;
  reply = reply.replace(/___/g, contact.what_theyre_building || 'that project');
  
  // Add name occasionally (30% chance)
  if (Math.random() < 0.3 && !reply.toLowerCase().includes(name.toLowerCase())) {
    reply = `${name.toLowerCase()} — ${reply}`;
  }
  
  // Adjust tone based on sentiment
  if (context.sentiment === 'negative' && !reply.includes('?')) {
    reply = reply.replace(/^/, 'that sounds rough. ');
  }
  
  return reply;
}

async function generateSuggestions(contact: Contact, messages: Message[]): Promise<ReplySuggestion[]> {
  const suggestions: ReplySuggestion[] = [];
  const lane = determineLane(contact);
  const context = analyzeLastMessage(messages);
  
  // Get templates for appropriate lanes
  const lanesToFetch = [lane];
  if (lane === 'service') lanesToFetch.push('friendship');
  if (lane === 'offer') lanesToFetch.push('service');
  
  const { data: templates } = await supabase
    .from('nba_templates')
    .select('*')
    .in('lane', lanesToFetch);
  
  if (!templates) return suggestions;
  
  // Score and select templates
  for (const template of templates as Template[]) {
    let priority = 50;
    
    // Boost priority based on context match
    if (template.lane === lane) priority += 20;
    if (context.needsResponse) priority += 15;
    if (context.sentiment === 'negative' && template.lane === 'service') priority += 10;
    if (context.sentiment === 'curious' && template.template_text.includes('?')) priority += 10;
    
    // Boost based on pipeline stage match
    if (template.stage === contact.pipeline_stage) priority += 15;
    if (!template.stage || template.stage === 'any') priority += 5;
    
    // Personalize the template
    const personalized = generatePersonalizedReply(template.template_text, contact, context);
    
    suggestions.push({
      type: template.lane as ReplySuggestion['type'],
      template: template.template_text,
      personalized,
      reason: `${template.description} (${lane} lane, score: ${contact.relationship_score})`,
      priority,
    });
  }
  
  // Sort by priority and return top 5
  return suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}

// === FIT SIGNAL DETECTION ===

async function detectOfferOpportunity(contact: Contact, messages: Message[]): Promise<string | null> {
  const { data: fitConfigs } = await supabase
    .from('fit_signal_config')
    .select('*');
  
  if (!fitConfigs) return null;
  
  const allText = messages
    .filter(m => !m.is_outbound)
    .map(m => m.message_text || '')
    .join(' ')
    .toLowerCase();
  
  for (const config of fitConfigs) {
    let matchCount = 0;
    for (const keyword of config.signal_keywords) {
      if (allText.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }
    
    // If 2+ signals match, suggest the offer
    if (matchCount >= 2) {
      return `🎯 **${config.product.toUpperCase()} FIT DETECTED**\n   Signals: ${matchCount} matches\n   Offer: "${config.offer_template}"`;
    }
  }
  
  return null;
}

// === MAIN FUNCTIONS ===

async function suggestRepliesForContact(username: string): Promise<void> {
  // Find contact
  const { data: contact, error } = await supabase
    .from('instagram_contacts')
    .select('*')
    .ilike('instagram_username', `%${username}%`)
    .single();
  
  if (error || !contact) {
    console.error(`Contact not found: ${username}`);
    return;
  }
  
  // Get conversation
  const { data: conversation } = await supabase
    .from('instagram_conversations')
    .select('id')
    .eq('contact_id', contact.id)
    .single();
  
  // Get messages
  let messages: Message[] = [];
  if (conversation) {
    const { data: msgs } = await supabase
      .from('instagram_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('sent_at', { ascending: true })
      .limit(20);
    messages = msgs as Message[] || [];
  }
  
  const c = contact as Contact;
  const suggestions = await generateSuggestions(c, messages);
  const offerOpportunity = await detectOfferOpportunity(c, messages);
  const context = analyzeLastMessage(messages);
  
  // Display
  console.log('\n' + '═'.repeat(70));
  console.log(`🤖 AI COPILOT: ${c.display_name || c.instagram_username}`);
  console.log('═'.repeat(70));
  
  console.log(`\n📊 Relationship Score: ${c.relationship_score}/100`);
  console.log(`📍 Stage: ${c.pipeline_stage}`);
  console.log(`🎯 Lane: ${determineLane(c)}`);
  console.log(`💬 Context: ${context.sentiment} sentiment, ${context.topic} topic`);
  console.log(`📥 Needs Response: ${context.needsResponse ? 'Yes' : 'No'}`);
  
  if (c.what_theyre_building) {
    console.log(`\n🔨 Building: ${c.what_theyre_building}`);
  }
  if (c.current_friction) {
    console.log(`⚡ Friction: ${c.current_friction}`);
  }
  
  if (offerOpportunity) {
    console.log('\n' + '─'.repeat(70));
    console.log(offerOpportunity);
  }
  
  console.log('\n' + '─'.repeat(70));
  console.log('💡 SUGGESTED REPLIES (ranked by relevance)');
  console.log('─'.repeat(70));
  
  suggestions.forEach((s, i) => {
    const emoji = { friendship: '🤝', service: '🎁', offer: '💼', retention: '🔄', rewarm: '👋' }[s.type];
    console.log(`\n${i + 1}. [${emoji} ${s.type.toUpperCase()}] ${s.reason}`);
    console.log(`   "${s.personalized}"`);
  });
  
  console.log('\n' + '═'.repeat(70));
  console.log('💡 Copy a reply above or customize based on your conversation.');
  console.log('═'.repeat(70) + '\n');
}

async function batchSuggestions(): Promise<void> {
  console.log('🤖 Generating batch reply suggestions...\n');
  
  // Get contacts that need attention (low scores or recent activity)
  const { data: contacts, error } = await supabase
    .from('instagram_contacts')
    .select('*')
    .or('relationship_score.lt.60,pipeline_stage.in.(first_touch,context_captured)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(10);
  
  if (error || !contacts) {
    console.error('Error:', error?.message);
    return;
  }
  
  console.log('═'.repeat(80));
  console.log('CONTACTS NEEDING ATTENTION');
  console.log('═'.repeat(80));
  
  for (const contact of contacts as Contact[]) {
    const lane = determineLane(contact);
    const name = (contact.display_name || contact.instagram_username).substring(0, 30);
    
    // Get one suggestion
    const { data: templates } = await supabase
      .from('nba_templates')
      .select('*')
      .eq('lane', lane)
      .limit(3);
    
    if (templates && templates.length > 0) {
      const template = templates[Math.floor(Math.random() * templates.length)];
      const personalized = generatePersonalizedReply(
        template.template_text, 
        contact, 
        { sentiment: 'neutral', topic: 'general' }
      );
      
      console.log(`\n${name.padEnd(32)} Score: ${contact.relationship_score}`);
      console.log(`  Stage: ${contact.pipeline_stage} → Lane: ${lane}`);
      console.log(`  → "${personalized.substring(0, 60)}..."`);
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log(`\n✅ ${contacts.length} contacts reviewed\n`);
}

// === CLI ===

async function main() {
  const args = process.argv.slice(2);
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     🤖 AI Copilot - Reply Suggestions                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (args.includes('--contact') || args.includes('-c')) {
    const idx = args.indexOf('--contact') !== -1 ? args.indexOf('--contact') : args.indexOf('-c');
    const username = args[idx + 1];
    if (username) {
      await suggestRepliesForContact(username);
    } else {
      console.error('Please provide a contact name');
    }
  } else if (args.includes('--batch') || args.includes('-b')) {
    await batchSuggestions();
  } else {
    // Default: show help
    console.log(`
Usage:
  npx tsx scripts/ai-copilot-replies.ts --contact "Sarah Ashley"
  npx tsx scripts/ai-copilot-replies.ts --batch

Options:
  --contact, -c <name>   Get reply suggestions for a specific contact
  --batch, -b            Review all contacts needing attention
`);
  }
}

main().catch(console.error);
