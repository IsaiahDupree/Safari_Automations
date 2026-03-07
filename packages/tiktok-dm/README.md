# TikTok DM Automation

Safari-based browser automation for TikTok DM management, profile scraping, and prospect discovery.

## Features

- **Profile Scraping**: Extract TikTok profile data (followers, bio, engagement)
- **DM Operations**: Send and manage direct messages
- **Prospect Discovery**: Find and score potential leads via hashtag searches
- **ICP Scoring**: Built-in scoring system for B2B SaaS founders/indie hackers
- **Rate Limiting**: Configurable daily limits and active hours
- **CRMLite Integration**: Auto-sync DM conversations to CRM

## Installation

```bash
cd packages/tiktok-dm
npm install
```

## Setup

1. Ensure Safari is running and logged into TikTok
2. Copy `.env.example` to `.env` and configure:
   ```
   SUPABASE_URL=https://ivhfuhxorppptyuofbgq.supabase.co
   SUPABASE_KEY=your_supabase_key
   CRMLITE_API_KEY=your_crmlite_key
   SAFARI_AUTOMATION_WINDOW=1
   ```

## Usage

### Start the REST API Server

```bash
npm run start:server
# Server runs on http://localhost:3102
```

### Run Tests

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Build

```bash
npm run build         # Compile TypeScript
```

## API Endpoints

### Health & Session

- `GET /health` - Service health check
- `GET /api/status` - Current Safari session status (isOnTikTok, isLoggedIn, currentUrl)
- `POST /api/inbox/navigate` - Navigate to TikTok messages
- `POST /api/session/clear` - Reset tracked Safari tab

### Profile & Discovery

- `GET /api/profile/:username` - Get TikTok profile data
- `GET /api/search?q=:query&type=users` - Search TikTok users

### DM Operations

- `GET /api/conversations` - List DM conversations
- `POST /api/conversations/open` - Open a conversation by username
- `GET /api/messages?limit=N` - Read messages from current conversation
- `POST /api/messages/send-to` - Send a DM (body: `{ username, text, dryRun? }`)

### Prospect Discovery

- `POST /api/prospect/discover` - Find prospects by hashtags (body: `{ hashtags, minFollowers?, maxFollowers?, maxCandidates? }`)
- `GET /api/prospect/score/:username` - Get ICP score for a profile

## ICP Scoring

Scoring criteria for B2B SaaS founders / indie hackers:

- **Follower Range**: 1K–50K (+25), 50K–500K (+15)
- **Bio Keywords**: 'founder', 'saas', 'build', 'software', 'ai', 'startup', 'indie', 'developer' (+15 each, max 45)
- **Engagement Ratio**: likes/followers > 0.1 (+20)
- **Not Verified**: +5

**Qualification Threshold**: Score ≥ 50

## Rate Limiting

- **Daily Limit**: 20 DMs/day
- **Active Hours**: 9am–9pm local time
- **Min Delay**: 30s between DMs

## Architecture

```
src/
├── api/
│   ├── server.ts              # Express REST API
│   └── tiktok-operations.ts   # TikTok DOM operations
├── automation/
│   └── safari-driver.ts       # Safari/AppleScript driver
├── utils/
│   ├── rate-limiter.ts        # Rate limiting logic
│   └── icp-scoring.ts         # ICP scoring algorithm
├── types/
│   └── index.ts               # TypeScript interfaces
└── lib/
    └── supabase.ts            # Supabase client
```

## Example Usage

### Get Profile

```bash
curl http://localhost:3102/api/profile/charlidamelio
```

### Send DM (Dry Run)

```bash
curl -X POST http://localhost:3102/api/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "text": "Hi!", "dryRun": true}'
```

### Discover Prospects

```bash
curl -X POST http://localhost:3102/api/prospect/discover \
  -H "Content-Type: application/json" \
  -d '{"hashtags": ["buildinpublic", "indiehacker"], "maxCandidates": 10}'
```

## Testing

4-layer test suite:

- **Layer 1**: Service health (`/health`, `/api/status`)
- **Layer 2**: Profile API (known public accounts)
- **Layer 3**: Prospect discovery (Safari required)
- **Layer 4**: DM dry-run (Safari required)

## Dependencies

- **express**: REST API server
- **@supabase/supabase-js**: Database client
- **dotenv**: Environment configuration
- **TypeScript**: Type safety
- **vitest**: Test runner

## License

MIT
