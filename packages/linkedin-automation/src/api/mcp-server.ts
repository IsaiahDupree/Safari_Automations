/**
 * LinkedIn MCP Server — JSON-RPC 2.0 over stdio
 *
 * Implements the Model Context Protocol (MCP) for tool-calling integration.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 */

import {
  getDefaultDriver,
  searchPeople,
  extractProfile,
  sendConnectionRequest,
  sendMessageToProfile,
  listConversations,
  scoreProfile,
  navigateToProfile,
  runProspectingPipeline,
  // Connection ops
  getConnectionStatus,
  listPendingRequests,
  acceptRequest,
  navigateToNetwork,
  navigateToMessaging,
  // DM ops
  readMessages,
  getUnreadCount,
  openConversation,
  // Outreach engine
  createCampaign,
  getCampaigns,
  getCampaign,
  getProspects,
  getStats,
  getRecentRuns,
  runOutreachCycle,
  markConverted,
  tagProspect,
} from '../automation/index.js';
import type { PeopleSearchConfig, ConnectionRequest } from '../automation/types.js';
import type { ProspectingConfig } from '../automation/prospecting-pipeline.js';
import { getSupabaseClient } from '../automation/supabase-client.js';
import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'linkedin-safari-automation';
const SERVER_VERSION = '1.0.0';

function formatMcpError(e: unknown, platform = 'linkedin'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  // Rate limit detection
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform, action: 'wait retryAfter seconds then retry' });
  }

  // Session expired detection
  if (lowerMsg.includes('401') || lowerMsg.includes('session') || lowerMsg.includes('login')) {
    return JSON.stringify({ code: 'SESSION_EXPIRED', platform, action: 'call linkedin_navigate_to then retry' });
  }

  // Not found detection
  if (lowerMsg.includes('404') || lowerMsg.includes('not found')) {
    return JSON.stringify({ code: 'NOT_FOUND', platform });
  }

  // Check if already structured
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return JSON.stringify(e);
  }

  // Default error
  return JSON.stringify({ code: 'ERROR', message: msg, platform });
}

