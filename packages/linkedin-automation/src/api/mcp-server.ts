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
} from '../automation/index.js';
import type { PeopleSearchConfig, ConnectionRequest } from '../automation/types.js';
import type { ProspectingConfig } from '../automation/prospecting-pipeline.js';
import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'linkedin-safari-automation';
const SERVER_VERSION = '1.0.0';

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
    description: 'Get recent LinkedIn message conversations',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max conversations to return', default: 20 },
      },
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
        return { content: [{ type: 'text', text: JSON.stringify({ conversations: limited, count: limited.length }) }] };
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
        if (errObj.code) {
          return { jsonrpc: '2.0', id, error: { code: errObj.code, message: errObj.message || 'Tool error' } };
        }
        // Timeout or other execution errors
        const message = err instanceof Error ? err.message : String(err);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${message}` }],
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
