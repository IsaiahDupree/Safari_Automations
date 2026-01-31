# PRD: External Command Gateway + Data Exchange Layer

## 1) Background / Problem

We have a Safari automation engine that can run multi-step flows across social platforms (extract, decide, act, verify, persist). We need a stable, testable, service-to-service interface so other components can:

- **Submit commands** without tight coupling to browser internals
- **Receive streaming status/data** for dashboards and downstream automations
- **Safely control access** (read-only vs write actions; human approvals)

### Current State

The Safari Manager currently operates as a monolithic engine with direct method calls. This works for single-process usage but doesn't support:

- Remote orchestration
- Multiple client services consuming events
- Audit trail via external logging systems
- Dashboard/UI integration

---

## 2) Goals

| Goal | Description |
|------|-------------|
| **Control API** | Provide HTTP API to submit commands and query results |
| **Telemetry Stream** | Provide WebSocket stream for real-time events and replay |
| **Idempotency** | Support idempotency + de-duplication at the API layer |
| **Testability** | Make the interface testable in CI without needing real Safari for every test |

---

## 3) Non-Goals

| Non-Goal | Reason |
|----------|--------|
| Bypassing platform security controls | Responsible automation only |
| Automating unauthorized accounts | Ethical constraints |
| Solving CAPTCHAs or evasion behavior | Platform TOS compliance |
| Exposing Safari Manager directly to public internet | Security risk |

---

## 4) Users / Clients

| Client | Use Case |
|--------|----------|
| **Orchestrator Service** | Decides what to do, schedules work |
| **Dashboard UI Backend** | Shows status, audit timeline |
| **QA Runner** | Runs selector sweeps + regression suites |
| **Human-in-Loop Reviewer** | Approves DM sends |
| **Sora Video Pipeline** | Submits prompts, polls for completion, triggers watermark removal |

---

## 5) Functional Requirements

### FR1 - Submit Async Commands

- POST /v1/commands accepts a validated command and returns command_id
- Must support idempotency_key to prevent duplicate operations
- Commands are queued and processed asynchronously

### FR2 - Stream Events + Replay

- WebSocket stream provides events for a session/account
- Client can reconnect using a cursor and resume from last event
- Supports filtering by severity and event type

### FR3 - Query State

- GET /v1/commands/{id} returns lifecycle + last known status
- Query endpoints exist for posts/actions/DM threads/snapshots
- Sora-specific endpoints for usage and drafts

### FR4 - Safety Gates

- DM send actions must support HUMAN_REQUIRED gating
- Policy engine constraints surfaced as events (rate-limited, cooldown, blocked)
- All write actions logged to audit trail

### FR5 - Multi-tenant / Multi-account

Must be able to run multiple accounts with isolation:

- Per-account concurrency limits
- Per-platform session pools
- Per-account rate limiting

---

## 6) Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| **Reliability** | Command state durable (DB persisted) |
| **Latency** | Events emitted within 250-500ms of state changes (local) |
| **Scalability** | Handle N concurrent sessions (define N per machine) |
| **Observability** | Structured logs, metrics, trace IDs, audit trail |

---

## 7) Data and Retention Requirements

- Store minimal necessary content for verification/audit
- Provide retention windows + redaction hooks
- Encrypt sensitive tokens at rest
- Screenshots stored with configurable TTL

---

## 8) Acceptance Criteria (Ship Checklist)

- [ ] A client can submit a flow command and receive:
  - Command accepted (202)
  - Status transitions via WebSocket
  - Verification result
- [ ] WS stream can reconnect and replay missed events
- [ ] Unauthorized client cannot submit write actions
- [ ] Idempotency prevents duplicate comments/DM sends for same key
- [ ] CI runs protocol contract tests without launching Safari
- [ ] Sora commands work end-to-end (submit prompt, poll, download)

---

## 9) Milestones

### M0 - Protocol + Schemas (Week 1)

- Define command/event envelopes + JSON schemas
- Publish OpenAPI skeleton
- Define Sora-specific command types

### M1 - Control Plane Scaffolding (Week 2)

- /health, /ready endpoints
- /v1/commands CRUD
- /v1/sessions management
- Basic auth middleware

### M2 - Telemetry Plane (Week 3)

- WS stream server on :7071
- Cursor-based replay
- Emit events from action engine + verification engine
- Subscribe/filter support

### M3 - Policy + Permissions (Week 4)

- Auth token validation
- Command allowlists per client
- Rate limits per account
- DM human gate implementation

### M4 - Test Harness (Week 5)

- Stub driver mode for CI
- Contract tests for all command/event schemas
- Integration tests with replay scenarios
- End-to-end test: Sora generation via API

---

## 10) Metrics of Success

| Metric | Target |
|--------|--------|
| % commands completed without manual intervention | > 95% (except human gates) |
| Mean time to detect selector breakage | < 5 minutes |
| Event delivery success rate | > 99.9% |
| Replay correctness | 100% |
| Duplicate-action rate | < 0.1% (with idempotency) |

---

## 11) API Summary

