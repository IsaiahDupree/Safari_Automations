#!/bin/zsh -l
# watchdog-safari.sh — auto-restart the Safari/Chrome automation fleet.
#
# Responsibilities (in order every cycle):
#   1. Keep the ONE shared logged-in Chrome ("agent" profile) alive on :9222.
#      Every platform service drives THIS browser via its own tab — if it dies,
#      the whole fleet is blind, so it is checked first.
#   2. Keep each platform HTTP service alive on its port.
#   3. Keep the ACTP worker alive on :8090.
#
# Failure modes handled explicitly:
#   - Wiped node_modules  -> a service log showing MODULE_NOT_FOUND triggers a
#     one-shot ops/reinstall-fleet.sh (guarded by a flag file so it can't loop).
#   - Missing tsx         -> prefers the repo-local tsx, falls back to npx.
#   - Duplicate watchdogs -> a flock guard makes launchd's copy the only one.
#
# Logs: /tmp/safari-watchdog.log (this script) + /tmp/safari-<port>.log (each svc).

SAFARI_DIR="/Users/isaiahdupree/Documents/Software/Safari Automation"
LOG_DIR="/tmp"
ACTP_DIR="/Users/isaiahdupree/Documents/Software/actp-worker"

# -- Shared logged-in browser (chrome-bridge "agent" profile) -----------------
CHROME_APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
AGENT_PROFILE_DIR="/Users/isaiahdupree/Documents/Chrome/chrome-bridge/profiles/agent"
CDP_PORT=9222

# -- Single-instance guard: only one watchdog may run at a time ---------------
LOCK="/tmp/safari-watchdog.lock"
exec 9>"$LOCK"
if command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] another watchdog already holds $LOCK -- exiting" >> "$LOG_DIR/safari-watchdog.log"
    exit 0
  fi
fi

# -- Reinstall self-heal guard (so we never loop on npm install) --------------
REINSTALL_FLAG="/tmp/safari-watchdog-reinstalled.flag"

declare -A SERVICES
SERVICES[3100]="packages/instagram-dm/src/api/server.ts"
SERVICES[3003]="packages/twitter-dm/src/api/server.ts"
SERVICES[3102]="packages/tiktok-dm/src/api/server.ts"
SERVICES[3105]="packages/linkedin-automation/src/api/server.ts"
SERVICES[3005]="packages/instagram-comments/src/api/server.ts"
SERVICES[3107]="packages/upwork-automation/src/api/server.ts"
SERVICES[3006]="packages/tiktok-comments/src/api/server.ts"
SERVICES[3007]="packages/twitter-comments/src/api/server.ts"
SERVICES[3004]="packages/threads-comments/src/api/server.ts"
SERVICES[3106]="packages/market-research/src/api/server.ts"
SERVICES[7070]="packages/sora-automation/src/api/server.ts"
SERVICES[3108]="packages/medium-automation/src/api/server.ts"
SERVICES[3008]="packages/facebook-comments/src/api/server.ts"

declare -A EXTRA_ENV
EXTRA_ENV[3007]="SAFARI_RESEARCH_ENABLED=true"
EXTRA_ENV[3108]="MEDIUM_PORT=3108"
EXTRA_ENV[3107]="UPWORK_PORT=3107"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# Launch a service space-safely. The repo path contains a space ("Safari
# Automation"), so we must NOT build the command via eval/word-splitting — use
# `env` with a quoted tsx path instead. Prefer the repo-local tsx; fall back to npx.
TSX_LOCAL="$SAFARI_DIR/node_modules/.bin/tsx"
launch_service() {
  local port="$1" pkg="$2" extra="$3"
  cd "$SAFARI_DIR" || return 1
  if [ -x "$TSX_LOCAL" ]; then
    env ${extra:+$extra} PORT="$port" "$TSX_LOCAL" "$pkg" >> "$LOG_DIR/safari-$port.log" 2>&1 &
  else
    env ${extra:+$extra} PORT="$port" npx tsx "$pkg" >> "$LOG_DIR/safari-$port.log" 2>&1 &
  fi
}

# -- Load .env so services inherit the shared-browser CDP config ---------------
if [ -f "$SAFARI_DIR/.env" ]; then
  set -a
  source "$SAFARI_DIR/.env"
  set +a
fi

