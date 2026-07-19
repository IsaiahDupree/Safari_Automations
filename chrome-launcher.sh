#!/bin/bash
# chrome-launcher.sh
# Starts isolated Chrome instances for each automation platform with dedicated CDP ports.
# LinkedIn (port 9333) is managed separately — this script skips it.
#
# Usage:
#   ./chrome-launcher.sh --start    # start all platform Chrome instances
#   ./chrome-launcher.sh --stop     # kill all automation Chrome processes
#   ./chrome-launcher.sh --status   # check which are running

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_BASE="$HOME/.chrome-automation-profiles"

# Platform list (bash 3 compatible — no associative arrays)
PLATFORMS="instagram twitter tiktok threads"

get_port() {
  case "$1" in
    instagram) echo 9222 ;;
    twitter)   echo 9223 ;;
    tiktok)    echo 9224 ;;
    threads)   echo 9225 ;;
  esac
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

is_running() {
  local platform="$1"
  local pid_file="/tmp/chrome-${platform}.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

cdp_responding() {
  local port="$1"
  curl -s --max-time 2 "http://localhost:${port}/json/version" > /dev/null 2>&1
}

start_platform() {
  local platform="$1"
  local port
  port=$(get_port "$platform")
  local user_data_dir="${PROFILE_BASE}/${platform}"
  local pid_file="/tmp/chrome-${platform}.pid"
  local log_file="/tmp/chrome-${platform}.log"

  if is_running "$platform"; then
    echo "  SKIP   ${platform}  (already running, PID=$(cat "$pid_file"))"
    return
  fi

  echo "[chrome-launcher] Starting Chrome for ${platform} (CDP :${port})..."
  mkdir -p "$user_data_dir"

  nohup "$CHROME_BIN" \
    --remote-debugging-port="${port}" \
    --user-data-dir="${user_data_dir}" \
    --profile-directory="Default" \
    --no-first-run \
    --no-default-browser-check \
    --disable-blink-features=AutomationControlled \
    --disable-infobars \
    --window-size=1400,900 \
    > "$log_file" 2>&1 &

  local pid=$!
  echo "$pid" > "$pid_file"
  echo "[chrome-launcher] ${platform} started (PID ${pid})"
}

stop_platform() {
  local platform="$1"
  local pid_file="/tmp/chrome-${platform}.pid"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "[chrome-launcher] Stopped ${platform} (PID ${pid})"
    fi
    rm -f "$pid_file"
  else
    echo "[chrome-launcher] ${platform} not running (no PID file)"
  fi
}

status_platform() {
  local platform="$1"
  local port
  port=$(get_port "$platform")
  local pid_file="/tmp/chrome-${platform}.pid"

  if is_running "$platform"; then
    local pid
    pid=$(cat "$pid_file")
    if cdp_responding "$port"; then
      printf "  %-10s %-12s PID=%-8s CDP=:%s\n" "UP" "$platform" "$pid" "$port"
    else
      printf "  %-10s %-12s PID=%-8s CDP=:%s (not yet ready)\n" "STARTING" "$platform" "$pid" "$port"
    fi
  else
    printf "  %-10s %-12s CDP=:%s\n" "DOWN" "$platform" "$port"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────────

ACTION="${1:---start}"

case "$ACTION" in
  --start|start)
    echo "[chrome-launcher] Starting Chrome automation profiles..."
    for platform in $PLATFORMS; do
      start_platform "$platform"
    done
    echo "[chrome-launcher] Waiting 4s for CDP to become available..."
    sleep 4
    echo "[chrome-launcher] Status:"
    for platform in $PLATFORMS; do
      status_platform "$platform"
    done
    ;;

  --stop|stop)
    echo "[chrome-launcher] Stopping Chrome automation profiles..."
    for platform in $PLATFORMS; do
      stop_platform "$platform"
    done
    ;;

  --status|status)
    echo "[chrome-launcher] Chrome automation profile status:"
    for platform in $PLATFORMS; do
      status_platform "$platform"
    done
    ;;

  *)
    echo "Usage: $0 [--start|--stop|--status]"
    exit 1
    ;;
esac