### Control Plane (Port 7070)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Process health check |
| GET | /ready | Dependencies ready check |
| POST | /v1/sessions | Create session |
| GET | /v1/sessions/{id} | Get session |
| DELETE | /v1/sessions/{id} | Close session |
| POST | /v1/commands | Submit command |
| GET | /v1/commands/{id} | Get command status |
| POST | /v1/commands/{id}/cancel | Cancel command |
| GET | /v1/sora/usage | Get Sora usage info |
| GET | /v1/sora/drafts | Get Sora drafts |

### Telemetry Plane (Port 7071)

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| WebSocket | /v1/stream | Event stream with cursor replay |

---

## 12) Command Types

### Social Platform Commands

| Type | Description |
|------|-------------|
| flow.run | Run a multi-step flow |
| action.run | Run a single action |
| selector.sweep | Test selectors against live page |
| session.create | Create browser session |
| session.close | Close browser session |

### Sora Commands

| Type | Description |
|------|-------------|
| sora.generate | Submit prompt and wait for video |
| sora.generate.clean | Submit prompt, wait for video, **remove watermark** |
| sora.batch | Run multiple prompts sequentially |
| sora.batch.clean | Run multiple prompts, **remove watermarks from all** |
| sora.clean | Remove watermark from existing video file |
| sora.poll | Poll drafts for video status |
| sora.download | Download completed video |
| sora.usage | Get usage info |

---

## 13) Event Types

| Event | Description |
|-------|-------------|
| status.changed | Command state transition |
| action.attempted | Action was attempted |
| action.verified | Action verification complete |
| selector.missing | Selector not found |
| rate.limited | Rate limit hit |
| human.required | Human approval needed |
| artifact.captured | Screenshot/video captured |

---

## 14) Security Requirements

### Authentication

- Bearer token required for all endpoints
- Tokens scoped to specific clients/services
- Token rotation supported

### Authorization

- Read-only clients cannot submit write commands
- DM commands require additional approval flag
- Sora commands respect generation limits

### Network

- Safari Manager binds to localhost only
- Gateway required for remote access
- mTLS recommended for production

---

## 15) Implementation Note: Safari Automation

If the engine uses Safari WebDriver, the OS/browser needs WebDriver enabled (Allow Remote Automation) for Safari control.

For CI smoke coverage, teams can run WebKit automation via Playwright (not literally Safari, but same engine family) as a fast signal suite alongside macOS SafariDriver tests.

---

## 16) Dependencies

| Dependency | Purpose |
|------------|---------|
| Express/Fastify | HTTP server for Control Plane |
| ws | WebSocket server for Telemetry |
| SQLite/PostgreSQL | Command state persistence |
| JSON Schema | Contract validation |
| OpenAPI Generator | API documentation |

---

## 17) Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Safari session instability | Session health checks, auto-recovery |
| Event delivery failures | Cursor-based replay, at-least-once delivery |
| Rate limit violations | Client-side rate limiting, backoff |
| Selector breakage | Automated sweep tests, alerts |

---

## 18) Open Questions

1. Should we support gRPC in addition to REST?
2. What is the maximum concurrent sessions per machine?
3. How long should event history be retained for replay?
4. Should watermark removal be triggered via this API or separate service?

---

## 19) Appendix: Example Sora Flow

```
Client                    Control API                Safari Manager
  |                           |                           |
  |  POST /v1/commands        |                           |
  |  {type: sora.generate}    |                           |
  |-------------------------->|                           |
  |                           |  Queue command            |
  |  202 {command_id}         |                           |
  |<--------------------------|                           |
  |                           |                           |
  |  WS /v1/stream            |                           |
  |-------------------------->|                           |
  |                           |                           |
  |                           |  Process command          |
  |                           |-------------------------->|
  |                           |                           |
  |  event: status.changed    |                           |
  |  (RUNNING)                |                           |
  |<--------------------------|                           |
  |                           |                           |
  |  event: action.attempted  |  Navigate to Sora         |
  |  (SORA_PROMPT_SUBMIT)     |-------------------------->|
  |<--------------------------|                           |
  |                           |                           |
  |  event: status.changed    |  Poll drafts              |
  |  (POLLING)                |-------------------------->|
  |<--------------------------|                           |
  |                           |                           |
  |  ... (multiple polls)     |                           |
  |                           |                           |
  |  event: action.verified   |  Video ready              |
  |  (SORA_VIDEO_READY)       |<--------------------------|
  |<--------------------------|                           |
  |                           |                           |
  |  event: action.verified   |  Download complete        |
  |  (SORA_VIDEO_DOWNLOADED)  |<--------------------------|
  |<--------------------------|                           |
  |                           |                           |
  |  event: status.changed    |                           |
  |  (SUCCEEDED)              |                           |
  |<--------------------------|                           |
  |                           |                           |
  |  GET /v1/commands/{id}    |                           |
  |-------------------------->|                           |
  |                           |                           |
  |  {status: SUCCEEDED,      |                           |
  |   result: {video_path}}   |                           |
  |<--------------------------|                           |
```
