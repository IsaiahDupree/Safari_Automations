/**
 * DM Intent Classifier — rule-based classification for incoming DMs
 * Classifies intent, sentiment, and whether a reply is needed
 */

export interface DMClassification {
  intent: string;        // lead, support, spam, networking, job_offer, collaboration, greeting, automated, unknown
  intent_score: number;  // 0-1 confidence
  sentiment: string;     // positive, negative, neutral, curious
  reply_needed: boolean;
  suggested_reply: string | null;
  lead_score: number;    // 0-100 lead quality score
}

// Intent keyword maps
const LEAD_KEYWORDS = [
  'interested', 'pricing', 'how much', 'cost', 'rates', 'services', 'hire',
  'portfolio', 'availability', 'project', 'proposal', 'quote', 'budget',
  'work together', 'collaborate', 'need help', 'looking for', 'can you',
  'do you offer', 'agency', 'freelance',
];

const JOB_OFFER_KEYWORDS = [
  'position', 'role', 'hiring', 'opportunity', 'applying', 'application',
  'interview', 'candidate', 'contractor', 'remote', 'full-time', 'part-time',
  'salary', 'compensation', 'recruiter', 'talent', 'job',
];

const SPAM_KEYWORDS = [
  'click here', 'free money', 'guaranteed', 'act now', 'limited time',
  'congratulations', 'you won', 'earn $', 'make money', 'crypto',
  'investment opportunity', 'forex', 'binary', 'mlm', 'dm me for',
  'check my bio', 'follow me', 'follow back',
];

const NETWORKING_KEYWORDS = [
  'connect', 'networking', 'mutual', 'introduction', 'meetup',
  'conference', 'event', 'community', 'group', 'podcast', 'interview you',
  'feature you', 'guest', 'speaking',
];

const COLLABORATION_KEYWORDS = [
  'collab', 'collaboration', 'partnership', 'cross-promote', 'joint',
  'content together', 'feature', 'shoutout', 'creator',
];

const SUPPORT_KEYWORDS = [
  'help', 'issue', 'problem', 'not working', 'broken', 'bug', 'error',
  'fix', 'support', 'question', 'how do i', 'stuck', 'struggling',
];

const AUTOMATED_PATTERNS = [
  /^inmail/i,
  /^linkedin offer/i,
  /this message has been deleted/i,
  /^sponsored/i,
  /^ad:/i,
];

const GREETING_PATTERNS = [
  /^(hey|hi|hello|sup|yo|what'?s up|howdy|greetings)/i,
  /^(thanks|thank you|thx|ty)\s*[!.:)]*$/i,
  /^(👋|🙏|😊|👍|🤝)\s*$/,
  /^.{1,15}$/,  // Very short messages are often greetings
];

// Specificity signals that indicate a serious lead (not just tire-kicking)
const SPECIFICITY_KEYWORDS = [
  'deadline', 'timeline', 'asap', 'urgent', 'this week', 'next week', 'this month',
  'budget', 'spend', 'invest', '$', 'revenue', 'roi',
  'team', 'company', 'startup', 'founder', 'ceo', 'cto', 'vp',
  'our', 'we need', 'we are', 'our team', 'my team', 'my company',
  'scale', 'growth', 'launch', 'mvp', 'prototype', 'product',
];

// Urgency indicators
const URGENCY_KEYWORDS = [
  'asap', 'urgent', 'immediately', 'right away', 'this week', 'deadline',
  'time-sensitive', 'quickly', 'fast turnaround', 'rush',
];

const POSITIVE_WORDS = [
  'love', 'amazing', 'great', 'awesome', 'excellent', 'wonderful', 'fantastic',
  'thank', 'appreciate', 'helpful', 'cool', 'nice', 'brilliant', 'perfect',
  '❤️', '🔥', '✨', '💯', '🙌', '👏', '😍',
];

const NEGATIVE_WORDS = [
  'frustrated', 'annoyed', 'disappointed', 'terrible', 'awful', 'bad',
  'hate', 'worst', 'angry', 'upset', 'unacceptable', '😡', '😤', '👎',
];

function matchScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let matches = 0;
  for (const kw of keywords) {
    if (lower.includes(kw)) matches++;
  }
  return Math.min(matches / Math.max(keywords.length * 0.1, 1), 1);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(text));
}

