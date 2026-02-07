# PRD: Upwork ↔ CRM ↔ ECD DevBot Bridge (Event-Driven Autonomy)

**Version:** 0.1  
**Date:** February 6, 2026  
**Owner:** Isaiah / Portal Copy Co (internal)  
**Status:** Draft → MVP Build  
**Related:** [PRD_UPWORK_AUTOMATION.md](../PRDs/PRD_UPWORK_AUTOMATION.md)

---

## 1) Problem Statement

We operate multiple local "bot servers":
- Upwork intake + negotiation
- Local CRM
- ECD / autonomous coding dev bot
- Comms/status updater

We need a reliable, auditable, event-driven bridge so that when an Upwork offer is accepted (or contract becomes active), the system automatically:
1. Creates/updates CRM records
2. Generates a "Task Pack" for DevBot
3. Runs milestone build loops
4. Sends status updates on the client's preferred cadence/channel
5. Produces deliverables + feedback loops

---

## 2) Goals

### Functional Goals
- Trigger autonomous build workflow on Offer Accepted / Contract Active.
- Maintain a single source of truth in CRM for scope, milestones, and comms preferences.
- DevBot must reuse internal libraries via an explicit allowlist.
- Status updates must be derived from telemetry (not vibes).

### Reliability Goals
- End-to-end idempotency (no duplicate projects/milestones).
- At-least-once event delivery with dedupe.
- Full audit trail (who/what/when/why) per contract.

### Compliance Goals (Hard Constraints)
- **Upwork automation must be done through approved API access, not UI/Safari automation.**
- **Pre-contract comms remain on Upwork (no off-platform contact sharing).**

---

## 3) Non-Goals

- Fully automating proposal spam / mass applying. (Out of scope + high risk.)
- Building a generic "agent that browses Upwork UI." (Explicitly avoid.)
- Replacing human approval for pricing/scope changes (human-in-loop required).

---

## 4) High-Level Architecture

```
           ┌──────────────────────────┐
           │ Upwork Integration Svc    │  (OAuth2 + GraphQL)
           │  - Webhook receiver       │  emits upwork.* events
           └───────────┬──────────────┘
                       │
                       v
           ┌──────────────────────────┐
           │ Orchestrator / Rules      │  state machine + routing
           │  - dedupe/idempotency     │
           │  - task pack builder      │
           └───────┬─────────┬────────┘
                   │         │
                   v         v
     ┌──────────────────┐   ┌──────────────────────┐
     │ Local CRM Service │   │ DevBot / ECD Service  │
     │  - SoT for scope  │   │  - build/test/package │
     └───────┬──────────┘   └───────────┬──────────┘
             │                          │
             v                          v
     ┌──────────────────┐       ┌──────────────────────┐
     │ Comms Service     │       │ Artifact Storage      │
     │ - cadence updates │       │ (local/S3/R2/etc.)    │
     └──────────────────┘       └──────────────────────┘
```

**Transport:** Internal event bus (NATS/Redis Streams/Kafka) OR HTTP callbacks with an outbox pattern.  
**MVP Recommendation:** Redis Streams (simple, local-friendly) + HTTP for commands.

---

## 5) Services (Contracts & Boundaries)

### 5.1 Upwork Integration Service (UIS)

**Purpose:** The only service that talks to Upwork.

**Key Requirements:**
- OAuth 2.0 auth for all Upwork API requests.
- Subscribe/poll via API, emit normalized events.
- **Never use browser cookies/session replay for Upwork actions.**

**Outputs:**
- Emits: `upwork.offer.accepted`, `upwork.contract.active`, `upwork.message.received`, `upwork.contract.updated`

### 5.2 Orchestrator / Rules Engine

**Purpose:** State machine + command router.

**Responsibilities:**
- Dedupe incoming events.
- Maintain contract/opportunity lifecycle state.
- Build Task Packs.
- Dispatch commands to CRM / DevBot / Comms.

### 5.3 Local CRM Service

**Purpose:** Source of truth for:
- Client profile
- Comms preferences
- Scope snapshot
- Milestones
- Audit logs
- Artifact links

### 5.4 DevBot / ECD Service

**Purpose:** Autonomous build execution from Task Packs.

**Responsibilities:**
- Bootstrap repo, create branch, implement tasks, run tests, produce artifacts.
- Emit structured status + evidence (test logs, build hashes).
- Only use allowlisted internal libs.

### 5.5 Comms Service

**Purpose:** Posts updates on the right cadence/channel.

**Hard Rules:**
- **Pre-contract:** Upwork-only comms.
- **Post-contract:** channel = {Upwork, Email, Slack, etc.} depending on CRM preference.

---

## 6) Event + Command Schemas

### 6.1 Canonical Event Envelope

