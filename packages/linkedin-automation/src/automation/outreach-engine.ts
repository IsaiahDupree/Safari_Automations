/**
 * LinkedIn Outreach Engine
 * 
 * Full prospect lifecycle: discover → connect → DM → follow-up → engage → convert
 * Persistent JSON state in ~/.linkedin-outreach/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import { sendConnectionRequest, searchPeople, scoreProfile } from './connection-operations.js';
import { sendMessageToProfile, listConversations, openConversation } from './dm-operations.js';
import type { SearchResult, LinkedInProfile, LeadScore, PeopleSearchConfig } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ProspectStage =
  | 'discovered' | 'connection_sent' | 'connected'
  | 'first_dm_sent' | 'replied' | 'follow_up_1'
  | 'follow_up_2' | 'follow_up_3' | 'engaged'
  | 'converted' | 'cold' | 'opted_out';

export interface Prospect {
  id: string;
  profileUrl: string;
  name: string;
  headline: string;
  location: string;
  connectionDegree: string;
  stage: ProspectStage;
  score: number;
  scoreDetails: LeadScore | null;
  offer: string;
  campaign: string;
  discoveredAt: string;
  connectionSentAt: string | null;
  connectedAt: string | null;
  firstDmSentAt: string | null;
  lastMessageSentAt: string | null;
  lastReplyAt: string | null;
  nextFollowUpAt: string | null;
  lastCheckedAt: string | null;
  connectionNote: string | null;
  messagesSent: OutreachMessage[];
  messagesReceived: OutreachMessage[];
  followUpCount: number;
  tags: string[];
  notes: string;
  error: string | null;
}

export interface OutreachMessage {
  text: string;
  sentAt: string;
  stage: ProspectStage;
  type: 'connection_note' | 'dm' | 'follow_up' | 'reply';
}

export interface OutreachCampaign {
  id: string;
  name: string;
  offer: string;
  search: Partial<PeopleSearchConfig>;
  scoring: { targetTitles: string[]; targetCompanies: string[]; targetLocations: string[]; minScore: number };
  templates: MessageTemplates;
  timing: FollowUpTiming;
  maxProspectsPerRun: number;
  active: boolean;
  createdAt: string;
}

export interface MessageTemplates {
  connectionNote: string;
  firstDm: string;
  followUp1: string;
  followUp2: string;
  followUp3: string;
}

export interface FollowUpTiming {
  afterConnectedHours: number;
  followUp1Hours: number;
  followUp2Hours: number;
  followUp3Hours: number;
  giveUpAfterHours: number;
}

export interface OutreachStats {
  total: number;
  byStage: Record<string, number>;
  connectionsSent: number;
  connectionsAccepted: number;
  dmsSent: number;
  replies: number;
  conversions: number;
  responseRate: number;
  conversionRate: number;
}

export interface OutreachAction {
  prospectId: string;
  prospectName: string;
  action: string;
  success: boolean;
  details: string;
  timestamp: string;
}

export interface OutreachRunResult {
  runId: string;
  campaign: string;
  startedAt: string;
  completedAt: string;
  actions: OutreachAction[];
  summary: { discovered: number; connectionsSent: number; dmsSent: number; followUpsSent: number; repliesDetected: number; errors: number };
}

// ═══════════════════════════════════════════════════════════════
// STATE PERSISTENCE
// ═══════════════════════════════════════════════════════════════

const STATE_DIR = path.join(os.homedir(), '.linkedin-outreach');
function ensureDir(): void { if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true }); }

function loadJSON<T>(filename: string, fallback: T): T {
  ensureDir();
  const p = path.join(STATE_DIR, filename);
  if (!fs.existsSync(p)) return fallback;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
function saveJSON(filename: string, data: unknown): void {
  ensureDir();
  fs.writeFileSync(path.join(STATE_DIR, filename), JSON.stringify(data, null, 2));
}

export function loadProspects(): Prospect[] { return loadJSON('prospects.json', []); }
export function saveProspects(p: Prospect[]): void { saveJSON('prospects.json', p); }
function loadCampaigns(): OutreachCampaign[] { return loadJSON('campaigns.json', []); }
function saveCampaigns(c: OutreachCampaign[]): void { saveJSON('campaigns.json', c); }
function loadRuns(): OutreachRunResult[] { return loadJSON('runs.json', []); }
function saveRun(run: OutreachRunResult): void {
  const runs = loadRuns();
  runs.push(run);
  if (runs.length > 100) runs.splice(0, runs.length - 100);
  saveJSON('runs.json', runs);
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE RENDERING
// ═══════════════════════════════════════════════════════════════

function render(template: string, p: Prospect): string {
  const firstName = (p.name || '').split(' ')[0] || 'there';
  return template
    .replace(/\{firstName\}/g, firstName)
    .replace(/\{name\}/g, p.name || 'there')
    .replace(/\{headline\}/g, p.headline || '')
    .replace(/\{location\}/g, p.location || '')
    .replace(/\{offer\}/g, p.offer || '');
}

// ═══════════════════════════════════════════════════════════════
// CAMPAIGN MANAGEMENT
// ═══════════════════════════════════════════════════════════════

const DEFAULT_TIMING: FollowUpTiming = {
  afterConnectedHours: 2,
  followUp1Hours: 72,
  followUp2Hours: 168,
  followUp3Hours: 336,
  giveUpAfterHours: 504,
};

export function createCampaign(cfg: {
  name: string; offer: string; search: Partial<PeopleSearchConfig>;
  targetTitles?: string[]; targetCompanies?: string[]; targetLocations?: string[];
  minScore?: number; templates?: Partial<MessageTemplates>;
  timing?: Partial<FollowUpTiming>; maxProspectsPerRun?: number;
}): OutreachCampaign {
  const campaign: OutreachCampaign = {
    id: `camp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    name: cfg.name, offer: cfg.offer, search: cfg.search,
    scoring: {
      targetTitles: cfg.targetTitles || [], targetCompanies: cfg.targetCompanies || [],
      targetLocations: cfg.targetLocations || [], minScore: cfg.minScore || 30,
    },
    templates: {
      connectionNote: cfg.templates?.connectionNote || 'Hi {firstName}, I came across your profile — your work in {headline} is impressive. Would love to connect!',
      firstDm: cfg.templates?.firstDm || 'Hey {firstName}! Thanks for connecting. I wanted to share something — {offer}. Would you be open to learning more?',
      followUp1: cfg.templates?.followUp1 || 'Hi {firstName}, just following up on my earlier message about {offer}. Happy to answer any questions!',
      followUp2: cfg.templates?.followUp2 || 'Hey {firstName}, circling back one more time on {offer}. No pressure — just let me know if you\'d like to chat.',
      followUp3: cfg.templates?.followUp3 || 'Last note from me {firstName}! If {offer} isn\'t a fit right now, totally understand. Wishing you all the best!',
    },
    timing: { ...DEFAULT_TIMING, ...cfg.timing },
    maxProspectsPerRun: cfg.maxProspectsPerRun || 5,
    active: true, createdAt: new Date().toISOString(),
  };
  const campaigns = loadCampaigns();
  campaigns.push(campaign);
  saveCampaigns(campaigns);
  console.log(`[Outreach] Campaign created: ${campaign.name} (${campaign.id})`);
  return campaign;
}

export function getCampaigns(): OutreachCampaign[] { return loadCampaigns(); }
export function getCampaign(id: string): OutreachCampaign | null { return loadCampaigns().find(c => c.id === id) || null; }

// ═══════════════════════════════════════════════════════════════
// PROSPECT QUERIES
// ═══════════════════════════════════════════════════════════════

export function getProspects(filters?: { campaign?: string; stage?: ProspectStage | ProspectStage[]; minScore?: number }): Prospect[] {
  let list = loadProspects();
  if (filters?.campaign) list = list.filter(p => p.campaign === filters.campaign);
  if (filters?.stage) {
    const stages = Array.isArray(filters.stage) ? filters.stage : [filters.stage];
    list = list.filter(p => stages.includes(p.stage));
  }
  if (filters?.minScore) list = list.filter(p => p.score >= (filters.minScore ?? 0));
  return list;
}

export function getStats(campaign?: string): OutreachStats {
  const list = campaign ? loadProspects().filter(p => p.campaign === campaign) : loadProspects();
  const byStage: Record<string, number> = {};
  for (const p of list) byStage[p.stage] = (byStage[p.stage] || 0) + 1;
  const sent = list.filter(p => p.connectionSentAt).length;
  const accepted = list.filter(p => p.connectedAt).length;
  const dms = list.filter(p => p.firstDmSentAt).length;
  const replies = list.filter(p => p.lastReplyAt).length;
  const conv = list.filter(p => p.stage === 'converted').length;
  return {
    total: list.length, byStage, connectionsSent: sent, connectionsAccepted: accepted,
    dmsSent: dms, replies, conversions: conv,
    responseRate: dms > 0 ? Math.round((replies / dms) * 100) : 0,
    conversionRate: sent > 0 ? Math.round((conv / sent) * 100) : 0,
  };
}

export function getRecentRuns(limit = 10): OutreachRunResult[] {
  return loadRuns().slice(-limit);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function hoursAgo(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function addHours(isoDate: string, hours: number): string {
  return new Date(new Date(isoDate).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function makeAction(p: Prospect, action: string, success: boolean, details: string): OutreachAction {
  return { prospectId: p.id, prospectName: p.name, action, success, details, timestamp: new Date().toISOString() };
}

// ═══════════════════════════════════════════════════════════════
// OUTREACH CYCLE RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runOutreachCycle(
  campaignId: string,
  opts?: { dryRun?: boolean; skipDiscovery?: boolean; skipFollowUps?: boolean },
  driver?: SafariDriver,
): Promise<OutreachRunResult> {
  const d = driver || getDefaultDriver();
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const runId = `run_${Date.now()}`;
  const startedAt = new Date().toISOString();
  const actions: OutreachAction[] = [];
  const sm = { discovered: 0, connectionsSent: 0, dmsSent: 0, followUpsSent: 0, repliesDetected: 0, errors: 0 };
  const dry = opts?.dryRun ?? false;

  console.log(`[Outreach] ▶ Cycle "${campaign.name}" ${dry ? '(DRY RUN)' : '(LIVE)'}`);
  let prospects = loadProspects();

  // ── Step 1: Discover ─────────────────────────────────────
  if (!opts?.skipDiscovery) {
    console.log('[Outreach] Step 1: Discovering...');
    try {
      const results = await searchPeople(campaign.search, d);
      const known = new Set(prospects.map(p => p.profileUrl));
      for (const sr of results) {
        if (known.has(sr.profileUrl)) continue;
        const prof: LinkedInProfile = {
          profileUrl: sr.profileUrl, name: sr.name, headline: sr.headline,
          location: sr.location, connectionDegree: (sr.connectionDegree as any) || 'out_of_network',
          mutualConnections: sr.mutualConnections, isOpenToWork: false, isHiring: false,
          skills: [], scrapedAt: new Date().toISOString(),
          currentPosition: { title: sr.headline.split(' at ')[0], company: sr.headline.split(' at ')[1] || '', duration: '' },
        };
        const score = scoreProfile(prof, campaign.scoring.targetTitles, campaign.scoring.targetCompanies, campaign.scoring.targetLocations);
        if (score.totalScore < campaign.scoring.minScore) continue;
        const p: Prospect = {
          id: `p_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          profileUrl: sr.profileUrl, name: sr.name, headline: sr.headline,
          location: sr.location, connectionDegree: sr.connectionDegree || '',
          stage: 'discovered', score: score.totalScore, scoreDetails: score,
          offer: campaign.offer, campaign: campaign.id,
          discoveredAt: new Date().toISOString(),
          connectionSentAt: null, connectedAt: null, firstDmSentAt: null,
          lastMessageSentAt: null, lastReplyAt: null, nextFollowUpAt: null, lastCheckedAt: null,
          connectionNote: null, messagesSent: [], messagesReceived: [],
          followUpCount: 0, tags: [], notes: '', error: null,
        };
        prospects.push(p);
        sm.discovered++;
        actions.push(makeAction(p, 'discovered', true, `Score: ${score.totalScore}`));
      }
      saveProspects(prospects);
      console.log(`[Outreach]   Found ${sm.discovered} new prospects`);
    } catch (e: any) { console.error(`[Outreach] Discovery error: ${e.message}`); sm.errors++; }
  }

  // ── Step 2: Send connection requests ─────────────────────
  const toConnect = prospects
    .filter(p => p.campaign === campaign.id && p.stage === 'discovered' && p.connectionDegree !== '1st')
    .sort((a, b) => b.score - a.score)
    .slice(0, campaign.maxProspectsPerRun);

  console.log(`[Outreach] Step 2: Connecting with ${toConnect.length} prospects...`);
  for (const p of toConnect) {
    try {
      const note = render(campaign.templates.connectionNote, p);
      if (dry) {
        console.log(`[Outreach]   [DRY] Connect: ${p.name}`);
        actions.push(makeAction(p, 'connection_request_dry', true, note.substring(0, 60)));
        continue;
      }
      await d.humanDelay(3000, 6000);
      const res = await sendConnectionRequest({ profileUrl: p.profileUrl, note, skipIfConnected: true, skipIfPending: true }, d);
      if (res.success && res.status === 'sent') {
        p.stage = 'connection_sent';
        p.connectionSentAt = new Date().toISOString();
        p.connectionNote = note;
        p.messagesSent.push({ text: note, sentAt: p.connectionSentAt, stage: 'connection_sent', type: 'connection_note' });
        sm.connectionsSent++;
        actions.push(makeAction(p, 'connection_sent', true, `Note: ${note.substring(0, 60)}`));
        console.log(`[Outreach]   ✓ Connected: ${p.name}`);
      } else if (res.status === 'already_connected') {
        p.stage = 'connected';
        p.connectedAt = new Date().toISOString();
        p.nextFollowUpAt = addHours(p.connectedAt, campaign.timing.afterConnectedHours);
        actions.push(makeAction(p, 'already_connected', true, ''));
      } else if (res.status === 'pending') {
        p.stage = 'connection_sent';
        p.connectionSentAt = p.connectionSentAt || new Date().toISOString();
        actions.push(makeAction(p, 'already_pending', true, ''));
      } else if (res.status === 'cannot_connect') {
        // Follow-only profile — skip gracefully, don't count as error
        p.tags = p.tags || [];
        if (!p.tags.includes('follow_only')) p.tags.push('follow_only');
        p.notes = (p.notes ? p.notes + '\n' : '') + `Follow-only profile — no Connect option (${new Date().toISOString()})`;
        actions.push(makeAction(p, 'skipped_follow_only', true, res.reason || 'No Connect option'));
        console.log(`[Outreach]   ⏭ Skipped (follow-only): ${p.name}`);
      } else {
        p.error = res.reason || res.status;
        actions.push(makeAction(p, 'connection_failed', false, res.reason || res.status));
        sm.errors++;
      }
    } catch (e: any) {
      p.error = e.message;
      sm.errors++;
      actions.push(makeAction(p, 'connection_error', false, e.message));
    }
  }
  saveProspects(prospects);

  // ── Step 3: Check for newly accepted connections ─────────
  const pendingConnect = prospects.filter(p => p.campaign === campaign.id && p.stage === 'connection_sent');
  console.log(`[Outreach] Step 3: Checking ${pendingConnect.length} pending connections...`);
  for (const p of pendingConnect) {
    try {
      if (dry) continue;
      await d.humanDelay(1500, 3000);
      // Navigate to their profile and check if Message button is now visible
      await d.navigateTo(p.profileUrl);
      await d.wait(3000);
      const status = await d.executeJS(`
        (function() {
          var main = document.querySelector('main');
          if (!main) return 'unknown';
          var section = main.querySelector('section');
          if (!section) return 'unknown';
          var btns = section.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
            if (a.includes('message')) return 'connected';
            if (a.includes('pending')) return 'pending';
          }
          return 'not_connected';
        })()
      `);
      p.lastCheckedAt = new Date().toISOString();
      if (status === 'connected') {
        p.stage = 'connected';
        p.connectedAt = new Date().toISOString();
        p.nextFollowUpAt = addHours(p.connectedAt, campaign.timing.afterConnectedHours);
        actions.push(makeAction(p, 'connection_accepted', true, ''));
        console.log(`[Outreach]   ✓ Accepted: ${p.name}`);
      }
    } catch (e: any) { /* skip */ }
  }
  saveProspects(prospects);

  // ── Step 4: Send first DMs to newly connected ────────────
  const toDm = prospects.filter(p =>
    p.campaign === campaign.id && p.stage === 'connected' &&
    p.nextFollowUpAt && new Date(p.nextFollowUpAt) <= new Date()
  );
  console.log(`[Outreach] Step 4: Sending ${toDm.length} first DMs...`);
  for (const p of toDm) {
    try {
      const msg = render(campaign.templates.firstDm, p);
      if (dry) {
        console.log(`[Outreach]   [DRY] DM: ${p.name}`);
        actions.push(makeAction(p, 'first_dm_dry', true, msg.substring(0, 60)));
        continue;
      }
      await d.humanDelay(3000, 6000);
      const res = await sendMessageToProfile(p.profileUrl, msg, d);
      if (res.success) {
        p.stage = 'first_dm_sent';
        p.firstDmSentAt = new Date().toISOString();
        p.lastMessageSentAt = p.firstDmSentAt;
        p.nextFollowUpAt = addHours(p.firstDmSentAt, campaign.timing.followUp1Hours);
        p.messagesSent.push({ text: msg, sentAt: p.firstDmSentAt, stage: 'first_dm_sent', type: 'dm' });
        sm.dmsSent++;
        actions.push(makeAction(p, 'first_dm_sent', true, msg.substring(0, 60)));
        console.log(`[Outreach]   ✓ DM sent: ${p.name}`);
      } else {
        p.error = 'DM send failed';
        sm.errors++;
        actions.push(makeAction(p, 'dm_failed', false, 'send failed'));
      }
    } catch (e: any) { sm.errors++; p.error = e.message; }
  }
  saveProspects(prospects);

  // ── Step 5: Follow-ups ───────────────────────────────────
  if (!opts?.skipFollowUps) {
    const followUpCandidates = prospects.filter(p =>
      p.campaign === campaign.id &&
      ['first_dm_sent', 'follow_up_1', 'follow_up_2'].includes(p.stage) &&
      p.nextFollowUpAt && new Date(p.nextFollowUpAt) <= new Date()
    );
    console.log(`[Outreach] Step 5: ${followUpCandidates.length} follow-ups due...`);
    for (const p of followUpCandidates) {
      try {
        // Check if they've gone cold (past give-up window)
        const lastSent = p.lastMessageSentAt || p.firstDmSentAt || p.connectionSentAt;
        if (lastSent && hoursAgo(lastSent) > campaign.timing.giveUpAfterHours) {
          p.stage = 'cold';
          actions.push(makeAction(p, 'marked_cold', true, 'No response — gave up'));
          console.log(`[Outreach]   ❄ Cold: ${p.name}`);
          continue;
        }

        let template = '';
        let nextStage: ProspectStage = 'follow_up_1';
        let nextDelay = campaign.timing.followUp2Hours;
        if (p.stage === 'first_dm_sent') {
          template = campaign.templates.followUp1; nextStage = 'follow_up_1'; nextDelay = campaign.timing.followUp2Hours;
        } else if (p.stage === 'follow_up_1') {
          template = campaign.templates.followUp2; nextStage = 'follow_up_2'; nextDelay = campaign.timing.followUp3Hours;
        } else if (p.stage === 'follow_up_2') {
          template = campaign.templates.followUp3; nextStage = 'follow_up_3'; nextDelay = campaign.timing.giveUpAfterHours;
        }

        const msg = render(template, p);
        if (dry) {
          console.log(`[Outreach]   [DRY] Follow-up ${nextStage}: ${p.name}`);
          actions.push(makeAction(p, `${nextStage}_dry`, true, msg.substring(0, 60)));
          continue;
        }
        await d.humanDelay(3000, 6000);
        const res = await sendMessageToProfile(p.profileUrl, msg, d);
        if (res.success) {
          p.stage = nextStage;
          p.lastMessageSentAt = new Date().toISOString();
          p.nextFollowUpAt = addHours(p.lastMessageSentAt, nextDelay);
          p.followUpCount++;
          p.messagesSent.push({ text: msg, sentAt: p.lastMessageSentAt, stage: nextStage, type: 'follow_up' });
          sm.followUpsSent++;
          actions.push(makeAction(p, nextStage, true, msg.substring(0, 60)));
          console.log(`[Outreach]   ✓ Follow-up: ${p.name} → ${nextStage}`);
        }
      } catch (e: any) { sm.errors++; }
    }
    saveProspects(prospects);
  }

  // ── Step 6: Check for replies ────────────────────────────
  const awaitingReply = prospects.filter(p =>
    p.campaign === campaign.id &&
    ['first_dm_sent', 'follow_up_1', 'follow_up_2', 'follow_up_3'].includes(p.stage)
  );
  if (awaitingReply.length > 0 && !dry) {
    console.log(`[Outreach] Step 6: Checking ${awaitingReply.length} conversations for replies...`);
    try {
      const convos = await listConversations(d);
      for (const p of awaitingReply) {
        const firstName = (p.name || '').split(' ')[0].toLowerCase();
        const match = convos.find((c: any) =>
          c.name?.toLowerCase().includes(firstName) ||
          c.profileUrl?.includes(p.profileUrl.split('/in/')[1]?.replace(/\/$/, ''))
        );
        if (match && match.lastMessage) {
          const lastMsg = match.lastMessage.toLowerCase();
          const ourMessages = p.messagesSent.map(m => m.text.toLowerCase().substring(0, 30));
          const isOurs = ourMessages.some(m => lastMsg.includes(m.substring(0, 20)));
          if (!isOurs) {
            // They replied!
            const prevStage = p.stage;
            if (['follow_up_1', 'follow_up_2', 'follow_up_3'].includes(prevStage)) {
              p.stage = 'engaged';
            } else {
              p.stage = 'replied';
            }
            p.lastReplyAt = new Date().toISOString();
            p.nextFollowUpAt = null;
            p.messagesReceived.push({ text: match.lastMessage, sentAt: p.lastReplyAt, stage: p.stage, type: 'reply' });
            sm.repliesDetected++;
            actions.push(makeAction(p, 'reply_detected', true, `Reply: "${match.lastMessage.substring(0, 50)}"`));
            console.log(`[Outreach]   💬 Reply from ${p.name}!`);

            // Check for opt-out signals
            const optOutWords = ['not interested', 'no thanks', 'stop', 'unsubscribe', 'remove me', 'don\'t contact'];
            if (optOutWords.some(w => lastMsg.includes(w))) {
              p.stage = 'opted_out';
              p.nextFollowUpAt = null;
              actions.push(makeAction(p, 'opted_out', true, 'Detected opt-out signal'));
              console.log(`[Outreach]   🛑 Opted out: ${p.name}`);
            }
          }
        }
        p.lastCheckedAt = new Date().toISOString();
      }
    } catch (e: any) { console.error(`[Outreach] Reply check error: ${e.message}`); }
    saveProspects(prospects);
  }

  const result: OutreachRunResult = {
    runId, campaign: campaign.id, startedAt, completedAt: new Date().toISOString(), actions, summary: sm,
  };
  saveRun(result);
  console.log(`[Outreach] ✓ Cycle complete: ${sm.discovered} discovered, ${sm.connectionsSent} connected, ${sm.dmsSent} DMs, ${sm.followUpsSent} follow-ups, ${sm.repliesDetected} replies`);
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MANUAL ACTIONS
// ═══════════════════════════════════════════════════════════════

export function markConverted(prospectId: string, notes?: string): Prospect | null {
  const all = loadProspects();
  const p = all.find(x => x.id === prospectId);
  if (!p) return null;
  p.stage = 'converted';
  p.notes = notes || p.notes;
  p.nextFollowUpAt = null;
  saveProspects(all);
  return p;
}

export function markOptedOut(prospectId: string): Prospect | null {
  const all = loadProspects();
  const p = all.find(x => x.id === prospectId);
  if (!p) return null;
  p.stage = 'opted_out';
  p.nextFollowUpAt = null;
  saveProspects(all);
  return p;
}

export function addProspectNote(prospectId: string, note: string): Prospect | null {
  const all = loadProspects();
  const p = all.find(x => x.id === prospectId);
  if (!p) return null;
  p.notes = p.notes ? `${p.notes}\n${note}` : note;
  saveProspects(all);
  return p;
}

export function tagProspect(prospectId: string, tag: string): Prospect | null {
  const all = loadProspects();
  const p = all.find(x => x.id === prospectId);
  if (!p) return null;
  if (!p.tags.includes(tag)) p.tags.push(tag);
  saveProspects(all);
  return p;
}
