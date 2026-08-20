#!/usr/bin/env python3
"""Fail-closed singleton and resource enforcer for the ACTP browsers.

The only permitted Chromium root is the chrome-bridge ``agent`` profile on
127.0.0.1:9222. Safari is limited to one application root. The daemon also
caps tabs and restarts either browser after a sustained resource breach,
including an explicit cooling interval before relaunch.

This intentionally uses only the Python standard library so launchd can run it
without activating a project environment.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shlex
import signal
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_DIR = Path(__file__).resolve().parents[1]
DEFAULT_POLICY = REPO_DIR / "config" / "browser-policy.json"
RUNTIME_DIR = Path.home() / "Library" / "Application Support" / "ACTP" / "browser-enforcer"
STATE_FILE = RUNTIME_DIR / "state.json"
LOCK_FILE = RUNTIME_DIR / "daemon.lock"
RESTART_LOCK_FILE = RUNTIME_DIR / "restart.lock"
LOG_FILE = RUNTIME_DIR / "browser-enforcer.log"
RUNTIME_PROGRAM = RUNTIME_DIR / "browser-enforcer.py"
RUNTIME_POLICY = RUNTIME_DIR / "browser-policy.json"
LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / "com.isaiah.actp-browser-enforcer.plist"
WATCHDOG_LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / "com.isaiah.safari-automation.watchdog.plist"
CHROME_CLAIMS = Path("/tmp/chrome-tab-claims.json")
SAFARI_CLAIMS = Path("/tmp/safari-tab-claims.json")
BRIDGE_CLAIMS = RUNTIME_DIR / "chrome-claims.json"
WORKSPACE = Path("/Users/isaiahdupree/Documents/Software")
CANONICAL_CDP = "http://127.0.0.1:9222"
PROCESS_TABLE_CACHE_SECONDS = 0.35
_process_table_lock = threading.Lock()
_process_table_cache_at = 0.0
_process_table_cache: list[dict[str, Any]] = []


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log(message: str) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    line = f"[{utc_now()}] {message}"
    print(line, flush=True)
    with LOG_FILE.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_policy(path: Path) -> dict[str, Any]:
    policy = load_json(path, None)
    if not isinstance(policy, dict):
        raise RuntimeError(f"Invalid browser policy: {path}")
    for key in ("chrome", "safari"):
        if not isinstance(policy.get(key), dict):
            raise RuntimeError(f"Browser policy is missing {key}")
    return policy


def default_state() -> dict[str, Any]:
    return {
        "started_at": utc_now(),
        "last_check": None,
        "breaches": {"chrome": 0, "safari": 0},
        "cool_until": {"chrome": 0.0, "safari": 0.0},
        "last_restart": {"chrome": 0.0, "safari": 0.0},
        "restart_count": {"chrome": 0, "safari": 0},
        "last_reason": {"chrome": None, "safari": None},
    }


def load_state() -> dict[str, Any]:
    saved = load_json(STATE_FILE, {})
    state = default_state()
    if isinstance(saved, dict):
        for key, value in saved.items():
            if key in state:
                state[key] = value
    for key in ("breaches", "cool_until", "last_restart", "restart_count", "last_reason"):
        if not isinstance(state.get(key), dict):
            state[key] = default_state()[key]
        for browser in ("chrome", "safari"):
            state[key].setdefault(browser, default_state()[key][browser])
    return state


def run(command: list[str], timeout: float = 15, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=check)


def process_table() -> list[dict[str, Any]]:
    global _process_table_cache_at, _process_table_cache
    now = time.monotonic()
    with _process_table_lock:
        if _process_table_cache and now - _process_table_cache_at <= PROCESS_TABLE_CACHE_SECONDS:
            return _process_table_cache
        result = run(["ps", "-axo", "pid=,ppid=,pcpu=,rss=,command="], timeout=10, check=True)
        processes: list[dict[str, Any]] = []
        for raw in result.stdout.splitlines():
            parts = raw.strip().split(None, 4)
            if len(parts) != 5:
                continue
            try:
                processes.append({
                    "pid": int(parts[0]),
                    "ppid": int(parts[1]),
                    "cpu": float(parts[2]),
                    "rss_kb": int(parts[3]),
                    "command": parts[4],
                })
            except ValueError:
                continue
        _process_table_cache = processes
        _process_table_cache_at = time.monotonic()
        return processes


def command_argv(command: str) -> list[str]:
    try:
        return shlex.split(command, posix=True)
    except ValueError:
        return command.split()


def command_starts_executable(command: str, executable: str) -> bool:
    return command == executable or command.startswith(executable + " ")


def chrome_roots(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    executable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    return [p for p in processes if command_starts_executable(p["command"], executable)]


def safari_roots(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    suffix = "/Safari.app/Contents/MacOS/Safari"
    prefixes = (
        f"/Applications{suffix}",
        f"/System/Applications{suffix}",
        f"/System/Volumes/Preboot/Cryptexes/App/System/Applications{suffix}",
    )
    return [p for p in processes if any(command_starts_executable(p["command"], prefix) for prefix in prefixes)]


def rogue_chromium_roots(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    exact_paths = {
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Firefox.app/Contents/MacOS/firefox",
    }
    root_names = {
        "chromium", "chrome", "chrome-headless-shell", "chromium_headless_shell",
        "headless_shell", "google chrome for testing", "firefox", "firefox-bin",
        "minibrowser", "webkittestrunner",
    }
    cached_root_names = root_names | {"playwright"}
    browser_hints = (
        "chrome", "chromium", "firefox", "webkit", "minibrowser",
        "headless", "playwright",
    )
    candidates: list[dict[str, Any]] = []
    for process in processes:
        command = process["command"]
        lowered_command = command.lower()
        # Avoid shell-tokenizing every process on the host each second. Only
        # browser-engine candidates need the more expensive argv/path checks.
        if not any(hint in lowered_command for hint in browser_hints):
            continue
        argv = command_argv(command)
        if not argv:
            continue
        matched_exact = next((path for path in exact_paths if command_starts_executable(command, path)), None)
        executable = matched_exact or argv[0]
        basename = Path(executable).name.lower()
        cached_playwright = "/ms-playwright/" in executable.lower() and basename in cached_root_names
        if executable in exact_paths or basename in root_names or cached_playwright:
            candidates.append(process)

    candidate_ids = {p["pid"] for p in candidates}
    parent_by_pid = {p["pid"]: p["ppid"] for p in processes}

    def has_candidate_ancestor(process: dict[str, Any]) -> bool:
        parent = process["ppid"]
        visited: set[int] = set()
        while parent > 1 and parent not in visited:
            if parent in candidate_ids:
                return True
            visited.add(parent)
            parent = parent_by_pid.get(parent, 0)
        return False

    return [p for p in candidates if not has_candidate_ancestor(p)]


def canonical_chrome(process: dict[str, Any], policy: dict[str, Any]) -> bool:
    command = process["command"]
    if not command_starts_executable(command, str(policy["chrome"]["binary"])):
        return False
    argv = command.split()
    data_dir = str(policy["chrome"]["canonical_data_dir"])
    port = int(policy["chrome"]["debug_port"])
    return f"--user-data-dir={data_dir}" in argv and f"--remote-debugging-port={port}" in argv


def chrome_launch_compliant(process: dict[str, Any], policy: dict[str, Any]) -> bool:
    argv = process["command"].split()
    required = {
        "--remote-debugging-address=127.0.0.1",
        "--process-per-site",
        f"--renderer-process-limit={int(policy['chrome']['renderer_process_limit'])}",
        "--enable-features=MemorySaverModeAvailable",
    }
    forbidden = {
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
    }
    return required.issubset(argv) and not forbidden.intersection(argv)


def descendants(processes: list[dict[str, Any]], root_pids: set[int]) -> list[dict[str, Any]]:
    selected = set(root_pids)
    changed = True
    while changed:
        changed = False
        for process in processes:
            if process["pid"] not in selected and process["ppid"] in selected:
                selected.add(process["pid"])
                changed = True
    return [process for process in processes if process["pid"] in selected]


def safari_processes(processes: list[dict[str, Any]], roots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected = {process["pid"] for process in descendants(processes, {p["pid"] for p in roots})}
    safari_markers = ("/Safari.", "/Safari/", "com.apple.Safari", "/Safari.app/", "/Frameworks/WebKit.framework/")
    return [
        p for p in processes
        if p["pid"] in selected or (
            p["command"].startswith("/") and any(marker in p["command"] for marker in safari_markers)
        )
    ]


def aggregate(processes: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "processes": len(processes),
        "rss_mb": round(sum(p["rss_kb"] for p in processes) / 1024, 1),
        "cpu_percent": round(sum(p["cpu"] for p in processes), 1),
    }


def http_json(url: str, timeout: float = 2) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "ACTP-Browser-Enforcer/1"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def port_listening(host: str, port: int, timeout: float = 1) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def chrome_targets(policy: dict[str, Any]) -> list[dict[str, Any]]:
    port = int(policy["chrome"]["debug_port"])
    try:
        targets = http_json(f"http://127.0.0.1:{port}/json/list", timeout=4)
        return [target for target in targets if target.get("type") == "page"]
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return []


def chrome_cdp_available(policy: dict[str, Any]) -> bool:
    port = int(policy["chrome"]["debug_port"])
    if not port_listening("127.0.0.1", port):
        return False
    try:
        value = http_json(f"http://127.0.0.1:{port}/json/version", timeout=3)
        return isinstance(value, dict) and bool(value.get("webSocketDebuggerUrl"))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return False


def safari_counts() -> tuple[int, int, str | None]:
    # Asking Safari for its window list can hang indefinitely when it is
    # running without a document. System Events can establish the zero-window
    # case without sending that problematic Apple event. When a window exists,
    # Safari remains the authoritative source for the tab count.
    gui_script = 'tell application "System Events" to tell process "Safari" to count windows'
    gui_windows: int | None = None
    try:
        gui_result = run(["osascript", "-e", gui_script], timeout=2, check=True)
        gui_windows = int(gui_result.stdout.strip())
        if gui_windows == 0:
            return 0, 0, None
    except (OSError, ValueError, subprocess.SubprocessError):
        pass

    script = """
