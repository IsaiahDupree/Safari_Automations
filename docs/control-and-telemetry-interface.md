# Engineering Design: Control Plane + Telemetry Plane for Safari Manager

## 1) Why This Exists

The Safari Manager is the "doer" - it drives the browser, runs flows, verifies results, writes to DB. We need a clean network contract so other processes can:

- **Send commands**: run flow, scrape stats, like/comment/DM with human approval gates
- **Receive status + data**: progress, verification outcomes, extracted stats, screenshots, audit timeline

### Core Architecture: Split Interface into Two Planes

| Plane | Protocol | Port | Purpose |
|-------|----------|------|---------|
| **Control Plane** | HTTP/REST | 7070 | Request/response for commands and queries |
| **Telemetry Plane** | WebSocket | 7071 | Streaming events, logs, screenshots metadata, progress updates |

This matches the "different port communicates with it" requirement cleanly and scales well.

---

## 2) Proposed Topology

### Recommended Local Dev Defaults

- `:7070` - Control API (HTTP/REST, OpenAPI documented)
- `:7071` - Telemetry Stream (WebSocket, event feed)

### Deployment Patterns

#### A) Single Host / Localhost (most common)

```
Safari Manager binds to 127.0.0.1:7070 and 127.0.0.1:7071
Other local services connect directly
```

#### B) Remote Orchestrator (safer)

```
Remote Host
  Gateway (only remotely accessible)
      |
      | localhost only
      v
  Safari Manager
```

This avoids accidentally exposing "drive a real browser" capabilities over a public interface.

---

## 3) Transport Choices

### Control Plane Options

| Option | Pros | Cons |
|--------|------|------|
| **REST** | Simple, observable, easy to test, OpenAPI | Lower throughput |
| **gRPC** | High throughput, stronger typing | More complex setup |

**Recommendation**: Start REST and add gRPC later if needed.

### Telemetry Plane Options

| Option | Pros | Cons |
|--------|------|------|
| **WebSocket** | Best for live updates + event stream, bidirectional | More complex |
| **SSE** | Simpler than WS | One-way only |

**Recommendation**: Prefer WebSocket because you'll likely want client acks / cursor replay.

---

## 4) Contracts: Message Envelope

Use one envelope for all commands and events so you can add features without breaking clients.

### 4.1 Command Envelope (Control API)

```json
{
  "version": "1.0",
  "command_id": "uuid",
  "idempotency_key": "string",
  "correlation_id": "uuid",
  "requested_at": "2026-01-30T23:59:59.000Z",
  "requester": {
    "service": "orchestrator",
    "instance_id": "orchestrator-1"
  },
  "target": {
    "session_id": "uuid",
    "account_id": "uuid",
    "platform": "instagram|tiktok|threads|x|sora"
  },
  "type": "flow.run|action.run|selector.sweep|session.create|session.close",
  "payload": {}
}
```

### 4.2 Event Envelope (Telemetry WS)

```json
{
  "version": "1.0",
  "event_id": "uuid",
  "correlation_id": "uuid",
  "command_id": "uuid",
  "emitted_at": "2026-01-30T23:59:59.000Z",
  "severity": "debug|info|warn|error",
  "type": "status.changed|action.attempted|action.verified|selector.missing|rate.limited|human.required|artifact.captured",
  "target": {
    "session_id": "uuid",
    "account_id": "uuid",
    "platform": "instagram|tiktok|threads|x|sora"
  },
  "payload": {}
}
```

---

## 5) Control Plane API (Port 7070)

### 5.1 Health + Readiness

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Process up |
| `GET /ready` | Dependencies up (DB reachable, driver ready, selector registry loaded) |

### 5.2 Sessions

| Endpoint | Description |
|----------|-------------|
| `POST /v1/sessions` | Creates a Safari session (or attaches to existing one) |
| `GET /v1/sessions/{session_id}` | Get session details |
| `DELETE /v1/sessions/{session_id}` | Close session |

**Note**: If using Safari WebDriver, that flow is gated by Safari's WebDriver enablement ("Allow Remote Automation").

### 5.3 Commands (async by default)

| Endpoint | Description |
|----------|-------------|
| `POST /v1/commands` | Validates command schema, enqueues command, returns `202 Accepted` with `command_id` |
| `GET /v1/commands/{command_id}` | Returns command state + summary |
| `POST /v1/commands/{command_id}/cancel` | Cancel a running command |

#### Command States

```
CREATED -> QUEUED -> RUNNING -> SUCCEEDED|FAILED|CANCELLED
                        |
                        v
              ACTION_ATTEMPTED -> VERIFIED (or VERIFICATION_FAILED)
```

### 5.4 Query Artifacts + Results

