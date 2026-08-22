#!/bin/zsh -l
set -eu

ROOT="/Users/isaiahdupree/Documents/Software/Safari Automation"
ENFORCER="$ROOT/ops/browser-enforcer.py"
PYTHON="/opt/homebrew/bin/python3"

"$PYTHON" "$ENFORCER" audit-config
"$PYTHON" "$ENFORCER" status >/tmp/browser-enforcer-smoke-status.json

denied_commands=(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/rogue'
  '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --user-data-dir=/tmp/rogue'
  "open -a 'Google Chrome' https://example.com"
  'open -n -b com.google.Chrome --args --user-data-dir=/tmp/rogue'
  'npx playwright test # --cdp-endpoint http://127.0.0.1:9222'
  '/opt/homebrew/bin/playwright-mcp --cdp-endpoint http://127.0.0.1:9222'
  'python3 -c "from playwright.sync_api import sync_playwright; sync_playwright().start().chromium.launch()"'
  'node -e "require(\"puppeteer\").launch()"'
  'node -e "import(\"chrome-remote-interface\").then(async m=>m.default.New({port:9222}))"'
  'node -e "const p=String.fromCharCode(99,104,114,111,109,101);require(p).New({port:9000+222})"'
  'env NODE_OPTIONS=--require=/tmp/raw-cdp-preload.cjs node /Users/isaiahdupree/Documents/Software/browserd/browserd.mjs'
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
  "env -S 'open -b com.google.Chrome'"
  "printf '%s\\n' https://example.com | xargs open"
  'find /tmp -name page.html -exec open {} \;'
  'launchctl asuser 501 open -b com.google.Chrome'
  'osascript /tmp/browser-control.scpt'
  'open /tmp/page.html'
  'automator /tmp/browser.workflow'
  "shortcuts run 'Open URL'"
)
for denied in "${denied_commands[@]}"; do
  if "$PYTHON" "$ENFORCER" check-command "$denied"; then
    echo "FAIL: forbidden browser command was allowed: $denied" >&2
    exit 1
  fi
done

"$PYTHON" "$ENFORCER" check-command 'git diff -- chrome-launcher.sh scripts/browser-bridge.sh'
"$PYTHON" "$ENFORCER" check-command 'rg -n "chrome-launcher.sh" docs/BROWSER_ENFORCEMENT.md'
"$PYTHON" "$ENFORCER" check-command 'rg -n "if|then|do" chrome-launcher.sh scripts/browser-bridge.sh'
"$PYTHON" "$ENFORCER" check-command 'sed -n "1,80p" chrome-launcher.sh'
"$PYTHON" "$ENFORCER" check-command '/bin/zsh -n chrome-launcher.sh ops/browser-enforcer-smoke.sh'
"$PYTHON" "$ENFORCER" check-command '/opt/homebrew/bin/python3 /Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py status'
"$PYTHON" "$ENFORCER" check-command 'open -R /tmp/page.html'
"$PYTHON" "$ENFORCER" check-command 'curl http://127.0.0.1:9223/health'
"$PYTHON" "$ROOT/ops/safari-control-broker-smoke.py"

"$PYTHON" - <<'PY'
import importlib.util
from pathlib import Path

path = Path('/Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py')
spec = importlib.util.spec_from_file_location('browser_enforcer_smoke', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.direct_browser_mcp(
    'safe-name',
    {'command': 'node', 'args': ['/tmp/raw.mjs', '--cdp-endpoint', 'http://127.0.0.1:9222']},
)
assert module.direct_browser_mcp(
    'safe-name',
    {'command': 'node', 'args': ['/tmp/tool.mjs'], 'env': {'NODE_OPTIONS': '--require=/tmp/preload.cjs'}},
)
assert not module.direct_browser_mcp(
    'chrome-bridge',
    module.canonical_chrome_bridge_config(),
)
assert module.validate_trusted_python()['path'] == '/opt/homebrew/bin/python3'
print('browser configuration classifier: PASS')
PY

"$PYTHON" - <<'PY'
import json
from pathlib import Path

status = json.loads(Path('/tmp/browser-enforcer-smoke-status.json').read_text())
assert len(status['chrome']['canonical_pids']) <= 1, status['chrome']
assert not status['chrome']['unauthorized_pids'], status['chrome']
assert not status['chrome']['rogue_chromium_pids'], status['chrome']
assert len(status['safari']['root_pids']) <= 1, status['safari']
assert status['safari']['control_available'], status['safari']
assert status['policy']['chrome_max_tabs'] == 8, status['policy']
assert status['policy']['safari_max_tabs'] == 8, status['policy']
assert status['policy']['chrome_agent_max_tabs'] == 3, status['policy']
assert status['policy']['safari_agent_max_tabs'] == 4, status['policy']
print('browser-enforcer smoke: PASS')
PY
