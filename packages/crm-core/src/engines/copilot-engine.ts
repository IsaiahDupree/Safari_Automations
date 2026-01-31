/**
 * AI Copilot Engine
 * Generates personalized reply suggestions based on conversation context.
 * Pure functions for testability and portability.
 */

import type {
  Contact,
  Message,
  ActionTemplate,
  ReplySuggestion,
  ConversationContext,
  ActionLane,
  FitSignalConfig,
} from '../models/types.js';
import { determineActionLane } from './scoring-engine.js';

export interface CopilotInput {
  contact: Contact;
  messages: Message[];
  templates: ActionTemplate[];
  fitConfigs?: FitSignalConfig[];
}

/**
 * Generate reply suggestions for a contact based on context.
 */
export function generateReplySuggestions(input: CopilotInput): ReplySuggestion[] {
  const { contact, messages, templates, fitConfigs } = input;
  
  const lane = determineActionLane(contact);
  const context = analyzeConversationContext(messages);
  
  // Get templates for appropriate lanes
  const lanesToUse = getLanePriority(lane);
  const relevantTemplates = templates.filter(t => lanesToUse.includes(t.lane));
  
  const suggestions: ReplySuggestion[] = [];
  
  for (const template of relevantTemplates) {
    const priority = calculateTemplatePriority(template, contact, context, lane);
    const personalized = personalizeTemplate(template.template_text, contact, context);
    
    suggestions.push({
      type: template.lane,
      template: template.template_text,
      personalized,
      reason: `${template.description} (${lane} lane, score: ${contact.relationship_score})`,
      priority,
    });
  }
  
  // Sort by priority and return top suggestions
  return suggestions
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5);
}

/**
 * Analyze conversation context from recent messages.
 */
export function analyzeConversationContext(messages: Message[]): ConversationContext {
  if (!messages || messages.length === 0) {
    return {
      sentiment: 'neutral',
      topic: 'general',
      needsResponse: true,
      lastMessageDaysAgo: 999,
    };
  }
  
  const lastInbound = [...messages].reverse().find(m => !m.is_outbound);
  const lastMessage = messages[messages.length - 1];
  
  // Calculate days since last message
  const lastMessageTime = new Date(lastMessage.sent_at).getTime();
  const daysSince = Math.floor((Date.now() - lastMessageTime) / (1000 * 60 * 60 * 24));
  
  if (!lastInbound) {
    return {
      sentiment: 'neutral',
      topic: 'general',
      needsResponse: false,
      lastMessageDaysAgo: daysSince,
    };
  }
  
  const text = (lastInbound.message_text || '').toLowerCase();
  
  // Sentiment detection
  const sentiment = detectSentiment(text);
  
  // Topic detection
  const topic = detectTopic(text);
  
  // Check if we need to respond
  const needsResponse = !lastMessage.is_outbound;
  
  return { sentiment, topic, needsResponse, lastMessageDaysAgo: daysSince };
}

/**
 * Detect sentiment from message text.
 */
export function detectSentiment(text: string): ConversationContext['sentiment'] {
  if (text.match(/thanks|awesome|great|love|amazing|perfect|excited/)) return 'positive';
  if (text.match(/frustrated|stuck|struggling|hard|difficult|problem|annoyed/)) return 'negative';
  if (text.match(/\?/)) return 'curious';
  return 'neutral';
}

/**
 * Detect topic from message text.
 */
export function detectTopic(text: string): string {
  if (text.match(/content|post|video|reel|story|instagram|tiktok/)) return 'content';
  if (text.match(/follow|grow|engagement|reach|audience/)) return 'growth';
  if (text.match(/automat|system|tool|app|software|workflow/)) return 'automation';
  if (text.match(/money|revenue|sales|client|customer|business/)) return 'business';
  if (text.match(/time|busy|overwhelm|schedule|productivity/)) return 'productivity';
  return 'general';
}

/**
 * Get lane priority order for template selection.
 */
export function getLanePriority(primaryLane: ActionLane): ActionLane[] {
  const priorities: Record<ActionLane, ActionLane[]> = {
    friendship: ['friendship', 'service'],
    service: ['service', 'friendship'],
    offer: ['offer', 'service'],
    retention: ['retention', 'service', 'friendship'],
    rewarm: ['rewarm', 'friendship'],
  };
  return priorities[primaryLane] || [primaryLane];
}

/**
 * Calculate priority score for a template.
 */
