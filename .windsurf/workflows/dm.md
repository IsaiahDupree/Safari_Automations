---
description: Manage DM automation across TikTok, Instagram, and Twitter
---

## Check DM API health
// turbo
```bash
npx tsx packages/unified-dm/src/cli.ts health
```

## Check platform status
// turbo
```bash
npx tsx packages/unified-dm/src/cli.ts status
```

## List conversations
// turbo
```bash
npx tsx packages/unified-dm/src/cli.ts list
```

## List conversations for specific platform
```bash
npx tsx packages/unified-dm/src/cli.ts list tiktok
npx tsx packages/unified-dm/src/cli.ts list instagram
npx tsx packages/unified-dm/src/cli.ts list twitter
```

## Send a DM
```bash
npx tsx packages/unified-dm/src/cli.ts send <platform> @<username> "message"
```

## Start DM API servers

### TikTok (port 3002)
```bash
npx tsx packages/tiktok-dm/src/api/server.ts
```

### Instagram (port 3001)
```bash
npx tsx packages/instagram-dm/src/api/server.ts
```

### Twitter (port 3003)
```bash
npx tsx packages/twitter-dm/src/api/server.ts
```
