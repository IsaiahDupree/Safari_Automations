/**
 * ICP Prospect Discovery — find and score candidate Twitter handles for DM outreach.
 *
 * Sources:
 *   - search: POST :3007/api/twitter/search → extract tweet authors for each keyword
 *   - conversations: GET :3003/api/twitter/conversations/all → recent DM contacts as warm leads
 *
 * Each candidate is enriched via GET :3003/api/twitter/profile/:handle and scored against the ICP.
 * dryRun: true returns immediately with empty results (no Safari navigation).
 */

const DM_BASE = 'http://localhost:3003';
const COMMENTS_BASE = 'http://localhost:3007';
const CRM_BASE = 'https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app';
const MAX_ENRICH = 20; // hard cap to protect Safari rate limits

export const ICP_KEYWORDS = [
  'automation', 'ai', 'saas', 'founder', 'software', 'agency',
  'build', 'mrr', 'arr', 'startup', 'creator', 'solopreneur',
  'scaling', 'product', 'engineer', 'developer', 'indie hacker',
  'buildinpublic', 'indiehacker', 'content strategy',
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

interface TwitterProfile {
  handle: string;
  displayName: string;
  bio: string;
  followers: string;
  following: string;
  verified: boolean;
}

export function scoreICP(profile: TwitterProfile, _source: string): { score: number; signals: string[] } {
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

  // Verified badge: +10
  if (profile.verified) {
    score += 10;
    signals.push('verified');
  }

  // Following/follower ratio < 5 (not spam): +15
  const following = parseFollowerCount(profile.following);
  if (followers > 0 && following / followers < 5) {
    score += 15;
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
  displayName: string;
  bio: string;
  followers: string;
  following: string;
  verified: boolean;
  icpScore: number;
  icpSignals: string[];
  alreadyInCRM: boolean;
  source: string;
  /** Cross-platform account links */
  linkedAccounts?: { instagram?: string; threads?: string };
}

async function fetchSearchCandidates(keywords: string[]): Promise<{ username: string; source: string }[]> {
  const results: { username: string; source: string }[] = [];
  for (const kw of keywords) {
    try {
      const res = await fetch(`${COMMENTS_BASE}/api/twitter/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: kw, tab: 'top', maxResults: 20 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data = await res.json() as {
        results?: { author?: string; username?: string; handle?: string }[];
        tweets?: { author?: string; username?: string; handle?: string }[];
      };
      const items = data.results || data.tweets || [];
      for (const item of items) {
        const u = item.author || item.username || item.handle;
        if (u) results.push({ username: (u as string).replace('@', ''), source: 'search' });
      }
    } catch {
      // skip failed keyword
    }
  }
  return results;
}

async function fetchConversationCandidates(): Promise<{ username: string; source: string }[]> {
  try {
    const res = await fetch(`${DM_BASE}/api/twitter/conversations/all`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      conversations?: { username?: string }[];
      data?: { username?: string }[];
    } | { username?: string }[];
    const items = Array.isArray(data)
      ? data
      : (data as { conversations?: { username?: string }[]; data?: { username?: string }[] }).conversations
        || (data as { conversations?: { username?: string }[]; data?: { username?: string }[] }).data
        || [];
    return (items as { username?: string }[])
      .map(c => c.username)
      .filter((u): u is string => !!u)
      .map(u => ({ username: u.replace('@', ''), source: 'conversations' }));
  } catch {
    return [];
  }
}

async function enrichProfile(handle: string): Promise<TwitterProfile | null> {
  try {
    const res = await fetch(`${DM_BASE}/api/twitter/profile/${encodeURIComponent(handle)}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { success?: boolean; profile?: TwitterProfile } | TwitterProfile;
    return (data as { profile?: TwitterProfile }).profile || (data as TwitterProfile);
  } catch {
    return null;
  }
}

async function isInCRM(username: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${CRM_BASE}/api/contacts/by-username/twitter/${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5_000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function discoverProspects(params: DiscoverParams): Promise<{
  candidates: ProspectCandidate[];
  total: number;
  sourcesQueried: string[];
  enrichedCount: number;
  skippedLowScore: number;
}> {
  const sources = params.sources ?? ['search', 'conversations'];
  const keywords = params.keywords ?? ['buildinpublic', 'saasfounder', 'aiautomation'];
  const maxCandidates = Math.min(params.maxCandidates ?? 15, MAX_ENRICH);
  const minScore = params.minScore ?? 30;
  const checkCRM = params.checkCRM !== false;

  if (params.dryRun) {
    return { candidates: [], total: 0, sourcesQueried: sources, enrichedCount: 0, skippedLowScore: 0 };
  }

  // Gather raw candidates from all sources
  const raw: { username: string; source: string }[] = [];
  if (sources.includes('search')) raw.push(...await fetchSearchCandidates(keywords));
  if (sources.includes('conversations')) raw.push(...await fetchConversationCandidates());

  // Deduplicate by username (keep first occurrence / source)
  const seen = new Set<string>();
  const unique = raw.filter(c => {
    if (seen.has(c.username)) return false;
    seen.add(c.username);
    return true;
  });

  // Enrich, score, filter
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
      candidates.push({
        username: candidate.username,
        displayName: profile.displayName,
        bio: profile.bio,
        followers: profile.followers,
        following: profile.following,
        verified: profile.verified,
        icpScore: score,
        icpSignals: signals,
        alreadyInCRM,
        source: candidate.source,
      });
    } catch {
      // skip failed enrichments
    }
  }

  candidates.sort((a, b) => b.icpScore - a.icpScore);

  return { candidates, total: candidates.length, sourcesQueried: sources, enrichedCount, skippedLowScore };
}
