# Safari Social Automation

Safari-driven UI automation harness + platform adapters + selector contract tests + audit logging for strategic social media engagement.

## What This Repo Does

- **Safari Browser Automation**: Native Safari WebDriver-based automation for macOS
- **Platform Adapters**: Instagram, TikTok, Threads, Twitter/X support
- **Selector Contract Testing**: Extensive, versioned selectors with fallbacks and self-check tests
- **Engagement Tracking**: Extract and store post stats, engagement metrics, author data
- **Strategic Actions**: Like, comment, DM capabilities with verification
- **Deduplication**: Never duplicate comments, track all interactions
- **Audit Logging**: Full traceability of every action attempt

## What This Repo Does NOT Do

- ❌ **No spam** - Rate-limited, human-approved engagement only
- ❌ **No growth-hacking bypasses** - Respects platform integrity
- ❌ **No captcha solving** - Human intervention required
- ❌ **No account compromise** - Your authorized accounts only
- ❌ **No Terms of Service violations** - Responsible automation

## Supported Environments

| Environment | Support Level | Notes |
|-------------|---------------|-------|
| macOS + Safari WebDriver | ✅ Primary | Full feature support via `safaridriver` |
| Playwright WebKit | 🔶 CI/Testing | Engine-level coverage, not true Safari |

## Quickstart

### 1. Enable Safari WebDriver

```bash
# Enable Safari's WebDriver support (one-time)
safaridriver --enable

# Verify it's working
safaridriver --version
```

### 2. Allow Remote Automation

1. Open Safari → Preferences → Advanced
2. Enable "Show Develop menu in menu bar"
3. Develop menu → Allow Remote Automation

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Smoke Tests

```bash
# Verify Safari automation is working
npm run test:smoke

# Run selector contract tests
npm run test:selectors

# Run platform-specific tests
npm run test:platform -- --platform=instagram
```

### 5. Supervise Cross-Platform Research

The user LaunchAgent runs the compiled five-platform market-research service from private Application Support, independently of the source checkout and terminal sessions. Its installer copies the existing research archive into the same non-Documents runtime so collection continues while the Mac is locked.

```bash
./scripts/install-market-research-launchd.sh
launchctl print gui/$(id -u)/com.isaiah.safari-automation.market-research
curl -fsS http://127.0.0.1:3106/health
```

Cross-platform public research is coordinated through `POST /api/research/all/full`. X reads remain explicitly gated by `SAFARI_RESEARCH_ENABLED=true`; set it only in the private `.env`, never in committed source.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Runner / CLI                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │Instagram │  │ TikTok   │  │ Threads  │  │Twitter/X │        │
│  │ Adapter  │  │ Adapter  │  │ Adapter  │  │ Adapter  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       └─────────────┴─────────────┴─────────────┘               │
│                           │                                      │
│  ┌────────────────────────┴────────────────────────┐            │
│  │              Selector Registry                   │            │
│  │    (versioned selectors + fallbacks + tests)    │            │
│  └────────────────────────┬────────────────────────┘            │
│                           │                                      │
│  ┌────────────────────────┴────────────────────────┐            │
│  │              Action Engine                       │            │
│  │   (LikePost, CommentPost, SendDM, Verify)       │            │
│  └────────────────────────┬────────────────────────┘            │
│                           │                                      │
│  ┌────────────────────────┴────────────────────────┐            │
│  │           Dedupe + Policy Engine                 │            │
│  │  (rate limits, cooldowns, duplicate prevention) │            │
│  └────────────────────────┬────────────────────────┘            │
│                           │                                      │
├───────────────────────────┼─────────────────────────────────────┤
│  ┌──────────────┐  ┌──────┴───────┐  ┌──────────────┐          │
│  │   Browser    │  │  Persistence │  │ Observability│          │
│  │    Layer     │  │    Layer     │  │    Layer     │          │
│  │  (Safari)    │  │ (Database)   │  │(Logs/Traces) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Test Matrix

| Test Type | Purpose | Frequency |
|-----------|---------|-----------|
| Unit Tests | Parsers, dedupe keys, policy rules | Every commit |
| Selector Contract Tests | Validate selectors still resolve | Nightly + on-demand |
| Flow Integration Tests | End-to-end platform workflows | PR + nightly |
| Regression Suites | Platform-specific feature coverage | Weekly |
| Audit Verification Tests | Prove action traceability | On-demand |

## Data Model Overview

| Entity | Description |
|--------|-------------|
| `Account` | Your authorized social media accounts |
| `PlatformUser` | Users discovered on platforms |
| `Post` | Posts with extracted stats and metadata |
| `Comment` | Comments made by you or discovered |
| `DMThread` | Direct message conversations |
| `DMMessage` | Individual DM messages |
| `ActionAttempt` | Every action attempt with outcome |
| `VerificationResult` | Post-action verification records |

## Responsible Use

⚠️ **This tool is for automation of accounts you own and control.**

- **Rate Limiting**: Built-in cooldowns and quiet hours
- **Human Approval**: DMs require human approval by default
- **Blocklists**: Configurable "never contact" lists
- **Audit Logs**: Every action is logged and traceable
- **No Captcha Solving**: Captchas trigger human intervention

See [docs/01-compliance-and-safety.md](docs/01-compliance-and-safety.md) for full details.

## Roadmap

### Phase 1: Foundation
- [ ] Safari WebDriver integration
- [ ] Selector registry system
- [ ] Database schema + migrations
- [ ] Basic observability

### Phase 2: Platform Adapters
- [ ] Instagram adapter (feed, post, comment, DM)
- [ ] TikTok adapter (feed, post, comment)
- [ ] Threads adapter (feed, post, comment)
- [ ] Twitter/X adapter (feed, post, comment, DM)

### Phase 3: Intelligence
- [ ] Engagement analytics
- [ ] Strategic engagement rules
- [ ] Duplicate prevention
- [ ] Action verification

### Phase 4: Operations
- [ ] CI/CD pipeline
- [ ] Monitoring + alerting
- [ ] Runbooks + incident response

## Documentation

- [Vision & Goals](docs/00-vision.md)
- [Compliance & Safety](docs/01-compliance-and-safety.md)
- [Safari WebDriver Setup](docs/02-setup-safari-webdriver.md)
- [Architecture](docs/03-architecture.md)
- [Selector System](docs/04-selector-system.md)
- [Test Strategy](docs/05-test-strategy.md)
- [Data Model](docs/06-data-model.md)
- [Observability](docs/07-observability.md)
- [CI/CD](docs/08-ci-cd.md)

### Platform Guides
- [Instagram](docs/platforms/instagram.md)
- [TikTok](docs/platforms/tiktok.md)
- [Threads](docs/platforms/threads.md)
- [Twitter/X](docs/platforms/twitter-x.md)

### Runbooks
- [Account Health](docs/runbooks/account-health.md)
- [Selector Breakage](docs/runbooks/selector-breakage.md)
- [Incidents](docs/runbooks/incidents.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, branching strategy, and how to add selectors/tests.

## Security

See [SECURITY.md](SECURITY.md) for secrets policy, encryption, and vulnerability disclosure.

## License

MIT License - See [LICENSE](LICENSE) for details.
