# Unified Browser Control API

**BAC-002:** Central dispatch router for all browser automation agents.

## Overview

This service provides a unified API for controlling browser agents across multiple platforms (Instagram, TikTok, Twitter, Threads, LinkedIn, Upwork). It automatically routes commands to the appropriate service based on platform registration in the `actp_browser_agents` Supabase table.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Cloud / Remote Caller                   │
└──────────────────────┬──────────────────────────────────┘
                       │
          POST /api/browser/command
                       │
┌──────────────────────▼──────────────────────────────────┐
│           Unified Browser Control (Port 3110)           │
│                                                          │
│  1. Lookup platform in actp_browser_agents registry     │
│  2. Map action to service-specific endpoint             │
│  3. Proxy request to target service                     │
│  4. Return normalized response                          │
└────┬────────┬────────┬────────┬─────────┬──────────────┘
     │        │        │        │         │
     ▼        ▼        ▼        ▼         ▼
┌─────────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌────────┐
│Instagram│ │TikTok│ │Twitter│ │LinkedIn│ │Upwork │
│  :3100  │ │:3102 │ │ :3003 │ │ :3109  │ │ :3108 │
│ Safari  │ │Safari│ │Safari │ │ Chrome │ │Safari│
└─────────┘ └──────┘ └──────┘ └────────┘ └───────┘
```

## Installation

```bash
cd "Safari Automation/packages/unified-control"
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
```

## Usage

### Start the server

```bash
npm run start:server
```

### Dispatch a browser command

```bash
curl -X POST http://localhost:3110/api/browser/command \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "instagram",
    "action": "search",
    "params": { "keyword": "ai automation" }
  }'
```

### List all registered agents

```bash
curl http://localhost:3110/api/browser/agents
```

### Health check

```bash
curl http://localhost:3110/health
```

## API Reference

### POST /api/browser/command

Dispatch a browser command to the appropriate service.

**Request:**
```json
{
  "platform": "instagram",
  "action": "search",
  "params": { "keyword": "ai automation" },
  "task_id": "optional-task-id"
}
```

**Response:**
```json
{
  "success": true,
  "result": { ... },
  "screenshot_url": "https://...",
  "metadata": {
    "service_url": "http://localhost:3100",
    "platform": "instagram",
    "browser_type": "safari",
    "action": "search"
  }
}
```

### GET /api/browser/agents

List all registered browser agents.

**Query params:**
- `health_status` (optional): Filter by health status (e.g., "healthy")

**Response:**
```json
{
  "agents": [
    {
      "id": "...",
      "platform": "instagram",
      "browser_type": "safari",
      "service_url": "http://localhost:3100",
      "supported_actions": ["dm", "comment", "search"],
      "health_status": "healthy",
      "last_heartbeat_at": "2026-03-07T..."
    }
  ]
}
```

### GET /health

Health check all registered agents.

**Response:**
```json
{
  "status": "ok",
  "healthy_count": 5,
  "total_count": 6,
  "agents": [
    {
      "platform": "instagram",
      "browser_type": "safari",
      "service_url": "http://localhost:3100",
      "status": "healthy",
      "status_code": 200
    }
  ]
}
```

## Supported Actions

### Common actions (all platforms)
- `search` - Search for content/users
- `extract` - Extract data from current page
- `health` - Health check
- `status` - Status check

### Platform-specific actions

#### Instagram, TikTok, Twitter, Threads
- `dm` / `send_dm` - Send direct message
- `comment` - Post comment
- `list_conversations` - List DM conversations
- `read_messages` - Read messages from conversation

#### LinkedIn
- `search_people` - Search for people
- `view_profile` - View a profile
- `extract_profile` - Extract profile data
- `send_connection` - Send connection request
- `send_message` - Send message

#### Upwork
- `search_jobs` - Search for jobs
- `extract_job` - Extract job details
- `submit_proposal` - Submit proposal
- `check_inbox` - Check inbox

## Integration with Cloud

The cloud can dispatch browser tasks by:

1. **Direct HTTP call** (immediate)
   ```bash
   curl -X POST http://localhost:3110/api/browser/command ...
   ```

2. **Via actp_browser_tasks table** (queued)
   - Cloud inserts row to `actp_browser_tasks`
   - Local `browser_agent_executor.py` polls and claims tasks
   - Executor calls unified-control API
   - Results posted back to Supabase

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Production
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `UNIFIED_CONTROL_PORT` | Server port | `3110` |
| `SUPABASE_URL` | Supabase project URL | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Required |

## Related Components

- **BAC-001:** Browser Agent Registry (`actp-worker/browser_registry.py`)
- **BAC-006:** Cloud Command Receiver (`actp-worker/browser_agent_executor.py`)
- **CLB-002:** Cloud Task Poller (`actp-worker/cloud_task_poller.py`)

## Troubleshooting

### "No healthy agent found for platform: X"

1. Check if the service is running: `curl http://localhost:PORT/health`
2. Check agent registration: `curl http://localhost:3110/api/browser/agents`
3. Verify Supabase credentials in `.env`

### "Service returned 404"

The action mapping may be incorrect. Check `router.ts` for action-to-endpoint mappings for your platform.

## License

Private - Isaiah Dupree
