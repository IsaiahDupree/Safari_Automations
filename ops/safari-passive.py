#!/usr/bin/env python3
"""safari-passive.py — keep PASSIVE (background data-gathering) Safari services out of
the way of ACTIVE work, whether that active work is an AGENT/service or a HUMAN.

Passive services are timer-driven pollers that autonomously drive the one shared
Safari (market-research, comments harvesters, …). This tool pauses them so they can't
hijack the tab mid-task, then auto-restores them after a cooldown. Passive can NEVER
stick off — every pause carries an expiry a detached GUARDIAN enforces and lifts.

Two ways passive gets paused automatically (both → a 2-hour cooldown afterwards):

  1. ACTIVE AGENT/SERVICE WORK — an agent takes a LEASE around its Safari work:
        safari-passive.py active-begin --who ig-sync --reason "IG DM send"
        …do the active Safari work…
        safari-passive.py active-end   --who ig-sync            # → 2h cooldown
     Python callers: `with safari_passive.active("ig-sync", "IG DM send"): ...`
     Passive stays paused while ANY lease is held (refcounted), then 2h after the last
     one releases. A crashed holder can't stick passive off — each lease has a hard-cap.

  2. HUMAN USING SAFARI — the `watch` daemon detects a real person actually using
     Safari (recent HID keyboard/mouse input while Safari is frontmost, and/or tabs
     being opened) and pauses passive with a rolling 2h window. It distinguishes human
     from agent by HID input (agents drive via AppleScript and generate ZERO HID
     events) and never reads tab URLs/content — only input-idle time, the frontmost app
     name, and tab COUNTS.

Manual/legacy commands (still work): pause / resume / status / is-paused / ports / clear.

Commands:
  active-begin --who ID [--reason TXT] [--hardcap-min 120] [--all]
  active-end   --who ID [--cooldown-min 120]
  human        [--window-min 120]         # mark human activity now (what `watch` calls)
  watch        [--interval 5] [--input-window 120] [--window-min 120]   # the always-on detector
  install-watch / uninstall-watch          # (un)load the watcher as a launchd KeepAlive job
  pause  [--reason TXT] [--hardcap-min 90] [--all]
  resume [--cooldown-min 120]
  status | is-paused | ports | clear | guardian
"""
import json, os, sys, time, subprocess, socket, argparse, re, fcntl
from contextlib import contextmanager

FLAG = "/tmp/safari-passive-pause.json"
GUARD_PID = "/tmp/safari-passive-guardian.pid"
GUARD_LOG = "/tmp/safari-passive-guardian.log"
WATCH_PID = "/tmp/safari-passive-watch.pid"
WATCH_LABEL = "com.isaiah.safari-passive.watch"
UID = os.getuid()
HERE = os.path.abspath(__file__)

DEFAULT_COOLDOWN_MIN = 120       # 2h passive-off window after active work / human use
DEFAULT_HARDCAP_MIN = 120        # per-lease safety cap so a crashed holder can't stick
DEFAULT_INPUT_WINDOW_SEC = 300   # a human whose last HID input was <5 min ago (Safari frontmost) counts as "using it"

# Passive, timer-driven data-gatherers that autonomously drive Safari (watchdog-managed HTTP).
PASSIVE_PORTS = [3005, 3006, 3007, 3004, 3008, 3106, 3107, 7070, 3108]
ONDEMAND_PORTS = [3100, 3003, 3102, 3105]  # DM services: only touch Safari when called
# launchd KeepAlive jobs that gather passively.
LA_DIR = os.path.expanduser("~/Library/LaunchAgents")
PASSIVE_LAUNCHD = [
    {"label": "com.isaiah.safari-automation.market-research",
     "plist": os.path.join(LA_DIR, "com.isaiah.safari-automation.market-research.plist")},
]

def now(): return time.time()
def hhmm(t): return time.strftime("%H:%M:%S", time.localtime(t))

def read_flag():
    try:
        with open(FLAG) as f: return json.load(f)
    except Exception:
        return None

def write_flag(d):
    tmp = FLAG + ".tmp"
    with open(tmp, "w") as f: json.dump(d, f, indent=2)
    os.replace(tmp, FLAG)

LOCK = "/tmp/safari-passive.lock"

