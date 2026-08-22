# Safari Automation Agent Service and Contract Guide

> Repository-owned documentation. It does not require an external control plane.

Singleton Safari automation services for social research, inboxes, comments, and platform operations.

## Agent operating rules

1. Read this guide before changing an API, queue, schema, provider adapter, database object, or cross-system payload.
2. Treat JSON Schema and OpenAPI files as authoritative. Typed application models are implementation contracts unless explicitly exported.
3. Do not guess route parameters, environment values, account IDs, provider IDs, or receipt fields.
4. Read operations do not authorize writes. Provider writes, publishing, messages, paid compute, destructive controls, and migrations require their owning approval policy.
5. Persist idempotency and provider/job receipts before retrying an accepted or ambiguous external write.
6. Never place credential values in source, docs, fixtures, logs, generated artifacts, or receipts.

## Inventory summary

- Static API routes: **786** (457 potentially mutating)
- Formal JSON Schema/OpenAPI contracts: **2**
- Typed application models: **652**
- Database objects declared in migrations: **27**
- Environment-variable names: **134**
- Package manifests with scripts: **30**
- Source fingerprint: `7b52e99916f6dc05cb267bd6e1060714d12f765250561fc7f1b3b2c9d7da633c`

This is a static source inventory, not a live health report. Dynamic routes and runtime registrations must be verified through the repository's own health/discovery interface.

## Service entrypoints

| Package | Manifest | Script names |
|---|---|---|
| `@safari-automation/api` | [`apps/api/package.json`](apps/api/package.json) | build, dev, start, test |
| `safari-automation` | [`package.json`](package.json) | api:build, api:install, api:start, api:test, automation:start, automation:stop, build, clean, db:migrate, db:seed, format, health:check, lint, lint:fix, prepare, selectors:health, selectors:test, session:create, session:verify, test, tes... |
| `@safari-automation/adobe-firefly` | [`packages/adobe-firefly/package.json`](packages/adobe-firefly/package.json) | build, dev, test |
| `@safari-automation/cloud-sync` | [`packages/cloud-sync/package.json`](packages/cloud-sync/package.json) | dev, start, test:push-arch |
| `@safari-automation/crm-client` | [`packages/crm-client/package.json`](packages/crm-client/package.json) | build, dev |
| `@safari-automation/crm-core` | [`packages/crm-core/package.json`](packages/crm-core/package.json) | build, lint, test, test:watch |
| `@safari-automation/facebook-comments` | [`packages/facebook-comments/package.json`](packages/facebook-comments/package.json) | build, test |
| `@safari-automation/instagram-comments` | [`packages/instagram-comments/package.json`](packages/instagram-comments/package.json) | build, dev, start, test |
| `@safari-automation/instagram-dm` | [`packages/instagram-dm/package.json`](packages/instagram-dm/package.json) | build, start:server, test, test:watch |
| `dashboard` | [`packages/linkedin-automation/dashboard/package.json`](packages/linkedin-automation/dashboard/package.json) | build, dev, lint, preview, server, start |
| `@safari-automation/linkedin-automation` | [`packages/linkedin-automation/package.json`](packages/linkedin-automation/package.json) | build, start:mcp, start:server |
| `@safari-automation/linkedin-chrome` | [`packages/linkedin-chrome/package.json`](packages/linkedin-chrome/package.json) | start:mcp |
| `@safari-automation/market-research` | [`packages/market-research/package.json`](packages/market-research/package.json) | build, dev, mcp-server, start, start:server, test |
| `@safari-automation/medium-automation` | [`packages/medium-automation/package.json`](packages/medium-automation/package.json) | build, dev, start, test |
| `@safari-automation/protocol` | [`packages/protocol/package.json`](packages/protocol/package.json) | build, start, start:control, start:telemetry |
| `@safari-automation/mcp-server` | [`packages/safari-mcp/package.json`](packages/safari-mcp/package.json) | build, dev, start |
| `@safari-automation/scheduler` | [`packages/scheduler/package.json`](packages/scheduler/package.json) | build, cli, dev, test, test:watch |
| `@safari-automation/social-cli` | [`packages/social-cli/package.json`](packages/social-cli/package.json) | build, start, test |
| `@safari-automation/sora-automation` | [`packages/sora-automation/package.json`](packages/sora-automation/package.json) | build, dev, start:server, test |
| `@safari-automation/threads-comments` | [`packages/threads-comments/package.json`](packages/threads-comments/package.json) | build, dev, start, test |
| `@safari-automation/tiktok-comments` | [`packages/tiktok-comments/package.json`](packages/tiktok-comments/package.json) | build, dev, test |
| `@safari-automation/tiktok-dm` | [`packages/tiktok-dm/package.json`](packages/tiktok-dm/package.json) | build, start:server, test, test:watch |
| `@safari-automation/twitter-comments` | [`packages/twitter-comments/package.json`](packages/twitter-comments/package.json) | build, dev, test |
| `@safari-automation/twitter-dm` | [`packages/twitter-dm/package.json`](packages/twitter-dm/package.json) | build, start:server, test, test:watch |
| `@safari-automation/unified-client` | [`packages/unified-client/package.json`](packages/unified-client/package.json) | build, test, test:watch |
| `@safari-automation/unified-comments` | [`packages/unified-comments/package.json`](packages/unified-comments/package.json) | build, dev, test |
| `@safari/unified-control` | [`packages/unified-control/package.json`](packages/unified-control/package.json) | build, dev, start, start:server |
| `@safari-automation/unified-dm` | [`packages/unified-dm/package.json`](packages/unified-dm/package.json) | build, dev, test |
| `@safari-automation/upwork-automation` | [`packages/upwork-automation/package.json`](packages/upwork-automation/package.json) | build, start:server |
| `@safari-automation/upwork-hunter` | [`packages/upwork-hunter/package.json`](packages/upwork-hunter/package.json) | build, start:server, test, test:watch |

## HTTP and API surface