tell application "Safari"
  set windowCount to count of windows
  set tabCount to 0
  repeat with safariWindow in windows
    set tabCount to tabCount + (count of tabs of safariWindow)
  end repeat
  return (windowCount as text) & "|" & (tabCount as text)
end tell
"""
    try:
        result = run(["osascript", "-e", script], timeout=2, check=True)
        windows, tabs = result.stdout.strip().split("|", 1)
        return int(windows), int(tabs), None
    except subprocess.TimeoutExpired:
        return gui_windows or 0, 0, "Safari AppleScript timed out"
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "Safari AppleScript denied").strip()
        return gui_windows or 0, 0, detail[-300:]
    except (OSError, ValueError) as exc:
        return gui_windows or 0, 0, str(exc)


def inspect(policy: dict[str, Any]) -> dict[str, Any]:
    processes = process_table()
    chrome = chrome_roots(processes)
    safari = safari_roots(processes)
    canonical = [p for p in chrome if canonical_chrome(p, policy)]
    chrome_tree = descendants(processes, {p["pid"] for p in canonical})
    safari_tree = safari_processes(processes, safari)
    windows, safari_tabs, safari_control_error = safari_counts() if safari else (0, 0, None)
    targets = chrome_targets(policy) if canonical else []
    return {
        "timestamp": utc_now(),
        "chrome": {
            "root_pids": [p["pid"] for p in chrome],
            "canonical_pids": [p["pid"] for p in canonical],
            "unauthorized_pids": [p["pid"] for p in chrome if p not in canonical],
            "rogue_chromium_pids": [p["pid"] for p in rogue_chromium_roots(processes)],
            "rogue_browser_pids": [p["pid"] for p in rogue_chromium_roots(processes)],
            "tabs": len(targets),
            "cdp_available": (bool(targets) or chrome_cdp_available(policy)) if canonical else False,
            "launch_policy_compliant": len(canonical) == 1 and chrome_launch_compliant(canonical[0], policy),
            **aggregate(chrome_tree),
        },
        "safari": {
            "root_pids": [p["pid"] for p in safari],
            "windows": windows,
            "tabs": safari_tabs,
            "control_available": safari_control_error is None,
            "control_error": safari_control_error,
            **aggregate(safari_tree),
        },
    }


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def terminate_pids(pids: list[int], grace_seconds: int, reason: str) -> None:
    unique = sorted({pid for pid in pids if pid > 1})
    if not unique:
        return
    log(f"terminating pids={unique}: {reason}")
    for pid in unique:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + grace_seconds
    while time.time() < deadline and any(pid_alive(pid) for pid in unique):
        time.sleep(0.25)
    survivors = [pid for pid in unique if pid_alive(pid)]
    for pid in survivors:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if survivors:
        log(f"force-stopped pids={survivors} after {grace_seconds}s grace")


def active_claim_count(browser: str) -> int:
    now_ms = time.time() * 1000
    count = 0
    paths = [BRIDGE_CLAIMS, CHROME_CLAIMS] if browser == "chrome" else [SAFARI_CLAIMS]
    for path in paths:
        value = load_json(path, [])
        entries = list(value.values()) if isinstance(value, dict) else value if isinstance(value, list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            stamp = entry.get("heartbeat") or entry.get("claimedAt") or entry.get("claimed_at")
            if isinstance(stamp, str):
                try:
                    stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000
                except ValueError:
                    stamp = 0
            if not isinstance(stamp, (int, float)):
                continue
            ttl = 10 * 60 * 1000 if path == BRIDGE_CLAIMS else 5 * 60 * 1000
            if now_ms - stamp <= ttl:
                count += 1
    if browser == "chrome":
        try:
            health = http_json("http://127.0.0.1:5590/health", timeout=1)
            count += max(0, int(health.get("leases", 0)))
        except (OSError, TypeError, ValueError, urllib.error.URLError, json.JSONDecodeError):
            pass
    return count


def wait_for_drain(browser: str, timeout_seconds: int) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        claims = active_claim_count(browser)
        if claims == 0:
            return
        log(f"{browser} restart drain: waiting for {claims} active claim(s)")
        time.sleep(min(5, max(1, deadline - time.time())))
    log(f"{browser} drain timeout reached; proceeding with controlled restart")


def set_nice(pid: int, value: int) -> None:
    try:
        os.setpriority(os.PRIO_PROCESS, pid, value)
    except (PermissionError, ProcessLookupError, AttributeError):
        pass


def cooling(browser: str, state: dict[str, Any]) -> bool:
    return float(state["cool_until"].get(browser, 0)) > time.time()


def launch_chrome(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
    if cooling("chrome", state):
        remaining = int(float(state["cool_until"]["chrome"]) - time.time())
        log(f"Chrome launch denied during cooling window ({remaining}s remaining)")
        return None
    cfg = policy["chrome"]
    try:
        Path(cfg["canonical_data_dir"]).mkdir(parents=True, exist_ok=True)
    except PermissionError:
        # A launchd process may not have macOS Documents-folder access even
        # though the already-approved Chrome application does.
        pass
    command = [
        cfg["binary"],
        f"--remote-debugging-port={int(cfg['debug_port'])}",
        "--remote-debugging-address=127.0.0.1",
        "--remote-allow-origins=*",
        f"--user-data-dir={cfg['canonical_data_dir']}",
        "--profile-directory=Default",
        "--no-first-run",
        "--no-default-browser-check",
        "--process-per-site",
        f"--renderer-process-limit={int(cfg['renderer_process_limit'])}",
        "--enable-features=MemorySaverModeAvailable",
        "--disable-features=OptimizationGuideModelDownloading",
    ]
    with (RUNTIME_DIR / "chrome.log").open("a", encoding="utf-8") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    set_nice(process.pid, int(cfg.get("nice", 8)))
    port = int(cfg["debug_port"])
    for _ in range(40):
        if port_listening("127.0.0.1", port):
            log(f"Chrome canonical profile ready pid={process.pid} cdp=127.0.0.1:{port}")
            return process.pid
        time.sleep(0.5)
    log(f"Chrome failed to expose CDP within 20s pid={process.pid}")
    terminate_pids([process.pid], int(policy["stop_grace_seconds"]), "Chrome launch failed CDP readiness")
    return None


def launch_safari(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
    if cooling("safari", state):
        remaining = int(float(state["cool_until"]["safari"]) - time.time())
        log(f"Safari launch denied during cooling window ({remaining}s remaining)")
        return None
    run(["open", "-a", "Safari"], timeout=10, check=True)
    for _ in range(30):
        roots = safari_roots(process_table())
        if roots:
            pid = roots[0]["pid"]
            set_nice(pid, int(policy["safari"].get("nice", 8)))
            log(f"Safari ready pid={pid}")
            return pid
        time.sleep(0.5)
    log("Safari failed to launch within 15s")
    return None


def pause_safari_automation() -> list[int]:
    paused: list[int] = []
    for process in process_table():
        command = process["command"]
        executable = Path(command.split(None, 1)[0]).name
        if executable not in ("node", "tsx"):
            continue
        if "Safari Automation" not in command and "Safari%20Automation" not in command:
            continue
        if not any(token in command for token in ("server.ts", "mcp-server.ts", "apps/runner")):
            continue
        try:
            os.kill(process["pid"], signal.SIGSTOP)
            paused.append(process["pid"])
        except (ProcessLookupError, PermissionError):
            pass
    if paused:
        log(f"paused Safari automation pids={sorted(paused)} for cooling")
    return paused


def resume_processes(pids: list[int]) -> None:
    for pid in pids:
        try:
            os.kill(pid, signal.SIGCONT)
        except (ProcessLookupError, PermissionError):
            pass
    if pids:
        log(f"resumed Safari automation pids={sorted(pids)}")


def stop_browser(browser: str, policy: dict[str, Any]) -> None:
    processes = process_table()
    roots = chrome_roots(processes) if browser == "chrome" else safari_roots(processes)
    terminate_pids([p["pid"] for p in roots], int(policy["stop_grace_seconds"]), f"controlled {browser} stop")


def restart_in_progress() -> bool:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with RESTART_LOCK_FILE.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    return False


def restart_browser(browser: str, reason: str, policy: dict[str, Any], state: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    restart_lock = RESTART_LOCK_FILE.open("a+", encoding="utf-8")
    try:
        fcntl.flock(restart_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        restart_lock.close()
        log(f"{browser} restart skipped because another controlled restart is active")
        return
    now = time.time()
    minimum = int(policy["minimum_restart_interval_seconds"])
    since = now - float(state["last_restart"].get(browser, 0))
    if since < minimum:
        log(f"{browser} restart suppressed by backoff ({int(minimum - since)}s remaining): {reason}")
        restart_lock.close()
        return
    paused: list[int] = []
    try:
        wait_for_drain(browser, int(policy["drain_timeout_seconds"]))
        paused = pause_safari_automation()
        cooldown_seconds = int(policy["cooldown_seconds"])
        # Publish cooling before the root disappears so a concurrent daemon
        # cycle cannot race in and immediately relaunch it.
        state["cool_until"][browser] = time.time() + int(policy["stop_grace_seconds"]) + cooldown_seconds
        state["last_reason"][browser] = reason
        atomic_write_json(STATE_FILE, state)
        stop_browser(browser, policy)
        state["cool_until"][browser] = time.time() + cooldown_seconds
        atomic_write_json(STATE_FILE, state)
        log(f"{browser} cooling for {cooldown_seconds}s: {reason}")
        while cooling(browser, state):
            time.sleep(min(1, max(0.1, state["cool_until"][browser] - time.time())))
        state["cool_until"][browser] = 0.0
        if browser == "chrome":
            launch_chrome(policy, state)
        else:
            launch_safari(policy, state)
        state["last_restart"][browser] = time.time()
        state["restart_count"][browser] = int(state["restart_count"].get(browser, 0)) + 1
        state["breaches"][browser] = 0
        atomic_write_json(STATE_FILE, state)
    finally:
        resume_processes(paused)
        fcntl.flock(restart_lock.fileno(), fcntl.LOCK_UN)
        restart_lock.close()


def trim_chrome_tabs(policy: dict[str, Any]) -> int:
    maximum = int(policy["chrome"]["max_tabs"])
    targets = chrome_targets(policy)
    excess = len(targets) - maximum
    if excess <= 0:
        return 0
    blanks = [t for t in targets if t.get("url") in ("", "about:blank", "chrome://newtab/")]
    others = [t for t in reversed(targets) if t not in blanks]
    closed = 0
    port = int(policy["chrome"]["debug_port"])
    for target in (blanks + others)[:excess]:
        target_id = urllib.parse.quote(str(target.get("id", "")), safe="")
        if not target_id:
            continue
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/json/close/{target_id}", timeout=2).read()
            closed += 1
        except (OSError, urllib.error.URLError):
            pass
    if closed:
        log(f"Chrome tab cap enforced: closed={closed} max={maximum}")
    return closed


def trim_safari_tabs(policy: dict[str, Any]) -> int:
    maximum = int(policy["safari"]["max_tabs"])
    _, tabs, control_error = safari_counts()
    if control_error:
        return 0
    excess = tabs - maximum
    if excess <= 0:
        return 0
    script = f"""