@contextmanager
def _flock():
    """Serialize flag read-modify-write across concurrent agents/services taking
    leases at the same instant (otherwise one active-begin could clobber another's
    holder). Only the quick flag mutation runs under the lock; slow enforce/guardian
    work happens after release."""
    f = open(LOCK, "w")
    try:
        fcntl.flock(f, fcntl.LOCK_EX)
        yield
    finally:
        try: fcntl.flock(f, fcntl.LOCK_UN)
        finally: f.close()

def live_holders(flag):
    """Active leases whose safety hard-cap hasn't lapsed (a crashed holder auto-expires)."""
    t = now()
    return {w: h for w, h in (flag.get("holders") or {}).items()
            if t < float(h.get("hardcap_at", 0))}

def effective_paused(flag=None):
    """(paused: bool, resume_epoch: float|None, reason: str).

    Paused if any active lease is live (agent work), OR the manual `active` hard-cap is
    still in force, OR we're inside a cooldown (post-active / human) window. Whichever
    keeps passive off the LONGEST wins, so a human window can't be cut short by an
    agent releasing its lease and vice-versa."""
    flag = flag if flag is not None else read_flag()
    if not flag: return (False, None, "")
    t, state, reason = now(), flag.get("state"), flag.get("reason", "")
    candidates = []  # (resume_epoch, reason)
    live = live_holders(flag)
    if live:
        candidates.append((max(float(h["hardcap_at"]) for h in live.values()),
                           reason or f"active agent work: {', '.join(live)}"))
    if state == "active":
        candidates.append((float(flag.get("hardcap_at", 0)), reason))
    if state == "cooldown":
        candidates.append((float(flag.get("resume_at", 0)), reason))
    live_c = [(e, r) for e, r in candidates if t < e]
    if not live_c:
        return (False, None, reason)
    e, r = max(live_c, key=lambda x: x[0])
    return (True, e, r)

# ---- ports -----------------------------------------------------------------
def port_up(port, timeout=1.0):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout): return True
    except OSError:
        return False

def kill_port(port):
    try:
        pids = subprocess.run(["lsof", "-ti", f"tcp:{port}"], capture_output=True, text=True, timeout=8).stdout.split()
    except Exception:
        pids = []
    for pid in pids:
        subprocess.run(["kill", "-TERM", pid], timeout=5)
    if pids:
        time.sleep(1.0)
        for pid in pids:
            try: os.kill(int(pid), 0); subprocess.run(["kill", "-KILL", pid], timeout=5)
            except Exception: pass
    return pids

# ---- launchd ---------------------------------------------------------------
def ld_loaded(label):
    r = subprocess.run(["launchctl", "list"], capture_output=True, text=True, timeout=8).stdout
    return any(line.endswith(label) or f"\t{label}" in line for line in r.splitlines())

def ld_bootout(job):
    subprocess.run(["launchctl", "bootout", f"gui/{UID}/{job['label']}"], capture_output=True, text=True, timeout=15)

def ld_bootstrap(job):
    if os.path.exists(job["plist"]):
        subprocess.run(["launchctl", "bootstrap", f"gui/{UID}", job["plist"]], capture_output=True, text=True, timeout=15)

# ---- enforce / restore -----------------------------------------------------
def enforce_off(include_all=False):
    """Stop everything passive right now."""
    stopped_ld, stopped_ports = [], []
    for job in PASSIVE_LAUNCHD:
        if ld_loaded(job["label"]):
            ld_bootout(job); stopped_ld.append(job["label"])
    ports = PASSIVE_PORTS + (ONDEMAND_PORTS if include_all else [])
    for p in ports:
        if port_up(p):
            kill_port(p); stopped_ports.append(p)
    return stopped_ld, stopped_ports

def restore_all():
    for job in PASSIVE_LAUNCHD:
        if not ld_loaded(job["label"]):
            ld_bootstrap(job)
    # watchdog-managed HTTP services are restored by the watchdog once the flag clears.

# ---- guardian --------------------------------------------------------------
def _guardian_alive():
    """True only if GUARD_PID names a LIVE process that is really our guardian — a
    ps-cmdline check so a reused PID can't masquerade as the guardian and block a respawn."""
    try:
        with open(GUARD_PID) as f: pid = int(f.read().strip())
        os.kill(pid, 0)
        out = subprocess.run(["ps", "-p", str(pid), "-o", "command="],
                             capture_output=True, text=True, timeout=4).stdout
        return "safari-passive" in out and "guardian" in out
    except Exception:
        return False

