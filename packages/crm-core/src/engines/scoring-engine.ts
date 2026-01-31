/**
 * Relationship Scoring Engine
 * Calculates relationship health scores based on multiple factors.
 * Pure functions that can work with any data source.
 */

import type {
  Contact,
  RelationshipScore,
  ScoreWeights,
  DEFAULT_SCORE_WEIGHTS,
  Message,
} from '../models/types.js';

export interface ScoringInput {
  contact: Contact;
  messages?: Message[];
  valueDeliveredCount?: number;
  promisesKept?: number;
  promisesMade?: number;
}

/**
 * Calculate the full relationship score breakdown for a contact.
 */
export function calculateRelationshipScore(
  input: ScoringInput,
  weights: ScoreWeights = {
    recency: 0.20,
    resonance: 0.20,
    needClarity: 0.15,
    valueDelivered: 0.20,
    reliability: 0.15,
    consent: 0.10,
  }
): RelationshipScore {
  const { contact, messages = [], valueDeliveredCount = 0, promisesKept = 0, promisesMade = 0 } = input;

  // Recency score (days since last meaningful touch)
  const recency = calculateRecencyScore(contact.last_message_at);

  // Resonance score (reply depth/quality)
  const resonance = calculateResonanceScore(messages);

  // Need clarity score (do we understand their goals?)
  const needClarity = calculateNeedClarityScore(contact);

  // Value delivered score
  const valueDelivered = calculateValueDeliveredScore(valueDeliveredCount);

  // Reliability score (promises kept)
  const reliability = calculateReliabilityScore(promisesKept, promisesMade);

  // Consent score (opt-in level)
  const consent = calculateConsentScore(contact);

  // Calculate weighted overall
  const overall = Math.round(
    recency * weights.recency +
    resonance * weights.resonance +
    needClarity * weights.needClarity +
    valueDelivered * weights.valueDelivered +
    reliability * weights.reliability +
    consent * weights.consent
  );

  return {
    overall: Math.max(0, Math.min(100, overall)),
    recency,
    resonance,
    needClarity,
    valueDelivered,
    reliability,
    consent,
  };
}

/**
 * Calculate recency score based on days since last message.
 */
export function calculateRecencyScore(lastMessageAt?: string): number {
  if (!lastMessageAt) return 20;

  const daysSince = Math.floor(
    (Date.now() - new Date(lastMessageAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSince <= 3) return 100;
  if (daysSince <= 7) return 85;
  if (daysSince <= 14) return 70;
  if (daysSince <= 30) return 50;
  if (daysSince <= 60) return 30;
  return 10;
}

/**
 * Calculate resonance score based on message quality.
 */
export function calculateResonanceScore(messages: Message[]): number {
  if (messages.length === 0) return 30;

  const inboundMessages = messages.filter(m => !m.is_outbound);
  if (inboundMessages.length === 0) return 20;

  // Analyze reply depth
  let totalScore = 0;
  for (const msg of inboundMessages) {
    const text = msg.message_text || '';
    let msgScore = 30;

    // Length bonus
    if (text.length > 100) msgScore += 20;
    if (text.length > 200) msgScore += 10;

    // Contains questions (engagement)
    if (text.includes('?')) msgScore += 15;

    // Contains personal details
    if (text.match(/i('m| am)|my |we |our /i)) msgScore += 15;

    // Emotional words
    if (text.match(/love|great|awesome|excited|happy|thanks/i)) msgScore += 10;

    totalScore += Math.min(100, msgScore);
  }

  return Math.round(totalScore / inboundMessages.length);
}

/**
 * Calculate need clarity score based on contact profile completeness.
 */
export function calculateNeedClarityScore(contact: Contact): number {
  let score = 20;

  if (contact.what_theyre_building) score += 30;
  if (contact.current_friction) score += 25;
  if (contact.their_definition_of_win) score += 15;
  if (contact.fit_signals && contact.fit_signals.length > 0) score += 10;

  return Math.min(100, score);
}

/**
 * Calculate value delivered score.
 */
export function calculateValueDeliveredScore(count: number): number {
  if (count === 0) return 20;
  if (count === 1) return 50;
  if (count === 2) return 70;
  if (count >= 3) return 90;
  return 100;
}

/**
 * Calculate reliability score based on promises kept.
 */
export function calculateReliabilityScore(kept: number, made: number): number {
  if (made === 0) return 50; // Neutral if no promises made
  const ratio = kept / made;
  return Math.round(ratio * 100);
}

/**
 * Calculate consent score based on trust signals.
 */
export function calculateConsentScore(contact: Contact): number {
  let score = 30;

  if (contact.asks_opinion) score += 25;
  if (contact.shares_updates) score += 25;
  if (contact.has_referred_others) score += 20;

  return Math.min(100, score);
}

/**
 * Determine the appropriate action lane based on score and stage.
 */
export function determineActionLane(contact: Contact): 'friendship' | 'service' | 'offer' | 'retention' | 'rewarm' {
  const score = contact.relationship_score;
  const stage = contact.pipeline_stage;

  if (stage === 'post_win_expansion') return 'retention';
  if (stage === 'fit_repeats' || stage === 'permissioned_offer') return 'offer';
  if (score < 40) return 'rewarm';
  if (score >= 40 && score < 70 && contact.what_theyre_building) return 'service';
  return 'friendship';
}

/**
 * Get score tier label for display.
 */
export function getScoreTier(score: number): { label: string; emoji: string; color: string } {
  if (score >= 90) return { label: 'Excellent', emoji: '🌟', color: 'green' };
  if (score >= 80) return { label: 'Great', emoji: '⭐', color: 'green' };
  if (score >= 70) return { label: 'Good', emoji: '👍', color: 'blue' };
  if (score >= 60) return { label: 'Growing', emoji: '📈', color: 'blue' };
  if (score >= 50) return { label: 'Building', emoji: '📊', color: 'yellow' };
  if (score >= 40) return { label: 'Needs Work', emoji: '⚠️', color: 'yellow' };
  if (score >= 30) return { label: 'At Risk', emoji: '🔧', color: 'orange' };
  return { label: 'Cold', emoji: '❄️', color: 'red' };
}
