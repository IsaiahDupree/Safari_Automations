/**
 * ICP Prospect Discovery — find and score candidate usernames for DM outreach.
 *
 * Sources:
 *   - hashtag: POST :3005/api/instagram/search/keyword?comment=false → extract post authors
 *   - followers: GET :3005/api/instagram/activity/followers → recent new followers
 *
 * Features:
 *   - targetCount: keeps running keyword rounds until it collects enough candidates
 *   - niches: per-niche quotas (e.g. { buildinpublic: 5, saasfounder: 3 })
 *   - maxRounds: caps how many keyword expansion rounds to run (default 3)
 *   - dryRun: returns empty immediately — no Safari navigation
 */

import { enrichContact } from '../automation/index.js';
import type { SafariDriver } from '../automation/index.js';

const COMMENTS_BASE = 'http://localhost:3005';
const CRM_BASE = 'https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app';
const MAX_ENRICH = 30; // hard cap to protect Safari rate limits

export const ICP_KEYWORDS = [
  'automation', 'ai', 'saas', 'founder', 'software', 'agency',
  'build', 'mrr', 'arr', 'startup', 'creator', 'solopreneur',
  'scaling', 'product', 'engineer', 'developer', 'indie hacker',
  'buildinpublic', 'indiehacker', 'content strategy',
];

// Extended keyword pool for continuation rounds when first pass yields too few candidates
export const EXPANSION_KEYWORDS = [
  'indiedev', 'bootstrapped', 'microSaaS', 'growthHacking', 'productHunt',
  'nocode', 'lowcode', 'contentcreator', 'digitalmarketing', 'growthhack',
  'makerlog', 'wip', 'indiehackers', 'sideproject', 'techfounder',
  'solofounder', 'b2b', 'revenue',
];

export function parseFollowerCount(str: string): number {
  if (!str) return 0;
  const s = str.replace(/,/g, '').trim();
  const m = s.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  return Math.round(n);
}

interface Profile {
  fullName: string;
  bio: string;
  followers: string;
  following: string;
  posts: string;
  isPrivate: boolean;
}

export function scoreICP(profile: Profile, _source: string): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  const bioLower = (profile.bio || '').toLowerCase();
  const followers = parseFollowerCount(profile.followers);

  // Bio keyword matches: up to 30pts (10 per keyword)
  const matched = ICP_KEYWORDS.filter(k => bioLower.includes(k));
  if (matched.length > 0) {
    score += Math.min(matched.length * 10, 30);
    signals.push(...matched.map(k => `bio:${k}`));
  }

  // Revenue signals in bio: +15
  if (/mrr|arr|revenue|\$[0-9]/.test(bioLower)) {
    score += 15;
    signals.push('revenue_signal');
  }

  // Follower sweet spot 1K-100K: +20
  if (followers >= 1_000 && followers <= 100_000) {
    score += 20;
    signals.push('follower_range:1K-100K');
  } else if (followers > 100 && followers < 1_000) {
    score += 8;
  }

  // Not private: +15
  if (!profile.isPrivate) {
    score += 15;
    signals.push('public_account');
  }

  // Active (>5 posts): +10
  if (parseInt(profile.posts || '0', 10) > 5) {
    score += 10;
    signals.push('active_account');
  }

  // Following/follower ratio < 5 (not spam): +10
  const following = parseFollowerCount(profile.following);
  if (followers > 0 && following / followers < 5) {
    score += 10;
    signals.push('good_ratio');
  }

  return { score: Math.min(score, 100), signals };
}

