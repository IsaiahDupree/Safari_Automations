/**
 * BAC-002: UnifiedBrowserCommand Router
 *
 * Dispatch layer that routes browser commands to the correct service
 * based on platform registration in actp_browser_agents registry.
 */

import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BrowserAgent {
  id: string;
  platform: string;
  browser_type: string;
  service_url: string;
  supported_actions: string[];
  health_status: string;
  metadata: Record<string, any>;
  registered_at: string;
  last_heartbeat_at: string | null;
}

export interface BrowserCommandRequest {
  platform: string;
  action: string;
  params: Record<string, any>;
  task_id?: string;
}

export interface BrowserCommandResponse {
  success: boolean;
  result?: any;
  screenshot_url?: string;
  error?: string;
  metadata?: Record<string, any>;
}

// ─── Schema Validation ────────────────────────────────────────────────────────

export const BrowserCommandSchema = z.object({
  platform: z.string().min(1),
  action: z.string().min(1),
  params: z.record(z.any()).optional().default({}),
  task_id: z.string().optional(),
});

// ─── Registry Client ──────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Fetch browser agent for a platform from Supabase registry.
 */
async function getAgent(platform: string, requireHealthy: boolean = true): Promise<BrowserAgent | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[router] Missing Supabase credentials');
    return null;
  }

  try {
    let url = `${SUPABASE_URL}/rest/v1/actp_browser_agents?platform=eq.${platform.toLowerCase()}&limit=1`;

    if (requireHealthy) {
      url += '&health_status=eq.healthy';
    }

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[router] Supabase returned ${response.status} for platform ${platform}`);
      return null;
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[router] No ${requireHealthy ? 'healthy ' : ''}agent found for platform: ${platform}`);
      return null;
    }

    return data[0] as BrowserAgent;

  } catch (error) {
    console.error(`[router] Failed to fetch agent for ${platform}:`, error);
    return null;
  }
}

/**
 * List all registered agents, optionally filtered by health status.
 */
export async function listAgents(healthStatus?: string): Promise<BrowserAgent[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[router] Missing Supabase credentials');
    return [];
  }

  try {
    let url = `${SUPABASE_URL}/rest/v1/actp_browser_agents`;

    if (healthStatus) {
      url += `?health_status=eq.${healthStatus}`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[router] Supabase returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data as BrowserAgent[];

  } catch (error) {
    console.error('[router] Failed to list agents:', error);
    return [];
  }
}

// ─── Action Routing ───────────────────────────────────────────────────────────

/**
 * Map generic action names to platform-specific endpoints.
 */
function mapActionToEndpoint(action: string, agent: BrowserAgent): string | null {
  // Common mappings for all platforms
  const commonMappings: Record<string, string> = {
    'search': '/api/search',
    'extract': '/api/extract',
    'health': '/health',
    'status': '/health',
  };

  // Platform-specific mappings
  const platformMappings: Record<string, Record<string, string>> = {
    'instagram': {
      'dm': '/api/dm/send',
      'send_dm': '/api/dm/send',
      'comment': '/api/comment',
      'list_conversations': '/api/dm/conversations',
      'read_messages': '/api/dm/messages',
    },
    'tiktok': {
      'dm': '/api/dm/send',
      'send_dm': '/api/dm/send',
      'comment': '/api/comment',
    },
    'twitter': {
      'dm': '/api/dm/send',
      'send_dm': '/api/dm/send',
      'comment': '/api/comment',
      'tweet': '/api/tweet',
    },
    'threads': {
      'dm': '/api/dm/send',
      'send_dm': '/api/dm/send',
      'comment': '/api/comment',
      'post': '/api/post',
    },
    'linkedin': {
      'search_people': '/api/search/people',
      'view_profile': '/api/profile/view',
      'extract_profile': '/api/profile/extract',
      'send_connection': '/api/connection/send',
      'send_message': '/api/message/send',
      'search': '/api/search',
    },
    'upwork': {
      'search_jobs': '/api/jobs/search',
      'extract_job': '/api/jobs/extract',
      'submit_proposal': '/api/proposal/submit',
      'check_inbox': '/api/inbox',
    },
  };

  // Check platform-specific mapping first
  const platformMap = platformMappings[agent.platform];
  if (platformMap && platformMap[action]) {
    return platformMap[action];
  }

  // Fall back to common mapping
  if (commonMappings[action]) {
    return commonMappings[action];
  }

  // If action is already a path (starts with /), use it directly
  if (action.startsWith('/')) {
    return action;
  }

  // Try to construct endpoint from action name
  return `/api/${action}`;
}

