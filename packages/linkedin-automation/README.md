# LinkedIn Safari Automation — Scale & Reliability Fixes

This package provides Safari browser automation for LinkedIn connections, messaging, and lead management. The current phase (LS-001 through LS-006) focuses on scale bottlenecks, fragile selectors, reply detection, and session monitoring.

## Project Structure

```
linkedin-automation/
├── src/
│   ├── automation/           # Core automation logic
│   │   ├── safari-driver.ts  # Low-level Safari/AppleScript control
│   │   ├── dm-operations.ts  # Direct message operations
│   │   ├── connection-operations.ts
│   │   ├── types.ts          # TypeScript interfaces
│   │   └── index.ts
│   ├── api/
│   │   ├── server.ts         # Express REST API (port 3105)
│   │   └── mcp-server.ts     # MCP protocol server
│   └── index.ts
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

## Features

### Implemented (LI-001 through LI-007)
- ✅ Native click automation (bypasses JS event limitations)
- ✅ Message overlay detection and handling
- ✅ Compose input focus fixes
- ✅ New compose endpoint for direct messaging
- ✅ waitForCondition polling system
- ✅ Force flag for bypassing safety checks
- ✅ Via-Google navigation (bypasses bot detection)

### In Progress (LS-001 through LS-006)
- 🔨 LS-001: Multi-tab SafariDriver + Playwright integration for parallel scraping
- 🔨 LS-002: MutationObserver DOM change detection (replacing fixed sleep polls)
- 🔨 LS-003: Semantic selector system with health-check endpoint
- 🔨 LS-004: Background reply watcher with Supabase webhook
- 🔨 LS-005: Hybrid clipboard + character-by-character keystroke fallback
- 🔨 LS-006: Session health heartbeat monitor with Supabase flag

## Installation

```bash
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation/packages/linkedin-automation
npm install
```

## Development

### Build TypeScript
```bash
npm run build
```

### Type-check without emitting files
```bash
npx tsc --noEmit
```

### Start REST API Server (port 3105)
```bash
npm run start:server
```

### Start MCP Server
```bash
npm run start:mcp
```

## Environment Variables

Create a `.env` file in the package root:

```bash
# Safari automation window index (default: 1)
SAFARI_AUTOMATION_WINDOW=1

# Playwright mode (optional)
PLAYWRIGHT_ENABLED=false

# Reply watcher interval (ms, default: 300000 = 5 min)
REPLY_POLL_INTERVAL_MS=300000

# Session health check interval (ms, default: 1800000 = 30 min)
SESSION_HEALTH_INTERVAL_MS=1800000

# Supabase (optional — required for reply watcher and session health)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Testing

After implementing each feature:

1. **Type-check:** `npx tsc --noEmit` from the package root
2. **Build:** `npm run build`
3. **Manual test:** Start the server and test the new endpoints
4. **Update feature status:** Mark `"passes": true` in the feature list

## API Endpoints

### Core Operations
- `POST /api/linkedin/send-message` — Send a DM to a profile
- `POST /api/linkedin/connect` — Send connection request
- `POST /api/linkedin/search` — Search for profiles

### New Endpoints (LS-001+)
- `POST /api/linkedin/tabs/open` — Open new Safari tab (LS-001)
- `GET /api/linkedin/tabs/list` — List tab pool status (LS-001)
- `POST /api/linkedin/debug/wait-for-selector` — Test MutationObserver (LS-002)
- `GET /api/linkedin/debug/selector-health` — Check selector validity (LS-003)
- `GET /api/linkedin/replies/unread` — Get unread replies (LS-004)
- `POST /api/linkedin/replies/watcher/start` — Start reply watcher (LS-004)
- `POST /api/linkedin/replies/watcher/stop` — Stop reply watcher (LS-004)
- `POST /api/linkedin/debug/type-test` — Test typing methods (LS-005)
- `GET /api/linkedin/health/session` — Session health status (LS-006)
- `GET /api/linkedin/health/full` — Full health check (LS-006)

## Architecture

### SafariDriver
Low-level Safari automation via AppleScript and JavaScript injection. Supports:
- Local Safari via AppleScript
- Remote Safari via HTTP endpoints
- Tab pool management (multi-tab support)
- MutationObserver-based waiting (efficient DOM change detection)
- Session tracking and verification

### MCP Server
Model Context Protocol server for integration with Claude Code and other AI tools.

## Coding Rules

- **NO mock data** in production source code
- Always use real Supabase tables when configured
- Every new endpoint must have a working implementation
- Test all features before marking as passing
- Commit after completing each feature

## Debugging

### Check if Safari is running LinkedIn automation
```bash
curl http://localhost:3105/api/linkedin/health/session
```

### View tab pool
```bash
curl http://localhost:3105/api/linkedin/tabs/list
```

### Test selector health
```bash
curl http://localhost:3105/api/linkedin/debug/selector-health
```

## Contributing

This is an autonomous coding project. All changes are tracked in:
- `/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/features/linkedin-safari-scale-fixes.json`
- Feature progress logged in `claude-progress.txt`

## License

Private — Isaiah Dupree
