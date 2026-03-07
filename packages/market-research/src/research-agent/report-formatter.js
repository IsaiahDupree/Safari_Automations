/**
 * report-formatter.js
 *
 * Formats synthesis into a readable report and pushes to:
 * - Telegram (via bot API)
 * - Obsidian vault (~/.memory/vault/RESEARCH/)
 * - Supabase twitter_research_reports table
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const OBSIDIAN_RESEARCH_DIR = path.join(os.homedir(), '.memory/vault/RESEARCH');
const ACTP_ENV_PATH = '/Users/isaiahdupree/Documents/Software/actp-worker/.env';
const SUPABASE_PROJECT = 'ivhfuhxorppptyuofbgq';
const SUPABASE_URL = `https://${SUPABASE_PROJECT}.supabase.co`;

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

function getEnvVars() {
  const envVars = loadEnvFile(ACTP_ENV_PATH);
  return {
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || envVars.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || envVars.TELEGRAM_CHAT_ID || '',
    supabaseKey: process.env.SUPABASE_SERVICE_KEY || envVars.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || envVars.SUPABASE_ANON_KEY || '',
  };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Format synthesis as a Telegram message (< 4096 chars).
 */
export function formatTelegramMessage(synthesis) {
  const lines = [];

  lines.push(`📊 *Tech Trends Report — ${synthesis.date}*\n`);

  // Top topics
  for (const topic of (synthesis.topTopics || []).slice(0, 5)) {
    lines.push(`🔥 *${topic.topic}*`);
    lines.push(topic.headline || '');
    if (topic.keySignal) lines.push(`Signal: ${topic.keySignal}`);
    if (topic.topTweet?.text) {
      const tweetPreview = (topic.topTweet.text || '').slice(0, 120);
      lines.push(`Top tweet: "${tweetPreview}" — @${topic.topTweet.author || ''} (${topic.topTweet.engagement || 0} eng)`);
    }
    if (topic.emergingTools?.length) {
      lines.push(`Tools: ${topic.emergingTools.join(', ')}`);
    }
    lines.push('');
  }

  // Founder insights
  if (synthesis.founderInsights?.length) {
    lines.push(`💡 *Founder Insights*`);
    for (const insight of synthesis.founderInsights) {
      lines.push(`• ${insight}`);
    }
    lines.push('');
  }

  // Opportunities
  if (synthesis.emergingOpportunities?.length) {
    lines.push(`🚀 *Opportunities*`);
    for (const opp of synthesis.emergingOpportunities) {
      lines.push(`• ${opp}`);
    }
    lines.push('');
  }

  // Tools to watch
  if (synthesis.toolsToWatch?.length) {
    lines.push(`🛠 *Tools to Watch*`);
    lines.push(synthesis.toolsToWatch.join(', '));
    lines.push('');
  }

  // Narrative
  if (synthesis.overallNarrative) {
    lines.push(`📝 ${synthesis.overallNarrative}`);
  }

  let message = lines.join('\n');

  // Truncate if over 4096 chars
  if (message.length > 4090) {
    message = message.slice(0, 4087) + '...';
  }

  return message;
}

/**
 * Format synthesis as an Obsidian markdown note.
 */
