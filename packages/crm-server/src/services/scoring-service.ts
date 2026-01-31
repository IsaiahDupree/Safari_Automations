/**
 * Scoring Service
 * Calculates and updates relationship scores using crm-core engines.
 */

import { getContactByUsername, getMessages, updateContactScore, type Contact, type Message } from '../clients/database-client.js';

// Import scoring functions from crm-core (relative path since not npm published)
// In production, would be: import { calculateRelationshipScore } from '@local-everreach/crm-core';

interface ScoreResult {
  overall: number;
  recency: number;
  resonance: number;
  needClarity: number;
  valueDelivered: number;
  reliability: number;
  consent: number;
}

// Inline scoring logic (mirrors crm-core for standalone operation)
function calculateRecencyScore(lastMessageAt?: string): number {
  if (!lastMessageAt) return 20;
  
  const daysSince = Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysSince <= 3) return 100;
  if (daysSince <= 7) return 85;
  if (daysSince <= 14) return 70;
  if (daysSince <= 30) return 50;
  if (daysSince <= 60) return 30;
  return 10;
}

function calculateResonanceScore(messages: Message[]): number {
  if (!messages.length) return 30;
  
  const inbound = messages.filter(m => !m.is_outbound);
  if (!inbound.length) return 20;
  
  let score = 40;
  const avgLength = inbound.reduce((sum, m) => sum + (m.message_text?.length || 0), 0) / inbound.length;
  
  if (avgLength > 100) score += 20;
  else if (avgLength > 50) score += 10;
  
  const hasQuestions = inbound.some(m => m.message_text?.includes('?'));
  if (hasQuestions) score += 15;
  
  const personalWords = ['I', 'my', 'we', 'our'];
  const hasPersonal = inbound.some(m => 
    personalWords.some(w => m.message_text?.toLowerCase().includes(w.toLowerCase()))
  );
  if (hasPersonal) score += 15;
  
  return Math.min(100, score);
}

function calculateNeedClarityScore(contact: Contact): number {
  let score = 20;
  if (contact.what_theyre_building) score += 30;
  if (contact.current_friction) score += 25;
  if (contact.fit_signals?.length > 0) score += 15;
  return Math.min(100, score);
}

function calculateConsentScore(contact: Contact): number {
  let score = 30;
  if ((contact as any).asks_opinion) score += 25;
  if ((contact as any).shares_updates) score += 25;
  if ((contact as any).has_referred_others) score += 20;
  return Math.min(100, score);
}

export async function calculateScore(username: string): Promise<ScoreResult | null> {
  const contact = await getContactByUsername(username);
  if (!contact) return null;
  
  const messages = await getMessages(contact.id);
  
  const recency = calculateRecencyScore(contact.last_message_at);
  const resonance = calculateResonanceScore(messages);
  const needClarity = calculateNeedClarityScore(contact);
  const valueDelivered = 50; // Would need tracking
  const reliability = 50; // Would need promise tracking
  const consent = calculateConsentScore(contact);
  
  // Weighted average
  const overall = Math.round(
    recency * 0.20 +
    resonance * 0.20 +
    needClarity * 0.15 +
    valueDelivered * 0.20 +
    reliability * 0.15 +
    consent * 0.10
  );
  
  return { overall, recency, resonance, needClarity, valueDelivered, reliability, consent };
}

export async function updateScore(username: string): Promise<{ contact: Contact; score: ScoreResult } | null> {
  const contact = await getContactByUsername(username);
  if (!contact) return null;
  
  const score = await calculateScore(username);
  if (!score) return null;
  
  await updateContactScore(contact.id, score.overall);
  
  return { contact: { ...contact, relationship_score: score.overall }, score };
}

export async function batchUpdateScores(usernames: string[]): Promise<{ updated: number; failed: string[] }> {
  const failed: string[] = [];
  let updated = 0;
  
  for (const username of usernames) {
    try {
      const result = await updateScore(username);
      if (result) updated++;
      else failed.push(username);
    } catch (error) {
      failed.push(username);
    }
  }
  
  return { updated, failed };
}
