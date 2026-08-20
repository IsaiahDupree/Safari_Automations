# Browser enforcement

ACTP permits exactly one browser root of each family:

- Chrome: the `chrome-bridge` `agent` profile on `127.0.0.1:9222`.
- Safari: the existing macOS Safari application.

Agents and services must attach to those browsers. They may not launch a fresh
Playwright/Puppeteer context, a headless Chromium, Chrome for Testing, another
Chrome profile, or a second Safari instance.

The policy is in `config/browser-policy.json`. Both browsers are capped at eight
tabs, and Safari is capped at one window. Resource limits require three
consecutive breach samples before a restart.
A controlled restart waits briefly for active claims, stops the browser, cools
for 45 seconds, and only then relaunches the canonical singleton. A ten-minute
restart backoff prevents restart loops.

A separate two-second process guard terminates unauthorized Chrome profiles,
Chromium/Chrome-for-Testing, Playwright Firefox/WebKit, headless shells, and
duplicate Safari roots. It continues running while a controlled browser restart
is draining or cooling, and kills any browser that tries to relaunch before its
cooling deadline expires.
The fast path queries exact kernel process names and confirms their full argv;
if that targeted query fails, it completes the cycle from a full process
snapshot instead of silently skipping enforcement.

Agent command hooks call `check-command` before shell execution. The parser
follows nested shells, conditionals, loops, functions, and `eval` so forbidden
launches cannot hide behind shell syntax. Browser filenames remain safe to pass
as data to inspection tools such as Git, `rg`, `sed`, and shell syntax checks.
Codex uses its Chrome plugin as the sole browser client; the installer removes
the redundant always-on Playwright MCP entry that otherwise leaves one idle
connector process behind per agent turn. Claude's Playwright entry remains
allowed only with the canonical `--cdp-endpoint http://127.0.0.1:9222`.

Safari window and tab control is served by an authenticated broker bound only
to `127.0.0.1:5591`. The installer runs that broker inside the existing
Apple-authorized tmux identity, while launchd reads counts and applies the cap
through its token-protected loopback API. The token and installed broker are
mode-restricted under the runtime directory. Apple Events are serialized so
overlapping inspections and trims cannot race Safari. The broker accepts at
most four concurrent, five-second requests, rotates its logs, and restarts
with exponential backoff plus jitter if it crashes. Installation rotates the
token atomically at mode `0600` and tears down the supervisor if readiness
verification fails.

Safari control availability is reported separately as control health. A
permission denial or transient AppleScript timeout does not by itself trigger
a restart; CPU, memory, process, root, window, and tab limits remain the
restart thresholds. Installation fails if authenticated Safari counts cannot
be read through the broker.

The canonical browser roots, browserd, and the launchd enforcer run at nice 8
so interactive work retains CPU priority when the machine is busy.

Commands:

```bash
python3 ops/browser-enforcer.py status
python3 ops/browser-enforcer.py enforce-once
python3 ops/browser-enforcer.py restart chrome --reason "manual maintenance"
python3 ops/browser-enforcer.py restart safari --reason "manual maintenance"
python3 ops/browser-enforcer.py configure-agents
python3 ops/browser-enforcer.py install
```

Logs and runtime state live under
`~/Library/Application Support/ACTP/browser-enforcer/`. The installed launchd
label is `com.isaiah.actp-browser-enforcer`.
