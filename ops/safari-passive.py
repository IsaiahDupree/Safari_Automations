#!/usr/bin/env python3
"""safari-passive.py — pause/resume PASSIVE (data-gathering) Safari services so an
ACTIVE Safari automation (ASC App Privacy publish, DM send, …) can drive the one
shared Safari without a background poller hijacking the tab. Then re-enable the
passive services automatically 30 min after the active work finishes.

Passive services are kept alive two ways, both handled here:
  • launchd KeepAlive jobs (e.g. market-research) -> bootout on pause, bootstrap on restore
  • watchdog-managed HTTP services (comments/sora/medium/…) -> killed on pause; the
    watchdog skips restarting them while the flag says paused (see watchdog-safari.sh)

Fail-safe: the flag ALWAYS carries an expiry. A detached GUARDIAN enforces the
pause and, when the deadline passes (resume_at, or the hard-cap if the caller
crashed before resume), restores everything and exits. Passive can never stick off.

Commands:
  pause  [--reason TXT] [--hardcap-min 90] [--all]   # stop passive now
  resume [--cooldown-min 30]                          # active done -> restore after N min
  status | is-paused | ports | clear | guardian
"""
import json, os, sys, time, subprocess, socket, argparse

FLAG = "/tmp/safari-passive-pause.json"
GUARD_PID = "/tmp/safari-passive-guardian.pid"
GUARD_LOG = "/tmp/safari-passive-guardian.log"
UID = os.getuid()
HERE = os.path.abspath(__file__)

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

def effective_paused(flag=None):
    """(paused: bool, resume_epoch: float|None, reason: str)."""
    flag = flag if flag is not None else read_flag()
    if not flag: return (False, None, "")
    t, state, reason = now(), flag.get("state"), flag.get("reason", "")
    if state == "active":
        hardcap = float(flag.get("hardcap_at", 0))
        return (True, hardcap, reason) if t < hardcap else (False, None, reason)
    if state == "cooldown":
        resume_at = float(flag.get("resume_at", 0))
        return (True, resume_at, reason) if t < resume_at else (False, None, reason)
    return (False, None, reason)

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
def spawn_guardian():
    # singleton: if a live guardian exists, leave it.
    try:
        with open(GUARD_PID) as f: pid = int(f.read().strip())
        os.kill(pid, 0); return  # already running
    except Exception:
        pass
    with open(GUARD_LOG, "a") as lf:
        p = subprocess.Popen([sys.executable, HERE, "guardian"], stdout=lf, stderr=lf,
                             start_new_session=True)
    with open(GUARD_PID, "w") as f: f.write(str(p.pid))

def cmd_guardian(args):
    with open(GUARD_PID, "w") as f: f.write(str(os.getpid()))
    print(f"[guardian] up pid={os.getpid()} {time.ctime()}", flush=True)
    while True:
        paused, resume_epoch, reason = effective_paused()
        if paused:
            flag = read_flag() or {}
            enforce_off(include_all=(flag.get("scope") == "all"))
            time.sleep(20)
            continue
        print(f"[guardian] deadline passed -> restoring passive services {time.ctime()}", flush=True)
        restore_all()
        try: os.remove(FLAG)
        except FileNotFoundError: pass
        try: os.remove(GUARD_PID)
        except FileNotFoundError: pass
        print("[guardian] restored; exiting", flush=True)
        return 0

# ---- commands --------------------------------------------------------------
def cmd_pause(args):
    flag = {"state": "active", "reason": args.reason, "since": now(),
            "hardcap_at": now() + args.hardcap_min * 60,
            "scope": "all" if args.all else "passive"}
    write_flag(flag)
    ld, ports = enforce_off(include_all=args.all)
    spawn_guardian()
    print(f"⏸  passive paused — reason: {args.reason}")
    print(f"   stopped launchd: {ld or 'none'}   stopped ports: {ports or 'none up'}")
    print(f"   guardian enforcing; hard-cap auto-restore at {hhmm(flag['hardcap_at'])} if resume() never runs.")
    return 0

def cmd_resume(args):
    flag = read_flag() or {"reason": "resume"}
    flag.update({"state": "cooldown", "resume_at": now() + args.cooldown_min * 60})
    write_flag(flag)
    spawn_guardian()  # ensure a guardian is watching for the deadline
    print(f"▶  active done — passive restores at {hhmm(flag['resume_at'])} "
          f"(+{args.cooldown_min} min). Guardian will bring them back.")
    return 0

def cmd_status(args):
    flag = read_flag()
    paused, resume_epoch, reason = effective_paused(flag)
    print(f"flag: {json.dumps(flag) if flag else '(none)'}")
    line = "PAUSED" if paused else "NORMAL (passive allowed)"
    if paused and resume_epoch:
        line += f" — restores {hhmm(resume_epoch)} ({int(resume_epoch-now())}s)"
    if reason: line += f" — reason: {reason}"
    print("effective:", line)
    g = "down"
    try:
        with open(GUARD_PID) as f: pid = int(f.read().strip())
        os.kill(pid, 0); g = f"up (pid {pid})"
    except Exception: pass
    print("guardian:", g)
    print("launchd passive:")
    for job in PASSIVE_LAUNCHD:
        print(f"  {job['label']}: {'loaded' if ld_loaded(job['label']) else 'stopped'}")
    print("passive ports:")
    for p in PASSIVE_PORTS:
        print(f"  {p}: {'UP' if port_up(p) else 'down'}")
    return 0

def cmd_is_paused(args):
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
    p = sub.add_parser("pause"); p.add_argument("--reason", default="active Safari automation")
    p.add_argument("--hardcap-min", type=int, default=90); p.add_argument("--all", action="store_true")
    r = sub.add_parser("resume"); r.add_argument("--cooldown-min", type=int, default=30)
    for c in ("status", "is-paused", "ports", "clear", "guardian"): sub.add_parser(c)
    args = ap.parse_args()
    return {"pause": cmd_pause, "resume": cmd_resume, "status": cmd_status,
            "is-paused": cmd_is_paused, "ports": cmd_ports, "clear": cmd_clear,
            "guardian": cmd_guardian}[args.cmd](args)

if __name__ == "__main__":
    sys.exit(main())
