# Safari Automation — Changes Needed
_Last updated: 2026-03-06_

This document tracks all pending improvements, completed changes, and the standard patterns
every Safari agent must implement. Use it as the source of truth before dispatching agents.

---

## Status Legend
- ✅ Done
- 🔄 In progress (ACD agent running)
- ⚠️ Partial — some files updated, some not
- ❌ Not started
- 🚫 Blocked — dependency not met

---

## 1. Tab Management Standard (apply to all agents)

Every Safari agent must implement the full TabCoordinator system so the cloud brain can
schedule non-conflicting operations across all agents.

### Reference implementation
`packages/instagram-dm/src/automation/tab-coordinator.ts` — copy verbatim to each package.
`packages/instagram-dm/src/api/server.ts` — session/tabs/debug endpoint patterns.

### Required endpoints (all agents)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tabs/claims` | GET | List all live cross-service tab claims (reads `/tmp/safari-tab-claims.json`) |
| `/api/tabs/claim` | POST | Claim a Safari tab before an operation. Body: `{ agentId, windowIndex?, tabIndex? }` |
| `/api/tabs/release` | POST | Release claim after operation. Body: `{ agentId }` |
| `/api/tabs/heartbeat` | POST | Refresh 60s TTL on a claim. Body: `{ agentId }` |
| `/api/session/status` | GET | Return `{ tracked, windowIndex, tabIndex, sessionUrlPattern }` |
| `/api/session/ensure` | POST | Find + activate the correct tab for this service |
| `/api/session/clear` | POST | Reset stale tracked session (use after Safari restart) |
| `/api/debug/eval` | POST | Execute JS in tracked tab. Body: `{ js }`. Returns `{ result }` |

### Required runtime behaviour

| Behaviour | How |
|-----------|-----|
| 30s heartbeat interval | `setInterval` refreshes all `activeCoordinators`, deletes expired entries |
| Per-operation claim | Every Safari op wraps with `coord.claim()` → execute → `coord.release()` in finally |
| Graceful crash release | `process.on('exit', ...)` releases all active claims on server shutdown |

### Per-agent status

