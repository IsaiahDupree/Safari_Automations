/**
 * Scoring Engine Tests
 */

import { describe, it, expect } from 'vitest';
import {
  calculateRelationshipScore,
  calculateRecencyScore,
  calculateResonanceScore,
  calculateNeedClarityScore,
  calculateValueDeliveredScore,
  calculateReliabilityScore,
  calculateConsentScore,
  determineActionLane,
  getScoreTier,
} from '../src/engines/scoring-engine.js';
import type { Contact, Message } from '../src/models/types.js';

// Mock contact factory
function createMockContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'test-id',
    instagram_username: 'testuser',
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

// Mock message factory
function createMockMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-id',
    conversation_id: 'conv-id',
    contact_id: 'contact-id',
    message_text: 'Hello!',
    message_type: 'text',
    is_outbound: false,
    sent_by_automation: false,
    sent_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('calculateRecencyScore', () => {
  it('returns 100 for messages within 3 days', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(recent)).toBe(100);
  });

  it('returns 85 for messages within 7 days', () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(recent)).toBe(85);
  });

  it('returns 70 for messages within 14 days', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(recent)).toBe(70);
  });

  it('returns 50 for messages within 30 days', () => {
    const recent = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(recent)).toBe(50);
  });

  it('returns 30 for messages within 60 days', () => {
    const recent = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(recent)).toBe(30);
  });

  it('returns 10 for messages older than 60 days', () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(calculateRecencyScore(old)).toBe(10);
  });

  it('returns 20 for no message date', () => {
    expect(calculateRecencyScore(undefined)).toBe(20);
  });
});

describe('calculateResonanceScore', () => {
  it('returns 30 for empty messages', () => {
    expect(calculateResonanceScore([])).toBe(30);
  });

  it('returns 20 for only outbound messages', () => {
    const messages = [createMockMessage({ is_outbound: true })];
    expect(calculateResonanceScore(messages)).toBe(20);
  });

  it('returns higher score for longer messages', () => {
    const shortMsg = createMockMessage({ message_text: 'ok' });
    const longMsg = createMockMessage({ 
      message_text: 'I really appreciate you reaching out! This is exactly what I was looking for and I have so many questions about how this works.'
    });
    
    const shortScore = calculateResonanceScore([shortMsg]);
    const longScore = calculateResonanceScore([longMsg]);
    
    expect(longScore).toBeGreaterThan(shortScore);
  });

  it('returns higher score for messages with questions', () => {
    const noQuestion = createMockMessage({ message_text: 'That sounds great' });
    const withQuestion = createMockMessage({ message_text: 'That sounds great, how does it work?' });
    
    const noQScore = calculateResonanceScore([noQuestion]);
    const withQScore = calculateResonanceScore([withQuestion]);
    
    expect(withQScore).toBeGreaterThan(noQScore);
  });

  it('returns higher score for personal messages', () => {
    const impersonal = createMockMessage({ message_text: 'ok cool' });
    const personal = createMockMessage({ message_text: "I'm working on my new project and we are excited" });
    
    const impScore = calculateResonanceScore([impersonal]);
    const perScore = calculateResonanceScore([personal]);
    
    expect(perScore).toBeGreaterThan(impScore);
  });
});

describe('calculateNeedClarityScore', () => {
  it('returns base score for empty contact', () => {
    const contact = createMockContact();
    expect(calculateNeedClarityScore(contact)).toBe(20);
  });

  it('increases score when what_theyre_building is set', () => {
    const contact = createMockContact({ what_theyre_building: 'A SaaS app' });
    expect(calculateNeedClarityScore(contact)).toBe(50);
  });

  it('increases score when current_friction is set', () => {
    const contact = createMockContact({ current_friction: 'Lead generation' });
    expect(calculateNeedClarityScore(contact)).toBe(45);
  });

  it('increases score for full profile', () => {
    const contact = createMockContact({
      what_theyre_building: 'A SaaS app',
      current_friction: 'Lead generation',
      their_definition_of_win: '100 customers',
      fit_signals: ['needs_automation'],
    });
    expect(calculateNeedClarityScore(contact)).toBe(100);
  });
});

describe('calculateValueDeliveredScore', () => {
  it('returns 20 for 0 value delivered', () => {
    expect(calculateValueDeliveredScore(0)).toBe(20);
  });

  it('returns 50 for 1 value delivered', () => {
    expect(calculateValueDeliveredScore(1)).toBe(50);
  });

  it('returns 70 for 2 value delivered', () => {
    expect(calculateValueDeliveredScore(2)).toBe(70);
  });

  it('returns 90 for 3+ value delivered', () => {
    expect(calculateValueDeliveredScore(3)).toBe(90);
    expect(calculateValueDeliveredScore(5)).toBe(90);
  });
});