function formatObsidianNote(synthesis) {
  const topicNames = (synthesis.topTopics || []).map(t => t.topic);
  const allTools = [
    ...(synthesis.toolsToWatch || []),
    ...(synthesis.topTopics || []).flatMap(t => t.emergingTools || []),
  ].filter((v, i, a) => a.indexOf(v) === i);

  const frontmatter = [
    '---',
    `date: ${synthesis.date}`,
    `type: twitter-research`,
    `topics: [${topicNames.map(t => `"${t}"`).join(', ')}]`,
    `tools: [${allTools.map(t => `"${t}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');

  const lines = [frontmatter];
  lines.push(`# Tech Trends Report — ${synthesis.date}\n`);

  // Overall narrative
  if (synthesis.overallNarrative) {
    lines.push(`## Summary\n\n${synthesis.overallNarrative}\n`);
  }

  // Topics
  lines.push('## Top Topics\n');
  for (const topic of (synthesis.topTopics || [])) {
    lines.push(`### ${topic.topic}`);
    lines.push(`**Headline:** ${topic.headline || ''}`);
    lines.push(`**Signal:** ${topic.keySignal || ''}`);
    lines.push(`**Sentiment:** ${topic.sentiment || 'neutral'}`);
    if (topic.topTweet?.text) {
      lines.push(`\n**Top Tweet:** "${topic.topTweet.text}"\n— @${topic.topTweet.author} (${topic.topTweet.engagement} engagement)`);
    }
    if (topic.emergingTools?.length) {
      lines.push(`\n**Emerging Tools:** ${topic.emergingTools.join(', ')}`);
    }
    lines.push('');
  }

  // Insights
  if (synthesis.founderInsights?.length) {
    lines.push('## Founder Insights\n');
    for (const insight of synthesis.founderInsights) {
      lines.push(`- ${insight}`);
    }
    lines.push('');
  }

  // Opportunities
  if (synthesis.emergingOpportunities?.length) {
    lines.push('## Emerging Opportunities\n');
    for (const opp of synthesis.emergingOpportunities) {
      lines.push(`- ${opp}`);
    }
    lines.push('');
  }

  // Tools
  if (allTools.length) {
    lines.push('## Tools to Watch\n');
    for (const tool of allTools) {
      lines.push(`- ${tool}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Send Telegram message via bot API.
 */
async function sendTelegram(botToken, chatId, message) {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${errText}`);
  }

  return await response.json();
}

/**
 * Save report to Supabase twitter_research_reports.
 */
async function saveToSupabase(supabaseKey, synthesis, batchPath, obsidianPath, telegramSent, tweetCount) {
  const url = `${SUPABASE_URL}/rest/v1/twitter_research_reports`;
  const topicNames = (synthesis.topTopics || []).map(t => t.topic);

  const payload = {
    report_date: synthesis.date,
    topics: topicNames,
    raw_batch_path: batchPath || null,
    synthesis: synthesis,
    telegram_sent: telegramSent,
    obsidian_path: obsidianPath || null,
    tweet_count: tweetCount || 0,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Supabase error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  return data[0]?.id || null;
}

/**
 * Format synthesis and push to Telegram + Obsidian + Supabase.
 * Options: { dryRun, batchPath, tweetCount }
 */
export async function formatAndPushReport(synthesis, options = {}) {
  const { dryRun = false, batchPath = null, tweetCount = 0 } = options;
  const env = getEnvVars();

  const result = {
    telegramSent: false,
    obsidianPath: null,
    supabaseId: null,
  };

  const telegramMessage = formatTelegramMessage(synthesis);

  // 1. Telegram
  if (!dryRun) {
    if (!env.telegramBotToken || !env.telegramChatId) {
      console.warn('[Formatter] Telegram creds missing — skipping Telegram');
    } else {
      try {
        await sendTelegram(env.telegramBotToken, env.telegramChatId, telegramMessage);
        result.telegramSent = true;
        console.log('[Formatter] Telegram sent successfully');
      } catch (err) {
        console.error(`[Formatter] Telegram failed: ${err.message}`);
      }
    }
  } else {
    console.log('[Formatter] Dry-run: skipping Telegram send');
  }

  // 2. Obsidian
  try {
    ensureDir(OBSIDIAN_RESEARCH_DIR);
    const noteContent = formatObsidianNote(synthesis);
    const notePath = path.join(OBSIDIAN_RESEARCH_DIR, `twitter-trends-${synthesis.date}.md`);
    fs.writeFileSync(notePath, noteContent);
    result.obsidianPath = notePath;
    console.log(`[Formatter] Obsidian note written: ${notePath}`);
  } catch (err) {
    console.error(`[Formatter] Obsidian write failed: ${err.message}`);
  }

  // 3. Supabase
  if (!dryRun) {
    if (!env.supabaseKey) {
      console.warn('[Formatter] SUPABASE_SERVICE_KEY/SUPABASE_ANON_KEY missing — skipping Supabase');
    } else {
      try {
        result.supabaseId = await saveToSupabase(
          env.supabaseKey,
          synthesis,
          batchPath,
          result.obsidianPath,
          result.telegramSent,
          tweetCount,
        );
        console.log(`[Formatter] Supabase record saved: ${result.supabaseId}`);
      } catch (err) {
        console.error(`[Formatter] Supabase save failed: ${err.message}`);
      }
    }
  } else {
    console.log('[Formatter] Dry-run: skipping Supabase write');
  }

  return result;
}
