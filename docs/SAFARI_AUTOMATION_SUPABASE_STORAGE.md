# Safari Automation Supabase Storage

**Last Updated:** January 31, 2026  
**Status:** Active  
**Database:** MediaPoster Supabase (`pknisqgcafosnjezcdtt`)

---

## Overview

This document describes how Safari Automation service data is persisted in MediaPoster's Supabase database. This enables:

- **Command History**: Track all Safari automation commands
- **Video Catalog**: Store Sora video metadata and watermark removal results
- **Telemetry**: Persist events for audit and replay
- **Analytics**: Performance tracking for automation workflows

---

## Architecture

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  Safari Automation      │         │  MediaPoster Backend    │
│  Service (:7070/:7071)  │         │  (Python/FastAPI)       │
│                         │         │                         │
│  ┌───────────────────┐  │  HTTP   │  ┌───────────────────┐  │
│  │ Control Server    │──┼─────────┼──│ SafariAutomation  │  │
│  │                   │  │         │  │ Client            │  │
│  └───────────────────┘  │         │  └─────────┬─────────┘  │
│                         │         │            │            │
│  ┌───────────────────┐  │   WS    │            │            │
│  │ Telemetry Server  │──┼─────────┼────────────┤            │
│  │                   │  │         │            │            │
│  └───────────────────┘  │         │            ▼            │
│                         │         │  ┌───────────────────┐  │
└─────────────────────────┘         │  │ Supabase Client   │  │
                                    │  │                   │  │
                                    │  └─────────┬─────────┘  │
                                    │            │            │
                                    └────────────┼────────────┘
                                                 │
                                                 ▼
                                    ┌─────────────────────────┐
                                    │  Supabase Database      │
                                    │  (PostgreSQL)           │
                                    │                         │
                                    │  - safari_commands      │
                                    │  - safari_videos        │
                                    │  - safari_events        │
                                    │  - watermark_removals   │
                                    │  - safari_sessions      │
                                    └─────────────────────────┘
