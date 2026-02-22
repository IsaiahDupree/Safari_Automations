/**
 * LinkedIn Prospecting Pipeline
 * 
 * Automated workflow: Search → Extract profiles → Score leads → Connect + DM
 * Designed for finding potential clients/customers based on offer criteria.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import { searchPeople, extractProfile, sendConnectionRequest, scoreProfile } from './connection-operations.js';
import { sendMessageToProfile } from './dm-operations.js';
import type {
  PeopleSearchConfig,
  SearchResult,
  LinkedInProfile,
  LeadScore,
  ConnectionResult,
  SendMessageResult,
} from './types.js';

// ─── Types ───────────────────────────────────────────────────

export interface ProspectingConfig {
  /** Search parameters */
  search: Partial<PeopleSearchConfig>;

  /** Lead scoring criteria */
  scoring: {
    targetTitles: string[];
    targetCompanies: string[];
    targetLocations: string[];
    minScore: number;
  };

  /** Connection request settings */
  connection: {
    sendRequest: boolean;
    noteTemplate: string;
    skipIfConnected: boolean;
    skipIfPending: boolean;
  };

  /** DM settings (only for 1st connections) */
  dm: {
    enabled: boolean;
    messageTemplate: string;
    onlyIfConnected: boolean;
  };

  /** Pipeline controls */
  maxProspects: number;
  dryRun: boolean;
  delayBetweenActions: number;
}

export interface ProspectResult {
  profile: SearchResult;
  fullProfile: LinkedInProfile | null;
  score: LeadScore | null;
  connectionResult: ConnectionResult | null;
  dmResult: SendMessageResult | null;
  skipped: boolean;
  skipReason: string;
}

export interface PipelineResult {
  id: string;
  startedAt: string;
  completedAt: string;
  config: ProspectingConfig;
  summary: {
    searched: number;
    extracted: number;
    scored: number;
    qualified: number;
    connectionsSent: number;
    messagesSent: number;
    skipped: number;
    errors: number;
  };
  prospects: ProspectResult[];
}

// ─── Template Rendering ──────────────────────────────────────

function renderTemplate(template: string, profile: SearchResult | LinkedInProfile): string {
  const firstName = (profile.name || '').split(' ')[0] || 'there';
  const headline = ('headline' in profile ? profile.headline : '') || '';
  const company = ('currentPosition' in profile && profile.currentPosition?.company)
    ? profile.currentPosition.company
    : '';
  const location = profile.location || '';

  return template
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{name\}/g, profile.name || 'there')
    .replace(/\{headline\}/g, headline)
    .replace(/\{company\}/g, company)
    .replace(/\{location\}/g, location);
}

// ─── Pipeline ────────────────────────────────────────────────