| Endpoint | Description |
|----------|-------------|
| `GET /v1/posts?platform=...&account_id=...&since=...` | Query posts |
| `GET /v1/actions?correlation_id=...` | Query actions |
| `GET /v1/dm_threads?...` | Query DM threads |
| `GET /v1/selector_registry?...` | Query selector registry |
| `GET /v1/sora/usage` | Get Sora video generation usage |
| `GET /v1/sora/drafts` | Get Sora drafts |

---

## 6) Telemetry Plane (Port 7071 WebSocket)

### 6.1 Connect + Subscribe

**Endpoint**: `WS /v1/stream?session_id=...&account_id=...`

Upon connect, client sends:

```json
{
  "type": "subscribe",
  "cursor": "optional-event-cursor",
  "filters": {
    "severity": ["info", "warn", "error"],
    "event_types": ["status.changed", "action.verified", "human.required"]
  }
}
```

Server responds:

```json
{
  "type": "subscribed",
  "cursor": "server-cursor-now"
}
```

### 6.2 Replay / Resumability

- Every event has a **monotonic cursor**
- Client can reconnect with last cursor and resume
- This is how you make "other port can receive status" reliable

---

## 7) Security Model

### Minimum Viable

- Auth token per client service (bearer token)
- Command allowlist per client (e.g., "reporting service can only read stats")
- Rate limits per account + per client

### Recommended

- mTLS if anything is remote
- Bind Safari Manager to localhost and expose only a gateway if you ever cross hosts

### Responsible Automation Constraints

- Explicit `human.required` events for DM sending
- Never expose anything that looks like "captcha solving" hooks
- Audit logging always on

---

## 8) Example: "Comment on a Post (Deduped) + Verify" Sequence

```
1. Orchestrator -> POST /v1/commands
   {type: "flow.run", payload: {flow: "comment_on_post", post_id, ...}}

2. Safari Manager emits events:
   - status.changed: RUNNING
   - action.attempted: COMMENT_CREATE
   - action.verified: COMMENT_PRESENT
   - status.changed: SUCCEEDED

3. Orchestrator listens on WS stream and updates its UI / DB immediately.
```

---

## 9) Example: "Sora Video Generation" Sequence

```
1. Orchestrator -> POST /v1/commands
   {type: "sora.generate", payload: {prompt: "@isaiahdupree Mars scene", character: "isaiahdupree"}}

2. Safari Manager emits events:
   - status.changed: RUNNING
   - action.attempted: SORA_PROMPT_SUBMIT
   - status.changed: POLLING
   - action.attempted: SORA_DRAFT_CHECK (repeated)
   - action.verified: SORA_VIDEO_READY
   - action.attempted: SORA_VIDEO_DOWNLOAD
   - action.verified: SORA_VIDEO_DOWNLOADED
   - status.changed: SUCCEEDED

3. GET /v1/commands/{id} returns:
   {
     "result": {
       "video_path": "/Users/.../sora-videos/sora-isaiahdupree-123.mp4",
       "file_size": 971234,
       "duration_ms": 220000
     }
   }
```

---

## 10) Tests You Should Add for This Interface

### Contract Tests

- Schema validation for every command + event type
- Backward-compat checks (versioning)

### Integration Tests

- Run a stub engine; assert command lifecycle + emitted events order
- Reconnect/resume: drop WS connection mid-flow, ensure replay works

### Abuse / Safety Tests

- Ensure unauthorized clients can't call write actions
- Ensure DM actions always require human approval flag unless explicitly configured for a user-owned test account

---

## 11) Documentation Automation

Add:

- **OpenAPI generation** for Control Plane (`/openapi.json`)
- **AsyncAPI-like page** (even a markdown table) for event types
- **"docs are built from schemas" rule**:
  - JSON schema files in `packages/protocol/schemas/*`
  - Docs import those schemas and examples

---

## 12) Directory Structure

```
packages/
  protocol/
    schemas/
      command.schema.json
      event.schema.json
      sora-command.schema.json
    src/
      control-server.ts      # Express/Fastify HTTP server on :7070
      telemetry-server.ts    # WebSocket server on :7071
      command-handler.ts     # Routes commands to appropriate handlers
      event-emitter.ts       # Emits events to WS subscribers
    index.ts
```

---

## 13) Implementation Checklist

- [ ] Define JSON schemas for commands and events
- [ ] Implement Control API skeleton (health, ready, sessions, commands)
- [ ] Implement Telemetry WS server with cursor-based replay
- [ ] Integrate with existing Safari automation (SoraFullAutomation, etc.)
- [ ] Add auth middleware (bearer token validation)
- [ ] Add rate limiting middleware
- [ ] Generate OpenAPI spec
- [ ] Write contract tests
- [ ] Write integration tests with stub driver
