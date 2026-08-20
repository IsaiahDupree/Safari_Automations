#!/bin/zsh -l
set -eu

ROOT="/Users/isaiahdupree/Documents/Software/Safari Automation"
ENFORCER="$ROOT/ops/browser-enforcer.py"

python3 "$ENFORCER" audit-config
python3 "$ENFORCER" status >/tmp/browser-enforcer-smoke-status.json

denied_commands=(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/rogue'
  '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --user-data-dir=/tmp/rogue'
  "open -a 'Google Chrome' https://example.com"
  'npx playwright test # --cdp-endpoint http://127.0.0.1:9222'
  'python3 -c "from playwright.sync_api import sync_playwright; sync_playwright().start().chromium.launch()"'
  'node -e "require(\"puppeteer\").launch()"'
  'safaridriver --enable'
  'bash -c "open -a Safari"'
  'osascript -e '\''tell application "Safari" to make new document'\'''
  'killall Safari'
  './scripts/chrome-ctl.sh open "Profile 2"'
  './scripts/browser-bridge.sh open https://example.com'
  'bash ./chrome-launcher.sh start'
  'zsh -lc "./scripts/browser-bridge.sh open https://example.com"'
  'env TEST_MODE=1 zsh -l ./scripts/chrome-ctl.sh open "Profile 2"'
  'if false; then open -na "Google Chrome"; fi'
  'while false; do open -a Safari; done'
  'browser_probe() { /Applications/Chromium.app/Contents/MacOS/Chromium; }; browser_probe'
  'eval "open -na Google\\ Chrome"'
)
for denied in "${denied_commands[@]}"; do
  if python3 "$ENFORCER" check-command "$denied"; then
    echo "FAIL: forbidden browser command was allowed: $denied" >&2
    exit 1
  fi
done

python3 "$ENFORCER" check-command 'python3 /Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py ensure chrome'
python3 "$ENFORCER" check-command '/opt/homebrew/bin/playwright-mcp --cdp-endpoint http://127.0.0.1:9222'
python3 "$ENFORCER" check-command 'git diff -- chrome-launcher.sh scripts/browser-bridge.sh'
python3 "$ENFORCER" check-command 'rg -n "chrome-launcher.sh" docs/BROWSER_ENFORCEMENT.md'
python3 "$ENFORCER" check-command 'rg -n "if|then|do" chrome-launcher.sh scripts/browser-bridge.sh'
python3 "$ENFORCER" check-command 'sed -n "1,80p" chrome-launcher.sh'
python3 "$ENFORCER" check-command '/bin/zsh -n chrome-launcher.sh ops/browser-enforcer-smoke.sh'
python3 "$ENFORCER" check-command 'python3 /Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py status'
python3 "$ROOT/ops/safari-control-broker-smoke.py"

python3 - <<'PY'
import json
from pathlib import Path

status = json.loads(Path('/tmp/browser-enforcer-smoke-status.json').read_text())
assert len(status['chrome']['canonical_pids']) <= 1, status['chrome']
assert status['chrome']['tabs'] <= status['policy']['chrome_max_tabs'], status['chrome']
assert not status['chrome']['unauthorized_pids'], status['chrome']
assert not status['chrome']['rogue_chromium_pids'], status['chrome']
assert len(status['safari']['root_pids']) <= 1, status['safari']
assert status['safari']['control_available'], status['safari']
assert status['safari']['tabs'] <= status['policy']['safari_max_tabs'], status['safari']
print('browser-enforcer smoke: PASS')
PY
