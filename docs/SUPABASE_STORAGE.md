# Safari Automation - Supabase Storage Integration

This document describes the database schema and storage patterns for persisting Safari Automation data to Supabase.

## Overview

Safari Automation generates:
- **Commands** - Requests from external services (sora.generate, sora.clean, etc.)
- **Videos** - Sora-generated videos with raw and cleaned (watermark-free) versions
- **Events** - Telemetry for audit trails and debugging
- **Sessions** - Browser session state

All of this data is stored in Supabase for:
- Persistence across restarts
- Query and analytics
- Audit compliance
- Multi-service access

---

## Tables

### `safari_commands`

Tracks all commands submitted to Safari Automation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `command_id` | text | External command ID (from Control API) |
| `idempotency_key` | text | Prevents duplicate execution |
| `correlation_id` | text | Links related commands |
| `type` | text | Command type (sora.generate, sora.clean, etc.) |
| `status` | text | CREATED, QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED |
| `payload` | jsonb | Command parameters |
| `result` | jsonb | Execution result |
| `error` | text | Error message if failed |
| `requester_service` | text | Service that submitted command |
| `created_at` | timestamptz | When command was created |
| `started_at` | timestamptz | When execution started |
| `completed_at` | timestamptz | When execution finished |

**Indexes:**
- `command_id` (unique)
- `idempotency_key` (unique, nullable)
- `status`
- `type`
- `created_at`

---

### `safari_videos`

Catalog of all Sora-generated videos.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `command_id` | text | Links to safari_commands |
| `prompt` | text | The prompt used to generate |
| `character` | text | Character prefix (e.g., isaiahdupree) |
| `raw_path` | text | Path to original video with watermark |
| `raw_size` | bigint | File size in bytes |
| `cleaned_path` | text | Path to watermark-free version |
| `cleaned_size` | bigint | Cleaned file size |
| `duration_seconds` | integer | Video duration |
| `generation_time_ms` | bigint | How long generation took |
| `status` | text | pending, ready, cleaned, failed |
| `metadata` | jsonb | Additional metadata |
| `created_at` | timestamptz | When video was created |
| `cleaned_at` | timestamptz | When watermark was removed |

**Indexes:**
- `command_id`
- `character`
- `status`
- `created_at`

---

### `watermark_removals`

Tracks watermark removal operations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `video_id` | uuid | Links to safari_videos |
| `command_id` | text | Links to safari_commands |
| `input_path` | text | Source video path |
| `output_path` | text | Cleaned video path |
| `status` | text | pending, processing, completed, failed |
| `file_size` | bigint | Output file size |
| `processing_time_ms` | bigint | How long removal took |
| `error` | text | Error message if failed |
| `created_at` | timestamptz | When removal was requested |
| `completed_at` | timestamptz | When removal finished |

**Indexes:**
- `video_id`
- `command_id`
- `status`

---

### `safari_events`

Telemetry events for audit and replay.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `event_id` | text | External event ID |
| `command_id` | text | Related command |
| `correlation_id` | text | Links related events |
| `cursor` | text | Monotonic cursor for replay |
| `type` | text | Event type (status.changed, sora.video.cleaned, etc.) |
| `severity` | text | debug, info, warn, error |
| `payload` | jsonb | Event data |
| `emitted_at` | timestamptz | When event occurred |
| `created_at` | timestamptz | When stored |

**Indexes:**
- `event_id` (unique)
- `command_id`
- `cursor`
- `type`
- `emitted_at`

---

### `safari_sessions`

Browser session tracking.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `session_id` | text | External session ID |
| `platform` | text | Platform (sora, instagram, etc.) |
| `status` | text | active, closed, error |
| `account_id` | text | Account identifier |
| `metadata` | jsonb | Session metadata |
| `created_at` | timestamptz | When session started |
| `last_active_at` | timestamptz | Last activity |
| `closed_at` | timestamptz | When session ended |

