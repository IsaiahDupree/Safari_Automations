#!/bin/zsh -l
# reinstall-fleet.sh — one-command recovery for the Safari Automation monorepo.
#
# WHY THIS EXISTS: there are no npm workspaces, so a wiped node_modules means
# EVERY package (root + packages/* + apps/api) must be reinstalled individually.
# When the fleet shows "Cannot find module 'express' / 'dotenv/config'", run this.
#
# Usage:
#   ./ops/reinstall-fleet.sh              # install root + all packages
#   ./ops/reinstall-fleet.sh --skip-browsers   # skip puppeteer/playwright browser downloads
#
# Exit code 0 = every install succeeded; non-zero = count of failed installs.

set -u
SA="/Users/isaiahdupree/Documents/Software/Safari Automation"
cd "$SA" || { echo "FATAL: cannot cd to $SA"; exit 99; }

LOG="/tmp/safari-reinstall.log"
: > "$LOG"

if [[ "${1:-}" == "--skip-browsers" ]]; then
  export PUPPETEER_SKIP_DOWNLOAD=1
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
  echo "[reinstall] browser downloads DISABLED" | tee -a "$LOG"
fi

# CRITICAL: this machine runs with NODE_ENV=production, which makes npm default to
# omit=dev and silently skip devDependencies (tsx, esbuild, typescript). The fleet
# runs via tsx (a devDependency), so installs MUST force dev deps or nothing starts.
export NODE_ENV=development

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
FAILED=()
OK=()

install_dir() {
  local dir="$1"
  if [[ ! -f "$dir/package.json" ]]; then
    return 0
  fi
  echo "[$(ts)] installing: $dir" | tee -a "$LOG"
  if ( cd "$dir" && npm install --include=dev --no-audit --no-fund >>"$LOG" 2>&1 ); then
    echo "[$(ts)]   OK: $dir" | tee -a "$LOG"
    OK+=("$dir")
  else
    echo "[$(ts)]   FAILED: $dir (see $LOG)" | tee -a "$LOG"
    FAILED+=("$dir")
  fi
}

echo "[$(ts)] === Safari fleet reinstall starting (node $(node -v), npm $(npm -v)) ===" | tee -a "$LOG"

# 1) root
install_dir "$SA"

# 2) every package
for d in "$SA"/packages/*/; do
  install_dir "${d%/}"
done

# 3) apps/api
install_dir "$SA/apps/api"

echo "" | tee -a "$LOG"
echo "[$(ts)] === SUMMARY: ${#OK[@]} ok, ${#FAILED[@]} failed ===" | tee -a "$LOG"
if (( ${#FAILED[@]} > 0 )); then
  echo "FAILED PACKAGES:" | tee -a "$LOG"
  for f in "${FAILED[@]}"; do echo "  - $f" | tee -a "$LOG"; done
fi

echo "REINSTALL_DONE ${#OK[@]} ok ${#FAILED[@]} failed" | tee -a "$LOG"
exit ${#FAILED[@]}
