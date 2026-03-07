#!/bin/zsh -l
# watchdog-safari.sh — auto-restart any downed Safari automation service
# Run once: nohup /bin/zsh -l /path/to/watchdog-safari.sh >> /tmp/safari-watchdog.log 2>&1 &

SAFARI_DIR="/Users/isaiahdupree/Documents/Software/Safari Automation"
LOG_DIR="/tmp"

declare -A SERVICES
SERVICES[3100]="packages/instagram-dm/src/api/server.ts"
SERVICES[3003]="packages/twitter-dm/src/api/server.ts"
SERVICES[3102]="packages/tiktok-dm/src/api/server.ts"
SERVICES[3105]="packages/linkedin-automation/src/api/server.ts"
SERVICES[3005]="packages/instagram-comments/src/api/server.ts"
SERVICES[3107]="packages/upwork-hunter/src/api/server.ts"
SERVICES[3006]="packages/tiktok-comments/src/api/server.ts"
SERVICES[3007]="packages/twitter-comments/src/api/server.ts"
SERVICES[3004]="packages/threads-comments/src/api/server.ts"
SERVICES[3106]="packages/market-research/src/api/server.ts"
SERVICES[7070]="packages/sora-automation/src/api/server.ts"
SERVICES[3108]="packages/medium-automation/src/api/server.ts"
SERVICES[3008]="packages/facebook-comments/src/api/server.ts"
SERVICES[3104]="packages/upwork-automation/src/api/server.ts"

declare -A EXTRA_ENV
EXTRA_ENV[3007]="SAFARI_RESEARCH_ENABLED=true"
EXTRA_ENV[3108]="MEDIUM_PORT=3108"
EXTRA_ENV[3104]="UPWORK_PORT=3104"

ACTP_DIR="/Users/isaiahdupree/Documents/Software/actp-worker"

# ── Load .env so services inherit correct automation window ───────────────────
if [ -f "$SAFARI_DIR/.env" ]; then
  set -a
  source "$SAFARI_DIR/.env"
  set +a
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Safari watchdog started (includes actp-worker :8090) SAFARI_AUTOMATION_WINDOW=${SAFARI_AUTOMATION_WINDOW:-1}"

while true; do
  # ── Safari Node.js services ────────────────────────────────────────────────
  for port in 3100 3003 3102 3105 3005 3006 3007 3004 3106 3107 7070 3108 3008 3104; do
    result=$(curl -s --max-time 3 "http://localhost:$port/health" 2>/dev/null)
    if [ -z "$result" ]; then
      pkg="${SERVICES[$port]}"
      extra="${EXTRA_ENV[$port]}"
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :$port DOWN — restarting $pkg"
      cd "$SAFARI_DIR"
      eval "$extra PORT=$port npx tsx $pkg >> $LOG_DIR/safari-$port.log 2>&1 &"
      sleep 3
      recheck=$(curl -s --max-time 3 "http://localhost:$port/health" 2>/dev/null)
      if [ -n "$recheck" ]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :$port RESTORED"
        # Services auto-claim their tabs via requireTabClaim middleware
      else
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :$port FAILED to restart — check $LOG_DIR/safari-$port.log"
      fi
    fi
  done

  # ── ACTP Worker — uvicorn on :8090 ────────────────────────────────────────
  actp_result=$(curl -s --max-time 3 "http://localhost:8090/health" 2>/dev/null)
  if [ -z "$actp_result" ]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :8090 DOWN — restarting actp cloud_server"
    cd "$ACTP_DIR"
    python3 -m uvicorn cloud_server:app --host 0.0.0.0 --port 8090 >> $LOG_DIR/safari-8090.log 2>&1 &
    sleep 4
    actp_recheck=$(curl -s --max-time 3 "http://localhost:8090/health" 2>/dev/null)
    if [ -n "$actp_recheck" ]; then
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :8090 RESTORED"
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :8090 FAILED to restart — check $LOG_DIR/safari-8090.log"
    fi
  fi

  sleep 30
done