---

## Views

### `watermark_free_videos`

All videos that have been cleaned (watermark removed).

```sql
CREATE VIEW watermark_free_videos AS
SELECT 
  v.id,
  v.prompt,
  v.character,
  v.cleaned_path,
  v.cleaned_size,
  v.duration_seconds,
  v.created_at,
  v.cleaned_at
FROM safari_videos v
WHERE v.cleaned_path IS NOT NULL
  AND v.status = 'cleaned';
```

### `safari_command_performance`

Command execution metrics.

```sql
CREATE VIEW safari_command_performance AS
SELECT 
  type,
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds,
  MIN(EXTRACT(EPOCH FROM (completed_at - started_at))) as min_duration_seconds,
  MAX(EXTRACT(EPOCH FROM (completed_at - started_at))) as max_duration_seconds
FROM safari_commands
WHERE completed_at IS NOT NULL
GROUP BY type, status;
```

---

## Row Level Security (RLS)

All tables have RLS enabled. Policies:

```sql
-- Commands: service role can do everything
CREATE POLICY "Service role full access" ON safari_commands
  FOR ALL USING (auth.role() = 'service_role');

-- Videos: read access for authenticated users
CREATE POLICY "Authenticated read videos" ON safari_videos
  FOR SELECT USING (auth.role() = 'authenticated');
```

---

## Usage Examples

### Insert a Command

```typescript
const { data, error } = await supabase
  .from('safari_commands')
  .insert({
    command_id: crypto.randomUUID(),
    type: 'sora.generate.clean',
    status: 'CREATED',
    payload: {
      prompt: '@isaiahdupree riding a meteor through space',
      character: 'isaiahdupree'
    },
    requester_service: 'orchestrator'
  })
  .select()
  .single();
```

### Store a Generated Video

```typescript
const { data, error } = await supabase
  .from('safari_videos')
  .insert({
    command_id: commandId,
    prompt: '@isaiahdupree riding a meteor',
    character: 'isaiahdupree',
    raw_path: '/Users/isaiahdupree/sora-videos/badass/video.mp4',
    raw_size: 971234,
    status: 'ready',
    generation_time_ms: 220000
  })
  .select()
  .single();
```

### Update After Watermark Removal

```typescript
const { data, error } = await supabase
  .from('safari_videos')
  .update({
    cleaned_path: '/Users/isaiahdupree/sora-videos/badass/cleaned/cleaned_video.mp4',
    cleaned_size: 1146839,
    status: 'cleaned',
    cleaned_at: new Date().toISOString()
  })
  .eq('id', videoId);
```

### Query Watermark-Free Videos

```typescript
const { data, error } = await supabase
  .from('watermark_free_videos')
  .select('*')
  .eq('character', 'isaiahdupree')
  .order('created_at', { ascending: false });
```

### Stream Events for a Command

```typescript
const { data, error } = await supabase
  .from('safari_events')
  .select('*')
  .eq('command_id', commandId)
  .order('cursor', { ascending: true });
```

---

## Integration with Control/Telemetry API

The Supabase storage integrates with the existing Control (port 7070) and Telemetry (port 7071) APIs:

1. **Command Submission** (POST /v1/commands)
   - Inserts into `safari_commands`
   - Returns command_id

2. **Event Emission** (WebSocket /v1/stream)
   - Inserts into `safari_events`
   - Broadcasts to subscribers

3. **Video Completion**
   - Inserts into `safari_videos`
   - Updates `safari_commands` with result

4. **Watermark Removal**
   - Inserts into `watermark_removals`
   - Updates `safari_videos` with cleaned_path

---

## Environment Variables

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_ANON_KEY=your-anon-key
```

---

## Migration

Apply the migration:

```bash
# Using Supabase CLI
supabase db push

# Or manually
supabase migration up
```

See `supabase/migrations/20260131_safari_automation_tables.sql`