export interface DiscoverParams {
  sources?: string[];
  keywords?: string[];
  maxCandidates?: number;
  /** Target number of above-threshold candidates to collect. Overrides maxCandidates.
   *  discoverProspects will run multiple keyword rounds until this count is reached. */
  targetCount?: number;
  minScore?: number;
  checkCRM?: boolean;
  dryRun?: boolean;
  /** Max number of keyword expansion rounds (default 3). Set to 1 to disable expansion. */
  maxRounds?: number;
  /** Per-niche quota map. e.g. { buildinpublic: 5, saasfounder: 3 }.
   *  Stops collecting a niche once its quota is reached. */
  niches?: Record<string, number>;
  /** Instagram accounts whose followers to scrape as high-quality ICP candidates.
   *  e.g. ["levelsio", "marc_louvion", "tdinh_me"]. Queried once on round 1.
   *  Automatically adds "top_accounts" to sources when provided. */
  topAccounts?: string[];
  /** Keywords to use for top-post creator discovery.
   *  Navigates to hashtag pages → finds top posts → ranks creators by engagement →
   *  then fetches those creators' followers as prospects (source: top_post_authors).
   *  Automatically adds "top_post_authors" to sources when provided. */
  topPostKeywords?: string[];
  /** Max posts to visit per keyword when discovering top post creators (default 6). */
  maxPostsPerKeyword?: number;
  /** How many top-ranked creators to scrape followers from (default 5). */
  maxTopCreators?: number;
  /** How many times to scroll the followers modal per account (default 20, ~300-400 followers).
   *  More scrolls = deeper into the list = fresh results on repeated calls. */
  followerScrollCount?: number;
  /** Your own Instagram username. Required to use sources: ['search'].
   *  Navigates to your profile, visits recent posts, extracts commenters as high-intent prospects. */
  selfUsername?: string;
  /** Max own posts to visit when scraping commenters (default 5). */
  maxPostsToSearch?: number;
  /** Max commenters to collect per post (default 30). */
  maxCommentsPerPost?: number;
}

export interface ProspectCandidate {
  username: string;
  fullName: string;
  bio: string;
  followers: string;
  following: string;
  posts: string;
  isPrivate: boolean;
  icpScore: number;
  icpSignals: string[];
  alreadyInCRM: boolean;
  source: string;
  /** Composite priority: icpScore + source bonus. Used as `priority` column in suggested_actions. */
  priority: number;
  /** Which keyword/niche led to discovery */
  discoveryKeyword?: string;
  /** Cross-platform account links (same username on other platforms) */
  linkedAccounts?: { threads?: string; twitter?: string };
}

/**
 * Source priority bonuses added on top of icpScore when storing to suggested_actions.
 * Higher bonus = float to top of DM queue.
 *
 * Priority tiers:
 *   top_accounts      +40  — followers of top niche creators (highest intent signal)
 *   top_post_authors  +35  — followers of creators who post top-ranked hashtag content
 *   post_comments     +20  — people who comment on top posts (future source)
 *   hashtag           +10  — hashtag explore pages (broad, lower intent)
 *   followers           0  — your own new followers (separate repurpose list)
 */
export const SOURCE_PRIORITY_BONUS: Record<string, number> = {
  top_accounts: 40,
  top_post_authors: 35,
  search: 30,       // own post commenters — already engaged with your content
  post_comments: 20,
  hashtag: 10,
  followers: 0,
};

// Profile links to block when extracting usernames from explore pages
const IG_BLOCKED_PATHS = new Set([
  'explore', 'accounts', 'about', 'privacy', 'terms', 'help',
  'reels', 'stories', 'direct', 'p', 'reel', 'tv', 'nametag',
]);

export interface TopPostCreator {
  username: string;
  keyword: string;
  totalEngagement: number;
  postsFound: number;
  rank: number;
}

export interface TopPost {
  postPath: string;
  author: string;
  keyword: string;
  likes: number;
  comments: number;
  engagementScore: number;
}

/**
 * Navigate to hashtag explore pages, extract the top posts, visit each post
 * to get the author (from URL redirect) and engagement metrics, then rank
 * creators by total post engagement across keywords.
 *
 * This feeds into fetchTopAccountFollowers — the creators become topAccounts
 * whose followers are the actual prospects.
 */
