# Browser enforcement

ACTP permits exactly one physical application root of each family:

- The Chrome lane is the signed-in `chrome-bridge` `agent` profile on
  `127.0.0.1:9222`. Agents use a browserd lease and owned target API.
- The Safari lane is the existing macOS application. Window 1 belongs to the
  human and claimed agent work stays in Window 2.

These are logical human/agent lanes inside the same signed-in applications,
not duplicate profiles. Direct CDP, Playwright, Puppeteer, SafariDriver, fresh
contexts, headless engines, alternate browsers, extra profiles/roots, and known
in-app fallbacks are forbidden. Browserd is the only persistent CDP client.

The policy is in `config/browser-policy.json`. Eight tabs per application is an
admission/reclaim target: agent-owned capacity is three Chrome tabs and four
Safari tabs, with at most two and four concurrent agents respectively. Unknown
and human tabs are reported and preserved even above eight; only proven idle
agent tabs are reclaimed. Safari is limited to two windows. Resource limits are
24 attributed processes and 3,072 MB/175% CPU for Chrome, and 24 processes and
2,048 MB/150% CPU for Safari. A breach must persist for 60 consecutive
five-second samples before restart maintenance is considered.

A controlled restart requires five minutes without physical input, neither
browser in the foreground, and no manual human hold. It atomically drains both
allocation lanes, revokes idle Chrome leases, waits up to 30 seconds for only
in-flight Chrome/Safari operations, renews its owned
browserd drain during stop/cooling/relaunch, cools for 45 seconds, and resumes
workers only after both singleton browsers are healthy. Failed recovery keeps
the drains and Safari workers paused; automated relaunch is capped and backed
off instead of creating a restart storm. A ten-minute restart backoff applies
between completed restart attempts.

A one-second known-root guard terminates unauthorized profiles, alternate
engines, headless shells, and duplicate application roots after at most a
two-second TERM grace. The broader installed-web-handler scan runs every five
seconds, giving an unknown generic browser an intentional worst-case response
window of about seven seconds including grace. Unauthorized established clients
of port 9222 are scanned every two seconds and stopped. These guards continue
through drain/cooling and reject premature relaunches. Command hooks remove
known short-lived attachment paths before execution; socket/process scans are
defense in depth rather than kernel isolation.
The fast path queries exact kernel process names and confirms their full argv;
if that targeted query fails, it completes the cycle from a full process
snapshot instead of silently skipping enforcement.
Within the slower resource cycle, a short process-table cache coalesces root,
descendant, and aggregate reads so the enforcer does not repeatedly scan the
same host process list.

Agent command hooks fail closed if their installed runtime, policy, or audit is
unavailable. They inspect nested shells, wrappers, literal encodings, runtime
preloads, and opaque AppleScript/workflow launchers. Exact leased MCP tool names
are allowed only after a fresh configuration audit; built-in/direct browser
tools remain denied even when their input has a field named `command`. Audit
records contain only input SHA-256 values, never command plaintext. The mode-
`0700` hook bytes, registrations, and reviewed browser configuration are
repaired every 30 seconds while unrelated settings are preserved.
The installer transaction removes direct browser MCPs, disables Codex and
Claude built-in browser controls, denies OpenClaw's dedicated browser tool, and
adds exactly one root Claude `chrome-bridge` entry. It preserves unrelated
configuration and secrets, file modes and ownership, creates protected backups,
validates the result, and rolls back all replaced configs on failure. Agent
configuration is changed only after browserd, the Safari broker, and the
enforcer pass readiness checks. Runtime files, the prior launchd service, and
the prior Safari broker session are snapshotted and restored if any later
installation phase fails.

All supervised Python paths use the absolute
`/opt/homebrew/bin/python3` interpreter (Python 3.11 or newer) with a clean
environment. This includes launchd, restart workers, the broker, peer helpers,
and both command hooks.

Human interaction has priority over concurrency. Browserd pauses both new and
existing agent page actions whenever Chrome is foreground-active, while lease
heartbeats and releases remain available. Work resumes on the same owned
background targets after the human lane becomes idle; agents never launch a
fallback browser.

