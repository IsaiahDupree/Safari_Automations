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
ACTP_PID_FILE="/tmp/actp-cloud-server.pid"
ACTP_START_FILE="/tmp/actp-cloud-server.started"
ACTP_START_GRACE_SECONDS=90

# -- Shared logged-in browser (chrome-bridge "agent" profile) -----------------
CDP_PORT=9222
BROWSER_ENFORCER="$SAFARI_DIR/ops/browser-enforcer.py"

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

# -- Passive-pause coordination (ops/safari-passive.py) -----------------------
# During an ACTIVE Safari automation (ASC App Privacy, DM send, …), passive
# data-gathering services are paused so they can't hijack the shared Safari tab.
# While paused, this watchdog skips restarting the passive ports; safari-passive
# .py's guardian restores them (launchd + ports) after the 30-min cooldown.
# Fail-open: if the check errors, we treat it as NOT paused (fleet stays healthy).
PASSIVE_PAUSE_PORTS=" 3005 3006 3007 3004 3008 3106 3107 7070 3108 "
passive_paused() { python3 "$SAFARI_DIR/ops/safari-passive.py" is-paused >/dev/null 2>&1; }
is_passive_port() { [[ "$PASSIVE_PAUSE_PORTS" == *" $1 "* ]]; }

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

# Own exactly one ACTP worker. A slow Python import must not cause this
# watchdog to create another worker every cycle.
actp_worker_pid() {
  local pid command_line
  [ -r "$ACTP_PID_FILE" ] || return 1
  read -r pid < "$ACTP_PID_FILE"
  [[ "$pid" == <-> ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  command_line=$(ps -p "$pid" -o command= 2>/dev/null)
  [[ "$command_line" == *" -m uvicorn cloud_server:app "* ]] || return 1
  print -r -- "$pid"
}

launch_actp_worker() {
  cd "$ACTP_DIR" || return 1
  # uvloop import has intermittently stalled under host pressure. The stdlib
  # asyncio loop is deterministic here and avoids a restart storm.
  python3 -m uvicorn cloud_server:app --host 0.0.0.0 --port 8090 --loop asyncio >> "$LOG_DIR/safari-8090.log" 2>&1 &
  local pid=$!
  print -r -- "$pid" > "$ACTP_PID_FILE"
  date +%s > "$ACTP_START_FILE"
  log ":8090 STARTING actp cloud_server (pid $pid)"
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
  log ":$CDP_PORT (shared agent Chrome) DOWN -- requesting canonical singleton"
  python3 "$BROWSER_ENFORCER" ensure chrome >>"$LOG_DIR/agent-chrome.log" 2>&1
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
  # Browser lifecycle belongs exclusively to the global enforcer. This service
  # watchdog must never make a second availability or relaunch decision.
  # ensure_agent_chrome

  # 1) platform HTTP services
  # Check the passive-pause flag ONCE per cycle (cheap) — skip passive restarts while paused.
  if passive_paused; then PASSIVE_PAUSED=1; else PASSIVE_PAUSED=0; fi
  for port in 3100 3003 3102 3105 3005 3006 3007 3004 3106 3107 7070 3108 3008; do
    if [ "$PASSIVE_PAUSED" = 1 ] && is_passive_port "$port"; then
      continue   # passive service intentionally paused for an active Safari automation
    fi
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
    actp_pid=$(actp_worker_pid 2>/dev/null)
    if [ -n "$actp_pid" ]; then
      actp_started=$(cat "$ACTP_START_FILE" 2>/dev/null || echo 0)
      actp_age=$(( $(date +%s) - actp_started ))
      if [ "$actp_age" -lt "$ACTP_START_GRACE_SECONDS" ]; then
        log ":8090 still STARTING (pid $actp_pid, ${actp_age}s) -- not spawning a duplicate"
      else
        log ":8090 startup timed out after ${actp_age}s -- replacing owned pid $actp_pid"
        kill -TERM "$actp_pid" 2>/dev/null || true
        sleep 2
        kill -0 "$actp_pid" 2>/dev/null && kill -KILL "$actp_pid" 2>/dev/null || true
        launch_actp_worker
      fi
    else
      launch_actp_worker
      sleep 4
      actp_recheck=$(curl -s --max-time 3 "http://localhost:8090/health" 2>/dev/null)
      if [ -n "$actp_recheck" ]; then
        log ":8090 RESTORED"
      elif actp_pid=$(actp_worker_pid 2>/dev/null); then
        log ":8090 still STARTING (pid $actp_pid) -- not spawning a duplicate"
      else
        log ":8090 FAILED to start -- check $LOG_DIR/safari-8090.log"
      fi
    fi
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