export async function fetchTopPostCreators(
  keywords: string[],
  driver: SafariDriver,
  maxPostsPerKeyword = 6,
): Promise<{ posts: TopPost[]; creators: TopPostCreator[] }> {
  const allPosts: TopPost[] = [];
  const creatorEngagement: Record<string, { total: number; posts: number; keyword: string }> = {};

  for (const kw of keywords) {
    try {
      const tag = kw.replace(/^#/, '');
      const ok = await driver.navigateTo(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`);
      if (!ok) continue;
      await new Promise(r => setTimeout(r, 4_000));

      // Scroll twice to ensure top posts are rendered
      for (let s = 0; s < 2; s++) {
        try { await driver.executeJS('window.scrollTo(0, document.body.scrollHeight)'); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1_200));
      }

      // Extract post shortcodes from /p/POSTID/ and /reel/POSTID/ links
      const postPathsRaw = await driver.executeJS(`(function(){
        var seen = {};
        var paths = [];
        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          var m = href.match(/^\\/(p|reel)\\/([A-Za-z0-9_-]+)\\/?$/);
          if (m && !seen[m[2]]) {
            seen[m[2]] = 1;
            paths.push('/' + m[1] + '/' + m[2] + '/');
          }
        }
        return JSON.stringify(paths.slice(0, ${maxPostsPerKeyword}));
      })()`);

      const postPaths: string[] = JSON.parse(postPathsRaw || '[]');

      for (const postPath of postPaths) {
        try {
          const postOk = await driver.navigateTo(`https://www.instagram.com${postPath}`);
          if (!postOk) continue;
          await new Promise(r => setTimeout(r, 2_500));

          // Author from URL redirect: instagram.com/{username}/p/{postid}/
          const currentUrl = await driver.executeJS('window.location.href') as string;
          const urlMatch = (currentUrl || '').match(/instagram\.com\/([a-zA-Z0-9_.]+)\/(p|reel)\//);
          if (!urlMatch) continue;
          const author = urlMatch[1];

          // Try to extract engagement from page text
          const metricsRaw = await driver.executeJS(`(function(){
            var text = document.body.innerText || '';
            var likes = 0;
            var m = text.match(/([0-9][0-9,.]*)\\s*likes?/i);
            if (m) likes = parseInt(m[1].replace(/[^0-9]/g, ''), 10) || 0;
            var comments = document.querySelectorAll('ul ul li').length;
            return JSON.stringify({ likes: likes, comments: comments });
          })()`);
          const metrics = JSON.parse(metricsRaw || '{"likes":0,"comments":0}') as { likes: number; comments: number };
          const engagementScore = metrics.likes + metrics.comments * 5;

          allPosts.push({ postPath, author, keyword: kw, likes: metrics.likes, comments: metrics.comments, engagementScore });

          if (!creatorEngagement[author]) creatorEngagement[author] = { total: 0, posts: 0, keyword: kw };
          creatorEngagement[author].total += engagementScore;
          creatorEngagement[author].posts++;
        } catch {
          // skip failed post
        }
        await new Promise(r => setTimeout(r, 800));
      }
    } catch {
      // skip failed keyword
    }
  }

  allPosts.sort((a, b) => b.engagementScore - a.engagementScore);

  const creators: TopPostCreator[] = Object.entries(creatorEngagement)
    .map(([username, data]) => ({ username, keyword: data.keyword, totalEngagement: data.total, postsFound: data.posts, rank: 0 }))
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return { posts: allPosts, creators };
}

/**
 * Navigate to Instagram hashtag explore pages and extract post authors.
 * Uses the driver directly (more reliable than :3005 search which just scrolls feed).
 * Falls back to :3005 HTTP if no driver provided.
 */
async function fetchHashtagCandidates(
  keywords: string[],
  driver?: SafariDriver,
): Promise<{ username: string; source: string; keyword: string }[]> {
  if (driver) {
    return fetchHashtagCandidatesDirect(keywords, driver);
  }
  return fetchHashtagCandidatesViaHttp(keywords);
}

