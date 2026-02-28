#!/usr/bin/env bash
# propagate-safari-driver.sh
# ===========================
# Copy the updated safari-driver.ts (with ensureActiveSession, findTabByUrl,
# activateTab, executeJSInTab, tab-aware executeLocalJS) from instagram-dm
# to all other Safari automation packages.
#
# Each package gets the same base driver; server.ts changes are package-specific
# (SESSION_URL_PATTERN differs per platform).
#
# Usage:
#   cd "Safari Automation"
#   bash scripts/propagate-safari-driver.sh

set -euo pipefail

SAFARI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$SAFARI_DIR/packages/instagram-dm/src/automation/safari-driver.ts"

if [ ! -f "$SOURCE" ]; then
  echo "ERROR: Source not found: $SOURCE"
  exit 1
fi

# Packages that have their own safari-driver.ts
TARGETS=(
  "twitter-dm"
  "tiktok-dm"
  "linkedin-automation"
  "upwork-automation"
  "medium-automation"
  "twitter-comments"
  "threads-comments"
  "instagram-comments"
  "tiktok-comments"
  "market-research"
)

COPIED=0
SKIPPED=0

for pkg in "${TARGETS[@]}"; do
  DEST_DIR="$SAFARI_DIR/packages/$pkg/src/automation"
  DEST="$DEST_DIR/safari-driver.ts"

  if [ ! -d "$DEST_DIR" ]; then
    echo "  SKIP  $pkg  (no src/automation/ directory)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  cp "$SOURCE" "$DEST"
  echo "  DONE  $pkg  → $DEST"
  COPIED=$((COPIED + 1))
done

echo ""
echo "Propagated to $COPIED packages, skipped $SKIPPED"
echo ""
echo "Next: rebuild each package with updated session-aware driver:"
echo "  for pkg in twitter-dm tiktok-dm linkedin-automation upwork-automation; do"
echo "    (cd packages/\$pkg && npm run build) && echo \"  built \$pkg\""
echo "  done"