// ═══════════════════════════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'linkedin_search_people',
    description: 'Search LinkedIn for people matching criteria',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "software engineer at Google")' },
        title: { type: 'string', description: 'Optional job title filter' },
        company: { type: 'string', description: 'Optional company filter' },
        location: { type: 'string', description: 'Optional location filter' },
        maxResults: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'linkedin_get_profile',
    description: 'Extract profile information from a LinkedIn profile',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrl: { type: 'string', description: 'LinkedIn profile URL' },
      },
      required: ['profileUrl'],
    },
  },
  {
    name: 'linkedin_send_connection',
    description: 'Send a connection request to a LinkedIn profile',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrl: { type: 'string', description: 'LinkedIn profile URL' },
        message: { type: 'string', description: 'Optional personalized message (max 300 chars)' },
      },
      required: ['profileUrl'],
    },
  },
  {
    name: 'linkedin_send_message',
    description: 'Send a direct message to a LinkedIn connection',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrl: { type: 'string', description: 'LinkedIn profile URL' },
        text: { type: 'string', description: 'Message text' },
      },
      required: ['profileUrl', 'text'],
    },
  },
  {
    name: 'linkedin_list_conversations',
    description: 'Get recent LinkedIn message conversations. Supports pagination via cursor.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max conversations to return', default: 20 },
        cursor: { type: 'string', description: 'Optional pagination cursor from previous response' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        conversations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              lastMessage: { type: 'string' },
              unread: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
            required: ['username'],
          },
        },
        count: { type: 'number' },
        nextCursor: { type: 'string' },
      },
      required: ['conversations', 'count'],
    },
  },
  {
    name: 'linkedin_score_profile',
    description: 'Score a LinkedIn profile against ICP criteria (0-100)',
    inputSchema: {
      type: 'object',
      properties: {
        profileUrl: { type: 'string', description: 'LinkedIn profile URL to score' },
        icp: {
          type: 'object',
          description: 'Ideal Customer Profile criteria',
          properties: {
            targetTitle: { type: 'string', description: 'Target job title' },
            targetCompany: { type: 'string', description: 'Target company type' },
            targetIndustry: { type: 'string', description: 'Target industry' },
          },
        },
      },
      required: ['profileUrl'],
    },
  },
  {
    name: 'linkedin_navigate',
    description: 'Navigate Safari to a LinkedIn URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'LinkedIn URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'linkedin_run_pipeline',
    description: 'Run automated prospecting pipeline',
    inputSchema: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Target niche/ICP description' },
        searchQuery: { type: 'string', description: 'LinkedIn search query' },
        maxProspects: { type: 'number', description: 'Max prospects to find', default: 10 },
        autoConnect: { type: 'boolean', description: 'Auto-send connection requests', default: false },
      },
      required: ['niche', 'searchQuery'],
    },
  },
  {
    name: 'linkedin_get_status',
    description: 'Get current LinkedIn session status',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'linkedin_is_ready',
    description: 'Check if LinkedIn automation is ready. Since LinkedIn uses direct AppleScript calls, this checks if Safari automation is available.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'linkedin_crm_get_contact',
    description: 'Get CRMLite contact record by LinkedIn username. Returns contact history, interactions, tags, and pipeline stage across all platforms.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'LinkedIn username or profile identifier' },
      },
      required: ['username'],
    },
  },
  // ── Connection extras ──
  {
    name: 'linkedin_connection_status',
    description: 'Get the connection status with a LinkedIn profile — 1st, 2nd, 3rd, pending, or none.',
    inputSchema: { type: 'object', properties: { profileUrl: { type: 'string' } }, required: ['profileUrl'] },
  },
  {
    name: 'linkedin_accept_connection',
    description: 'Accept a pending connection request from a specific profile URL.',
    inputSchema: { type: 'object', properties: { profileUrl: { type: 'string' } }, required: ['profileUrl'] },
  },
  {
    name: 'linkedin_list_pending',
    description: 'List pending connection requests (sent or received).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['received', 'sent'], default: 'received' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'linkedin_navigate_messaging',
    description: 'Navigate Safari to the LinkedIn messaging page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'linkedin_navigate_network',
    description: 'Navigate Safari to the LinkedIn My Network page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'linkedin_extract_current',
    description: 'Extract profile data from whatever LinkedIn profile page is currently open in Safari.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── DM extras ──
  {
    name: 'linkedin_read_messages',
    description: 'Read recent messages from the currently open LinkedIn conversation.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } },
  },
  {
    name: 'linkedin_get_unread_count',
    description: 'Get the number of unread LinkedIn DM conversations.',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── Reply detection ──
  {
    name: 'linkedin_get_replies',
    description: 'Return all outreach prospects that have replied since their last outbound message. Surfaces new replies without running a full cycle.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign: { type: 'string', description: 'Optional campaign ID filter' },
        limit: { type: 'number', default: 20 },
      },
    },
  },
  // ── Campaign engine ──
  {
    name: 'linkedin_create_campaign',
    description: 'Create a new LinkedIn outreach campaign with message templates and timing.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        offer: { type: 'string', description: 'Your offer/value prop to mention in messages' },
        searchQuery: { type: 'string', description: 'LinkedIn search keywords' },
        targetTitles: { type: 'array', items: { type: 'string' } },
        minScore: { type: 'number', default: 30 },
        connectionNote: { type: 'string', description: 'Override default connection note template' },
        firstDm: { type: 'string', description: 'Override default first DM template' },
      },
      required: ['name', 'offer', 'searchQuery'],
    },
  },
  {
    name: 'linkedin_list_campaigns',
    description: 'List all outreach campaigns with status and stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'linkedin_run_outreach_cycle',
    description: 'Run an outreach cycle for a campaign: discover prospects, send connections, send DMs, detect replies. Set dryRun=true to preview.',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string' },
        dryRun: { type: 'boolean', default: true },
        skipDiscovery: { type: 'boolean', default: false },
        skipFollowUps: { type: 'boolean', default: false },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'linkedin_get_campaign_stats',
    description: 'Get outreach campaign stats: connections sent, DMs sent, replies received, conversion rate.',
    inputSchema: {
      type: 'object',
      properties: { campaignId: { type: 'string', description: 'Optional — omit for all campaigns' } },
    },
  },
  {
    name: 'linkedin_mark_converted',
    description: 'Mark a prospect as converted (became a customer / booked a call).',
    inputSchema: {
      type: 'object',
      properties: {
        prospectId: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['prospectId'],
    },
  },
  {
    name: 'linkedin_tag_prospect',
    description: 'Add a tag to a prospect in the outreach system.',
    inputSchema: {
      type: 'object',
      properties: {
        prospectId: { type: 'string' },
        tag: { type: 'string' },
      },
      required: ['prospectId', 'tag'],
    },
  },
  // ── Supabase sync ──
  {
    name: 'linkedin_supabase_sync',
    description: 'Sync local outreach prospects to Supabase crm_contacts table. Upserts by linkedin profile_url.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign: { type: 'string', description: 'Optional — filter by campaign ID' },
        limit: { type: 'number', default: 50 },
      },
    },
  },
  // ── Rate limit persistence ──
  {
    name: 'linkedin_persist_rate_limits',
    description: 'Write in-memory rate limit counters (connectionsToday, dmsToday) to Supabase actp_agent_health_snapshots so they survive restarts.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionsToday: { type: 'number' },
        dmsToday: { type: 'number' },
        followUpsToday: { type: 'number' },
      },
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Tool execution with timeout protection
// ═══════════════════════════════════════════════════════════════

