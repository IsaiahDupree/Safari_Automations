/**
 * multi-topic-search-runner.js
 *
 * Runs TwitterResearcher sequentially per topic to collect raw tweet data.
 * Returns a ResearchBatch object and saves raw data to ~/Documents/twitter-research/batches/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TwitterResearcher } from '../../dist/twitter-comments/src/automation/twitter-researcher.js';

const BATCH_DIR = path.join(os.homedir(), 'Documents/twitter-research/batches');
const TOPIC_DELAY_MS = 3000;
const TOP_TWEETS_PER_TOPIC = 20;
const TOP_ACCOUNTS_PER_TOPIC = 5;

const SEARCH_CONFIG = {
  tweetsPerNiche: 50,
  scrollPauseMs: 1000,
  maxScrollsPerSearch: 10,
  searchTab: 'top',
};

function getTodayDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Run TwitterResearcher for a single topic.
 * Returns { name, tweets, topAccounts } or null on failure.
 */
async function researchTopic(researcher, topicName) {
  try {
    console.log(`[SearchRunner] Topic: "${topicName}"`);
    const result = await researcher.researchNiche(topicName);

    // Top tweets by engagement (likes + retweets + replies)
    const topTweets = (result.tweets || [])
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, TOP_TWEETS_PER_TOPIC);

    // Top accounts by total engagement
    const topAccounts = (result.creators || [])
      .sort((a, b) => (b.totalEngagement || 0) - (a.totalEngagement || 0))
      .slice(0, TOP_ACCOUNTS_PER_TOPIC)
      .map(c => ({
        handle: c.handle,
        displayName: c.displayName,
        totalEngagement: c.totalEngagement,
        tweetCount: c.tweetCount,
        topTweetUrl: c.topTweetUrl,
      }));

    console.log(`[SearchRunner] "${topicName}": ${topTweets.length} tweets, ${topAccounts.length} accounts`);
    return { name: topicName, tweets: topTweets, topAccounts };
  } catch (err) {
    console.warn(`[SearchRunner] Warning: topic "${topicName}" failed: ${err.message} — skipping`);
    return null;
  }
}

/**
 * Run TwitterResearcher sequentially across all topics.
 * Returns ResearchBatch object.
 */
export async function runMultiTopicSearch(topics) {
  ensureDir(BATCH_DIR);

  const researcher = new TwitterResearcher(SEARCH_CONFIG);
  const seenUrls = new Set();
  const topicResults = [];
  let totalTweets = 0;

  console.log(`[SearchRunner] Starting sequential search for ${topics.length} topics`);

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    console.log(`\n[SearchRunner] [${i + 1}/${topics.length}] "${topic}"`);

    const result = await researchTopic(researcher, topic);

    if (result) {
      // Deduplicate tweets by URL across topics
      const uniqueTweets = result.tweets.filter(t => {
        if (!t.url || seenUrls.has(t.url)) return false;
        seenUrls.add(t.url);
        return true;
      });
      result.tweets = uniqueTweets;
      topicResults.push(result);
      totalTweets += uniqueTweets.length;
    }

    // Delay between topics (except after last)
    if (i < topics.length - 1) {
      console.log(`[SearchRunner] Waiting ${TOPIC_DELAY_MS / 1000}s before next topic...`);
      await new Promise(r => setTimeout(r, TOPIC_DELAY_MS));
    }
  }

  const batch = {
    topics: topicResults,
    totalTweets,
    collectedAt: new Date().toISOString(),
  };

  // Save raw batch to file
  const dateStr = getTodayDate();
  const batchPath = path.join(BATCH_DIR, `${dateStr}.json`);
  fs.writeFileSync(batchPath, JSON.stringify(batch, null, 2));
  console.log(`\n[SearchRunner] Batch saved: ${batchPath}`);
  console.log(`[SearchRunner] Total: ${topicResults.length} topics, ${totalTweets} unique tweets`);

  return { batch, batchPath };
}