def spawn_guardian():
    # Serialize the check-and-spawn so two concurrent callers can't both spawn, and a
    # dying guardian's stale PID can't block a needed respawn.
    with _flock():
        if _guardian_alive(): return  # a real guardian is already running
        with open(GUARD_LOG, "a") as lf:
            p = subprocess.Popen([sys.executable, HERE, "guardian"], stdout=lf, stderr=lf,
                                 start_new_session=True)
        with open(GUARD_PID, "w") as f: f.write(str(p.pid))

def cmd_guardian(args):
    with open(GUARD_PID, "w") as f: f.write(str(os.getpid()))
    print(f"[guardian] up pid={os.getpid()} {time.ctime()}", flush=True)
    while True:
        try:
            paused, resume_epoch, reason = effective_paused()
            if paused:
                flag = read_flag() or {}
                enforce_off(include_all=(flag.get("scope") == "all"))
                time.sleep(20)
                continue
            # Deadline passed. Re-check + tear down entirely UNDER the lock (incl. GUARD_PID,
            # and only if it's still ours) so a lease/human write landing this instant isn't
            # lost and a concurrent active-begin's singleton check isn't fooled by our dying pid.
            with _flock():
                paused2, _, _ = effective_paused()
                if paused2:
                    continue
                print(f"[guardian] deadline passed -> restoring passive services {time.ctime()}", flush=True)
                restore_all()
                try: os.remove(FLAG)
                except FileNotFoundError: pass
                try:
                    with open(GUARD_PID) as gf: mine = gf.read().strip() == str(os.getpid())
                    if mine: os.remove(GUARD_PID)
                except FileNotFoundError: pass
            print("[guardian] restored; exiting", flush=True)
            return 0
        except Exception as e:  # the guardian is the sole restorer — never let it die on a transient error
            print(f"[guardian] err (continuing): {e}", flush=True)
            time.sleep(20)

# ---- active leases (agents / services) -------------------------------------
def _active_begin(who, reason, hardcap_min, scope_all):
    with _flock():
        flag = read_flag() or {}
        holders = flag.get("holders") or {}
        holders[who] = {"reason": reason, "since": now(), "hardcap_at": now() + hardcap_min * 60}
        scope = "all" if scope_all else flag.get("scope", "passive")
        flag.update({"state": flag.get("state", "active"), "reason": reason, "holders": holders,
                     "trigger": "agent", "scope": scope, "since": flag.get("since", now())})
        write_flag(flag)
        hardcap_at = holders[who]["hardcap_at"]; names = list(holders)
    spawn_guardian()  # create the RESTORER before any destructive kill (fail-safe order)
    ld, ports = enforce_off(include_all=(scope == "all"))
    return hardcap_at, ld, ports, names

def _active_end(who, cooldown_min):
    with _flock():
        flag = read_flag() or {}
        holders = flag.get("holders") or {}
        holders.pop(who, None)
        flag["holders"] = holders
        if live_holders(flag):
            write_flag(flag)
            return None, list(holders)
        # last lease gone → cooldown, but never shorten an already-longer window (e.g. a human one).
        resume_at = max(now() + cooldown_min * 60, float(flag.get("resume_at", 0)))
        flag.update({"state": "cooldown", "resume_at": resume_at,
                     "reason": f"{cooldown_min}m cooldown after active work"})
        write_flag(flag)
    spawn_guardian()
    return resume_at, []

def cmd_active_begin(args):
    hardcap_at, ld, ports, holders = _active_begin(args.who, args.reason, args.hardcap_min, args.all)
    print(f"⏸  active lease '{args.who}' — passive paused for active work. reason: {args.reason}")
    print(f"   holders: {holders}   stopped launchd: {ld or 'none'}   stopped ports: {ports or 'none up'}")
    print(f"   safety hard-cap {hhmm(hardcap_at)} (auto-releases if this lease never ends).")
    return 0

def cmd_active_end(args):
    resume_at, holders = _active_end(args.who, args.cooldown_min)
    if resume_at is None:
        print(f"▶  lease '{args.who}' released; still active for: {holders}")
    else:
        print(f"▶  last active lease released → passive stays paused {args.cooldown_min} min "
              f"(restores {hhmm(resume_at)}).")
    return 0

