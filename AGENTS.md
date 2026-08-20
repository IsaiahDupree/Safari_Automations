# Browser Automation Rules

This repository shares the machine-wide browser singletons. These rules are
mandatory for every service, script, MCP server, test, and coding agent.

- Chrome: use only the `chrome-bridge` `agent` profile at
  `http://127.0.0.1:9222`. Puppeteer and Playwright must attach; they must not
  launch a browser or create a fresh browser context.
- Safari: use only the installed Safari application. Reuse an existing window
  and tab. Never start WebKit, Selenium Safari, a second Safari, or an
  isolated/fallback browser session.
- Both browsers have an absolute eight-tab cap. Reuse matching or blank tabs,
  and close only tabs created by the current claimed task.
- Claim before acting and release afterward. A cooling/unavailable browser is
  a blocking condition, never permission to launch a replacement.
- Only `ops/browser-enforcer.py` may start, stop, or restart a browser. It
  drains claims, pauses automation, cools for the configured interval, and
  relaunches the singleton.

Status and policy documentation:

```bash
python3 ops/browser-enforcer.py status
cat docs/BROWSER_ENFORCEMENT.md
```
