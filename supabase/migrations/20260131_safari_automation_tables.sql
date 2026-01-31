-- Safari Automation Tables Migration
-- Stores commands, videos, watermark removals, events, and sessions

-- ============================================================================
-- SAFARI_COMMANDS - Track all Safari Automation commands
-- ============================================================================
CREATE TABLE IF NOT EXISTS safari_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id TEXT UNIQUE NOT NULL,
  idempotency_key TEXT UNIQUE,
  correlation_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  payload JSONB DEFAULT '{}',
  result JSONB,
  error TEXT,
  requester_service TEXT,
  requester_instance TEXT,
  target_session_id TEXT,
  target_account_id TEXT,
  target_platform TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  CONSTRAINT valid_status CHECK (status IN ('CREATED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  CONSTRAINT valid_type CHECK (type IN (
    'flow.run', 'action.run', 'selector.sweep', 'session.create', 'session.close',
    'sora.generate', 'sora.generate.clean', 'sora.batch', 'sora.batch.clean',
    'sora.poll', 'sora.download', 'sora.usage', 'sora.clean'
  ))
);

CREATE INDEX IF NOT EXISTS idx_safari_commands_status ON safari_commands(status);
CREATE INDEX IF NOT EXISTS idx_safari_commands_type ON safari_commands(type);
CREATE INDEX IF NOT EXISTS idx_safari_commands_created_at ON safari_commands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_safari_commands_correlation ON safari_commands(correlation_id) WHERE correlation_id IS NOT NULL;