@contextmanager
def active(who, reason="active Safari work", hardcap_min=DEFAULT_HARDCAP_MIN,
           cooldown_min=DEFAULT_COOLDOWN_MIN, scope_all=False):
    """Python helper: `with safari_passive.active("ig-sync", "IG DM send"): ...`
    Pauses passive for the duration, then a 2h cooldown."""
    _active_begin(who, reason, hardcap_min, scope_all)
    try:
        yield
    finally:
        _active_end(who, cooldown_min)

# ---- human detection -------------------------------------------------------
def _hid_idle_seconds():
    """Seconds since the last real HID (keyboard/mouse) input, or None if unknown.
    Agents drive Safari via AppleScript and generate ZERO HID input, so a LOW idle time
    while Safari is frontmost is the signal that a *human* is actually using Safari."""
    try:
        out = subprocess.run(["ioreg", "-c", "IOHIDSystem"], capture_output=True, text=True, timeout=4).stdout
        m = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', out)
        if m:
            return int(m.group(1)) / 1e9
    except Exception:
        pass
    return None

def _frontmost_app():
    try:
        return subprocess.run(["osascript", "-e",
            'tell application "System Events" to get name of first application process whose frontmost is true'],
            capture_output=True, text=True, timeout=4).stdout.strip()
    except Exception:
        return ""

def _safari_running():
    try:
        out = subprocess.run(["osascript", "-e",
            'tell application "System Events" to (name of processes) contains "Safari"'],
            capture_output=True, text=True, timeout=4).stdout.strip()
        return out == "true"
    except Exception:
        return False

def _safari_tab_count():
    """Total Safari tab count across windows — a NUMBER only, never URLs/content. Only
    queried when Safari is already running (so we never launch it). None on error."""
    if not _safari_running():
        return None
    script = ('tell application "Safari"\n'
              'set t to 0\n'
              'repeat with w in windows\n'
              'set t to t + (count of tabs of w)\n'
              'end repeat\n'
              'return t as string\n'
              'end tell')
    try:
        out = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=6).stdout.strip()
        return int(out) if out.isdigit() else None
    except Exception:
        return None

def _mark_human(window_min, reason="human using Safari (auto-detected)"):
    """Roll the passive-off window out to now+window_min (never shorten). Enforce
    immediately on the first transition; the guardian keeps it enforced + auto-restores."""
    with _flock():
        flag = read_flag() or {"scope": "passive"}
        was_paused, _, _ = effective_paused(flag)
        resume_at = max(now() + window_min * 60, float(flag.get("resume_at", 0)) if flag.get("state") == "cooldown" else 0)
        flag.update({"state": "cooldown", "resume_at": resume_at, "reason": reason, "trigger": "human",
                     "scope": flag.get("scope", "passive")})
        write_flag(flag)
        scope_all = (flag.get("scope") == "all")
    spawn_guardian()  # restorer before any kill (fail-safe order)
    if not was_paused:
        enforce_off(include_all=scope_all)
    return resume_at

def cmd_human(args):
    r = _mark_human(args.window_min)
    print(f"⏸  human Safari use → passive paused, restores {hhmm(r)} (rolling +{args.window_min}m).")
    return 0

def _detect_human(input_window, last_tabs):
    """(is_human, tab_count). A human is 'actually using Safari' when Safari is the
    frontmost app AND there was recent real HID input. HID is the ONLY human-vs-agent
    discriminator (agents drive via AppleScript → zero HID), so tab-count alone is NEVER
    treated as human — a passive agent that opens a tab while Safari happens to be
    frontmost must not trip this. Tab count is tracked only for observability."""
    is_safari = (_frontmost_app() == "Safari")
    if not is_safari:
        return False, last_tabs
    idle = _hid_idle_seconds()
    tabs = _safari_tab_count()
    recent_input = idle is not None and idle < input_window
    return recent_input, (tabs if tabs is not None else last_tabs)

