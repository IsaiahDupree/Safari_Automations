/**
 * DM Coaching Engine
 * Analyzes conversations and provides coaching feedback.
 * Pure functions for testability and portability.
 */

import type {
  Message,
  CoachingResult,
  CoachingRule,
  CoachingCategory,
} from '../models/types.js';

export interface CoachingInput {
  messages: Message[];
  rules: CoachingRule[];
}

/**
 * Analyze messages against coaching rules and return coaching feedback.
 */
export function analyzeConversation(input: CoachingInput): CoachingResult {
  const { messages, rules } = input;
  
  const outboundMessages = messages.filter(m => m.is_outbound);
  const inboundMessages = messages.filter(m => !m.is_outbound);
  const outboundText = outboundMessages.map(m => m.message_text || '').join(' ').toLowerCase();

  const scores: Record<CoachingCategory, number[]> = {
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
    const result = applyRule(rule, outboundText);
    
    if (scores[rule.category]) {
      scores[rule.category].push(result.score);
    }
    
    if (result.feedback) {
      if (result.isStrength) {
        strengths.push(result.feedback);
      } else {
        improvements.push(result.feedback);
      }
    }
  }

  // Calculate category averages
  const curiosityScore = averageScore(scores.curiosity);
  const valueScore = averageScore(scores.value);
  const permissionScore = averageScore(scores.permission);
  const personalizationScore = averageScore(scores.personalization);
  const pacingScore = averageScore(scores.pacing);

  // Overall score (weighted)
  const overallScore = Math.round(
    curiosityScore * 0.2 +
    valueScore * 0.25 +
    permissionScore * 0.25 +
    personalizationScore * 0.15 +
    pacingScore * 0.15
  );

  // Additional pacing analysis
  const pacingFeedback = analyzePacing(outboundMessages, outboundText);
  if (pacingFeedback.strength) strengths.push(pacingFeedback.strength);
  if (pacingFeedback.improvement) improvements.push(pacingFeedback.improvement);

  // Response ratio analysis
  const ratioFeedback = analyzeResponseRatio(outboundMessages.length, inboundMessages.length);
  if (ratioFeedback.strength) strengths.push(ratioFeedback.strength);
  if (ratioFeedback.improvement) improvements.push(ratioFeedback.improvement);

  // Question analysis
  const questionFeedback = analyzeQuestions(outboundText, outboundMessages.length);
  if (questionFeedback.improvement) improvements.push(questionFeedback.improvement);

  // Generate next action suggestion
  const nextActionSuggestion = generateNextActionSuggestion(overallScore);

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

/**
 * Apply a single coaching rule to the text.
 */
export function applyRule(
  rule: CoachingRule,
  text: string
): { score: number; feedback?: string; isStrength: boolean } {
  let score = 50; // Base score
  let feedback: string | undefined;
  let isStrength = false;

  // Check positive pattern
  if (rule.positive_pattern) {
    try {
      const regex = new RegExp(rule.positive_pattern, 'i');
      if (regex.test(text)) {
        score = 100;
        isStrength = true;
        feedback = rule.feedback_if_present;
      } else {
        score = 30;
        feedback = rule.feedback_if_missing;
      }
    } catch {
      // Invalid regex, skip
    }
  }

  // Check negative pattern
  if (rule.negative_pattern && !isStrength) {
    try {
      const regex = new RegExp(rule.negative_pattern, 'i');
      if (regex.test(text)) {
        score = 20;
        isStrength = false;
        feedback = rule.feedback_if_present;
      } else {
        score = 80;
      }
    } catch {
      // Invalid regex, skip
    }
  }

  return { score, feedback, isStrength };
}

/**
 * Calculate average of scores array.
 */
export function averageScore(scores: number[]): number {
  if (scores.length === 0) return 50;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Analyze message pacing (length).
 */
export function analyzePacing(
  messages: Message[],
  allText: string
): { strength?: string; improvement?: string } {
  if (messages.length === 0) return {};

  const avgLength = allText.length / messages.length;

  if (avgLength > 500) {
    return { improvement: 'Messages are quite long - try to be more concise' };
  } else if (avgLength < 20) {
    return { improvement: 'Messages are very short - add more context when helpful' };
  }
  return { strength: 'Good message length' };
}

/**
 * Analyze response ratio.
 */
export function analyzeResponseRatio(
  outbound: number,
  inbound: number
): { strength?: string; improvement?: string } {
  if (outbound === 0 || inbound === 0) return {};

  const ratio = outbound / inbound;

  if (ratio > 3) {
    return { improvement: "You're sending many more messages than receiving - wait for responses" };
  } else if (ratio < 0.5) {
    return { strength: 'Good listening - you let them talk' };
  }
  return {};
}

/**
 * Analyze question usage.
 */
export function analyzeQuestions(
  text: string,
  messageCount: number
): { improvement?: string } {
  const questionCount = (text.match(/\?/g) || []).length;

  if (questionCount === 0 && messageCount > 2) {
    return { improvement: 'Ask questions to learn about their situation' };
  } else if (questionCount > messageCount * 2) {
    return { improvement: 'Too many questions can feel like an interrogation' };
  }
  return {};
}

/**
 * Generate next action suggestion based on score.
 */
export function generateNextActionSuggestion(score: number): string {
  if (score < 40) {
    return 'Focus on asking open-ended questions and providing value before any offers';
  } else if (score < 60) {
    return 'Good start! Try to personalize more and always ask permission before offering';
  } else if (score < 80) {
    return 'Solid conversation! Consider sharing a helpful resource to add more value';
  }
  return 'Excellent conversation! Keep nurturing this relationship';
}

/**
 * Get default coaching rules.
 */
export function getDefaultCoachingRules(): CoachingRule[] {
  return [
    {
      id: 'curiosity_open_questions',
      category: 'curiosity',
      name: 'Open-ended questions',
      positive_pattern: '(what|how|why|tell me).+\\?',
      weight: 1.0,
      feedback_if_present: 'Great use of open-ended questions',
      feedback_if_missing: 'Try asking more open-ended questions',
    },
    {
      id: 'curiosity_follow_up',
      category: 'curiosity',
      name: 'Follow-up questions',
      positive_pattern: '(more about|tell me more|curious|interested)',
      weight: 0.8,
      feedback_if_present: 'Good follow-up engagement',
      feedback_if_missing: 'Ask follow-up questions to show interest',
    },
    {
      id: 'value_offer_help',
      category: 'value',
      name: 'Offering help',
      positive_pattern: '(help|assist|support|resource|template|guide)',
      weight: 1.0,
      feedback_if_present: 'Good value offering',
      feedback_if_missing: 'Consider offering helpful resources',
    },
    {
      id: 'value_share_insight',
      category: 'value',
      name: 'Sharing insights',
      positive_pattern: '(found|discovered|learned|tip|insight|idea)',
      weight: 0.8,
      feedback_if_present: 'Great insight sharing',
      feedback_if_missing: 'Share insights from your experience',
    },
    {
      id: 'permission_ask_before',
      category: 'permission',
      name: 'Asking permission',
      positive_pattern: '(would you like|want me to|interested in|okay if)',
      weight: 1.0,
      feedback_if_present: 'Good practice asking permission',
      feedback_if_missing: 'Always ask before offering or advising',
    },
    {
      id: 'permission_no_pushy',
      category: 'permission',
      name: 'Avoiding pushiness',
      negative_pattern: '(you should|you need to|you must|buy now|limited time)',
      weight: 1.0,
      feedback_if_present: 'Avoid pushy language',
    },
    {
      id: 'personalization_name',
      category: 'personalization',
      name: 'Using context',
      positive_pattern: '(you mentioned|earlier you said|your \\w+|noticed you)',
      weight: 1.0,
      feedback_if_present: 'Good personalization with context',
      feedback_if_missing: 'Reference previous conversation details',
    },
    {
      id: 'personalization_remember',
      category: 'personalization',
      name: 'Remembering details',
      positive_pattern: '(remember|last time|when you|your project)',
      weight: 0.8,
      feedback_if_present: 'Great job remembering details',
    },
    {
      id: 'pacing_no_walls',
      category: 'pacing',
      name: 'Avoiding text walls',
      negative_pattern: '.{800,}',
      weight: 0.8,
      feedback_if_present: 'Break up long messages into smaller chunks',
    },
  ];
}