async function fetchHashtagCandidatesDirect(
  keywords: string[],
  driver: SafariDriver,
): Promise<{ username: string; source: string; keyword: string }[]> {
  const results: { username: string; source: string; keyword: string }[] = [];

  for (const kw of keywords) {
    try {
      const tag = kw.replace(/^#/, '');
      const ok = await driver.navigateTo(`https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`);
      if (!ok) continue;
      await new Promise(r => setTimeout(r, 4_000));

      // Scroll 3 times to load more posts before extracting profiles
      for (let s = 0; s < 3; s++) {
        try { await driver.executeJS('window.scrollTo(0, document.body.scrollHeight)'); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 1_500));
      }

      const raw = await driver.executeJS(`(function(){
        var seen = {};
        var usernames = [];
        var blocked = ${JSON.stringify([...IG_BLOCKED_PATHS])};
        var links = document.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          var href = (links[i].getAttribute('href') || '').replace(/\\/+$/, '');
          var m = href.match(/^\\/([a-zA-Z0-9_.]+)$/);
          if (m && m[1].length >= 2 && m[1].length <= 30 && blocked.indexOf(m[1].toLowerCase()) < 0) {
            if (!seen[m[1].toLowerCase()]) {
              seen[m[1].toLowerCase()] = 1;
              usernames.push(m[1]);
            }
          }
        }
        return JSON.stringify(usernames.slice(0, 60));
      })()`);

      const parsed: string[] = JSON.parse(raw || '[]');
      for (const u of parsed) {
        results.push({ username: u, source: 'hashtag', keyword: kw });
      }
    } catch {
      // skip failed keyword
    }
  }
  return results;
}

