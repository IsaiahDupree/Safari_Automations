#!/bin/zsh -l
# open-local-to-cloud-tabs.sh
# Opens all automation platform tabs in Safari Window 2 ("Local to Cloud" profile),
# then triggers session/ensure on every service so tab claims are registered.
#
# Usage:
#   ./scripts/open-local-to-cloud-tabs.sh           # open missing tabs + claim
#   ./scripts/open-local-to-cloud-tabs.sh --claim   # claim only (no new tabs)
#   ./scripts/open-local-to-cloud-tabs.sh --reset   # close all W2 tabs and reopen fresh

SAFARI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SAFARI_DIR/.env" 2>/dev/null || true
WIN="${SAFARI_AUTOMATION_WINDOW:-2}"

# ── Platform tabs: "DETECT_PATTERN|OPEN_URL" ─────────────────────────────────
# DETECT_PATTERN — substring match; if any W2 tab URL contains this, tab is present
# OPEN_URL       — URL to open when tab is missing
declare -a PLATFORM_TABS=(
  "instagram.com|https://www.instagram.com/direct/inbox/"
  "x.com|https://x.com/messages"
  "tiktok.com|https://www.tiktok.com/"
  "threads.net|https://www.threads.net"
  "facebook.com|https://www.facebook.com/"
  "medium.com|https://medium.com"
  "upwork.com|https://www.upwork.com/"
  "sora|https://sora.com"
)

# ── Services with /api/session/ensure ────────────────────────────────────────
#  port → label
declare -a ENSURE_SERVICES=(
  "3100:instagram-dm"
  "3003:twitter-dm"
  "3102:tiktok-dm"
  "3004:threads-comments"
  "3005:instagram-comments"
  "3006:tiktok-comments"
  "3007:twitter-comments"
  "3008:facebook-comments"
  "3104:upwork-automation"
)

log() { echo "[$(date +%H:%M:%S)] $*"; }

parse_claim() {
  # Parse windowIndex/tabIndex from JSON, fall back to raw output
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    wi = d.get('windowIndex', d.get('window_index', '?'))
    ti = d.get('tabIndex',    d.get('tab_index',    '?'))
    if wi != '?':
        print(f'W{wi}:T{ti}')
    else:
        err = d.get('error', d.get('detail', str(d)))
        print(f'NO CLAIM — {str(err)[:60]}')
except:
    sys.stdout.write(sys.stdin.read()[:60] if False else '')
    print('parse error')
" 2>/dev/null
}

# ── Ensure Safari Window $WIN exists ─────────────────────────────────────────
win_count=$(osascript -e 'tell application "Safari" to return count of windows' 2>/dev/null || echo 0)
if (( win_count < WIN )); then
  log "ERROR: Safari Window ${WIN} not found (only ${win_count} windows open)."
  log "  Open Safari, switch to the 'Local to Cloud' profile, then re-run."
  exit 1
fi
log "Safari Window ${WIN} confirmed (${win_count} total windows)."

# ── Reset mode ───────────────────────────────────────────────────────────────
if [[ "$1" == "--reset" ]]; then
  log "Resetting Window ${WIN}: closing all tabs..."
  tab_count=$(osascript -e "tell application \"Safari\" to return count of tabs of window ${WIN}" 2>/dev/null || echo 0)
  for (( i=tab_count; i>=1; i-- )); do
    osascript -e "tell application \"Safari\" to close tab ${i} of window ${WIN}" 2>/dev/null
  done
  sleep 1
  # Open a blank tab to keep window alive
  osascript -e "tell application \"Safari\" to make new tab with properties {URL:\"about:blank\"} in window ${WIN}" 2>/dev/null
fi

# ── Open missing tabs ─────────────────────────────────────────────────────────
if [[ "$1" != "--claim" ]]; then
  log "Checking Window ${WIN} for platform tabs..."
  for entry in "${PLATFORM_TABS[@]}"; do
    pattern="${entry%%|*}"
    url="${entry##*|}"
    # Check if any tab in W$WIN matches the pattern
    exists=$(osascript 2>/dev/null << ASEOF
tell application "Safari"
  if (count of windows) < ${WIN} then return "no"
  repeat with t from 1 to count of tabs of window ${WIN}
    try
      set u to URL of tab t of window ${WIN}
      if u contains "${pattern}" then return "yes"
    end try
  end repeat
  return "no"
end tell
ASEOF
)
    if [[ "$exists" == "yes" ]]; then
      log "  OK      ${pattern}"
    else
      log "  OPEN    ${url}"
      osascript << ASEOF 2>/dev/null
tell application "Safari"
  tell window ${WIN}
    make new tab with properties {URL:"${url}"}
    activate
  end tell
end tell
ASEOF
      sleep 1
    fi
  done
  log "Waiting 4s for tabs to load..."
  sleep 4
fi

# ── Trigger session/ensure on each service ───────────────────────────────────
log "Triggering tab claims..."
for svc in "${ENSURE_SERVICES[@]}"; do
  port="${svc%%:*}"
  label="${svc##*:}"
  result=$(curl -s --max-time 6 -X POST "http://localhost:${port}/api/session/ensure" 2>/dev/null)
  if [[ -z "$result" ]]; then
    log "  :${port} ${label} — DOWN"
  else
    claim=$(parse_claim "$result")
    log "  :${port} ${label} — ${claim}"
  fi
done

# Sora uses a command trigger instead of session/ensure
if curl -s --max-time 2 http://localhost:7070/health > /dev/null 2>&1; then
  curl -s -X POST http://localhost:7070/v1/commands \
    -H "Content-Type: application/json" \
    -d '{"type":"sora.generate","payload":{"prompt":"tab-claim-ping"}}' > /dev/null 2>&1
  sleep 4
  sora_health=$(curl -s http://localhost:7070/health 2>/dev/null)
  claimed=$(echo "$sora_health" | python3 -c "import sys,json; print('claimed' if json.load(sys.stdin).get('tabClaimed') else 'not claimed')" 2>/dev/null)
  log "  :7070  sora-automation — ${claimed}"
else
  log "  :7070  sora-automation — DOWN"
fi

# ── Final summary ─────────────────────────────────────────────────────────────
log ""
log "Tab claims registered:"
python3 << 'PYEOF' 2>/dev/null
import json, time
try:
    claims = json.load(open('/tmp/safari-tab-claims.json'))
    now = time.time() * 1000
    for c in sorted(claims, key=lambda x: (x['windowIndex'], x['tabIndex'])):
        url = c.get('tabUrl', '')[:55]
        svc = c['service']
        age = int((now - c['heartbeat']) / 1000)
        print(f"  W{c['windowIndex']}:T{c['tabIndex']}  {svc:<28}  {url}")
except Exception as e:
    print(f"  (could not read claims: {e})")
PYEOF

log ""
log "Done. Commands:"
log "  --claim   trigger claims only (no new tabs)"
log "  --reset   close all W${WIN} tabs and reopen fresh"