def cmd_watch(args):
    with open(WATCH_PID, "w") as f: f.write(str(os.getpid()))
    print(f"[watch] up pid={os.getpid()} interval={args.interval}s input-window={args.input_window}s "
          f"window={args.window_min}m {time.ctime()}", flush=True)
    last_tabs = None
    while True:
        try:
            flag = read_flag() or {}
            # Liveness backstop: if passive is paused but the detached guardian died, the
            # always-on watcher respawns it so passive still gets auto-restored.
            paused, _, _ = effective_paused(flag)
            if paused and not _guardian_alive():
                spawn_guardian()
            # If an agent lease is active, Safari activity is expected/agent-driven — don't
            # treat it as human (and the lease already keeps passive paused).
            if not live_holders(flag):
                is_human, last_tabs = _detect_human(args.input_window, last_tabs)
                if is_human:
                    r = _mark_human(args.window_min)
                    print(f"[watch] human Safari use detected → passive off until {hhmm(r)}", flush=True)
            else:
                last_tabs = None  # reset delta tracking across agent work
        except Exception as e:  # never let the detector die
            print(f"[watch] err: {e}", flush=True)
        time.sleep(max(2, args.interval))

# ---- watcher install (launchd KeepAlive) -----------------------------------
WATCH_PLIST = os.path.join(LA_DIR, f"{WATCH_LABEL}.plist")

def cmd_install_watch(args):
    plist = f'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{WATCH_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>{sys.executable}</string><string>{HERE}</string><string>watch</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/safari-passive-watch.log</string>
  <key>StandardErrorPath</key><string>/tmp/safari-passive-watch.log</string>