/**
 * Dispatch a browser command to the appropriate service.
 */
export async function dispatchCommand(
  request: BrowserCommandRequest
): Promise<BrowserCommandResponse> {
  const { platform, action, params, task_id } = request;

  console.log(`[router] Dispatching ${action} to ${platform}${task_id ? ` (task: ${task_id})` : ''}`);

  // Look up agent
  const agent = await getAgent(platform);

  if (!agent) {
    return {
      success: false,
      error: `No healthy agent found for platform: ${platform}`,
    };
  }

  // Check if action is supported
  if (agent.supported_actions && agent.supported_actions.length > 0) {
    if (!agent.supported_actions.includes(action)) {
      console.warn(
        `[router] Action ${action} not in supported_actions for ${platform}: ${agent.supported_actions.join(', ')}`
      );
    }
  }

  // Map action to endpoint
  const endpoint = mapActionToEndpoint(action, agent);

  if (!endpoint) {
    return {
      success: false,
      error: `Unknown action: ${action} for platform: ${platform}`,
    };
  }

  const targetUrl = `${agent.service_url}${endpoint}`;

  try {
    console.log(`[router] Proxying to ${targetUrl}`);

    // Forward the request to the agent service
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return {
        success: false,
        error: `Service returned ${response.status}: ${errorText}`,
        metadata: {
          service_url: agent.service_url,
          platform: agent.platform,
          browser_type: agent.browser_type,
        },
      };
    }

    const result = await response.json();

    // Normalize response format
    return {
      success: true,
      result,
      metadata: {
        service_url: agent.service_url,
        platform: agent.platform,
        browser_type: agent.browser_type,
        action,
      },
    };

  } catch (error) {
    console.error(`[router] Failed to dispatch ${action} to ${platform}:`, error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      metadata: {
        service_url: agent.service_url,
        platform: agent.platform,
        browser_type: agent.browser_type,
      },
    };
  }
}

/**
 * Health check all registered agents.
 */
export async function healthCheckAll(): Promise<Record<string, any>> {
  const agents = await listAgents();

  if (agents.length === 0) {
    return { status: 'warning', message: 'No agents registered', agents: [] };
  }

  const results = await Promise.all(
    agents.map(async (agent) => {
      try {
        const healthUrl = `${agent.service_url}/health`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(healthUrl, {
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const healthy = response.ok;

        return {
          platform: agent.platform,
          browser_type: agent.browser_type,
          service_url: agent.service_url,
          status: healthy ? 'healthy' : 'unhealthy',
          status_code: response.status,
          last_heartbeat: agent.last_heartbeat_at,
        };

      } catch (error) {
        return {
          platform: agent.platform,
          browser_type: agent.browser_type,
          service_url: agent.service_url,
          status: 'unreachable',
          error: error instanceof Error ? error.message : 'Unknown error',
          last_heartbeat: agent.last_heartbeat_at,
        };
      }
    })
  );

  const healthyCount = results.filter(r => r.status === 'healthy').length;
  const totalCount = results.length;

  return {
    status: healthyCount === totalCount ? 'ok' : healthyCount > 0 ? 'degraded' : 'down',
    healthy_count: healthyCount,
    total_count: totalCount,
    agents: results,
  };
}