export async function runProspectingPipeline(
  config: ProspectingConfig,
  driver?: SafariDriver,
): Promise<PipelineResult> {
  const d = driver || getDefaultDriver();
  const pipelineId = `pipeline_${Date.now()}`;
  const startedAt = new Date().toISOString();

  const summary = {
    searched: 0,
    extracted: 0,
    scored: 0,
    qualified: 0,
    connectionsSent: 0,
    messagesSent: 0,
    skipped: 0,
    errors: 0,
  };

  const prospects: ProspectResult[] = [];

  console.log(`[Pipeline] Starting prospecting pipeline ${pipelineId}`);
  console.log(`[Pipeline] Search: ${JSON.stringify(config.search)}`);
  console.log(`[Pipeline] Max prospects: ${config.maxProspects}, Dry run: ${config.dryRun}`);

  // Step 1: Search for people
  console.log('[Pipeline] Step 1: Searching for people...');
  const searchResults = await searchPeople(config.search, d);
  summary.searched = searchResults.length;
  console.log(`[Pipeline] Found ${searchResults.length} search results`);

  if (searchResults.length === 0) {
    return {
      id: pipelineId,
      startedAt,
      completedAt: new Date().toISOString(),
      config,
      summary,
      prospects: [],
    };
  }

  // Step 2: Process each prospect
  const toProcess = searchResults.slice(0, config.maxProspects);

  for (let i = 0; i < toProcess.length; i++) {
    const searchResult = toProcess[i];
    console.log(`[Pipeline] Processing ${i + 1}/${toProcess.length}: ${searchResult.name}`);

    const prospect: ProspectResult = {
      profile: searchResult,
      fullProfile: null,
      score: null,
      connectionResult: null,
      dmResult: null,
      skipped: false,
      skipReason: '',
    };

    try {
      // Step 2a: Extract full profile (lightweight — just score from search data)
      const pseudoProfile: LinkedInProfile = {
        profileUrl: searchResult.profileUrl,
        name: searchResult.name,
        headline: searchResult.headline,
        location: searchResult.location,
        connectionDegree: (searchResult.connectionDegree as any) || 'out_of_network',
        mutualConnections: searchResult.mutualConnections,
        isOpenToWork: false,
        isHiring: false,
        skills: [],
        scrapedAt: new Date().toISOString(),
        currentPosition: {
          title: searchResult.headline.split(' at ')[0] || searchResult.headline,
          company: searchResult.headline.split(' at ')[1] || '',
          duration: '',
        },
      };

      prospect.fullProfile = pseudoProfile;
      summary.extracted++;

      // Step 2b: Score the lead
      const score = scoreProfile(
        pseudoProfile,
        config.scoring.targetTitles,
        config.scoring.targetCompanies,
        config.scoring.targetLocations,
      );
      prospect.score = score;
      summary.scored++;

      console.log(`[Pipeline]   Score: ${score.totalScore} (${score.recommendation}) — ${score.reason}`);

      // Step 2c: Check if qualified
      if (score.totalScore < config.scoring.minScore) {
        prospect.skipped = true;
        prospect.skipReason = `Score ${score.totalScore} below minimum ${config.scoring.minScore}`;
        summary.skipped++;
        prospects.push(prospect);
        continue;
      }
      summary.qualified++;

      // Step 2d: Send connection request
      if (config.connection.sendRequest && searchResult.connectionDegree !== '1st') {
        const note = config.connection.noteTemplate
          ? renderTemplate(config.connection.noteTemplate, pseudoProfile)
          : undefined;

        if (config.dryRun) {
          console.log(`[Pipeline]   [DRY RUN] Would send connection request with note: "${(note || 'no note').substring(0, 60)}..."`);
          prospect.connectionResult = { success: true, status: 'sent', reason: 'dry_run' };
        } else {
          await d.humanDelay(config.delayBetweenActions, config.delayBetweenActions * 2);
          const connResult = await sendConnectionRequest({
            profileUrl: searchResult.profileUrl,
            note,
            skipIfConnected: config.connection.skipIfConnected,
            skipIfPending: config.connection.skipIfPending,
          }, d);
          prospect.connectionResult = connResult;

          if (connResult.success && connResult.status === 'sent') {
            summary.connectionsSent++;
            console.log(`[Pipeline]   Connection request sent!`);
          } else {
            console.log(`[Pipeline]   Connection: ${connResult.status} — ${connResult.reason || ''}`);
          }

          // Navigate back to search results for next person
          await d.navigateTo(`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(config.search.keywords?.join(' ') || '')}`);
          await d.wait(4000);
        }
      }

      // Step 2e: Send DM (only if 1st connection or just connected)
      if (config.dm.enabled && searchResult.connectionDegree === '1st') {
        const message = renderTemplate(config.dm.messageTemplate, pseudoProfile);

        if (config.dryRun) {
          console.log(`[Pipeline]   [DRY RUN] Would send DM: "${message.substring(0, 60)}..."`);
          prospect.dmResult = { success: true, verified: false };
        } else {
          await d.humanDelay(config.delayBetweenActions, config.delayBetweenActions * 2);
          const dmResult = await sendMessageToProfile(searchResult.profileUrl, message, d);
          prospect.dmResult = dmResult;

          if (dmResult.success) {
            summary.messagesSent++;
            console.log(`[Pipeline]   DM sent!`);
          }
        }
      }
    } catch (error: any) {
      console.error(`[Pipeline]   Error: ${error.message}`);
      summary.errors++;
      prospect.skipped = true;
      prospect.skipReason = `Error: ${error.message}`;
    }

    prospects.push(prospect);
  }

  const result: PipelineResult = {
    id: pipelineId,
    startedAt,
    completedAt: new Date().toISOString(),
    config,
    summary,
    prospects,
  };

  console.log(`[Pipeline] Complete! Searched: ${summary.searched}, Qualified: ${summary.qualified}, Connections: ${summary.connectionsSent}, DMs: ${summary.messagesSent}`);

  return result;
}

// ─── Quick Search + Score (no actions) ───────────────────────

export async function searchAndScore(
  search: Partial<PeopleSearchConfig>,
  targetTitles: string[] = [],
  targetCompanies: string[] = [],
  targetLocations: string[] = [],
  driver?: SafariDriver,
): Promise<Array<SearchResult & { score: LeadScore }>> {
  const d = driver || getDefaultDriver();
  const results = await searchPeople(search, d);

  return results.map(r => {
    const pseudoProfile: LinkedInProfile = {
      profileUrl: r.profileUrl,
      name: r.name,
      headline: r.headline,
      location: r.location,
      connectionDegree: (r.connectionDegree as any) || 'out_of_network',
      mutualConnections: r.mutualConnections,
      isOpenToWork: false,
      isHiring: false,
      skills: [],
      scrapedAt: new Date().toISOString(),
      currentPosition: {
        title: r.headline.split(' at ')[0] || r.headline,
        company: r.headline.split(' at ')[1] || '',
        duration: '',
      },
    };

    const score = scoreProfile(pseudoProfile, targetTitles, targetCompanies, targetLocations);
    return { ...r, score };
  }).sort((a, b) => b.score.totalScore - a.score.totalScore);
}
