#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
PACKAGE_ROOT="$ROOT/packages/market-research"
RUNTIME_BASE="$HOME/Library/Application Support/SafariAutomation"
RUNTIME_ROOT="$RUNTIME_BASE/market-research-runtime"
RUNTIME_DATA="$RUNTIME_BASE/market-research-data"
LABEL="com.isaiah.safari-automation.market-research"
SOURCE_PLIST="$ROOT/ops/$LABEL.plist"
DESTINATION_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

plutil -lint "$SOURCE_PLIST" >/dev/null
npm --prefix "$PACKAGE_ROOT" run build

mkdir -p "$RUNTIME_ROOT/scripts" "$RUNTIME_DATA" "$HOME/Library/LaunchAgents"
/usr/bin/ditto "$PACKAGE_ROOT/dist" "$RUNTIME_ROOT/dist"
/usr/bin/ditto "$PACKAGE_ROOT/node_modules" "$RUNTIME_ROOT/node_modules"
cp "$PACKAGE_ROOT/package.json" "$RUNTIME_ROOT/package.json"
cp "$ROOT/scripts/run-market-research-runtime.sh" "$RUNTIME_ROOT/scripts/run-market-research-runtime.sh"
chmod +x "$RUNTIME_ROOT/scripts/run-market-research-runtime.sh"

python3 "$ROOT/scripts/build_market_research_runtime_env.py" \
  --repo-root "$ROOT" \
  --runtime-base "$RUNTIME_BASE" \
  --output "$RUNTIME_ROOT/.env.market-research"

if [[ -d "$HOME/Documents/market-research" ]]; then
  /usr/bin/ditto "$HOME/Documents/market-research" "$RUNTIME_DATA"
fi

cp "$SOURCE_PLIST" "$DESTINATION_PLIST"
launchctl bootout "gui/$(id -u)/com.isaiah.safari-automation.watchdog" >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
sleep 1

registered=false
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "gui/$(id -u)" "$DESTINATION_PLIST"; then
    registered=true
    break
  fi
  sleep "$attempt"
done

if [[ "$registered" != "true" ]]; then
  echo "Unable to register $LABEL after 5 attempts." >&2
  exit 1
fi

launchctl enable "gui/$(id -u)/$LABEL"
launchctl kickstart "gui/$(id -u)/$LABEL"
echo "Installed $LABEL"
echo "Runtime: $RUNTIME_ROOT"
echo "Data: $RUNTIME_DATA"
