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
# SERVICES[3006]="packages/tiktok-comments/src/api/server.ts"  # deferred
SERVICES[3007]="packages/twitter-comments/src/api/server.ts"
SERVICES[3004]="packages/threads-comments/src/api/server.ts"
SERVICES[3106]="packages/market-research/src/api/server.ts"

declare -A EXTRA_ENV
EXTRA_ENV[3007]="SAFARI_RESEARCH_ENABLED=true"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Safari watchdog started"

while true; do
  for port in 3100 3003 3102 3105 3005 3007 3004 3106 3107; do
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
      else
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] :$port FAILED to restart — check $LOG_DIR/safari-$port.log"
      fi
    fi
  done
  sleep 30
done
