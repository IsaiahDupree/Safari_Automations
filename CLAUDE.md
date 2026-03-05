# Safari Automation — Claude Code Context

## What This Is
9 Node.js REST services + 4 MCP servers for social media automation via Safari browser control.
All services run locally on your Mac. Safari must be open and logged into each platform.

Path: /Users/isaiahdupree/Documents/Software/Safari Automation
Shell: ALWAYS use `/bin/zsh -l` (login shell) so npx is on PATH.

---

## Services — Start Commands

```bash
# Start ALL 9 services (run from Safari Automation root):
npm run --prefix packages/instagram-dm start:server        # port 3100
npm run --prefix packages/twitter-dm start:server          # port 3003
npm run --prefix packages/tiktok-dm start:server           # port 3102
npm run --prefix packages/linkedin-automation start:server # port 3105
npm run --prefix packages/instagram-comments start:server  # port 3005
npm run --prefix packages/tiktok-comments start:server     # port 3006
npm run --prefix packages/twitter-comments start:server    # port 3007
npm run --prefix packages/threads-comments start:server    # port 3004
npm run --prefix packages/market-research start:server     # port 3106
```

**One-liner to start all in background:**
```bash
for pkg in instagram-dm twitter-dm tiktok-dm linkedin-automation instagram-comments tiktok-comments twitter-comments threads-comments market-research; do
  npm run --prefix packages/$pkg start:server > /tmp/safari-$pkg.log 2>&1 &
done
```

---

## Health Checks

```bash
# Check all 9 ports:
for port in 3100 3003 3102 3105 3005 3006 3007 3004 3106; do
  status=$(curl -s --max-time 3 http://localhost:$port/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('UP')" 2>/dev/null || echo "DOWN")
  echo "Port $port: $status"
done
```

| Service | Port | Package |
|---------|------|---------|
| Instagram DM | 3100 | instagram-dm |
| Twitter DM | 3003 | twitter-dm |
| TikTok DM | 3102 | tiktok-dm |
| LinkedIn DM | 3105 | linkedin-automation |
| Instagram Comments | 3005 | instagram-comments |
| TikTok Comments | 3006 | tiktok-comments |
| Twitter Comments | 3007 | twitter-comments |
| Threads Comments | 3004 | threads-comments |
| Market Research | 3106 | market-research |

---

## MCP Servers (Claude Code tools)

Located at: `packages/{platform}-dm/src/api/mcp-server.ts`

| MCP Server | Package | Tools prefix |
|------------|---------|-------------|
| Instagram | instagram-dm | instagram_* |
| Twitter | twitter-dm | twitter_* |
| TikTok | tiktok-dm | tiktok_* |
| LinkedIn | linkedin-automation | linkedin_* |

MCP config entry (~/.codeium/windsurf/mcp_config.json):
```json
"instagram": { "command": "npx", "args": ["tsx", "packages/instagram-dm/src/api/mcp-server.ts"] }
```

---

## API Endpoints

### DM Services (instagram, twitter, tiktok, linkedin)
```
GET  /health
GET  /api/{platform}/conversations
GET  /api/{platform}/messages/{username}
POST /api/{platform}/send              body: { username, message }
POST /api/{platform}/session/ensure
```

### Comment Services (instagram, tiktok, twitter, threads)
```
POST /api/{platform}/comments/post     body: { postUrl, comment }
GET  /api/{platform}/comments/get      body: { postUrl }
```

### Market Research (port 3106)
```
POST /api/research/{platform}/search   body: { keyword, maxResults }
```

---

## CRM Brain Integration

```bash
# Sync all platform conversations → Supabase CRM:
cd /Users/isaiahdupree/Documents/Software/actp-worker
python3 scripts/crm_brain.py --sync

# Full pipeline: sync + score + generate + send:
python3 scripts/crm_brain.py --pipeline
```

CRM Brain connects to these services to pull conversations.
All 9 services must be running for a full sync.

---

## Target Contacts

| Person | Instagram | Twitter | TikTok | LinkedIn |
|--------|-----------|---------|--------|---------|
| Sarah E Ashley | Sarah Ashley | saraheashley | Sarah E Ashley | do not DM |
| Isaiah Dupree | the_isaiah_dupree | IsaiahDupree7 | — | do not DM on LI |

---

## Safari Cloud Controller

The cloud controller lets remote agents trigger local Safari actions via Supabase queue:
```bash
python3 /Users/isaiahdupree/Documents/Software/actp-worker/scripts/safari_cloud_controller.py --daemon
```
Actions: navigate, send_dm, comment, market_research, sync, score, generate, pipeline

---

## Build & TypeScript

```bash
# Build all packages:
npm run build  # from root

# Type-check a specific package:
npx tsc --noEmit --project packages/instagram-dm/tsconfig.json

# Install dependencies for a package:
npm install --prefix packages/instagram-dm
```

---

## Common Issues

- **npx not found**: Use `/bin/zsh -l` login shell
- **Service not responding**: Check Safari is open and logged into the platform
- **Session expired**: Call `POST /api/{platform}/session/ensure` then retry
- **Rate limited**: Wait 60s, then retry. Twitter is strictest.
- **LinkedIn is different**: Calls functions directly (no HTTP hop), fastest + best errors