const TOOL_TIMEOUT_MS = 30000; // 30 seconds

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
    ),
  ]);
}

async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const driver = getDefaultDriver();

  const execute = async () => {
    switch (name) {
      case 'linkedin_search_people': {
        const query = args.query as string;
        const config: Partial<PeopleSearchConfig> = {
          keywords: query.split(' '),
          title: args.title as string | undefined,
          company: args.company as string | undefined,
          location: args.location as string | undefined,
        };
        const results = await searchPeople(config, driver);
        const maxResults = (args.maxResults as number) || 10;
        const limited = results.slice(0, maxResults);
        return { content: [{ type: 'text', text: JSON.stringify({ profiles: limited, count: limited.length }) }] };
      }

      case 'linkedin_get_profile': {
        const profileUrl = args.profileUrl as string;
        const profile = await extractProfile(profileUrl, driver);
        return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
      }

      case 'linkedin_send_connection': {
        const profileUrl = args.profileUrl as string;
        const message = args.message as string | undefined;
        const request: ConnectionRequest = {
          profileUrl,
          note: message,
          skipIfConnected: true,
          skipIfPending: true,
        };
        const result = await sendConnectionRequest(request, driver);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      case 'linkedin_send_message': {
        const profileUrl = args.profileUrl as string;
        const text = args.text as string;
        const result = await sendMessageToProfile(profileUrl, text, driver);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      case 'linkedin_list_conversations': {
        const conversations = await listConversations(driver);
        const limit = (args.limit as number) || 20;
        const limited = conversations.slice(0, limit);
        // LinkedIn doesn't support server-side pagination yet, so nextCursor is always undefined
        return { content: [{ type: 'text', text: JSON.stringify({ conversations: limited, count: limited.length, nextCursor: undefined }) }] };
      }

      case 'linkedin_score_profile': {
        const profileUrl = args.profileUrl as string;
        const icp = (args.icp as Record<string, string>) || {};
        const profile = await extractProfile(profileUrl, driver);
        if (!profile) {
          throw new Error('Failed to extract profile');
        }
        const targetTitles = icp.targetTitle ? [icp.targetTitle] : [];
        const targetCompanies = icp.targetCompany ? [icp.targetCompany] : [];
        const targetIndustries = icp.targetIndustry ? [icp.targetIndustry] : [];
        const score = scoreProfile(profile, targetTitles, targetCompanies, targetIndustries);
        return { content: [{ type: 'text', text: JSON.stringify({ score: score.totalScore, reasoning: score.reason }) }] };
      }

      case 'linkedin_navigate': {
        const url = args.url as string;
        await navigateToProfile(url, driver);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, url }) }] };
      }

      case 'linkedin_run_pipeline': {
        const searchQuery = args.searchQuery as string;
        const config: ProspectingConfig = {
          search: {
            keywords: searchQuery.split(' '),
          },
          scoring: {
            targetTitles: [],
            targetCompanies: [],
            targetLocations: [],
            minScore: 50,
          },
          connection: {
            sendRequest: (args.autoConnect as boolean) || false,
            noteTemplate: 'Hi {firstName}, I came across your profile and would love to connect!',
            skipIfConnected: true,
            skipIfPending: true,
          },
          dm: {
            enabled: false,
            messageTemplate: '',
            onlyIfConnected: true,
          },
          maxProspects: (args.maxProspects as number) || 10,
          dryRun: false,
          delayBetweenActions: 2000,
        };
        const results = await runProspectingPipeline(config, driver);
        return { content: [{ type: 'text', text: JSON.stringify(results) }] };
      }

      case 'linkedin_get_status': {
        const url = await driver.executeJS('window.location.href');
        const isLinkedIn = url.includes('linkedin.com');
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connected: isLinkedIn,
              currentUrl: url,
              serverVersion: SERVER_VERSION,
            }),
          }],
        };
      }

      case 'linkedin_is_ready': {
        try {
          // Test lightweight AppleScript to verify Safari automation is available
          await driver.executeJS('1 + 1');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ready: true,
                method: 'direct',
                automation: 'applescript',
              }),
            }],
          };
        } catch {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                ready: false,
                method: 'direct',
                error: 'Safari automation not available',
              }),
            }],
          };
        }
      }

      case 'linkedin_crm_get_contact': {
        const username = args.username as string;
        const crmUrl = `https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app/api/contacts/by-username/linkedin/${encodeURIComponent(username)}`;
        try {
          const res = await fetch(crmUrl, { signal: AbortSignal.timeout(5000) });
          if (res.status === 404) {
            return { content: [{ type: 'text', text: JSON.stringify({ found: false, username }) }] };
          }
          if (!res.ok) throw new Error(`CRMLite returned ${res.status}`);
          const contact = await res.json();
          return { content: [{ type: 'text', text: JSON.stringify(contact) }] };
        } catch (err) {
          const errorResult = { found: false, username, error: err instanceof Error ? err.message : String(err) };
          return { content: [{ type: 'text', text: JSON.stringify(errorResult) }] };
        }
      }

      // ── Connection extras ──
      case 'linkedin_connection_status': {
        const status = await getConnectionStatus(args.profileUrl as string, driver);
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      }

      case 'linkedin_accept_connection': {
        const ok = await acceptRequest(args.profileUrl as string, driver);
        return { content: [{ type: 'text', text: JSON.stringify({ accepted: ok, profileUrl: args.profileUrl }) }] };
      }

      case 'linkedin_list_pending': {
        const reqType = (args.type as 'received' | 'sent') || 'received';
        const pending = await listPendingRequests(reqType, driver);
        const limit = (args.limit as number) || 20;
        return { content: [{ type: 'text', text: JSON.stringify({ requests: pending.slice(0, limit), count: pending.length }) }] };
      }

      case 'linkedin_navigate_messaging': {
        await navigateToMessaging(driver);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, url: 'https://www.linkedin.com/messaging/' }) }] };
      }

      case 'linkedin_navigate_network': {
        await navigateToNetwork(driver);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, url: 'https://www.linkedin.com/mynetwork/' }) }] };
      }

      case 'linkedin_extract_current': {
        const url = await driver.executeJS('window.location.href') as string;
        const profile = await extractProfile(url, driver);
        return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
      }

      // ── DM extras ──
      case 'linkedin_read_messages': {
        const limit = (args.limit as number) || 20;
        const messages = await readMessages(limit, driver);
        return { content: [{ type: 'text', text: JSON.stringify({ messages, count: messages.length }) }] };
      }

      case 'linkedin_get_unread_count': {
        const count = await getUnreadCount(driver);
        return { content: [{ type: 'text', text: JSON.stringify({ unreadCount: count }) }] };
      }

      // ── Reply detection ──
      case 'linkedin_get_replies': {
        const prospects = getProspects({ campaign: args.campaign as string | undefined });
        const limit = (args.limit as number) || 20;
        const replied = prospects.filter(p => p.lastReplyAt).slice(0, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ replies: replied, count: replied.length }) }] };
      }

      // ── Campaign engine ──
      case 'linkedin_create_campaign': {
        const campaign = createCampaign({
          name: args.name as string,
          offer: args.offer as string,
          search: { keywords: (args.searchQuery as string).split(' ') },
          targetTitles: (args.targetTitles as string[]) || [],
          minScore: (args.minScore as number) || 30,
          templates: {
            connectionNote: args.connectionNote as string | undefined,
            firstDm: args.firstDm as string | undefined,
          },
        });
        return { content: [{ type: 'text', text: JSON.stringify(campaign) }] };
      }

      case 'linkedin_list_campaigns': {
        const campaigns = getCampaigns();
        return { content: [{ type: 'text', text: JSON.stringify({ campaigns, count: campaigns.length }) }] };
      }

      case 'linkedin_run_outreach_cycle': {
        const result = await runOutreachCycle(
          args.campaignId as string,
          {
            dryRun: (args.dryRun as boolean) ?? true,
            skipDiscovery: (args.skipDiscovery as boolean) ?? false,
            skipFollowUps: (args.skipFollowUps as boolean) ?? false,
          },
          driver,
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }

      case 'linkedin_get_campaign_stats': {
        const stats = getStats(args.campaignId as string | undefined);
        const runs = getRecentRuns(5);
        return { content: [{ type: 'text', text: JSON.stringify({ stats, recentRuns: runs }) }] };
      }

      case 'linkedin_mark_converted': {
        const prospect = markConverted(args.prospectId as string, args.notes as string | undefined);
        return { content: [{ type: 'text', text: JSON.stringify({ success: !!prospect, prospect }) }] };
      }

      case 'linkedin_tag_prospect': {
        const prospect = tagProspect(args.prospectId as string, args.tag as string);
        return { content: [{ type: 'text', text: JSON.stringify({ success: !!prospect, prospect }) }] };
      }

      // ── Supabase sync ──
      case 'linkedin_supabase_sync': {
        const supabase = getSupabaseClient();
        if (!supabase) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY env vars not set', synced: 0 }) }] };
        }
        const prospects = getProspects({ campaign: args.campaign as string | undefined });
        const limit = (args.limit as number) || 50;
        const toSync = prospects.slice(0, limit);
        let synced = 0;
        const errors: string[] = [];
        for (const p of toSync) {
          const { error } = await supabase.upsertContact({
            platform: 'linkedin',
            profile_url: p.profileUrl,
            name: p.name,
            headline: p.headline,
            location: p.location,
            metadata: { score: p.score, stage: p.stage, campaign: p.campaign, tags: p.tags },
          });
          if (error) errors.push(String(error));
          else synced++;
        }
        return { content: [{ type: 'text', text: JSON.stringify({ synced, errors: errors.slice(0, 5), total: toSync.length }) }] };
      }

      // ── Rate limit persistence ──
      case 'linkedin_persist_rate_limits': {
        const supabase = getSupabaseClient();
        if (!supabase) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not set' }) }] };
        }
        const snapshot = {
          platform: 'linkedin',
          connections_today: (args.connectionsToday as number) ?? 0,
          dms_today: (args.dmsToday as number) ?? 0,
          follow_ups_today: (args.followUpsToday as number) ?? 0,
          recorded_at: new Date().toISOString(),
        };
        const url = `${process.env['SUPABASE_URL']}/rest/v1/actp_agent_health_snapshots`;
        const headers = {
          'Content-Type': 'application/json',
          'apikey': process.env['SUPABASE_ANON_KEY']!,
          'Authorization': `Bearer ${process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_ANON_KEY']}`,
          'Prefer': 'return=representation',
        };
        try {
          const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(snapshot) });
          if (!res.ok) throw new Error(await res.text());
          return { content: [{ type: 'text', text: JSON.stringify({ persisted: true, snapshot }) }] };
        } catch (e) {
          return { content: [{ type: 'text', text: JSON.stringify({ persisted: false, error: (e as Error).message }) }] };
        }
      }

      default:
        throw { code: -32601, message: `Unknown tool: ${name}` };
    }
  };

  return withTimeout(execute(), TOOL_TIMEOUT_MS);
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 handler
// ═══════════════════════════════════════════════════════════════

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  // Notifications (no id) don't get responses
  if (request.id === undefined && request.method !== 'initialize') {
    return null;
  }

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case 'notifications/initialized':
      return null; // No response needed

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const params = request.params || {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      }

      const toolExists = TOOLS.some((t) => t.name === toolName);
      if (!toolExists) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      }

      try {
        const result = await executeTool(toolName, toolArgs);
        // Ensure result is serializable (no circular refs, functions, etc.)
        JSON.stringify(result);
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        const errObj = err as { code?: number; message?: string };
        if (typeof errObj.code === 'number') {
          return { jsonrpc: '2.0', id, error: { code: errObj.code, message: errObj.message || 'Tool error' } };
        }
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: formatMcpError(err) }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
  }
}

// ═══════════════════════════════════════════════════════════════
// stdio transport
// ═══════════════════════════════════════════════════════════════

export function startMCPServer(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return; // Ignore empty lines (handles T-088)

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      const resp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    const response = await handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started on stdio\n`);
}

// Auto-start if run directly
if (process.argv[1]?.includes('mcp-server')) {
  startMCPServer();
}