export function classifyDM(text: string, direction: string = 'inbound', platform?: string): DMClassification {
  if (!text || text.trim().length === 0) {
    return { intent: 'unknown', intent_score: 0, sentiment: 'neutral', reply_needed: false, suggested_reply: null, lead_score: 0 };
  }

  const trimmed = text.trim();

  // Outbound messages don't need classification for reply
  if (direction === 'outbound') {
    return { intent: 'outbound', intent_score: 1, sentiment: 'neutral', reply_needed: false, suggested_reply: null, lead_score: 0 };
  }

  // Check automated/system messages first
  if (matchesAny(trimmed, AUTOMATED_PATTERNS)) {
    return { intent: 'automated', intent_score: 0.9, sentiment: 'neutral', reply_needed: false, suggested_reply: null, lead_score: 0 };
  }

  // Score each intent
  const scores: Record<string, number> = {
    lead: matchScore(trimmed, LEAD_KEYWORDS),
    job_offer: matchScore(trimmed, JOB_OFFER_KEYWORDS),
    spam: matchScore(trimmed, SPAM_KEYWORDS),
    networking: matchScore(trimmed, NETWORKING_KEYWORDS),
    collaboration: matchScore(trimmed, COLLABORATION_KEYWORDS),
    support: matchScore(trimmed, SUPPORT_KEYWORDS),
  };

  // Check greeting patterns
  if (matchesAny(trimmed, GREETING_PATTERNS) && trimmed.length < 50) {
    scores.greeting = 0.7;
  }

  // Find highest scoring intent
  let topIntent = 'unknown';
  let topScore = 0;
  for (const [intent, score] of Object.entries(scores)) {
    if (score > topScore) {
      topIntent = intent;
      topScore = score;
    }
  }

  // Default to unknown if no strong signal
  if (topScore < 0.05) {
    topIntent = 'unknown';
    topScore = 0;
  }

  // Sentiment
  const posScore = matchScore(trimmed, POSITIVE_WORDS);
  const negScore = matchScore(trimmed, NEGATIVE_WORDS);
  const hasQuestion = /\?/.test(trimmed) || /^(how|what|when|where|who|why|can|do|is|are|will|would)\b/i.test(trimmed);

  let sentiment: string;
  if (hasQuestion && posScore < 0.1 && negScore < 0.1) sentiment = 'curious';
  else if (posScore > negScore + 0.1) sentiment = 'positive';
  else if (negScore > posScore + 0.1) sentiment = 'negative';
  else sentiment = 'neutral';

  // Reply needed logic
  const reply_needed = ['lead', 'support', 'collaboration', 'networking', 'job_offer'].includes(topIntent)
    || (topIntent === 'greeting' && trimmed.length > 5)
    || (topIntent === 'unknown' && hasQuestion);

  // Suggested replies
  let suggested_reply: string | null = null;
  switch (topIntent) {
    case 'lead':
      suggested_reply = "Thanks for reaching out! I'd love to learn more about what you're looking for. What's the best way to connect?";
      break;
    case 'support':
      suggested_reply = "Thanks for flagging this — let me look into it and get back to you shortly.";
      break;
    case 'collaboration':
      suggested_reply = "Love the idea of collaborating! What did you have in mind?";
      break;
    case 'networking':
      suggested_reply = "Great to connect! Always happy to meet people in the space.";
      break;
    case 'greeting':
      suggested_reply = "Hey! Thanks for reaching out 🙌";
      break;
    case 'job_offer':
      suggested_reply = "Thanks for thinking of me! I'd be happy to learn more about the opportunity.";
      break;
  }

  // Compute lead score (0-100)
  const lead_score = computeLeadScore(trimmed, topIntent, topScore, sentiment, platform);

  return {
    intent: topIntent,
    intent_score: Math.round(topScore * 100) / 100,
    sentiment,
    reply_needed,
    suggested_reply,
    lead_score,
  };
}

/**
 * Compute a 0-100 lead quality score based on multiple signals.
 * Scoring breakdown:
 *   - Intent base (0-40): lead/job_offer/collaboration get highest base
 *   - Message quality (0-20): length, specificity, questions asked
 *   - Urgency (0-15): time-sensitive language
 *   - Sentiment (0-10): positive sentiment boosts score
 *   - Platform value (0-15): LinkedIn > IG/Twitter > TikTok for B2B leads
 */
function computeLeadScore(
  text: string,
  intent: string,
  intentScore: number,
  sentiment: string,
  platform?: string,
): number {
  let score = 0;

  // 1. Intent base (0-40)
  const intentBases: Record<string, number> = {
    lead: 35,
    job_offer: 30,
    collaboration: 25,
    networking: 15,
    support: 10,
    greeting: 5,
    spam: 0,
    automated: 0,
    outbound: 0,
    unknown: 5,
  };
  score += (intentBases[intent] ?? 5) * Math.max(intentScore, 0.3);

  // 2. Message quality (0-20)
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 20) score += 10;       // substantive message
  else if (wordCount >= 10) score += 6;
  else if (wordCount >= 5) score += 3;

  const specificityHits = matchScore(text, SPECIFICITY_KEYWORDS);
  score += Math.min(specificityHits * 30, 10); // up to 10 for specific language

  // 3. Urgency (0-15)
  const urgencyHits = matchScore(text, URGENCY_KEYWORDS);
  score += Math.min(urgencyHits * 40, 15);

  // 4. Sentiment boost (0-10)
  if (sentiment === 'positive') score += 8;
  else if (sentiment === 'curious') score += 6;
  else if (sentiment === 'neutral') score += 3;
  // negative = 0 bonus

  // 5. Platform value (0-15)
  const platformValues: Record<string, number> = {
    linkedin: 15,
    instagram: 8,
    twitter: 8,
    threads: 6,
    tiktok: 5,
  };
  score += platformValues[platform || ''] ?? 5;

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(score)));
}