Safari requests use short operation claims instead of idle lifetime claims.
Before every driver primitive, a service re-resolves its persistent ownership
marker and stable window identity; human reorder/close causes a safe rebase or
blocked response rather than an action against a stale ordinal.

Safari read-only control is served by a broker bound only to
`127.0.0.1:5591`. Its `/health`, `/presence`, and `/counts` routes accept only
the lane presence credential at
`~/Library/Application Support/ACTP/browser-enforcer/safari-presence.token`;
lane clients never receive a destructive credential. The installer runs the
broker inside the existing Apple-authorized tmux identity.

Browserd exposes destructive tab/drain operations only at
`~/Library/Application Support/ACTP/browserd/control.sock`; old TCP control
routes return 404 and the shared control token is retired. The socket parent is
mode `0700` and the socket is mode `0600`. Darwin peer attestation accepts only
the installed launchd enforcer or its exact direct restart child.

Destructive `/trim` and lane `/authorize` have no TCP or token fallback. They
are exposed only at the
private Unix socket `safari-trim.sock` in that same mode-`0700` runtime
directory. Before reading a trim body, the broker uses Darwin `LOCAL_PEERPID`
and requires the peer to be the exact installed `browser-enforcer.py` daemon:
the PID must own launchd label `com.isaiah.actp-browser-enforcer`, have PPID 1,
and use the pinned interpreter plus installed sibling policy. A fresh PID-bound
readiness receipt proves both private control planes before agent configuration
is committed. A marker-proven ACTP tab is eligible only when no fresh operation
claim protects it. The shared claims
lock remains held across the fresh registry read, native human-presence
recheck, stable `windowId` plus persistent `window.name` marker verification,
close, and atomic claim accounting. Missing, corrupt, duplicated, or otherwise
ambiguous ownership state denies the close.

Durable ownership lives in `/tmp/safari-tab-ownership.json`; the claims file
represents only in-flight operations. Released tabs remain marker-owned so they
can be safely reused or reclaimed without an idle heartbeat.

Apple Events are serialized so overlapping inspections and trims cannot race
Safari. Read requests have one absolute deadline and reject after a short
AppleEvent queue wait; destructive requests have a single 14-second deadline,
one worker slot, and may close at most two proven-idle tabs per request. The
broker rotates its logs and restarts with exponential backoff plus jitter if it
crashes. The enforcer recreates a missing tmux supervisor and replaces a
persistently unhealthy one only after a long degraded interval and restart
backoff. Installation verifies the presence token and Unix socket at mode
`0600` and tears down the new supervisor if readiness verification fails.

Safari control availability is reported separately as control health. A
permission denial or transient AppleScript timeout does not by itself trigger
a restart. Only sustained CPU, memory, process, root, and launch/control
integrity breaches are restart inputs; human tab/window excess is preserved.
Installation fails if authenticated Safari counts cannot be read through the
broker.

Every attributed Chrome descendant and LaunchServices-verified Safari WebKit
helper is continuously normalized to nice 8, so interactive work retains CPU
priority when the machine is busy. Chrome relaunch is denied when free disk is
below the reserved threshold. Daily cache maintenance may remove only exact
Chrome code-sign clone directories older than 24 hours that are not newest and
have no command or open-file reference.

This is strong user-space enforcement for installed ACTP, Codex, Claude, and
OpenClaw integrations. It is not MDM, Endpoint Security, or a kernel network
filter. An arbitrary third-party app can embed a WKWebView inside its own
process, which cannot be universally identified as a separate browser. Known
AI browser controls are disabled and unknown standalone web-handler roots are
stopped; universal containment of arbitrary embedded web views would require
OS management or network policy outside this repository.

Read-only checks use the pinned interpreter:

```bash
/opt/homebrew/bin/python3 ops/browser-enforcer.py status
/opt/homebrew/bin/python3 ops/browser-enforcer.py audit-config
```

Installation/configuration and human hold/release actions are human-terminal
operations. Controlled restart is launchd-owned because both maintenance
sockets attest its PID; agents cannot force a restart or supply another policy.

Logs and runtime state live under
`~/Library/Application Support/ACTP/browser-enforcer/`. The installed launchd
label is `com.isaiah.actp-browser-enforcer`.
