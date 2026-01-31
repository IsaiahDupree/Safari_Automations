# @safari-automation/crm-core

Modular, platform-agnostic CRM library for relationship-first sales. Can be deployed to any server with any database backend.

## Installation

```bash
npm install @safari-automation/crm-core
# or
pnpm add @safari-automation/crm-core
```

## Quick Start

```typescript
import { 
  initializeCRMClient,
  calculateRelationshipScore,
  generateReplySuggestions,
  analyzeConversation,
  loadConfigFromEnv,
} from '@safari-automation/crm-core';

// 1. Load config from environment
const config = loadConfigFromEnv(process.env);

// 2. Initialize client
initializeCRMClient({
  supabaseUrl: config.supabase.url,
  supabaseKey: config.supabase.anonKey,
});

// 3. Use engines
const score = calculateRelationshipScore({ contact, messages });
const suggestions = generateReplySuggestions({ contact, messages, templates });
const coaching = analyzeConversation({ messages, rules });
```

## Modules

### Client (`/client`)

Manages database connections. Currently supports Supabase.

```typescript
import { initializeCRMClient, getCRMClient } from '@safari-automation/crm-core/client';

initializeCRMClient({ supabaseUrl: '...', supabaseKey: '...' });
const client = getCRMClient();
```

### Models (`/models`)

TypeScript interfaces and types for all CRM entities.

```typescript
import type { Contact, Message, PipelineStage } from '@safari-automation/crm-core/models';
```

### Engines (`/engines`)

Pure functions for scoring, coaching, and reply generation.

#### Scoring Engine
```typescript
import { calculateRelationshipScore, determineActionLane } from '@safari-automation/crm-core/engines';

const score = calculateRelationshipScore({
  contact,
  messages,
  valueDeliveredCount: 2,
});
// Returns: { overall: 65, recency: 85, resonance: 70, ... }

const lane = determineActionLane(contact);
// Returns: 'friendship' | 'service' | 'offer' | 'retention' | 'rewarm'
```

#### Coaching Engine
```typescript
import { analyzeConversation, getDefaultCoachingRules } from '@safari-automation/crm-core/engines';

const result = analyzeConversation({
  messages,
  rules: getDefaultCoachingRules(),
});
// Returns: { overallScore, strengths, improvements, nextActionSuggestion }
```

#### Copilot Engine
```typescript
import { generateReplySuggestions, getDefaultTemplates } from '@safari-automation/crm-core/engines';

const suggestions = generateReplySuggestions({
  contact,
  messages,
  templates: getDefaultTemplates(),
});
// Returns: [{ type, template, personalized, reason, priority }]
```

### Utils (`/utils`)

Configuration and environment utilities.

```typescript
import { loadConfigFromEnv, setConfig, validateConfig } from '@safari-automation/crm-core/utils';

const config = loadConfigFromEnv(process.env);
const { valid, errors } = validateConfig(config);
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SUPABASE_URL` | Supabase project URL | Required |
| `SUPABASE_ANON_KEY` | Supabase anon key | Required |
| `SUPABASE_SERVICE_KEY` | Supabase service key | Optional |
| `CRM_RATE_MESSAGES_PER_HOUR` | Max messages per hour | 10 |
| `CRM_RATE_MESSAGES_PER_DAY` | Max messages per day | 30 |
| `CRM_RATE_MIN_DELAY_MS` | Min delay between messages | 60000 |
| `CRM_RATE_MAX_DELAY_MS` | Max delay between messages | 300000 |
| `CRM_ACTIVE_HOURS_START` | Active hours start (24h) | 9 |
| `CRM_ACTIVE_HOURS_END` | Active hours end (24h) | 21 |
| `CRM_SCORE_WEIGHT_RECENCY` | Recency weight | 0.20 |
| `CRM_SCORE_WEIGHT_RESONANCE` | Resonance weight | 0.20 |
| `CRM_SCORE_WEIGHT_NEED_CLARITY` | Need clarity weight | 0.15 |
| `CRM_SCORE_WEIGHT_VALUE` | Value delivered weight | 0.20 |
| `CRM_SCORE_WEIGHT_RELIABILITY` | Reliability weight | 0.15 |
| `CRM_SCORE_WEIGHT_CONSENT` | Consent weight | 0.10 |

## Deploying to Another Server

1. **Copy the package:**
   ```bash
   cp -r packages/crm-core /path/to/new-server/
   ```

2. **Install dependencies:**
   ```bash
   cd /path/to/new-server/crm-core
   npm install
   ```

3. **Set environment variables:**
   ```bash
   export SUPABASE_URL=https://your-project.supabase.co
   export SUPABASE_ANON_KEY=your-key
   ```

4. **Import and use:**
   ```typescript
   import { initializeCRMClient, calculateRelationshipScore } from './crm-core';
   ```

## Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

## Building

```bash
npm run build      # Compile TypeScript to dist/
```

## Architecture

```
crm-core/
├── src/
│   ├── client/           # Database client (Supabase)
│   │   └── supabase-client.ts
│   ├── models/           # TypeScript types
│   │   └── types.ts
│   ├── engines/          # Pure business logic
│   │   ├── scoring-engine.ts
│   │   ├── coaching-engine.ts
│   │   └── copilot-engine.ts
│   ├── utils/            # Configuration
│   │   └── config.ts
│   └── index.ts          # Main exports
├── tests/
│   ├── scoring-engine.test.ts
│   ├── coaching-engine.test.ts
│   └── copilot-engine.test.ts
├── package.json
└── tsconfig.json
```

## Key Design Principles

1. **Pure Functions:** Engines use pure functions for testability
2. **Platform Agnostic:** Works with any server/framework
3. **Type Safe:** Full TypeScript support
4. **Configurable:** All settings via environment or code
5. **Testable:** 100% test coverage on core logic
