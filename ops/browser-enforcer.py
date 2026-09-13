#!/opt/homebrew/bin/python3
"""Chrome-only resource guard retained at the legacy compatibility path.

This program intentionally has no knowledge of Safari, Waterfox, Firefox,
Orion, WebKit, Playwright, Puppeteer, human-presence state, screen locks,
remote browsers, agent tools, or agent configuration. Its sole job is to keep
the local canonical Google Chrome process inside resource limits that protect
the Mac from the historical Chrome CPU runaway/restart failure.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import time
from typing import Any
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = ROOT / "config" / "browser-policy.json"
RUNTIME_DIR = Path.home() / "Library" / "Application Support" / "ACTP" / "browser-enforcer"
RUNTIME_PROGRAM = RUNTIME_DIR / "browser-enforcer.py"
RUNTIME_POLICY = RUNTIME_DIR / "browser-policy.json"
STATE_FILE = RUNTIME_DIR / "chrome-resource-state.json"
LOG_FILE = RUNTIME_DIR / "chrome-resource-guard.log"
LOCK_FILE = RUNTIME_DIR / "chrome-resource-guard.lock"
LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / "com.isaiah.actp-browser-enforcer.plist"
LABEL = "com.isaiah.actp-browser-enforcer"
TRUSTED_PYTHON = "/opt/homebrew/bin/python3"


def utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def log(message: str) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(f"[{utc_now()}] {message}\n")


def load_policy(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    chrome = value.get("chrome")
    required = {
        "binary", "canonical_data_dir", "debug_port", "max_root_processes",
        "max_tabs", "max_total_processes", "max_rss_mb", "max_cpu_percent",
        "nice", "renderer_process_limit",
    }
    if not isinstance(chrome, dict) or not required.issubset(chrome):
        raise ValueError("Chrome resource policy is incomplete")
    return value


def load_state() -> dict[str, Any]:
    try:
        value = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        value = {}
    return {
        "breach_samples": int(value.get("breach_samples", 0) or 0),
        "last_restart": float(value.get("last_restart", 0) or 0),
        "last_check": value.get("last_check"),
        "last_reason": value.get("last_reason"),
    }


def save_state(state: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    temporary = STATE_FILE.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    temporary.replace(STATE_FILE)


def process_table() -> list[dict[str, Any]]:
    result = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,pcpu=,rss=,command="],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    )
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 4)
        if len(parts) != 5:
            continue
        try:
            rows.append({
                "pid": int(parts[0]),
                "ppid": int(parts[1]),
                "cpu": float(parts[2]),
                "rss_kb": int(parts[3]),
                "command": parts[4],
            })
        except ValueError:
            continue
    return rows


def chrome_roots(rows: list[dict[str, Any]], policy: dict[str, Any]) -> list[dict[str, Any]]:
    binary = str(policy["chrome"]["binary"])
    return [row for row in rows if row["command"] == binary or row["command"].startswith(binary + " ")]


def canonical_root(row: dict[str, Any], policy: dict[str, Any]) -> bool:
    command = row["command"]
    data_dir = str(Path(policy["chrome"]["canonical_data_dir"]).resolve())
    debug_port = str(int(policy["chrome"]["debug_port"]))
    return (
        f"--user-data-dir={data_dir}" in command
        and f"--remote-debugging-port={debug_port}" in command
    )


def chrome_tree(rows: list[dict[str, Any]], roots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    members = {row["pid"] for row in roots}
    changed = True
    while changed:
        changed = False
        for row in rows:
            if row["pid"] not in members and row["ppid"] in members:
                members.add(row["pid"])
                changed = True
    return [row for row in rows if row["pid"] in members]


def cdp_json(policy: dict[str, Any], route: str) -> Any:
    port = int(policy["chrome"]["debug_port"])
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        headers={"User-Agent": "ACTP-Chrome-Resource-Guard/1"},
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.loads(response.read().decode("utf-8"))


def inspect(policy: dict[str, Any]) -> dict[str, Any]:
    rows = process_table()
    roots = chrome_roots(rows, policy)
    canonical = [row for row in roots if canonical_root(row, policy)]
    tree = chrome_tree(rows, roots)
    try:
        tabs = sum(1 for item in cdp_json(policy, "/json/list") if item.get("type") == "page")
        cdp_available = True
    except Exception:
        tabs = 0
        cdp_available = False
    snapshot = {
        "root_pids": [row["pid"] for row in roots],
        "canonical_pids": [row["pid"] for row in canonical],
        "processes": len(tree),
        "cpu_percent": round(sum(row["cpu"] for row in tree), 1),
        "rss_mb": round(sum(row["rss_kb"] for row in tree) / 1024, 1),
        "tabs": tabs,
        "cdp_available": cdp_available,
    }
    snapshot["policy_violations"] = violations(snapshot, policy)
    return {"chrome": snapshot, "policy": policy["chrome"]}


def violations(snapshot: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    cfg = policy["chrome"]
    reasons: list[str] = []
    if cfg.get("enabled", True) and not snapshot["root_pids"]:
        reasons.append("root_processes=0<1")
    if len(snapshot["root_pids"]) > int(cfg["max_root_processes"]):
        reasons.append(f"root_processes={len(snapshot['root_pids'])}>{cfg['max_root_processes']}")
    if snapshot["root_pids"] and len(snapshot["canonical_pids"]) != 1:
        reasons.append("canonical_profile_unavailable")
    if int(snapshot["processes"]) > int(cfg["max_total_processes"]):
        reasons.append(f"processes={snapshot['processes']}>{cfg['max_total_processes']}")
    if float(snapshot["rss_mb"]) > float(cfg["max_rss_mb"]):
        reasons.append(f"rss_mb={snapshot['rss_mb']}>{cfg['max_rss_mb']}")
    if float(snapshot["cpu_percent"]) > float(cfg["max_cpu_percent"]):
        reasons.append(f"cpu={snapshot['cpu_percent']}>{cfg['max_cpu_percent']}")
    if int(snapshot["tabs"]) > int(cfg["max_tabs"]):
        reasons.append(f"tabs={snapshot['tabs']}>{cfg['max_tabs']}")
    if snapshot["root_pids"] and not snapshot["cdp_available"]:
        reasons.append("cdp_unavailable")
    return reasons


def terminate(pids: list[int], grace_seconds: float = 8) -> None:
    for pid in sorted(set(pids), reverse=True):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + grace_seconds
    while time.time() < deadline:
        alive = [pid for pid in pids if Path(f"/proc/{pid}").exists()] if sys.platform != "darwin" else [
            pid for pid in pids if subprocess.run(["kill", "-0", str(pid)], capture_output=True).returncode == 0
        ]
        if not alive:
            return
        time.sleep(0.25)
    for pid in sorted(set(pids), reverse=True):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def normalize_priority(snapshot: dict[str, Any], policy: dict[str, Any]) -> None:
    target = int(policy["chrome"].get("nice", 8))
    for pid in snapshot["chrome"]["root_pids"]:
        try:
            os.setpriority(os.PRIO_PROCESS, int(pid), target)
        except (OSError, PermissionError, ProcessLookupError):
            pass


def launch_chrome(policy: dict[str, Any]) -> int:
    cfg = policy["chrome"]
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    output = (RUNTIME_DIR / "chrome.log").open("a", encoding="utf-8")
    process = subprocess.Popen(
        [
            str(cfg["binary"]),
            f"--remote-debugging-port={int(cfg['debug_port'])}",
            "--remote-allow-origins=*",
            f"--user-data-dir={Path(cfg['canonical_data_dir']).resolve()}",
            "--profile-directory=Default",
            "--no-first-run",
            "--no-default-browser-check",
            f"--renderer-process-limit={int(cfg['renderer_process_limit'])}",
        ],
        stdin=subprocess.DEVNULL,
        stdout=output,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    log(f"launched canonical Chrome pid={process.pid}")
    return process.pid


def ensure_chrome(policy: dict[str, Any]) -> bool:
    snapshot = inspect(policy)["chrome"]
    if len(snapshot["canonical_pids"]) == 1 and snapshot["cdp_available"]:
        normalize_priority({"chrome": snapshot}, policy)
        return True
    if snapshot["root_pids"]:
        log(f"replacing noncanonical/unavailable Chrome roots={snapshot['root_pids']}")
        terminate(snapshot["root_pids"])
    launch_chrome(policy)
    deadline = time.time() + 20
    while time.time() < deadline:
        current = inspect(policy)["chrome"]
        if len(current["canonical_pids"]) == 1 and current["cdp_available"]:
            normalize_priority({"chrome": current}, policy)
            return True
        time.sleep(0.5)
    return False


def restart_chrome(policy: dict[str, Any], reason: str) -> bool:
    snapshot = inspect(policy)["chrome"]
    if snapshot["root_pids"]:
        log(f"restarting Chrome reason={reason} roots={snapshot['root_pids']}")
        terminate(snapshot["root_pids"])
    time.sleep(max(0, int(policy.get("cooldown_seconds", 45))))
    ok = ensure_chrome(policy)
    state = load_state()
    state.update({"breach_samples": 0, "last_restart": time.time(), "last_reason": reason})
    save_state(state)
    return ok


def enforce_once(policy: dict[str, Any]) -> dict[str, Any]:
    if policy["chrome"].get("enabled", True):
        ensure_chrome(policy)
    snapshot = inspect(policy)
    normalize_priority(snapshot, policy)
    reasons = snapshot["chrome"]["policy_violations"]
    state = load_state()
    restart_reasons = [reason for reason in reasons if not reason.startswith("root_processes=0")]
    state["breach_samples"] = state["breach_samples"] + 1 if restart_reasons else 0
    state["last_check"] = utc_now()
    state["last_reason"] = "; ".join(restart_reasons) if restart_reasons else None
    required = int(policy.get("sustained_breach_samples", 60))
    if restart_reasons and state["breach_samples"] in {1, required}:
        log(f"Chrome breach sample={state['breach_samples']}/{required}: {state['last_reason']}")
    minimum = int(policy.get("minimum_restart_interval_seconds", 600))
    if state["breach_samples"] >= required and time.time() - state["last_restart"] >= minimum:
        restart_chrome(policy, state["last_reason"] or "resource threshold")
        state = load_state()
        snapshot = inspect(policy)
    save_state(state)
    snapshot["state"] = state
    return snapshot


def daemon(policy: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("w", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        handle.write(str(os.getpid()))
        handle.flush()
        log("Chrome-only resource guard started")
        while True:
            try:
                enforce_once(policy)
            except Exception as exc:
                log(f"guard cycle error: {type(exc).__name__}: {exc}")
            time.sleep(max(1, int(policy.get("poll_seconds", 5))))


def install(policy_path: Path) -> None:
    policy = load_policy(policy_path)
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_PROGRAM.write_bytes(Path(__file__).read_bytes())
    RUNTIME_PROGRAM.chmod(0o700)
    RUNTIME_POLICY.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")
    RUNTIME_POLICY.chmod(0o600)
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    plist = {
        "Label": LABEL,
        "ProgramArguments": [
            "/usr/bin/env", "-i", f"HOME={Path.home()}",
            "PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONNOUSERSITE=1", "PYTHONSAFEPATH=1",
            TRUSTED_PYTHON, str(RUNTIME_PROGRAM), "--policy", str(RUNTIME_POLICY), "daemon",
        ],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "Nice": 8,
        "ThrottleInterval": 10,
        "StandardOutPath": str(RUNTIME_DIR / "launchd.log"),
        "StandardErrorPath": str(RUNTIME_DIR / "launchd-error.log"),
    }
    LAUNCH_AGENT.write_bytes(plistlib.dumps(plist, fmt=plistlib.FMT_XML, sort_keys=False))
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], capture_output=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(LAUNCH_AGENT)], check=True)
    subprocess.run(["launchctl", "enable", f"{domain}/{LABEL}"], check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("daemon")
    actions.add_parser("status")
    actions.add_parser("enforce-once")
    actions.add_parser("install")
    ensure = actions.add_parser("ensure")
    ensure.add_argument("browser", choices=("chrome", "all"), nargs="?", default="chrome")
    restart = actions.add_parser("restart")
    restart.add_argument("browser", choices=("chrome",))
    restart.add_argument("--reason", default="manual Chrome resource restart")
    args = parser.parse_args()
    policy = load_policy(args.policy)
    if args.action == "daemon":
        daemon(policy)
    elif args.action == "status":
        value = inspect(policy)
        value["state"] = load_state()
        print(json.dumps(value, indent=2))
    elif args.action == "enforce-once":
        print(json.dumps(enforce_once(policy), indent=2))
    elif args.action == "ensure":
        return 0 if ensure_chrome(policy) else 1
    elif args.action == "restart":
        return 0 if restart_chrome(policy, args.reason) else 1
    elif args.action == "install":
        install(args.policy)
        print(json.dumps({"installed": str(RUNTIME_PROGRAM), "scope": "local Chrome resources only"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
