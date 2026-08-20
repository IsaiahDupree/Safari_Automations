#!/bin/zsh -l
# Compatibility entrypoint. The old version launched four isolated Chrome
# profiles. That is forbidden: every Safari Automation service must share the
# one chrome-bridge agent profile on CDP 9222.

set -eu

ENFORCER="/Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py"
ACTION="${1:---start}"

case "$ACTION" in
  --start|start)
    exec python3 "$ENFORCER" ensure chrome
    ;;
  --status|status)
    exec python3 "$ENFORCER" status
    ;;
  --stop|stop)
    echo "DENIED: the canonical Chrome singleton must remain managed." >&2
    echo "Use browser-enforcer.py restart chrome for a controlled stop, cooling interval, and relaunch." >&2
    exit 42
    ;;
  *)
    echo "Usage: $0 [--start|--status]" >&2
    exit 2
    ;;
esac
