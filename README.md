# Local EverReach CRM

A standalone, relationship-first CRM system with Instagram DM automation. Inspired by EverReach, built for local deployment.

## Features

- **Relationship Scoring** - Track and score relationships using the 6R framework
- **DM Coaching** - Real-time feedback on your messaging style
- **AI Copilot** - Personalized reply suggestions based on context
- **Instagram Automation** - Safari-based DM reading/sending via REST API
- **Pipeline Analytics** - Visualize your sales pipeline health
- **Automated Outreach** - Human-paced message scheduling

## Quick Start

```bash
# 1. Install dependencies
npm install
cd packages/crm-core && npm install
cd ../instagram-dm && npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Supabase credentials

# 3. Run tests
npm test

# 4. Start using
npm run scoring      # Calculate relationship scores
npm run coaching     # Analyze your messaging
npm run analytics    # View pipeline stats
```

## Project Structure

```
Local EverReach CRM/
├── packages/
│   ├── crm-core/           # Core CRM library (100 tests)
│   │   ├── src/engines/    # Scoring, coaching, copilot
│   │   ├── src/models/     # TypeScript types
│   │   └── src/client/     # Supabase client
│   │
│   └── instagram-dm/       # Instagram automation (35 tests)
│       ├── src/automation/ # Safari driver, DM operations
│       └── src/api/        # REST API server + client
│
├── scripts/                # Standalone CLI tools
│   ├── relationship-scoring-engine.ts
│   ├── dm-coaching-engine.ts
│   ├── ai-copilot-replies.ts
│   ├── pipeline-analytics.ts
│   ├── automated-outreach.ts
│   ├── sync-instagram-dm-to-crm.ts
│   └── instagram-dm-cli.ts
│
├── docs/                   # Documentation
│   └── RELATIONSHIP_FIRST_CRM_FRAMEWORK.md
│
└── config/                 # Configuration files
```

## Modules

### CRM Core (`packages/crm-core`)

Pure TypeScript library with no side effects. Can be imported into any project.

```typescript
import { 
  calculateRelationshipScore,
  analyzeConversation,
  generateReplySuggestions,
} from './packages/crm-core/src';

// Score a relationship
const score = calculateRelationshipScore({ contact, messages });
// { overall: 72, recency: 85, resonance: 70, ... }

// Get coaching feedback
const coaching = analyzeConversation({ messages, rules });
// { overallScore: 78, strengths: [...], improvements: [...] }

// Generate reply suggestions
const suggestions = generateReplySuggestions({ contact, messages, templates });
// [{ type: 'service', personalized: "How's the project going?", ... }]
```

### Instagram DM (`packages/instagram-dm`)

Safari automation for Instagram DMs. Run the API server on macOS, call from anywhere.

```bash
# Start API server
npm run start:dm-server
```

```typescript
import { createDMClient } from './packages/instagram-dm/src';

const dm = createDMClient('http://localhost:3100');

// Send message
await dm.sendMessageTo('username', 'Hello!');

// List conversations
const convos = await dm.listConversations();

// Check rate limits
const limits = await dm.getRateLimits();
```

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| Scoring | `npm run scoring` | Calculate relationship health scores |
| Coaching | `npm run coaching` | Analyze conversation quality |
| Copilot | `npm run copilot` | Generate reply suggestions |
| Analytics | `npm run analytics` | Pipeline dashboard |
| Outreach | `npm run outreach` | Automated message queue |
| Sync | `npm run sync` | Sync Instagram DMs to Supabase |
| DM CLI | `npm run dm` | Interactive DM commands |

## The Relationship-First Framework

This CRM is built on the principle that **relationships drive revenue**.

### 6R Scoring Model

| Metric | Weight | Description |
|--------|--------|-------------|
| Recency | 20% | Days since last interaction |
| Resonance | 20% | Message depth & engagement |
| Need Clarity | 15% | How well you understand their needs |
| Value Delivered | 20% | Help given without asking |
| Reliability | 15% | Promises kept vs made |
| Consent | 10% | Trust signals (asks opinion, refers others) |

### Pipeline Stages

1. **First Touch** - Initial connection
2. **Curiosity Exchange** - Learning about each other
3. **Value Given** - You've helped them
4. **Fit Revealed** - Need matches your offer
5. **Fit Repeats** - Multiple signals of fit
6. **Active Opportunity** - Discussing working together
7. **Post-Win Expansion** - Happy customer

### Action Lanes

- **Friendship** - Build genuine connection
- **Service** - Help without expectation
- **Offer** - Appropriate time to propose
- **Retention** - Keep customers happy
- **Rewarm** - Re-engage cold contacts

## Database Schema

Uses Supabase with these core tables:

- `instagram_contacts` - Contact profiles and scores
- `instagram_conversations` - DM threads
- `instagram_messages` - Individual messages
- `coaching_rules` - Custom coaching rules
- `action_templates` - Reply templates

See `docs/RELATIONSHIP_FIRST_CRM_FRAMEWORK.md` for full schema.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `CRM_RATE_MESSAGES_PER_HOUR` | No | Rate limit (default: 10) |
| `CRM_RATE_MESSAGES_PER_DAY` | No | Daily limit (default: 30) |
| `CRM_ACTIVE_HOURS_START` | No | Start hour (default: 9) |
| `CRM_ACTIVE_HOURS_END` | No | End hour (default: 21) |

## Development

```bash
# Run all tests
npm test

# Run specific package tests
npm run test:core
npm run test:dm

# Build packages
npm run build
```

## Deployment Options

### Local (macOS)
Run directly on your Mac with Safari for Instagram automation.

### Remote Server
Deploy the CRM logic to any Node.js server. Keep the DM API on a Mac.

```typescript
// On your server
import { createDMClient } from '@safari-automation/instagram-dm';
const dm = createDMClient('http://your-mac:3100');
```

### Connecting to EverReach
This local CRM is designed to sync with the cloud EverReach platform when ready.

## License

MIT