tell application "Safari"
  set maximumTabs to {maximum}
  set totalTabs to 0
  repeat with safariWindow in windows
    set totalTabs to totalTabs + (count of tabs of safariWindow)
  end repeat
  set closedTabs to 0
  repeat with windowIndex from (count of windows) to 1 by -1
    repeat with tabIndex from (count of tabs of window windowIndex) to 1 by -1
      if totalTabs > maximumTabs then
        if not (windowIndex is 1 and tabIndex is 1) then
          close tab tabIndex of window windowIndex
          set totalTabs to totalTabs - 1
          set closedTabs to closedTabs + 1
        end if
      end if
    end repeat
  end repeat
  return closedTabs as text
end tell
"""
    try:
        result = run(["osascript", "-e", script], timeout=15, check=True)
        closed = int(result.stdout.strip() or "0")
    except (OSError, ValueError, subprocess.SubprocessError):
        closed = 0
    if closed:
        log(f"Safari tab cap enforced: closed={closed} max={maximum}")
    return closed


def reconcile_singletons(policy: dict[str, Any], state: dict[str, Any], ensure_running: bool = True) -> None:
    processes = process_table()
    chrome = chrome_roots(processes)
    canonical = [p for p in chrome if canonical_chrome(p, policy)]
    unauthorized = [p for p in chrome if p not in canonical]
    rogues = rogue_chromium_roots(processes)
    if unauthorized or rogues:
        terminate_pids(
            [p["pid"] for p in unauthorized + rogues],
            int(policy.get("rogue_kill_grace_seconds", 2)),
            "non-canonical Chrome/Chromium root denied",
        )
    if len(canonical) > 1:
        terminate_pids(
            [p["pid"] for p in canonical[1:]],
            int(policy.get("rogue_kill_grace_seconds", 2)),
            "duplicate canonical Chrome root denied",
        )
        canonical = canonical[:1]
    safari = safari_roots(process_table())
    if len(safari) > 1:
        terminate_pids(
            [p["pid"] for p in safari[1:]],
            int(policy.get("rogue_kill_grace_seconds", 2)),
            "duplicate Safari root denied",
        )
        safari = safari[:1]
    restart_active = restart_in_progress()
    if ensure_running and not restart_active and policy["chrome"].get("enabled", True) and not canonical and not cooling("chrome", state):
        launch_chrome(policy, state)
    if ensure_running and not restart_active and policy["safari"].get("enabled", True) and not safari and not cooling("safari", state):
        launch_safari(policy, state)


def violations(snapshot: dict[str, Any], browser: str, policy: dict[str, Any]) -> list[str]:
    cfg = policy[browser]
    current = snapshot[browser]
    reasons: list[str] = []
    if len(current["root_pids"]) == 0 and cfg.get("enabled", True):
        reasons.append("root_processes=0<1")
    if len(current["root_pids"]) > int(cfg["max_root_processes"]):
        reasons.append(f"root_processes={len(current['root_pids'])}>{cfg['max_root_processes']}")
    if int(current["processes"]) > int(cfg["max_total_processes"]):
        reasons.append(f"processes={current['processes']}>{cfg['max_total_processes']}")
    if float(current["rss_mb"]) > float(cfg["max_rss_mb"]):
        reasons.append(f"rss_mb={current['rss_mb']}>{cfg['max_rss_mb']}")
    if float(current["cpu_percent"]) > float(cfg["max_cpu_percent"]):
        reasons.append(f"cpu={current['cpu_percent']}>{cfg['max_cpu_percent']}")
    if int(current.get("tabs", 0)) > int(cfg["max_tabs"]):
        reasons.append(f"tabs={current['tabs']}>{cfg['max_tabs']}")
    if browser == "chrome" and current.get("root_pids") and not current.get("cdp_available", False):
        reasons.append("cdp_unavailable")
    if browser == "chrome" and current.get("canonical_pids") and not current.get("launch_policy_compliant", False):
        reasons.append("launch_flags_noncompliant")
    if browser == "safari" and int(current["windows"]) > int(cfg["max_windows"]):
        reasons.append(f"windows={current['windows']}>{cfg['max_windows']}")
    return reasons


def schedule_restart(browser: str, reason: str, state: dict[str, Any]) -> None:
    if restart_in_progress():
        log(f"{browser} restart already active; duplicate schedule suppressed")
        return
    minimum = int(load_policy(RUNTIME_POLICY if RUNTIME_POLICY.exists() else DEFAULT_POLICY)["minimum_restart_interval_seconds"])
    since = time.time() - float(state["last_restart"].get(browser, 0))
    if since < minimum:
        state["breaches"][browser] = 0
        log(f"{browser} restart deferred by backoff ({int(minimum - since)}s remaining): {reason}")
        return
    policy_path = RUNTIME_POLICY if RUNTIME_POLICY.exists() else DEFAULT_POLICY
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--policy",
        str(policy_path),
        "restart",
        browser,
        "--reason",
        reason,
    ]
    with (RUNTIME_DIR / "restart-worker.log").open("a", encoding="utf-8") as output:
        worker = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    state["breaches"][browser] = 0
    state["last_reason"][browser] = reason
    log(f"scheduled controlled {browser} restart worker pid={worker.pid}: {reason}")


def fast_singleton_guard(policy: dict[str, Any]) -> None:
    """Kill forbidden browser roots quickly, independent of resource polling.

    Many browser-backed renderers live for only a few seconds. A one-second
    process guard prevents those dormant or dynamically invoked paths from
    escaping the slower CPU/RSS/tab enforcement cycle.
    """
    pending: dict[int, tuple[float, str]] = {}
    grace = float(policy.get("rogue_kill_grace_seconds", 2))
    interval = float(policy.get("rogue_poll_seconds", 1))
    while True:
        try:
            processes = process_table()
            chrome = chrome_roots(processes)
            canonical = sorted(
                (process for process in chrome if canonical_chrome(process, policy)),
                key=lambda process: process["pid"],
            )
            offenders: dict[int, str] = {
                process["pid"]: "non-canonical Chrome/alternate browser root"
                for process in chrome
                if process not in canonical
            }
            offenders.update({
                process["pid"]: "non-canonical Chrome/alternate browser root"
                for process in rogue_chromium_roots(processes)
            })
            live_state = load_state()
            if cooling("chrome", live_state):
                for process in canonical:
                    offenders[process["pid"]] = "Chrome launch attempted during cooling"
            else:
                for process in canonical:
                    if not chrome_launch_compliant(process, policy):
                        offenders[process["pid"]] = "canonical Chrome missing enforced resource flags"
                for process in canonical[1:]:
                    offenders[process["pid"]] = "duplicate canonical Chrome root"
            safari = sorted(safari_roots(processes), key=lambda process: process["pid"])
            if cooling("safari", live_state):
                for process in safari:
                    offenders[process["pid"]] = "Safari launch attempted during cooling"
            else:
                for process in safari[1:]:
                    offenders[process["pid"]] = "duplicate Safari root"

            now = time.time()
            for pid in list(pending):
                if pid not in offenders:
                    pending.pop(pid, None)
            for pid, reason in offenders.items():
                first_seen = pending.get(pid)
                if first_seen is None:
                    pending[pid] = (now, reason)
                    log(f"fast guard terminating pid={pid}: {reason}")
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pending.pop(pid, None)
                elif now - first_seen[0] >= grace:
                    log(f"fast guard force-stopping pid={pid} after {grace:g}s: {reason}")
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    pending.pop(pid, None)
        except Exception as exc:
            log(f"fast singleton guard error: {type(exc).__name__}: {exc}")
        time.sleep(max(0.25, interval))


def enforce_once(policy: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    reconcile_singletons(policy, state, ensure_running=True)
    trim_chrome_tabs(policy)
    trim_safari_tabs(policy)
    snapshot = inspect(policy)
    for browser in ("chrome", "safari"):
        reasons = violations(snapshot, browser, policy)
        if reasons:
            state["breaches"][browser] = int(state["breaches"].get(browser, 0)) + 1
            log(f"{browser} resource breach sample={state['breaches'][browser]}: {', '.join(reasons)}")
        else:
            state["breaches"][browser] = 0
        if int(state["breaches"][browser]) >= int(policy["sustained_breach_samples"]):
            schedule_restart(browser, "; ".join(reasons), state)
    state["last_check"] = utc_now()
    state["snapshot"] = snapshot
    # A separately invoked controlled restart owns state while it holds the
    # restart lock. Do not overwrite its cooling deadline with a stale cycle.
    if not restart_in_progress():
        atomic_write_json(STATE_FILE, state)
    return snapshot


def mcp_args(config: dict[str, Any]) -> list[str]:
    command = str(config.get("command", ""))
    existing = [str(value) for value in config.get("args", [])]
    if Path(command).name == "playwright-mcp":
        return ["--cdp-endpoint", CANONICAL_CDP]
    package = next((value for value in existing if "@playwright/mcp" in value), "@playwright/mcp@latest")
    prefix = ["-y", package] if Path(command).name in ("npx", "npx.cmd") else existing
    return prefix + ["--cdp-endpoint", CANONICAL_CDP]


def rewrite_playwright_json(value: Any) -> int:
    changes = 0
    if isinstance(value, dict):
        servers = value.get("mcpServers")
        if isinstance(servers, dict):
            for name, config in servers.items():
                if "playwright" not in name.lower() or not isinstance(config, dict):
                    continue
                wanted = mcp_args(config)
                if config.get("args") != wanted:
                    config["args"] = wanted
                    changes += 1
        for child in value.values():
            changes += rewrite_playwright_json(child)
    elif isinstance(value, list):
        for child in value:
            changes += rewrite_playwright_json(child)
    return changes


def configure_json_file(path: Path) -> int:
    if not path.exists():
        return 0
    value = load_json(path, None)
    if value is None:
        return 0
    changes = rewrite_playwright_json(value)
    if changes:
        atomic_write_json(path, value)
        log(f"routed {changes} Playwright MCP config(s) through {CANONICAL_CDP}: {path}")
    return changes


def configure_codex_toml(path: Path) -> int:
    if not path.exists():
        return 0
    text = path.read_text(encoding="utf-8")
    original = text
    block = re.compile(r"(?ms)^\[mcp_servers\.playwright\]\n.*?(?=^\[|\Z)")
    replacement = (
        '[mcp_servers.playwright]\n'
        'command = "/opt/homebrew/bin/playwright-mcp"\n'
        'args = ["--cdp-endpoint", "http://127.0.0.1:9222"]\n\n'
    )
    if block.search(text):
        text = block.sub(replacement, text, count=1)
    else:
        text += "\n" + replacement
    text = re.sub(
        r'(?m)^\[plugins\."browser@openai-bundled"\]\nenabled = true$',
        '[plugins."browser@openai-bundled"]\nenabled = false',
        text,
    )
    text = re.sub(
        r'(?m)^BROWSER_USE_AVAILABLE_BACKENDS\s*=.*$',
        'BROWSER_USE_AVAILABLE_BACKENDS = "chrome"',
        text,
    )
    text = re.sub(r'(?m)^NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER\s*=.*\n?', '', text)
    text = re.sub(
        r'(?m)^NODE_REPL_TRUSTED_SERVICES\s*=.*$',
        'NODE_REPL_TRUSTED_SERVICES = \'{"sky":"@oai/sky/service"}\'',
        text,
    )
    if text != original:
        path.write_text(text, encoding="utf-8")
        log(f"Codex browser config enforced: {path}")
        return 1
    return 0


def configure_agents() -> int:
    changes = 0
    changes += configure_json_file(Path.home() / ".claude.json")
    changes += configure_json_file(Path.home() / ".claude" / "settings.json")
    changes += configure_json_file(WORKSPACE / "acd" / ".mcp.json")
    changes += configure_codex_toml(Path.home() / ".codex" / "config.toml")
    return changes


def config_violations() -> list[str]:
    findings: list[str] = []
    for path in (Path.home() / ".claude.json", WORKSPACE / "acd" / ".mcp.json"):
        if not path.exists():
            continue
        value = load_json(path, {})

        def scan(node: Any, location: str) -> None:
            if isinstance(node, dict):
                servers = node.get("mcpServers")
                if isinstance(servers, dict):
                    for name, cfg in servers.items():
                        if "playwright" in name.lower() and isinstance(cfg, dict):
                            args = [str(v) for v in cfg.get("args", [])]
                            if "--cdp-endpoint" not in args or CANONICAL_CDP not in args:
                                findings.append(f"{path}:{location}/mcpServers/{name}")
                for key, child in node.items():
                    scan(child, f"{location}/{key}")
            elif isinstance(node, list):
                for index, child in enumerate(node):
                    scan(child, f"{location}/{index}")

        scan(value, "")
    codex = Path.home() / ".codex" / "config.toml"
    if codex.exists():
        text = codex.read_text(encoding="utf-8")
        if '[mcp_servers.playwright]' in text and CANONICAL_CDP not in text:
            findings.append(f"{codex}:mcp_servers.playwright")
        if '[plugins."browser@openai-bundled"]\nenabled = true' in text:
            findings.append(f"{codex}:in-app-browser-enabled")
        if 'BROWSER_USE_AVAILABLE_BACKENDS = "chrome,iab"' in text or 'NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER' in text:
            findings.append(f"{codex}:in-app-browser-advertised")
        trusted = re.search(r'(?m)^NODE_REPL_TRUSTED_SERVICES\s*=\s*(.+)$', text)
        if trusted and '"browser"' in trusted.group(1):
            findings.append(f"{codex}:in-app-browser-service-trusted")
    return findings


def shell_command_segments(command: str) -> list[list[str]]:
    """Tokenize executable shell clauses without splitting quoted data.

    Shell control words and grouping punctuation are command boundaries too:
    `then open ...`, loop bodies, functions, subshells, and command
    substitutions must be inspected as executable clauses rather than being
    hidden behind `if`, `do`, or a function declaration.
    """
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars="();&|{}!\n")
        lexer.whitespace_split = True
        lexer.commenters = "#"
        segments: list[list[str]] = []
        current: list[str] = []
        control_boundaries = {
            "if", "then", "elif", "else", "fi",
            "while", "until", "for", "select", "do", "done",
            "case", "esac", "function", "coproc",
        }
        for token in lexer:
            lowered = token.lower()
            command_separator = token and all(character in ";&|\n" for character in token)
            grouping_separator = token and all(character in "(){}" for character in token)
            prefix_separator = not current and (
                lowered in control_boundaries
                or (token and all(character == "!" for character in token))
            )
            if command_separator or grouping_separator or prefix_separator:
                if current:
                    segments.append(current)
                    current = []
            else:
                current.append(token)
        if current:
            segments.append(current)
        return segments
    except ValueError:
        return [command.split()]


LEGACY_BROWSER_ACTIONS = {
    "chrome-launcher.sh": {"", "start", "stop", "restart", "sync", "sarah", "isaiah", "lcreator"},
    "chrome-ctl.sh": {"open", "cap", "uncap", "trim"},
    "browser-bridge.sh": {"open", "close"},
}


def strip_command_prefixes(tokens: list[str]) -> list[str]:
    """Remove shell execution prefixes without reclassifying ordinary arguments."""
    remaining = list(tokens)
    while remaining:
        first = remaining[0]
        name = Path(first).name
        if "=" in first and not first.startswith(("/", "./")):
            remaining.pop(0)
            continue
        if name == "env":
            remaining.pop(0)
            while remaining and (remaining[0].startswith("-") or (
                "=" in remaining[0] and not remaining[0].startswith(("/", "./"))
            )):
                remaining.pop(0)
            continue
        if name in {"command", "exec", "nohup"}:
            remaining.pop(0)
            continue
        if name == "sudo":
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option in {"-u", "-g", "-h", "-p", "-C", "-T"} and remaining:
                    remaining.pop(0)
            continue
        break
    return remaining


def nested_shell_command(tokens: list[str]) -> str | None:
    """Return the command payload passed to sh/bash/zsh -c, including -lc."""
    if not tokens or Path(tokens[0]).name not in {"bash", "zsh", "sh"}:
        return None
    for index, token in enumerate(tokens[1:], start=1):
        if token == "--":
            break
        if token == "-c" or (token.startswith("-") and not token.startswith("--") and "c" in token[1:]):
            return tokens[index + 1] if index + 1 < len(tokens) else ""
        if not token.startswith("-"):
            break
    return None


def executed_legacy_script(tokens: list[str]) -> tuple[str, str] | None:
    """Identify a legacy wrapper only when this command would execute it.

    Browser-related filenames passed to git, rg, sed, test runners, or other
    data-processing commands are not executable positions and must remain
    inspectable. Shell syntax checks (`sh -n file`) are also read-only.
    """
    if not tokens:
        return None
    executable = Path(tokens[0]).name
    script_index: int | None = None
    if executable in LEGACY_BROWSER_ACTIONS:
        script_index = 0
    elif executable in {"source", "."} and len(tokens) > 1:
        script_index = 1
    elif executable in {"bash", "zsh", "sh"} and nested_shell_command(tokens) is None:
        if any(token == "-n" or (
            token.startswith("-") and not token.startswith("--") and "n" in token[1:]
        ) for token in tokens[1:]):
            return None
        for index, token in enumerate(tokens[1:], start=1):
            if token == "--":
                if index + 1 < len(tokens):
                    script_index = index + 1
                break
            if token.startswith("-"):
                continue
            script_index = index
            break
    if script_index is None or script_index >= len(tokens):
        return None
    legacy = Path(tokens[script_index]).name
    if legacy not in LEGACY_BROWSER_ACTIONS:
        return None
    action = tokens[script_index + 1].lower() if script_index + 1 < len(tokens) else ""
    return legacy, action


def is_enforcer_invocation(tokens: list[str]) -> bool:
    """The enforcer is the authorized browser lifecycle and audit surface."""
    if not tokens:
        return False
    executable = Path(tokens[0]).name
    if executable in {"python", "python3"}:
        index = 1
        while index < len(tokens):
            token = tokens[index]
            if token in {"-c", "-m"}:
                return False
            if token in {"-W", "-X"}:
                index += 2
                continue
            if token.startswith("-"):
                index += 1
                continue
            return Path(token).name == "browser-enforcer.py"
        return False
    return executable == "browser-enforcer.py"


def command_denial(command: str, state: dict[str, Any], depth: int = 0) -> str | None:
    if depth > 3:
        return "Nested shell command denied because browser policy safety could not be established"
    normalized_start = command.lstrip().replace("\\ ", " ").lower()
    if normalized_start.startswith((
        "/applications/google chrome.app/contents/macos/google chrome",
        "/applications/chromium.app/contents/macos/chromium",
        "/applications/google chrome for testing.app/contents/macos/google chrome for testing",
    )):
        return "Direct Chrome/Chromium launch denied; use the canonical browser enforcer on CDP 9222"
    for tokens in shell_command_segments(command):
        if not tokens:
            continue
        tokens = strip_command_prefixes(tokens)
        if not tokens:
            continue
        executable = Path(tokens[0]).name.lower()
        lowered_tokens = [token.lower() for token in tokens]
        joined = " ".join(lowered_tokens)

        legacy_invocation = executed_legacy_script(tokens)
        if legacy_invocation:
            legacy, action = legacy_invocation
            if action in LEGACY_BROWSER_ACTIONS[legacy]:
                return f"Legacy browser action denied ({legacy} {action}); use the singleton enforcer and a claimed shared tab"

        # Status, audit, smoke, ensure, and controlled restart calls to the
        # enforcer are the supported control plane, even though its path and
        # arguments necessarily contain browser names.
        if is_enforcer_invocation(tokens):
            continue

        browser_executable = (
            executable in {"chromium", "chrome", "chrome-headless-shell", "chromium_headless_shell", "headless_shell", "google chrome", "google chrome for testing", "firefox", "firefox-bin", "minibrowser", "webkittestrunner"}
            or any(".app/contents/macos/" in token.lower() and any(name in token.lower() for name in ("chrome", "chromium", "firefox")) for token in tokens[:1])
            or any("/ms-playwright/" in token.lower() and Path(token).name.lower() in {"chromium", "chrome", "headless_shell", "firefox", "minibrowser", "webkittestrunner"} for token in tokens[:1])
        )
        if browser_executable:
            return "Direct browser-engine launch denied; use the canonical Chrome on CDP 9222 or installed Safari singleton"

        if executable in {"open", "xdg-open"}:
            app_request = joined.replace("-na", "-a")
            if "google chrome" in app_request or "chromium" in app_request or "firefox" in app_request:
                return "OS Chrome launch denied; use the canonical browser enforcer on CDP 9222"
            if "safari" in app_request:
                return "Direct Safari launch denied; use browser-enforcer.py ensure safari"
            if any(token.lower().startswith(("http://", "https://")) for token in tokens[1:]):
                return "Opening URLs through the OS may spawn another browser; use a claimed shared tab"

        playwright_cli = executable in {"playwright", "playwright-mcp"} or (
            executable in {"npx", "npm", "pnpm", "yarn", "bunx"} and any("playwright" in token for token in lowered_tokens[1:])
        )
        if playwright_cli and not (
            "--cdp-endpoint" in lowered_tokens and CANONICAL_CDP in tokens
        ):
            return "Standalone Playwright launch denied; attach to http://127.0.0.1:9222"

        inline_interpreter = executable in {
            "python", "python3", "node", "bun", "deno", "ruby", "bash", "zsh", "sh"
        } and any(flag in tokens[1:] for flag in ("-c", "-e", "--eval"))
        launch_primitives = (
            "chromium.launch", "firefox.launch", "webkit.launch", "puppeteer.launch",
            "launchpersistentcontext", "webdriver.chrome", "webdriver.firefox",
            "webdriver.safari", "new_context(", "newcontext(",
        )
        generic_inline_launch = ".launch(" in joined and any(
            library in joined for library in ("playwright", "puppeteer", "selenium", "chromium", "webkit", "firefox")
        )
        if inline_interpreter and (generic_inline_launch or any(primitive in joined for primitive in launch_primitives)):
            return "Inline browser launch denied; attach to the existing Chrome CDP context or Safari session"
        nested_command = nested_shell_command(tokens)
        if nested_command is not None:
            nested_denial = command_denial(nested_command, state, depth + 1)
            if nested_denial:
                return nested_denial
        if executable == "eval" and len(tokens) > 1:
            nested_denial = command_denial(" ".join(tokens[1:]), state, depth + 1)
            if nested_denial:
                return nested_denial
        if executable == "safaridriver":
            return "Starting a Safari WebDriver service is denied; reuse the externally provisioned Safari session"
        if executable == "osascript" and "safari" in joined and any(
            action in joined for action in ("make new document", "activate", "reopen", "quit", "open location")
        ):
            return "Direct Safari lifecycle/tab creation denied; use the singleton enforcer or capped shared-tab service"
        if executable in {"killall", "pkill"} and any(
            browser_name in joined for browser_name in ("safari", "google chrome", "chromium", "firefox")
        ):
            return "Direct browser termination denied; use a controlled browser-enforcer restart"

        if cooling("chrome", state) and (browser_executable or playwright_cli):
            return "Chrome is in the enforced cooling window; wait for the singleton relaunch"
        if cooling("safari", state) and executable == "osascript":
            return "Safari is in the enforced cooling window; wait for the singleton relaunch"
    return None


def install_launch_agent(policy_path: Path) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    # macOS privacy controls deny background launch agents access to files
    # under Documents. Install self-contained runtime copies in Application
    # Support, which remains readable after logout/login and reboot.
    shutil.copy2(Path(__file__).resolve(), RUNTIME_PROGRAM)
    shutil.copy2(policy_path.resolve(), RUNTIME_POLICY)
    legacy_claims = Path("/Users/isaiahdupree/Documents/Chrome/chrome-bridge/claims.json")
    if legacy_claims.exists() and not BRIDGE_CLAIMS.exists():
        shutil.copy2(legacy_claims, BRIDGE_CLAIMS)
        BRIDGE_CLAIMS.chmod(0o600)
    RUNTIME_PROGRAM.chmod(0o700)
    RUNTIME_POLICY.chmod(0o600)
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.isaiah.actp-browser-enforcer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>{RUNTIME_PROGRAM}</string>
    <string>--policy</string><string>{RUNTIME_POLICY}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>{RUNTIME_DIR / 'launchd.log'}</string>
  <key>StandardErrorPath</key><string>{RUNTIME_DIR / 'launchd-error.log'}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
"""
    LAUNCH_AGENT.write_text(plist, encoding="utf-8")
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", domain, str(LAUNCH_AGENT)], capture_output=True)
    installed_at = time.time()
    run(["launchctl", "bootstrap", domain, str(LAUNCH_AGENT)], timeout=15, check=True)
    run(["launchctl", "enable", f"{domain}/com.isaiah.actp-browser-enforcer"], timeout=10)
    label = f"{domain}/com.isaiah.actp-browser-enforcer"
    deadline = time.time() + 20
    while time.time() < deadline:
        service = run(["launchctl", "print", label], timeout=5)
        fresh_state = STATE_FILE.exists() and STATE_FILE.stat().st_mtime >= installed_at
        if service.returncode == 0 and "state = running" in service.stdout and fresh_state:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError(f"browser enforcer launch agent failed readiness verification; inspect {RUNTIME_DIR}")
    log(f"installed launch agent: {LAUNCH_AGENT}")