| Package | Port | URL Pattern | Tab coord | /tabs/* | /session/* | /debug/eval | Heartbeat | Per-op claim |
|---------|------|-------------|-----------|---------|------------|-------------|-----------|--------------|
| `instagram-dm` | 3100 | `instagram.com` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `twitter-dm` | 3003 | `x.com` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `tiktok-dm` | 3102 | `tiktok.com` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `instagram-comments` | 3005 | `instagram.com` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| `twitter-comments` | 3007 | `x.com` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `threads-comments` | 3004 | `threads.net` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ |
| `linkedin-automation` | 3105 | `linkedin.com` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `market-research` | 3106 | `google.com` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `tiktok-comments` | 3006 | `tiktok.com` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `upwork-hunter` | 3107 | `upwork.com` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**To fix remaining gaps** — dispatch ACD agent:
```bash
# Re-run for twitter-comments, linkedin-automation, market-research
/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/launch-prospect-swarm.sh
```
Or dispatch: `safari-tab-mgmt-comments` PRD covers instagram-comments (partial), twitter-comments, threads-comments, linkedin-automation, market-research.

---

## 2. instagram-dm Improvements to Port to All Agents

These features exist in `instagram-dm` and should be added to the other DM/comments agents.

### 2a. Prospect Discovery Pipeline

`instagram-dm` has a full ICP prospect pipeline. Other agents need equivalent:

| Package | `/api/prospect/discover` | `/api/prospect/score/:username` | `/api/prospect/run-pipeline` | `/api/prospect/pipeline-status` | `/api/prospect/schedule-batch` |
|---------|--------------------------|--------------------------------|-----------------------------|---------------------------------|-------------------------------|
| `instagram-dm` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `twitter-dm` | ✅ (basic) | ✅ | ❌ | ❌ | ❌ |
| `tiktok-dm` | ✅ (basic) | ✅ | ❌ | ❌ | ❌ |
| `threads-comments` | ✅ (basic) | ❌ | ❌ | ❌ | ❌ |
| `linkedin-automation` | ✅ (basic) | ❌ | ❌ | ❌ | ❌ |
| `twitter-comments` | ❌ | ❌ | ❌ | ❌ | ❌ |
| `market-research` | ❌ | ❌ | ❌ | ❌ | ❌ |

**run-pipeline / pipeline-status / schedule-batch** are the new orchestrator endpoints added by the `ig-e2e-integration` agent. They need to be ported to twitter-dm and tiktok-dm at minimum.

### 2b. CRMLite Sync on Send

Every DM send should sync to CRMLite after success.

| Package | CRMLite sync on send |
|---------|---------------------|
| `instagram-dm` | ✅ |
| `twitter-dm` | ⚠️ partial |
| `tiktok-dm` | ✅ (added by tiktok-browser-agent) |
| `linkedin-automation` | ❌ |
| `threads-comments` | ❌ |

**Pattern** (from instagram-dm):
```typescript
await fetch('https://crmlite-isaiahduprees-projects.vercel.app/api/sync/dm', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CRMLITE_API_KEY! },
  body: JSON.stringify({
    platform: 'twitter',  // adjust per package
    conversations: [{ username, display_name, messages: [{ text, is_outbound: true, sent_at: new Date().toISOString() }] }]
  })
});
```

### 2c. Active Hours Guard (9am–9pm)

DMs must only send during active hours. All DM packages need this check.

| Package | Active hours guard |
|---------|-------------------|
| `instagram-dm` | ✅ `rateLimits.activeHoursStart/End = 9/21` |
| `twitter-dm` | ⚠️ needs verification |
| `tiktok-dm` | ✅ (added) |
| `linkedin-automation` | ❌ |

### 2d. Rate Limit Headers in /health Response

`/health` should return current rate limit state so the cloud brain can decide whether to book an operation.

```typescript
// Standard /health response:
{
  status: 'ok',
  service: 'twitter-dm',
  timestamp: '...',
  rateLimits: {
    messagesSentToday: 3,
    messagesSentThisHour: 1,
    limits: { messagesPerHour: 10, messagesPerDay: 30, activeHoursStart: 9, activeHoursEnd: 21 }
  }
}
```

| Package | Rate limits in /health |
|---------|----------------------|
| `instagram-dm` | ✅ |
| `twitter-dm` | ❌ |
| `tiktok-dm` | ❌ |
| all others | ❌ |

### 2e. `POST /api/prospect/store-batch` Dedup Endpoint

Stores discovered candidates to Supabase `suggested_actions` with dedup by username+platform.

| Package | store-batch |
|---------|-------------|
| `instagram-dm` | ✅ |
| all others | ❌ |

### 2f. Prospect Review CLI (`src/cli/prospect-review.ts`)

Interactive terminal CLI to review and action discovered prospects (d=DM, s=skip, q=quit).

| Package | prospect-review CLI |
|---------|---------------------|
| `instagram-dm` | ✅ (added by ig-e2e-integration agent) |
| all others | ❌ — would need platform-specific version |

---

## 3. New Packages (built by ACD agents — need watchdog + startup integration)

| Package | Port | Status | Watchdog entry | LaunchAgent |
|---------|------|--------|----------------|-------------|
| `tiktok-dm` | 3102 | ✅ Built — not running | ❌ needs adding | ❌ |
| `upwork-hunter` | 3107 | ✅ Built — not running | ❌ needs adding | ❌ |

### Add to watchdog (`watchdog-safari.sh`)

```bash
# Uncomment/add these lines:
SERVICES[3102]="packages/tiktok-dm/src/api/server.ts"
SERVICES[3107]="packages/upwork-hunter/src/api/server.ts"
```

### Start them now (one-off)
```bash
/bin/zsh -l -c 'cd "packages/tiktok-dm" && npx tsx src/api/server.ts >> /private/tmp/safari-3102.log 2>&1 &'
/bin/zsh -l -c 'cd "packages/upwork-hunter" && npx tsx src/api/server.ts >> /private/tmp/safari-3107.log 2>&1 &'
```

---

## 4. Cloud-Local Architecture (agentlite ← → safari_command_queue ← → ig-daemon)

### 4a. ig-daemon action coverage gap

The ig-daemon polls `safari_command_queue` and dispatches to local agents. It only handles:
`status`, `conversations`, `enrich`, `dm`, `scrape`, `sync`, `pipeline`

Missing actions the cloud brain needs to trigger:

| Action | Handler needed | Target port |
|--------|---------------|-------------|
| `prospect_discover` | call `POST :3100/api/prospect/run-pipeline` | 3100 |
| `dm_batch` | call `POST :3100/api/prospect/schedule-batch` | 3100 |
| `upwork_scan` | call `POST :3107/api/scan` | 3107 |
| `profile_enrich_batch` | call `GET :3100/api/profile/:username` in loop | 3100 |
| `tiktok_discover` | call `POST :3102/api/prospect/discover` | 3102 |
| `twitter_discover` | call `POST :3003/api/prospect/discover` | 3003 |
| `comment_sweep` | call `POST :3005/api/instagram/comments/post` | 3005 |

**File to edit**: `~/bin/ig-daemon` — add cases in the `case "$action"` block.

### 4b. agentlite cloud brain (Vercel)

Status: ✅ Built by ACD agent. Needs deployment.

```bash
cd /Users/isaiahdupree/Documents/Software/agentlite
npx vercel --yes --prod
```

After deployment, add to `.env.local`:
```
CRON_SECRET=<generate with: openssl rand -hex 16>
```

And add to Vercel project env vars the same `CRON_SECRET` so the cron auth header matches.

### 4c. safari_command_queue — `processed_at` column

The result processor in agentlite marks rows as `processed_at` after reading results.
This column may not exist in the current Supabase schema.

**Migration to run**:
```sql
ALTER TABLE safari_command_queue ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
```

---

## 5. Self-Improving Loop (actp-worker)

Status: ✅ Built by ACD agent.

Files added to `/Users/isaiahdupree/Documents/Software/actp-worker/`:
- `performance_tracker.py`
- `template_ab_tester.py`
- `self_heal_dispatcher.py`

### Integration still needed

- [ ] `heartbeat_agent.py`: import and call `PerformanceTracker().run()` in the heartbeat loop
- [ ] Supabase `actp_dm_templates` table: run seed migration once
- [ ] Supabase `agent_metrics` table: created by agentlite on first deploy

---

## 6. MCP Registration

All packages have MCP servers. All are registered in `claude_desktop_config.json`. ✅

To reload after server changes: **restart Claude Desktop**.

To verify a specific MCP is working:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | npx tsx packages/instagram-dm/src/api/mcp-server.ts
```

---

## 7. Watchdog Improvements

Current watchdog (`watchdog-safari.sh`) restarts servers every 30s if down.

### Missing
- [ ] Watchdog does not notify on repeated restart loops (a server crashing 10x/hour means a bug, not just a restart)
- [ ] No health check timeout differentiation — all ports treated the same
- [ ] No Telegram alert when a port stays down > 5 minutes
- [ ] tiktok-dm (:3102) and upwork-hunter (:3107) not in watchdog

### Fix: add Telegram alert to watchdog
```bash
# Add to watchdog-safari.sh restart block:
if [ "$restart_count_$port" -gt 3 ]; then
  curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "text=⚠️ :$port restarting repeatedly (${restart_count} times). Check logs."
fi
```

---

## 8. Shared Utilities (reduce duplication across packages)

Currently each package has its own copy of `tab-coordinator.ts`. If the file is ever updated,
all copies need updating. Options:

### Option A: npm workspace shared package (recommended long-term)
Create `packages/shared/src/tab-coordinator.ts` and reference via workspace:
```json
// Each package.json:
"dependencies": { "@safari-automation/shared": "workspace:*" }
```

### Option B: symlink (quick)
```bash
for pkg in twitter-dm tiktok-dm instagram-comments twitter-comments threads-comments linkedin-automation market-research; do
  rm -f "packages/$pkg/src/automation/tab-coordinator.ts"
  ln -s "../../instagram-dm/src/automation/tab-coordinator.ts" \
        "packages/$pkg/src/automation/tab-coordinator.ts"
done
```

**Current approach**: copies. ⚠️ Manual sync required on changes.

---

## 9. Priority Order for Remaining Work

| Priority | Task | Effort | Owner |
|----------|------|--------|-------|
| ✅ P0 | Start tiktok-dm (:3102) and upwork-hunter (:3107) and add to watchdog | done 2026-03-06 |
| 🔴 P0 | Deploy agentlite to Vercel + set CRON_SECRET | 15 min | manual |
| 🔴 P0 | Run `ALTER TABLE safari_command_queue ADD COLUMN processed_at` migration | 2 min | manual |
| 🔴 P0 | Add `prospect_discover`, `dm_batch`, `upwork_scan` to ig-daemon | ACD agent |
| 🟠 P1 | Complete tab mgmt for twitter-comments, linkedin-automation, market-research | ACD agent |
| 🟠 P1 | Port `/api/prospect/run-pipeline` + `schedule-batch` to twitter-dm and tiktok-dm | ACD agent |
| 🟠 P1 | Add rate limits to `/health` response on all DM agents | ACD agent |
| 🟡 P2 | Add CRMLite sync to linkedin-automation and threads-comments sends | ACD agent |
| 🟡 P2 | Watchdog: add tiktok-dm + upwork-hunter + Telegram alert on repeated restart | ACD agent |
| 🟡 P2 | Integrate `performance_tracker.py` into heartbeat_agent.py | manual or ACD |
| 🟢 P3 | Extract shared `tab-coordinator.ts` to npm workspace package | ACD agent |
| 🟢 P3 | Port prospect-review CLI to twitter-dm and tiktok-dm | ACD agent |
| 🟢 P3 | tiktok-comments package (port 3006) — full new build | ACD agent |

---

## 10. Quick Reference: How to Dispatch an ACD Agent

```bash
H=/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness

# 1. Write PRD to harness/prompts/<slug>.md
# 2. Write features JSON to harness/<slug>-features.json
# 3. Launch:
env -u CLAUDECODE node "$H/../harness/run-harness-v2.js" \
  --path="<target-repo>" \
  --project="<slug>" \
  --model="claude-sonnet-4-6" \
  --fallback-model="claude-haiku-4-5-20251001" \
  --max-retries=3 \
  --prompt="$H/prompts/<slug>.md" \
  --feature-list="$H/<slug>-features.json" \
  --adaptive-delay --force-coding --until-complete \
  >> "$H/logs/<slug>.log" 2>&1 &

# Monitor:
tail -f "$H/logs/<slug>.log" | grep -E "Session #|Progress:|✅|❌"
```

---

## 11. Environment Variables Required Across All Agents

Every agent's `.env` or system env should have:

```bash
# Supabase (shared project)
SUPABASE_URL=https://ivhfuhxorppptyuofbgq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key>
SUPABASE_ANON_KEY=<key>

# CRMLite sync
CRMLITE_API_KEY=<key>

# Anthropic (for AI DM generation)
ANTHROPIC_API_KEY=<key>

# Telegram (alerts, Upwork approvals)
TELEGRAM_BOT_TOKEN=<key>
TELEGRAM_CHAT_ID=<id>

# Vercel (for Upwork builder deploys)
VERCEL_TOKEN=<key>

# Agentlite cron auth
CRON_SECRET=<32-char hex>
```

Check `.env` presence:
```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation"
cat .env | grep -E "SUPABASE|CRMLITE|ANTHROPIC|TELEGRAM" | sed 's/=.*/=<set>/'
```
