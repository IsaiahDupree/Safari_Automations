/**
 * Copilot Engine Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateReplySuggestions,
  analyzeConversationContext,
  detectSentiment,
  detectTopic,
  getLanePriority,
  calculateTemplatePriority,
  personalizeTemplate,
  detectFitOpportunity,
  getDefaultTemplates,
} from '../src/engines/copilot-engine.js';
import type { Contact, Message, ActionTemplate, FitSignalConfig } from '../src/models/types.js';

function createMockContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-id',
    instagram_username: 'testuser',
    display_name: 'Test User',
    relationship_score: 50,
    pipeline_stage: 'first_touch',
    asks_opinion: false,
    shares_updates: false,
    has_referred_others: false,
    fit_signals: [],
    total_messages_sent: 0,
    total_messages_received: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function createMockMessage(text: string, isOutbound: boolean, daysAgo: number = 0): Message {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    conversation_id: 'conv-id',
    contact_id: 'contact-id',
    message_text: text,
    message_type: 'text',
    is_outbound: isOutbound,
    sent_by_automation: false,
    sent_at: date.toISOString(),
  };
}

describe('detectSentiment', () => {
  it('detects positive sentiment', () => {
    expect(detectSentiment('thanks so much! this is awesome')).toBe('positive');
    expect(detectSentiment('I love this idea')).toBe('positive');
    expect(detectSentiment('that sounds great!')).toBe('positive');
  });

  it('detects negative sentiment', () => {
    expect(detectSentiment("i'm really frustrated with this")).toBe('negative');
    expect(detectSentiment("i've been stuck on this problem")).toBe('negative');
    expect(detectSentiment('this is so difficult')).toBe('negative');
  });

  it('detects curious sentiment', () => {
    expect(detectSentiment('how does that work?')).toBe('curious');
    expect(detectSentiment('what do you mean?')).toBe('curious');
  });

  it('detects neutral sentiment', () => {
    expect(detectSentiment('okay')).toBe('neutral');
    expect(detectSentiment('sounds good')).toBe('neutral');
  });
});

describe('detectTopic', () => {
  it('detects content topic', () => {
    expect(detectTopic('working on my new video')).toBe('content');
    expect(detectTopic('my instagram posts')).toBe('content');
    expect(detectTopic('creating reels')).toBe('content');
  });

  it('detects growth topic', () => {
    expect(detectTopic('trying to grow my following')).toBe('growth');
    expect(detectTopic('engagement is low')).toBe('growth');
    expect(detectTopic('want more reach')).toBe('growth');
  });

  it('detects automation topic', () => {
    expect(detectTopic('need to automate this')).toBe('automation');
    expect(detectTopic('looking for a tool')).toBe('automation');
    expect(detectTopic('building a system')).toBe('automation');
  });

  it('detects business topic', () => {
    expect(detectTopic('need more clients')).toBe('business');
    expect(detectTopic('revenue is down')).toBe('business');
    expect(detectTopic('customer acquisition')).toBe('business');
  });

  it('detects productivity topic', () => {
    expect(detectTopic("i'm so busy")).toBe('productivity');
    expect(detectTopic('feeling overwhelmed')).toBe('productivity');
    expect(detectTopic('need to manage my time better')).toBe('productivity');
  });

  it('returns general for unknown topics', () => {
    expect(detectTopic('hello there')).toBe('general');
    expect(detectTopic('random stuff')).toBe('general');
  });
});

describe('analyzeConversationContext', () => {
  it('returns default context for empty messages', () => {
    const context = analyzeConversationContext([]);
    expect(context.sentiment).toBe('neutral');
    expect(context.topic).toBe('general');
    expect(context.needsResponse).toBe(true);
    expect(context.lastMessageDaysAgo).toBe(999);
  });

  it('detects needsResponse correctly', () => {
    const inboundLast = [
      createMockMessage('hey', true),
      createMockMessage('hi there!', false),
    ];
    expect(analyzeConversationContext(inboundLast).needsResponse).toBe(true);

    const outboundLast = [
      createMockMessage('hi there!', false),
      createMockMessage('hey', true),
    ];
    expect(analyzeConversationContext(outboundLast).needsResponse).toBe(false);
  });

  it('calculates days since last message', () => {
    const recentMessages = [createMockMessage('hello', true, 0)];
    expect(analyzeConversationContext(recentMessages).lastMessageDaysAgo).toBe(0);

    const oldMessages = [createMockMessage('hello', true, 5)];
    expect(analyzeConversationContext(oldMessages).lastMessageDaysAgo).toBe(5);
  });
});

describe('getLanePriority', () => {
  it('returns correct priority for friendship lane', () => {
    const lanes = getLanePriority('friendship');
    expect(lanes[0]).toBe('friendship');
    expect(lanes).toContain('service');
  });

  it('returns correct priority for service lane', () => {
    const lanes = getLanePriority('service');
    expect(lanes[0]).toBe('service');
    expect(lanes).toContain('friendship');
  });

  it('returns correct priority for offer lane', () => {
    const lanes = getLanePriority('offer');
    expect(lanes[0]).toBe('offer');
    expect(lanes).toContain('service');
  });

  it('returns correct priority for rewarm lane', () => {
    const lanes = getLanePriority('rewarm');
    expect(lanes[0]).toBe('rewarm');
    expect(lanes).toContain('friendship');
  });

  it('returns correct priority for retention lane', () => {
    const lanes = getLanePriority('retention');
    expect(lanes[0]).toBe('retention');
    expect(lanes).toContain('service');
    expect(lanes).toContain('friendship');
  });
});

describe('calculateTemplatePriority', () => {
  const template: ActionTemplate = {
    id: 'test',
    lane: 'service',
    template_text: 'want ideas or just want to vent?',
    description: 'Permission to help',
    priority: 50,
  };

  it('boosts priority for matching lane', () => {
    const contact = createMockContact();
    const context = { sentiment: 'neutral' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const matchingPriority = calculateTemplatePriority(template, contact, context, 'service');
    const nonMatchingPriority = calculateTemplatePriority(template, contact, context, 'offer');
    
    expect(matchingPriority).toBeGreaterThan(nonMatchingPriority);
  });

  it('boosts priority when response is needed', () => {
    const contact = createMockContact();
    const needsResponse = { sentiment: 'neutral' as const, topic: 'general', needsResponse: true, lastMessageDaysAgo: 1 };
    const noResponse = { sentiment: 'neutral' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const withResponsePriority = calculateTemplatePriority(template, contact, needsResponse, 'service');
    const withoutResponsePriority = calculateTemplatePriority(template, contact, noResponse, 'service');
    
    expect(withResponsePriority).toBeGreaterThan(withoutResponsePriority);
  });

  it('boosts priority for negative sentiment + service template', () => {
    const contact = createMockContact();
    const negative = { sentiment: 'negative' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    const neutral = { sentiment: 'neutral' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const negativePriority = calculateTemplatePriority(template, contact, negative, 'service');
    const neutralPriority = calculateTemplatePriority(template, contact, neutral, 'service');
    
    expect(negativePriority).toBeGreaterThan(neutralPriority);
  });
});

describe('personalizeTemplate', () => {
  it('replaces ___ with project name', () => {
    const contact = createMockContact({ what_theyre_building: 'my SaaS app' });
    const context = { sentiment: 'neutral' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const result = personalizeTemplate("how's ___ going?", contact, context);
    expect(result).toContain('my SaaS app');
    expect(result).not.toContain('___');
  });

  it('uses default when no project set', () => {
    const contact = createMockContact();
    const context = { sentiment: 'neutral' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const result = personalizeTemplate("how's ___ going?", contact, context);
    expect(result).toContain('that project');
  });

  it('adds empathy prefix for negative sentiment', () => {
    const contact = createMockContact();
    const context = { sentiment: 'negative' as const, topic: 'general', needsResponse: false, lastMessageDaysAgo: 1 };
    
    const result = personalizeTemplate('let me know how I can help', contact, context);
    expect(result).toContain('that sounds rough');
  });
});

describe('detectFitOpportunity', () => {
  const fitConfigs: FitSignalConfig[] = [
    {
      id: '1',
      product: 'EverReach',
      signal_keywords: ['follow up', 'network', 'relationships', 'forget'],
      min_matches: 2,
      offer_template: 'Want to try EverReach?',
    },
    {
      id: '2',
      product: 'Automation',
      signal_keywords: ['manual', 'time', 'automate', 'system'],
      min_matches: 2,
      offer_template: 'I can help automate that',
    },
  ];

  it('detects fit when signals match', () => {
    const messages = [
      createMockMessage('I keep forgetting to follow up with people', false),
      createMockMessage('my network is a mess', false),
    ];
    
    const result = detectFitOpportunity(messages, fitConfigs);
    expect(result).not.toBeNull();
    expect(result?.product).toBe('EverReach');
    expect(result?.matches).toBeGreaterThanOrEqual(2);
  });

  it('returns null when not enough signals', () => {
    const messages = [
      createMockMessage('hello', false),
      createMockMessage('nice to meet you', false),
    ];
    
    const result = detectFitOpportunity(messages, fitConfigs);
    expect(result).toBeNull();
  });

  it('ignores outbound messages', () => {
    const messages = [
      createMockMessage('I can help you follow up with your network', true),
      createMockMessage('cool', false),
    ];
    
    const result = detectFitOpportunity(messages, fitConfigs);
    expect(result).toBeNull();
  });
});

describe('generateReplySuggestions', () => {
  it('returns array of suggestions', () => {
    const contact = createMockContact({ relationship_score: 50 });
    const messages = [createMockMessage('hello', false)];
    const templates = getDefaultTemplates();
    
    const suggestions = generateReplySuggestions({ contact, messages, templates });
    
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('suggestions have required fields', () => {
    const contact = createMockContact();
    const messages = [createMockMessage('hello', false)];
    const templates = getDefaultTemplates();
    
    const suggestions = generateReplySuggestions({ contact, messages, templates });
    
    for (const suggestion of suggestions) {
      expect(suggestion).toHaveProperty('type');
      expect(suggestion).toHaveProperty('template');
      expect(suggestion).toHaveProperty('personalized');
      expect(suggestion).toHaveProperty('reason');
      expect(suggestion).toHaveProperty('priority');
    }
  });

  it('prioritizes rewarm templates for low score contacts', () => {
    const contact = createMockContact({ relationship_score: 30 });
    const messages = [createMockMessage('hi', false)];
    const templates = getDefaultTemplates();
    
    const suggestions = generateReplySuggestions({ contact, messages, templates });
    
    // First suggestion should be rewarm or friendship
    expect(['rewarm', 'friendship']).toContain(suggestions[0]?.type);
  });

  it('prioritizes offer templates for fit_repeats stage', () => {
    const contact = createMockContact({ 
      relationship_score: 70,
      pipeline_stage: 'fit_repeats',
    });
    const messages = [createMockMessage('interested', false)];
    const templates = getDefaultTemplates();
    
    const suggestions = generateReplySuggestions({ contact, messages, templates });
    
    // Should include offer templates
    const hasOffer = suggestions.some(s => s.type === 'offer');
    expect(hasOffer).toBe(true);
  });
});

describe('getDefaultTemplates', () => {
  it('returns array of templates', () => {
    const templates = getDefaultTemplates();
    expect(Array.isArray(templates)).toBe(true);
    expect(templates.length).toBeGreaterThan(0);
  });

  it('templates have required fields', () => {
    const templates = getDefaultTemplates();
    for (const template of templates) {
      expect(template).toHaveProperty('id');
      expect(template).toHaveProperty('lane');
      expect(template).toHaveProperty('template_text');
      expect(template).toHaveProperty('description');
    }
  });

  it('covers all lanes', () => {
    const templates = getDefaultTemplates();
    const lanes = new Set(templates.map(t => t.lane));
    
    expect(lanes.has('friendship')).toBe(true);
    expect(lanes.has('service')).toBe(true);
    expect(lanes.has('offer')).toBe(true);
    expect(lanes.has('retention')).toBe(true);
    expect(lanes.has('rewarm')).toBe(true);
  });
});
