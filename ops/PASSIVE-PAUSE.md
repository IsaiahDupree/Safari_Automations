# Passive-pause coordination for active Safari automation

**Problem:** there is exactly one shared Safari. Passive, timer-driven services
(market-research, comment harvesters, sora/medium pollers) autonomously drive
Safari to gather data. When an *active* automation needs Safari (ASC App Privacy
publish, DM send, review submit), a passive poller can hijack the tab mid-flow.

**Solution:** `ops/safari-passive.py` — pause the passive services for the active
run, then re-enable them automatically **30 min after** the active work finishes.

```bash
python3 ops/safari-passive.py pause  --reason "ASC App Privacy"   # stop passive now
#   ... run the active Safari automation ...
python3 ops/safari-passive.py resume --cooldown-min 30            # restore after 30 min
python3 ops/safari-passive.py status        # what's paused, guardian, resume ETA
python3 ops/safari-passive.py clear         # immediate restore (abort the pause)
```

## How it works (fail-safe)
- **launchd KeepAlive jobs** (market-research): `bootout` on pause, `bootstrap` on restore.
- **watchdog-managed HTTP services** (comment harvesters, sora, medium): killed on
  pause; `watchdog-safari.sh` reads the flag (`is-paused`) and **skips restarting**
  the passive ports while paused.
- A detached **guardian** enforces the pause (re-stops anything that respawns) and,
  when the deadline passes, restores everything and exits.
- The flag (`/tmp/safari-passive-pause.json`) **always carries an expiry**
  (`resume_at`, or a `hardcap_at` if the caller crashes before `resume`), so passive
  services can never be stuck off. Worst case they auto-restore at the hard cap.

## Passive vs on-demand
Paused (passive data-gatherers): ports 3005/3006/3007/3004/3008 (comments), 3106
(market-research, launchd), 3107 (upwork), 7070 (sora), 3108 (medium).
Left running (on-demand, only touch Safari when called): DM ports 3100/3003/3102/3105
(use `pause --all` to include these too).

## Wired into
`asc-resolution-center/finish_fleet.py` calls `pause` before its ASC run and
`resume --cooldown-min 30` in a `finally`, so the whole ASC submit flow is
automatically conflict-free.