describe('calculateReliabilityScore', () => {
  it('returns 50 for no promises made', () => {
    expect(calculateReliabilityScore(0, 0)).toBe(50);
  });

  it('returns 100 for all promises kept', () => {
    expect(calculateReliabilityScore(5, 5)).toBe(100);
  });

  it('returns 50 for half promises kept', () => {
    expect(calculateReliabilityScore(2, 4)).toBe(50);
  });

  it('returns 0 for no promises kept', () => {
    expect(calculateReliabilityScore(0, 3)).toBe(0);
  });
});

describe('calculateConsentScore', () => {
  it('returns base score for no trust signals', () => {
    const contact = createMockContact();
    expect(calculateConsentScore(contact)).toBe(30);
  });

  it('increases score for asks_opinion', () => {
    const contact = createMockContact({ asks_opinion: true });
    expect(calculateConsentScore(contact)).toBe(55);
  });

  it('increases score for shares_updates', () => {
    const contact = createMockContact({ shares_updates: true });
    expect(calculateConsentScore(contact)).toBe(55);
  });

  it('increases score for has_referred_others', () => {
    const contact = createMockContact({ has_referred_others: true });
    expect(calculateConsentScore(contact)).toBe(50);
  });

  it('caps at 100 for all trust signals', () => {
    const contact = createMockContact({
      asks_opinion: true,
      shares_updates: true,
      has_referred_others: true,
    });
    expect(calculateConsentScore(contact)).toBe(100);
  });
});

describe('calculateRelationshipScore', () => {
  it('returns overall score with component scores', () => {
    const contact = createMockContact({
      last_message_at: new Date().toISOString(),
      what_theyre_building: 'An app',
      asks_opinion: true,
    });
    
    const result = calculateRelationshipScore({ contact });
    
    expect(result).toHaveProperty('overall');
    expect(result).toHaveProperty('recency');
    expect(result).toHaveProperty('resonance');
    expect(result).toHaveProperty('needClarity');
    expect(result).toHaveProperty('valueDelivered');
    expect(result).toHaveProperty('reliability');
    expect(result).toHaveProperty('consent');
    
    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.overall).toBeLessThanOrEqual(100);
  });

  it('respects custom weights', () => {
    const contact = createMockContact({
      last_message_at: new Date().toISOString(), // High recency
    });
    
    // All weight on recency
    const heavyRecency = calculateRelationshipScore(
      { contact },
      { recency: 1.0, resonance: 0, needClarity: 0, valueDelivered: 0, reliability: 0, consent: 0 }
    );
    
    // All weight on consent (low)
    const heavyConsent = calculateRelationshipScore(
      { contact },
      { recency: 0, resonance: 0, needClarity: 0, valueDelivered: 0, reliability: 0, consent: 1.0 }
    );
    
    expect(heavyRecency.overall).toBeGreaterThan(heavyConsent.overall);
  });
});

describe('determineActionLane', () => {
  it('returns rewarm for low scores', () => {
    const contact = createMockContact({ relationship_score: 30 });
    expect(determineActionLane(contact)).toBe('rewarm');
  });

  it('returns retention for post_win_expansion stage', () => {
    const contact = createMockContact({ 
      relationship_score: 80,
      pipeline_stage: 'post_win_expansion',
    });
    expect(determineActionLane(contact)).toBe('retention');
  });

  it('returns offer for fit_repeats stage', () => {
    const contact = createMockContact({ 
      relationship_score: 70,
      pipeline_stage: 'fit_repeats',
    });
    expect(determineActionLane(contact)).toBe('offer');
  });

  it('returns service for mid-score with context', () => {
    const contact = createMockContact({ 
      relationship_score: 55,
      what_theyre_building: 'A project',
    });
    expect(determineActionLane(contact)).toBe('service');
  });

  it('returns friendship for high scores without special conditions', () => {
    const contact = createMockContact({ relationship_score: 75 });
    expect(determineActionLane(contact)).toBe('friendship');
  });
});

describe('getScoreTier', () => {
  it('returns correct tier for each score range', () => {
    expect(getScoreTier(95).label).toBe('Excellent');
    expect(getScoreTier(85).label).toBe('Great');
    expect(getScoreTier(75).label).toBe('Good');
    expect(getScoreTier(65).label).toBe('Growing');
    expect(getScoreTier(55).label).toBe('Building');
    expect(getScoreTier(45).label).toBe('Needs Work');
    expect(getScoreTier(35).label).toBe('At Risk');
    expect(getScoreTier(20).label).toBe('Cold');
  });

  it('includes emoji and color', () => {
    const tier = getScoreTier(90);
    expect(tier.emoji).toBe('🌟');
    expect(tier.color).toBe('green');
  });
});
