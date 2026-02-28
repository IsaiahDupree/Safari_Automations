#!/bin/bash
# start-services.sh — Start all DM automation services
# Usage: ./scripts/start-services.sh [--restart]

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/safari-services"
mkdir -p "$LOG_DIR"

# Load env
[ -f "$ROOT/.env" ] && export $(grep -v '^#' "$ROOT/.env" | xargs) 2>/dev/null

ALL_PORTS="3001 3003 3004 3005 3006 3007 3100 3102 3105 3106"

stop_all() {
  echo "Stopping existing service processes..."
  for port in $ALL_PORTS; do
    pid=$(lsof -ti :$port 2>/dev/null)
    [ -n "$pid" ] && kill -9 $pid 2>/dev/null && echo "  killed port $port (pid $pid)"
  done
  sleep 1
}

start_service() {
  local name=$1 port=$2 pkg=$3
  shift 3
  local extra_env="$*"   # optional KEY=VAL pairs
  local log="$LOG_DIR/${name}.log"
  if lsof -ti :$port > /dev/null 2>&1; then
    echo "  ✅ $name already on :$port"
    return
  fi
  env PORT=$port $extra_env npx tsx "$ROOT/packages/$pkg/src/api/server.ts" > "$log" 2>&1 &
  echo "  🚀 $name :$port (pid $!, log: $log)"
}

if [ "$1" = "--restart" ]; then
  stop_all
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Starting Safari Automation Services"
echo "═══════════════════════════════════════════════════════"
cd "$ROOT"

# ── DM services ──────────────────────────────────────────
start_service "instagram-dm"      3001 "instagram-dm"
start_service "instagram-dm-auth" 3100 "instagram-dm"
start_service "twitter-dm"        3003 "twitter-dm"
start_service "tiktok-dm"         3102 "tiktok-dm"
start_service "linkedin-dm"       3105 "linkedin-automation"

# ── Comment / research services ──────────────────────────
start_service "threads-comments"   3004 "threads-comments"
start_service "instagram-comments" 3005 "instagram-comments"
start_service "tiktok-comments"    3006 "tiktok-comments"
start_service "twitter-comments"   3007 "twitter-comments" SAFARI_RESEARCH_ENABLED=true
start_service "market-research"    3106 "market-research"  SAFARI_RESEARCH_ENABLED=true

echo ""
echo "Waiting for services to initialize..."
sleep 10

echo ""
echo "Health checks:"
for name_port in \
  "instagram-dm:3001" \
  "twitter-dm:3003" \
  "threads-comments:3004" \
  "instagram-comments:3005" \
  "tiktok-comments:3006" \
  "twitter-comments:3007" \
  "tiktok-dm:3102" \
  "linkedin-dm:3105" \
  "market-research:3106"; do
  name="${name_port%%:*}"
  port="${name_port##*:}"
  status=$(curl -sf --max-time 3 "http://localhost:$port/health" 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status', d.get('platform','?')))" 2>/dev/null || echo "DOWN")
  [ "$status" != "DOWN" ] && echo "  ✅ $name :$port ($status)" || echo "  ❌ $name :$port DOWN"
done

echo ""
echo "All services started. Logs in $LOG_DIR/"
echo "Run 'python3 scripts/test_crm_e2e.py' to verify."
echo "Run 'python3 scripts/crm_brain.py --pipeline' for full CRM run."
