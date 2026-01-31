# Safari Automation Service API

**Last Updated:** January 30, 2026  
**Status:** Active  
**Service Location:** `/Users/isaiahdupree/Documents/Software/Safari Automation`

---

## Overview

MediaPoster communicates with the Safari Automation service via HTTP REST (Control Plane) and WebSocket (Telemetry Plane) to command browser automation tasks and receive real-time status updates.

---

## Architecture

```
┌─────────────────────┐        ┌─────────────────────────────────┐
│   MediaPoster       │        │   Safari Automation Service     │
│   (Python Backend)  │        │                                 │
│                     │        │  ┌─────────────────────────┐   │
│  ┌───────────────┐  │  HTTP  │  │ Control Server (:7070)  │   │
│  │ SafariClient  │──┼────────┼──│ - Health/Ready          │   │
│  │               │  │        │  │ - Commands              │   │
│  │               │  │        │  │ - Sessions              │   │
│  │               │  │        │  │ - Sora/Usage            │   │
│  │               │  │   WS   │  └─────────────────────────┘   │
│  │               │──┼────────┼──┐                             │
│  └───────────────┘  │        │  │ Telemetry Server (:7071)    │
│                     │        │  │ - Real-time events          │
│                     │        │  │ - Status updates            │
│                     │        │  │ - Cursor replay             │
└─────────────────────┘        └──┴─────────────────────────────┘
```

---

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| **7070** | HTTP/REST | Control API - submit commands, query status, health checks |
| **7071** | WebSocket | Telemetry - real-time events, progress updates |

---

## Control API (HTTP :7070)

### Health & Readiness

#### `GET /health`
Check if the service is running.

```bash
curl http://localhost:7070/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-30T23:59:59.000Z"
}
```

#### `GET /ready`
Check if all dependencies are available.

```bash
curl http://localhost:7070/ready
```

**Response:**
```json
{
  "ready": true,
  "checks": {
    "database": true,
    "safari": true,
    "selectors": true
  }
}
```

---

### Commands

#### `POST /v1/commands`
Submit a command for execution. Returns immediately with `202 Accepted`.

```bash
curl -X POST http://localhost:7070/v1/commands \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "sora.generate",
    "payload": {
      "prompt": "@isaiahdupree riding a meteor through space",
      "character": "isaiahdupree"
    }
  }'
```

**Response:**
```json
{
  "command_id": "abc123-uuid",
  "status": "QUEUED",
  "accepted_at": "2026-01-30T23:59:59.000Z"
}
```

#### `GET /v1/commands/{command_id}`
Get the current status and result of a command.

```bash
curl http://localhost:7070/v1/commands/abc123-uuid
```

**Response:**
```json
{
  "command_id": "abc123-uuid",
  "type": "sora.generate.clean",
  "status": "SUCCEEDED",
  "created_at": "2026-01-30T23:59:00.000Z",
  "completed_at": "2026-01-30T23:59:59.000Z",
  "result": {
    "video_path": "/Users/.../sora-videos/sora-video-123.mp4",
    "file_size": 971234,
    "cleaned_path": "/Users/.../sora-videos/cleaned/cleaned_sora-video-123.mp4",
    "cleaned_size": 1146839
  }
}
```

#### `GET /v1/commands`
List all commands with optional filters.

```bash
curl "http://localhost:7070/v1/commands?status=SUCCEEDED&since=2026-01-30"
```

#### `POST /v1/commands/{command_id}/cancel`
Cancel a running command.

```bash
curl -X POST http://localhost:7070/v1/commands/abc123-uuid/cancel
```

---

### Command States

```
CREATED → QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED
                      │
                      ▼
           ACTION_ATTEMPTED → VERIFIED (or VERIFICATION_FAILED)
```

---

### Sora-Specific Endpoints

#### `GET /v1/sora/usage`
Get current Sora video generation usage and limits.

```bash
curl http://localhost:7070/v1/sora/usage
```

**Response:**
```json
{
  "videos_generated_today": 5,
  "daily_limit": 50,
  "remaining": 45
}
```

---

### Telemetry Stats

#### `GET /v1/telemetry/stats`
Get telemetry server statistics.

```bash
curl http://localhost:7070/v1/telemetry/stats
```

