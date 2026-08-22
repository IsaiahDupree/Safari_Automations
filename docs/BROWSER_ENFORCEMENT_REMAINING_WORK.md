# Browser enforcement: remaining work

Last updated: 2026-08-22

## Current disposition

The singleton control plane is implemented in source but is **not yet installed**.
Installation is intentionally blocked until every active Safari mutation path is
claim-aware and marker-bound. No browser application or human tab needs to be
closed to finish the remaining work.

Already completed:

- One canonical Chrome profile on CDP `127.0.0.1:9222`, with browserd as the
  only persistent CDP client.
- One Safari application, with Window 1 reserved for the human and agent work
  constrained to Window 2.
- Chrome and Safari admission caps, owned-tab reclamation, process/RSS/CPU
  thresholds, five-minute sustained-breach detection, a 45-second cooling
  interval, and ten-minute restart backoff.
- Human activity and foreground use pause agent actions and block maintenance.
- Peer-attested Unix sockets for destructive Chrome and Safari control; the
  old token/TCP destructive paths are retired.
- Durable Safari ownership, short operation claims, drain handling, and a
  marker-bound AppleScript transaction primitive that closes the tab-ordinal
  race.
- Command/MCP policy gates for direct browsers, alternate profiles, raw CDP,
  dynamic AppleEvents, runtime preloads, wrapper indirection, and renamed or
  altered browser brokers.
- Transactional installation and rollback, including the prior broker command,
  working directory, window name, normal/hidden/removed tmux environment, and
  prior control health.
- ACTP worker paths now fail closed and preserve cooling, denial, retry, and
  lease metadata instead of silently falling back or returning fake success.

## Installation blockers (P0)

1. Convert the 15 remaining direct Safari action paths in LinkedIn's active
   driver to the marker-bound same-transaction primitive.
2. Convert Medium's six mutable Window 2 actions and complete stable-window
   binding.
3. Delete or fully retire TikTok Comments' raw legacy compatibility
   `SafariDriver`. Its constructor currently fails closed, and the live
   `TikTokDriver` is converted, but dead raw browser code should not remain.
4. Make the existing Instagram DM, Threads, LinkedIn, Medium, and monorepo-wide
   Safari W2 TypeScript checks green. Do not weaken tests to accomplish this.
5. Re-run the adversarial policy, broker smoke, ownership, coordinator, driver,
   and production-import suites after items 1–4.

Do not run `browser-enforcer.py install` until all five items are complete.

## ACTP follow-up (P1)

- Modernize stale broad tests that expect retired fallback/mock behavior:
  `test_agent_pool.py` (4 failures), `test_clawbot_mcp_mesh.py` (6), and
  `test_parallel_agents.py` (10).
- Add explicit claim-aware preflight mappings before enabling future
  LinkedIn, Threads, or Upwork actions through ACTP worker's generic platform
  path. Current reviewed mappings cover Instagram, Twitter, and TikTok.
- Review the feature-disabled `agent_pool._fallback_to_swarm` branch before it
  can ever spawn browser-capable agents.
- Keep legacy Instagram sweep launchers in the autonomous dashboard and
  Telegram paths disabled or redirect them to the reviewed service API.

## Credential work (external, P0)

Rotate credentials that appeared in prior diagnostic output or were embedded
in source/config history:

- OpenAI API key
- Supabase service-role key
- Meta access token
- Windsurf/Supabase token

Never place replacement values in a commit, issue, log, or chat transcript.

## Safe installation sequence

After the P0 code blockers are green:

1. Confirm exactly one Chrome root and one Safari root, record tab/window
   counts, and verify neither browser is foreground-active.
2. Install and verify browserd's launchd service. This must not relaunch Chrome.
3. Run the pinned installer:

   ```bash
   /opt/homebrew/bin/python3 ops/browser-enforcer.py --policy config/browser-policy.json install
   ```

4. Verify launchd uses `/opt/homebrew/bin/python3`, the readiness receipt is
   fresh and PID-bound, configuration audit is clean, and the command hook
   blocks representative direct browser/CDP/AppleEvent paths.
5. Verify destructive TCP routes return 404, untrusted Unix-socket peers are
   rejected, and trusted peer operations are bounded.
6. Recount roots/tabs/windows and prove the installation did not close or
   reorder human tabs.
7. Leave controlled restart untested until a real sustained threshold breach
   or a separately scheduled idle maintenance window. Never force it during
   human use.

## Verification completed in this work session

- Browser enforcer policy: 16/16 passed.
- Browser command hook: 3/3 passed.
- Safari focused Vitest: 42/42 passed.
- Safari broker adversarial smoke and Python compile: passed.
- Eight converted Safari package TypeScript checks: passed.
- ACTP focused singleton suite: 19 passed.
- ACTP browser-use suites: 23 passed.
- ACTP MCP command policy: 67 passed.
- ACTP Safari executor/manager/client suites: 21, 64, and 29 passed.
- ACTP native MCP/tool agents: 195 and 99 passed.

## Scope boundary

This is strong user-space enforcement for the installed ACTP, Codex, Claude,
and OpenClaw integrations. It cannot universally identify or contain an
arbitrary third-party application's embedded WKWebView. Universal containment
requires MDM, Endpoint Security, or network policy outside this repository.
