#!/bin/bash
# verify-setup.sh - Quick verification script for Twitter Research Agent setup

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Twitter Research Agent - Setup Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

check() {
  if [ $? -eq 0 ]; then
    echo "✅ $1"
    ((PASS++))
  else
    echo "❌ $1"
    ((FAIL++))
  fi
}

warn() {
  echo "⚠️  $1"
}

# ─── File Existence ──────────────────────────────────────────────────────────

echo ""
echo "📁 Checking core files..."

[ -f "trending-topic-scraper.js" ]; check "trending-topic-scraper.js exists"
[ -f "multi-topic-search-runner.js" ]; check "multi-topic-search-runner.js exists"
[ -f "research-synthesizer.js" ]; check "research-synthesizer.js exists"
[ -f "report-formatter.js" ]; check "report-formatter.js exists"
[ -f "twitter-research-agent.js" ]; check "twitter-research-agent.js exists"
[ -f "launch-twitter-research-agent.sh" ]; check "launch-twitter-research-agent.sh exists"
[ -f "test-research-agent.js" ]; check "test-research-agent.js exists"
[ -f "README.md" ]; check "README.md exists"
[ -f "INITIALIZATION.md" ]; check "INITIALIZATION.md exists"

# ─── Output Directories ──────────────────────────────────────────────────────

echo ""
echo "📂 Checking output directories..."

[ -d ~/Documents/twitter-research/batches ]; check "~/Documents/twitter-research/batches/ exists"
[ -d ~/Documents/twitter-research/synthesis ]; check "~/Documents/twitter-research/synthesis/ exists"
[ -d ~/.memory/vault/RESEARCH ]; check "~/.memory/vault/RESEARCH/ exists"

# ─── Migration File ──────────────────────────────────────────────────────────

echo ""
echo "🗄️  Checking migration..."

MIGRATION_PATH="/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/migrations/20260307_twitter_research.sql"
[ -f "$MIGRATION_PATH" ]; check "Migration file exists"

# ─── Dependencies ────────────────────────────────────────────────────────────

echo ""
echo "📦 Checking dependencies..."

TWITTER_RESEARCHER="/Users/isaiahdupree/Documents/Software/Safari Automation/packages/market-research/dist/twitter-comments/src/automation/twitter-researcher.js"
[ -f "$TWITTER_RESEARCHER" ]; check "TwitterResearcher class exists"

# ─── Environment Variables ───────────────────────────────────────────────────

echo ""
echo "🔑 Checking environment variables..."

ENV_FILE="/Users/isaiahdupree/Documents/Software/actp-worker/.env"
if [ -f "$ENV_FILE" ]; then
  echo "✅ actp-worker/.env exists"
  ((PASS++))

  if grep -q "ANTHROPIC_API_KEY" "$ENV_FILE"; then
    echo "✅ ANTHROPIC_API_KEY defined"
    ((PASS++))
  else
    echo "❌ ANTHROPIC_API_KEY not found"
    ((FAIL++))
  fi

  if grep -q "TELEGRAM_BOT_TOKEN" "$ENV_FILE"; then
    echo "✅ TELEGRAM_BOT_TOKEN defined"
    ((PASS++))
  else
    echo "❌ TELEGRAM_BOT_TOKEN not found"
    ((FAIL++))
  fi

  if grep -q "TELEGRAM_CHAT_ID" "$ENV_FILE"; then
    echo "✅ TELEGRAM_CHAT_ID defined"
    ((PASS++))
  else
    echo "❌ TELEGRAM_CHAT_ID not found"
    ((FAIL++))
  fi
else
  echo "❌ actp-worker/.env not found"
  ((FAIL++))
fi

# ─── Feature List ────────────────────────────────────────────────────────────

echo ""
echo "📋 Checking feature list..."

FEATURE_FILE="/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/features/prd-twitter-research-agent.json"
if [ -f "$FEATURE_FILE" ]; then
  echo "✅ Feature list exists"
  ((PASS++))

  # Count features (requires jq)
  if command -v jq &> /dev/null; then
    TOTAL=$(jq '.features | length' "$FEATURE_FILE")
    PASSING=$(jq '[.features[] | select(.passes == true)] | length' "$FEATURE_FILE")
    echo "   Features: $PASSING/$TOTAL passing"
  else
    warn "jq not installed - can't count features"
  fi
else
  echo "❌ Feature list not found"
  ((FAIL++))
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAIL -eq 0 ]; then
  echo "✅ All checks passed! Ready for feature verification."
  echo ""
  echo "Next steps:"
  echo "  1. Apply Supabase migration"
  echo "  2. Run: node test-research-agent.js"
  echo "  3. Run: node twitter-research-agent.js --topics-only"
  echo "  4. Run: node twitter-research-agent.js --dry-run --topics 'AI agents'"
  exit 0
else
  echo "❌ Some checks failed. Fix issues before proceeding."
  exit 1
fi
