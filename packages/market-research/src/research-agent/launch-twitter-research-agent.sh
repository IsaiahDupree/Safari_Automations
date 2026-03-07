#!/bin/zsh -l
# launch-twitter-research-agent.sh
#
# Launch script for the Twitter Tech Research Agent.
#
# Subcommands:
#   run-now     — run once in foreground, stream output
#   start       — run once in background, log to /tmp/twitter-research-agent.log
#   stop        — kill any running background instance
#   status      — show last run time, topics, telegram sent status
#   dry-run     — run full pipeline but skip Telegram + Supabase
#   topics-only — print today's trending topics and exit
#
# Cron schedule (daily at 7am):
# 0 7 * * * /bin/zsh -l "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/market-research/src/research-agent/launch-twitter-research-agent.sh" run-now

AGENT_DIR="/Users/isaiahdupree/Documents/Software/Safari Automation/packages/market-research/src/research-agent"
AGENT_SCRIPT="$AGENT_DIR/twitter-research-agent.js"
LOG_FILE="/tmp/twitter-research-agent.log"
PID_FILE="/tmp/twitter-research-agent.pid"
SYNTHESIS_DIR="$HOME/Documents/twitter-research/synthesis"

CMD="${1:-run-now}"

case "$CMD" in

  run-now)
    echo "[twitter-research-agent] Starting pipeline (foreground)..."
    node "$AGENT_SCRIPT"
    ;;

  dry-run)
    echo "[twitter-research-agent] Starting pipeline (dry-run)..."
    node "$AGENT_SCRIPT" --dry-run
    ;;

  topics-only)
    echo "[twitter-research-agent] Fetching trending topics..."
    node "$AGENT_SCRIPT" --topics-only
    ;;

  start)
    echo "[twitter-research-agent] Starting in background (log: $LOG_FILE)..."
    nohup node "$AGENT_SCRIPT" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "[twitter-research-agent] Started (PID: $!)"
    ;;

  stop)
    if [[ -f "$PID_FILE" ]]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        kill "$PID"
        echo "[twitter-research-agent] Stopped PID $PID"
      else
        echo "[twitter-research-agent] Process $PID not running"
      fi
      rm -f "$PID_FILE"
    else
      # Try pkill as fallback
      if pkill -f "twitter-research-agent.js" 2>/dev/null; then
        echo "[twitter-research-agent] Stopped via pkill"
      else
        echo "[twitter-research-agent] No running instance found"
      fi
    fi
    ;;

  status)
    # Find most recent synthesis file
    LATEST_SYNTHESIS=$(ls -t "$SYNTHESIS_DIR"/*.json 2>/dev/null | head -1)
    if [[ -z "$LATEST_SYNTHESIS" ]]; then
      echo "[twitter-research-agent] No synthesis files found in $SYNTHESIS_DIR"
    else
      echo "[twitter-research-agent] Last synthesis: $LATEST_SYNTHESIS"
      # Extract date and telegram_sent from synthesis (not stored in synthesis directly)
      # Check the corresponding Supabase record is not feasible locally — report from file
      node -e "
        const fs = require('fs');
        try {
          const s = JSON.parse(fs.readFileSync('$LATEST_SYNTHESIS', 'utf8'));
          const topics = (s.topTopics || []).map(t => t.topic).join(', ') || 'N/A';
          console.log('  Date:   ' + (s.date || 'unknown'));
          console.log('  Topics: ' + topics);
          console.log('  File:   $LATEST_SYNTHESIS');
        } catch(e) {
          console.log('  Error reading synthesis: ' + e.message);
        }
      " 2>/dev/null || echo "  (node not available)"
    fi

    # Check if running
    if [[ -f "$PID_FILE" ]]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "[twitter-research-agent] Currently running (PID: $PID)"
      else
        echo "[twitter-research-agent] Not running (stale PID file)"
      fi
    else
      echo "[twitter-research-agent] Not running"
    fi
    ;;

  *)
    echo "Usage: $0 {run-now|start|stop|status|dry-run|topics-only}"
    exit 1
    ;;
esac