def retire_legacy_fleet_watchdog() -> None:
    """Retire the service watchdog that previously duplicated lifecycle work.

    launchd cannot read its service sources under Documents without a user
    privacy grant, and repeated failed starts created a process storm. Browser
    lifecycle now belongs exclusively to this self-contained enforcer.
    """
    domain = f"gui/{os.getuid()}"
    label = f"{domain}/com.isaiah.safari-automation.watchdog"
    subprocess.run(["launchctl", "bootout", label], capture_output=True)
    if WATCHDOG_LAUNCH_AGENT.exists():
        subprocess.run(
            ["launchctl", "bootout", domain, str(WATCHDOG_LAUNCH_AGENT)],
            capture_output=True,
        )
    run(["launchctl", "disable", label], timeout=10)
    log("retired legacy Safari fleet watchdog; browser-enforcer owns browser lifecycle")


def daemon(policy: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_FILE.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log("another browser-enforcer daemon holds the lock; exiting")
        return
    lock_handle.write(str(os.getpid()))
    lock_handle.flush()
    state = load_state()
    threading.Thread(target=fast_singleton_guard, args=(policy,), daemon=True).start()
    # Agent configuration lives in privacy-protected user locations and is
    # enforced by the interactive installer plus command hooks. A launchd
    # daemon must never block on those files before its first heartbeat.
    log("browser enforcer started: one Chrome, one Safari, tab/resource caps active")
    while True:
        try:
            # Pick up cooling/restart state written by an interactive command.
            state = load_state()
            enforce_once(policy, state)
        except Exception as exc:  # daemon must survive transient OS/browser failures
            log(f"enforcement cycle error: {type(exc).__name__}: {exc}")
        time.sleep(int(policy["poll_seconds"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("daemon")
    subparsers.add_parser("status")
    subparsers.add_parser("enforce-once")
    subparsers.add_parser("configure-agents")
    subparsers.add_parser("audit-config")
    install = subparsers.add_parser("install")
    install.add_argument("--no-start", action="store_true")
    ensure = subparsers.add_parser("ensure")
    ensure.add_argument("browser", choices=("chrome", "safari", "all"), default="all", nargs="?")
    restart = subparsers.add_parser("restart")
    restart.add_argument("browser", choices=("chrome", "safari"))
    restart.add_argument("--reason", default="manual enforced restart")
    check = subparsers.add_parser("check-command")
    check.add_argument("command", nargs="?")
    args = parser.parse_args()
    policy = load_policy(args.policy)
    state = load_state()

    if args.action == "daemon":
        daemon(policy)
    elif args.action == "status":
        snapshot = inspect(policy)
        snapshot["policy"] = {
            "chrome_max_tabs": policy["chrome"]["max_tabs"],
            "safari_max_tabs": policy["safari"]["max_tabs"],
            "cooldown_seconds": policy["cooldown_seconds"],
            "sustained_breach_samples": policy["sustained_breach_samples"],
        }
        snapshot["state"] = state
        print(json.dumps(snapshot, indent=2))
    elif args.action == "enforce-once":
        print(json.dumps(enforce_once(policy, state), indent=2))
    elif args.action == "configure-agents":
        changes = configure_agents()
        print(json.dumps({"changed": changes, "violations": config_violations()}))
        return 1 if config_violations() else 0
    elif args.action == "audit-config":
        findings = config_violations()
        print(json.dumps({"ok": not findings, "violations": findings}, indent=2))
        return 1 if findings else 0
    elif args.action == "install":
        configure_agents()
        if not args.no_start:
            install_launch_agent(args.policy)
            retire_legacy_fleet_watchdog()
        else:
            print(str(LAUNCH_AGENT))
    elif args.action == "ensure":
        if args.browser == "all":
            reconcile_singletons(policy, state, ensure_running=True)
        else:
            reconcile_singletons(policy, state, ensure_running=False)
            snapshot = inspect(policy)
            roots = snapshot[args.browser]["root_pids"]
            if not roots and not cooling(args.browser, state):
                launch_chrome(policy, state) if args.browser == "chrome" else launch_safari(policy, state)
    elif args.action == "restart":
        restart_browser(args.browser, args.reason, policy, state)
    elif args.action == "check-command":
        command = args.command if args.command is not None else sys.stdin.read()
        reason = command_denial(command, state)
        if reason:
            print(reason)
            return 42
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
