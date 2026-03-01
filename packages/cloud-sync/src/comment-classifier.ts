/**
 * Comment Classifier — rule-based sentiment, question, and testimonial detection
 * 
 * Runs locally (no API cost). Populates:
 *   - sentiment_class: positive | negative | neutral | question | objection
 *   - sentiment_score: -1.0 to 1.0
 *   - is_question: boolean
 *   - is_testimonial: boolean
 */

interface ClassificationResult {
  sentiment_class: 'positive' | 'negative' | 'neutral' | 'question' | 'objection';
  sentiment_score: number;  // -1.0 to 1.0
  is_question: boolean;
  is_testimonial: boolean;
}

// ─── Word lists ────────────────────────────────────

const POSITIVE_WORDS = [
  'love', 'amazing', 'great', 'awesome', 'beautiful', 'happy', 'perfect',
  'thanks', 'thank', 'appreciate', 'incredible', 'fantastic', 'excellent',
  'brilliant', 'helpful', 'inspiring', 'fire', 'goat', 'legend', 'king',
  'dope', 'sick', 'insane', 'respect', 'agree', 'exactly', 'yes',
  'needed', 'underrated', 'gem', 'gold', 'valuable', 'clutch',
];

const NEGATIVE_WORDS = [
  'hate', 'bad', 'terrible', 'awful', 'worst', 'trash', 'garbage',
  'boring', 'waste', 'annoying', 'scam', 'fake', 'cringe', 'mid',
  'overrated', 'disappointed', 'frustrating', 'useless', 'wrong',
  'disagree', 'nah', 'cap', 'sus',
];

const OBJECTION_WORDS = [
  'but', 'however', 'expensive', 'cost', 'price', 'worth it',
  'too long', 'not sure', 'idk', 'doubt', 'skeptic', 'really?',
  'prove', 'evidence', 'source', "doesn't work", "won't work",
];

const QUESTION_SIGNALS = [
  '?', 'how do', 'how to', 'what is', 'what are', 'where can',
  'can you', 'could you', 'do you', 'does this', 'is there',
  'anyone know', 'please help', 'tips on', 'advice',
  'tutorial', 'explain', 'where do',
];

const TESTIMONIAL_SIGNALS = [
  'i tried', 'i used', 'it worked', 'this helped', 'changed my',
  'saved me', 'thanks to', 'because of you', 'your video',
  'your content', 'your advice', 'followed your', 'took your',
  'game changer', 'life changer', 'finally', 'just did',
  'just started', 'results', 'made me', 'inspired me',
];

const POSITIVE_EMOJI = ['🔥', '💯', '✨', '❤️', '😍', '👏', '🙌', '💪', '🤯', '👑', '🎯', '💎', '⭐', '🏆'];
const NEGATIVE_EMOJI = ['😢', '😡', '🤮', '💀', '🗑️', '👎', '😤', '😒'];

// ─── Classifier ────────────────────────────────────

export function classifyComment(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  // Score accumulators
  let positiveScore = 0;
  let negativeScore = 0;

  // Word matching (weighted)
  for (const w of words) {
    const clean = w.replace(/[^a-z]/g, '');
    if (POSITIVE_WORDS.includes(clean)) positiveScore += 1;
    if (NEGATIVE_WORDS.includes(clean)) negativeScore += 1;
    if (OBJECTION_WORDS.some(o => lower.includes(o))) negativeScore += 0.3;
  }

  // Emoji matching
  for (const e of POSITIVE_EMOJI) {
    if (text.includes(e)) positiveScore += 0.5;
  }
  for (const e of NEGATIVE_EMOJI) {
    if (text.includes(e)) negativeScore += 0.5;
  }

  // Exclamation marks boost sentiment magnitude
  const exclamationCount = (text.match(/!/g) || []).length;
  if (exclamationCount > 0) {
    if (positiveScore > negativeScore) positiveScore += exclamationCount * 0.2;
    else if (negativeScore > positiveScore) negativeScore += exclamationCount * 0.2;
  }

  // Caps emphasis (ALL CAPS words boost)
  const capsWords = words.filter(w => w.length > 2 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (capsWords.length > 0) {
    if (positiveScore >= negativeScore) positiveScore += capsWords.length * 0.3;
    else negativeScore += capsWords.length * 0.3;
  }

  // ── Question detection ──
  const is_question = QUESTION_SIGNALS.some(q => lower.includes(q));

  // ── Testimonial detection ──
  const is_testimonial = TESTIMONIAL_SIGNALS.some(t => lower.includes(t));

  // ── Objection detection ──
  const hasObjection = OBJECTION_WORDS.some(o => lower.includes(o)) && negativeScore > 0;

  // ── Final classification ──
  let sentiment_class: ClassificationResult['sentiment_class'];
  let sentiment_score: number;

  if (is_question && positiveScore <= negativeScore) {
    sentiment_class = 'question';
    sentiment_score = 0;
  } else if (hasObjection && negativeScore > positiveScore) {
    sentiment_class = 'objection';
    sentiment_score = -0.3;
  } else if (positiveScore > negativeScore + 0.5) {
    sentiment_class = 'positive';
    sentiment_score = Math.min(1.0, positiveScore / 5);
  } else if (negativeScore > positiveScore + 0.5) {
    sentiment_class = 'negative';
    sentiment_score = Math.max(-1.0, -negativeScore / 5);
  } else {
    sentiment_class = 'neutral';
    sentiment_score = 0;
  }

  // Testimonials nudge positive
  if (is_testimonial && sentiment_class === 'neutral') {
    sentiment_class = 'positive';
    sentiment_score = 0.3;
  }

  return {
    sentiment_class,
    sentiment_score: Math.round(sentiment_score * 100) / 100,
    is_question,
    is_testimonial,
  };
}

/**
 * Batch classify — returns a map of comment_text → classification
 */
export function classifyBatch(texts: string[]): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();
  for (const text of texts) {
    results.set(text, classifyComment(text));
  }
  return results;
}