async function fetchHashtagCandidatesViaHttp(
  keywords: string[],
): Promise<{ username: string; source: string; keyword: string }[]> {
  const results: { username: string; source: string; keyword: string }[] = [];
  for (const kw of keywords) {
    try {
      const res = await fetch(`${COMMENTS_BASE}/api/instagram/search/keyword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token' },
        body: JSON.stringify({ keyword: kw, comment: false, count: 10 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        authors?: string[];
        usernames?: string[];
        posts?: { username?: string; author?: string }[];
      };
      const usernames: string[] =
        data.authors ||
        data.usernames ||
        (data.posts || []).map(p => p.username || p.author).filter((u): u is string => !!u);
      for (const u of usernames) {
        if (u) results.push({ username: u.replace('@', ''), source: 'hashtag', keyword: kw });
      }
    } catch {
      // skip failed keyword
    }
  }
  return results;
}

async function fetchFollowerCandidates(): Promise<{ username: string; source: string; keyword: string }[]> {
  try {
    const res = await fetch(`${COMMENTS_BASE}/api/instagram/activity/followers`, {
      headers: { 'Authorization': 'Bearer test-token' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      success?: boolean;
      followers?: string[];
      usernames?: string[];
      accounts?: { username?: string }[];
      events?: { username?: string; text?: string }[];
      count?: number;
    };
    if (data.success === false) return [];
    const usernames: string[] =
      data.followers ||
      data.usernames ||
      (data.events || data.accounts || []).map(a => a.username).filter((u): u is string => !!u);
    return usernames.map(u => ({ username: u.replace('@', ''), source: 'followers', keyword: 'followers' }));
  } catch {
    return [];
  }
}

/**
 * Navigate to a top niche account's profile, open the followers modal,
 * scroll to load more, and extract follower usernames.
 * Higher-quality signal than hashtag explore — pre-filtered by niche interest.
 */
async function fetchTopAccountFollowers(
  accounts: string[],
  driver: SafariDriver,
  scrollCount = 20,
): Promise<{ username: string; source: string; keyword: string }[]> {
  const results: { username: string; source: string; keyword: string }[] = [];
  // Each scroll loads ~15-20 new followers. Cap at scrollCount × 25 to avoid memory issues.
  const maxExtract = scrollCount * 25;

  for (const account of accounts) {
    try {
      const ok = await driver.navigateTo(`https://www.instagram.com/${encodeURIComponent(account)}/`);
      if (!ok) continue;
      await new Promise(r => setTimeout(r, 3_000));

      // Click the followers count link to open the followers modal
      const clickResult = await driver.executeJS(`(function(){
        var links = document.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          if (href.match(/\\/followers\\/?$/)) { links[i].click(); return 'clicked'; }
        }
        return 'not_found';
      })()`);

      if (clickResult === 'not_found') {
        // Private or blocked account — skip
        continue;
      }

      await new Promise(r => setTimeout(r, 2_000));

      // Scroll the followers modal to load more entries.
      // Each scroll reveals ~15-20 new followers. More scrolls = deeper into list = fresh results.
      for (let s = 0; s < scrollCount; s++) {
        await driver.executeJS(`(function(){
          var modal = document.querySelector('div[role="dialog"]');
          if (modal) {
            var scrollable = modal.querySelector('div[style*="overflow"]') || modal;
            scrollable.scrollTop += 800;
          }
        })()`);
        await new Promise(r => setTimeout(r, 800));
      }

      // Extract all visible usernames from within the followers modal
      const raw = await driver.executeJS(`(function(){
        var modal = document.querySelector('div[role="dialog"]');
        var container = modal || document;
        var seen = {};
        var usernames = [];
        var blocked = ${JSON.stringify([...IG_BLOCKED_PATHS])};
        var links = container.querySelectorAll('a[href]');
        for (var i = 0; i < links.length; i++) {
          var href = (links[i].getAttribute('href') || '').replace(/\\/+$/, '');
          var m = href.match(/^\\/([a-zA-Z0-9_.]+)$/);
          if (m && m[1].length >= 2 && m[1].length <= 30 && blocked.indexOf(m[1].toLowerCase()) < 0) {
            if (!seen[m[1].toLowerCase()]) {
              seen[m[1].toLowerCase()] = 1;
              usernames.push(m[1]);
            }
          }
        }
        return JSON.stringify(usernames.slice(0, ${maxExtract}));
      })()`);

      const parsed: string[] = JSON.parse(raw || '[]');
      const accountLower = account.toLowerCase();
      for (const u of parsed) {
        if (u.toLowerCase() !== accountLower) {
          results.push({ username: u, source: 'top_accounts', keyword: account });
        }
      }
    } catch {
      // skip failed account
    }
  }

  return results;
}

/**
 * Navigate to your own profile, collect recent posts, and extract commenter usernames.
 * Commenters are the highest-intent signal — they already engaged with your content.
 * Source: 'search' (own content engagement).
 */
async function fetchSelfPostCommenters(
  selfUsername: string,
  driver: SafariDriver,
  maxPosts = 5,
  maxCommentsPerPost = 30,
): Promise<{ username: string; source: string; keyword: string }[]> {
  const results: { username: string; source: string; keyword: string }[] = [];
  try {
    const ok = await driver.navigateTo(`https://www.instagram.com/${encodeURIComponent(selfUsername)}/`);
    if (!ok) return [];
    await new Promise(r => setTimeout(r, 3_000));

    // Collect post/reel paths from the profile grid
    const postPathsRaw = await driver.executeJS(`(function(){
      var seen = {};
      var paths = [];
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        var m = href.match(/^\\/(p|reel)\\/([A-Za-z0-9_-]+)\\/?$/);
        if (m && !seen[m[2]]) {
          seen[m[2]] = 1;
          paths.push('/' + m[1] + '/' + m[2] + '/');
        }
      }
      return JSON.stringify(paths.slice(0, ${maxPosts}));
    })()`);

    const postPaths: string[] = JSON.parse(postPathsRaw || '[]');

    for (const postPath of postPaths) {
      try {
        const postOk = await driver.navigateTo(`https://www.instagram.com${postPath}`);
        if (!postOk) continue;
        await new Promise(r => setTimeout(r, 2_500));

        // Comment authors appear as /{username} links within the post comment section
        const commentersRaw = await driver.executeJS(`(function(){
          var seen = {};
          var usernames = [];
          var blocked = ${JSON.stringify([...IG_BLOCKED_PATHS])};
          var links = document.querySelectorAll('a[href]');
          for (var i = 0; i < links.length; i++) {
            var href = (links[i].getAttribute('href') || '').replace(/\\/+$/, '');
            var m = href.match(/^\\/([a-zA-Z0-9_.]+)$/);
            if (m && m[1].length >= 2 && m[1].length <= 30 && blocked.indexOf(m[1].toLowerCase()) < 0) {
              if (!seen[m[1].toLowerCase()]) {
                seen[m[1].toLowerCase()] = 1;
                usernames.push(m[1]);
              }
            }
          }
          return JSON.stringify(usernames.slice(0, ${maxCommentsPerPost}));
        })()`);

        const commenters: string[] = JSON.parse(commentersRaw || '[]');
        const selfLower = selfUsername.toLowerCase();
        for (const u of commenters) {
          if (u.toLowerCase() !== selfLower) {
            results.push({ username: u, source: 'search', keyword: postPath });
          }
        }
      } catch {
        // skip failed post
      }
      await new Promise(r => setTimeout(r, 800));
    }
  } catch {
    // skip
  }
  return results;
}

async function isInCRM(username: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${CRM_BASE}/api/contacts/by-username/instagram/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

const THREADS_BASE = 'http://localhost:3004';

/** Check if a Threads profile exists for the same username (Instagram+Threads share usernames). */
async function checkThreadsLink(username: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${THREADS_BASE}/api/threads/profile/${encodeURIComponent(username)}`,
      { headers: { Authorization: 'Bearer threads-local-dev-token' }, signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) return username;
  } catch {
    // service down or profile not found
  }
  return undefined;
}

/** Track how many candidates have been collected per niche keyword */
function countNicheHits(
  candidates: ProspectCandidate[],
  niches: Record<string, number>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const niche of Object.keys(niches)) {
    counts[niche] = candidates.filter(c =>
      c.discoveryKeyword === niche ||
      (c.icpSignals || []).some(s => s.includes(niche)),
    ).length;
  }
  return counts;
}

export async function discoverProspects(
  params: DiscoverParams,
  driver?: SafariDriver,
): Promise<{
  candidates: ProspectCandidate[];
  total: number;
  sourcesQueried: string[];
  enrichedCount: number;
  skippedLowScore: number;
  rounds: number;
  rawFound: number;
}> {
  const sources = params.sources ?? ((): string[] => {
    const s = ['hashtag', 'followers'];
    if (params.topAccounts && params.topAccounts.length > 0) s.push('top_accounts');
    if (params.topPostKeywords && params.topPostKeywords.length > 0) s.push('top_post_authors');
    if (params.selfUsername) s.push('search');
    return s;
  })();
  const baseKeywords = params.keywords ?? ['buildinpublic', 'saasfounder', 'aiautomation'];
  const targetCount = params.targetCount ?? params.maxCandidates ?? 15;
  const maxToEnrich = Math.min(targetCount * 3, MAX_ENRICH); // enrich more to account for score filtering
  const minScore = params.minScore ?? 30;
  const checkCRM = params.checkCRM !== false;
  const maxRounds = params.maxRounds ?? 3;
  const niches = params.niches ?? {};

  if (params.dryRun) {
    return { candidates: [], total: 0, sourcesQueried: sources, enrichedCount: 0, skippedLowScore: 0, rounds: 0, rawFound: 0 };
  }

  const allSeen = new Set<string>();
  const candidates: ProspectCandidate[] = [];
  let enrichedCount = 0;
  let skippedLowScore = 0;
  let rawFound = 0;
  const usedKeywords: string[] = [...baseKeywords];
  let round = 0;

  // Build expansion pool (exclude keywords already in base set)
  const expansionPool = EXPANSION_KEYWORDS.filter(k => !usedKeywords.includes(k));

  while (round < maxRounds) {
    round++;

    // Check niche quotas — stop if all niches have reached their quota
    if (Object.keys(niches).length > 0) {
      const nicheCounts = countNicheHits(candidates, niches);
      const allQuotasMet = Object.entries(niches).every(([niche, quota]) =>
        (nicheCounts[niche] ?? 0) >= quota,
      );
      if (allQuotasMet) break;
    }

    // Check overall target
    if (candidates.length >= targetCount) break;

    // Determine keywords for this round
    const roundKeywords = round === 1
      ? usedKeywords
      : expansionPool.splice(0, 5); // take 5 new keywords each expansion round

    if (round > 1 && roundKeywords.length === 0) break; // no more keywords to try

    // Gather raw candidates from all sources
    const raw: { username: string; source: string; keyword: string }[] = [];
    if (sources.includes('hashtag') || sources.includes('search')) {
      raw.push(...await fetchHashtagCandidates(roundKeywords, driver));
    }
    if (sources.includes('followers') && round === 1) {
      // Only query followers once (activity feed is time-based, not keyword-based)
      raw.push(...await fetchFollowerCandidates());
    }
    if (sources.includes('top_accounts') && params.topAccounts && params.topAccounts.length > 0 && driver && round === 1) {
      // Only query top account followers once (same set each call)
      raw.push(...await fetchTopAccountFollowers(params.topAccounts, driver, params.followerScrollCount ?? 20));
    }
    if (sources.includes('top_post_authors') && params.topPostKeywords && params.topPostKeywords.length > 0 && driver && round === 1) {
      // Find top post creators by engagement, then scrape their followers
      const maxCreators = params.maxTopCreators ?? 5;
      const { creators } = await fetchTopPostCreators(params.topPostKeywords, driver, params.maxPostsPerKeyword ?? 6);
      const topCreatorUsernames = creators.slice(0, maxCreators).map(c => c.username);
      if (topCreatorUsernames.length > 0) {
        const followerBatch = await fetchTopAccountFollowers(topCreatorUsernames, driver, params.followerScrollCount ?? 20);
        // Tag with top_post_authors source so priority bonus is applied
        raw.push(...followerBatch.map(r => ({ ...r, source: 'top_post_authors' })));
      }
    }
    if (sources.includes('search') && params.selfUsername && driver && round === 1) {
      // Commenters on your own posts — highest-intent signal (they already engaged with you)
      raw.push(...await fetchSelfPostCommenters(
        params.selfUsername,
        driver,
        params.maxPostsToSearch ?? 5,
        params.maxCommentsPerPost ?? 30,
      ));
    }

    // Deduplicate globally
    const newCandidates = raw.filter(c => {
      if (!c.username || allSeen.has(c.username.toLowerCase())) return false;
      allSeen.add(c.username.toLowerCase());
      return true;
    });
    rawFound += newCandidates.length;

    if (newCandidates.length === 0 && round > 1) {
      // No new raw candidates from expansion round — try one more or stop
      if (expansionPool.length === 0) break;
      continue;
    }

    // Enrich and score new candidates
    const toEnrich = newCandidates.slice(0, maxToEnrich - enrichedCount);
    for (const raw of toEnrich) {
      if (candidates.length >= targetCount) break;
      try {
        const profile = await enrichContact(raw.username, driver);
        enrichedCount++;
        const { score, signals } = scoreICP(profile, raw.source);
        if (score < minScore) {
          skippedLowScore++;
          continue;
        }
        const alreadyInCRM = checkCRM ? await isInCRM(raw.username) : false;
        const threadsUsername = await checkThreadsLink(raw.username);
        const sourceBonus = SOURCE_PRIORITY_BONUS[raw.source] ?? 10;
        candidates.push({
          username: raw.username,
          fullName: profile.fullName,
          bio: profile.bio,
          followers: profile.followers,
          following: profile.following,
          posts: profile.posts,
          isPrivate: profile.isPrivate,
          icpScore: score,
          icpSignals: signals,
          alreadyInCRM,
          source: raw.source,
          priority: Math.min(score + sourceBonus, 140), // 100 max ICP + 40 max bonus
          discoveryKeyword: raw.keyword,
          linkedAccounts: threadsUsername ? { threads: threadsUsername } : undefined,
        });
      } catch {
        // skip failed enrichments
      }
    }

    // If no candidates at all from round 1 and both sources tried, expand immediately
    if (round === 1 && candidates.length === 0 && enrichedCount === 0) {
      // Sources returned no raw candidates — continue to expansion round
      continue;
    }
  }

  candidates.sort((a, b) => b.icpScore - a.icpScore);

  return {
    candidates,
    total: candidates.length,
    sourcesQueried: sources,
    enrichedCount,
    skippedLowScore,
    rounds: round,
    rawFound,
  };
}
