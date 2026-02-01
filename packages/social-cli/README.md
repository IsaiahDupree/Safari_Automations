# @safari-automation/social-cli

Unified command-line interface for social automation - multi-platform DM management.

## Installation

```bash
npm install -g @safari-automation/social-cli
```

Or run directly with npx:

```bash
npx @safari-automation/social-cli status
```

## Commands

### Check Status

```bash
# All platforms
social-auto status

# Specific platform
social-auto status --platform instagram
social-auto status --platform twitter
```

Output:
```
📊 Social Automation Status

   API: http://localhost:3100

📸 Instagram
   API: ✅ Healthy
   Status: ✅ Online
   URL: https://www.instagram.com/direct/inbox/

🐦 Twitter
   API: ✅ Healthy
   Status: ✅ Online
   URL: https://x.com/messages
```

### Send DM

```bash
# Send to Instagram
social-auto dm instagram username "Hello from CLI!"

# Send to Twitter
social-auto dm twitter username "Hello from CLI!"

# Dry run (preview without sending)
social-auto dm twitter username "Test message" --dry-run
```

### List Conversations

```bash
# All platforms
social-auto conversations

# Specific platform
social-auto convos --platform instagram

# Limit results
social-auto convos --limit 5
```

### Check Rate Limits

```bash
social-auto rate-limits
# or
social-auto limits
```

Output:
```
📊 Rate Limits

📸 Instagram
   Active: ✅ Yes
   Hourly: ████░░░░░░ 4/10 (40%)
   Daily:  ██░░░░░░░░ 8/30 (27%)

🐦 Twitter
   Active: ✅ Yes
   Hourly: ██░░░░░░░░ 3/15 (20%)
   Daily:  █░░░░░░░░░ 12/100 (12%)

📈 Combined
   Total today: 20
   Total this hour: 7
```

### Navigate to Inbox

```bash
social-auto navigate instagram
social-auto nav twitter
```

### Health Check

```bash
social-auto health
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SAFARI_API_URL` | Base Safari automation API URL | `http://localhost:3100` |

## Examples

### Daily Outreach Script

```bash
#!/bin/bash

# Check if APIs are healthy
social-auto health || exit 1

# Check rate limits
social-auto limits

# Send messages
social-auto dm instagram user1 "Hey! Just saw your latest post 🔥"
sleep 120  # Wait 2 minutes

social-auto dm twitter user2 "Love your work! Would love to connect."
sleep 120

social-auto dm instagram user3 "Quick question about your recent project..."
```

### Integration with Other Tools

```bash
# Pipe from a file
while IFS=, read -r platform username message; do
  social-auto dm "$platform" "$username" "$message"
  sleep 90
done < contacts.csv

# Check status in CI/CD
social-auto health && echo "All systems go!"
```

## Development

```bash
# Run directly with tsx
npx tsx packages/social-cli/src/cli.ts status

# Build
npm run build

# Link globally for testing
npm link
```

## Architecture

```
social-cli/
├── src/
│   └── cli.ts    # Main CLI entry point
├── dist/         # Compiled output
└── package.json
```

The CLI uses:
- `commander` for argument parsing
- `@safari-automation/unified-client` for platform communication
