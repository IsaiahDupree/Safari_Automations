# Quick Start Guide

Get Local EverReach CRM running in 5 minutes.

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **macOS** - Required for Safari automation
- **Safari** - With Instagram logged in
- **Supabase Account** - [Sign up free](https://supabase.com/)

## Step 1: Install Dependencies

```bash
cd "Local EverReach CRM"

# Install root dependencies
npm install

# Install package dependencies
cd packages/crm-core && npm install && cd ../..
cd packages/instagram-dm && npm install && cd ../..
```

## Step 2: Set Up Supabase

1. Create a new Supabase project
2. Run this SQL to create tables:

```sql
-- Contacts table
CREATE TABLE instagram_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  relationship_score INTEGER DEFAULT 50,
  pipeline_stage TEXT DEFAULT 'first_touch',
  what_theyre_building TEXT,
  current_friction TEXT,
  their_definition_of_win TEXT,
  asks_opinion BOOLEAN DEFAULT FALSE,
  shares_updates BOOLEAN DEFAULT FALSE,
  has_referred_others BOOLEAN DEFAULT FALSE,
  fit_signals TEXT[] DEFAULT '{}',
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations table
CREATE TABLE instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES instagram_contacts(id),
  thread_id TEXT,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES instagram_conversations(id),
  contact_id UUID REFERENCES instagram_contacts(id),
  message_text TEXT,
  message_type TEXT DEFAULT 'text',
  is_outbound BOOLEAN DEFAULT FALSE,
  sent_by_automation BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contacts_username ON instagram_contacts(instagram_username);
CREATE INDEX idx_contacts_score ON instagram_contacts(relationship_score);
CREATE INDEX idx_messages_contact ON instagram_messages(contact_id);
CREATE INDEX idx_messages_sent_at ON instagram_messages(sent_at);
```

3. Copy your project URL and anon key from Settings > API

## Step 3: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Step 4: Run Tests

```bash
npm test
```

Expected output:
```
✓ crm-core: 100 tests passed
✓ instagram-dm: 35 tests passed
```

## Step 5: Try It Out

### Calculate Scores
```bash
npm run scoring
```

### Start DM Server
```bash
npm run start:dm-server
```

### Send a Test Request
```bash
curl http://localhost:3100/health
# {"status":"ok","timestamp":"..."}
```

## Common Commands

| What you want | Command |
|---------------|---------|
| Score relationships | `npm run scoring` |
| Get coaching feedback | `npm run coaching` |
| View analytics | `npm run analytics` |
| Start DM API | `npm run start:dm-server` |
| Sync DMs to database | `npm run sync` |
| Interactive DM CLI | `npm run dm` |

## Next Steps

1. **Read the Framework** - `docs/RELATIONSHIP_FIRST_CRM_FRAMEWORK.md`
2. **Customize Templates** - Edit `packages/crm-core/src/engines/copilot-engine.ts`
3. **Add Coaching Rules** - Edit `packages/crm-core/src/engines/coaching-engine.ts`
4. **Connect to Frontend** - Use the API client from any app

## Troubleshooting

### "Not logged in to Instagram"
- Open Safari and go to instagram.com
- Log in manually
- Keep Safari open in the foreground

### "Rate limit exceeded"
- Wait for the next hour/day
- Check limits: `curl http://localhost:3100/api/rate-limits`

### "Connection refused"
- Make sure DM server is running: `npm run start:dm-server`
- Check the port (default: 3100)

## Support

- Check existing docs in `/docs`
- Review test files for usage examples
- Open an issue on GitHub