```

---

## Database Tables

### 1. `safari_commands`

Stores all commands sent to Safari Automation service.

| Column | Type | Description |
|--------|------|-------------|
| `command_id` | UUID | Primary key (from Safari Automation) |
| `type` | VARCHAR(100) | Command type (e.g., `sora.generate.clean`) |
| `status` | VARCHAR(50) | QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED |
| `payload` | JSONB | Command payload (prompt, character, etc.) |
| `result` | JSONB | Command result (video paths, sizes, etc.) |
| `target` | JSONB | Target info (session_id, account_id, platform) |
| `error_message` | TEXT | Error details if failed |
| `idempotency_key` | VARCHAR(255) | For deduplication |
| `created_at` | TIMESTAMPTZ | When command was created |
| `started_at` | TIMESTAMPTZ | When execution started |
| `completed_at` | TIMESTAMPTZ | When execution completed |
| `updated_at` | TIMESTAMPTZ | Last update time |

**Indexes:**
- `idx_safari_commands_type` - Filter by command type
- `idx_safari_commands_status` - Filter by status
- `idx_safari_commands_created_at` - Sort by creation time

---

### 2. `safari_videos`

Catalog of all Sora videos generated via Safari Automation.

| Column | Type | Description |
|--------|------|-------------|
| `video_id` | UUID | Primary key |
| `command_id` | UUID | FK to safari_commands |
| `prompt` | TEXT | Generation prompt |
| `character` | VARCHAR(100) | Character used |
| `duration` | VARCHAR(20) | Video duration (e.g., "20s") |
| `aspect_ratio` | VARCHAR(20) | Aspect ratio (e.g., "16:9") |
| `raw_path` | TEXT | Path to original video (with watermark) |
| `raw_size_bytes` | BIGINT | Size of raw video |
| `cleaned_path` | TEXT | Path to watermark-free video |
| `cleaned_size_bytes` | BIGINT | Size of cleaned video |
| `thumbnail_path` | TEXT | Generated thumbnail path |
| `status` | VARCHAR(50) | GENERATING, DOWNLOADED, CLEANING, CLEANED, FAILED |
| `sora_draft_id` | VARCHAR(255) | Sora internal draft ID |
| `metadata` | JSONB | Additional metadata |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update |

**Indexes:**
- `idx_safari_videos_command` - Join with commands
- `idx_safari_videos_status` - Filter by status
- `idx_safari_videos_character` - Filter by character

---

### 3. `watermark_removals`

Tracks watermark removal operations.

| Column | Type | Description |
|--------|------|-------------|
| `removal_id` | UUID | Primary key |
| `video_id` | UUID | FK to safari_videos (optional) |
| `command_id` | UUID | FK to safari_commands |
| `input_path` | TEXT | Input video path |
| `output_path` | TEXT | Output video path |
| `input_size_bytes` | BIGINT | Input file size |
| `output_size_bytes` | BIGINT | Output file size |
| `method` | VARCHAR(50) | Removal method (lama, ai_inpainting, etc.) |
| `processing_time_ms` | INTEGER | Time taken in milliseconds |
| `success` | BOOLEAN | Whether removal succeeded |
| `error_message` | TEXT | Error if failed |
| `created_at` | TIMESTAMPTZ | When started |
| `completed_at` | TIMESTAMPTZ | When completed |

**Indexes:**
- `idx_watermark_removals_video` - Join with videos
- `idx_watermark_removals_success` - Filter by success

---

### 4. `safari_events`

Persists telemetry events for audit and replay.

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | UUID | Primary key |
| `command_id` | UUID | FK to safari_commands |
| `correlation_id` | UUID | For tracking related events |
| `type` | VARCHAR(100) | Event type (status.changed, action.verified, etc.) |
| `severity` | VARCHAR(20) | debug, info, warn, error |
| `payload` | JSONB | Event payload |
| `cursor` | VARCHAR(100) | Telemetry cursor for replay |
| `emitted_at` | TIMESTAMPTZ | When event was emitted |
| `stored_at` | TIMESTAMPTZ | When stored in database |

**Indexes:**
- `idx_safari_events_command` - Filter by command
- `idx_safari_events_type` - Filter by event type
- `idx_safari_events_cursor` - For replay functionality
- `idx_safari_events_emitted_at` - Sort by time

---

### 5. `safari_sessions`

Tracks Safari browser sessions.

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | UUID | Primary key |
| `platform` | VARCHAR(50) | Platform (sora, instagram, tiktok, etc.) |
| `account_id` | UUID | Associated account |
| `status` | VARCHAR(50) | active, closed, expired |
| `browser_pid` | INTEGER | Safari process ID |
| `started_at` | TIMESTAMPTZ | Session start time |
| `ended_at` | TIMESTAMPTZ | Session end time |
| `metadata` | JSONB | Session metadata |
| `created_at` | TIMESTAMPTZ | Creation time |
| `updated_at` | TIMESTAMPTZ | Last update |

---

## SQL Migration

```sql
-- Safari Automation Tables for MediaPoster
-- Migration: 20260131000000_safari_automation_tables.sql