```json
{
  "event_id": "uuid",
  "event_type": "upwork.offer.accepted",
  "occurred_at": "2026-02-06T05:12:44Z",
  "source": "upwork_integration_service",
  "correlation_id": "opp_123",
  "idempotency_key": "upwork:offer:987654:accepted",
  "payload": {}
}
```

### 6.2 Canonical Command Envelope

```json
{
  "command_id": "uuid",
  "command_type": "devbot.project.bootstrap",
  "issued_at": "2026-02-06T05:13:05Z",
  "issuer": "orchestrator",
  "correlation_id": "opp_123",
  "idempotency_key": "opp_123:bootstrap:v1",
  "payload": {}
}
```

### 6.3 Task Pack (DevBot Input)

```json
{
  "project": {
    "opportunity_id": "opp_123",
    "contract_id": "upw_contract_456",
    "client": { "name": "ClientCo", "org_id": "..." },
    "communication": {
      "channel": "upwork",
      "cadence": "daily",
      "time_zone": "America/New_York"
    }
  },
  "scope_snapshot": {
    "summary": "Build X that does Y",
    "requirements": ["..."],
    "acceptance_criteria": ["..."],
    "constraints": ["stack", "security", "performance"],
    "out_of_scope": ["..."]
  },
  "repo": {
    "url": "git@github.com:you/clientco-project.git",
    "default_branch": "main"
  },
  "libraries_allowed": [
    { "name": "auth-kit", "version": ">=1.2.0", "tags": ["oauth", "rbac"] }
  ],
  "milestones": [
    {
      "milestone_id": "m1",
      "title": "Bootstrap + auth",
      "deliverables": ["..."],
      "definition_of_done": ["..."]
    }
  ],
  "delivery": {
    "artifact_types": ["zip", "docker", "docs"],
    "handoff_format": "README+runbook"
  }
}
```

### 6.4 Status Pack (DevBot Output)

```json
{
  "opportunity_id": "opp_123",
  "milestone_id": "m1",
  "state": "IN_PROGRESS",
  "percent": 45,
  "evidence": {
    "commit": "abc123",
    "tests": { "passed": 118, "failed": 0 },
    "artifacts": []
  },
  "next": ["Implement RBAC", "Deploy staging"]
}
```

---

## 7) Lifecycle State Machine (Core Automation)

### States

- `LEAD_CREATED`
- `PROPOSAL_SENT`
- `OFFER_RECEIVED`
- `OFFER_ACCEPTED`
- `CONTRACT_ACTIVE`
- `BOOTSTRAPPING`
- `BUILDING_MILESTONE`
- `AWAITING_CLIENT_FEEDBACK`
- `DELIVERED`
- `CLOSED`

### Transitions (MVP)

1. `upwork.offer.accepted` → **OFFER_ACCEPTED**
   - Create CRM Contract
   - Snapshot scope v1
   - Queue `devbot.project.bootstrap`

2. `devbot.project.bootstrap.done` → **BOOTSTRAPPING** → **BUILDING_MILESTONE(m1)**

3. `devbot.milestone.done(m1)` → **AWAITING_CLIENT_FEEDBACK** (send update + ask validation)

4. `client.feedback.received` → either:
   - **BUILDING_MILESTONE(next)** or
   - **DELIVERED** → **CLOSED**

```
 LEAD_CREATED ──► PROPOSAL_SENT ──► OFFER_RECEIVED ──► OFFER_ACCEPTED
                                                             │
                                                             ▼
                                                       CONTRACT_ACTIVE
                                                             │
                                                             ▼
                                                        BOOTSTRAPPING
                                                             │
                                                             ▼
                                                   BUILDING_MILESTONE(m1)
                                                             │
                                                             ▼
                                                AWAITING_CLIENT_FEEDBACK
                                                        │           │
                                                        ▼           ▼
                                              BUILDING_MILESTONE  DELIVERED
                                                   (next)            │
                                                                     ▼
                                                                   CLOSED
```

---

## 8) API Surfaces (HTTP, Internal)

### 8.1 UIS (Upwork Integration Service)

```
POST /webhooks/upwork         - Receive Upwork webhook/subscription callbacks
POST /events                  - Emit normalized events to bus (internal only)
GET  /health                  - Health check
```

### 8.2 Orchestrator

```
POST /events                  - Ingest events from bus
POST /commands/devbot/*       - Dispatch DevBot commands
POST /commands/crm/*          - Dispatch CRM commands
POST /commands/comms/*        - Dispatch Comms commands
GET  /state/{correlation_id}  - Get lifecycle state
```

### 8.3 CRM

```
POST /contracts               - Create/update contract
POST /milestones               - Create/update milestone
POST /audit-log                - Write audit entry
GET  /contracts/{id}           - Get contract details
```

### 8.4 DevBot

