/**
 * Protocol Types for Safari Manager Control + Telemetry Interface
 */

// Command Types
export type CommandType =
  | 'flow.run'
  | 'action.run'
  | 'selector.sweep'
  | 'session.create'
  | 'session.close'
  | 'sora.generate'
  | 'sora.batch'
  | 'sora.poll'
  | 'sora.download'
  | 'sora.usage';

export type Platform = 'instagram' | 'tiktok' | 'threads' | 'x' | 'sora';

export type CommandStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface CommandEnvelope {
  version: '1.0';
  command_id: string;
  idempotency_key?: string;
  correlation_id?: string;
  requested_at: string;
  requester?: {
    service: string;
    instance_id?: string;
  };
  target?: {
    session_id?: string;
    account_id?: string;
    platform?: Platform;
  };
  type: CommandType;
  payload: Record<string, unknown>;
}

export interface CommandState {
  command_id: string;
  status: CommandStatus;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  result?: Record<string, unknown>;
  error?: string;
}

// Event Types
export type EventType =
  | 'status.changed'
  | 'action.attempted'
  | 'action.verified'
  | 'selector.missing'
  | 'rate.limited'
  | 'human.required'
  | 'artifact.captured'
  | 'sora.prompt.submitted'
  | 'sora.polling.started'
  | 'sora.video.ready'
  | 'sora.video.downloaded'
  | 'sora.usage.checked';

export type Severity = 'debug' | 'info' | 'warn' | 'error';

export interface EventEnvelope {
  version: '1.0';
  event_id: string;
  correlation_id?: string;
  command_id?: string;
  cursor: string;
  emitted_at: string;
  severity: Severity;
  type: EventType;
  target?: {
    session_id?: string;
    account_id?: string;
    platform?: Platform;
  };
  payload: Record<string, unknown>;
}

// WebSocket Messages
export interface SubscribeMessage {
  type: 'subscribe';
  cursor?: string;
  filters?: {
    severity?: Severity[];
    event_types?: EventType[];
  };
}

export interface SubscribedMessage {
  type: 'subscribed';
  cursor: string;
}

// API Response Types
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
}

export interface ReadyResponse {
  ready: boolean;
  checks: {
    database: boolean;
    safari: boolean;
    selectors: boolean;
  };
}

export interface SessionInfo {
  session_id: string;
  created_at: string;
  platform?: Platform;
  account_id?: string;
  status: 'active' | 'closed';
}

export interface CommandResponse {
  command_id: string;
  status: CommandStatus;
  accepted_at: string;
}

// Sora-specific payloads
export interface SoraGeneratePayload {
  prompt: string;
  character?: string;
  duration?: '5s' | '10s' | '15s' | '20s';
  aspect_ratio?: '16:9' | '9:16' | '1:1';
}

export interface SoraBatchPayload {
  prompts: string[];
  character?: string;
}

export interface SoraUsageResult {
  video_gens_left: number | null;
  free_count: number | null;
  paid_count: number | null;
  next_available_date: string | null;
}

export interface SoraGenerateResult {
  video_path: string;
  file_size: number;
  duration_ms: number;
}
