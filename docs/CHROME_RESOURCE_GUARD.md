# Chrome resource guard

The former machine-wide browser enforcer has been retired. The compatibility
program at `ops/browser-enforcer.py` now protects only the local canonical
Google Chrome process from sustained CPU, memory, process, and tab overload.

It does not inspect, launch, stop, serialize, authorize, or configure Safari,
Waterfox, Firefox, Orion, WebKit, Playwright, Puppeteer, remote browsers, agent
tools, screen-lock state, or human-presence state. Those browser paths operate
independently.

The Chrome guard retains the legacy path and launchd label so `chrome-bridge`,
`browserd`, and existing operational scripts continue to work. It does not
install tool hooks or rewrite Codex, Claude, or OpenClaw configuration.

```bash
python3 ops/browser-enforcer.py status
python3 ops/browser-enforcer.py enforce-once
python3 ops/browser-enforcer.py install
```