```
POST /task-packs               - Enqueue task pack
POST /status                   - Push status update
GET  /runs/{id}                - Get run details
```

### 8.5 Comms

```
POST /messages                 - Send message
POST /schedule                 - Set cadence rules
GET  /history/{contract_id}    - Get comms history
```

---

## 9) Reliability + Idempotency Rules

### 9.1 Idempotency

- Every incoming Upwork event must map to a deterministic `idempotency_key` (e.g., `upwork:offer:<id>:accepted`)
- Orchestrator maintains a `ProcessedEvents` store:
  - If seen → drop
  - If new → process + record

### 9.2 Retry Policy

- **Transient failures:** exponential backoff (1s, 5s, 15s, 60s, 5m), max 10 attempts
- **Permanent failures:** route to DLQ with reason + payload
- **DevBot commands:** must be safe to retry (idempotency key required)

### 9.3 Outbox Pattern (Recommended)

- When Orchestrator updates CRM + emits command, store both in a transaction, then publish.

---

## 10) Security + Secrets

- UIS stores Upwork OAuth tokens securely; rotate and scope-minimize.
- Internal services authenticate via:
  - mTLS OR shared JWT between services OR API keys (MVP)
- Secrets: `.env` for local, vault/1Password/SSM for prod
- Audit log must include:
  - `event_id`, `command_id`, actor/service, timestamp, diff/decision

---

## 11) Compliance Guardrails (Must Implement)

1. **No Upwork UI automation** for actions that create risk (proposals, messaging, offers). Use approved API access only.
2. **Pre-contract comms on Upwork;** do not request contact info until contract is active.
3. **Rate-limiting and human-like cadence** even via API (avoid spam patterns). Enforced in Comms service.
4. **Human-in-loop approvals** required for:
   - Price changes
   - Scope changes
   - New milestone creation that increases cost/time

---

## 12) Observability

### Metrics

- `offers_accepted → bootstrap_latency` (p50/p95)
- `milestone_build_time`
- `retries + DLQ rate`
- `comms_sent_per_contract_per_day`
- `time_to_first_deliverable`

### Logs/Traces

- `correlation_id` must be in every log line
- Store build evidence links (commits, test logs, artifact hashes)

---

## 13) MVP Build Plan (2-Week Style)

### Milestone 1: Core Event Chain

- UIS emits `upwork.offer.accepted`
- Orchestrator creates CRM contract + enqueues DevBot bootstrap
- DevBot returns status + "done" event
- Comms posts one "contract kickoff" update

### Milestone 2: Milestone Loop

- CRM stores milestones
- Orchestrator dispatches `devbot.milestone.build(m1)`
- DevBot outputs artifacts + evidence
- Comms posts milestone completion update

### Milestone 3: Feedback + Change Requests

- Parse client feedback into a structured change request
- Human approve → DevBot apply → deliver

---

## 14) Repo Layout

```
/services
  /upwork-integration          # UIS - Upwork OAuth + webhook receiver
  /orchestrator                # State machine + command router
  /crm                         # Local CRM service
  /devbot                      # ECD autonomous build service
  /comms                       # Status update + messaging service
/shared
  /schemas                     # Event, command, task-pack JSON schemas
/docs
  /upwork-ecd-bridge           # This PRD + architecture diagrams
/infra
  docker-compose.yml           # All services + Redis Streams
```

---

## 15) Supersedes / Amends Previous PRD

This PRD **supersedes** the Safari-based UI automation approach for Upwork documented in [PRD_UPWORK_AUTOMATION.md](../PRDs/PRD_UPWORK_AUTOMATION.md).

### Key Differences from Previous Approach

| Aspect | Previous PRD | This PRD |
|--------|-------------|----------|
| **Integration method** | Safari UI automation | Official Upwork OAuth2 API |
| **Proposal submission** | Browser automation | API-based (human-approved) |
| **Message handling** | UI scraping | Webhook + API |
| **Architecture** | Monolithic package | Event-driven microservices |
| **Compliance risk** | Medium-High (TOS) | Low (approved API) |
| **Delivery automation** | None | Full DevBot pipeline |
| **CRM integration** | Basic logging | Full lifecycle SoT |

### What Carries Forward

The following concepts from the original PRD remain valid and are incorporated:
- Job search/scoring interfaces
- AI proposal generation
- Application tracking data model
- Message classification and auto-response
- Analytics and insights

---

## Next Steps

To make this maximally actionable, we need to decide:

1. **Stack:** Node/TS vs Python vs mixed for services
2. **Event bus:** Redis Streams vs NATS
3. **Generate:** shared JSON schemas, state machine transition tables, docker-compose skeleton, Task Pack builder rules with library allowlist registry

---

**Created:** February 6, 2026  
**Status:** Draft → MVP Build