export function calculateTemplatePriority(
  template: ActionTemplate,
  contact: Contact,
  context: ConversationContext,
  targetLane: ActionLane
): number {
  let priority = 50;
  
  // Boost for matching lane
  if (template.lane === targetLane) priority += 20;
  
  // Boost if response is needed
  if (context.needsResponse) priority += 15;
  
  // Boost for sentiment match
  if (context.sentiment === 'negative' && template.lane === 'service') priority += 10;
  if (context.sentiment === 'curious' && template.template_text.includes('?')) priority += 10;
  
  // Boost for stage match
  if (template.stage === contact.pipeline_stage) priority += 15;
  if (!template.stage || template.stage === 'any') priority += 5;
  
  // Boost based on template's own priority
  priority += (template.priority || 0) / 10;
  
  return priority;
}

/**
 * Personalize a template with contact context.
 */
export function personalizeTemplate(
  template: string,
  contact: Contact,
  context: ConversationContext
): string {
  let result = template;
  
  // Replace placeholder
  const project = contact.what_theyre_building || 'that project';
  result = result.replace(/___/g, project);
  
  // Add name occasionally (30% chance)
  const name = contact.display_name?.split(' ')[0] || contact.instagram_username;
  if (Math.random() < 0.3 && !result.toLowerCase().includes(name.toLowerCase())) {
    result = `${name.toLowerCase()} — ${result}`;
  }
  
  // Adjust tone for negative sentiment
  if (context.sentiment === 'negative' && !result.includes('?')) {
    result = `that sounds rough. ${result}`;
  }
  
  return result;
}

/**
 * Detect if there's a product fit opportunity.
 */
export function detectFitOpportunity(
  messages: Message[],
  fitConfigs: FitSignalConfig[]
): { product: string; matches: number; offerTemplate: string } | null {
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
    
    if (matchCount >= config.min_matches) {
      return {
        product: config.product,
        matches: matchCount,
        offerTemplate: config.offer_template,
      };
    }
  }
  
  return null;
}

/**
 * Get default action templates.
 */
export function getDefaultTemplates(): ActionTemplate[] {
  return [
    // Friendship templates
    { id: 'f1', lane: 'friendship', template_text: 'yo—how did that thing go from last week?', description: 'Check-in', priority: 80 },
    { id: 'f2', lane: 'friendship', template_text: "ok that's a real win. what do you think made it click?", description: 'Celebrate win', priority: 75 },
    { id: 'f3', lane: 'friendship', template_text: 'random but i remembered you said you were aiming for ___ — still the plan?', description: 'Remembered detail', priority: 70 },
    
    // Service templates
    { id: 's1', lane: 'service', template_text: 'want ideas or just want to vent?', description: 'Permission to help', priority: 85 },
    { id: 's2', lane: 'service', template_text: "if i send you a quick template/checklist for that, would it help?", description: 'Micro-win offer', priority: 80 },
    { id: 's3', lane: 'service', template_text: "send the screenshot/link — i'll tell you the 1 thing i'd fix first", description: 'Fast feedback', priority: 75 },
    { id: 's4', lane: 'service', template_text: 'i know someone doing that well. want an intro?', description: 'Intro offer', priority: 70 },
    
    // Offer templates
    { id: 'o1', lane: 'offer', template_text: "you've mentioned ___ a couple times — feels like that's the bottleneck.", description: 'Soft fit mirror', priority: 85 },
    { id: 'o2', lane: 'offer', template_text: 'want me to show you a simple way i solve that? no pressure.', description: 'Permissioned offer', priority: 90 },
    { id: 'o3', lane: 'offer', template_text: 'do you want a quick suggestion, or do you want me to actually help you implement it?', description: 'Two-path offer', priority: 80 },
    
    // Retention templates
    { id: 'r1', lane: 'retention', template_text: "how's it feeling now that ___ is live? anything still annoying?", description: 'Post-win care', priority: 85 },
    { id: 'r2', lane: 'retention', template_text: "i found a tweak that might boost results — want it?", description: 'Value drop', priority: 80 },
    { id: 'r3', lane: 'retention', template_text: "if you know anyone stuck on ___ i'm happy to help them too.", description: 'Referral ask', priority: 70 },
    
    // Rewarm templates
    { id: 'w1', lane: 'rewarm', template_text: 'no rush to reply — what are you focused on this month?', description: 'Low-friction re-open', priority: 85 },
    { id: 'w2', lane: 'rewarm', template_text: 'saw this and thought of you: [link]. want the 30-sec takeaway?', description: 'Help-first nudge', priority: 80 },
  ];
}