</dict></plist>
'''
    os.makedirs(LA_DIR, exist_ok=True)
    with open(WATCH_PLIST, "w") as f: f.write(plist)
    subprocess.run(["launchctl", "bootout", f"gui/{UID}/{WATCH_LABEL}"], capture_output=True, text=True)
    r = subprocess.run(["launchctl", "bootstrap", f"gui/{UID}", WATCH_PLIST], capture_output=True, text=True)
    ok = ld_loaded(WATCH_LABEL)
    print(f"{'✓ installed + loaded' if ok else '⚠ wrote plist but load reported'}: {WATCH_LABEL}")
    if r.stderr.strip(): print(f"  launchctl: {r.stderr.strip()[:160]}")
    return 0 if ok else 1

def cmd_uninstall_watch(args):
    subprocess.run(["launchctl", "bootout", f"gui/{UID}/{WATCH_LABEL}"], capture_output=True, text=True)
    try: os.remove(WATCH_PLIST)
    except FileNotFoundError: pass
    print(f"✓ unloaded + removed {WATCH_LABEL}")
    return 0

# ---- lazy restore backstop -------------------------------------------------
def _lazy_restore_if_expired():
    """Read-path backstop: if a paused flag lingers but its window has fully lapsed (e.g.
    the guardian died AND no watcher respawned it — or after a reboot), restore passive and
    clear the flag. Guarantees the deadline-passed restore isn't gated solely on a live guardian."""
    flag = read_flag()
    if not flag: return
    if effective_paused(flag)[0]: return
    with _flock():
        flag = read_flag()
        if not flag or effective_paused(flag)[0]: return
        restore_all()
        try: os.remove(FLAG)
        except FileNotFoundError: pass

# ---- manual pause / resume (legacy, still supported) -----------------------
def cmd_pause(args):
    # Lock + merge into the existing flag so a concurrent active lease's holders survive a
    # manual pause. spawn_guardian BEFORE enforce_off (fail-safe order).
    with _flock():
        flag = read_flag() or {}
        hardcap_at = max(now() + args.hardcap_min * 60, float(flag.get("hardcap_at", 0)))
        flag.update({"state": "active", "reason": args.reason, "since": flag.get("since", now()),
                     "hardcap_at": hardcap_at, "trigger": "manual",
                     "scope": "all" if args.all else flag.get("scope", "passive"),
                     "holders": flag.get("holders") or {}})
        write_flag(flag)
    spawn_guardian()
    ld, ports = enforce_off(include_all=args.all)
    print(f"⏸  passive paused — reason: {args.reason}")
    print(f"   stopped launchd: {ld or 'none'}   stopped ports: {ports or 'none up'}")
    print(f"   guardian enforcing; hard-cap auto-restore at {hhmm(hardcap_at)} if resume() never runs.")
    return 0

def cmd_resume(args):
    with _flock():
        flag = read_flag() or {"reason": "resume"}
        flag.update({"state": "cooldown", "resume_at": max(now() + args.cooldown_min * 60, float(flag.get("resume_at", 0)))})
        write_flag(flag)
        resume_at = flag["resume_at"]
    spawn_guardian()  # ensure a guardian is watching for the deadline
    print(f"▶  active done — passive restores at {hhmm(resume_at)} "
          f"(+{args.cooldown_min} min). Guardian will bring them back.")
    return 0

def cmd_status(args):
    _lazy_restore_if_expired()
    flag = read_flag()
    paused, resume_epoch, reason = effective_paused(flag)
    print(f"flag: {json.dumps(flag) if flag else '(none)'}")
    line = "PAUSED" if paused else "NORMAL (passive allowed)"
    if paused and resume_epoch:
        line += f" — restores {hhmm(resume_epoch)} ({int(resume_epoch-now())}s)"
    if reason: line += f" — reason: {reason}"
    print("effective:", line)
    if flag:
        live = live_holders(flag)
        if live: print("active leases:", {w: hhmm(float(h['hardcap_at'])) for w, h in live.items()})
        if flag.get("trigger"): print("trigger:", flag.get("trigger"))
    def _alive(pidfile):
        try:
            with open(pidfile) as f: pid = int(f.read().strip())
            os.kill(pid, 0); return f"up (pid {pid})"
        except Exception: return "down"
    print("guardian:", _alive(GUARD_PID))
    print("watcher:", ("loaded (launchd)" if ld_loaded(WATCH_LABEL) else _alive(WATCH_PID)))
    print("launchd passive:")
    for job in PASSIVE_LAUNCHD:
        print(f"  {job['label']}: {'loaded' if ld_loaded(job['label']) else 'stopped'}")
    print("passive ports:")
    for p in PASSIVE_PORTS:
        print(f"  {p}: {'UP' if port_up(p) else 'down'}")
    return 0

def cmd_is_paused(args):
    _lazy_restore_if_expired()
    paused, resume_epoch, reason = effective_paused()
    if paused:
        print(f"PAUSED {int(resume_epoch or 0)} {reason}"); return 0
    print("NORMAL"); return 1

def cmd_ports(args):
    print(" ".join(str(p) for p in PASSIVE_PORTS)); return 0

def cmd_clear(args):
    try: os.remove(FLAG)
    except FileNotFoundError: pass
    restore_all()
    print("cleared — passive restored to normal operation."); return 0

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    ab = sub.add_parser("active-begin"); ab.add_argument("--who", required=True)
    ab.add_argument("--reason", default="active Safari work")
    ab.add_argument("--hardcap-min", type=int, default=DEFAULT_HARDCAP_MIN)
    ab.add_argument("--all", action="store_true")
    ae = sub.add_parser("active-end"); ae.add_argument("--who", required=True)
    ae.add_argument("--cooldown-min", type=int, default=DEFAULT_COOLDOWN_MIN)

    hu = sub.add_parser("human"); hu.add_argument("--window-min", type=int, default=DEFAULT_COOLDOWN_MIN)
    w = sub.add_parser("watch")
    w.add_argument("--interval", type=int, default=5)
    w.add_argument("--input-window", type=int, default=DEFAULT_INPUT_WINDOW_SEC)
    w.add_argument("--window-min", type=int, default=DEFAULT_COOLDOWN_MIN)
    sub.add_parser("install-watch"); sub.add_parser("uninstall-watch")

    p = sub.add_parser("pause"); p.add_argument("--reason", default="active Safari automation")
    p.add_argument("--hardcap-min", type=int, default=90); p.add_argument("--all", action="store_true")
    r = sub.add_parser("resume"); r.add_argument("--cooldown-min", type=int, default=DEFAULT_COOLDOWN_MIN)
    for c in ("status", "is-paused", "ports", "clear", "guardian"): sub.add_parser(c)

    args = ap.parse_args()
    return {"active-begin": cmd_active_begin, "active-end": cmd_active_end,
            "human": cmd_human, "watch": cmd_watch,
            "install-watch": cmd_install_watch, "uninstall-watch": cmd_uninstall_watch,
            "pause": cmd_pause, "resume": cmd_resume, "status": cmd_status,
            "is-paused": cmd_is_paused, "ports": cmd_ports, "clear": cmd_clear,
            "guardian": cmd_guardian}[args.cmd](args)

if __name__ == "__main__":
    sys.exit(main())
