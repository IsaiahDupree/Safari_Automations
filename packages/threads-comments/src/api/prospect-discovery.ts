/**
 * ICP Prospect Discovery — find and score candidate Threads handles for engagement outreach.
 *
 * Sources:
 *   - search: POST :3004/api/threads/search → extract post authors for each keyword
 *   - trending: GET :3004/api/threads/trending → extract handles from trending topics (optional)
 *
 * Each candidate is enriched via GET :3004/api/threads/profile/:handle and scored against the ICP.
 * dryRun: true returns immediately with empty results (no Safari navigation).
 *
 * Note: Threads has no DM capability. Prospects are queued for comment engagement,
 * not direct messaging. For direct outreach, route to Instagram DM (accounts are linked).
 */

const BASE = 'http://localhost:3004';
const AUTH = 'threads-local-dev-token';
const CRM_BASE = 'https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app';
const MAX_ENRICH = 20;

export const ICP_KEYWORDS = [
  'automation', 'ai', 'saas', 'founder', 'software', 'agency',
  'build', 'mrr', 'arr', 'startup', 'creator', 'solopreneur',
  'scaling', 'product', 'engineer', 'developer', 'indie hacker',
  'buildinpublic', 'indiehacker', 'content strategy',
];

interface ThreadsProfile {
  handle: string;
  follower_count: number;
  following_count: number;
  bio: string;
  engagement_rate: number;
  avg_likes: number;
}

export function scoreICP(profile: ThreadsProfile, _source: string): { score: number; signals: string[] } {
  let score = 0;
  const signals: string[] = [];
  const bioLower = (profile.bio || '').toLowerCase();
  const followers = profile.follower_count || 0;

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

  // High engagement rate (>3%): +15 — unique to Threads (has avg_likes/engagement_rate data)
  const engRate = profile.engagement_rate || 0;
  if (engRate > 3) {
    score += 15;
    signals.push(`engagement_rate:${engRate.toFixed(1)}%`);
  }

  // Active posts (avg_likes > 10): +10
  if ((profile.avg_likes || 0) > 10) {
    score += 10;
    signals.push('active_account');
  }

  // Following/follower ratio < 5 (not spam): +10
  const following = profile.following_count || 0;
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
  minScore?: number;
  checkCRM?: boolean;
  dryRun?: boolean;
}

export interface ProspectCandidate {
  username: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  engagementRate: number;
  avgLikes: number;
  icpScore: number;
  icpSignals: string[];
  alreadyInCRM: boolean;
  source: string;
  /** Cross-platform account links (same username on other platforms) */
  linkedAccounts?: { instagram?: string; twitter?: string };
}

async function fetchSearchCandidates(keywords: string[]): Promise<{ username: string; source: string }[]> {
  const results: { username: string; source: string }[] = [];
  for (const kw of keywords) {
    try {
      const res = await fetch(`${BASE}/api/threads/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AUTH}` },
        body: JSON.stringify({ query: kw, max_results: 20 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        posts?: { author?: string; username?: string }[];
        success?: boolean;
      };
      for (const post of (data.posts || [])) {
        const u = post.author || post.username;
        if (u) results.push({ username: (u as string).replace('@', ''), source: 'search' });
      }
    } catch {
      // skip failed keyword
    }
  }
  return results;
}

async function enrichProfile(handle: string): Promise<ThreadsProfile | null> {
  try {
    const res = await fetch(`${BASE}/api/threads/profile/${encodeURIComponent(handle)}`, {
      headers: { 'Authorization': `Bearer ${AUTH}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.json() as ThreadsProfile;
  } catch {
    return null;
  }
}

async function isInCRM(username: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${CRM_BASE}/api/contacts/by-username/threads/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

const IG_DM_BASE = 'http://localhost:3100';

/** Check if an Instagram profile exists for the same username (Threads+Instagram share usernames). */
async function checkInstagramLink(username: string): Promise<string | undefined> {
  try {
    const res = await fetch(
      `${IG_DM_BASE}/api/profile/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(3_000) },
    );
    if (res.ok) return username;
  } catch {
    // service down or profile not found
  }
  return undefined;
}

export async function discoverProspects(params: DiscoverParams): Promise<{
  candidates: ProspectCandidate[];
  total: number;
  sourcesQueried: string[];
  enrichedCount: number;
  skippedLowScore: number;
}> {
  const sources = params.sources ?? ['search'];
  const keywords = params.keywords ?? ['buildinpublic', 'saasfounder', 'aiautomation'];
  const maxCandidates = Math.min(params.maxCandidates ?? 15, MAX_ENRICH);
  const minScore = params.minScore ?? 30;
  const checkCRM = params.checkCRM !== false;

  if (params.dryRun) {
    return { candidates: [], total: 0, sourcesQueried: sources, enrichedCount: 0, skippedLowScore: 0 };
  }

  const raw: { username: string; source: string }[] = [];
  if (sources.includes('search')) raw.push(...await fetchSearchCandidates(keywords));

  // Deduplicate by username
  const seen = new Set<string>();
  const unique = raw.filter(c => {
    if (seen.has(c.username)) return false;
    seen.add(c.username);
    return true;
  });

  let enrichedCount = 0;
  let skippedLowScore = 0;
  const candidates: ProspectCandidate[] = [];

  for (const candidate of unique.slice(0, maxCandidates)) {
    try {
      const profile = await enrichProfile(candidate.username);
      if (!profile) continue;
      enrichedCount++;
      const { score, signals } = scoreICP(profile, candidate.source);
      if (score < minScore) {
        skippedLowScore++;
        continue;
      }
      const alreadyInCRM = checkCRM ? await isInCRM(candidate.username) : false;
      const igUsername = await checkInstagramLink(candidate.username);
      candidates.push({
        username: candidate.username,
        bio: profile.bio,
        followerCount: profile.follower_count,
        followingCount: profile.following_count,
        engagementRate: profile.engagement_rate,
        avgLikes: profile.avg_likes,
        icpScore: score,
        icpSignals: signals,
        alreadyInCRM,
        source: candidate.source,
        linkedAccounts: igUsername ? { instagram: igUsername } : undefined,
      });
    } catch {
      // skip failed enrichments
    }
  }

  candidates.sort((a, b) => b.icpScore - a.icpScore);

  return { candidates, total: candidates.length, sourcesQueried: sources, enrichedCount, skippedLowScore };
}
