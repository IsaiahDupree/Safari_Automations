// ─── Command Queue Types ──────────────────────────────────────────────────────

export type CommandStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'VERIFICATION_FAILED'
  | 'CANCELLED';

export type CommandType =
  | 'sora.generate'        // generate video from prompt
  | 'sora.generate.clean'  // generate + remove watermark
  | 'sora.clean'           // remove watermark from existing video
  | 'upload.tiktok'
  | 'upload.instagram'
  | 'upload.twitter'
  | 'upload.threads'
  | 'upload.youtube'
  | 'upload.reddit';

export interface CommandPayload {
  // sora.generate / sora.generate.clean
  prompt?: string;
  duration?: string;          // e.g. '5s', '10s', '20s'
  aspect_ratio?: string;      // e.g. '9:16', '16:9', '1:1'
  character?: string;         // optional character reference

  // sora.clean / sora.generate.clean
  video_path?: string;        // local file path to clean

  // upload.*
  caption?: string;
  platform?: string;
}

export interface CommandResult {
  video_path?: string;        // raw generated video (local)
  cleaned_path?: string;      // watermark-removed video (local)
  file_size?: number;
  cleaned_size?: number;
  post_url?: string;          // for upload commands
  url?: string;
}

export interface Command {
  id: string;
  type: CommandType;
  payload: CommandPayload;
  status: CommandStatus;
  result: CommandResult | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ─── Sora Usage ───────────────────────────────────────────────────────────────

export interface SoraUsage {
  videos_generated_today: number;
  daily_limit: number;
  remaining: number;
  plan: string;
}

// ─── Telemetry Events ────────────────────────────────────────────────────────

export type TelemetryEventType =
  | 'status.changed'
  | 'sora.video.downloaded'
  | 'sora.video.cleaned'
  | 'human.required'
  | 'rate.limited'
  | 'progress';

export interface TelemetryEvent {
  type: TelemetryEventType;
  commandId: string;
  timestamp: string;
  data: Record<string, unknown>;
}
