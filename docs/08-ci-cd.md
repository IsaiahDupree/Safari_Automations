# CI/CD

## Overview

This project uses GitHub Actions for continuous integration and deployment. Key workflows:

- **PR Checks**: Unit tests, linting, type checking
- **Integration Tests**: Safari-based tests on macOS runners
- **Nightly Selector Sweep**: Detect selector breakage early
- **Release**: Version bumps and changelog

## GitHub Actions Workflows

### PR Checks

```yaml
# .github/workflows/pr-checks.yml

name: PR Checks

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:unit -- --coverage
      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
```

### Integration Tests

```yaml
# .github/workflows/integration.yml

name: Integration Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  safari-integration:
    runs-on: macos-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Enable Safari WebDriver
        run: |
          sudo safaridriver --enable
          safaridriver --version
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          SAFARI_TIMEOUT_MS: 60000
          LOG_LEVEL: debug
      
      - name: Upload artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: integration-failure-artifacts
          path: |
            artifacts/
            test-results/
          retention-days: 7
```

### Nightly Selector Sweep

```yaml
# .github/workflows/selector-sweep.yml

name: Nightly Selector Sweep

on:
  schedule:
    # Run at 6 AM UTC daily
    - cron: '0 6 * * *'
  workflow_dispatch:
    inputs:
      platform:
        description: 'Platform to test (or "all")'
        required: false
        default: 'all'

jobs:
  sweep:
    runs-on: macos-latest
    timeout-minutes: 60
    strategy:
      fail-fast: false
      matrix:
        platform: [instagram, tiktok, threads, twitter]
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Enable Safari WebDriver
        run: sudo safaridriver --enable
      
      - name: Restore session cache
        uses: actions/cache@v4
        with:
          path: .sessions
          key: sessions-${{ matrix.platform }}-${{ github.run_id }}
          restore-keys: |
            sessions-${{ matrix.platform }}-
      
      - name: Run selector tests
        id: selectors
        continue-on-error: true
        run: npm run test:selectors -- --platform=${{ matrix.platform }}
        env:
          SESSION_PATH: .sessions/${{ matrix.platform }}.enc
          SESSION_KEY: ${{ secrets.SESSION_ENCRYPTION_KEY }}
      
      - name: Save test results
        uses: actions/upload-artifact@v4
        with:
          name: selector-results-${{ matrix.platform }}
          path: test-results/
          retention-days: 30
      
      - name: Save failure artifacts
        if: steps.selectors.outcome == 'failure'
        uses: actions/upload-artifact@v4
        with:
          name: selector-failures-${{ matrix.platform }}
          path: artifacts/
          retention-days: 7

  report:
    needs: sweep
    runs-on: ubuntu-latest
    if: always()
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/download-artifact@v4
        with:
          pattern: selector-results-*
          path: all-results/
      
      - name: Generate report
        run: npm run selectors:report -- --input=all-results/
      
      - name: Notify on failure
        if: contains(needs.sweep.result, 'failure')
        uses: slackapi/slack-github-action@v1.26.0
        with:
          payload: |
            {
              "text": "🚨 Selector sweep detected failures",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*Selector Sweep Alert*\nOne or more platform selectors are failing.\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Results>"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

### Flow Tests (Weekly)

```yaml
# .github/workflows/flow-tests.yml

name: Flow Tests

on:
  schedule:
    # Run every Sunday at 3 AM UTC
    - cron: '0 3 * * 0'
  workflow_dispatch:

jobs:
  flow-tests:
    runs-on: macos-latest
    timeout-minutes: 120
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Enable Safari WebDriver
        run: sudo safaridriver --enable
      
      - name: Run flow tests
        run: npm run test:flows
        env:
          DRY_RUN: true  # Don't actually engage
          LOG_LEVEL: info
      
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: flow-test-results
          path: test-results/
```

### Release Workflow

```yaml
# .github/workflows/release.yml

name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build
        run: npm run build
      
      - name: Generate changelog
        id: changelog
        run: |
          npm run changelog -- --from=$(git describe --tags --abbrev=0 HEAD^) --to=${{ github.ref_name }}
          echo "changelog<<EOF" >> $GITHUB_OUTPUT
          cat CHANGELOG_RELEASE.md >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          body: ${{ steps.changelog.outputs.changelog }}
          draft: false
          prerelease: ${{ contains(github.ref_name, '-') }}