| Method | Route | Source | Write review |
|---|---|---|---|
| `GET` | `/` | [`packages/unified-control/src/index.ts:182`](packages/unified-control/src/index.ts#L182) | `read` |
| `POST` | `/analytics/apply-insights` | [`scripts/acquisition/api/routes/reports.py:198`](scripts/acquisition/api/routes/reports.py#L198) | `required` |
| `GET` | `/analytics/conversion` | [`scripts/acquisition/api/routes/reports.py:188`](scripts/acquisition/api/routes/reports.py#L188) | `read` |
| `POST` | `/analytics/update-variants` | [`scripts/acquisition/api/routes/reports.py:208`](scripts/acquisition/api/routes/reports.py#L208) | `required` |
| `GET` | `/analytics/variants` | [`scripts/acquisition/api/routes/reports.py:193`](scripts/acquisition/api/routes/reports.py#L193) | `read` |
| `GET` | `/api/acquisition/dashboard` | [`scripts/acquisition/api/server.py:55`](scripts/acquisition/api/server.py#L55) | `read` |
| `GET` | `/api/acquisition/status` | [`scripts/acquisition/api/server.py:41`](scripts/acquisition/api/server.py#L41) | `read` |
| `GET` | `/api/actions/pending` | [`packages/cloud-sync/src/api/server.ts:154`](packages/cloud-sync/src/api/server.ts#L154) | `read` |
| `POST` | `/api/actions/process` | [`packages/cloud-sync/src/api/server.ts:177`](packages/cloud-sync/src/api/server.ts#L177) | `required` |
| `POST` | `/api/actions/queue` | [`packages/cloud-sync/src/api/server.ts:160`](packages/cloud-sync/src/api/server.ts#L160) | `required` |
| `POST` | `/api/ai/generate` | [`packages/instagram-dm/src/api/server.ts:1578`](packages/instagram-dm/src/api/server.ts#L1578) | `required` |
| `POST` | `/api/ai/score` | [`packages/market-research/src/api/server.ts:2195`](packages/market-research/src/api/server.ts#L2195) | `required` |
| `POST` | `/api/ai/suggest-reply` | [`packages/market-research/src/api/server.ts:2119`](packages/market-research/src/api/server.ts#L2119) | `required` |
| `GET` | `/api/analytics/brief` | [`packages/cloud-sync/src/api/server.ts:198`](packages/cloud-sync/src/api/server.ts#L198) | `read` |
| `GET` | `/api/analytics/dashboard` | [`packages/cloud-sync/src/api/server.ts:204`](packages/cloud-sync/src/api/server.ts#L204) | `read` |
| `GET` | `/api/analytics/goals` | [`packages/cloud-sync/src/api/server.ts:211`](packages/cloud-sync/src/api/server.ts#L211) | `read` |
| `GET` | `/api/analytics/learnings` | [`packages/cloud-sync/src/api/server.ts:192`](packages/cloud-sync/src/api/server.ts#L192) | `read` |
| `POST` | `/api/analytics/run` | [`packages/cloud-sync/src/api/server.ts:186`](packages/cloud-sync/src/api/server.ts#L186) | `required` |
| `GET` | `/api/browser/agents` | [`packages/unified-control/src/index.ts:122`](packages/unified-control/src/index.ts#L122) | `read` |
| `POST` | `/api/browser/command` | [`packages/unified-control/src/index.ts:67`](packages/unified-control/src/index.ts#L67) | `required` |
| `POST` | `/api/build/:jobId` | [`packages/upwork-hunter/src/api/server.ts:386`](packages/upwork-hunter/src/api/server.ts#L386) | `required` |
| `GET` | `/api/build/status/:jobId` | [`packages/upwork-hunter/src/api/server.ts:432`](packages/upwork-hunter/src/api/server.ts#L432) | `read` |
| `GET` | `/api/campaigns` | [`packages/linkedin-automation/dashboard/server.js:29`](packages/linkedin-automation/dashboard/server.js#L29) | `read` |
| `POST` | `/api/chrome/tabs/claim` | [`packages/linkedin-automation/src/api/server.ts:1896`](packages/linkedin-automation/src/api/server.ts#L1896) | `required` |
| `GET` | `/api/chrome/tabs/claims` | [`packages/linkedin-automation/src/api/server.ts:1891`](packages/linkedin-automation/src/api/server.ts#L1891) | `read` |
| `POST` | `/api/chrome/tabs/heartbeat` | [`packages/linkedin-automation/src/api/server.ts:1920`](packages/linkedin-automation/src/api/server.ts#L1920) | `required` |
| `POST` | `/api/chrome/tabs/release` | [`packages/linkedin-automation/src/api/server.ts:1912`](packages/linkedin-automation/src/api/server.ts#L1912) | `required` |
| `GET` | `/api/comments/status` | [`packages/scheduler/src/api/server.ts:353`](packages/scheduler/src/api/server.ts#L353) | `read` |
| `POST` | `/api/comments/threads/multi` | [`packages/scheduler/src/api/server.ts:335`](packages/scheduler/src/api/server.ts#L335) | `required` |
| `PUT` | `/api/config` | [`packages/instagram-dm/src/api/server.ts:1631`](packages/instagram-dm/src/api/server.ts#L1631) | `required` |
| `GET` | `/api/connects` | [`packages/upwork-hunter/src/api/server.ts:327`](packages/upwork-hunter/src/api/server.ts#L327) | `read` |
| `POST` | `/api/content/package` | [`packages/scheduler/src/api/server.ts:1100`](packages/scheduler/src/api/server.ts#L1100) | `required` |
| `POST` | `/api/content/package/send` | [`packages/scheduler/src/api/server.ts:1147`](packages/scheduler/src/api/server.ts#L1147) | `required` |
| `GET` | `/api/conversations` | [`packages/instagram-dm/src/api/server.ts:394`](packages/instagram-dm/src/api/server.ts#L394) | `read` |
| `GET` | `/api/conversations` | [`packages/tiktok-dm/src/api/server.ts:977`](packages/tiktok-dm/src/api/server.ts#L977) | `read` |
| `GET` | `/api/conversations/all` | [`packages/instagram-dm/src/api/server.ts:440`](packages/instagram-dm/src/api/server.ts#L440) | `read` |
| `POST` | `/api/conversations/new` | [`packages/instagram-dm/src/api/server.ts:595`](packages/instagram-dm/src/api/server.ts#L595) | `required` |
| `POST` | `/api/conversations/open` | [`packages/instagram-dm/src/api/server.ts:519`](packages/instagram-dm/src/api/server.ts#L519) | `required` |
| `POST` | `/api/conversations/open` | [`packages/tiktok-dm/src/api/server.ts:987`](packages/tiktok-dm/src/api/server.ts#L987) | `required` |
| `GET` | `/api/conversations/unread` | [`packages/instagram-dm/src/api/server.ts:451`](packages/instagram-dm/src/api/server.ts#L451) | `read` |
| `POST` | `/api/crm/score` | [`packages/instagram-dm/src/api/server.ts:717`](packages/instagram-dm/src/api/server.ts#L717) | `required` |
| `POST` | `/api/crm/score-all` | [`packages/instagram-dm/src/api/server.ts:726`](packages/instagram-dm/src/api/server.ts#L726) | `required` |
| `GET` | `/api/crm/stats` | [`packages/instagram-dm/src/api/server.ts:708`](packages/instagram-dm/src/api/server.ts#L708) | `read` |
| `GET` | `/api/crm/top-contacts` | [`packages/instagram-dm/src/api/server.ts:733`](packages/instagram-dm/src/api/server.ts#L733) | `read` |
| `GET` | `/api/cron/jobs` | [`packages/cloud-sync/src/api/server.ts:328`](packages/cloud-sync/src/api/server.ts#L328) | `read` |
| `PUT` | `/api/cron/jobs/:slug` | [`packages/cloud-sync/src/api/server.ts:333`](packages/cloud-sync/src/api/server.ts#L333) | `required` |
| `POST` | `/api/cron/jobs/:slug/trigger` | [`packages/cloud-sync/src/api/server.ts:346`](packages/cloud-sync/src/api/server.ts#L346) | `required` |
| `POST` | `/api/debug/eval` | [`packages/instagram-comments/src/api/server.ts:1629`](packages/instagram-comments/src/api/server.ts#L1629) | `required` |
| `POST` | `/api/debug/eval` | [`packages/instagram-dm/src/api/server.ts:1642`](packages/instagram-dm/src/api/server.ts#L1642) | `required` |
| `POST` | `/api/debug/eval` | [`packages/linkedin-automation/src/api/server.ts:1958`](packages/linkedin-automation/src/api/server.ts#L1958) | `required` |
| `POST` | `/api/debug/eval` | [`packages/market-research/src/api/server.ts:2339`](packages/market-research/src/api/server.ts#L2339) | `required` |
| `POST` | `/api/debug/eval` | [`packages/threads-comments/src/api/server.ts:1101`](packages/threads-comments/src/api/server.ts#L1101) | `required` |
| `POST` | `/api/debug/eval` | [`packages/tiktok-dm/src/api/server.ts:1328`](packages/tiktok-dm/src/api/server.ts#L1328) | `required` |
| `POST` | `/api/debug/eval` | [`packages/twitter-comments/src/api/server.ts:1003`](packages/twitter-comments/src/api/server.ts#L1003) | `required` |
| `POST` | `/api/debug/eval` | [`packages/twitter-dm/src/api/server.ts:697`](packages/twitter-dm/src/api/server.ts#L697) | `required` |
| `POST` | `/api/dm/schedule` | [`packages/scheduler/src/api/server.ts:286`](packages/scheduler/src/api/server.ts#L286) | `required` |
| `GET` | `/api/dms` | [`packages/cloud-sync/src/api/server.ts:120`](packages/cloud-sync/src/api/server.ts#L120) | `read` |
| `POST` | `/api/dms/:id/replied` | [`packages/cloud-sync/src/api/server.ts:127`](packages/cloud-sync/src/api/server.ts#L127) | `required` |
| `POST` | `/api/execute` | [`packages/instagram-dm/src/api/server.ts:1597`](packages/instagram-dm/src/api/server.ts#L1597) | `required` |
| `POST` | `/api/execute` | [`packages/tiktok-dm/src/api/server.ts:863`](packages/tiktok-dm/src/api/server.ts#L863) | `required` |
| `POST` | `/api/facebook/comment` | [`packages/facebook-comments/src/api/server.ts:149`](packages/facebook-comments/src/api/server.ts#L149) | `required` |
| `POST` | `/api/facebook/navigate` | [`packages/facebook-comments/src/api/server.ts:166`](packages/facebook-comments/src/api/server.ts#L166) | `required` |
| `GET` | `/api/facebook/post` | [`packages/facebook-comments/src/api/server.ts:175`](packages/facebook-comments/src/api/server.ts#L175) | `read` |
| `POST` | `/api/facebook/research/niche` | [`packages/facebook-comments/src/api/server.ts:198`](packages/facebook-comments/src/api/server.ts#L198) | `required` |
| `POST` | `/api/facebook/research/search` | [`packages/facebook-comments/src/api/server.ts:187`](packages/facebook-comments/src/api/server.ts#L187) | `required` |
| `POST` | `/api/facebook/scroll` | [`packages/facebook-comments/src/api/server.ts:181`](packages/facebook-comments/src/api/server.ts#L181) | `required` |
| `GET` | `/api/facebook/status` | [`packages/facebook-comments/src/api/server.ts:143`](packages/facebook-comments/src/api/server.ts#L143) | `read` |
| `POST` | `/api/feedback/analyze` | [`packages/market-research/src/api/server.ts:1454`](packages/market-research/src/api/server.ts#L1454) | `required` |
| `POST` | `/api/feedback/check-backs` | [`packages/market-research/src/api/server.ts:1426`](packages/market-research/src/api/server.ts#L1426) | `required` |
| `POST` | `/api/feedback/cycle` | [`packages/market-research/src/api/server.ts:1489`](packages/market-research/src/api/server.ts#L1489) | `required` |
| `GET` | `/api/feedback/due` | [`packages/market-research/src/api/server.ts:1558`](packages/market-research/src/api/server.ts#L1558) | `read` |
| `POST` | `/api/feedback/generate-prompt` | [`packages/market-research/src/api/server.ts:1476`](packages/market-research/src/api/server.ts#L1476) | `required` |
| `POST` | `/api/feedback/metrics` | [`packages/market-research/src/api/server.ts:1437`](packages/market-research/src/api/server.ts#L1437) | `required` |
| `GET` | `/api/feedback/niches` | [`packages/market-research/src/api/server.ts:1532`](packages/market-research/src/api/server.ts#L1532) | `read` |
| `POST` | `/api/feedback/niches` | [`packages/market-research/src/api/server.ts:1522`](packages/market-research/src/api/server.ts#L1522) | `required` |
| `GET` | `/api/feedback/offers` | [`packages/market-research/src/api/server.ts:1516`](packages/market-research/src/api/server.ts#L1516) | `read` |
| `POST` | `/api/feedback/offers` | [`packages/market-research/src/api/server.ts:1506`](packages/market-research/src/api/server.ts#L1506) | `required` |
| `POST` | `/api/feedback/register` | [`packages/market-research/src/api/server.ts:1397`](packages/market-research/src/api/server.ts#L1397) | `required` |
| `POST` | `/api/feedback/register/batch` | [`packages/market-research/src/api/server.ts:1410`](packages/market-research/src/api/server.ts#L1410) | `required` |
| `GET` | `/api/feedback/status` | [`packages/market-research/src/api/server.ts:1391`](packages/market-research/src/api/server.ts#L1391) | `read` |
| `GET` | `/api/feedback/strategy` | [`packages/market-research/src/api/server.ts:1465`](packages/market-research/src/api/server.ts#L1465) | `read` |
| `GET` | `/api/feedback/tweets` | [`packages/market-research/src/api/server.ts:1538`](packages/market-research/src/api/server.ts#L1538) | `read` |
| `GET` | `/api/firefly/config` | [`packages/adobe-firefly/src/api/server.ts:177`](packages/adobe-firefly/src/api/server.ts#L177) | `read` |
| `PUT` | `/api/firefly/config` | [`packages/adobe-firefly/src/api/server.ts:181`](packages/adobe-firefly/src/api/server.ts#L181) | `required` |
| `POST` | `/api/firefly/download` | [`packages/adobe-firefly/src/api/server.ts:167`](packages/adobe-firefly/src/api/server.ts#L167) | `required` |
| `POST` | `/api/firefly/generate` | [`packages/adobe-firefly/src/api/server.ts:119`](packages/adobe-firefly/src/api/server.ts#L119) | `required` |
| `GET` | `/api/firefly/images` | [`packages/adobe-firefly/src/api/server.ts:158`](packages/adobe-firefly/src/api/server.ts#L158) | `read` |
| `POST` | `/api/firefly/navigate` | [`packages/adobe-firefly/src/api/server.ts:110`](packages/adobe-firefly/src/api/server.ts#L110) | `required` |
| `GET` | `/api/firefly/rate-limits` | [`packages/adobe-firefly/src/api/server.ts:186`](packages/adobe-firefly/src/api/server.ts#L186) | `read` |
| `PUT` | `/api/firefly/rate-limits` | [`packages/adobe-firefly/src/api/server.ts:190`](packages/adobe-firefly/src/api/server.ts#L190) | `required` |
| `GET` | `/api/firefly/status` | [`packages/adobe-firefly/src/api/server.ts:101`](packages/adobe-firefly/src/api/server.ts#L101) | `read` |
| `POST` | `/api/inbox/navigate` | [`packages/instagram-dm/src/api/server.ts:384`](packages/instagram-dm/src/api/server.ts#L384) | `required` |
| `POST` | `/api/inbox/navigate` | [`packages/tiktok-dm/src/api/server.ts:963`](packages/tiktok-dm/src/api/server.ts#L963) | `required` |
| `POST` | `/api/inbox/tab` | [`packages/instagram-dm/src/api/server.ts:508`](packages/instagram-dm/src/api/server.ts#L508) | `required` |
| `GET` | `/api/instagram/activity/followers` | [`packages/instagram-comments/src/api/server.ts:1310`](packages/instagram-comments/src/api/server.ts#L1310) | `read` |
| `POST` | `/api/instagram/ai-message` | [`packages/instagram-comments/src/api/server.ts:876`](packages/instagram-comments/src/api/server.ts#L876) | `required` |
| `POST` | `/api/instagram/ai-score` | [`packages/instagram-comments/src/api/server.ts:913`](packages/instagram-comments/src/api/server.ts#L913) | `required` |
| `POST` | `/api/instagram/analyze` | [`packages/instagram-comments/src/api/server.ts:956`](packages/instagram-comments/src/api/server.ts#L956) | `required` |
| `POST` | `/api/instagram/comment-sweep` | [`packages/instagram-comments/src/api/server.ts:1356`](packages/instagram-comments/src/api/server.ts#L1356) | `required` |
| `GET` | `/api/instagram/comments` | [`packages/instagram-comments/src/api/server.ts:444`](packages/instagram-comments/src/api/server.ts#L444) | `read` |
| `POST` | `/api/instagram/comments/post` | [`packages/instagram-comments/src/api/server.ts:472`](packages/instagram-comments/src/api/server.ts#L472) | `required` |
| `GET` | `/api/instagram/comments/rate-limits` | [`packages/instagram-comments/src/api/server.ts:462`](packages/instagram-comments/src/api/server.ts#L462) | `read` |
| `GET` | `/api/instagram/config` | [`packages/instagram-comments/src/api/server.ts:343`](packages/instagram-comments/src/api/server.ts#L343) | `read` |
| `PUT` | `/api/instagram/config` | [`packages/instagram-comments/src/api/server.ts:348`](packages/instagram-comments/src/api/server.ts#L348) | `required` |
| `GET` | `/api/instagram/db/history` | [`packages/instagram-comments/src/api/server.ts:1175`](packages/instagram-comments/src/api/server.ts#L1175) | `read` |
| `GET` | `/api/instagram/db/stats` | [`packages/instagram-comments/src/api/server.ts:1189`](packages/instagram-comments/src/api/server.ts#L1189) | `read` |
| `GET` | `/api/instagram/dm/conversations` | [`packages/instagram-comments/src/api/server.ts:645`](packages/instagram-comments/src/api/server.ts#L645) | `read` |
| `POST` | `/api/instagram/dm/conversations/:id/archive` | [`packages/instagram-comments/src/api/server.ts:786`](packages/instagram-comments/src/api/server.ts#L786) | `required` |
| `POST` | `/api/instagram/dm/conversations/:id/read` | [`packages/instagram-comments/src/api/server.ts:744`](packages/instagram-comments/src/api/server.ts#L744) | `required` |
| `GET` | `/api/instagram/dm/messages/:id` | [`packages/instagram-comments/src/api/server.ts:680`](packages/instagram-comments/src/api/server.ts#L680) | `read` |
| `GET` | `/api/instagram/dm/rate-limits` | [`packages/instagram-comments/src/api/server.ts:710`](packages/instagram-comments/src/api/server.ts#L710) | `read` |
| `POST` | `/api/instagram/dm/send` | [`packages/instagram-comments/src/api/server.ts:543`](packages/instagram-comments/src/api/server.ts#L543) | `required` |
| `POST` | `/api/instagram/dm/suggest-reply` | [`packages/instagram-comments/src/api/server.ts:754`](packages/instagram-comments/src/api/server.ts#L754) | `required` |
| `GET` | `/api/instagram/dm/unread` | [`packages/instagram-comments/src/api/server.ts:719`](packages/instagram-comments/src/api/server.ts#L719) | `read` |
| `POST` | `/api/instagram/engage/multi` | [`packages/instagram-comments/src/api/server.ts:1020`](packages/instagram-comments/src/api/server.ts#L1020) | `required` |
| `POST` | `/api/instagram/navigate` | [`packages/instagram-comments/src/api/server.ts:424`](packages/instagram-comments/src/api/server.ts#L424) | `required` |
| `GET` | `/api/instagram/post` | [`packages/instagram-comments/src/api/server.ts:815`](packages/instagram-comments/src/api/server.ts#L815) | `read` |
| `GET` | `/api/instagram/post/metrics` | [`packages/instagram-comments/src/api/server.ts:825`](packages/instagram-comments/src/api/server.ts#L825) | `read` |
| `GET` | `/api/instagram/profile` | [`packages/instagram-comments/src/api/server.ts:359`](packages/instagram-comments/src/api/server.ts#L359) | `read` |
| `GET` | `/api/instagram/profile/posts` | [`packages/instagram-comments/src/api/server.ts:835`](packages/instagram-comments/src/api/server.ts#L835) | `read` |
| `GET` | `/api/instagram/rate-limits` | [`packages/instagram-comments/src/api/server.ts:799`](packages/instagram-comments/src/api/server.ts#L799) | `read` |
| `PUT` | `/api/instagram/rate-limits` | [`packages/instagram-comments/src/api/server.ts:804`](packages/instagram-comments/src/api/server.ts#L804) | `required` |
| `POST` | `/api/instagram/schedule` | [`packages/scheduler/src/api/server.ts:193`](packages/scheduler/src/api/server.ts#L193) | `required` |
| `POST` | `/api/instagram/search/keyword` | [`packages/instagram-comments/src/api/server.ts:1203`](packages/instagram-comments/src/api/server.ts#L1203) | `required` |
| `POST` | `/api/instagram/self-poll` | [`packages/instagram-dm/src/api/server.ts:1853`](packages/instagram-dm/src/api/server.ts#L1853) | `required` |
| `GET` | `/api/instagram/sessions` | [`packages/instagram-comments/src/api/server.ts:992`](packages/instagram-comments/src/api/server.ts#L992) | `read` |
| `POST` | `/api/instagram/sessions` | [`packages/instagram-comments/src/api/server.ts:980`](packages/instagram-comments/src/api/server.ts#L980) | `required` |
| `DELETE` | `/api/instagram/sessions/:id` | [`packages/instagram-comments/src/api/server.ts:1007`](packages/instagram-comments/src/api/server.ts#L1007) | `required` |
| `GET` | `/api/instagram/sessions/:id` | [`packages/instagram-comments/src/api/server.ts:997`](packages/instagram-comments/src/api/server.ts#L997) | `read` |
| `GET` | `/api/instagram/status` | [`packages/instagram-comments/src/api/server.ts:332`](packages/instagram-comments/src/api/server.ts#L332) | `read` |
| `POST` | `/api/jobs/clear-cache` | [`packages/upwork-hunter/src/api/server.ts:99`](packages/upwork-hunter/src/api/server.ts#L99) | `required` |
| `GET` | `/api/jobs/pending` | [`packages/upwork-hunter/src/api/server.ts:115`](packages/upwork-hunter/src/api/server.ts#L115) | `read` |
| `GET` | `/api/jobs/search` | [`packages/upwork-hunter/src/api/server.ts:104`](packages/upwork-hunter/src/api/server.ts#L104) | `read` |
| `POST` | `/api/jobs/search-upwork` | [`packages/upwork-hunter/src/api/server.ts:343`](packages/upwork-hunter/src/api/server.ts#L343) | `required` |
| `GET` | `/api/keywords` | [`packages/upwork-hunter/src/api/server.ts:675`](packages/upwork-hunter/src/api/server.ts#L675) | `read` |
| `PUT` | `/api/keywords` | [`packages/upwork-hunter/src/api/server.ts:685`](packages/upwork-hunter/src/api/server.ts#L685) | `required` |
| `POST` | `/api/linkedin/ai/generate-message` | [`packages/linkedin-automation/src/api/server.ts:1035`](packages/linkedin-automation/src/api/server.ts#L1035) | `required` |
| `POST` | `/api/linkedin/connections/accept` | [`packages/linkedin-automation/src/api/server.ts:704`](packages/linkedin-automation/src/api/server.ts#L704) | `required` |
| `GET` | `/api/linkedin/connections/pending` | [`packages/linkedin-automation/src/api/server.ts:696`](packages/linkedin-automation/src/api/server.ts#L696) | `read` |
| `POST` | `/api/linkedin/connections/request` | [`packages/linkedin-automation/src/api/server.ts:667`](packages/linkedin-automation/src/api/server.ts#L667) | `required` |
| `DELETE` | `/api/linkedin/connections/request/:requestId` | [`packages/linkedin-automation/src/api/server.ts:713`](packages/linkedin-automation/src/api/server.ts#L713) | `required` |
| `GET` | `/api/linkedin/connections/status` | [`packages/linkedin-automation/src/api/server.ts:657`](packages/linkedin-automation/src/api/server.ts#L657) | `read` |
| `GET` | `/api/linkedin/conversations` | [`packages/linkedin-automation/src/api/server.ts:842`](packages/linkedin-automation/src/api/server.ts#L842) | `read` |
| `GET` | `/api/linkedin/credits` | [`packages/linkedin-automation/src/api/server.ts:1170`](packages/linkedin-automation/src/api/server.ts#L1170) | `read` |
| `POST` | `/api/linkedin/debug/click` | [`packages/linkedin-automation/src/api/server.ts:379`](packages/linkedin-automation/src/api/server.ts#L379) | `required` |
| `POST` | `/api/linkedin/debug/js` | [`packages/linkedin-automation/src/api/server.ts:369`](packages/linkedin-automation/src/api/server.ts#L369) | `required` |
| `GET` | `/api/linkedin/debug/screenshot` | [`packages/linkedin-automation/src/api/server.ts:391`](packages/linkedin-automation/src/api/server.ts#L391) | `read` |
| `GET` | `/api/linkedin/debug/selector-health` | [`packages/linkedin-automation/src/api/server.ts:485`](packages/linkedin-automation/src/api/server.ts#L485) | `read` |
| `POST` | `/api/linkedin/debug/type-test` | [`packages/linkedin-automation/src/api/server.ts:508`](packages/linkedin-automation/src/api/server.ts#L508) | `required` |
| `POST` | `/api/linkedin/debug/wait-for-selector` | [`packages/linkedin-automation/src/api/server.ts:464`](packages/linkedin-automation/src/api/server.ts#L464) | `required` |
| `POST` | `/api/linkedin/discover/commenters` | [`packages/linkedin-automation/src/api/server.ts:2038`](packages/linkedin-automation/src/api/server.ts#L2038) | `required` |
| `GET` | `/api/linkedin/discover/hashtag` | [`packages/linkedin-automation/src/api/server.ts:1972`](packages/linkedin-automation/src/api/server.ts#L1972) | `read` |
| `GET` | `/api/linkedin/discover/my-connections` | [`packages/linkedin-automation/src/api/server.ts:2088`](packages/linkedin-automation/src/api/server.ts#L2088) | `read` |
| `POST` | `/api/linkedin/discover/profile-connections` | [`packages/linkedin-automation/src/api/server.ts:2137`](packages/linkedin-automation/src/api/server.ts#L2137) | `required` |
| `GET` | `/api/linkedin/health/full` | [`packages/linkedin-automation/src/api/server.ts:1809`](packages/linkedin-automation/src/api/server.ts#L1809) | `read` |
| `GET` | `/api/linkedin/health/session` | [`packages/linkedin-automation/src/api/server.ts:1801`](packages/linkedin-automation/src/api/server.ts#L1801) | `read` |
| `GET` | `/api/linkedin/messages` | [`packages/linkedin-automation/src/api/server.ts:851`](packages/linkedin-automation/src/api/server.ts#L851) | `read` |
| `POST` | `/api/linkedin/messages/new-compose` | [`packages/linkedin-automation/src/api/server.ts:992`](packages/linkedin-automation/src/api/server.ts#L992) | `required` |
| `POST` | `/api/linkedin/messages/open` | [`packages/linkedin-automation/src/api/server.ts:866`](packages/linkedin-automation/src/api/server.ts#L866) | `required` |
| `POST` | `/api/linkedin/messages/send` | [`packages/linkedin-automation/src/api/server.ts:875`](packages/linkedin-automation/src/api/server.ts#L875) | `required` |
| `POST` | `/api/linkedin/messages/send-to` | [`packages/linkedin-automation/src/api/server.ts:912`](packages/linkedin-automation/src/api/server.ts#L912) | `required` |
| `GET` | `/api/linkedin/messages/unread` | [`packages/linkedin-automation/src/api/server.ts:859`](packages/linkedin-automation/src/api/server.ts#L859) | `read` |
| `POST` | `/api/linkedin/navigate/messaging` | [`packages/linkedin-automation/src/api/server.ts:341`](packages/linkedin-automation/src/api/server.ts#L341) | `required` |
| `POST` | `/api/linkedin/navigate/network` | [`packages/linkedin-automation/src/api/server.ts:334`](packages/linkedin-automation/src/api/server.ts#L334) | `required` |
| `POST` | `/api/linkedin/navigate/profile` | [`packages/linkedin-automation/src/api/server.ts:348`](packages/linkedin-automation/src/api/server.ts#L348) | `required` |
| `POST` | `/api/linkedin/navigate/via-google` | [`packages/linkedin-automation/src/api/server.ts:357`](packages/linkedin-automation/src/api/server.ts#L357) | `required` |
| `POST` | `/api/linkedin/outreach` | [`packages/scheduler/src/api/server.ts:1078`](packages/scheduler/src/api/server.ts#L1078) | `required` |
| `POST` | `/api/linkedin/outreach-cycle` | [`packages/scheduler/src/api/server.ts:1036`](packages/scheduler/src/api/server.ts#L1036) | `required` |
| `POST` | `/api/linkedin/outreach-cycle/recurring` | [`packages/scheduler/src/api/server.ts:1053`](packages/scheduler/src/api/server.ts#L1053) | `required` |
| `GET` | `/api/linkedin/outreach/campaigns` | [`packages/linkedin-automation/src/api/server.ts:1425`](packages/linkedin-automation/src/api/server.ts#L1425) | `read` |
| `POST` | `/api/linkedin/outreach/campaigns` | [`packages/linkedin-automation/src/api/server.ts:1418`](packages/linkedin-automation/src/api/server.ts#L1418) | `required` |
| `GET` | `/api/linkedin/outreach/campaigns/:id` | [`packages/linkedin-automation/src/api/server.ts:1429`](packages/linkedin-automation/src/api/server.ts#L1429) | `read` |
| `GET` | `/api/linkedin/outreach/prospects` | [`packages/linkedin-automation/src/api/server.ts:1436`](packages/linkedin-automation/src/api/server.ts#L1436) | `read` |
| `POST` | `/api/linkedin/outreach/prospects/:id/convert` | [`packages/linkedin-automation/src/api/server.ts:1469`](packages/linkedin-automation/src/api/server.ts#L1469) | `required` |
| `POST` | `/api/linkedin/outreach/prospects/:id/note` | [`packages/linkedin-automation/src/api/server.ts:1481`](packages/linkedin-automation/src/api/server.ts#L1481) | `required` |
| `POST` | `/api/linkedin/outreach/prospects/:id/opt-out` | [`packages/linkedin-automation/src/api/server.ts:1475`](packages/linkedin-automation/src/api/server.ts#L1475) | `required` |
| `POST` | `/api/linkedin/outreach/prospects/:id/tag` | [`packages/linkedin-automation/src/api/server.ts:1487`](packages/linkedin-automation/src/api/server.ts#L1487) | `required` |
| `POST` | `/api/linkedin/outreach/run` | [`packages/linkedin-automation/src/api/server.ts:1457`](packages/linkedin-automation/src/api/server.ts#L1457) | `required` |
| `GET` | `/api/linkedin/outreach/runs` | [`packages/linkedin-automation/src/api/server.ts:1451`](packages/linkedin-automation/src/api/server.ts#L1451) | `read` |
| `GET` | `/api/linkedin/outreach/stats` | [`packages/linkedin-automation/src/api/server.ts:1445`](packages/linkedin-automation/src/api/server.ts#L1445) | `read` |
| `GET` | `/api/linkedin/posts/recent` | [`packages/linkedin-automation/src/api/server.ts:1102`](packages/linkedin-automation/src/api/server.ts#L1102) | `read` |
| `GET` | `/api/linkedin/profile/:username` | [`packages/linkedin-automation/src/api/server.ts:635`](packages/linkedin-automation/src/api/server.ts#L635) | `read` |
| `POST` | `/api/linkedin/profile/button-scan` | [`packages/linkedin-automation/src/api/server.ts:951`](packages/linkedin-automation/src/api/server.ts#L951) | `required` |
| `POST` | `/api/linkedin/profile/button-scan-batch` | [`packages/linkedin-automation/src/api/server.ts:966`](packages/linkedin-automation/src/api/server.ts#L966) | `required` |
| `GET` | `/api/linkedin/profile/extract-current` | [`packages/linkedin-automation/src/api/server.ts:528`](packages/linkedin-automation/src/api/server.ts#L528) | `read` |
| `POST` | `/api/linkedin/profile/score` | [`packages/linkedin-automation/src/api/server.ts:644`](packages/linkedin-automation/src/api/server.ts#L644) | `required` |
| `POST` | `/api/linkedin/prospect` | [`packages/scheduler/src/api/server.ts:992`](packages/scheduler/src/api/server.ts#L992) | `required` |
| `POST` | `/api/linkedin/prospect/pipeline` | [`packages/linkedin-automation/src/api/server.ts:1240`](packages/linkedin-automation/src/api/server.ts#L1240) | `required` |
| `POST` | `/api/linkedin/prospect/recurring` | [`packages/scheduler/src/api/server.ts:1010`](packages/scheduler/src/api/server.ts#L1010) | `required` |
| `POST` | `/api/linkedin/prospect/search-score` | [`packages/linkedin-automation/src/api/server.ts:1226`](packages/linkedin-automation/src/api/server.ts#L1226) | `required` |
| `GET` | `/api/linkedin/rate-limits` | [`packages/linkedin-automation/src/api/server.ts:1210`](packages/linkedin-automation/src/api/server.ts#L1210) | `read` |
| `PUT` | `/api/linkedin/rate-limits` | [`packages/linkedin-automation/src/api/server.ts:1219`](packages/linkedin-automation/src/api/server.ts#L1219) | `required` |
| `DELETE` | `/api/linkedin/replies/unread` | [`packages/linkedin-automation/src/api/server.ts:1700`](packages/linkedin-automation/src/api/server.ts#L1700) | `required` |
| `GET` | `/api/linkedin/replies/unread` | [`packages/linkedin-automation/src/api/server.ts:1683`](packages/linkedin-automation/src/api/server.ts#L1683) | `read` |
| `POST` | `/api/linkedin/replies/watcher/start` | [`packages/linkedin-automation/src/api/server.ts:1690`](packages/linkedin-automation/src/api/server.ts#L1690) | `required` |
| `POST` | `/api/linkedin/replies/watcher/stop` | [`packages/linkedin-automation/src/api/server.ts:1695`](packages/linkedin-automation/src/api/server.ts#L1695) | `required` |
| `GET` | `/api/linkedin/search/extract-current` | [`packages/linkedin-automation/src/api/server.ts:765`](packages/linkedin-automation/src/api/server.ts#L765) | `read` |
| `POST` | `/api/linkedin/search/people` | [`packages/linkedin-automation/src/api/server.ts:756`](packages/linkedin-automation/src/api/server.ts#L756) | `required` |
| `POST` | `/api/linkedin/self-poll` | [`packages/linkedin-automation/src/api/server.ts:2199`](packages/linkedin-automation/src/api/server.ts#L2199) | `required` |
| `GET` | `/api/linkedin/sessions` | [`packages/linkedin-automation/src/api/server.ts:1548`](packages/linkedin-automation/src/api/server.ts#L1548) | `read` |
| `POST` | `/api/linkedin/sessions` | [`packages/linkedin-automation/src/api/server.ts:1533`](packages/linkedin-automation/src/api/server.ts#L1533) | `required` |
| `DELETE` | `/api/linkedin/sessions/:id` | [`packages/linkedin-automation/src/api/server.ts:1575`](packages/linkedin-automation/src/api/server.ts#L1575) | `required` |
| `GET` | `/api/linkedin/sessions/:id` | [`packages/linkedin-automation/src/api/server.ts:1557`](packages/linkedin-automation/src/api/server.ts#L1557) | `read` |
| `POST` | `/api/linkedin/sessions/:id/extend` | [`packages/linkedin-automation/src/api/server.ts:1587`](packages/linkedin-automation/src/api/server.ts#L1587) | `required` |
| `GET` | `/api/linkedin/status` | [`packages/linkedin-automation/src/api/server.ts:305`](packages/linkedin-automation/src/api/server.ts#L305) | `read` |
| `DELETE` | `/api/linkedin/tabs/:purpose` | [`packages/linkedin-automation/src/api/server.ts:448`](packages/linkedin-automation/src/api/server.ts#L448) | `required` |
| `GET` | `/api/linkedin/tabs/list` | [`packages/linkedin-automation/src/api/server.ts:438`](packages/linkedin-automation/src/api/server.ts#L438) | `read` |
| `POST` | `/api/linkedin/tabs/open` | [`packages/linkedin-automation/src/api/server.ts:413`](packages/linkedin-automation/src/api/server.ts#L413) | `required` |
| `GET` | `/api/linkedin/test/supabase/actions` | [`packages/linkedin-automation/src/api/server.ts:1499`](packages/linkedin-automation/src/api/server.ts#L1499) | `read` |
| `POST` | `/api/linkedin/test/supabase/clear` | [`packages/linkedin-automation/src/api/server.ts:1523`](packages/linkedin-automation/src/api/server.ts#L1523) | `required` |
| `GET` | `/api/linkedin/test/supabase/contacts` | [`packages/linkedin-automation/src/api/server.ts:1505`](packages/linkedin-automation/src/api/server.ts#L1505) | `read` |
| `GET` | `/api/linkedin/test/supabase/conversations` | [`packages/linkedin-automation/src/api/server.ts:1511`](packages/linkedin-automation/src/api/server.ts#L1511) | `read` |
| `GET` | `/api/linkedin/test/supabase/messages` | [`packages/linkedin-automation/src/api/server.ts:1517`](packages/linkedin-automation/src/api/server.ts#L1517) | `read` |
| `POST` | `/api/medium/articles/bookmark` | [`packages/medium-automation/src/api/server.ts:130`](packages/medium-automation/src/api/server.ts#L130) | `required` |
| `POST` | `/api/medium/articles/clap` | [`packages/medium-automation/src/api/server.ts:98`](packages/medium-automation/src/api/server.ts#L98) | `required` |
| `POST` | `/api/medium/articles/metrics` | [`packages/medium-automation/src/api/server.ts:166`](packages/medium-automation/src/api/server.ts#L166) | `required` |
| `POST` | `/api/medium/articles/read` | [`packages/medium-automation/src/api/server.ts:146`](packages/medium-automation/src/api/server.ts#L146) | `required` |
| `POST` | `/api/medium/articles/respond` | [`packages/medium-automation/src/api/server.ts:114`](packages/medium-automation/src/api/server.ts#L114) | `required` |
| `GET` | `/api/medium/feed` | [`packages/medium-automation/src/api/server.ts:226`](packages/medium-automation/src/api/server.ts#L226) | `read` |
| `GET` | `/api/medium/monetization/analyze` | [`packages/medium-automation/src/api/server.ts:410`](packages/medium-automation/src/api/server.ts#L410) | `read` |
| `GET` | `/api/medium/monetization/audience` | [`packages/medium-automation/src/api/server.ts:399`](packages/medium-automation/src/api/server.ts#L399) | `read` |
| `GET` | `/api/medium/monetization/earnings` | [`packages/medium-automation/src/api/server.ts:388`](packages/medium-automation/src/api/server.ts#L388) | `read` |
| `POST` | `/api/medium/monetization/execute` | [`packages/medium-automation/src/api/server.ts:423`](packages/medium-automation/src/api/server.ts#L423) | `required` |
| `GET` | `/api/medium/monetization/report` | [`packages/medium-automation/src/api/server.ts:471`](packages/medium-automation/src/api/server.ts#L471) | `read` |
| `GET` | `/api/medium/monetization/reports` | [`packages/medium-automation/src/api/server.ts:482`](packages/medium-automation/src/api/server.ts#L482) | `read` |
| `POST` | `/api/medium/monetization/seo/audit` | [`packages/medium-automation/src/api/server.ts:439`](packages/medium-automation/src/api/server.ts#L439) | `required` |
| `POST` | `/api/medium/monetization/seo/update` | [`packages/medium-automation/src/api/server.ts:455`](packages/medium-automation/src/api/server.ts#L455) | `required` |
| `POST` | `/api/medium/posts/create` | [`packages/medium-automation/src/api/server.ts:58`](packages/medium-automation/src/api/server.ts#L58) | `required` |
| `GET` | `/api/medium/posts/mine` | [`packages/medium-automation/src/api/server.ts:83`](packages/medium-automation/src/api/server.ts#L83) | `read` |
| `POST` | `/api/medium/research/forward` | [`packages/medium-automation/src/api/server.ts:561`](packages/medium-automation/src/api/server.ts#L561) | `required` |
| `POST` | `/api/medium/research/multi` | [`packages/medium-automation/src/api/server.ts:513`](packages/medium-automation/src/api/server.ts#L513) | `required` |
| `POST` | `/api/medium/research/news` | [`packages/medium-automation/src/api/server.ts:545`](packages/medium-automation/src/api/server.ts#L545) | `required` |
| `POST` | `/api/medium/research/niche` | [`packages/medium-automation/src/api/server.ts:497`](packages/medium-automation/src/api/server.ts#L497) | `required` |
| `GET` | `/api/medium/research/saved` | [`packages/medium-automation/src/api/server.ts:588`](packages/medium-automation/src/api/server.ts#L588) | `read` |
| `POST` | `/api/medium/research/top-authors` | [`packages/medium-automation/src/api/server.ts:529`](packages/medium-automation/src/api/server.ts#L529) | `required` |
| `POST` | `/api/medium/search` | [`packages/medium-automation/src/api/server.ts:238`](packages/medium-automation/src/api/server.ts#L238) | `required` |
| `GET` | `/api/medium/stats` | [`packages/medium-automation/src/api/server.ts:256`](packages/medium-automation/src/api/server.ts#L256) | `read` |
| `GET` | `/api/medium/status` | [`packages/medium-automation/src/api/server.ts:43`](packages/medium-automation/src/api/server.ts#L43) | `read` |
| `POST` | `/api/medium/stories/:storyId/paywall/add` | [`packages/medium-automation/src/api/server.ts:330`](packages/medium-automation/src/api/server.ts#L330) | `required` |
| `POST` | `/api/medium/stories/:storyId/paywall/remove` | [`packages/medium-automation/src/api/server.ts:341`](packages/medium-automation/src/api/server.ts#L341) | `required` |
| `GET` | `/api/medium/stories/:storyId/settings` | [`packages/medium-automation/src/api/server.ts:300`](packages/medium-automation/src/api/server.ts#L300) | `read` |
| `GET` | `/api/medium/stories/:storyId/stats` | [`packages/medium-automation/src/api/server.ts:315`](packages/medium-automation/src/api/server.ts#L315) | `read` |
| `GET` | `/api/medium/stories/all-ids` | [`packages/medium-automation/src/api/server.ts:288`](packages/medium-automation/src/api/server.ts#L288) | `read` |
| `POST` | `/api/medium/stories/paywall/batch-add` | [`packages/medium-automation/src/api/server.ts:352`](packages/medium-automation/src/api/server.ts#L352) | `required` |
| `POST` | `/api/medium/stories/paywall/batch-remove` | [`packages/medium-automation/src/api/server.ts:368`](packages/medium-automation/src/api/server.ts#L368) | `required` |
| `GET` | `/api/medium/stories/published` | [`packages/medium-automation/src/api/server.ts:275`](packages/medium-automation/src/api/server.ts#L275) | `read` |
| `GET` | `/api/medium/users/:username` | [`packages/medium-automation/src/api/server.ts:207`](packages/medium-automation/src/api/server.ts#L207) | `read` |
| `POST` | `/api/medium/users/follow` | [`packages/medium-automation/src/api/server.ts:190`](packages/medium-automation/src/api/server.ts#L190) | `required` |
| `GET` | `/api/messages` | [`packages/instagram-dm/src/api/server.ts:534`](packages/instagram-dm/src/api/server.ts#L534) | `read` |
| `GET` | `/api/messages` | [`packages/tiktok-dm/src/api/server.ts:1003`](packages/tiktok-dm/src/api/server.ts#L1003) | `read` |
| `POST` | `/api/messages/send` | [`packages/instagram-dm/src/api/server.ts:545`](packages/instagram-dm/src/api/server.ts#L545) | `required` |
| `POST` | `/api/messages/send-from-profile` | [`packages/instagram-dm/src/api/server.ts:801`](packages/instagram-dm/src/api/server.ts#L801) | `required` |
| `POST` | `/api/messages/send-to` | [`packages/instagram-dm/src/api/server.ts:610`](packages/instagram-dm/src/api/server.ts#L610) | `required` |
| `POST` | `/api/messages/send-to` | [`packages/tiktok-dm/src/api/server.ts:1091`](packages/tiktok-dm/src/api/server.ts#L1091) | `required` |
| `POST` | `/api/messages/send-to-thread` | [`packages/instagram-dm/src/api/server.ts:837`](packages/instagram-dm/src/api/server.ts#L837) | `required` |
| `POST` | `/api/messages/smart-send` | [`packages/instagram-dm/src/api/server.ts:766`](packages/instagram-dm/src/api/server.ts#L766) | `required` |
| `GET` | `/api/notifications` | [`packages/cloud-sync/src/api/server.ts:103`](packages/cloud-sync/src/api/server.ts#L103) | `read` |
| `POST` | `/api/notifications/:id/action` | [`packages/cloud-sync/src/api/server.ts:110`](packages/cloud-sync/src/api/server.ts#L110) | `required` |
| `POST` | `/api/outreach/:actionId/failed` | [`packages/instagram-dm/src/api/server.ts:957`](packages/instagram-dm/src/api/server.ts#L957) | `required` |
| `POST` | `/api/outreach/:actionId/sent` | [`packages/instagram-dm/src/api/server.ts:948`](packages/instagram-dm/src/api/server.ts#L948) | `required` |
| `GET` | `/api/outreach/pending` | [`packages/instagram-dm/src/api/server.ts:923`](packages/instagram-dm/src/api/server.ts#L923) | `read` |
| `POST` | `/api/outreach/queue` | [`packages/instagram-dm/src/api/server.ts:934`](packages/instagram-dm/src/api/server.ts#L934) | `required` |
| `GET` | `/api/outreach/stats` | [`packages/instagram-dm/src/api/server.ts:967`](packages/instagram-dm/src/api/server.ts#L967) | `read` |
| `GET` | `/api/posts` | [`packages/cloud-sync/src/api/server.ts:136`](packages/cloud-sync/src/api/server.ts#L136) | `read` |
| `GET` | `/api/posts/top` | [`packages/cloud-sync/src/api/server.ts:143`](packages/cloud-sync/src/api/server.ts#L143) | `read` |
| `GET` | `/api/profile` | [`packages/cloud-sync/src/api/server.ts:276`](packages/cloud-sync/src/api/server.ts#L276) | `read` |
| `GET` | `/api/profile/:username` | [`packages/instagram-dm/src/api/server.ts:491`](packages/instagram-dm/src/api/server.ts#L491) | `read` |
| `GET` | `/api/profile/:username` | [`packages/tiktok-dm/src/api/server.ts:1014`](packages/tiktok-dm/src/api/server.ts#L1014) | `read` |
| `GET` | `/api/proposals/:jobId` | [`packages/upwork-hunter/src/api/server.ts:163`](packages/upwork-hunter/src/api/server.ts#L163) | `read` |
| `POST` | `/api/proposals/approve/:jobId` | [`packages/upwork-hunter/src/api/server.ts:224`](packages/upwork-hunter/src/api/server.ts#L224) | `required` |
| `POST` | `/api/proposals/assets/:jobId` | [`packages/upwork-hunter/src/api/server.ts:646`](packages/upwork-hunter/src/api/server.ts#L646) | `required` |
| `POST` | `/api/proposals/generate` | [`packages/upwork-hunter/src/api/server.ts:182`](packages/upwork-hunter/src/api/server.ts#L182) | `required` |
| `POST` | `/api/proposals/reject/:jobId` | [`packages/upwork-hunter/src/api/server.ts:260`](packages/upwork-hunter/src/api/server.ts#L260) | `required` |
| `GET` | `/api/proposals/stats` | [`packages/upwork-hunter/src/api/server.ts:136`](packages/upwork-hunter/src/api/server.ts#L136) | `read` |
| `POST` | `/api/proposals/submit/:jobId` | [`packages/upwork-hunter/src/api/server.ts:279`](packages/upwork-hunter/src/api/server.ts#L279) | `required` |
| `POST` | `/api/proposals/won/:jobId` | [`packages/upwork-hunter/src/api/server.ts:242`](packages/upwork-hunter/src/api/server.ts#L242) | `required` |
| `DELETE` | `/api/prospect/:username` | [`packages/instagram-dm/src/api/server.ts:1329`](packages/instagram-dm/src/api/server.ts#L1329) | `required` |
| `POST` | `/api/prospect/discover` | [`packages/instagram-dm/src/api/server.ts:981`](packages/instagram-dm/src/api/server.ts#L981) | `required` |
| `POST` | `/api/prospect/discover` | [`packages/tiktok-dm/src/api/server.ts:1215`](packages/tiktok-dm/src/api/server.ts#L1215) | `required` |
| `POST` | `/api/prospect/discover-from-top-posts` | [`packages/instagram-dm/src/api/server.ts:1103`](packages/instagram-dm/src/api/server.ts#L1103) | `required` |
| `POST` | `/api/prospect/dm-top-n` | [`packages/instagram-dm/src/api/server.ts:1186`](packages/instagram-dm/src/api/server.ts#L1186) | `required` |
| `POST` | `/api/prospect/fetch-bios` | [`packages/instagram-dm/src/api/server.ts:1787`](packages/instagram-dm/src/api/server.ts#L1787) | `required` |
| `POST` | `/api/prospect/hashtag-search` | [`packages/instagram-dm/src/api/server.ts:1659`](packages/instagram-dm/src/api/server.ts#L1659) | `required` |
| `POST` | `/api/prospect/hashtag-search` | [`packages/tiktok-comments/src/api/server.ts:736`](packages/tiktok-comments/src/api/server.ts#L736) | `required` |
| `GET` | `/api/prospect/list` | [`packages/instagram-dm/src/api/server.ts:1313`](packages/instagram-dm/src/api/server.ts#L1313) | `read` |
| `POST` | `/api/prospect/people-search` | [`packages/twitter-comments/src/api/server.ts:462`](packages/twitter-comments/src/api/server.ts#L462) | `required` |
| `GET` | `/api/prospect/pipeline-status` | [`packages/instagram-dm/src/api/server.ts:1506`](packages/instagram-dm/src/api/server.ts#L1506) | `read` |
| `GET` | `/api/prospect/pipeline-status` | [`packages/linkedin-automation/src/api/server.ts:1284`](packages/linkedin-automation/src/api/server.ts#L1284) | `read` |
| `POST` | `/api/prospect/run-pipeline` | [`packages/instagram-dm/src/api/server.ts:1432`](packages/instagram-dm/src/api/server.ts#L1432) | `required` |
| `POST` | `/api/prospect/run-pipeline` | [`packages/linkedin-automation/src/api/server.ts:1289`](packages/linkedin-automation/src/api/server.ts#L1289) | `required` |
| `POST` | `/api/prospect/scale-discover` | [`packages/instagram-dm/src/api/server.ts:1035`](packages/instagram-dm/src/api/server.ts#L1035) | `required` |
| `POST` | `/api/prospect/schedule-batch` | [`packages/instagram-dm/src/api/server.ts:1516`](packages/instagram-dm/src/api/server.ts#L1516) | `required` |
| `POST` | `/api/prospect/schedule-batch` | [`packages/linkedin-automation/src/api/server.ts:1374`](packages/linkedin-automation/src/api/server.ts#L1374) | `required` |
| `POST` | `/api/prospect/score-batch` | [`packages/instagram-dm/src/api/server.ts:1347`](packages/instagram-dm/src/api/server.ts#L1347) | `required` |
| `GET` | `/api/prospect/score/:username` | [`packages/instagram-dm/src/api/server.ts:1015`](packages/instagram-dm/src/api/server.ts#L1015) | `read` |
| `GET` | `/api/prospect/score/:username` | [`packages/tiktok-dm/src/api/server.ts:1190`](packages/tiktok-dm/src/api/server.ts#L1190) | `read` |
| `POST` | `/api/prospect/send-queued` | [`packages/instagram-dm/src/api/server.ts:1223`](packages/instagram-dm/src/api/server.ts#L1223) | `required` |
| `GET` | `/api/prospect/stats` | [`packages/instagram-dm/src/api/server.ts:1388`](packages/instagram-dm/src/api/server.ts#L1388) | `read` |
| `POST` | `/api/prospect/store-batch` | [`packages/instagram-dm/src/api/server.ts:1398`](packages/instagram-dm/src/api/server.ts#L1398) | `required` |
| `GET` | `/api/prospects` | [`packages/linkedin-automation/dashboard/server.js:17`](packages/linkedin-automation/dashboard/server.js#L17) | `read` |
| `POST` | `/api/publish/daily` | [`packages/scheduler/src/api/server.ts:384`](packages/scheduler/src/api/server.ts#L384) | `required` |
| `POST` | `/api/publish/daily/recurring` | [`packages/scheduler/src/api/server.ts:408`](packages/scheduler/src/api/server.ts#L408) | `required` |
| `GET` | `/api/publish/status` | [`packages/scheduler/src/api/server.ts:827`](packages/scheduler/src/api/server.ts#L827) | `read` |
| `GET` | `/api/queue` | [`packages/market-research/src/api/server.ts:1630`](packages/market-research/src/api/server.ts#L1630) | `read` |
| `GET` | `/api/queue/:taskId` | [`packages/market-research/src/api/server.ts:1616`](packages/market-research/src/api/server.ts#L1616) | `read` |
| `POST` | `/api/queue/cancel/:taskId` | [`packages/market-research/src/api/server.ts:1644`](packages/market-research/src/api/server.ts#L1644) | `required` |
| `POST` | `/api/queue/control/cleanup` | [`packages/market-research/src/api/server.ts:1721`](packages/market-research/src/api/server.ts#L1721) | `required` |
| `POST` | `/api/queue/control/start` | [`packages/market-research/src/api/server.ts:1711`](packages/market-research/src/api/server.ts#L1711) | `required` |
| `POST` | `/api/queue/control/stop` | [`packages/market-research/src/api/server.ts:1716`](packages/market-research/src/api/server.ts#L1716) | `required` |
| `POST` | `/api/queue/drain` | [`packages/scheduler/src/api/server.ts:551`](packages/scheduler/src/api/server.ts#L551) | `required` |
| `POST` | `/api/queue/drain/recurring` | [`packages/scheduler/src/api/server.ts:580`](packages/scheduler/src/api/server.ts#L580) | `required` |
| `POST` | `/api/queue/rate-limits` | [`packages/market-research/src/api/server.ts:1699`](packages/market-research/src/api/server.ts#L1699) | `required` |
| `GET` | `/api/queue/stats` | [`packages/market-research/src/api/server.ts:1655`](packages/market-research/src/api/server.ts#L1655) | `read` |
| `POST` | `/api/queue/submit` | [`packages/market-research/src/api/server.ts:1572`](packages/market-research/src/api/server.ts#L1572) | `required` |
| `POST` | `/api/queue/submit/batch` | [`packages/market-research/src/api/server.ts:1599`](packages/market-research/src/api/server.ts#L1599) | `required` |
| `GET` | `/api/queue/workers` | [`packages/market-research/src/api/server.ts:1682`](packages/market-research/src/api/server.ts#L1682) | `read` |
| `POST` | `/api/queue/workers` | [`packages/market-research/src/api/server.ts:1661`](packages/market-research/src/api/server.ts#L1661) | `required` |
| `DELETE` | `/api/queue/workers/:workerId` | [`packages/market-research/src/api/server.ts:1688`](packages/market-research/src/api/server.ts#L1688) | `required` |
| `POST` | `/api/quick-poll` | [`packages/upwork-hunter/src/api/server.ts:626`](packages/upwork-hunter/src/api/server.ts#L626) | `required` |
| `GET` | `/api/rate-limits` | [`packages/instagram-dm/src/api/server.ts:265`](packages/instagram-dm/src/api/server.ts#L265) | `read` |
| `GET` | `/api/rate-limits` | [`packages/market-research/src/api/server.ts:2100`](packages/market-research/src/api/server.ts#L2100) | `read` |
| `PUT` | `/api/rate-limits` | [`packages/instagram-dm/src/api/server.ts:281`](packages/instagram-dm/src/api/server.ts#L281) | `required` |
| `POST` | `/api/requests/:username/accept` | [`packages/instagram-dm/src/api/server.ts:461`](packages/instagram-dm/src/api/server.ts#L461) | `required` |
| `POST` | `/api/requests/:username/decline` | [`packages/instagram-dm/src/api/server.ts:476`](packages/instagram-dm/src/api/server.ts#L476) | `required` |
| `POST` | `/api/research/:platform/full` | [`packages/market-research/src/api/server.ts:796`](packages/market-research/src/api/server.ts#L796) | `required` |
| `POST` | `/api/research/:platform/niche` | [`packages/market-research/src/api/server.ts:713`](packages/market-research/src/api/server.ts#L713) | `required` |
| `POST` | `/api/research/:platform/search` | [`packages/market-research/src/api/server.ts:647`](packages/market-research/src/api/server.ts#L647) | `required` |
| `POST` | `/api/research/ad-brief` | [`packages/scheduler/src/api/server.ts:772`](packages/scheduler/src/api/server.ts#L772) | `required` |
| `POST` | `/api/research/ad-library` | [`packages/scheduler/src/api/server.ts:664`](packages/scheduler/src/api/server.ts#L664) | `required` |
| `POST` | `/api/research/all/full` | [`packages/market-research/src/api/server.ts:1147`](packages/market-research/src/api/server.ts#L1147) | `required` |
| `POST` | `/api/research/batch` | [`packages/market-research/src/api/server.ts:1946`](packages/market-research/src/api/server.ts#L1946) | `required` |
| `POST` | `/api/research/competitor` | [`packages/market-research/src/api/server.ts:1799`](packages/market-research/src/api/server.ts#L1799) | `required` |
| `GET` | `/api/research/creator/:handle` | [`packages/market-research/src/api/server.ts:2017`](packages/market-research/src/api/server.ts#L2017) | `read` |
| `POST` | `/api/research/daily` | [`packages/scheduler/src/api/server.ts:618`](packages/scheduler/src/api/server.ts#L618) | `required` |
| `POST` | `/api/research/daily/recurring` | [`packages/scheduler/src/api/server.ts:637`](packages/scheduler/src/api/server.ts#L637) | `required` |
| `GET` | `/api/research/download/*` | [`packages/market-research/src/api/server.ts:1298`](packages/market-research/src/api/server.ts#L1298) | `read` |
| `POST` | `/api/research/facebook/search` | [`packages/scheduler/src/api/server.ts:700`](packages/scheduler/src/api/server.ts#L700) | `required` |
| `GET` | `/api/research/hashtags/:platform` | [`packages/market-research/src/api/server.ts:1915`](packages/market-research/src/api/server.ts#L1915) | `read` |
| `POST` | `/api/research/instagram/competitor` | [`packages/market-research/src/api/server.ts:1082`](packages/market-research/src/api/server.ts#L1082) | `required` |
| `POST` | `/api/research/instagram/search` | [`packages/scheduler/src/api/server.ts:736`](packages/scheduler/src/api/server.ts#L736) | `required` |
| `GET` | `/api/research/jobs/:jobId` | [`packages/market-research/src/api/server.ts:1824`](packages/market-research/src/api/server.ts#L1824) | `read` |
| `GET` | `/api/research/niches/:niche` | [`packages/market-research/src/api/server.ts:1875`](packages/market-research/src/api/server.ts#L1875) | `read` |
| `GET` | `/api/research/platforms` | [`packages/market-research/src/api/server.ts:619`](packages/market-research/src/api/server.ts#L619) | `read` |
| `GET` | `/api/research/post` | [`packages/market-research/src/api/server.ts:1845`](packages/market-research/src/api/server.ts#L1845) | `read` |
| `GET` | `/api/research/resonance/:niche/:platform` | [`packages/market-research/src/api/server.ts:1969`](packages/market-research/src/api/server.ts#L1969) | `read` |
| `GET` | `/api/research/results` | [`packages/market-research/src/api/server.ts:1250`](packages/market-research/src/api/server.ts#L1250) | `read` |
| `GET` | `/api/research/results/file/*` | [`packages/market-research/src/api/server.ts:1273`](packages/market-research/src/api/server.ts#L1273) | `read` |
| `GET` | `/api/research/results/latest/:platform` | [`packages/market-research/src/api/server.ts:1256`](packages/market-research/src/api/server.ts#L1256) | `read` |
| `GET` | `/api/research/status` | [`packages/market-research/src/api/server.ts:1228`](packages/market-research/src/api/server.ts#L1228) | `read` |
| `GET` | `/api/research/status` | [`packages/scheduler/src/api/server.ts:806`](packages/scheduler/src/api/server.ts#L806) | `read` |
| `GET` | `/api/research/status/:jobId` | [`packages/market-research/src/api/server.ts:1239`](packages/market-research/src/api/server.ts#L1239) | `read` |
| `POST` | `/api/research/threads/top100` | [`packages/market-research/src/api/server.ts:970`](packages/market-research/src/api/server.ts#L970) | `required` |
| `POST` | `/api/research/top-creators` | [`packages/market-research/src/api/server.ts:1767`](packages/market-research/src/api/server.ts#L1767) | `required` |
| `POST` | `/api/research/top-posts` | [`packages/market-research/src/api/server.ts:1998`](packages/market-research/src/api/server.ts#L1998) | `required` |
| `GET` | `/api/research/trends` | [`packages/market-research/src/api/server.ts:1733`](packages/market-research/src/api/server.ts#L1733) | `read` |
| `POST` | `/api/research/twitter/top100` | [`packages/market-research/src/api/server.ts:854`](packages/market-research/src/api/server.ts#L854) | `required` |
| `GET` | `/api/resources` | [`packages/scheduler/src/api/server.ts:310`](packages/scheduler/src/api/server.ts#L310) | `read` |
| `GET` | `/api/resources/sora` | [`packages/scheduler/src/api/server.ts:128`](packages/scheduler/src/api/server.ts#L128) | `read` |
| `GET` | `/api/runs` | [`packages/linkedin-automation/dashboard/server.js:41`](packages/linkedin-automation/dashboard/server.js#L41) | `read` |
| `POST` | `/api/scan` | [`packages/upwork-hunter/src/api/server.ts:615`](packages/upwork-hunter/src/api/server.ts#L615) | `required` |
| `GET` | `/api/scheduler/completed` | [`packages/scheduler/src/api/server.ts:85`](packages/scheduler/src/api/server.ts#L85) | `read` |
| `POST` | `/api/scheduler/pause` | [`packages/scheduler/src/api/server.ts:63`](packages/scheduler/src/api/server.ts#L63) | `required` |
| `GET` | `/api/scheduler/queue` | [`packages/scheduler/src/api/server.ts:77`](packages/scheduler/src/api/server.ts#L77) | `read` |
| `POST` | `/api/scheduler/resume` | [`packages/scheduler/src/api/server.ts:69`](packages/scheduler/src/api/server.ts#L69) | `required` |
| `POST` | `/api/scheduler/start` | [`packages/market-research/src/api/server.ts:1372`](packages/market-research/src/api/server.ts#L1372) | `required` |
| `POST` | `/api/scheduler/start` | [`packages/scheduler/src/api/server.ts:51`](packages/scheduler/src/api/server.ts#L51) | `required` |
| `GET` | `/api/scheduler/status` | [`packages/market-research/src/api/server.ts:1362`](packages/market-research/src/api/server.ts#L1362) | `read` |
| `GET` | `/api/scheduler/status` | [`packages/scheduler/src/api/server.ts:45`](packages/scheduler/src/api/server.ts#L45) | `read` |
| `POST` | `/api/scheduler/stop` | [`packages/market-research/src/api/server.ts:1377`](packages/market-research/src/api/server.ts#L1377) | `required` |
| `POST` | `/api/scheduler/stop` | [`packages/scheduler/src/api/server.ts:57`](packages/scheduler/src/api/server.ts#L57) | `required` |
| `POST` | `/api/scheduler/task` | [`packages/scheduler/src/api/server.ts:95`](packages/scheduler/src/api/server.ts#L95) | `required` |
| `DELETE` | `/api/scheduler/task/:id` | [`packages/scheduler/src/api/server.ts:120`](packages/scheduler/src/api/server.ts#L120) | `required` |
| `POST` | `/api/scheduler/trigger` | [`packages/market-research/src/api/server.ts:1382`](packages/market-research/src/api/server.ts#L1382) | `required` |
| `GET` | `/api/search` | [`packages/tiktok-dm/src/api/server.ts:1039`](packages/tiktok-dm/src/api/server.ts#L1039) | `read` |
| `GET` | `/api/seen-jobs` | [`packages/upwork-hunter/src/api/server.ts:636`](packages/upwork-hunter/src/api/server.ts#L636) | `read` |
| `POST` | `/api/seen-jobs/clear` | [`packages/upwork-hunter/src/api/server.ts:640`](packages/upwork-hunter/src/api/server.ts#L640) | `required` |
| `GET` | `/api/self-poll/trigger` | [`packages/instagram-dm/src/api/server.ts:1871`](packages/instagram-dm/src/api/server.ts#L1871) | `read` |
| `GET` | `/api/self-poll/trigger` | [`packages/linkedin-automation/src/api/server.ts:2265`](packages/linkedin-automation/src/api/server.ts#L2265) | `read` |
| `GET` | `/api/self-poll/trigger` | [`packages/twitter-dm/src/api/server.ts:730`](packages/twitter-dm/src/api/server.ts#L730) | `read` |
| `POST` | `/api/session/clear` | [`packages/facebook-comments/src/api/server.ts:114`](packages/facebook-comments/src/api/server.ts#L114) | `required` |
| `POST` | `/api/session/clear` | [`packages/instagram-comments/src/api/server.ts:1624`](packages/instagram-comments/src/api/server.ts#L1624) | `required` |
| `POST` | `/api/session/clear` | [`packages/instagram-dm/src/api/server.ts:320`](packages/instagram-dm/src/api/server.ts#L320) | `required` |
| `POST` | `/api/session/clear` | [`packages/linkedin-automation/src/api/server.ts:1953`](packages/linkedin-automation/src/api/server.ts#L1953) | `required` |
| `POST` | `/api/session/clear` | [`packages/market-research/src/api/server.ts:2334`](packages/market-research/src/api/server.ts#L2334) | `required` |
| `POST` | `/api/session/clear` | [`packages/threads-comments/src/api/server.ts:1096`](packages/threads-comments/src/api/server.ts#L1096) | `required` |
| `POST` | `/api/session/clear` | [`packages/tiktok-dm/src/api/server.ts:307`](packages/tiktok-dm/src/api/server.ts#L307) | `required` |
| `POST` | `/api/session/clear` | [`packages/twitter-comments/src/api/server.ts:998`](packages/twitter-comments/src/api/server.ts#L998) | `required` |
| `POST` | `/api/session/clear` | [`packages/twitter-dm/src/api/server.ts:279`](packages/twitter-dm/src/api/server.ts#L279) | `required` |
| `POST` | `/api/session/clear` | [`packages/upwork-automation/src/api/server.ts:149`](packages/upwork-automation/src/api/server.ts#L149) | `required` |
| `POST` | `/api/session/ensure` | [`packages/facebook-comments/src/api/server.ts:96`](packages/facebook-comments/src/api/server.ts#L96) | `required` |
| `POST` | `/api/session/ensure` | [`packages/instagram-comments/src/api/server.ts:1605`](packages/instagram-comments/src/api/server.ts#L1605) | `required` |
| `POST` | `/api/session/ensure` | [`packages/instagram-dm/src/api/server.ts:302`](packages/instagram-dm/src/api/server.ts#L302) | `required` |
| `POST` | `/api/session/ensure` | [`packages/linkedin-automation/src/api/server.ts:1939`](packages/linkedin-automation/src/api/server.ts#L1939) | `required` |
| `POST` | `/api/session/ensure` | [`packages/market-research/src/api/server.ts:2320`](packages/market-research/src/api/server.ts#L2320) | `required` |
| `POST` | `/api/session/ensure` | [`packages/threads-comments/src/api/server.ts:1082`](packages/threads-comments/src/api/server.ts#L1082) | `required` |
| `POST` | `/api/session/ensure` | [`packages/tiktok-comments/src/api/server.ts:240`](packages/tiktok-comments/src/api/server.ts#L240) | `required` |
| `POST` | `/api/session/ensure` | [`packages/tiktok-dm/src/api/server.ts:291`](packages/tiktok-dm/src/api/server.ts#L291) | `required` |
| `POST` | `/api/session/ensure` | [`packages/twitter-comments/src/api/server.ts:979`](packages/twitter-comments/src/api/server.ts#L979) | `required` |
| `POST` | `/api/session/ensure` | [`packages/twitter-dm/src/api/server.ts:263`](packages/twitter-dm/src/api/server.ts#L263) | `required` |
| `POST` | `/api/session/ensure` | [`packages/upwork-automation/src/api/server.ts:140`](packages/upwork-automation/src/api/server.ts#L140) | `required` |
| `GET` | `/api/session/status` | [`packages/facebook-comments/src/api/server.ts:92`](packages/facebook-comments/src/api/server.ts#L92) | `read` |
| `GET` | `/api/session/status` | [`packages/instagram-comments/src/api/server.ts:1595`](packages/instagram-comments/src/api/server.ts#L1595) | `read` |
| `GET` | `/api/session/status` | [`packages/instagram-dm/src/api/server.ts:289`](packages/instagram-dm/src/api/server.ts#L289) | `read` |
| `GET` | `/api/session/status` | [`packages/linkedin-automation/src/api/server.ts:1929`](packages/linkedin-automation/src/api/server.ts#L1929) | `read` |
| `GET` | `/api/session/status` | [`packages/market-research/src/api/server.ts:2310`](packages/market-research/src/api/server.ts#L2310) | `read` |
| `GET` | `/api/session/status` | [`packages/threads-comments/src/api/server.ts:1072`](packages/threads-comments/src/api/server.ts#L1072) | `read` |
| `GET` | `/api/session/status` | [`packages/tiktok-comments/src/api/server.ts:263`](packages/tiktok-comments/src/api/server.ts#L263) | `read` |
| `GET` | `/api/session/status` | [`packages/tiktok-dm/src/api/server.ts:275`](packages/tiktok-dm/src/api/server.ts#L275) | `read` |
| `GET` | `/api/session/status` | [`packages/twitter-comments/src/api/server.ts:969`](packages/twitter-comments/src/api/server.ts#L969) | `read` |
| `GET` | `/api/session/status` | [`packages/twitter-dm/src/api/server.ts:250`](packages/twitter-dm/src/api/server.ts#L250) | `read` |
| `GET` | `/api/session/status` | [`packages/upwork-automation/src/api/server.ts:154`](packages/upwork-automation/src/api/server.ts#L154) | `read` |
| `GET` | `/api/sessions` | [`packages/market-research/src/api/server.ts:2064`](packages/market-research/src/api/server.ts#L2064) | `read` |
| `POST` | `/api/sessions` | [`packages/market-research/src/api/server.ts:2053`](packages/market-research/src/api/server.ts#L2053) | `required` |
| `DELETE` | `/api/sessions/:sessionId` | [`packages/market-research/src/api/server.ts:2093`](packages/market-research/src/api/server.ts#L2093) | `required` |
| `GET` | `/api/sessions/:sessionId` | [`packages/market-research/src/api/server.ts:2075`](packages/market-research/src/api/server.ts#L2075) | `read` |
| `POST` | `/api/sora/auto-generate` | [`packages/scheduler/src/api/server.ts:220`](packages/scheduler/src/api/server.ts#L220) | `required` |
| `POST` | `/api/sora/daily-pipeline` | [`packages/scheduler/src/api/server.ts:481`](packages/scheduler/src/api/server.ts#L481) | `required` |
| `POST` | `/api/sora/daily-pipeline/recurring` | [`packages/scheduler/src/api/server.ts:511`](packages/scheduler/src/api/server.ts#L511) | `required` |
| `POST` | `/api/sora/generate` | [`packages/scheduler/src/api/server.ts:454`](packages/scheduler/src/api/server.ts#L454) | `required` |
| `POST` | `/api/sora/queue-trilogy` | [`packages/scheduler/src/api/server.ts:140`](packages/scheduler/src/api/server.ts#L140) | `required` |
| `GET` | `/api/status` | [`packages/cloud-sync/src/api/server.ts:56`](packages/cloud-sync/src/api/server.ts#L56) | `read` |
| `GET` | `/api/status` | [`packages/instagram-dm/src/api/server.ts:1612`](packages/instagram-dm/src/api/server.ts#L1612) | `read` |
| `GET` | `/api/status` | [`packages/tiktok-dm/src/api/server.ts:951`](packages/tiktok-dm/src/api/server.ts#L951) | `read` |
| `POST` | `/api/sync/poll-now` | [`packages/cloud-sync/src/api/server.ts:82`](packages/cloud-sync/src/api/server.ts#L82) | `required` |
| `POST` | `/api/sync/start` | [`packages/cloud-sync/src/api/server.ts:72`](packages/cloud-sync/src/api/server.ts#L72) | `required` |
| `POST` | `/api/sync/stop` | [`packages/cloud-sync/src/api/server.ts:77`](packages/cloud-sync/src/api/server.ts#L77) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/facebook-comments/src/api/server.ts:129`](packages/facebook-comments/src/api/server.ts#L129) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/instagram-comments/src/api/server.ts:1562`](packages/instagram-comments/src/api/server.ts#L1562) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/instagram-dm/src/api/server.ts:354`](packages/instagram-dm/src/api/server.ts#L354) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/linkedin-automation/src/api/server.ts:1856`](packages/linkedin-automation/src/api/server.ts#L1856) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/market-research/src/api/server.ts:2277`](packages/market-research/src/api/server.ts#L2277) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/threads-comments/src/api/server.ts:1038`](packages/threads-comments/src/api/server.ts#L1038) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/tiktok-comments/src/api/server.ts:190`](packages/tiktok-comments/src/api/server.ts#L190) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/tiktok-dm/src/api/server.ts:1313`](packages/tiktok-dm/src/api/server.ts#L1313) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/twitter-comments/src/api/server.ts:936`](packages/twitter-comments/src/api/server.ts#L936) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/twitter-dm/src/api/server.ts:226`](packages/twitter-dm/src/api/server.ts#L226) | `required` |
| `POST` | `/api/tabs/claim` | [`packages/upwork-automation/src/api/server.ts:173`](packages/upwork-automation/src/api/server.ts#L173) | `required` |
| `GET` | `/api/tabs/claims` | [`packages/facebook-comments/src/api/server.ts:125`](packages/facebook-comments/src/api/server.ts#L125) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/instagram-comments/src/api/server.ts:1557`](packages/instagram-comments/src/api/server.ts#L1557) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/instagram-dm/src/api/server.ts:331`](packages/instagram-dm/src/api/server.ts#L331) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/linkedin-automation/src/api/server.ts:1851`](packages/linkedin-automation/src/api/server.ts#L1851) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/market-research/src/api/server.ts:2272`](packages/market-research/src/api/server.ts#L2272) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/threads-comments/src/api/server.ts:1033`](packages/threads-comments/src/api/server.ts#L1033) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/tiktok-comments/src/api/server.ts:178`](packages/tiktok-comments/src/api/server.ts#L178) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/tiktok-dm/src/api/server.ts:1299`](packages/tiktok-dm/src/api/server.ts#L1299) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/twitter-comments/src/api/server.ts:931`](packages/twitter-comments/src/api/server.ts#L931) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/twitter-dm/src/api/server.ts:221`](packages/twitter-dm/src/api/server.ts#L221) | `read` |
| `GET` | `/api/tabs/claims` | [`packages/upwork-automation/src/api/server.ts:164`](packages/upwork-automation/src/api/server.ts#L164) | `read` |
| `POST` | `/api/tabs/heartbeat` | [`packages/instagram-comments/src/api/server.ts:1586`](packages/instagram-comments/src/api/server.ts#L1586) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/instagram-dm/src/api/server.ts:376`](packages/instagram-dm/src/api/server.ts#L376) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/linkedin-automation/src/api/server.ts:1880`](packages/linkedin-automation/src/api/server.ts#L1880) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/market-research/src/api/server.ts:2301`](packages/market-research/src/api/server.ts#L2301) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/threads-comments/src/api/server.ts:1063`](packages/threads-comments/src/api/server.ts#L1063) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/tiktok-comments/src/api/server.ts:225`](packages/tiktok-comments/src/api/server.ts#L225) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/tiktok-dm/src/api/server.ts:1323`](packages/tiktok-dm/src/api/server.ts#L1323) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/twitter-comments/src/api/server.ts:960`](packages/twitter-comments/src/api/server.ts#L960) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/twitter-dm/src/api/server.ts:240`](packages/twitter-dm/src/api/server.ts#L240) | `required` |
| `POST` | `/api/tabs/heartbeat` | [`packages/upwork-automation/src/api/server.ts:198`](packages/upwork-automation/src/api/server.ts#L198) | `required` |
| `POST` | `/api/tabs/release` | [`packages/instagram-comments/src/api/server.ts:1578`](packages/instagram-comments/src/api/server.ts#L1578) | `required` |
| `POST` | `/api/tabs/release` | [`packages/instagram-dm/src/api/server.ts:370`](packages/instagram-dm/src/api/server.ts#L370) | `required` |
| `POST` | `/api/tabs/release` | [`packages/linkedin-automation/src/api/server.ts:1872`](packages/linkedin-automation/src/api/server.ts#L1872) | `required` |
| `POST` | `/api/tabs/release` | [`packages/market-research/src/api/server.ts:2293`](packages/market-research/src/api/server.ts#L2293) | `required` |
| `POST` | `/api/tabs/release` | [`packages/threads-comments/src/api/server.ts:1055`](packages/threads-comments/src/api/server.ts#L1055) | `required` |
| `POST` | `/api/tabs/release` | [`packages/tiktok-comments/src/api/server.ts:212`](packages/tiktok-comments/src/api/server.ts#L212) | `required` |
| `POST` | `/api/tabs/release` | [`packages/tiktok-dm/src/api/server.ts:1318`](packages/tiktok-dm/src/api/server.ts#L1318) | `required` |
| `POST` | `/api/tabs/release` | [`packages/twitter-comments/src/api/server.ts:952`](packages/twitter-comments/src/api/server.ts#L952) | `required` |
| `POST` | `/api/tabs/release` | [`packages/twitter-dm/src/api/server.ts:233`](packages/twitter-dm/src/api/server.ts#L233) | `required` |
| `POST` | `/api/tabs/release` | [`packages/upwork-automation/src/api/server.ts:190`](packages/upwork-automation/src/api/server.ts#L190) | `required` |
| `POST` | `/api/telegram-command` | [`packages/upwork-hunter/src/api/server.ts:701`](packages/upwork-hunter/src/api/server.ts#L701) | `required` |
| `GET` | `/api/templates` | [`packages/instagram-dm/src/api/server.ts:875`](packages/instagram-dm/src/api/server.ts#L875) | `read` |
| `POST` | `/api/templates/fit-signals` | [`packages/instagram-dm/src/api/server.ts:899`](packages/instagram-dm/src/api/server.ts#L899) | `required` |
| `POST` | `/api/templates/next-action` | [`packages/instagram-dm/src/api/server.ts:886`](packages/instagram-dm/src/api/server.ts#L886) | `required` |
| `GET` | `/api/templates/rule-check/:contactId` | [`packages/instagram-dm/src/api/server.ts:911`](packages/instagram-dm/src/api/server.ts#L911) | `read` |
| `GET` | `/api/threads` | [`packages/instagram-dm/src/api/server.ts:752`](packages/instagram-dm/src/api/server.ts#L752) | `read` |
| `GET` | `/api/threads/:username` | [`packages/instagram-dm/src/api/server.ts:756`](packages/instagram-dm/src/api/server.ts#L756) | `read` |
| `POST` | `/api/threads/action` | [`packages/threads-comments/src/api/server.ts:838`](packages/threads-comments/src/api/server.ts#L838) | `required` |
| `POST` | `/api/threads/ai-message` | [`packages/threads-comments/src/api/server.ts:721`](packages/threads-comments/src/api/server.ts#L721) | `required` |
| `POST` | `/api/threads/analyze` | [`packages/threads-comments/src/api/server.ts:996`](packages/threads-comments/src/api/server.ts#L996) | `required` |
| `POST` | `/api/threads/batch-comment` | [`packages/threads-comments/src/api/server.ts:578`](packages/threads-comments/src/api/server.ts#L578) | `required` |
| `POST` | `/api/threads/comment-sweep` | [`packages/threads-comments/src/api/server.ts:1130`](packages/threads-comments/src/api/server.ts#L1130) | `required` |
| `GET` | `/api/threads/comments` | [`packages/threads-comments/src/api/server.ts:471`](packages/threads-comments/src/api/server.ts#L471) | `read` |
| `POST` | `/api/threads/comments/post` | [`packages/threads-comments/src/api/server.ts:483`](packages/threads-comments/src/api/server.ts#L483) | `required` |
| `POST` | `/api/threads/comments/reply` | [`packages/threads-comments/src/api/server.ts:558`](packages/threads-comments/src/api/server.ts#L558) | `required` |
| `GET` | `/api/threads/config` | [`packages/threads-comments/src/api/server.ts:982`](packages/threads-comments/src/api/server.ts#L982) | `read` |
| `PUT` | `/api/threads/config` | [`packages/threads-comments/src/api/server.ts:986`](packages/threads-comments/src/api/server.ts#L986) | `required` |
| `GET` | `/api/threads/db/history` | [`packages/threads-comments/src/api/server.ts:867`](packages/threads-comments/src/api/server.ts#L867) | `read` |
| `GET` | `/api/threads/db/stats` | [`packages/threads-comments/src/api/server.ts:878`](packages/threads-comments/src/api/server.ts#L878) | `read` |
| `POST` | `/api/threads/engage` | [`packages/threads-comments/src/api/server.ts:888`](packages/threads-comments/src/api/server.ts#L888) | `required` |
| `GET` | `/api/threads/engage/history` | [`packages/threads-comments/src/api/server.ts:902`](packages/threads-comments/src/api/server.ts#L902) | `read` |
| `POST` | `/api/threads/engage/loop` | [`packages/threads-comments/src/api/server.ts:895`](packages/threads-comments/src/api/server.ts#L895) | `required` |
| `POST` | `/api/threads/engage/multi` | [`packages/threads-comments/src/api/server.ts:907`](packages/threads-comments/src/api/server.ts#L907) | `required` |
| `GET` | `/api/threads/extract` | [`packages/threads-comments/src/api/server.ts:666`](packages/threads-comments/src/api/server.ts#L666) | `read` |
| `POST` | `/api/threads/like/:postId` | [`packages/threads-comments/src/api/server.ts:677`](packages/threads-comments/src/api/server.ts#L677) | `required` |
| `POST` | `/api/threads/navigate` | [`packages/threads-comments/src/api/server.ts:458`](packages/threads-comments/src/api/server.ts#L458) | `required` |
| `GET` | `/api/threads/posts` | [`packages/threads-comments/src/api/server.ts:1014`](packages/threads-comments/src/api/server.ts#L1014) | `read` |
| `GET` | `/api/threads/posts/:postId` | [`packages/threads-comments/src/api/server.ts:659`](packages/threads-comments/src/api/server.ts#L659) | `read` |
| `GET` | `/api/threads/profile` | [`packages/threads-comments/src/api/server.ts:644`](packages/threads-comments/src/api/server.ts#L644) | `read` |
| `GET` | `/api/threads/profile/:handle` | [`packages/threads-comments/src/api/server.ts:649`](packages/threads-comments/src/api/server.ts#L649) | `read` |
| `POST` | `/api/threads/prospect/discover` | [`packages/threads-comments/src/api/server.ts:944`](packages/threads-comments/src/api/server.ts#L944) | `required` |
| `GET` | `/api/threads/prospect/score/:handle` | [`packages/threads-comments/src/api/server.ts:971`](packages/threads-comments/src/api/server.ts#L971) | `read` |
| `GET` | `/api/threads/rate-limits` | [`packages/threads-comments/src/api/server.ts:438`](packages/threads-comments/src/api/server.ts#L438) | `read` |
| `PUT` | `/api/threads/rate-limits` | [`packages/threads-comments/src/api/server.ts:448`](packages/threads-comments/src/api/server.ts#L448) | `required` |
| `POST` | `/api/threads/register` | [`packages/instagram-dm/src/api/server.ts:742`](packages/instagram-dm/src/api/server.ts#L742) | `required` |
| `POST` | `/api/threads/repost/:postId` | [`packages/threads-comments/src/api/server.ts:683`](packages/threads-comments/src/api/server.ts#L683) | `required` |
| `POST` | `/api/threads/research` | [`packages/threads-comments/src/api/server.ts:703`](packages/threads-comments/src/api/server.ts#L703) | `required` |
| `POST` | `/api/threads/schedule` | [`packages/scheduler/src/api/server.ts:167`](packages/scheduler/src/api/server.ts#L167) | `required` |
| `POST` | `/api/threads/score` | [`packages/threads-comments/src/api/server.ts:766`](packages/threads-comments/src/api/server.ts#L766) | `required` |
| `POST` | `/api/threads/search` | [`packages/threads-comments/src/api/server.ts:618`](packages/threads-comments/src/api/server.ts#L618) | `required` |
| `POST` | `/api/threads/self-poll` | [`packages/threads-comments/src/api/server.ts:1288`](packages/threads-comments/src/api/server.ts#L1288) | `required` |
| `GET` | `/api/threads/sessions` | [`packages/threads-comments/src/api/server.ts:811`](packages/threads-comments/src/api/server.ts#L811) | `read` |
| `POST` | `/api/threads/sessions` | [`packages/threads-comments/src/api/server.ts:806`](packages/threads-comments/src/api/server.ts#L806) | `required` |
| `DELETE` | `/api/threads/sessions/:sessionId` | [`packages/threads-comments/src/api/server.ts:829`](packages/threads-comments/src/api/server.ts#L829) | `required` |
| `GET` | `/api/threads/sessions/:sessionId` | [`packages/threads-comments/src/api/server.ts:820`](packages/threads-comments/src/api/server.ts#L820) | `read` |
| `GET` | `/api/threads/status` | [`packages/threads-comments/src/api/server.ts:427`](packages/threads-comments/src/api/server.ts#L427) | `read` |
| `POST` | `/api/threads/suggest-reply` | [`packages/threads-comments/src/api/server.ts:743`](packages/threads-comments/src/api/server.ts#L743) | `required` |
| `GET` | `/api/threads/thread/:postId` | [`packages/threads-comments/src/api/server.ts:693`](packages/threads-comments/src/api/server.ts#L693) | `read` |
| `GET` | `/api/threads/trending` | [`packages/threads-comments/src/api/server.ts:635`](packages/threads-comments/src/api/server.ts#L635) | `read` |
| `GET` | `/api/tiktok/activity/followers` | [`packages/tiktok-comments/src/api/server.ts:621`](packages/tiktok-comments/src/api/server.ts#L621) | `read` |
| `POST` | `/api/tiktok/ai/generate` | [`packages/tiktok-dm/src/api/server.ts:787`](packages/tiktok-dm/src/api/server.ts#L787) | `required` |
| `GET` | `/api/tiktok/analytics` | [`packages/tiktok-comments/src/api/server.ts:603`](packages/tiktok-comments/src/api/server.ts#L603) | `read` |
| `GET` | `/api/tiktok/analytics/content` | [`packages/tiktok-comments/src/api/server.ts:612`](packages/tiktok-comments/src/api/server.ts#L612) | `read` |
| `POST` | `/api/tiktok/comment-sweep` | [`packages/tiktok-comments/src/api/server.ts:847`](packages/tiktok-comments/src/api/server.ts#L847) | `required` |
| `GET` | `/api/tiktok/comments` | [`packages/tiktok-comments/src/api/server.ts:426`](packages/tiktok-comments/src/api/server.ts#L426) | `read` |
| `POST` | `/api/tiktok/comments/:id/like` | [`packages/tiktok-comments/src/api/server.ts:830`](packages/tiktok-comments/src/api/server.ts#L830) | `required` |
| `POST` | `/api/tiktok/comments/generate` | [`packages/tiktok-comments/src/api/server.ts:518`](packages/tiktok-comments/src/api/server.ts#L518) | `required` |
| `POST` | `/api/tiktok/comments/post` | [`packages/tiktok-comments/src/api/server.ts:431`](packages/tiktok-comments/src/api/server.ts#L431) | `required` |
| `POST` | `/api/tiktok/comments/reply` | [`packages/tiktok-comments/src/api/server.ts:816`](packages/tiktok-comments/src/api/server.ts#L816) | `required` |
| `GET` | `/api/tiktok/config` | [`packages/tiktok-comments/src/api/server.ts:657`](packages/tiktok-comments/src/api/server.ts#L657) | `read` |
| `PUT` | `/api/tiktok/config` | [`packages/tiktok-comments/src/api/server.ts:658`](packages/tiktok-comments/src/api/server.ts#L658) | `required` |
| `GET` | `/api/tiktok/conversations` | [`packages/tiktok-dm/src/api/server.ts:396`](packages/tiktok-dm/src/api/server.ts#L396) | `read` |
| `POST` | `/api/tiktok/conversations/new` | [`packages/tiktok-dm/src/api/server.ts:471`](packages/tiktok-dm/src/api/server.ts#L471) | `required` |
| `POST` | `/api/tiktok/conversations/open` | [`packages/tiktok-dm/src/api/server.ts:450`](packages/tiktok-dm/src/api/server.ts#L450) | `required` |
| `POST` | `/api/tiktok/conversations/scroll` | [`packages/tiktok-dm/src/api/server.ts:499`](packages/tiktok-dm/src/api/server.ts#L499) | `required` |
| `GET` | `/api/tiktok/conversations/unread` | [`packages/tiktok-dm/src/api/server.ts:406`](packages/tiktok-dm/src/api/server.ts#L406) | `read` |
| `POST` | `/api/tiktok/crm/score` | [`packages/tiktok-dm/src/api/server.ts:691`](packages/tiktok-dm/src/api/server.ts#L691) | `required` |
| `POST` | `/api/tiktok/crm/score-all` | [`packages/tiktok-dm/src/api/server.ts:700`](packages/tiktok-dm/src/api/server.ts#L700) | `required` |
| `GET` | `/api/tiktok/crm/stats` | [`packages/tiktok-dm/src/api/server.ts:682`](packages/tiktok-dm/src/api/server.ts#L682) | `read` |
| `GET` | `/api/tiktok/crm/top-contacts` | [`packages/tiktok-dm/src/api/server.ts:707`](packages/tiktok-dm/src/api/server.ts#L707) | `read` |
| `GET` | `/api/tiktok/dm/conversations` | [`packages/tiktok-comments/src/api/server.ts:675`](packages/tiktok-comments/src/api/server.ts#L675) | `read` |
| `GET` | `/api/tiktok/dm/conversations` | [`packages/tiktok-dm/src/api/server.ts:912`](packages/tiktok-dm/src/api/server.ts#L912) | `read` |
| `GET` | `/api/tiktok/dm/messages/:id` | [`packages/tiktok-comments/src/api/server.ts:684`](packages/tiktok-comments/src/api/server.ts#L684) | `read` |
| `GET` | `/api/tiktok/dm/messages/:id` | [`packages/tiktok-dm/src/api/server.ts:922`](packages/tiktok-dm/src/api/server.ts#L922) | `read` |
| `POST` | `/api/tiktok/dm/search` | [`packages/tiktok-comments/src/api/server.ts:693`](packages/tiktok-comments/src/api/server.ts#L693) | `required` |
| `POST` | `/api/tiktok/dm/search` | [`packages/tiktok-dm/src/api/server.ts:933`](packages/tiktok-dm/src/api/server.ts#L933) | `required` |
| `POST` | `/api/tiktok/dm/send` | [`packages/tiktok-comments/src/api/server.ts:661`](packages/tiktok-comments/src/api/server.ts#L661) | `required` |
| `POST` | `/api/tiktok/dm/send` | [`packages/tiktok-dm/src/api/server.ts:881`](packages/tiktok-dm/src/api/server.ts#L881) | `required` |
| `GET` | `/api/tiktok/error-check` | [`packages/tiktok-dm/src/api/server.ts:326`](packages/tiktok-dm/src/api/server.ts#L326) | `read` |
| `POST` | `/api/tiktok/error-retry` | [`packages/tiktok-dm/src/api/server.ts:335`](packages/tiktok-dm/src/api/server.ts#L335) | `required` |
| `POST` | `/api/tiktok/hashtag-prospects` | [`packages/tiktok-comments/src/api/server.ts:1006`](packages/tiktok-comments/src/api/server.ts#L1006) | `required` |
| `POST` | `/api/tiktok/inbox/navigate` | [`packages/tiktok-dm/src/api/server.ts:382`](packages/tiktok-dm/src/api/server.ts#L382) | `required` |
| `GET` | `/api/tiktok/messages` | [`packages/tiktok-dm/src/api/server.ts:509`](packages/tiktok-dm/src/api/server.ts#L509) | `read` |
| `POST` | `/api/tiktok/messages/send` | [`packages/tiktok-dm/src/api/server.ts:542`](packages/tiktok-dm/src/api/server.ts#L542) | `required` |
| `POST` | `/api/tiktok/messages/send-to` | [`packages/tiktok-dm/src/api/server.ts:570`](packages/tiktok-dm/src/api/server.ts#L570) | `required` |
| `POST` | `/api/tiktok/messages/send-to-url` | [`packages/tiktok-dm/src/api/server.ts:650`](packages/tiktok-dm/src/api/server.ts#L650) | `required` |
| `POST` | `/api/tiktok/navigate` | [`packages/tiktok-comments/src/api/server.ts:278`](packages/tiktok-comments/src/api/server.ts#L278) | `required` |
| `POST` | `/api/tiktok/outreach/:actionId/failed` | [`packages/tiktok-dm/src/api/server.ts:774`](packages/tiktok-dm/src/api/server.ts#L774) | `required` |
| `POST` | `/api/tiktok/outreach/:actionId/sent` | [`packages/tiktok-dm/src/api/server.ts:769`](packages/tiktok-dm/src/api/server.ts#L769) | `required` |
| `GET` | `/api/tiktok/outreach/pending` | [`packages/tiktok-dm/src/api/server.ts:752`](packages/tiktok-dm/src/api/server.ts#L752) | `read` |
| `POST` | `/api/tiktok/outreach/queue` | [`packages/tiktok-dm/src/api/server.ts:760`](packages/tiktok-dm/src/api/server.ts#L760) | `required` |
| `GET` | `/api/tiktok/outreach/stats` | [`packages/tiktok-dm/src/api/server.ts:779`](packages/tiktok-dm/src/api/server.ts#L779) | `read` |
| `GET` | `/api/tiktok/profile` | [`packages/tiktok-comments/src/api/server.ts:708`](packages/tiktok-comments/src/api/server.ts#L708) | `read` |
| `GET` | `/api/tiktok/profile/:username` | [`packages/tiktok-comments/src/api/server.ts:1090`](packages/tiktok-comments/src/api/server.ts#L1090) | `read` |
| `GET` | `/api/tiktok/profile/:username` | [`packages/tiktok-dm/src/api/server.ts:806`](packages/tiktok-dm/src/api/server.ts#L806) | `read` |
| `GET` | `/api/tiktok/profile/:username/videos` | [`packages/tiktok-comments/src/api/server.ts:1158`](packages/tiktok-comments/src/api/server.ts#L1158) | `read` |
| `POST` | `/api/tiktok/profile/enrich` | [`packages/tiktok-dm/src/api/server.ts:843`](packages/tiktok-dm/src/api/server.ts#L843) | `required` |
| `GET` | `/api/tiktok/rate-limits` | [`packages/tiktok-comments/src/api/server.ts:275`](packages/tiktok-comments/src/api/server.ts#L275) | `read` |
| `GET` | `/api/tiktok/rate-limits` | [`packages/tiktok-dm/src/api/server.ts:346`](packages/tiktok-dm/src/api/server.ts#L346) | `read` |
| `PUT` | `/api/tiktok/rate-limits` | [`packages/tiktok-comments/src/api/server.ts:276`](packages/tiktok-comments/src/api/server.ts#L276) | `required` |
| `PUT` | `/api/tiktok/rate-limits` | [`packages/tiktok-dm/src/api/server.ts:371`](packages/tiktok-dm/src/api/server.ts#L371) | `required` |
| `GET` | `/api/tiktok/rate-status` | [`packages/tiktok-dm/src/api/server.ts:361`](packages/tiktok-dm/src/api/server.ts#L361) | `read` |
| `POST` | `/api/tiktok/search` | [`packages/tiktok-comments/src/api/server.ts:718`](packages/tiktok-comments/src/api/server.ts#L718) | `required` |
| `POST` | `/api/tiktok/search-cards` | [`packages/tiktok-comments/src/api/server.ts:309`](packages/tiktok-comments/src/api/server.ts#L309) | `required` |
| `POST` | `/api/tiktok/self-poll` | [`packages/tiktok-comments/src/api/server.ts:1202`](packages/tiktok-comments/src/api/server.ts#L1202) | `required` |
| `GET` | `/api/tiktok/status` | [`packages/tiktok-comments/src/api/server.ts:270`](packages/tiktok-comments/src/api/server.ts#L270) | `read` |
| `GET` | `/api/tiktok/status` | [`packages/tiktok-dm/src/api/server.ts:313`](packages/tiktok-dm/src/api/server.ts#L313) | `read` |
| `GET` | `/api/tiktok/templates` | [`packages/tiktok-dm/src/api/server.ts:717`](packages/tiktok-dm/src/api/server.ts#L717) | `read` |
| `POST` | `/api/tiktok/templates/fit-signals` | [`packages/tiktok-dm/src/api/server.ts:734`](packages/tiktok-dm/src/api/server.ts#L734) | `required` |
| `POST` | `/api/tiktok/templates/next-action` | [`packages/tiktok-dm/src/api/server.ts:725`](packages/tiktok-dm/src/api/server.ts#L725) | `required` |
| `GET` | `/api/tiktok/templates/rule-check/:contactId` | [`packages/tiktok-dm/src/api/server.ts:743`](packages/tiktok-dm/src/api/server.ts#L743) | `read` |
| `GET` | `/api/tiktok/trending` | [`packages/tiktok-comments/src/api/server.ts:351`](packages/tiktok-comments/src/api/server.ts#L351) | `read` |
| `GET` | `/api/tiktok/trending/sounds` | [`packages/tiktok-comments/src/api/server.ts:806`](packages/tiktok-comments/src/api/server.ts#L806) | `read` |
| `POST` | `/api/tiktok/verify` | [`packages/tiktok-comments/src/api/server.ts:548`](packages/tiktok-comments/src/api/server.ts#L548) | `required` |
| `GET` | `/api/tiktok/video-metrics` | [`packages/tiktok-comments/src/api/server.ts:418`](packages/tiktok-comments/src/api/server.ts#L418) | `read` |
| `POST` | `/api/twitter/ai/generate` | [`packages/twitter-dm/src/api/server.ts:634`](packages/twitter-dm/src/api/server.ts#L634) | `required` |
| `POST` | `/api/twitter/comment-sweep` | [`packages/twitter-comments/src/api/server.ts:696`](packages/twitter-comments/src/api/server.ts#L696) | `required` |
| `GET` | `/api/twitter/comments` | [`packages/twitter-comments/src/api/server.ts:253`](packages/twitter-comments/src/api/server.ts#L253) | `read` |
| `POST` | `/api/twitter/comments/generate` | [`packages/twitter-comments/src/api/server.ts:327`](packages/twitter-comments/src/api/server.ts#L327) | `required` |
| `POST` | `/api/twitter/comments/post` | [`packages/twitter-comments/src/api/server.ts:258`](packages/twitter-comments/src/api/server.ts#L258) | `required` |
| `GET` | `/api/twitter/config` | [`packages/twitter-comments/src/api/server.ts:926`](packages/twitter-comments/src/api/server.ts#L926) | `read` |
| `PUT` | `/api/twitter/config` | [`packages/twitter-comments/src/api/server.ts:927`](packages/twitter-comments/src/api/server.ts#L927) | `required` |
| `PUT` | `/api/twitter/config` | [`packages/twitter-dm/src/api/server.ts:689`](packages/twitter-dm/src/api/server.ts#L689) | `required` |
| `GET` | `/api/twitter/conversations` | [`packages/twitter-dm/src/api/server.ts:359`](packages/twitter-dm/src/api/server.ts#L359) | `read` |
| `GET` | `/api/twitter/conversations/all` | [`packages/twitter-dm/src/api/server.ts:368`](packages/twitter-dm/src/api/server.ts#L368) | `read` |
| `POST` | `/api/twitter/conversations/new` | [`packages/twitter-dm/src/api/server.ts:411`](packages/twitter-dm/src/api/server.ts#L411) | `required` |
| `POST` | `/api/twitter/conversations/open` | [`packages/twitter-dm/src/api/server.ts:401`](packages/twitter-dm/src/api/server.ts#L401) | `required` |
| `POST` | `/api/twitter/conversations/scroll` | [`packages/twitter-dm/src/api/server.ts:421`](packages/twitter-dm/src/api/server.ts#L421) | `required` |
| `GET` | `/api/twitter/conversations/search` | [`packages/twitter-dm/src/api/server.ts:387`](packages/twitter-dm/src/api/server.ts#L387) | `read` |
| `GET` | `/api/twitter/conversations/unread` | [`packages/twitter-dm/src/api/server.ts:378`](packages/twitter-dm/src/api/server.ts#L378) | `read` |
| `POST` | `/api/twitter/crm/score` | [`packages/twitter-dm/src/api/server.ts:519`](packages/twitter-dm/src/api/server.ts#L519) | `required` |
| `POST` | `/api/twitter/crm/score-all` | [`packages/twitter-dm/src/api/server.ts:528`](packages/twitter-dm/src/api/server.ts#L528) | `required` |
| `GET` | `/api/twitter/crm/stats` | [`packages/twitter-dm/src/api/server.ts:510`](packages/twitter-dm/src/api/server.ts#L510) | `read` |
| `GET` | `/api/twitter/crm/top-contacts` | [`packages/twitter-dm/src/api/server.ts:535`](packages/twitter-dm/src/api/server.ts#L535) | `read` |
| `POST` | `/api/twitter/execute` | [`packages/twitter-dm/src/api/server.ts:679`](packages/twitter-dm/src/api/server.ts#L679) | `required` |
| `POST` | `/api/twitter/feed` | [`packages/twitter-comments/src/api/server.ts:619`](packages/twitter-comments/src/api/server.ts#L619) | `required` |
| `POST` | `/api/twitter/inbox/navigate` | [`packages/twitter-dm/src/api/server.ts:338`](packages/twitter-dm/src/api/server.ts#L338) | `required` |
| `POST` | `/api/twitter/inbox/tab` | [`packages/twitter-dm/src/api/server.ts:347`](packages/twitter-dm/src/api/server.ts#L347) | `required` |
| `GET` | `/api/twitter/messages` | [`packages/twitter-dm/src/api/server.ts:433`](packages/twitter-dm/src/api/server.ts#L433) | `read` |
| `POST` | `/api/twitter/messages/send` | [`packages/twitter-dm/src/api/server.ts:443`](packages/twitter-dm/src/api/server.ts#L443) | `required` |
| `POST` | `/api/twitter/messages/send-to` | [`packages/twitter-dm/src/api/server.ts:461`](packages/twitter-dm/src/api/server.ts#L461) | `required` |
| `POST` | `/api/twitter/messages/send-to-url` | [`packages/twitter-dm/src/api/server.ts:487`](packages/twitter-dm/src/api/server.ts#L487) | `required` |
| `POST` | `/api/twitter/navigate` | [`packages/twitter-comments/src/api/server.ts:245`](packages/twitter-comments/src/api/server.ts#L245) | `required` |
| `GET` | `/api/twitter/notifications` | [`packages/twitter-comments/src/api/server.ts:844`](packages/twitter-comments/src/api/server.ts#L844) | `read` |
| `POST` | `/api/twitter/outreach/:actionId/failed` | [`packages/twitter-dm/src/api/server.ts:602`](packages/twitter-dm/src/api/server.ts#L602) | `required` |
| `POST` | `/api/twitter/outreach/:actionId/sent` | [`packages/twitter-dm/src/api/server.ts:597`](packages/twitter-dm/src/api/server.ts#L597) | `required` |
| `GET` | `/api/twitter/outreach/pending` | [`packages/twitter-dm/src/api/server.ts:580`](packages/twitter-dm/src/api/server.ts#L580) | `read` |
| `POST` | `/api/twitter/outreach/queue` | [`packages/twitter-dm/src/api/server.ts:588`](packages/twitter-dm/src/api/server.ts#L588) | `required` |
| `GET` | `/api/twitter/outreach/stats` | [`packages/twitter-dm/src/api/server.ts:607`](packages/twitter-dm/src/api/server.ts#L607) | `read` |
| `GET` | `/api/twitter/profile/:handle` | [`packages/twitter-dm/src/api/server.ts:616`](packages/twitter-dm/src/api/server.ts#L616) | `read` |
| `POST` | `/api/twitter/prospect/discover` | [`packages/twitter-dm/src/api/server.ts:654`](packages/twitter-dm/src/api/server.ts#L654) | `required` |
| `GET` | `/api/twitter/prospect/score/:handle` | [`packages/twitter-dm/src/api/server.ts:665`](packages/twitter-dm/src/api/server.ts#L665) | `read` |
| `GET` | `/api/twitter/rate-limits` | [`packages/twitter-comments/src/api/server.ts:242`](packages/twitter-comments/src/api/server.ts#L242) | `read` |
| `GET` | `/api/twitter/rate-limits` | [`packages/twitter-dm/src/api/server.ts:306`](packages/twitter-dm/src/api/server.ts#L306) | `read` |
| `PUT` | `/api/twitter/rate-limits` | [`packages/twitter-comments/src/api/server.ts:243`](packages/twitter-comments/src/api/server.ts#L243) | `required` |
| `PUT` | `/api/twitter/rate-limits` | [`packages/twitter-dm/src/api/server.ts:321`](packages/twitter-dm/src/api/server.ts#L321) | `required` |
| `GET` | `/api/twitter/rate-status` | [`packages/twitter-dm/src/api/server.ts:327`](packages/twitter-dm/src/api/server.ts#L327) | `read` |
| `POST` | `/api/twitter/search` | [`packages/twitter-comments/src/api/server.ts:450`](packages/twitter-comments/src/api/server.ts#L450) | `required` |
| `POST` | `/api/twitter/search-and-reply` | [`packages/twitter-comments/src/api/server.ts:628`](packages/twitter-comments/src/api/server.ts#L628) | `required` |
| `POST` | `/api/twitter/self-poll` | [`packages/twitter-dm/src/api/server.ts:712`](packages/twitter-dm/src/api/server.ts#L712) | `required` |
| `GET` | `/api/twitter/status` | [`packages/twitter-comments/src/api/server.ts:237`](packages/twitter-comments/src/api/server.ts#L237) | `read` |
| `GET` | `/api/twitter/status` | [`packages/twitter-dm/src/api/server.ts:286`](packages/twitter-dm/src/api/server.ts#L286) | `read` |
| `GET` | `/api/twitter/templates` | [`packages/twitter-dm/src/api/server.ts:545`](packages/twitter-dm/src/api/server.ts#L545) | `read` |
| `POST` | `/api/twitter/templates/fit-signals` | [`packages/twitter-dm/src/api/server.ts:562`](packages/twitter-dm/src/api/server.ts#L562) | `required` |
| `POST` | `/api/twitter/templates/next-action` | [`packages/twitter-dm/src/api/server.ts:553`](packages/twitter-dm/src/api/server.ts#L553) | `required` |
| `GET` | `/api/twitter/templates/rule-check/:contactId` | [`packages/twitter-dm/src/api/server.ts:571`](packages/twitter-dm/src/api/server.ts#L571) | `read` |
| `POST` | `/api/twitter/timeline` | [`packages/twitter-comments/src/api/server.ts:609`](packages/twitter-comments/src/api/server.ts#L609) | `required` |
| `POST` | `/api/twitter/tweet` | [`packages/twitter-comments/src/api/server.ts:396`](packages/twitter-comments/src/api/server.ts#L396) | `required` |
| `POST` | `/api/twitter/tweet/bookmark` | [`packages/twitter-comments/src/api/server.ts:906`](packages/twitter-comments/src/api/server.ts#L906) | `required` |
| `POST` | `/api/twitter/tweet/detail` | [`packages/twitter-comments/src/api/server.ts:565`](packages/twitter-comments/src/api/server.ts#L565) | `required` |
| `POST` | `/api/twitter/tweet/generate` | [`packages/twitter-comments/src/api/server.ts:440`](packages/twitter-comments/src/api/server.ts#L440) | `required` |
| `POST` | `/api/twitter/tweet/like` | [`packages/twitter-comments/src/api/server.ts:886`](packages/twitter-comments/src/api/server.ts#L886) | `required` |
| `GET` | `/api/twitter/tweet/metrics` | [`packages/twitter-comments/src/api/server.ts:916`](packages/twitter-comments/src/api/server.ts#L916) | `read` |
| `POST` | `/api/twitter/tweet/reply` | [`packages/twitter-comments/src/api/server.ts:576`](packages/twitter-comments/src/api/server.ts#L576) | `required` |
| `POST` | `/api/twitter/tweet/retweet` | [`packages/twitter-comments/src/api/server.ts:896`](packages/twitter-comments/src/api/server.ts#L896) | `required` |
| `GET` | `/api/upwork/analytics` | [`packages/upwork-automation/src/api/server.ts:1013`](packages/upwork-automation/src/api/server.ts#L1013) | `read` |
| `GET` | `/api/upwork/applications` | [`packages/upwork-automation/src/api/server.ts:567`](packages/upwork-automation/src/api/server.ts#L567) | `read` |
| `POST` | `/api/upwork/apply` | [`packages/scheduler/src/api/server.ts:925`](packages/scheduler/src/api/server.ts#L925) | `required` |
| `GET` | `/api/upwork/connects` | [`packages/upwork-automation/src/api/server.ts:494`](packages/upwork-automation/src/api/server.ts#L494) | `read` |
| `GET` | `/api/upwork/conversations` | [`packages/upwork-automation/src/api/server.ts:727`](packages/upwork-automation/src/api/server.ts#L727) | `read` |
| `POST` | `/api/upwork/ensure-login` | [`packages/upwork-automation/src/api/server.ts:262`](packages/upwork-automation/src/api/server.ts#L262) | `required` |
| `GET` | `/api/upwork/jobs/:id` | [`packages/upwork-automation/src/api/server.ts:407`](packages/upwork-automation/src/api/server.ts#L407) | `read` |
| `POST` | `/api/upwork/jobs/:id/save` | [`packages/upwork-automation/src/api/server.ts:451`](packages/upwork-automation/src/api/server.ts#L451) | `required` |
| `GET` | `/api/upwork/jobs/current-page` | [`packages/upwork-automation/src/api/server.ts:373`](packages/upwork-automation/src/api/server.ts#L373) | `read` |
| `GET` | `/api/upwork/jobs/detail` | [`packages/upwork-automation/src/api/server.ts:393`](packages/upwork-automation/src/api/server.ts#L393) | `read` |
| `GET` | `/api/upwork/jobs/filters` | [`packages/upwork-automation/src/api/server.ts:383`](packages/upwork-automation/src/api/server.ts#L383) | `read` |
| `POST` | `/api/upwork/jobs/save` | [`packages/upwork-automation/src/api/server.ts:461`](packages/upwork-automation/src/api/server.ts#L461) | `required` |
| `GET` | `/api/upwork/jobs/saved` | [`packages/upwork-automation/src/api/server.ts:483`](packages/upwork-automation/src/api/server.ts#L483) | `read` |
| `POST` | `/api/upwork/jobs/score` | [`packages/upwork-automation/src/api/server.ts:420`](packages/upwork-automation/src/api/server.ts#L420) | `required` |
| `POST` | `/api/upwork/jobs/score-batch` | [`packages/upwork-automation/src/api/server.ts:432`](packages/upwork-automation/src/api/server.ts#L432) | `required` |
| `POST` | `/api/upwork/jobs/search` | [`packages/upwork-automation/src/api/server.ts:329`](packages/upwork-automation/src/api/server.ts#L329) | `required` |
| `POST` | `/api/upwork/jobs/tab` | [`packages/upwork-automation/src/api/server.ts:350`](packages/upwork-automation/src/api/server.ts#L350) | `required` |
| `POST` | `/api/upwork/jobs/unsave` | [`packages/upwork-automation/src/api/server.ts:472`](packages/upwork-automation/src/api/server.ts#L472) | `required` |
| `GET` | `/api/upwork/messages` | [`packages/upwork-automation/src/api/server.ts:738`](packages/upwork-automation/src/api/server.ts#L738) | `read` |
| `POST` | `/api/upwork/messages/open` | [`packages/upwork-automation/src/api/server.ts:757`](packages/upwork-automation/src/api/server.ts#L757) | `required` |
| `POST` | `/api/upwork/messages/send` | [`packages/upwork-automation/src/api/server.ts:768`](packages/upwork-automation/src/api/server.ts#L768) | `required` |
| `GET` | `/api/upwork/messages/unread` | [`packages/upwork-automation/src/api/server.ts:748`](packages/upwork-automation/src/api/server.ts#L748) | `read` |
| `POST` | `/api/upwork/monitor` | [`packages/scheduler/src/api/server.ts:948`](packages/scheduler/src/api/server.ts#L948) | `required` |
| `GET` | `/api/upwork/monitor/presets` | [`packages/upwork-automation/src/api/server.ts:1007`](packages/upwork-automation/src/api/server.ts#L1007) | `read` |
| `POST` | `/api/upwork/monitor/recurring` | [`packages/scheduler/src/api/server.ts:966`](packages/scheduler/src/api/server.ts#L966) | `required` |
| `POST` | `/api/upwork/monitor/scan` | [`packages/upwork-automation/src/api/server.ts:985`](packages/upwork-automation/src/api/server.ts#L985) | `required` |
| `POST` | `/api/upwork/monitor/setup` | [`packages/upwork-automation/src/api/server.ts:997`](packages/upwork-automation/src/api/server.ts#L997) | `required` |
| `GET` | `/api/upwork/monitor/status` | [`packages/upwork-automation/src/api/server.ts:939`](packages/upwork-automation/src/api/server.ts#L939) | `read` |
| `GET` | `/api/upwork/monitor/watches` | [`packages/upwork-automation/src/api/server.ts:948`](packages/upwork-automation/src/api/server.ts#L948) | `read` |
| `POST` | `/api/upwork/monitor/watches` | [`packages/upwork-automation/src/api/server.ts:957`](packages/upwork-automation/src/api/server.ts#L957) | `required` |
| `DELETE` | `/api/upwork/monitor/watches/:id` | [`packages/upwork-automation/src/api/server.ts:976`](packages/upwork-automation/src/api/server.ts#L976) | `required` |
| `PUT` | `/api/upwork/monitor/watches/:id` | [`packages/upwork-automation/src/api/server.ts:966`](packages/upwork-automation/src/api/server.ts#L966) | `required` |
| `POST` | `/api/upwork/navigate/find-work` | [`packages/upwork-automation/src/api/server.ts:275`](packages/upwork-automation/src/api/server.ts#L275) | `required` |
| `POST` | `/api/upwork/navigate/job` | [`packages/upwork-automation/src/api/server.ts:307`](packages/upwork-automation/src/api/server.ts#L307) | `required` |
| `POST` | `/api/upwork/navigate/messages` | [`packages/upwork-automation/src/api/server.ts:318`](packages/upwork-automation/src/api/server.ts#L318) | `required` |
| `POST` | `/api/upwork/navigate/my-jobs` | [`packages/upwork-automation/src/api/server.ts:298`](packages/upwork-automation/src/api/server.ts#L298) | `required` |
| `POST` | `/api/upwork/navigate/tab` | [`packages/upwork-automation/src/api/server.ts:284`](packages/upwork-automation/src/api/server.ts#L284) | `required` |
| `GET` | `/api/upwork/proposal-history` | [`packages/upwork-automation/src/api/server.ts:578`](packages/upwork-automation/src/api/server.ts#L578) | `read` |
| `POST` | `/api/upwork/proposals/generate` | [`packages/upwork-automation/src/api/server.ts:850`](packages/upwork-automation/src/api/server.ts#L850) | `required` |
| `POST` | `/api/upwork/proposals/improve` | [`packages/upwork-automation/src/api/server.ts:781`](packages/upwork-automation/src/api/server.ts#L781) | `required` |
| `POST` | `/api/upwork/proposals/submit` | [`packages/upwork-automation/src/api/server.ts:522`](packages/upwork-automation/src/api/server.ts#L522) | `required` |
| `GET` | `/api/upwork/rate-limits` | [`packages/upwork-automation/src/api/server.ts:925`](packages/upwork-automation/src/api/server.ts#L925) | `read` |
| `PUT` | `/api/upwork/rate-limits` | [`packages/upwork-automation/src/api/server.ts:932`](packages/upwork-automation/src/api/server.ts#L932) | `required` |
| `GET` | `/api/upwork/rate-status` | [`packages/upwork-automation/src/api/server.ts:511`](packages/upwork-automation/src/api/server.ts#L511) | `read` |
| `POST` | `/api/upwork/scan` | [`packages/scheduler/src/api/server.ts:856`](packages/scheduler/src/api/server.ts#L856) | `required` |
| `POST` | `/api/upwork/scan/recurring` | [`packages/scheduler/src/api/server.ts:884`](packages/scheduler/src/api/server.ts#L884) | `required` |
| `POST` | `/api/upwork/signin` | [`packages/upwork-automation/src/api/server.ts:246`](packages/upwork-automation/src/api/server.ts#L246) | `required` |
| `GET` | `/api/upwork/status` | [`packages/upwork-automation/src/api/server.ts:219`](packages/upwork-automation/src/api/server.ts#L219) | `read` |
| `GET` | `/api/upwork/templates` | [`packages/upwork-automation/src/api/server.ts:1024`](packages/upwork-automation/src/api/server.ts#L1024) | `read` |
| `POST` | `/api/upwork/templates` | [`packages/upwork-automation/src/api/server.ts:1043`](packages/upwork-automation/src/api/server.ts#L1043) | `required` |
| `DELETE` | `/api/upwork/templates/:id` | [`packages/upwork-automation/src/api/server.ts:1058`](packages/upwork-automation/src/api/server.ts#L1058) | `required` |
| `GET` | `/api/upwork/templates/:id` | [`packages/upwork-automation/src/api/server.ts:1033`](packages/upwork-automation/src/api/server.ts#L1033) | `read` |
| `GET` | `/api/webhooks` | [`packages/market-research/src/api/server.ts:1322`](packages/market-research/src/api/server.ts#L1322) | `read` |
| `POST` | `/api/webhooks` | [`packages/market-research/src/api/server.ts:1326`](packages/market-research/src/api/server.ts#L1326) | `required` |
| `DELETE` | `/api/webhooks/:id` | [`packages/market-research/src/api/server.ts:1345`](packages/market-research/src/api/server.ts#L1345) | `required` |
| `POST` | `/api/webhooks/test` | [`packages/market-research/src/api/server.ts:1351`](packages/market-research/src/api/server.ts#L1351) | `required` |
| `GET` | `/associations/{contact_id}` | [`scripts/acquisition/api/routes/entity.py:151`](scripts/acquisition/api/routes/entity.py#L151) | `read` |
| `GET` | `/caps` | [`scripts/acquisition/api/routes/orchestrator.py:86`](scripts/acquisition/api/routes/orchestrator.py#L86) | `read` |
| `POST` | `/caps/reset` | [`scripts/acquisition/api/routes/orchestrator.py:92`](scripts/acquisition/api/routes/orchestrator.py#L92) | `required` |
| `POST` | `/confirm` | [`scripts/acquisition/api/routes/entity.py:181`](scripts/acquisition/api/routes/entity.py#L181) | `required` |
| `POST` | `/discover` | [`scripts/acquisition/api/routes/email.py:286`](scripts/acquisition/api/routes/email.py#L286) | `required` |
| `POST` | `/execute` | [`scripts/acquisition/api/routes/warmup.py:116`](scripts/acquisition/api/routes/warmup.py#L116) | `required` |
| `GET` | `/gateway/dashboard` | [`packages/scheduler/src/safari-gateway.ts:705`](packages/scheduler/src/safari-gateway.ts#L705) | `read` |
| `GET` | `/gateway/lock` | [`packages/scheduler/src/safari-gateway.ts:309`](packages/scheduler/src/safari-gateway.ts#L309) | `read` |
| `POST` | `/gateway/lock/acquire` | [`packages/scheduler/src/safari-gateway.ts:282`](packages/scheduler/src/safari-gateway.ts#L282) | `required` |
| `POST` | `/gateway/lock/force-release` | [`packages/scheduler/src/safari-gateway.ts:304`](packages/scheduler/src/safari-gateway.ts#L304) | `required` |
| `POST` | `/gateway/lock/release` | [`packages/scheduler/src/safari-gateway.ts:297`](packages/scheduler/src/safari-gateway.ts#L297) | `required` |
| `POST` | `/gateway/route` | [`packages/scheduler/src/safari-gateway.ts:651`](packages/scheduler/src/safari-gateway.ts#L651) | `required` |
| `POST` | `/gateway/safari/focus` | [`packages/scheduler/src/safari-gateway.ts:443`](packages/scheduler/src/safari-gateway.ts#L443) | `required` |
| `POST` | `/gateway/safari/prepare` | [`packages/scheduler/src/safari-gateway.ts:482`](packages/scheduler/src/safari-gateway.ts#L482) | `required` |
| `GET` | `/gateway/safari/state` | [`packages/scheduler/src/safari-gateway.ts:450`](packages/scheduler/src/safari-gateway.ts#L450) | `read` |
| `GET` | `/gateway/services` | [`packages/scheduler/src/safari-gateway.ts:264`](packages/scheduler/src/safari-gateway.ts#L264) | `read` |
| `GET` | `/gateway/sessions` | [`packages/scheduler/src/safari-gateway.ts:585`](packages/scheduler/src/safari-gateway.ts#L585) | `read` |
| `GET` | `/gateway/sessions/:platform` | [`packages/scheduler/src/safari-gateway.ts:594`](packages/scheduler/src/safari-gateway.ts#L594) | `read` |
| `POST` | `/gateway/sessions/check` | [`packages/scheduler/src/safari-gateway.ts:601`](packages/scheduler/src/safari-gateway.ts#L601) | `required` |
| `GET` | `/gateway/tabs` | [`packages/scheduler/src/safari-gateway.ts:512`](packages/scheduler/src/safari-gateway.ts#L512) | `read` |
| `POST` | `/generate` | [`scripts/acquisition/api/routes/outreach.py:73`](scripts/acquisition/api/routes/outreach.py#L73) | `required` |
| `POST` | `/generate` | [`scripts/acquisition/api/routes/reports.py:183`](scripts/acquisition/api/routes/reports.py#L183) | `required` |
| `GET` | `/health` | [`packages/adobe-firefly/src/api/server.ts:92`](packages/adobe-firefly/src/api/server.ts#L92) | `read` |
| `GET` | `/health` | [`packages/cloud-sync/src/api/server.ts:44`](packages/cloud-sync/src/api/server.ts#L44) | `read` |
| `GET` | `/health` | [`packages/facebook-comments/src/api/server.ts:87`](packages/facebook-comments/src/api/server.ts#L87) | `read` |
| `GET` | `/health` | [`packages/instagram-comments/src/api/server.ts:306`](packages/instagram-comments/src/api/server.ts#L306) | `read` |
| `GET` | `/health` | [`packages/instagram-dm/src/api/server.ts:238`](packages/instagram-dm/src/api/server.ts#L238) | `read` |
| `GET` | `/health` | [`packages/linkedin-automation/src/api/server.ts:222`](packages/linkedin-automation/src/api/server.ts#L222) | `read` |
| `GET` | `/health` | [`packages/market-research/src/api/server.ts:601`](packages/market-research/src/api/server.ts#L601) | `read` |
| `GET` | `/health` | [`packages/medium-automation/src/api/server.ts:37`](packages/medium-automation/src/api/server.ts#L37) | `read` |
| `GET` | `/health` | [`packages/protocol/src/control-server.ts:53`](packages/protocol/src/control-server.ts#L53) | `read` |
| `GET` | `/health` | [`packages/scheduler/src/api/server.ts:35`](packages/scheduler/src/api/server.ts#L35) | `read` |
| `GET` | `/health` | [`packages/scheduler/src/safari-gateway.ts:251`](packages/scheduler/src/safari-gateway.ts#L251) | `read` |
| `GET` | `/health` | [`packages/sora-automation/src/api/server.ts:222`](packages/sora-automation/src/api/server.ts#L222) | `read` |
| `GET` | `/health` | [`packages/threads-comments/src/api/server.ts:403`](packages/threads-comments/src/api/server.ts#L403) | `read` |
| `GET` | `/health` | [`packages/tiktok-comments/src/api/server.ts:156`](packages/tiktok-comments/src/api/server.ts#L156) | `read` |
| `GET` | `/health` | [`packages/tiktok-dm/src/api/server.ts:255`](packages/tiktok-dm/src/api/server.ts#L255) | `read` |
| `GET` | `/health` | [`packages/twitter-comments/src/api/server.ts:169`](packages/twitter-comments/src/api/server.ts#L169) | `read` |
| `GET` | `/health` | [`packages/twitter-dm/src/api/server.ts:201`](packages/twitter-dm/src/api/server.ts#L201) | `read` |
| `GET` | `/health` | [`packages/unified-control/src/index.ts:160`](packages/unified-control/src/index.ts#L160) | `read` |
| `GET` | `/health` | [`packages/upwork-automation/src/api/server.ts:209`](packages/upwork-automation/src/api/server.ts#L209) | `read` |
| `GET` | `/health` | [`packages/upwork-hunter/src/api/server.ts:85`](packages/upwork-hunter/src/api/server.ts#L85) | `read` |
| `GET` | `/health` | [`scripts/acquisition/api/routes/discovery.py:277`](scripts/acquisition/api/routes/discovery.py#L277) | `read` |
| `GET` | `/health` | [`scripts/acquisition/api/server.py:102`](scripts/acquisition/api/server.py#L102) | `read` |
| `GET` | `/latest` | [`scripts/acquisition/api/routes/reports.py:178`](scripts/acquisition/api/routes/reports.py#L178) | `read` |
| `GET` | `/niches` | [`scripts/acquisition/api/routes/discovery.py:195`](scripts/acquisition/api/routes/discovery.py#L195) | `read` |
| `POST` | `/niches` | [`scripts/acquisition/api/routes/discovery.py:167`](scripts/acquisition/api/routes/discovery.py#L167) | `required` |
| `DELETE` | `/niches/{niche_id}` | [`scripts/acquisition/api/routes/discovery.py:262`](scripts/acquisition/api/routes/discovery.py#L262) | `required` |
| `PUT` | `/niches/{niche_id}` | [`scripts/acquisition/api/routes/discovery.py:240`](scripts/acquisition/api/routes/discovery.py#L240) | `required` |
| `GET` | `/openapi.json` | [`packages/protocol/src/control-server.ts:194`](packages/protocol/src/control-server.ts#L194) | `read` |
| `POST` | `/pause` | [`scripts/acquisition/api/routes/orchestrator.py:68`](scripts/acquisition/api/routes/orchestrator.py#L68) | `required` |
| `GET` | `/ready` | [`packages/protocol/src/control-server.ts:61`](packages/protocol/src/control-server.ts#L61) | `read` |
| `GET` | `/ready` | [`packages/sora-automation/src/api/server.ts:236`](packages/sora-automation/src/api/server.ts#L236) | `read` |
| `POST` | `/resolve` | [`scripts/acquisition/api/routes/entity.py:74`](scripts/acquisition/api/routes/entity.py#L74) | `required` |
| `POST` | `/resolve-batch` | [`scripts/acquisition/api/routes/entity.py:116`](scripts/acquisition/api/routes/entity.py#L116) | `required` |
| `POST` | `/resume` | [`scripts/acquisition/api/routes/orchestrator.py:77`](scripts/acquisition/api/routes/orchestrator.py#L77) | `required` |
| `POST` | `/run` | [`scripts/acquisition/api/routes/discovery.py:98`](scripts/acquisition/api/routes/discovery.py#L98) | `required` |
| `POST` | `/run` | [`scripts/acquisition/api/routes/orchestrator.py:33`](scripts/acquisition/api/routes/orchestrator.py#L33) | `required` |
| `POST` | `/run-all` | [`scripts/acquisition/api/routes/orchestrator.py:50`](scripts/acquisition/api/routes/orchestrator.py#L50) | `required` |
| `GET` | `/runs` | [`scripts/acquisition/api/routes/discovery.py:126`](scripts/acquisition/api/routes/discovery.py#L126) | `read` |
| `POST` | `/schedule` | [`scripts/acquisition/api/routes/email.py:305`](scripts/acquisition/api/routes/email.py#L305) | `required` |
| `POST` | `/schedule` | [`scripts/acquisition/api/routes/warmup.py:78`](scripts/acquisition/api/routes/warmup.py#L78) | `required` |
| `POST` | `/seed` | [`scripts/acquisition/api/routes/orchestrator.py:99`](scripts/acquisition/api/routes/orchestrator.py#L99) | `required` |
| `POST` | `/send` | [`scripts/acquisition/api/routes/email.py:323`](scripts/acquisition/api/routes/email.py#L323) | `required` |
| `POST` | `/send` | [`scripts/acquisition/api/routes/outreach.py:115`](scripts/acquisition/api/routes/outreach.py#L115) | `required` |
| `GET` | `/stats/{week_start}` | [`scripts/acquisition/api/routes/reports.py:203`](scripts/acquisition/api/routes/reports.py#L203) | `read` |
| `GET` | `/status` | [`scripts/acquisition/api/routes/email.py:342`](scripts/acquisition/api/routes/email.py#L342) | `read` |
| `GET` | `/status` | [`scripts/acquisition/api/routes/entity.py:215`](scripts/acquisition/api/routes/entity.py#L215) | `read` |
| `GET` | `/status` | [`scripts/acquisition/api/routes/orchestrator.py:27`](scripts/acquisition/api/routes/orchestrator.py#L27) | `read` |
| `GET` | `/status` | [`scripts/acquisition/api/routes/warmup.py:152`](scripts/acquisition/api/routes/warmup.py#L152) | `read` |
| `GET` | `/unsubscribe` | [`scripts/acquisition/api/routes/email.py:152`](scripts/acquisition/api/routes/email.py#L152) | `read` |
| `GET` | `/v1/commands` | [`packages/protocol/src/control-server.ts:152`](packages/protocol/src/control-server.ts#L152) | `read` |
| `GET` | `/v1/commands` | [`packages/sora-automation/src/api/server.ts:302`](packages/sora-automation/src/api/server.ts#L302) | `read` |
| `POST` | `/v1/commands` | [`packages/protocol/src/control-server.ts:113`](packages/protocol/src/control-server.ts#L113) | `required` |
| `POST` | `/v1/commands` | [`packages/sora-automation/src/api/server.ts:275`](packages/sora-automation/src/api/server.ts#L275) | `required` |
| `DELETE` | `/v1/commands/:id` | [`packages/sora-automation/src/api/server.ts:307`](packages/sora-automation/src/api/server.ts#L307) | `required` |
| `GET` | `/v1/commands/:id` | [`packages/protocol/src/control-server.ts:136`](packages/protocol/src/control-server.ts#L136) | `read` |
| `GET` | `/v1/commands/:id` | [`packages/sora-automation/src/api/server.ts:292`](packages/sora-automation/src/api/server.ts#L292) | `read` |
| `POST` | `/v1/commands/:id/cancel` | [`packages/protocol/src/control-server.ts:144`](packages/protocol/src/control-server.ts#L144) | `required` |
| `POST` | `/v1/focus` | [`packages/sora-automation/src/api/server.ts:249`](packages/sora-automation/src/api/server.ts#L249) | `required` |
| `POST` | `/v1/sessions` | [`packages/protocol/src/control-server.ts:80`](packages/protocol/src/control-server.ts#L80) | `required` |
| `DELETE` | `/v1/sessions/:id` | [`packages/protocol/src/control-server.ts:100`](packages/protocol/src/control-server.ts#L100) | `required` |
| `GET` | `/v1/sessions/:id` | [`packages/protocol/src/control-server.ts:92`](packages/protocol/src/control-server.ts#L92) | `read` |
| `GET` | `/v1/sora/usage` | [`packages/protocol/src/control-server.ts:165`](packages/protocol/src/control-server.ts#L165) | `read` |
| `GET` | `/v1/sora/usage` | [`packages/sora-automation/src/api/server.ts:260`](packages/sora-automation/src/api/server.ts#L260) | `read` |
| `GET` | `/v1/telemetry/stats` | [`packages/protocol/src/control-server.ts:182`](packages/protocol/src/control-server.ts#L182) | `read` |
| `POST` | `/webhooks/resend` | [`scripts/acquisition/api/routes/email.py:78`](scripts/acquisition/api/routes/email.py#L78) | `required` |

## Formal file contracts

| Contract | Kind | Required fields | Join fields | Hash |
|---|---|---|---|---|
| [`Command Envelope`](packages/protocol/schemas/command.schema.json)<br>`packages/protocol/schemas/command.schema.json` | `json_schema` | command_id, payload, type, version | account_id, command_id, correlation_id, instance_id, session_id | `ecbef3985cf5` |
| [`Event Envelope`](packages/protocol/schemas/event.schema.json)<br>`packages/protocol/schemas/event.schema.json` | `json_schema` | emitted_at, event_id, payload, type, version | account_id, command_id, correlation_id, event_id, session_id | `a40986447fea` |

## Typed application models

| Model | Kind | Source |
|---|---|---|
| `AssociationResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `ConfirmAssociationRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `DiscoveryRunRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `DiscoveryRunResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `DiscoveryRunResult` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `EmailStatus` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `EntityResolutionResult` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `ExecuteRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `ExecuteResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `FollowUpResult` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `GenerateRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/outreach.py`](scripts/acquisition/api/routes/outreach.py) |
| `GenerateResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/outreach.py`](scripts/acquisition/api/routes/outreach.py) |
| `HealthResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `NicheConfigCreate` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `NicheConfigCreate` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `NicheConfigResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `NicheConfigUpdate` | `python-pydantic` | [`scripts/acquisition/api/routes/discovery.py`](scripts/acquisition/api/routes/discovery.py) |
| `NicheConfigUpdate` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `OutreachRequest` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `OutreachResult` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `PauseResumeResponse` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `PipelineStatus` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `PlatformStatus` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `ResendWebhookEvent` | `python-pydantic` | [`scripts/acquisition/api/routes/email.py`](scripts/acquisition/api/routes/email.py) |
| `ResolveBatchRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `ResolveRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `ResolveResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `ScheduleRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `ScheduleResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `SendRequest` | `python-pydantic` | [`scripts/acquisition/api/routes/outreach.py`](scripts/acquisition/api/routes/outreach.py) |
| `SendResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/outreach.py`](scripts/acquisition/api/routes/outreach.py) |
| `StatusResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/entity.py`](scripts/acquisition/api/routes/entity.py) |
| `StepRunRequest` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `StepRunResponse` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `TouchSummary` | `python-pydantic` | [`scripts/acquisition/api/routes/outreach.py`](scripts/acquisition/api/routes/outreach.py) |
| `WarmupStatus` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `WarmupStatusResponse` | `python-pydantic` | [`scripts/acquisition/api/routes/warmup.py`](scripts/acquisition/api/routes/warmup.py) |
| `WeeklyReport` | `python-pydantic` | [`scripts/acquisition/api/schemas.py`](scripts/acquisition/api/schemas.py) |
| `AICommentConfig` | `typescript-interface` | [`packages/instagram-comments/src/automation/ai-comment-generator.ts`](packages/instagram-comments/src/automation/ai-comment-generator.ts) |
| `AICommentConfig` | `typescript-interface` | [`packages/threads-comments/src/automation/ai-comment-generator.ts`](packages/threads-comments/src/automation/ai-comment-generator.ts) |
| `AIConfig` | `typescript-interface` | [`packages/services/src/ai/ai-utils.ts`](packages/services/src/ai/ai-utils.ts) |
| `AIGeneratorConfig` | `typescript-interface` | [`packages/services/src/comment-engine/ai-generator.ts`](packages/services/src/comment-engine/ai-generator.ts) |
| `APIResponseProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `AccountInfo` | `typescript-interface` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `ActionError` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ActionRecord` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ActionResult` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ActionTarget` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ActionTemplate` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ActivityMetrics` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `AdapterConfig` | `typescript-interface` | [`packages/services/src/comment-engine/adapters/base.ts`](packages/services/src/comment-engine/adapters/base.ts) |
| `AnalyticsSummary` | `typescript-interface` | [`packages/upwork-automation/src/automation/analytics-tracker.ts`](packages/upwork-automation/src/automation/analytics-tracker.ts) |
| `AnomalyResult` | `typescript-interface` | [`packages/cloud-sync/src/anomaly-detector.ts`](packages/cloud-sync/src/anomaly-detector.ts) |
| `ApiResponse` | `typescript-interface` | [`packages/instagram-dm/src/api/client.ts`](packages/instagram-dm/src/api/client.ts) |
| `ApiResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `ApiResponse` | `typescript-interface` | [`packages/twitter-dm/src/api/client.ts`](packages/twitter-dm/src/api/client.ts) |
| `ApplicationRecord` | `typescript-interface` | [`packages/upwork-automation/src/automation/analytics-tracker.ts`](packages/upwork-automation/src/automation/analytics-tracker.ts) |
| `ApplicationStatus` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `AssetGeneratorInput` | `typescript-interface` | [`packages/upwork-hunter/src/api/asset-generator.ts`](packages/upwork-hunter/src/api/asset-generator.ts) |
| `AssetGeneratorResult` | `typescript-interface` | [`packages/upwork-hunter/src/api/asset-generator.ts`](packages/upwork-hunter/src/api/asset-generator.ts) |
| `AudienceStats` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `AutoCommenterConfig` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-auto-commenter.ts`](packages/threads-comments/src/automation/threads-auto-commenter.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/instagram-comments/src/automation/types.ts`](packages/instagram-comments/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/threads-comments/src/automation/types.ts`](packages/threads-comments/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/tiktok-comments/src/automation/types.ts`](packages/tiktok-comments/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/twitter-comments/src/automation/safari-driver.ts`](packages/twitter-comments/src/automation/safari-driver.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `AutomationConfig` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `AutomationCore` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `AutomationResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `BatchPaywallResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `BatchResult` | `typescript-interface` | [`packages/protocol/src/video-pipeline.ts`](packages/protocol/src/video-pipeline.ts) |
| `BrandMention` | `typescript-interface` | [`packages/cloud-sync/src/mention-monitor.ts`](packages/cloud-sync/src/mention-monitor.ts) |
| `Browser` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `BrowserAgent` | `typescript-interface` | [`packages/unified-control/src/router.ts`](packages/unified-control/src/router.ts) |
| `BrowserCommandRequest` | `typescript-interface` | [`packages/unified-control/src/router.ts`](packages/unified-control/src/router.ts) |
| `BrowserCommandResponse` | `typescript-interface` | [`packages/unified-control/src/router.ts`](packages/unified-control/src/router.ts) |
| `BrowserConfig` | `typescript-interface` | [`apps/safari-client/src/BrowserAdapter.ts`](apps/safari-client/src/BrowserAdapter.ts) |
| `BrowserOptions` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `BrowserSession` | `typescript-interface` | [`packages/linkedin-automation/src/automation/session-manager.ts`](packages/linkedin-automation/src/automation/session-manager.ts) |
| `BuildResult` | `typescript-interface` | [`packages/upwork-hunter/src/api/build-pipeline.ts`](packages/upwork-hunter/src/api/build-pipeline.ts) |
| `CRMClientConfig` | `typescript-interface` | [`packages/crm-core/src/client/supabase-client.ts`](packages/crm-core/src/client/supabase-client.ts) |
| `CRMConfig` | `typescript-interface` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `CRMConfig` | `typescript-interface` | [`packages/crm-core/src/utils/config.ts`](packages/crm-core/src/utils/config.ts) |
| `Campaign` | `typescript-interface` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `Campaign` | `typescript-interface` | [`packages/linkedin-automation/dashboard/src/types.ts`](packages/linkedin-automation/dashboard/src/types.ts) |
| `Character` | `typescript-interface` | [`packages/services/src/sora/story-generator.ts`](packages/services/src/sora/story-generator.ts) |
| `CheckResult` | `typescript-interface` | [`packages/services/src/verification/verifier.ts`](packages/services/src/verification/verifier.ts) |
| `ChromeDriverOptions` | `typescript-interface` | [`packages/shared/chrome-driver.ts`](packages/shared/chrome-driver.ts) |
| `ChromeTabClaim` | `typescript-interface` | [`packages/linkedin-automation/src/automation/chrome-tab-coordinator.ts`](packages/linkedin-automation/src/automation/chrome-tab-coordinator.ts) |
| `ClapResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `ClickResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `ClientConfig` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `CloudAction` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `CoachingInput` | `typescript-interface` | [`packages/crm-core/src/engines/coaching-engine.ts`](packages/crm-core/src/engines/coaching-engine.ts) |
| `CoachingResult` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `CoachingRule` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `Command` | `typescript-interface` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `CommandEnvelope` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `CommandPayload` | `typescript-interface` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `CommandResponse` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `CommandResult` | `typescript-interface` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `CommandState` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `Comment` | `typescript-interface` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `CommentAdapter` | `typescript-interface` | [`packages/services/src/comment-engine/adapters/base.ts`](packages/services/src/comment-engine/adapters/base.ts) |
| `CommentConfig` | `typescript-interface` | [`packages/services/src/automation/comment-automation.ts`](packages/services/src/automation/comment-automation.ts) |
| `CommentEngineConfig` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentEngineStats` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentGenerationContext` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentLogEntry` | `typescript-interface` | [`packages/instagram-comments/src/db/comment-logger.ts`](packages/instagram-comments/src/db/comment-logger.ts) |
| `CommentLogEntry` | `typescript-interface` | [`packages/threads-comments/src/db/comment-logger.ts`](packages/threads-comments/src/db/comment-logger.ts) |
| `CommentLogEntry` | `typescript-interface` | [`packages/tiktok-comments/src/db/comment-logger.ts`](packages/tiktok-comments/src/db/comment-logger.ts) |
| `CommentLogEntry` | `typescript-interface` | [`packages/twitter-comments/src/db/comment-logger.ts`](packages/twitter-comments/src/db/comment-logger.ts) |
| `CommentLogResult` | `typescript-interface` | [`packages/instagram-comments/src/db/comment-logger.ts`](packages/instagram-comments/src/db/comment-logger.ts) |
| `CommentLogResult` | `typescript-interface` | [`packages/threads-comments/src/db/comment-logger.ts`](packages/threads-comments/src/db/comment-logger.ts) |
| `CommentLogResult` | `typescript-interface` | [`packages/tiktok-comments/src/db/comment-logger.ts`](packages/tiktok-comments/src/db/comment-logger.ts) |
| `CommentLogResult` | `typescript-interface` | [`packages/twitter-comments/src/db/comment-logger.ts`](packages/twitter-comments/src/db/comment-logger.ts) |
| `CommentRecord` | `typescript-interface` | [`packages/services/src/automation/comment-automation.ts`](packages/services/src/automation/comment-automation.ts) |
| `CommentRequest` | `typescript-interface` | [`packages/services/src/automation/comment-automation.ts`](packages/services/src/automation/comment-automation.ts) |
| `CommentResult` | `typescript-interface` | [`apps/safari-client/src/SafariAutoComment.ts`](apps/safari-client/src/SafariAutoComment.ts) |
| `CommentResult` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-driver.ts`](packages/facebook-comments/src/automation/facebook-driver.ts) |
| `CommentResult` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-driver.ts`](packages/instagram-comments/src/automation/instagram-driver.ts) |
| `CommentResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `CommentResult` | `typescript-interface` | [`packages/services/src/automation/comment-automation.ts`](packages/services/src/automation/comment-automation.ts) |
| `CommentResult` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentResult` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-driver.ts`](packages/threads-comments/src/automation/threads-driver.ts) |
| `CommentResult` | `typescript-interface` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `CommentTask` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CompetitorPost` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `CompetitorProfile` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `CompetitorResult` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `ComposeOptions` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-driver.ts`](packages/twitter-comments/src/automation/twitter-driver.ts) |
| `ConnectionRequest` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `ConnectionRequest` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `ConnectionResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `ConnectionStatus` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `ConnectsBalance` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-operations.ts`](packages/upwork-automation/src/automation/job-operations.ts) |
| `Contact` | `typescript-interface` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `Contact` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ContactContext` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `ContactContext` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `ContactContext` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `ContactContext` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `ContentAnalysis` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ContentPackage` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ContentPackageBatch` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `Conversation` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `Conversation` | `typescript-interface` | [`packages/services/src/instagram/instagram-dm.ts`](packages/services/src/instagram/instagram-dm.ts) |
| `Conversation` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `Conversation` | `typescript-interface` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `ConversationContext` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ConversationInfo` | `typescript-interface` | [`apps/safari-client/src/SafariController.ts`](apps/safari-client/src/SafariController.ts) |
| `ConversationsResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `Cookie` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `CopilotInput` | `typescript-interface` | [`packages/crm-core/src/engines/copilot-engine.ts`](packages/crm-core/src/engines/copilot-engine.ts) |
| `Creator` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-researcher.ts`](packages/twitter-comments/src/automation/twitter-researcher.ts) |
| `CreditRefreshCallback` | `typescript-interface` | [`packages/scheduler/src/sora-credit-monitor.ts`](packages/scheduler/src/sora-credit-monitor.ts) |
| `CriteriaItem` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `DMApiClientConfig` | `typescript-interface` | [`packages/instagram-dm/src/api/client.ts`](packages/instagram-dm/src/api/client.ts) |
| `DMApiClientConfig` | `typescript-interface` | [`packages/twitter-dm/src/api/client.ts`](packages/twitter-dm/src/api/client.ts) |
| `DMClassification` | `typescript-interface` | [`packages/cloud-sync/src/dm-classifier.ts`](packages/cloud-sync/src/dm-classifier.ts) |
| `DMConfig` | `typescript-interface` | [`packages/services/src/automation/dm-automation.ts`](packages/services/src/automation/dm-automation.ts) |
| `DMConversation` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `DMConversation` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `DMConversation` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `DMLogEntry` | `typescript-interface` | [`packages/instagram-dm/src/utils/dm-logger.ts`](packages/instagram-dm/src/utils/dm-logger.ts) |
| `DMLogEntry` | `typescript-interface` | [`packages/shared/dm-logger.ts`](packages/shared/dm-logger.ts) |
| `DMLogEntry` | `typescript-interface` | [`packages/tiktok-dm/src/utils/dm-logger.ts`](packages/tiktok-dm/src/utils/dm-logger.ts) |
| `DMLogEntry` | `typescript-interface` | [`packages/twitter-dm/src/utils/dm-logger.ts`](packages/twitter-dm/src/utils/dm-logger.ts) |
| `DMLogEntry` | `typescript-interface` | [`packages/unified-dm/src/dm-logger.ts`](packages/unified-dm/src/dm-logger.ts) |
| `DMMessage` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `DMMessage` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `DMMessage` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `DMRecord` | `typescript-interface` | [`packages/services/src/automation/dm-automation.ts`](packages/services/src/automation/dm-automation.ts) |
| `DMRequest` | `typescript-interface` | [`packages/services/src/automation/dm-automation.ts`](packages/services/src/automation/dm-automation.ts) |
| `DMResult` | `typescript-interface` | [`packages/services/src/automation/dm-automation.ts`](packages/services/src/automation/dm-automation.ts) |
| `DMResult` | `typescript-interface` | [`packages/services/src/instagram/instagram-dm.ts`](packages/services/src/instagram/instagram-dm.ts) |
| `DMSessionEntry` | `typescript-interface` | [`packages/unified-dm/src/dm-logger.ts`](packages/unified-dm/src/dm-logger.ts) |
| `DMThread` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `DMThread` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `DMThread` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `DOMSnapshotProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `DbCommand` | `typescript-interface` | [`packages/protocol/src/supabase-client.ts`](packages/protocol/src/supabase-client.ts) |
| `DbEvent` | `typescript-interface` | [`packages/protocol/src/supabase-client.ts`](packages/protocol/src/supabase-client.ts) |
| `DbSession` | `typescript-interface` | [`packages/protocol/src/supabase-client.ts`](packages/protocol/src/supabase-client.ts) |
| `DbVideo` | `typescript-interface` | [`packages/protocol/src/supabase-client.ts`](packages/protocol/src/supabase-client.ts) |
| `DbWatermarkRemoval` | `typescript-interface` | [`packages/protocol/src/supabase-client.ts`](packages/protocol/src/supabase-client.ts) |
| `DiscoverParams` | `typescript-interface` | [`packages/instagram-dm/src/api/prospect-discovery.ts`](packages/instagram-dm/src/api/prospect-discovery.ts) |
| `DiscoverParams` | `typescript-interface` | [`packages/threads-comments/src/api/prospect-discovery.ts`](packages/threads-comments/src/api/prospect-discovery.ts) |
| `DiscoverParams` | `typescript-interface` | [`packages/twitter-dm/src/api/prospect-discovery.ts`](packages/twitter-dm/src/api/prospect-discovery.ts) |
| `DiscoverProspectsRequest` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `DiscoveredPost` | `typescript-interface` | [`packages/services/src/automation/discovery-system.ts`](packages/services/src/automation/discovery-system.ts) |
| `DiscoveredPost` | `typescript-interface` | [`packages/services/src/discovery/types.ts`](packages/services/src/discovery/types.ts) |
| `DiscoveryConfig` | `typescript-interface` | [`packages/services/src/automation/discovery-system.ts`](packages/services/src/automation/discovery-system.ts) |
| `DiscoveryConfig` | `typescript-interface` | [`packages/services/src/discovery/types.ts`](packages/services/src/discovery/types.ts) |
| `DiscoveryFilter` | `typescript-interface` | [`packages/services/src/discovery/types.ts`](packages/services/src/discovery/types.ts) |
| `DiscoveryQuery` | `typescript-interface` | [`packages/services/src/automation/discovery-system.ts`](packages/services/src/automation/discovery-system.ts) |
| `DiscoveryResult` | `typescript-interface` | [`packages/services/src/automation/discovery-system.ts`](packages/services/src/automation/discovery-system.ts) |
| `DownloadResult` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `DownloadResult` | `typescript-interface` | [`packages/services/src/sora/sora-real-automation.ts`](packages/services/src/sora/sora-real-automation.ts) |
| `Draft` | `typescript-interface` | [`packages/services/src/sora/sora-real-automation.ts`](packages/services/src/sora/sora-real-automation.ts) |
| `EarningsSummary` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `Element` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `ElementInfo` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `ElementProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `EncryptedCookie` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `EngagementResult` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-auto-commenter.ts`](packages/threads-comments/src/automation/threads-auto-commenter.ts) |
| `EventEnvelope` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `ExecutionResult` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `ExtractFollowersResult` | `typescript-interface` | [`packages/instagram-dm/src/automation/follower-operations.ts`](packages/instagram-dm/src/automation/follower-operations.ts) |
| `ExtractFollowersResult` | `typescript-interface` | [`packages/threads-comments/src/automation/follower-operations.ts`](packages/threads-comments/src/automation/follower-operations.ts) |
| `ExtractFollowersResult` | `typescript-interface` | [`packages/tiktok-dm/src/automation/follower-operations.ts`](packages/tiktok-dm/src/automation/follower-operations.ts) |
| `ExtractFollowersResult` | `typescript-interface` | [`packages/twitter-dm/src/automation/follower-operations.ts`](packages/twitter-dm/src/automation/follower-operations.ts) |
| `FacebookConfig` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-driver.ts`](packages/facebook-comments/src/automation/facebook-driver.ts) |
| `FacebookCreator` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-researcher.ts`](packages/facebook-comments/src/automation/facebook-researcher.ts) |
| `FacebookNicheResult` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-researcher.ts`](packages/facebook-comments/src/automation/facebook-researcher.ts) |
| `FacebookPost` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-researcher.ts`](packages/facebook-comments/src/automation/facebook-researcher.ts) |
| `FacebookResearchConfig` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-researcher.ts`](packages/facebook-comments/src/automation/facebook-researcher.ts) |
| `FacebookStatus` | `typescript-interface` | [`packages/facebook-comments/src/automation/facebook-driver.ts`](packages/facebook-comments/src/automation/facebook-driver.ts) |
| `FeedbackLoopConfig` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `FireflyConfig` | `typescript-interface` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `FireflyStatus` | `typescript-interface` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `FitDetectionResult` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `FitDetectionResult` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `FitDetectionResult` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `FitDetectionResult` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `FitSignal` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `FitSignal` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `FitSignal` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `FitSignal` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `FitSignalConfig` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `FollowResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `FollowUpTiming` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `FollowerEvent` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `FollowerProfile` | `typescript-interface` | [`packages/instagram-dm/src/automation/follower-operations.ts`](packages/instagram-dm/src/automation/follower-operations.ts) |
| `FollowerProfile` | `typescript-interface` | [`packages/threads-comments/src/automation/follower-operations.ts`](packages/threads-comments/src/automation/follower-operations.ts) |
| `FollowerProfile` | `typescript-interface` | [`packages/tiktok-dm/src/automation/follower-operations.ts`](packages/tiktok-dm/src/automation/follower-operations.ts) |
| `FollowerProfile` | `typescript-interface` | [`packages/twitter-dm/src/automation/follower-operations.ts`](packages/twitter-dm/src/automation/follower-operations.ts) |
| `FullRunResult` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `GenerateOptions` | `typescript-interface` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `GenerateOptions` | `typescript-interface` | [`packages/sora-automation/src/automation/sora-operations.ts`](packages/sora-automation/src/automation/sora-operations.ts) |
| `GeneratedComment` | `typescript-interface` | [`packages/instagram-comments/src/automation/ai-comment-generator.ts`](packages/instagram-comments/src/automation/ai-comment-generator.ts) |
| `GeneratedComment` | `typescript-interface` | [`packages/threads-comments/src/automation/ai-comment-generator.ts`](packages/threads-comments/src/automation/ai-comment-generator.ts) |
| `GeneratedImage` | `typescript-interface` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `GeneratedProposal` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `GenerationConfig` | `typescript-interface` | [`packages/services/src/sora/story-generator.ts`](packages/services/src/sora/story-generator.ts) |
| `HealthCheckResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `HealthResponse` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `ICPScore` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `ICPScoreBreakdown` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `IcpCriteria` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `InstagramConfig` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-driver.ts`](packages/instagram-comments/src/automation/instagram-driver.ts) |
| `InstagramCreator` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `InstagramNicheResult` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `InstagramPost` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `InstagramResearchConfig` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-researcher.ts`](packages/instagram-comments/src/automation/instagram-researcher.ts) |
| `InstagramStatus` | `typescript-interface` | [`packages/instagram-comments/src/automation/instagram-driver.ts`](packages/instagram-comments/src/automation/instagram-driver.ts) |
| `Interaction` | `typescript-interface` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `JSExecutionResult` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `Job` | `typescript-interface` | [`apps/api/src/services/job-manager.ts`](apps/api/src/services/job-manager.ts) |
| `JobResult` | `typescript-interface` | [`apps/api/src/services/job-manager.ts`](apps/api/src/services/job-manager.ts) |
| `JobScore` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `JobSearchConfig` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `JobWatchConfig` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-monitor.ts`](packages/upwork-automation/src/automation/job-monitor.ts) |
| `LeadScore` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `LinkedInActionEntry` | `typescript-interface` | [`packages/linkedin-chrome/src/utils/linkedin-logger.ts`](packages/linkedin-chrome/src/utils/linkedin-logger.ts) |
| `LinkedInComment` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `LinkedInConversation` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `LinkedInConversation` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `LinkedInInvitation` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `LinkedInMessage` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `LinkedInMetrics` | `typescript-interface` | [`packages/cloud-sync/src/linkedin-metrics.ts`](packages/cloud-sync/src/linkedin-metrics.ts) |
| `LinkedInPost` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `LinkedInProfile` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `LinkedInProfile` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `LinkedInSearchResult` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `ManagedStory` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `MediaAsset` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `MediaManifest` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `MediumArticle` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `MediumFeedItem` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `Message` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `Message` | `typescript-interface` | [`packages/services/src/instagram/instagram-dm.ts`](packages/services/src/instagram/instagram-dm.ts) |
| `Message` | `typescript-interface` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `MessageInfo` | `typescript-interface` | [`apps/safari-client/src/SafariController.ts`](apps/safari-client/src/SafariController.ts) |
| `MessageTemplates` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `MessagesResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `MethodAttempt` | `typescript-interface` | [`apps/safari-client/src/SafariAutoComment.ts`](apps/safari-client/src/SafariAutoComment.ts) |
| `MonitorState` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-monitor.ts`](packages/upwork-automation/src/automation/job-monitor.ts) |
| `MultiNicheReport` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `NavigationOptions` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `NavigationResult` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `NetworkRequest` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `NicheContext` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `NicheContext` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `NicheResearchResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `NicheResult` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-researcher.ts`](packages/twitter-comments/src/automation/twitter-researcher.ts) |
| `NicheSummary` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `NoteInfo` | `typescript-interface` | [`apps/safari-client/src/SafariController.ts`](apps/safari-client/src/SafariController.ts) |
| `OfferContext` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `OfferContext` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `OrchestratorConfig` | `typescript-interface` | [`packages/services/src/orchestrator/types.ts`](packages/services/src/orchestrator/types.ts) |
| `OrchestratorStatus` | `typescript-interface` | [`packages/services/src/orchestrator/types.ts`](packages/services/src/orchestrator/types.ts) |
| `OutreachAction` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `OutreachAction` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `OutreachAction` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `OutreachAction` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `OutreachAction` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `OutreachCampaign` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `OutreachMessage` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `OutreachRunResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `OutreachStats` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `PackagerOptions` | `typescript-interface` | [`packages/content-packager/src/packager.ts`](packages/content-packager/src/packager.ts) |
| `PageState` | `typescript-interface` | [`apps/safari-client/src/SafariController.ts`](apps/safari-client/src/SafariController.ts) |
| `PageState` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `PaywallRecommendation` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `PaywallResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `PendingRequest` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `PeopleSearchConfig` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `PerformanceMetrics` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `PipelineOptions` | `typescript-interface` | [`packages/protocol/src/video-pipeline.ts`](packages/protocol/src/video-pipeline.ts) |
| `PipelineResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/prospecting-pipeline.ts`](packages/linkedin-automation/src/automation/prospecting-pipeline.ts) |
| `PipelineResult` | `typescript-interface` | [`packages/protocol/src/video-pipeline.ts`](packages/protocol/src/video-pipeline.ts) |
| `PipelineStats` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `PlatformAccount` | `typescript-interface` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `PlatformComment` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PlatformConfig` | `typescript-interface` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `PlatformConfig` | `typescript-interface` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `PlatformDM` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PlatformNotification` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PlatformPoller` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PlatformQuota` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `PlatformStatus` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `PlatformStatus` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `PlatformStatus` | `typescript-interface` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `PlatformStatus` | `typescript-interface` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `PollResult` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `PollResult` | `typescript-interface` | [`packages/services/src/sora/sora-real-automation.ts`](packages/services/src/sora/sora-real-automation.ts) |
| `PollState` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PostAnalysis` | `typescript-interface` | [`packages/instagram-comments/src/automation/ai-comment-generator.ts`](packages/instagram-comments/src/automation/ai-comment-generator.ts) |
| `PostAnalysis` | `typescript-interface` | [`packages/threads-comments/src/automation/ai-comment-generator.ts`](packages/threads-comments/src/automation/ai-comment-generator.ts) |
| `PostCommentResult` | `typescript-interface` | [`packages/services/src/comment-engine/adapters/base.ts`](packages/services/src/comment-engine/adapters/base.ts) |
| `PostContext` | `typescript-interface` | [`packages/instagram-comments/src/automation/ai-comment-generator.ts`](packages/instagram-comments/src/automation/ai-comment-generator.ts) |
| `PostContext` | `typescript-interface` | [`packages/threads-comments/src/automation/ai-comment-generator.ts`](packages/threads-comments/src/automation/ai-comment-generator.ts) |
| `PostContext` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-auto-commenter.ts`](packages/threads-comments/src/automation/threads-auto-commenter.ts) |
| `PostDraft` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `PostInfo` | `typescript-interface` | [`apps/safari-client/src/SafariAutoComment.ts`](apps/safari-client/src/SafariAutoComment.ts) |
| `PostResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `PostResult` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-driver.ts`](packages/twitter-comments/src/automation/twitter-driver.ts) |
| `PostStats` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `PostStats` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `PostTarget` | `typescript-interface` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `ProfileButtonState` | `typescript-interface` | [`packages/linkedin-automation/src/automation/dm-operations.ts`](packages/linkedin-automation/src/automation/dm-operations.ts) |
| `ProfileDMResult` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `ProfileInfo` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `PromptResult` | `typescript-interface` | [`packages/services/src/sora/sora-real-automation.ts`](packages/services/src/sora/sora-real-automation.ts) |
| `ProofArtifact` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `ProofArtifact` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ProposalResult` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-operations.ts`](packages/upwork-automation/src/automation/job-operations.ts) |
| `ProposalStats` | `typescript-interface` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `ProposalSubmission` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-operations.ts`](packages/upwork-automation/src/automation/job-operations.ts) |
| `ProposalTemplate` | `typescript-interface` | [`packages/upwork-automation/src/automation/template-manager.ts`](packages/upwork-automation/src/automation/template-manager.ts) |
| `ProposalTemplate` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `Prospect` | `typescript-interface` | [`packages/linkedin-automation/dashboard/src/types.ts`](packages/linkedin-automation/dashboard/src/types.ts) |
| `Prospect` | `typescript-interface` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `ProspectCandidate` | `typescript-interface` | [`packages/instagram-dm/src/api/prospect-discovery.ts`](packages/instagram-dm/src/api/prospect-discovery.ts) |
| `ProspectCandidate` | `typescript-interface` | [`packages/threads-comments/src/api/prospect-discovery.ts`](packages/threads-comments/src/api/prospect-discovery.ts) |
| `ProspectCandidate` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `ProspectCandidate` | `typescript-interface` | [`packages/twitter-dm/src/api/prospect-discovery.ts`](packages/twitter-dm/src/api/prospect-discovery.ts) |
| `ProspectListOpts` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `ProspectResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/prospecting-pipeline.ts`](packages/linkedin-automation/src/automation/prospecting-pipeline.ts) |
| `ProspectStats` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `ProspectingConfig` | `typescript-interface` | [`packages/linkedin-automation/src/automation/prospecting-pipeline.ts`](packages/linkedin-automation/src/automation/prospecting-pipeline.ts) |
| `QueueConfig` | `typescript-interface` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `QueueConfig` | `typescript-interface` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `QueueStats` | `typescript-interface` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `QueueTask` | `typescript-interface` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `RateLimit` | `typescript-interface` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `RateLimitConfig` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `RateLimitConfig` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `RateLimitConfig` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `RateLimitConfig` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `RateLimitConfig` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `RateLimitInfo` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `RateLimitStatus` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-operations.ts`](packages/upwork-automation/src/automation/job-operations.ts) |
| `RateLimitsResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `ReadyResponse` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `RecreationInstructions` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `RelationshipScore` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `RenderSpec` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `RenderStyle` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ReplySuggestion` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `RequiredApi` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ResearchConfig` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-researcher.ts`](packages/twitter-comments/src/automation/twitter-researcher.ts) |
| `ResearchJob` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `ResearchTweet` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-researcher.ts`](packages/twitter-comments/src/automation/twitter-researcher.ts) |
| `ResourceRequirements` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `RespondResult` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `SEOAuditItem` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `SEOAuditResult` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `SafariConfig` | `typescript-interface` | [`packages/services/src/safari/types.ts`](packages/services/src/safari/types.ts) |
| `SafariLock` | `typescript-interface` | [`packages/scheduler/src/safari-gateway.ts`](packages/scheduler/src/safari-gateway.ts) |
| `ScanResult` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-monitor.ts`](packages/upwork-automation/src/automation/job-monitor.ts) |
| `ScanSummary` | `typescript-interface` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `ScheduledTask` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `SchedulerConfig` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `SchedulerEvents` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `SchedulerStatus` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `ScoreResult` | `typescript-interface` | [`packages/linkedin-chrome/src/automation/types.ts`](packages/linkedin-chrome/src/automation/types.ts) |
| `ScoreWeights` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ScoringInput` | `typescript-interface` | [`packages/crm-core/src/engines/scoring-engine.ts`](packages/crm-core/src/engines/scoring-engine.ts) |
| `ScreenshotOptions` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `ScreenshotProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `SearchResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `SearchResult` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-driver.ts`](packages/twitter-comments/src/automation/twitter-driver.ts) |
| `SeenJob` | `typescript-interface` | [`packages/upwork-automation/src/automation/job-monitor.ts`](packages/upwork-automation/src/automation/job-monitor.ts) |
| `Selector` | `typescript-interface` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `SelectorContract` | `typescript-interface` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `SelectorGroup` | `typescript-interface` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `SelectorValidation` | `typescript-interface` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `SendDMRequest` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `SendDMResult` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `SendMessageResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `SendMessageResult` | `typescript-interface` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `SendMessageResult` | `typescript-interface` | [`packages/linkedin-automation/src/automation/types.ts`](packages/linkedin-automation/src/automation/types.ts) |
| `SendMessageResult` | `typescript-interface` | [`packages/tiktok-dm/src/automation/types.ts`](packages/tiktok-dm/src/automation/types.ts) |
| `SendMessageResult` | `typescript-interface` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `SendMessageResult` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `SendResult` | `typescript-interface` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `ServiceConfig` | `typescript-interface` | [`packages/scheduler/src/safari-gateway.ts`](packages/scheduler/src/safari-gateway.ts) |
| `SessionData` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `SessionEvent` | `typescript-interface` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/instagram-comments/src/automation/safari-driver.ts`](packages/instagram-comments/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/instagram-dm/src/automation/chrome-driver.ts`](packages/instagram-dm/src/automation/chrome-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/instagram-dm/src/automation/safari-driver.ts`](packages/instagram-dm/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/linkedin-automation/src/automation/safari-driver.ts`](packages/linkedin-automation/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/medium-automation/src/automation/safari-driver.ts`](packages/medium-automation/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/threads-comments/src/automation/safari-driver.ts`](packages/threads-comments/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/tiktok-comments/src/automation/safari-driver.ts`](packages/tiktok-comments/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/tiktok-dm/src/automation/safari-driver.ts`](packages/tiktok-dm/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/twitter-comments/src/automation/safari-driver.ts`](packages/twitter-comments/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/twitter-dm/src/automation/safari-driver.ts`](packages/twitter-dm/src/automation/safari-driver.ts) |
| `SessionInfo` | `typescript-interface` | [`packages/upwork-automation/src/automation/safari-driver.ts`](packages/upwork-automation/src/automation/safari-driver.ts) |
| `SessionKeeperConfig` | `typescript-interface` | [`packages/services/src/session-manager/session-keeper.ts`](packages/services/src/session-manager/session-keeper.ts) |
| `SessionManagerConfig` | `typescript-interface` | [`packages/services/src/session-manager/session-manager.ts`](packages/services/src/session-manager/session-manager.ts) |
| `SessionMetrics` | `typescript-interface` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `SessionState` | `typescript-interface` | [`packages/scheduler/src/safari-gateway.ts`](packages/scheduler/src/safari-gateway.ts) |
| `SessionState` | `typescript-interface` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `SoraBatchPayload` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraCleanPayload` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraCleanResult` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraConfig` | `typescript-interface` | [`packages/services/src/automation/sora-automation.ts`](packages/services/src/automation/sora-automation.ts) |
| `SoraCreditStatus` | `typescript-interface` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `SoraDraft` | `typescript-interface` | [`packages/services/src/automation/sora-automation.ts`](packages/services/src/automation/sora-automation.ts) |
| `SoraFullConfig` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `SoraGeneratePayload` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraGenerateResult` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraGenerationRequest` | `typescript-interface` | [`packages/services/src/sora/types.ts`](packages/services/src/sora/types.ts) |
| `SoraGenerationResult` | `typescript-interface` | [`packages/services/src/automation/sora-automation.ts`](packages/services/src/automation/sora-automation.ts) |
| `SoraPollResult` | `typescript-interface` | [`packages/services/src/automation/sora-automation.ts`](packages/services/src/automation/sora-automation.ts) |
| `SoraPrompt` | `typescript-interface` | [`packages/services/src/automation/sora-automation.ts`](packages/services/src/automation/sora-automation.ts) |
| `SoraRateLimitConfig` | `typescript-interface` | [`packages/services/src/sora/types.ts`](packages/services/src/sora/types.ts) |
| `SoraRealConfig` | `typescript-interface` | [`packages/services/src/sora/sora-real-automation.ts`](packages/services/src/sora/sora-real-automation.ts) |
| `SoraUsage` | `typescript-interface` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `SoraUsageResult` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraUsageStats` | `typescript-interface` | [`packages/services/src/sora/types.ts`](packages/services/src/sora/types.ts) |
| `SourceReference` | `typescript-interface` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `Stats` | `typescript-interface` | [`packages/linkedin-automation/dashboard/src/types.ts`](packages/linkedin-automation/dashboard/src/types.ts) |
| `StatusResponse` | `typescript-interface` | [`packages/tiktok-dm/src/api/client.ts`](packages/tiktok-dm/src/api/client.ts) |
| `StoredAction` | `typescript-interface` | [`packages/linkedin-automation/src/automation/supabase-client.ts`](packages/linkedin-automation/src/automation/supabase-client.ts) |
| `StoredContact` | `typescript-interface` | [`packages/linkedin-automation/src/automation/supabase-client.ts`](packages/linkedin-automation/src/automation/supabase-client.ts) |
| `StoredConversation` | `typescript-interface` | [`packages/linkedin-automation/src/automation/supabase-client.ts`](packages/linkedin-automation/src/automation/supabase-client.ts) |
| `StoredMessage` | `typescript-interface` | [`packages/linkedin-automation/src/automation/supabase-client.ts`](packages/linkedin-automation/src/automation/supabase-client.ts) |
| `StoryConfig` | `typescript-interface` | [`packages/services/src/sora/story-generator.ts`](packages/services/src/sora/story-generator.ts) |
| `StoryEarning` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `StoryPerformance` | `typescript-interface` | [`packages/medium-automation/src/automation/monetization-engine.ts`](packages/medium-automation/src/automation/monetization-engine.ts) |
| `StorySettings` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `StoryTemplate` | `typescript-interface` | [`packages/services/src/sora/story-generator.ts`](packages/services/src/sora/story-generator.ts) |
| `StrategyContext` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `StrategyContext` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `SubmitResult` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `SubscribeMessage` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SubscribedMessage` | `typescript-interface` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SuccessCriteria` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `SuggestedAction` | `typescript-interface` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `SuggestedProspect` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `SupabaseConfig` | `typescript-interface` | [`packages/linkedin-automation/src/automation/supabase-client.ts`](packages/linkedin-automation/src/automation/supabase-client.ts) |
| `SyncConfig` | `typescript-interface` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `TabClaim` | `typescript-interface` | [`packages/facebook-comments/src/automation/tab-coordinator.ts`](packages/facebook-comments/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/instagram-comments/src/automation/tab-coordinator.ts`](packages/instagram-comments/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/instagram-dm/src/automation/tab-coordinator.ts`](packages/instagram-dm/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/linkedin-automation/src/automation/tab-coordinator.ts`](packages/linkedin-automation/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/market-research/src/automation/tab-coordinator.ts`](packages/market-research/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/medium-automation/src/automation/tab-coordinator.ts`](packages/medium-automation/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/shared/chrome-driver.ts`](packages/shared/chrome-driver.ts) |
| `TabClaim` | `typescript-interface` | [`packages/sora-automation/src/automation/tab-coordinator.ts`](packages/sora-automation/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/threads-comments/src/automation/tab-coordinator.ts`](packages/threads-comments/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tab-coordinator.ts`](packages/tiktok-comments/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/tiktok-dm/src/automation/tab-coordinator.ts`](packages/tiktok-dm/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/twitter-comments/src/automation/tab-coordinator.ts`](packages/twitter-comments/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/twitter-dm/src/automation/tab-coordinator.ts`](packages/twitter-dm/src/automation/tab-coordinator.ts) |
| `TabClaim` | `typescript-interface` | [`packages/upwork-automation/src/automation/tab-coordinator.ts`](packages/upwork-automation/src/automation/tab-coordinator.ts) |
| `TabInfo` | `typescript-interface` | [`packages/linkedin-automation/src/automation/safari-driver.ts`](packages/linkedin-automation/src/automation/safari-driver.ts) |
| `Task` | `typescript-interface` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `TelemetryEvent` | `typescript-interface` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `Template` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `Template` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `Template` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `Template` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `TemplateResult` | `typescript-interface` | [`packages/instagram-dm/src/utils/template-engine.ts`](packages/instagram-dm/src/utils/template-engine.ts) |
| `TemplateResult` | `typescript-interface` | [`packages/shared/template-engine.ts`](packages/shared/template-engine.ts) |
| `TemplateResult` | `typescript-interface` | [`packages/tiktok-dm/src/utils/template-engine.ts`](packages/tiktok-dm/src/utils/template-engine.ts) |
| `TemplateResult` | `typescript-interface` | [`packages/twitter-dm/src/utils/template-engine.ts`](packages/twitter-dm/src/utils/template-engine.ts) |
| `TextMatchProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ThreadsConfig` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-driver.ts`](packages/threads-comments/src/automation/threads-driver.ts) |
| `ThreadsCreator` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-researcher.ts`](packages/threads-comments/src/automation/threads-researcher.ts) |
| `ThreadsNicheResult` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-researcher.ts`](packages/threads-comments/src/automation/threads-researcher.ts) |
| `ThreadsPost` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-researcher.ts`](packages/threads-comments/src/automation/threads-researcher.ts) |
| `ThreadsResearchConfig` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-researcher.ts`](packages/threads-comments/src/automation/threads-researcher.ts) |
| `ThreadsStatus` | `typescript-interface` | [`packages/threads-comments/src/automation/threads-driver.ts`](packages/threads-comments/src/automation/threads-driver.ts) |
| `TikTokConfig` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tiktok-driver.ts`](packages/tiktok-comments/src/automation/tiktok-driver.ts) |
| `TikTokConversation` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `TikTokCreator` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tiktok-researcher.ts`](packages/tiktok-comments/src/automation/tiktok-researcher.ts) |
| `TikTokCreator` | `typescript-interface` | [`packages/tiktok-comments/src/automation/types.ts`](packages/tiktok-comments/src/automation/types.ts) |
| `TikTokMessage` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `TikTokNicheResult` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tiktok-researcher.ts`](packages/tiktok-comments/src/automation/tiktok-researcher.ts) |
| `TikTokProfile` | `typescript-interface` | [`packages/tiktok-dm/src/types/index.ts`](packages/tiktok-dm/src/types/index.ts) |
| `TikTokResearchConfig` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tiktok-researcher.ts`](packages/tiktok-comments/src/automation/tiktok-researcher.ts) |
| `TikTokVideo` | `typescript-interface` | [`packages/tiktok-comments/src/automation/tiktok-researcher.ts`](packages/tiktok-comments/src/automation/tiktok-researcher.ts) |
| `TikTokVideo` | `typescript-interface` | [`packages/tiktok-comments/src/automation/types.ts`](packages/tiktok-comments/src/automation/types.ts) |
| `TimestampProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `TopAuthor` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `TopPost` | `typescript-interface` | [`packages/instagram-dm/src/api/prospect-discovery.ts`](packages/instagram-dm/src/api/prospect-discovery.ts) |
| `TopPostCreator` | `typescript-interface` | [`packages/instagram-dm/src/api/prospect-discovery.ts`](packages/instagram-dm/src/api/prospect-discovery.ts) |
| `TrackedTweet` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `TrackedTweet` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `TrendingArticle` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `TweetDetail` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-driver.ts`](packages/twitter-comments/src/automation/twitter-driver.ts) |
| `TweetMetrics` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `TweetMetrics` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-feedback-loop.ts`](packages/twitter-comments/src/automation/twitter-feedback-loop.ts) |
| `TwitterConfig` | `typescript-interface` | [`packages/twitter-comments/src/automation/twitter-driver.ts`](packages/twitter-comments/src/automation/twitter-driver.ts) |
| `TypeResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `URLMatchProof` | `typescript-interface` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `UnifiedBrowser` | `typescript-interface` | [`apps/safari-client/src/BrowserAdapter.ts`](apps/safari-client/src/BrowserAdapter.ts) |
| `UnifiedClientConfig` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `UnifiedCommentsConfig` | `typescript-interface` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `UnifiedDMConfig` | `typescript-interface` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `UnifiedPage` | `typescript-interface` | [`apps/safari-client/src/BrowserAdapter.ts`](apps/safari-client/src/BrowserAdapter.ts) |
| `UnifiedRateLimits` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `UnifiedStatus` | `typescript-interface` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `UnreadMessagesResult` | `typescript-interface` | [`packages/upwork-automation/src/automation/message-operations.ts`](packages/upwork-automation/src/automation/message-operations.ts) |
| `UpworkConversation` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `UpworkJob` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `UpworkJob` | `typescript-interface` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `UpworkJobDetail` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `UpworkMessage` | `typescript-interface` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `UpworkProposal` | `typescript-interface` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `UsageInfo` | `typescript-interface` | [`packages/services/src/sora/sora-full-automation.ts`](packages/services/src/sora/sora-full-automation.ts) |
| `UserStats` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-operations.ts`](packages/medium-automation/src/automation/medium-operations.ts) |
| `VerificationCheck` | `typescript-interface` | [`packages/services/src/verification/verifier.ts`](packages/services/src/verification/verifier.ts) |
| `VerificationReport` | `typescript-interface` | [`packages/services/src/verification/audit-logger.ts`](packages/services/src/verification/audit-logger.ts) |
| `VerificationResult` | `typescript-interface` | [`packages/services/src/verification/verifier.ts`](packages/services/src/verification/verifier.ts) |
| `VerifierConfig` | `typescript-interface` | [`packages/services/src/verification/verifier.ts`](packages/services/src/verification/verifier.ts) |
| `VerifyCommentResult` | `typescript-interface` | [`packages/services/src/comment-engine/adapters/base.ts`](packages/services/src/comment-engine/adapters/base.ts) |
| `VideoPrompt` | `typescript-interface` | [`packages/services/src/sora/story-generator.ts`](packages/services/src/sora/story-generator.ts) |
| `WaitOptions` | `typescript-interface` | [`packages/browser/src/types.ts`](packages/browser/src/types.ts) |
| `WaitResult` | `typescript-interface` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `WebhookConfig` | `typescript-interface` | [`packages/medium-automation/src/automation/medium-researcher.ts`](packages/medium-automation/src/automation/medium-researcher.ts) |
| `WebhookInfo` | `typescript-interface` | [`packages/market-research/src/sdk/client.ts`](packages/market-research/src/sdk/client.ts) |
| `Worker` | `typescript-interface` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `ActionLane` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ActionStatus` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ActionType` | `typescript-type` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `AspectRatio` | `typescript-type` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `BrowserType` | `typescript-type` | [`apps/safari-client/src/BrowserAdapter.ts`](apps/safari-client/src/BrowserAdapter.ts) |
| `CadenceType` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `ChromePlatform` | `typescript-type` | [`packages/shared/chrome-driver.ts`](packages/shared/chrome-driver.ts) |
| `CoachingCategory` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `CommandStatus` | `typescript-type` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `CommandStatus` | `typescript-type` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `CommandType` | `typescript-type` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `CommandType` | `typescript-type` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `CommentPlatform` | `typescript-type` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentPlatform` | `typescript-type` | [`packages/unified-comments/src/types.ts`](packages/unified-comments/src/types.ts) |
| `CommentStatus` | `typescript-type` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `CommentStyle` | `typescript-type` | [`packages/services/src/comment-engine/types.ts`](packages/services/src/comment-engine/types.ts) |
| `ContentFormat` | `typescript-type` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ContentTone` | `typescript-type` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `ContentType` | `typescript-type` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `DMPlatform` | `typescript-type` | [`packages/instagram-dm/src/utils/dm-logger.ts`](packages/instagram-dm/src/utils/dm-logger.ts) |
| `DMPlatform` | `typescript-type` | [`packages/shared/dm-logger.ts`](packages/shared/dm-logger.ts) |
| `DMPlatform` | `typescript-type` | [`packages/tiktok-dm/src/utils/dm-logger.ts`](packages/tiktok-dm/src/utils/dm-logger.ts) |
| `DMPlatform` | `typescript-type` | [`packages/twitter-dm/src/utils/dm-logger.ts`](packages/twitter-dm/src/utils/dm-logger.ts) |
| `DMPlatform` | `typescript-type` | [`packages/unified-dm/src/dm-logger.ts`](packages/unified-dm/src/dm-logger.ts) |
| `DMTab` | `typescript-type` | [`packages/instagram-dm/src/automation/types.ts`](packages/instagram-dm/src/automation/types.ts) |
| `DMTab` | `typescript-type` | [`packages/twitter-dm/src/automation/types.ts`](packages/twitter-dm/src/automation/types.ts) |
| `DataType` | `typescript-type` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `DiscoverySource` | `typescript-type` | [`packages/services/src/discovery/types.ts`](packages/services/src/discovery/types.ts) |
| `EventType` | `typescript-type` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `FocusableApp` | `typescript-type` | [`apps/api/src/utils/focus.ts`](apps/api/src/utils/focus.ts) |
| `JobStatus` | `typescript-type` | [`apps/api/src/services/job-manager.ts`](apps/api/src/services/job-manager.ts) |
| `JobTab` | `typescript-type` | [`packages/upwork-automation/src/automation/types.ts`](packages/upwork-automation/src/automation/types.ts) |
| `LinkedInActionType` | `typescript-type` | [`packages/linkedin-chrome/src/utils/linkedin-logger.ts`](packages/linkedin-chrome/src/utils/linkedin-logger.ts) |
| `MessageType` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `OfferType` | `typescript-type` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `PipelineStage` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `Platform` | `typescript-type` | [`packages/cloud-sync/src/types.ts`](packages/cloud-sync/src/types.ts) |
| `Platform` | `typescript-type` | [`packages/crm-client/src/types.ts`](packages/crm-client/src/types.ts) |
| `Platform` | `typescript-type` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `Platform` | `typescript-type` | [`packages/scheduler/src/safari-gateway.ts`](packages/scheduler/src/safari-gateway.ts) |
| `Platform` | `typescript-type` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `Platform` | `typescript-type` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `Platform` | `typescript-type` | [`packages/services/src/automation/automation-core.ts`](packages/services/src/automation/automation-core.ts) |
| `Platform` | `typescript-type` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `Platform` | `typescript-type` | [`packages/unified-client/src/index.ts`](packages/unified-client/src/index.ts) |
| `Platform` | `typescript-type` | [`packages/unified-dm/src/types.ts`](packages/unified-dm/src/types.ts) |
| `ProofData` | `typescript-type` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ProofType` | `typescript-type` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `ProposalStatus` | `typescript-type` | [`packages/upwork-hunter/src/types/index.ts`](packages/upwork-hunter/src/types/index.ts) |
| `ProspectStage` | `typescript-type` | [`packages/linkedin-automation/dashboard/src/types.ts`](packages/linkedin-automation/dashboard/src/types.ts) |
| `ProspectStage` | `typescript-type` | [`packages/linkedin-automation/src/automation/outreach-engine.ts`](packages/linkedin-automation/src/automation/outreach-engine.ts) |
| `QueuePriority` | `typescript-type` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `SelectorType` | `typescript-type` | [`packages/selectors/src/types.ts`](packages/selectors/src/types.ts) |
| `SessionInfo` | `typescript-type` | [`packages/tiktok-dm/src/automation/index.ts`](packages/tiktok-dm/src/automation/index.ts) |
| `SessionStatus` | `typescript-type` | [`packages/services/src/session-manager/types.ts`](packages/services/src/session-manager/types.ts) |
| `Severity` | `typescript-type` | [`packages/protocol/src/types.ts`](packages/protocol/src/types.ts) |
| `SoraGenerationStatus` | `typescript-type` | [`packages/services/src/sora/types.ts`](packages/services/src/sora/types.ts) |
| `SourcePlatform` | `typescript-type` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `StylePreset` | `typescript-type` | [`packages/adobe-firefly/src/automation/firefly-driver.ts`](packages/adobe-firefly/src/automation/firefly-driver.ts) |
| `TabType` | `typescript-type` | [`packages/crm-core/src/models/types.ts`](packages/crm-core/src/models/types.ts) |
| `TargetPlatform` | `typescript-type` | [`packages/content-packager/src/types.ts`](packages/content-packager/src/types.ts) |
| `TaskPriority` | `typescript-type` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `TaskPriority` | `typescript-type` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `TaskStatus` | `typescript-type` | [`packages/market-research/src/queue/universal-queue.ts`](packages/market-research/src/queue/universal-queue.ts) |
| `TaskStatus` | `typescript-type` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `TaskStatus` | `typescript-type` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `TaskType` | `typescript-type` | [`packages/scheduler/src/types.ts`](packages/scheduler/src/types.ts) |
| `TaskType` | `typescript-type` | [`packages/services/src/queue-manager/types.ts`](packages/services/src/queue-manager/types.ts) |
| `TelemetryEventType` | `typescript-type` | [`packages/sora-automation/src/automation/types.ts`](packages/sora-automation/src/automation/types.ts) |
| `VerificationStatus` | `typescript-type` | [`packages/services/src/verification/types.ts`](packages/services/src/verification/types.ts) |
| `BrowserCommandSchema` | `zod-schema` | [`packages/unified-control/src/router.ts`](packages/unified-control/src/router.ts) |

## Database contracts

| Object | Kind | Migration/source |
|---|---|---|
| `acq_api_usage` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_daily_caps` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_discovery_runs` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_email_discoveries` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_email_sequences` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_email_unsubscribes` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_entity_associations` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_funnel_events` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_human_notifications` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_message_variants` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_niche_configs` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_outreach_sequences` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_resolution_queue` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_resolution_runs` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_system_state` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_warmup_configs` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_warmup_schedules` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `acq_weekly_reports` | `TABLE` | [`scripts/acquisition/db/migrations/001_acquisition_tables.sql`](scripts/acquisition/db/migrations/001_acquisition_tables.sql) |
| `crm_score_history` | `TABLE` | [`scripts/acquisition/db/migrations/003_score_history.sql`](scripts/acquisition/db/migrations/003_score_history.sql) |
| `safari_commands` | `TABLE` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `safari_events` | `TABLE` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `safari_sessions` | `TABLE` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `safari_videos` | `TABLE` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `watermark_removals` | `TABLE` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `recent_video_summary` | `VIEW` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `safari_command_performance` | `VIEW` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |
| `watermark_free_videos` | `VIEW` | [`supabase/migrations/20260131_safari_automation_tables.sql`](supabase/migrations/20260131_safari_automation_tables.sql) |

## Runtime configuration contract

Only variable names are documented. Values belong in the repository's approved secret/configuration store.

`ACQUISITION_PAUSED`, `ADOBE_FIREFLY_PORT`, `ANTHROPIC_API_KEY`, `API_TOKEN`, `AUTH_TOKEN`, `AUTO_START`, `BLOTATO_API_KEY`, `BROWSER_TYPE`, `CHROME_PATH`, `CHROME_PROFILE`, `CHROME_USER_DATA_DIR`, `COMMENT_ACTIVE_HOURS_END`, `COMMENT_ACTIVE_HOURS_START`, `COMMENT_DAILY_TARGET`, `COMPANY_ADDRESS`, `CONTROL_PORT`, `CRMLITE_API_KEY`, `CRMLITE_KEY`, `CRMLITE_URL`, `CRM_ACTIVE_HOURS_END`, `CRM_ACTIVE_HOURS_START`, `CRM_RATE_MAX_DELAY_MS`, `CRM_RATE_MESSAGES_PER_DAY`, `CRM_RATE_MESSAGES_PER_HOUR`, `CRM_RATE_MIN_DELAY_MS`, `CRM_SUPABASE_ANON_KEY`, `CRM_SUPABASE_URL`, `DATABASE_URL`, `DM_POLL_MS`, `DM_TEST_KEEP_OPEN`, `EMAIL_UNSUB_SECRET`, `ENABLE_ACQUISITION`, `ENABLE_ACTIONS`, `ENABLE_LEARNING`, `FACEBOOK_PORT`, `FIREFLY_DOWNLOADS_DIR`, `FIREFLY_GENERATE_TIMEOUT_MS`, `FIREFLY_GENS_PER_DAY`, `FIREFLY_GENS_PER_HOUR`, `FIREFLY_MIN_DELAY_MS`, `FROM_EMAIL`, `GATEWAY_PORT`, `GATEWAY_URL`, `HOME`, `HQ_OUTPUT_DIR`, `HQ_UPSCALED_DIR`, `IMAP_HOST`, `IMAP_PASS`, `IMAP_USER`, `INSTAGRAM_API_TOKEN`, `INSTAGRAM_BOT_PASSWORD`, `INSTAGRAM_BOT_USERNAME`, `INSTAGRAM_COMMENTS_PORT`, `INSTAGRAM_COMMENTS_URL`, `INSTAGRAM_DM_PORT`, `INSTAGRAM_TIMEOUT_MS`, `LINKEDIN_AUTH_TOKEN`, `LINKEDIN_PORT`, `LOCAL_ONLY`, `LOG_LEVEL`, `MARKET_RESEARCH_URL`, `MAX_DAILY_OUTREACH`, `MEDIAPOSTER_URL`, `MEDIAPOSTER_WEBHOOK_URL`, `MEDIUM_PORT`, `MODAL_APP_NAME`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `MODAL_WORKSPACE`, `NODE_ENV`, `NOTIF_POLL_MS`, `NO_AUTO_START`, `OPENAI_API_KEY`, `OUR_INSTAGRAM_HANDLE`, `OWNER_EMAIL`, `PATH`, `PERPLEXITY_API_KEY`, `PORT`, `PUPPETEER_HEADLESS`, `RATE_LIMIT_MAX`, `RENDER`, `REPLICATE_API_TOKEN`, `REPLY_POLL_INTERVAL_MS`, `REQUIRE_AUTH`, `RESEARCH_API_KEY`, `RESEARCH_PORT`, `RESEND_API_KEY`, `SAFARI_API_URL`, `SAFARI_AUTH_TOKEN`, `SAFARI_AUTOMATION_WINDOW`, `SAFARI_AUTO_START`, `SAFARI_CHECKBACKS_ENABLED`, `SAFARI_CONTROLLER_PORT`, `SAFARI_CONTROLLER_URL`, `SAFARI_CONTROL_URL`, `SAFARI_GATEWAY_URL`, `SAFARI_RESEARCH_ENABLED`, `SAFARI_TELEMETRY_URL`, `SCHEDULER_PORT`, `SESSION_HEALTH_INTERVAL_MS`, `SORA_PORT`, `STATS_POLL_MS`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYNC_PLATFORMS`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEMETRY_PORT`, `THREADS_AUTH_TOKEN`, `THREADS_COMMENTS_PORT`, `TIKTOK_API_URL`, `TIKTOK_AUTH_TOKEN`, `TIKTOK_CDP_URL`, `TIKTOK_COMMENTS_PORT`, `TIKTOK_DM_PORT`, `TIKTOK_PASSWORD`, `TIKTOK_USERNAME`, `TWITTER_AUTH_TOKEN`, `TWITTER_COMMENTS_PORT`, `TWITTER_DM_PORT`, `UNIFIED_CONTROL_PORT`, `UPWORK_AUTOMATION_URL`, `UPWORK_EMAIL`, `UPWORK_KEYWORDS_FILE`, `UPWORK_PASSWORD`, `UPWORK_PORT`, `VERBOSE`, `VERCEL`, `WATERMARK_CLEANER_PATH`, `YOUTUBE_ACCOUNT_ID`, `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`

## Validation and drift

```bash
python3 scripts/generate_agent_service_contracts.py --check
```

Regenerate this document after changing routes, schemas, typed models, migrations, package scripts, or runtime configuration names:

```bash
python3 scripts/generate_agent_service_contracts.py
```

The generator reads repository source only. It does not call providers, start services, execute routes, read credential values, publish content, or spend money.