-- ============================================================================
-- SAFARI_VIDEOS - Sora video catalog (raw + cleaned paths)
-- ============================================================================
CREATE TABLE IF NOT EXISTS safari_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command_id TEXT REFERENCES safari_commands(command_id),
  prompt TEXT NOT NULL,
  character TEXT DEFAULT 'isaiahdupree',
  raw_path TEXT,
  raw_size BIGINT,
  cleaned_path TEXT,
  cleaned_size BIGINT,
  duration_seconds INTEGER,
  generation_time_ms BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  cleaned_at TIMESTAMPTZ,
  
  CONSTRAINT valid_video_status CHECK (status IN ('pending', 'generating', 'ready', 'cleaning', 'cleaned', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_safari_videos_command ON safari_videos(command_id);
CREATE INDEX IF NOT EXISTS idx_safari_videos_character ON safari_videos(character);
CREATE INDEX IF NOT EXISTS idx_safari_videos_status ON safari_videos(status);
CREATE INDEX IF NOT EXISTS idx_safari_videos_created_at ON safari_videos(created_at DESC);

-- ============================================================================
-- WATERMARK_REMOVALS - Watermark removal operation tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS watermark_removals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID REFERENCES safari_videos(id),
  command_id TEXT REFERENCES safari_commands(command_id),
  input_path TEXT NOT NULL,
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  file_size BIGINT,
  processing_time_ms BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  CONSTRAINT valid_removal_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_watermark_removals_video ON watermark_removals(video_id);
CREATE INDEX IF NOT EXISTS idx_watermark_removals_command ON watermark_removals(command_id);
CREATE INDEX IF NOT EXISTS idx_watermark_removals_status ON watermark_removals(status);

-- ============================================================================
-- SAFARI_EVENTS - Telemetry events for audit/replay
-- ============================================================================
CREATE TABLE IF NOT EXISTS safari_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT UNIQUE NOT NULL,
  command_id TEXT,
  correlation_id TEXT,
  cursor TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  payload JSONB DEFAULT '{}',
  target_session_id TEXT,
  target_account_id TEXT,
  target_platform TEXT,
  emitted_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT valid_severity CHECK (severity IN ('debug', 'info', 'warn', 'error')),
  CONSTRAINT valid_event_type CHECK (type IN (
    'status.changed', 'action.attempted', 'action.verified', 'selector.missing',
    'rate.limited', 'human.required', 'artifact.captured',
    'sora.prompt.submitted', 'sora.polling.started', 'sora.video.ready',
    'sora.video.downloaded', 'sora.video.cleaned', 'sora.usage.checked'
  ))
);

CREATE INDEX IF NOT EXISTS idx_safari_events_command ON safari_events(command_id);
CREATE INDEX IF NOT EXISTS idx_safari_events_cursor ON safari_events(cursor);
CREATE INDEX IF NOT EXISTS idx_safari_events_type ON safari_events(type);
CREATE INDEX IF NOT EXISTS idx_safari_events_emitted_at ON safari_events(emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_safari_events_correlation ON safari_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- ============================================================================
-- SAFARI_SESSIONS - Browser session tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS safari_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT UNIQUE NOT NULL,
  platform TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  account_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  
  CONSTRAINT valid_session_status CHECK (status IN ('active', 'idle', 'closed', 'error')),
  CONSTRAINT valid_platform CHECK (platform IN ('sora', 'instagram', 'tiktok', 'threads', 'x'))
);

CREATE INDEX IF NOT EXISTS idx_safari_sessions_status ON safari_sessions(status);
CREATE INDEX IF NOT EXISTS idx_safari_sessions_platform ON safari_sessions(platform);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- All videos with watermark removed
CREATE OR REPLACE VIEW watermark_free_videos AS
SELECT 
  v.id,
  v.command_id,
  v.prompt,
  v.character,
  v.cleaned_path,
  v.cleaned_size,
  v.duration_seconds,
  v.generation_time_ms,
  v.created_at,
  v.cleaned_at,
  c.requester_service
FROM safari_videos v
LEFT JOIN safari_commands c ON v.command_id = c.command_id
WHERE v.cleaned_path IS NOT NULL
  AND v.status = 'cleaned';

-- Command execution metrics
CREATE OR REPLACE VIEW safari_command_performance AS
SELECT 
  type,
  status,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE status = 'SUCCEEDED') as success_count,
  COUNT(*) FILTER (WHERE status = 'FAILED') as fail_count,
  ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 2) as avg_duration_seconds,
  ROUND(MIN(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 2) as min_duration_seconds,
  ROUND(MAX(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric, 2) as max_duration_seconds,
  MIN(created_at) as first_command,
  MAX(created_at) as last_command
FROM safari_commands
WHERE started_at IS NOT NULL
GROUP BY type, status
ORDER BY type, status;

-- Recent video generation summary
CREATE OR REPLACE VIEW recent_video_summary AS
SELECT 
  DATE_TRUNC('day', created_at) as day,
  character,
  COUNT(*) as total_videos,
  COUNT(*) FILTER (WHERE status = 'cleaned') as cleaned_videos,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_videos,
  SUM(raw_size) as total_raw_bytes,
  SUM(cleaned_size) as total_cleaned_bytes,
  ROUND(AVG(generation_time_ms)::numeric / 1000, 1) as avg_gen_time_seconds
FROM safari_videos
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), character
ORDER BY day DESC, character;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE safari_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE safari_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE watermark_removals ENABLE ROW LEVEL SECURITY;
ALTER TABLE safari_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE safari_sessions ENABLE ROW LEVEL SECURITY;

-- Service role has full access
CREATE POLICY "Service role full access on commands" ON safari_commands
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on videos" ON safari_videos
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on removals" ON watermark_removals
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on events" ON safari_events
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on sessions" ON safari_sessions
  FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read videos and events
CREATE POLICY "Authenticated read videos" ON safari_videos
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read events" ON safari_events
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER safari_commands_updated_at
  BEFORE UPDATE ON safari_commands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Function to get command with all related data
CREATE OR REPLACE FUNCTION get_command_details(p_command_id TEXT)
RETURNS TABLE (
  command JSONB,
  videos JSONB,
  events JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    to_jsonb(c.*) as command,
    COALESCE(
      jsonb_agg(DISTINCT to_jsonb(v.*)) FILTER (WHERE v.id IS NOT NULL),
      '[]'::jsonb
    ) as videos,
    COALESCE(
      jsonb_agg(to_jsonb(e.*) ORDER BY e.cursor) FILTER (WHERE e.id IS NOT NULL),
      '[]'::jsonb
    ) as events
  FROM safari_commands c
  LEFT JOIN safari_videos v ON v.command_id = c.command_id
  LEFT JOIN safari_events e ON e.command_id = c.command_id
  WHERE c.command_id = p_command_id
  GROUP BY c.id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON watermark_free_videos TO authenticated;
GRANT SELECT ON safari_command_performance TO authenticated;
GRANT SELECT ON recent_video_summary TO authenticated;