# Detect the "deps are gone" failure and self-heal ONCE.
maybe_self_heal() {
  local port="$1"
  local svclog="$LOG_DIR/safari-$port.log"
  [ -f "$svclog" ] || return 0
  # Only inspect the RECENT tail — the historical log may contain stale
  # MODULE_NOT_FOUND lines from before a fix, which would false-trigger a reinstall.
  if tail -n 20 "$svclog" | grep -qiE "Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND"; then
    if [ -f "$REINSTALL_FLAG" ]; then
      log "  -> node_modules still broken after a prior reinstall -- NOT looping. Fix manually: ops/reinstall-fleet.sh"
      return 0
    fi
    log "  -> DETECTED missing dependencies (MODULE_NOT_FOUND). Running ops/reinstall-fleet.sh once..."
    touch "$REINSTALL_FLAG"
    ( cd "$SAFARI_DIR" && NODE_ENV=development ./ops/reinstall-fleet.sh >> "$LOG_DIR/safari-reinstall.log" 2>&1 )
    log "  -> reinstall finished (see /tmp/safari-reinstall.log)"
  fi
}

# -- Keep the shared logged-in Chrome alive on :9222 --------------------------
ensure_agent_chrome() {
  if curl -s --max-time 3 "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
    return 0
  fi
  log ":$CDP_PORT (shared agent Chrome) DOWN -- relaunching logged-in profile"
  "$CHROME_APP" \
    --remote-debugging-port=$CDP_PORT \
    --remote-allow-origins=* \
    --user-data-dir="$AGENT_PROFILE_DIR" \
    --profile-directory=Default \
    --no-first-run --no-default-browser-check \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    >>"$LOG_DIR/agent-chrome.log" 2>&1 &
  for i in $(seq 1 20); do
    sleep 1
    if curl -s --max-time 2 "http://localhost:$CDP_PORT/json/version" >/dev/null 2>&1; then
      log ":$CDP_PORT RESTORED (shared agent Chrome)"
      return 0
    fi
  done
  log ":$CDP_PORT FAILED to relaunch -- services cannot drive Chrome (check $LOG_DIR/agent-chrome.log)"
}

log "Safari watchdog started (shared browser :$CDP_PORT, actp :8090) SAFARI_AUTOMATION_WINDOW=${SAFARI_AUTOMATION_WINDOW:-1} TSX=$( [ -x "$TSX_LOCAL" ] && echo local || echo npx )"

while true; do
  # 0) shared logged-in browser FIRST -- everything else depends on it
  ensure_agent_chrome

  # 1) platform HTTP services
  for port in 3100 3003 3102 3105 3005 3006 3007 3004 3106 3107 7070 3108 3008; do
    result=$(curl -s --max-time 3 "http://localhost:$port/health" 2>/dev/null)
    if [ -z "$result" ]; then
      pkg="${SERVICES[$port]}"
      extra="${EXTRA_ENV[$port]}"
      log ":$port DOWN -- restarting $pkg"
      launch_service "$port" "$pkg" "$extra"
      sleep 3
      recheck=$(curl -s --max-time 3 "http://localhost:$port/health" 2>/dev/null)
      if [ -n "$recheck" ]; then
        log ":$port RESTORED"
      else
        log ":$port FAILED to restart -- check $LOG_DIR/safari-$port.log"
        log "  -> last error: $(tail -n 3 "$LOG_DIR/safari-$port.log" 2>/dev/null | tr '\n' ' ' | tail -c 300)"
        maybe_self_heal "$port"
      fi
    fi
  done

  # 2) ACTP worker -- uvicorn on :8090
  actp_result=$(curl -s --max-time 3 "http://localhost:8090/health" 2>/dev/null)
  if [ -z "$actp_result" ]; then
    log ":8090 DOWN -- restarting actp cloud_server"
    cd "$ACTP_DIR"
    python3 -m uvicorn cloud_server:app --host 0.0.0.0 --port 8090 >> "$LOG_DIR/safari-8090.log" 2>&1 &
    sleep 4
    actp_recheck=$(curl -s --max-time 3 "http://localhost:8090/health" 2>/dev/null)
    if [ -n "$actp_recheck" ]; then log ":8090 RESTORED"; else log ":8090 FAILED to restart -- check $LOG_DIR/safari-8090.log"; fi
  fi

  # If every service came back healthy, clear the reinstall guard so a FUTURE
  # wipe can self-heal again.
  if [ -f "$REINSTALL_FLAG" ]; then
    healthy=1
    for port in 3100 3003 3102 3105 3005 3006 3007 3004 3106 3107 7070 3108 3008; do
      curl -s --max-time 2 "http://localhost:$port/health" >/dev/null 2>&1 || healthy=0
    done
    [ "$healthy" = "1" ] && { rm -f "$REINSTALL_FLAG"; log "fleet fully healthy -- cleared reinstall guard"; }
  fi

  sleep 30
done
