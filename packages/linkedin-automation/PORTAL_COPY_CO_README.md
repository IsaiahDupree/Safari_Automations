# Portal Copy Co LinkedIn Outreach System

Complete LinkedIn automation system for Sarah E. Ashley's Portal Copy Co business.

## Quick Start

### 1. Health Check
```bash
curl http://localhost:3105/health
```

If not running:
```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation"
PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts &
```

### 2. Create Campaign
```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation"
npx tsx /tmp/portal-campaign.ts
```

Campaign ID will be displayed (e.g., `camp_1772923115000_6u059d`)

### 3. Run Prospecting Pipeline
```bash
npx tsx /tmp/portal-prospect.ts
```

This will:
- Search LinkedIn for Florida coaches/founders/consultants
- Score prospects (1-100)
- Send connection requests to qualified prospects

### 4. Run Outreach Cycle
```bash
npx tsx /tmp/portal-outreach.ts
```

This will:
- Discover new prospects from the campaign
- Send connection requests
- Check pending connections
- Send first DMs to new connections
- Send follow-ups based on timing rules

### 5. Launch Dashboard
```bash
cd packages/linkedin-automation/dashboard

# Start API server (port 4001)
npm run server &

# Start frontend (port 4000)
npm run dev
```

Open http://localhost:4000 to view the dashboard.

### 6. Sync to Supabase CRM
```bash
# Set environment variable
export SUPABASE_ANON_KEY="your_key_here"  # Get from https://supabase.com/dashboard/project/ivhfuhxorppptyuofbgq/settings/api

# Run sync
cd packages/linkedin-automation/dashboard
npx tsx sync-to-crm.ts
```

## Campaign Configuration

**Business**: Portal Copy Co - Story-driven copywriting  
**ICP**: Coaches, founders, consultants, e-commerce owners (priority: Florida)

**Message Templates**:
- Connection note: 191 chars, introduces Sarah and value prop
- First DM: Asks about their biggest communication challenge
- Follow-up 1 (day 5): Offer to share copy ideas
- Follow-up 2 (day 12): Free brand voice checklist
- Follow-up 3 (day 21): Final reach with website link

**Timing**:
- First DM: 24 hours after connection accepted
- Follow-up 1: 5 days after first DM
- Follow-up 2: 12 days after first DM
- Follow-up 3: 21 days after first DM
- Give up: 30 days after first DM

**Scoring** (1-10):
- Relevance (0-3): Title/industry match
- Personalization (0-3): Location/company match
- CTA clarity (0-2): Clear next step
- Tone (0-2): Professional yet approachable

## Dashboard Features

✓ All prospects with stages (discovered → connection_sent → connected → first_dm_sent → replied → converted)  
✓ Message score 1-10 per prospect  
✓ Days until next follow-up action  
✓ Stats panel: connection rate / reply rate / conversion rate  
✓ Filter by stage, score, location  
✓ Run outreach cycle button  

## Data Storage

**Local**: `~/.linkedin-outreach/`
- `campaigns.json` - Campaign configurations
- `prospects.json` - All discovered prospects
- `runs.json` - Execution history

**Supabase CRM**: `ivhfuhxorppptyuofbgq`
- `crm_contacts` - Contact records
- `crm_conversations` - Message threads
- `crm_message_queue` - Scheduled follow-ups

## Architecture

```
┌─────────────────────────────────────────────┐
│  LinkedIn Automation Server (:3105)         │
│  - Safari browser automation                │
│  - Search, connect, DM operations           │
│  - Rate limiting & active hours             │
└─────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  Outreach Engine                            │
│  - Campaign management                      │
│  - Prospect scoring                         │
│  - Message sequencing                       │
│  - Follow-up scheduling                     │
└─────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  Local Storage (~/.linkedin-outreach/)      │
│  - prospects.json                           │
│  - campaigns.json                           │
│  - runs.json                                │
└─────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  Dashboard                                  │
│  - React frontend (:4000)                   │
│  - Express API (:4001)                      │
│  - Stats & filtering                        │
└─────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────┐
│  Supabase CRM Sync                          │
│  - Contact enrichment                       │
│  - Conversation tracking                    │
│  - Follow-up scheduling                     │
└─────────────────────────────────────────────┘
```

## Files Created

| File | Purpose |
|------|---------|
| `/tmp/portal-campaign.ts` | Campaign creation script |
| `/tmp/portal-prospect.ts` | Prospecting pipeline script |
| `/tmp/portal-outreach.ts` | Outreach cycle script |
| `packages/linkedin-automation/dashboard/` | React dashboard |
| `packages/linkedin-automation/dashboard/server.js` | API proxy server |
| `packages/linkedin-automation/dashboard/sync-to-crm.ts` | Supabase sync script |

## Next Steps

1. Run the prospecting pipeline daily to discover new prospects
2. Run the outreach cycle 2-3x per day to send DMs and follow-ups
3. Monitor the dashboard for replies and engagement
4. Sync to Supabase CRM regularly for cross-platform tracking
5. Adjust campaign targeting based on connection/reply rates

## Support

For issues or questions, check:
- LinkedIn automation logs: Service logs on port 3105
- Dashboard API logs: `/tmp/dashboard-server.log`
- Browser automation: Safari window activity

Campaign ID: `camp_1772923115000_6u059d` (with keywords as array - use this one!)