```

## Secrets Management

### Required Secrets

| Secret | Purpose | How to Create |
|--------|---------|---------------|
| `SESSION_ENCRYPTION_KEY` | Encrypt session files | `openssl rand -hex 32` |
| `SLACK_WEBHOOK_URL` | Alert notifications | Slack App settings |
| `CODECOV_TOKEN` | Coverage uploads | Codecov dashboard |

### Session Files in CI

Sessions are encrypted and cached:

```bash
# Local: Create encrypted session
npm run session:encrypt -- --platform=instagram --key=$SESSION_KEY

# CI: Decrypt and use
npm run session:decrypt -- --platform=instagram --key=$SESSION_ENCRYPTION_KEY
```

### Best Practices

1. **Never log secrets** - Use masked outputs
2. **Rotate regularly** - At least quarterly
3. **Minimal scope** - Only necessary permissions
4. **Audit access** - Review who has secret access

## macOS Runner Notes

### Safari WebDriver Setup

```yaml
- name: Enable Safari WebDriver
  run: |
    # Enable safaridriver
    sudo safaridriver --enable
    
    # Verify
    safaridriver --version
    
    # Check Safari is installed
    /Applications/Safari.app/Contents/MacOS/Safari --version
```

### Known Limitations

1. **No headless mode** - Safari must render visibly
2. **Single session** - Only one Safari session at a time
3. **GUI required** - Tests must run on GUI-capable runners
4. **Rate limits** - GitHub-hosted macOS runners have limits

### Self-Hosted Runners

For more control, consider self-hosted macOS runners:

```yaml
jobs:
  test:
    runs-on: [self-hosted, macOS, safari]
    steps:
      # ...
```

Benefits:
- Persistent sessions
- No rate limits
- Custom Safari version
- More control

## Artifact Management

### What to Save

| Artifact | When | Retention |
|----------|------|-----------|
| Test results | Always | 30 days |
| Coverage reports | On success | 30 days |
| Screenshots | On failure | 7 days |
| HTML snapshots | On failure | 7 days |
| Logs | On failure | 7 days |

### Artifact Upload

```yaml
- name: Upload test results
  uses: actions/upload-artifact@v4
  if: always()
  with:
    name: test-results-${{ github.run_id }}
    path: |
      test-results/
      coverage/
    retention-days: 30

- name: Upload failure artifacts
  uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: failure-artifacts-${{ github.run_id }}
    path: |
      artifacts/screenshots/
      artifacts/html/
      logs/
    retention-days: 7
```

## Branch Protection

### Recommended Rules

```yaml
# For main branch:
protection:
  required_status_checks:
    strict: true
    contexts:
      - lint
      - typecheck
      - unit-tests
      - build
  required_pull_request_reviews:
    required_approving_review_count: 1
    dismiss_stale_reviews: true
  enforce_admins: true
  restrictions: null
```

### Required Checks

| Check | Required | Notes |
|-------|----------|-------|
| `lint` | Yes | Code style |
| `typecheck` | Yes | Type safety |
| `unit-tests` | Yes | Core functionality |
| `build` | Yes | Compiles successfully |
| `integration` | No | Slow, macOS-only |

## Local CI Simulation

### Run Checks Locally

```bash
# Run all PR checks
npm run ci:local

# Individual checks
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

### Act (GitHub Actions Locally)

```bash
# Install act
brew install act

# Run PR checks workflow
act pull_request

# Run specific job
act -j unit-tests
```

## Monitoring CI Health

### Metrics to Track

- **PR merge time** - Time from PR open to merge
- **CI duration** - How long checks take
- **Failure rate** - % of CI runs that fail
- **Flake rate** - % of failures that pass on retry

### Dashboard (Optional)

Consider tools like:
- GitHub Actions insights
- Datadog CI Visibility
- BuildPulse for flake detection

## Troubleshooting

### Common Issues

**Safari won't start**
```bash
# Check Safari is installed
ls /Applications/Safari.app

# Reset Safari automation
defaults delete com.apple.Safari AllowRemoteAutomation
sudo safaridriver --enable
```

**Session expired in CI**
```bash
# Re-create session locally
npm run session:create -- --platform=instagram

# Re-encrypt and update cache
npm run session:encrypt -- --platform=instagram
# Upload new session file
```

**Timeout failures**
```yaml
# Increase timeout
timeout-minutes: 60

# Or per-step
- name: Run tests
  timeout-minutes: 30
  run: npm run test:integration
```

**Disk space issues**
```yaml
- name: Free disk space
  run: |
    sudo rm -rf /usr/share/dotnet
    sudo rm -rf /opt/ghc
    df -h
```
