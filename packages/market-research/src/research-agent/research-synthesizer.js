/**
 * research-synthesizer.js
 *
 * Uses Claude Haiku to cluster, rank, and extract business-relevant signals
 * from raw tweet data collected by multi-topic-search-runner.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const SYNTHESIS_DIR = path.join(os.homedir(), 'Documents/twitter-research/synthesis');
const ACTP_ENV_PATH = '/Users/isaiahdupree/Documents/Software/actp-worker/.env';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_PROMPT_TOKENS = 4000;
const MAX_TWEET_TEXT = 200; // chars per tweet in prompt

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadEnvFile(envPath) {
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

function getApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envVars = loadEnvFile(ACTP_ENV_PATH);
  return envVars.ANTHROPIC_API_KEY || null;
}

/**
 * Build a compact prompt from the research batch (< MAX_PROMPT_TOKENS tokens ~ 4000 chars).
 */
function buildPrompt(batch) {
  const date = getTodayDate();
  let prompt = `Date: ${date}\n\nTwitter Research Batch — ${batch.topics.length} topics, ${batch.totalTweets} total tweets\n\n`;

  for (const topic of batch.topics) {
    if (prompt.length > MAX_PROMPT_TOKENS * 3.5) break; // ~3.5 chars/token estimate

    prompt += `## Topic: ${topic.name}\n`;
    const topTweets = (topic.tweets || []).slice(0, 5);
    for (const tweet of topTweets) {
      const text = (tweet.text || '').slice(0, MAX_TWEET_TEXT).replace(/\n/g, ' ');
      const eng = (tweet.likes || 0) + (tweet.retweets || 0) + (tweet.replies || 0);
      prompt += `- @${tweet.author} (${eng} eng): ${text}\n`;
    }
    prompt += '\n';
  }

  return prompt;
}

/**
 * Fallback synthesis when Claude call fails.
 */
function buildFallbackSynthesis(batch) {
  const date = getTodayDate();
  const topTopics = batch.topics.slice(0, 5).map(topic => {
    const topTweet = (topic.tweets || [])[0];
    return {
      topic: topic.name,
      headline: `Trending discussions around ${topic.name}`,
      keySignal: `Active conversation with ${topic.tweets.length} tweets collected`,
      topTweet: topTweet ? {
        text: topTweet.text || '',
        author: topTweet.author || '',
        engagement: (topTweet.likes || 0) + (topTweet.retweets || 0),
      } : { text: '', author: '', engagement: 0 },
      emergingTools: [],
      sentiment: 'neutral',
    };
  });

  return {
    date,
    topTopics,
    founderInsights: [
      `${batch.topics.length} tech topics trending on Twitter today`,
      `${batch.totalTweets} tweets collected across all topics`,
      'Monitor these trends for content and outreach opportunities',
    ],
    emergingOpportunities: [
      'Content creation around trending tech topics',
      'Engage with active conversations in your niche',
    ],
    toolsToWatch: [],
    overallNarrative: `Today's Twitter research captured ${batch.totalTweets} tweets across ${batch.topics.length} trending tech topics. Review the raw data for detailed insights.`,
  };
}

/**
 * Call Claude Haiku to synthesize the batch into structured JSON.
 */
async function callClaude(apiKey, prompt) {
  const systemPrompt = 'You are a tech trend analyst for a B2B SaaS founder targeting $500K-$5M ARR software companies. Extract business-relevant signals from these Twitter trends.';

  const requestBody = {
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\nAnalyze the above Twitter research data and return ONLY a JSON object with this exact schema (no markdown, no explanation):\n{\n  "date": "YYYY-MM-DD",\n  "topTopics": [\n    {\n      "topic": "string",\n      "headline": "one sentence summary",\n      "keySignal": "what this means for B2B founders",\n      "topTweet": { "text": "...", "author": "...", "engagement": 0 },\n      "emergingTools": ["tool1", "tool2"],\n      "sentiment": "bullish|bearish|neutral"\n    }\n  ],\n  "founderInsights": ["insight1", "insight2", "insight3"],\n  "emergingOpportunities": ["opportunity1", "opportunity2"],\n  "toolsToWatch": ["tool1", "tool2"],\n  "overallNarrative": "2-3 sentence synthesis"\n}`,
      },
    ],
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';

  // Parse JSON from response (may have surrounding text)
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in Claude response');

  return JSON.parse(jsonMatch[0]);
}

/**
 * Synthesize a ResearchBatch into structured insights using Claude Haiku.
 * Falls back to template if Claude call fails.
 */
export async function synthesizeBatch(batch) {
  ensureDir(SYNTHESIS_DIR);

  const apiKey = getApiKey();
  const prompt = buildPrompt(batch);

  let synthesis;

  if (!apiKey) {
    console.warn('[Synthesizer] ANTHROPIC_API_KEY not found — using fallback template');
    synthesis = buildFallbackSynthesis(batch);
  } else {
    try {
      console.log('[Synthesizer] Calling Claude Haiku for synthesis...');
      synthesis = await callClaude(apiKey, prompt);
      console.log(`[Synthesizer] Claude synthesis complete: ${synthesis.topTopics?.length || 0} topics`);
    } catch (err) {
      console.warn(`[Synthesizer] Claude call failed: ${err.message} — using fallback template`);
      synthesis = buildFallbackSynthesis(batch);
    }
  }

  // Ensure date is set
  if (!synthesis.date) synthesis.date = getTodayDate();

  // Save synthesis to file
  const dateStr = getTodayDate();
  const synthesisPath = path.join(SYNTHESIS_DIR, `${dateStr}.json`);
  fs.writeFileSync(synthesisPath, JSON.stringify(synthesis, null, 2));
  console.log(`[Synthesizer] Synthesis saved: ${synthesisPath}`);

  return { synthesis, synthesisPath };
}