**Response:**
```json
{
  "subscribers": 2,
  "events_stored": 150,
  "current_cursor": "cursor-abc123"
}
```

---

## Command Types

### Sora Commands

| Command | Description |
|---------|-------------|
| `sora.generate` | Generate a Sora video |
| `sora.generate.clean` | Generate video + auto-remove watermark |
| `sora.batch.clean` | Batch generate + remove all watermarks |
| `sora.clean` | Remove watermark from existing video |

### Examples

**Generate watermark-free video:**
```json
{
  "type": "sora.generate.clean",
  "payload": {
    "prompt": "@isaiahdupree riding a meteor through space",
    "character": "isaiahdupree",
    "duration": "20s",
    "aspect_ratio": "16:9"
  }
}
```

**Clean an existing video:**
```json
{
  "type": "sora.clean",
  "payload": {
    "input_path": "/Users/isaiahdupree/sora-videos/badass/chapter-1-raw.mp4"
  }
}
```

**Batch generate:**
```json
{
  "type": "sora.batch.clean",
  "payload": {
    "prompts": [
      "@isaiahdupree on Mars",
      "@isaiahdupree surfing lava",
      "@isaiahdupree in space"
    ],
    "character": "isaiahdupree"
  }
}
```

---

## Telemetry Stream (WebSocket :7071)

### Connect & Subscribe

```javascript
const ws = new WebSocket('ws://localhost:7071/v1/stream');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    filters: {
      event_types: ['status.changed', 'action.verified', 'sora.video.cleaned']
    }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data.type, data.payload);
};
```

### Event Types

| Event | Description |
|-------|-------------|
| `status.changed` | Command status changed (QUEUED → RUNNING → SUCCEEDED) |
| `action.attempted` | An action was attempted |
| `action.verified` | An action was verified successful |
| `sora.video.downloaded` | Raw video downloaded |
| `sora.video.cleaned` | Watermark-free video ready |
| `human.required` | Human approval needed |
| `rate.limited` | Rate limit hit |

### Event Envelope

```json
{
  "version": "1.0",
  "event_id": "uuid",
  "correlation_id": "uuid",
  "command_id": "uuid",
  "emitted_at": "2026-01-30T23:59:59.000Z",
  "severity": "info",
  "type": "sora.video.cleaned",
  "payload": {
    "cleaned_path": "/path/to/cleaned/video.mp4",
    "file_size": 1146839
  }
}
```

---

## Python Client Usage

```python
from services.safari_automation_client import SafariAutomationClient

# Initialize client
client = SafariAutomationClient()

# Check service health
if client.is_healthy():
    print("Safari Automation service is running")

# Generate watermark-free video
result = client.generate_clean_video(
    prompt="@isaiahdupree riding a meteor",
    character="isaiahdupree"
)

if result['status'] == 'SUCCEEDED':
    print(f"Clean video: {result['result']['cleaned_path']}")

# Clean existing video
result = client.clean_video("/path/to/video.mp4")

# Get all watermark-free videos
videos = client.list_clean_videos()
```

---

## Starting the Service

```bash
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation
cd packages/protocol
npm run start
```

This starts both:
- Control Server on `http://localhost:7070`
- Telemetry Server on `ws://localhost:7071`

---

## Error Handling

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created (sessions) |
| `202` | Accepted (commands) |
| `400` | Bad request (invalid payload) |
| `401` | Unauthorized (missing/invalid token) |
| `404` | Not found (command/session) |
| `500` | Server error |

### Error Response

```json
{
  "error": "Error message describing what went wrong"
}
```

---

## Security

- **Auth Token**: Pass `Authorization: Bearer <token>` header
- **Localhost Only**: Service binds to `127.0.0.1` by default
- **Rate Limiting**: Built-in per-account rate limits
- **Human Approval**: DM actions require `human.required` flag

---

## Related Documentation

| Doc | Location |
|-----|----------|
| Engineering Design | `/Users/isaiahdupree/Documents/Software/Safari Automation/docs/control-and-telemetry-interface.md` |
| PRD | `/Users/isaiahdupree/Documents/Software/Safari Automation/docs/prd-external-command-and-telemetry.md` |
| Protocol Package | `/Users/isaiahdupree/Documents/Software/Safari Automation/packages/protocol/` |
