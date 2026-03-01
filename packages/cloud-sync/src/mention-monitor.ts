/**
 * Brand Mention Monitor
 * Searches for @mentions of known handles across platforms using existing
 * comment service search endpoints. Persists new mentions to brand_mentions table.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Platform } from './types';

// Handles to monitor per platform
const MONITORED_HANDLES: Record<string, string[]> = {
  twitter: ['IsaiahDupree7', 'isaiah_dupree'],
  instagram: ['the_isaiah_dupree'],
  tiktok: ['isaiahdupree', 'isaiah_dupree'],
  threads: ['the_isaiah_dupree'],
};

// All handles flattened + lowercased for cross-platform self-detection
const ALL_OWN_HANDLES = new Set(
  Object.values(MONITORED_HANDLES).flat().map(h => h.toLowerCase())
);

// Comment service ports per platform
const COMMENT_PORTS: Record<string, number> = {
  twitter: 3007,
  instagram: 3005,
  tiktok: 3006,
  threads: 3004,
};

export interface BrandMention {
  platform: string;
  mention_type: string;
  source_url?: string;
  source_post_id?: string;
  author_username: string;
  author_display_name?: string;
  mention_text: string;
  mentioned_handle: string;
  sentiment?: string;
  raw_data?: any;
}

/**
 * Search for brand mentions on a single platform using its comment service.
 * Uses the existing search/timeline endpoints to find posts mentioning our handles.
 */
async function searchPlatformMentions(platform: string): Promise<BrandMention[]> {
  const mentions: BrandMention[] = [];
  const port = COMMENT_PORTS[platform];
  const handles = MONITORED_HANDLES[platform];
  if (!port || !handles?.length) return mentions;

  for (const handle of handles) {
    try {
      let searchUrl = '';
      switch (platform) {
        case 'twitter':
          // Search for @mentions of our handle (not our own timeline)
          searchUrl = `http://localhost:${port}/api/twitter/search?query=%40${handle}`;
          break;
        case 'tiktok':
          // Search for mentions via search-cards
          searchUrl = `http://localhost:${port}/api/tiktok/search-cards?query=%40${handle}`;
          break;
        case 'instagram':
          // IG doesn't have a mention search — skip for now
          continue;
        case 'threads':
          // Threads doesn't have a mention search — skip for now
          continue;
      }

      if (!searchUrl) continue;

      const res = await fetch(searchUrl, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const data = await res.json() as any;

      // Extract mentions from search results
      const posts = data.posts || data.tweets || data.cards || data.results || [];
      for (const post of posts) {
        const text = post.text || post.content || post.caption || post.desc || '';
        const author = post.author || post.username || post.user || '';

        // Skip own posts (cross-platform check)
        if (ALL_OWN_HANDLES.has(author.toLowerCase())) continue;

        // Minimum text quality: at least 5 chars, 3 letters
        if (text.length < 5 || text.replace(/[^a-zA-Z]/g, '').length < 3) continue;

        // Check if text mentions any of our handles with @ prefix (strict match)
        const textLower = text.toLowerCase();
        const mentionedHandle = handles.find(h => {
          const atHandle = `@${h.toLowerCase()}`;
          const idx = textLower.indexOf(atHandle);
          if (idx < 0) return false;
          // Word-boundary check: next char after @handle must be non-alphanumeric or end
          const after = idx + atHandle.length;
          if (after < textLower.length && /[a-z0-9_]/.test(textLower[after])) return false;
          return true;
        });

        if (mentionedHandle && author && text) {
          mentions.push({
            platform,
            mention_type: post.type || 'post',
            source_url: post.url || post.href || undefined,
            source_post_id: post.id || post.videoId || post.tweetId || undefined,
            author_username: author,
            author_display_name: post.displayName || post.name || undefined,
            mention_text: text.substring(0, 2000),
            mentioned_handle: mentionedHandle,
            raw_data: post,
          });
        }
      }
    } catch (e) {
      console.error(`[MentionMonitor] ${platform}/@${handle} search error:`, (e as Error).message);
    }
  }

  return mentions;
}

/**
 * Also scan existing platform_comments for mentions of our handles.
 * This catches mentions that were already collected via comment polling.
 */
async function scanCommentsForMentions(client: SupabaseClient): Promise<BrandMention[]> {
  const mentions: BrandMention[] = [];
  const allHandles = Object.values(MONITORED_HANDLES).flat();

  // Build OR condition for ILIKE search
  const conditions = allHandles.map(h => `comment_text.ilike.%@${h}%`);

  const { data: comments } = await client
    .from('platform_comments')
    .select('platform, post_id, post_url, username, comment_text, synced_at')
    .or(conditions.join(','))
    .order('synced_at', { ascending: false })
    .limit(50);

  if (!comments) return mentions;

  for (const c of comments) {
    // Skip own comments (cross-platform check)
    if (ALL_OWN_HANDLES.has(c.username?.toLowerCase())) continue;

    // Strict @handle word-boundary match
    const textLower = c.comment_text.toLowerCase();
    const mentionedHandle = allHandles.find(h => {
      const atHandle = `@${h.toLowerCase()}`;
      const idx = textLower.indexOf(atHandle);
      if (idx < 0) return false;
      const after = idx + atHandle.length;
      if (after < textLower.length && /[a-z0-9_]/.test(textLower[after])) return false;
      return true;
    });

    if (mentionedHandle) {
      mentions.push({
        platform: c.platform,
        mention_type: 'comment',
        source_url: c.post_url,
        source_post_id: c.post_id,
        author_username: c.username,
        mention_text: c.comment_text.substring(0, 2000),
        mentioned_handle: mentionedHandle,
      });
    }
  }

  return mentions;
}

/**
 * Simple text hash for dedup
 */
function textHash(text: string): string {
  let hash = 0;
  const s = text.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 80);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Run full mention monitoring: search across platforms + scan existing comments.
 * Deduplicates and persists new mentions.
 */
export async function runMentionMonitor(client: SupabaseClient, platforms?: Platform[]): Promise<{
  scanned: number;
  newMentions: number;
}> {
  const allMentions: BrandMention[] = [];

  // Search each platform's service
  const targetPlatforms = platforms || Object.keys(COMMENT_PORTS);
  for (const platform of targetPlatforms) {
    const found = await searchPlatformMentions(platform);
    allMentions.push(...found);
  }

  // Also scan existing comments in DB
  const commentMentions = await scanCommentsForMentions(client);
  allMentions.push(...commentMentions);

  if (!allMentions.length) {
    return { scanned: targetPlatforms.length, newMentions: 0 };
  }

  console.log(`[MentionMonitor] Found ${allMentions.length} potential mentions`);

  let persisted = 0;
  for (const m of allMentions) {
    const dedupKey = `${m.platform}:${m.author_username}:${textHash(m.mention_text)}`;

    const { error } = await client
      .from('brand_mentions')
      .upsert({
        ...m,
        dedup_key: dedupKey,
      }, { onConflict: 'dedup_key', ignoreDuplicates: true });

    if (!error) persisted++;
  }

  if (persisted > 0) {
    console.log(`[MentionMonitor] Persisted ${persisted} new mentions`);
  }

  return { scanned: targetPlatforms.length, newMentions: persisted };
}