-- Safari Commands Table
CREATE TABLE IF NOT EXISTS safari_commands (
    command_id UUID PRIMARY KEY,
    type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
    payload JSONB,
    result JSONB,
    target JSONB,
    error_message TEXT,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safari_commands_type ON safari_commands(type);
CREATE INDEX idx_safari_commands_status ON safari_commands(status);
CREATE INDEX idx_safari_commands_created_at ON safari_commands(created_at DESC);
CREATE UNIQUE INDEX idx_safari_commands_idempotency ON safari_commands(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Safari Videos Table
CREATE TABLE IF NOT EXISTS safari_videos (
    video_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    command_id UUID REFERENCES safari_commands(command_id) ON DELETE SET NULL,
    prompt TEXT,
    character VARCHAR(100),
    duration VARCHAR(20),
    aspect_ratio VARCHAR(20),
    raw_path TEXT,
    raw_size_bytes BIGINT,
    cleaned_path TEXT,
    cleaned_size_bytes BIGINT,
    thumbnail_path TEXT,
    status VARCHAR(50) DEFAULT 'GENERATING',
    sora_draft_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safari_videos_command ON safari_videos(command_id);
CREATE INDEX idx_safari_videos_status ON safari_videos(status);
CREATE INDEX idx_safari_videos_character ON safari_videos(character);
CREATE INDEX idx_safari_videos_created_at ON safari_videos(created_at DESC);

-- Watermark Removals Table
CREATE TABLE IF NOT EXISTS watermark_removals (
    removal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID REFERENCES safari_videos(video_id) ON DELETE SET NULL,
    command_id UUID REFERENCES safari_commands(command_id) ON DELETE SET NULL,
    input_path TEXT NOT NULL,
    output_path TEXT,
    input_size_bytes BIGINT,
    output_size_bytes BIGINT,
    method VARCHAR(50) DEFAULT 'lama',
    processing_time_ms INTEGER,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_watermark_removals_video ON watermark_removals(video_id);
CREATE INDEX idx_watermark_removals_command ON watermark_removals(command_id);
CREATE INDEX idx_watermark_removals_success ON watermark_removals(success);

-- Safari Events Table
CREATE TABLE IF NOT EXISTS safari_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    command_id UUID REFERENCES safari_commands(command_id) ON DELETE CASCADE,
    correlation_id UUID,
    type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) DEFAULT 'info',
    payload JSONB,
    cursor VARCHAR(100),
    emitted_at TIMESTAMPTZ NOT NULL,
    stored_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safari_events_command ON safari_events(command_id);
CREATE INDEX idx_safari_events_type ON safari_events(type);
CREATE INDEX idx_safari_events_cursor ON safari_events(cursor);
CREATE INDEX idx_safari_events_emitted_at ON safari_events(emitted_at DESC);

-- Safari Sessions Table
CREATE TABLE IF NOT EXISTS safari_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform VARCHAR(50) NOT NULL,
    account_id UUID,
    status VARCHAR(50) DEFAULT 'active',
    browser_pid INTEGER,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safari_sessions_platform ON safari_sessions(platform);
CREATE INDEX idx_safari_sessions_status ON safari_sessions(status);

-- Add updated_at triggers
CREATE TRIGGER update_safari_commands_updated_at 
    BEFORE UPDATE ON safari_commands 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_safari_videos_updated_at 
    BEFORE UPDATE ON safari_videos 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_safari_sessions_updated_at 
    BEFORE UPDATE ON safari_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE safari_commands IS 'Commands sent to Safari Automation service';
COMMENT ON TABLE safari_videos IS 'Sora videos generated via Safari Automation';
COMMENT ON TABLE watermark_removals IS 'Watermark removal operations tracking';
COMMENT ON TABLE safari_events IS 'Telemetry events from Safari Automation';
COMMENT ON TABLE safari_sessions IS 'Safari browser session tracking';
```

---

## Views

### Watermark-Free Videos Summary

```sql
CREATE OR REPLACE VIEW watermark_free_videos AS
SELECT 
    v.video_id,
    v.prompt,
    v.character,
    v.duration,
    v.cleaned_path,
    v.cleaned_size_bytes,
    v.status,
    c.type as command_type,
    c.status as command_status,
    v.created_at
FROM safari_videos v
LEFT JOIN safari_commands c ON v.command_id = c.command_id
WHERE v.cleaned_path IS NOT NULL
ORDER BY v.created_at DESC;
```

### Command Performance Summary

```sql
CREATE OR REPLACE VIEW safari_command_performance AS
SELECT 
    type,
    status,
    COUNT(*) as total_commands,
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) as avg_duration_ms,
    COUNT(CASE WHEN status = 'SUCCEEDED' THEN 1 END) as succeeded,
    COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed
FROM safari_commands
WHERE started_at IS NOT NULL
GROUP BY type, status
ORDER BY total_commands DESC;
```

---

## Python Usage

### Store Command

```python
from supabase import create_client
import os

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"]
)

def store_command(command_id: str, command_type: str, payload: dict):
    """Store a Safari Automation command in Supabase."""
    return supabase.table("safari_commands").insert({
        "command_id": command_id,
        "type": command_type,
        "status": "QUEUED",
        "payload": payload
    }).execute()

def update_command_status(command_id: str, status: str, result: dict = None):
    """Update command status and result."""
    data = {"status": status}
    if result:
        data["result"] = result
    if status == "RUNNING":
        data["started_at"] = "now()"
    elif status in ("SUCCEEDED", "FAILED", "CANCELLED"):
        data["completed_at"] = "now()"
    
    return supabase.table("safari_commands").update(data).eq(
        "command_id", command_id
    ).execute()
```

### Store Video

```python
def store_video(command_id: str, prompt: str, character: str = None):
    """Store a new Sora video record."""
    return supabase.table("safari_videos").insert({
        "command_id": command_id,
        "prompt": prompt,
        "character": character,
        "status": "GENERATING"
    }).execute()

def update_video_cleaned(video_id: str, cleaned_path: str, cleaned_size: int):
    """Update video with cleaned (watermark-free) path."""
    return supabase.table("safari_videos").update({
        "cleaned_path": cleaned_path,
        "cleaned_size_bytes": cleaned_size,
        "status": "CLEANED"
    }).eq("video_id", video_id).execute()
```

### Query Watermark-Free Videos

```python
def get_watermark_free_videos(limit: int = 50):
    """Get all watermark-free videos."""
    return supabase.table("safari_videos").select(
        "video_id, prompt, character, cleaned_path, cleaned_size_bytes, created_at"
    ).not_.is_("cleaned_path", "null").order(
        "created_at", desc=True
    ).limit(limit).execute()
```

### Store Event

```python
def store_event(event: dict):
    """Store a telemetry event."""
    return supabase.table("safari_events").insert({
        "event_id": event.get("event_id"),
        "command_id": event.get("command_id"),
        "correlation_id": event.get("correlation_id"),
        "type": event.get("type"),
        "severity": event.get("severity", "info"),
        "payload": event.get("payload"),
        "cursor": event.get("cursor"),
        "emitted_at": event.get("emitted_at")
    }).execute()
```

---

## Integration with Safari Automation Client

The `SafariAutomationClient` can be extended to automatically persist data:

```python
from services.safari_automation_client import SafariAutomationClient

class SafariAutomationClientWithStorage(SafariAutomationClient):
    """Safari Automation client with Supabase persistence."""
    
    def __init__(self, supabase_client, **kwargs):
        super().__init__(**kwargs)
        self.db = supabase_client
    
    def generate_clean_video(self, prompt: str, **kwargs) -> dict:
        """Generate video and persist to Supabase."""
        result = super().generate_clean_video(prompt, **kwargs)
        
        if result.get("command_id"):
            # Store command
            self.db.table("safari_commands").upsert({
                "command_id": result["command_id"],
                "type": "sora.generate.clean",
                "status": result.get("status", "QUEUED"),
                "payload": {"prompt": prompt, **kwargs},
                "result": result.get("result")
            }).execute()
            
            # Store video if successful
            if result.get("status") == "SUCCEEDED":
                video_result = result.get("result", {})
                self.db.table("safari_videos").insert({
                    "command_id": result["command_id"],
                    "prompt": prompt,
                    "character": kwargs.get("character"),
                    "raw_path": video_result.get("video_path"),
                    "raw_size_bytes": video_result.get("file_size"),
                    "cleaned_path": video_result.get("cleaned_path"),
                    "cleaned_size_bytes": video_result.get("cleaned_size"),
                    "status": "CLEANED"
                }).execute()
        
        return result
```

---

## Related Documentation

| Doc | Location |
|-----|----------|
| Safari Automation API | `docs/SAFARI_AUTOMATION_SERVICE_API.md` |
| Main Database Schema | `Backend/database/schema.sql` |
| Supabase Migrations | `supabase/migrations/` |
| Engineering Design | `Safari Automation/docs/control-and-telemetry-interface.md` |
