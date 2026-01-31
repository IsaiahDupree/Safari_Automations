/**
 * Coaching Engine Tests
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeConversation,
  applyRule,
  averageScore,
  analyzePacing,
  analyzeResponseRatio,
  analyzeQuestions,
  generateNextActionSuggestion,
  getDefaultCoachingRules,
} from '../src/engines/coaching-engine.js';
import type { Message, CoachingRule } from '../src/models/types.js';

function createMockMessage(text: string, isOutbound: boolean): Message {
  return {
    id: `msg-${Date.now()}`,
    conversation_id: 'conv-id',
    contact_id: 'contact-id',
    message_text: text,
    message_type: 'text',
    is_outbound: isOutbound,
    sent_by_automation: false,
    sent_at: new Date().toISOString(),
  };
}

describe('applyRule', () => {
  it('matches positive pattern and returns high score', () => {
    const rule: CoachingRule = {
      id: 'test',
      category: 'curiosity',
      name: 'Test',
      positive_pattern: 'what.*\\?',
      weight: 1.0,
      feedback_if_present: 'Good question!',
      feedback_if_missing: 'Ask questions',
    };
    
    const result = applyRule(rule, 'what do you think?');
    expect(result.score).toBe(100);
    expect(result.isStrength).toBe(true);
    expect(result.feedback).toBe('Good question!');
  });

  it('returns low score when positive pattern not matched', () => {
    const rule: CoachingRule = {
      id: 'test',
      category: 'curiosity',
      name: 'Test',
      positive_pattern: 'what.*\\?',
      weight: 1.0,
      feedback_if_missing: 'Ask questions',
    };
    
    const result = applyRule(rule, 'okay sounds good');
    expect(result.score).toBe(30);
    expect(result.isStrength).toBe(false);
    expect(result.feedback).toBe('Ask questions');
  });

  it('matches negative pattern and returns low score', () => {
    const rule: CoachingRule = {
      id: 'test',
      category: 'permission',
      name: 'Test',
      negative_pattern: 'you should|you need to',
      weight: 1.0,
      feedback_if_present: 'Avoid pushy language',
    };
    
    const result = applyRule(rule, 'you should definitely try this');
    expect(result.score).toBe(20);
    expect(result.feedback).toBe('Avoid pushy language');
  });

  it('returns high score when negative pattern not matched', () => {
    const rule: CoachingRule = {
      id: 'test',
      category: 'permission',
      name: 'Test',
      negative_pattern: 'you should|you need to',
      weight: 1.0,
    };
    
    const result = applyRule(rule, 'would you like to try this?');
    expect(result.score).toBe(80);
  });
});

describe('averageScore', () => {
  it('returns 50 for empty array', () => {
    expect(averageScore([])).toBe(50);
  });

  it('returns correct average', () => {
    expect(averageScore([100, 50, 25])).toBe(58);
  });

  it('rounds to nearest integer', () => {
    expect(averageScore([33, 33, 33])).toBe(33);
  });
});

describe('analyzePacing', () => {
  it('returns improvement for very long messages', () => {
    const longText = 'x'.repeat(600);
    const messages = [createMockMessage(longText, true)];
    const result = analyzePacing(messages, longText);
    expect(result.improvement).toContain('long');
  });

  it('returns improvement for very short messages', () => {
    const shortText = 'ok';
    const messages = [
      createMockMessage(shortText, true),
      createMockMessage(shortText, true),
      createMockMessage(shortText, true),
    ];
    const result = analyzePacing(messages, shortText.repeat(3));
    expect(result.improvement).toContain('short');
  });

  it('returns strength for good length', () => {
    const goodText = 'This is a nicely sized message with enough context.';
    const messages = [createMockMessage(goodText, true)];
    const result = analyzePacing(messages, goodText);
    expect(result.strength).toContain('Good message length');
  });

  it('returns empty for no messages', () => {
    const result = analyzePacing([], '');
    expect(result).toEqual({});
  });
});

describe('analyzeResponseRatio', () => {
  it('returns improvement when outbound >> inbound', () => {
    const result = analyzeResponseRatio(10, 2);
    expect(result.improvement).toContain('more messages than receiving');
  });

  it('returns strength when letting them talk', () => {
    const result = analyzeResponseRatio(2, 10);
    expect(result.strength).toContain('Good listening');
  });

  it('returns empty for balanced ratio', () => {
    const result = analyzeResponseRatio(5, 5);
    expect(result).toEqual({});
  });

  it('returns empty when no messages', () => {
    expect(analyzeResponseRatio(0, 5)).toEqual({});
    expect(analyzeResponseRatio(5, 0)).toEqual({});
  });
});

describe('analyzeQuestions', () => {
  it('returns improvement when no questions asked', () => {
    const result = analyzeQuestions('hello there. sounds good. okay.', 3);
    expect(result.improvement).toContain('Ask questions');
  });

  it('returns improvement for too many questions', () => {
    const result = analyzeQuestions('what? how? why? when? who? where?', 2);
    expect(result.improvement).toContain('interrogation');
  });

  it('returns empty for reasonable question count', () => {
    const result = analyzeQuestions('sounds good. what do you think?', 2);
    expect(result).toEqual({});
  });
});

describe('generateNextActionSuggestion', () => {
  it('returns appropriate suggestion for low score', () => {
    const suggestion = generateNextActionSuggestion(30);
    expect(suggestion).toContain('open-ended questions');
  });

  it('returns appropriate suggestion for mid score', () => {
    const suggestion = generateNextActionSuggestion(55);
    expect(suggestion).toContain('personalize');
  });

  it('returns appropriate suggestion for good score', () => {
    const suggestion = generateNextActionSuggestion(75);
    expect(suggestion).toContain('Solid');
  });

  it('returns appropriate suggestion for high score', () => {
    const suggestion = generateNextActionSuggestion(85);
    expect(suggestion).toContain('Excellent');
  });
});

describe('analyzeConversation', () => {
  it('returns full coaching result', () => {
    const messages: Message[] = [
      createMockMessage('Hey, what are you working on?', true),
      createMockMessage('I am building a SaaS app for scheduling', false),
      createMockMessage('That sounds interesting! Would you like some tips?', true),
      createMockMessage('Yes please, that would be great!', false),
    ];
    
    const rules = getDefaultCoachingRules();
    const result = analyzeConversation({ messages, rules });
    
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('curiosityScore');
    expect(result).toHaveProperty('valueScore');
    expect(result).toHaveProperty('permissionScore');
    expect(result).toHaveProperty('personalizationScore');
    expect(result).toHaveProperty('pacingScore');
    expect(result).toHaveProperty('strengths');
    expect(result).toHaveProperty('improvements');
    expect(result).toHaveProperty('nextActionSuggestion');
    
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.improvements)).toBe(true);
  });

  it('limits strengths and improvements to 5', () => {
    const messages: Message[] = [
      createMockMessage('What are you building? Tell me more. How does it work? Why did you start?', true),
    ];
    
    const rules = getDefaultCoachingRules();
    const result = analyzeConversation({ messages, rules });
    
    expect(result.strengths.length).toBeLessThanOrEqual(5);
    expect(result.improvements.length).toBeLessThanOrEqual(5);
  });

  it('deduplicates feedback', () => {
    const messages: Message[] = [
      createMockMessage('what? what? what?', true),
    ];
    
    // Create rules that would give duplicate feedback
    const rules: CoachingRule[] = [
      { id: '1', category: 'curiosity', name: 'Test1', positive_pattern: 'what', weight: 1, feedback_if_present: 'Good!' },
      { id: '2', category: 'curiosity', name: 'Test2', positive_pattern: 'what', weight: 1, feedback_if_present: 'Good!' },
    ];
    
    const result = analyzeConversation({ messages, rules });
    
    // Should be deduplicated
    const goodCount = result.strengths.filter(s => s === 'Good!').length;
    expect(goodCount).toBeLessThanOrEqual(1);
  });
});

describe('getDefaultCoachingRules', () => {
  it('returns array of rules', () => {
    const rules = getDefaultCoachingRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('rules have required fields', () => {
    const rules = getDefaultCoachingRules();
    for (const rule of rules) {
      expect(rule).toHaveProperty('id');
      expect(rule).toHaveProperty('category');
      expect(rule).toHaveProperty('name');
      expect(rule).toHaveProperty('weight');
    }
  });

  it('rules cover all categories', () => {
    const rules = getDefaultCoachingRules();
    const categories = new Set(rules.map(r => r.category));
    
    expect(categories.has('curiosity')).toBe(true);
    expect(categories.has('value')).toBe(true);
    expect(categories.has('permission')).toBe(true);
    expect(categories.has('personalization')).toBe(true);
    expect(categories.has('pacing')).toBe(true);
  });
});
