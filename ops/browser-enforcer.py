#!/opt/homebrew/bin/python3
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
import ast
import base64
from contextlib import contextmanager
import fcntl
from functools import lru_cache
import hashlib
import http.client
import json
import os
import plistlib
import re
import secrets
import shlex
import signal
import shutil
import socket
import stat
import subprocess
import sys
import threading
import time
import tempfile
import tomllib
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
STATE_LOCK_FILE = RUNTIME_DIR / "state.lock"
HUMAN_PRESENCE_FILE = RUNTIME_DIR / "human-presence.json"
DRAIN_STATE_FILE = RUNTIME_DIR / "drain-state.json"
CONTROL_READINESS_FILE = RUNTIME_DIR / "control-readiness.json"
LOCK_FILE = RUNTIME_DIR / "daemon.lock"
RESTART_LOCK_FILE = RUNTIME_DIR / "restart.lock"
CHROME_LAUNCH_LOCK_FILE = RUNTIME_DIR / "chrome-launch.lock"
SAFARI_LAUNCH_LOCK_FILE = RUNTIME_DIR / "safari-launch.lock"
LOG_FILE = RUNTIME_DIR / "browser-enforcer.log"
RUNTIME_PROGRAM = RUNTIME_DIR / "browser-enforcer.py"
RUNTIME_POLICY = RUNTIME_DIR / "browser-policy.json"
COMMAND_HOOK_SOURCE = REPO_DIR / "ops" / "browser-command-hook.py"
RUNTIME_COMMAND_HOOK = RUNTIME_DIR / "browser-command-hook.py"
CODEX_COMMAND_HOOK = Path.home() / ".codex" / "hooks" / "pre-tool-check.py"
CLAUDE_COMMAND_HOOK = Path.home() / ".claude" / "hooks" / "pre-tool-check.py"
LAUNCH_AGENT = Path.home() / "Library" / "LaunchAgents" / "com.isaiah.actp-browser-enforcer.plist"
WATCHDOG_SOURCE = REPO_DIR / "watchdog-safari.sh"
WATCHDOG_RUNTIME = RUNTIME_DIR.parent / "safari-watchdog" / "watchdog-safari.sh"
CHROME_CLAIMS = Path("/tmp/chrome-tab-claims.json")
SAFARI_CLAIMS = Path("/tmp/safari-tab-claims.json")
SAFARI_CLAIMS_LOCK_FILE = Path("/tmp/safari-tab-claims.lock")
BRIDGE_CLAIMS = RUNTIME_DIR / "chrome-claims.json"
WORKSPACE = Path("/Users/isaiahdupree/Documents/Software")
CANONICAL_CDP = "http://127.0.0.1:9222"
CHROME_BRIDGE_SERVER = Path("/Users/isaiahdupree/Documents/Chrome/chrome-bridge/server.js")
CODEX_CONFIG = Path.home() / ".codex" / "config.toml"
CLAUDE_SETTINGS_CONFIG = Path.home() / ".claude" / "settings.json"
WINDSURF_MCP_CONFIG = Path.home() / ".codeium" / "windsurf" / "mcp_config.json"
CURSOR_MCP_CONFIG = Path.home() / ".cursor" / "mcp.json"
OPENCLAW_CONFIG = Path.home() / ".openclaw" / "openclaw.json"
CLAUDE_DESKTOP_CONFIG = (
    Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
)
CLAUDE_EXTENSIONS_CONFIG = (
    Path.home() / "Library" / "Application Support" / "Claude" / "extensions-installations.json"
)
SAFARI_CONTROL_URL = "http://127.0.0.1:5591"
SAFARI_CONTROL_SOURCE = REPO_DIR / "ops" / "safari-control-broker.py"
SAFARI_CONTROL_PROGRAM = RUNTIME_DIR / "safari-control-broker.py"
SAFARI_CONTROL_TOKEN = RUNTIME_DIR / "safari-control.token"
SAFARI_PRESENCE_TOKEN = RUNTIME_DIR / "safari-presence.token"
SAFARI_TRIM_SOCKET = RUNTIME_DIR / "safari-trim.sock"
SAFARI_CONTROL_LOG = RUNTIME_DIR / "safari-control-broker.log"
SAFARI_CONTROL_SESSION = "actp-safari-control"
SAFARI_BROKER_SESSION_LOCK = RUNTIME_DIR / "safari-control-session.lock"
BROWSERD_SOURCE = WORKSPACE / "browserd" / "browserd.mjs"
BROWSERD_RUNTIME = RUNTIME_DIR.parent / "browserd" / "browserd.mjs"
BROWSERD_CONTROL_URL = "http://127.0.0.1:5590"
BROWSERD_CONTROL_SOCKET = RUNTIME_DIR.parent / "browserd" / "control.sock"
BROWSERD_LAUNCHD_LABEL = "com.dupreeops.browserd"
ENFORCER_SOURCE = WORKSPACE / "Safari Automation" / "ops" / "browser-enforcer.py"
TRUSTED_PYTHON = "/opt/homebrew/bin/python3"
MINIMUM_PYTHON = (3, 11)
CDP_CLIENT_SCAN_SECONDS = 2.0
BROWSER_ROOT_SCAN_SECONDS = 1.0
DRAIN_STATE_HEARTBEAT_SECONDS = 5.0
SAFARI_CLAIM_TTL_MS = 60_000
CODE_SIGN_CLONE_MIN_AGE_SECONDS = 24 * 60 * 60
CODE_SIGN_CLONE_CLEANUP_INTERVAL_SECONDS = 24 * 60 * 60
CODE_SIGN_CLONE_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
CODE_SIGN_CLONE_RELAUNCH_RESERVE_BYTES = 1536 * 1024 * 1024
CODE_SIGN_CLONE_STATUS_CACHE_SECONDS = 300.0
CODE_SIGN_CLONE_CLEANUP_STAMP = RUNTIME_DIR / "code-sign-clone-cleanup.json"
CODE_SIGN_CLONE_CLEANUP_LOCK = RUNTIME_DIR / "code-sign-clone-cleanup.lock"
SAFARI_WEBKIT_BUNDLE_IDS = frozenset({
    "com.apple.WebKit.Networking",
    "com.apple.WebKit.GPU",
    "com.apple.WebKit.WebContent",
})
# One enforcement cycle asks for roots, descendants, and resource totals in
# quick succession. Coalesce those reads without making the independent
# two-second rogue guard stale.
PROCESS_TABLE_CACHE_SECONDS = 1.5
_process_table_lock = threading.Lock()
_process_table_cache_at = 0.0
_process_table_cache: list[dict[str, Any]] = []
_browser_table_lock = threading.Lock()
_browser_table_cache_at = 0.0
_browser_table_detail_at = 0.0
_browser_table_cache_pids: tuple[int, ...] = ()
_browser_table_cache: list[dict[str, Any]] = []
_clone_status_lock = threading.Lock()
_clone_status_cache_at = 0.0
_clone_status_cache: dict[str, Any] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_trusted_python() -> dict[str, Any]:
    """Prove the fixed clean-runtime interpreter can execute this program."""
    interpreter = Path(TRUSTED_PYTHON)
    metadata = os.stat(interpreter)
    if not stat.S_ISREG(metadata.st_mode) or not os.access(interpreter, os.X_OK):
        raise RuntimeError(f"trusted Python is unavailable or not executable: {interpreter}")
    result = subprocess.run(
        [
            TRUSTED_PYTHON,
            "-I",
            "-B",
            "-c",
            "import json,sys,tomllib;print(json.dumps(list(sys.version_info[:3])))",
        ],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
        env={
            "HOME": str(Path.home()),
            "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONNOUSERSITE": "1",
            "PYTHONSAFEPATH": "1",
        },
    )
    version = json.loads(result.stdout)
    if (
        not isinstance(version, list)
        or len(version) != 3
        or any(isinstance(part, bool) or not isinstance(part, int) for part in version)
        or tuple(version) < MINIMUM_PYTHON
    ):
        raise RuntimeError(f"trusted Python must be >= {MINIMUM_PYTHON[0]}.{MINIMUM_PYTHON[1]}")
    return {"path": TRUSTED_PYTHON, "version": ".".join(str(part) for part in version)}


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


def atomic_write_bytes(
    path: Path,
    payload: bytes,
    mode: int = 0o600,
    uid: int | None = None,
    gid: int | None = None,
) -> None:
    """Atomically replace a regular file without a permissive mode window."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, mode)
    try:
        view = memoryview(payload)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise OSError(f"short write while replacing {path}")
            view = view[written:]
        if uid is not None or gid is not None:
            os.fchown(descriptor, -1 if uid is None else uid, -1 if gid is None else gid)
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_write_text(
    path: Path,
    text: str,
    mode: int = 0o600,
    uid: int | None = None,
    gid: int | None = None,
) -> None:
    atomic_write_bytes(path, text.encode("utf-8"), mode, uid, gid)


def atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    atomic_write_text(path, json.dumps(value, indent=2) + "\n", mode)


def existing_file_metadata(path: Path) -> os.stat_result:
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RuntimeError(f"refusing to replace non-regular configuration file: {path}")
    if metadata.st_uid != os.getuid():
        raise RuntimeError(f"refusing to replace configuration not owned by this user: {path}")
    return metadata


def existing_file_mode(path: Path) -> int:
    return stat.S_IMODE(existing_file_metadata(path).st_mode)


def read_owned_regular_file(path: Path) -> tuple[bytes, os.stat_result]:
    before = existing_file_metadata(path)
    payload = path.read_bytes()
    after = existing_file_metadata(path)
    identity_before = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
        stat.S_IMODE(before.st_mode),
        before.st_uid,
        before.st_gid,
    )
    identity_after = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        stat.S_IMODE(after.st_mode),
        after.st_uid,
        after.st_gid,
    )
    if identity_before != identity_after or len(payload) != before.st_size:
        raise RuntimeError(f"configuration changed while it was being prepared: {path}")
    return payload, before


def verify_file_replacement(path: Path, payload: bytes, metadata: os.stat_result) -> None:
    actual, current = read_owned_regular_file(path)
    if actual != payload:
        raise RuntimeError(f"configuration readback mismatch: {path}")
    expected_identity = (
        stat.S_IMODE(metadata.st_mode),
        metadata.st_uid,
        metadata.st_gid,
    )
    actual_identity = (
        stat.S_IMODE(current.st_mode),
        current.st_uid,
        current.st_gid,
    )
    if actual_identity != expected_identity:
        raise RuntimeError(f"configuration mode/owner changed during replacement: {path}")


def verify_configuration_plan_current(plan: dict[str, Any]) -> None:
    """Refuse to overwrite a config changed since transaction planning."""
    payload, metadata = read_owned_regular_file(plan["path"])
    original = plan["original"]
    expected = plan["metadata"]
    identity = (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_size,
        metadata.st_mtime_ns,
        stat.S_IMODE(metadata.st_mode),
        metadata.st_uid,
        metadata.st_gid,
    )
    expected_identity = (
        expected.st_dev,
        expected.st_ino,
        expected.st_size,
        expected.st_mtime_ns,
        stat.S_IMODE(expected.st_mode),
        expected.st_uid,
        expected.st_gid,
    )
    if payload != original or identity != expected_identity:
        raise RuntimeError(f"configuration changed before transactional replacement: {plan['path']}")


@contextmanager
def exclusive_file_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        yield descriptor
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


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
        "restart_pending": {"chrome": None, "safari": None},
        "human_presence": {
            "version": 1,
            "updated_at": None,
            "observed_at": 0.0,
            "source_available": False,
            "frontmost_app": None,
            "idle_seconds": None,
            "browser_foreground": {"chrome": False, "safari": False},
            "human_recent": True,
            "active": {"chrome": True, "safari": True},
            "manual_hold_until": {"chrome": 0.0, "safari": 0.0},
            "restart_allowed": {"chrome": False, "safari": False},
            "retry_after_seconds": {"chrome": None, "safari": None},
        },
    }


def load_state() -> dict[str, Any]:
    saved = load_json(STATE_FILE, {})
    state = default_state()
    if isinstance(saved, dict):
        for key, value in saved.items():
            if key in state:
                state[key] = value
    for key in (
        "breaches", "cool_until", "last_restart", "restart_count", "last_reason", "restart_pending",
    ):
        if not isinstance(state.get(key), dict):
            state[key] = default_state()[key]
        for browser in ("chrome", "safari"):
            state[key].setdefault(browser, default_state()[key][browser])
    presence_default = default_state()["human_presence"]
    if not isinstance(state.get("human_presence"), dict):
        state["human_presence"] = presence_default
    presence = state["human_presence"]
    for key, value in presence_default.items():
        presence.setdefault(key, value)
    for key in (
        "browser_foreground", "active", "manual_hold_until", "restart_allowed", "retry_after_seconds",
    ):
        if not isinstance(presence.get(key), dict):
            presence[key] = dict(presence_default[key])
        for browser in ("chrome", "safari"):
            presence[key].setdefault(browser, presence_default[key][browser])
    return state


def merge_current_manual_holds(state: dict[str, Any]) -> None:
    """Merge the authoritative on-disk holds into a possibly stale cycle."""
    current = load_state()
    current_presence = current.get("human_presence", {})
    current_holds = current_presence.get("manual_hold_until", {}) if isinstance(current_presence, dict) else {}
    presence = state.setdefault("human_presence", default_state()["human_presence"])
    holds = presence.setdefault("manual_hold_until", {"chrome": 0.0, "safari": 0.0})
    for browser in ("chrome", "safari"):
        try:
            holds[browser] = max(0.0, float(current_holds.get(browser, 0.0) or 0.0))
        except (TypeError, ValueError):
            # A malformed emergency-control value is protective until a human
            # explicitly releases it; never silently turn corruption into 0.
            holds[browser] = time.time() + 10 * 365 * 24 * 60 * 60


def persist_state(state: dict[str, Any], skip_during_restart: bool = False) -> bool:
    """Commit cycle state while preserving a concurrent manual hold/release."""
    with exclusive_file_lock(STATE_LOCK_FILE):
        if skip_during_restart and restart_in_progress():
            return False
        merge_current_manual_holds(state)
        atomic_write_json(STATE_FILE, state)
        return True


def run(command: list[str], timeout: float = 15, check: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=check)


def parse_process_rows(output: str) -> list[dict[str, Any]]:
    processes: list[dict[str, Any]] = []
    for raw in output.splitlines():
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
    return processes


def process_table() -> list[dict[str, Any]]:
    global _process_table_cache_at, _process_table_cache
    now = time.monotonic()
    with _process_table_lock:
        if _process_table_cache and now - _process_table_cache_at <= PROCESS_TABLE_CACHE_SECONDS:
            return _process_table_cache
        result = run(["ps", "-axo", "pid=,ppid=,pcpu=,rss=,command="], timeout=10, check=True)
        processes = parse_process_rows(result.stdout)
        _process_table_cache = processes
        _process_table_cache_at = time.monotonic()
        return processes


def invalidate_process_table_cache() -> None:
    global _process_table_cache_at, _process_table_cache
    global _browser_table_cache_at, _browser_table_detail_at
    global _browser_table_cache_pids, _browser_table_cache
    with _process_table_lock:
        _process_table_cache_at = 0.0
        _process_table_cache = []
    with _browser_table_lock:
        _browser_table_cache_at = 0.0
        _browser_table_detail_at = 0.0
        _browser_table_cache_pids = ()
        _browser_table_cache = []


def browser_process_table() -> list[dict[str, Any]]:
    """Return only possible browser processes for the latency-sensitive guard."""
    # Match kernel process names, not every full argv on the machine. The old
    # `pgrep -f` path occasionally exceeded its deadline under load because it
    # scanned all command lines. Include macOS's 16-character truncations for
    # long executable names, then confirm every hit from its full argv below.
    name_pattern = (
        "Google Chrome|Google Chrome Be|Google Chrome Ca|Google Chrome De|Google Chrome fo|"
        "Safari|Safari Technolog|Safari Technology|Waterfox|geckodriver|Chromium|chrome|"
        "chrome-headless-shell|chrome-headless-s|chromium_headless_shell|"
        "chromium_headless|headless_shell|Firefox|firefox-bin|MiniBrowser|"
        "WebKitTestRunner|WebKitTestRunne|Playwright|Microsoft Edge|"
        "Brave Browser|Arc|Opera|Vivaldi|Comet|Dia|Orion|DuckDuckGo|Zen|"
        "LibreWolf|Floorp|SigmaOS|Sidekick|Wavebox|Polypane|Ghost Browser"
    )
    global _browser_table_cache_at, _browser_table_detail_at
    global _browser_table_cache_pids, _browser_table_cache
    try:
        with _browser_table_lock:
            now = time.monotonic()
            if now - _browser_table_cache_at < BROWSER_ROOT_SCAN_SECONDS:
                return _browser_table_cache
            matches = run(["pgrep", "-ix", name_pattern], timeout=2)
            if matches.returncode not in (0, 1):
                raise RuntimeError(f"browser process query failed: {matches.stderr.strip()}")
            pids = tuple(sorted({int(value) for value in matches.stdout.split() if value.isdigit()}))
            _browser_table_cache_at = time.monotonic()
            if not pids:
                _browser_table_cache_pids = ()
                _browser_table_cache = []
                _browser_table_detail_at = _browser_table_cache_at
                return []
            if pids == _browser_table_cache_pids and now - _browser_table_detail_at < 5.0:
                return _browser_table_cache
            selected = run(
                ["ps", "-p", ",".join(str(pid) for pid in pids), "-o", "pid=,ppid=,pcpu=,rss=,command="],
                timeout=3,
            )
            if selected.returncode not in (0, 1):
                raise RuntimeError(f"browser process detail query failed: {selected.stderr.strip()}")
            _browser_table_cache_pids = pids
            _browser_table_cache = parse_process_rows(selected.stdout)
            _browser_table_detail_at = time.monotonic()
            return _browser_table_cache
    except (subprocess.TimeoutExpired, OSError, RuntimeError):
        # Never turn a query timeout into a skipped guard cycle. The slower
        # full snapshot is an exceptional fallback and has its own 10s bound.
        processes = process_table()
        roots = chrome_roots(processes) + safari_roots(processes) + rogue_chromium_roots(processes)
        root_pids = {process["pid"] for process in roots}
        return [process for process in processes if process["pid"] in root_pids]


def command_argv(command: str) -> list[str]:
    try:
        return shlex.split(command, posix=True)
    except ValueError:
        return command.split()


def command_starts_executable(command: str, executable: str) -> bool:
    return command == executable or command.startswith(executable + " ")


@lru_cache(maxsize=256)
def macos_bundle_metadata(bundle_text: str) -> tuple[str, str, bool] | None:
    """Return id, executable, and web-handler status for a bounded app bundle."""
    bundle = Path(bundle_text)
    plist = bundle / "Contents" / "Info.plist"
    try:
        metadata = os.lstat(plist)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 4 * 1024 * 1024:
            return None
        with plist.open("rb") as handle:
            value = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException):
        return None
    if not isinstance(value, dict):
        return None
    bundle_id = value.get("CFBundleIdentifier")
    executable = value.get("CFBundleExecutable")
    if not isinstance(bundle_id, str) or not isinstance(executable, str):
        return None
    schemes: set[str] = set()
    url_types = value.get("CFBundleURLTypes", [])
    if isinstance(url_types, list):
        for url_type in url_types:
            if not isinstance(url_type, dict):
                continue
            raw_schemes = url_type.get("CFBundleURLSchemes", [])
            if isinstance(raw_schemes, list):
                schemes.update(str(scheme).lower() for scheme in raw_schemes)
    web_document_markers = {
        "public.html", "public.xhtml", "org.chromium.extension",
        "org.chromium.shortcut", "org.ietf.mhtml", "com.netscape.javascript-source",
        "org.webmproject.webm", "public.svg-image", "text/html",
        "application/xhtml+xml", "application/x-webarchive",
    }
    declared_web_documents: set[str] = set()
    document_types = value.get("CFBundleDocumentTypes", [])
    if isinstance(document_types, list):
        for document_type in document_types:
            if not isinstance(document_type, dict):
                continue
            for key in ("LSItemContentTypes", "CFBundleTypeMIMETypes"):
                entries = document_type.get(key, [])
                if isinstance(entries, list):
                    declared_web_documents.update(str(entry).lower() for entry in entries)
    browser_document_evidence = declared_web_documents & web_document_markers
    is_web_browser = bool(
        {"http", "https"}.issubset(schemes)
        and (
            "org.chromium.extension" in browser_document_evidence
            or len(browser_document_evidence) >= 4
        )
    )
    return bundle_id, executable, is_web_browser


def macos_browser_command(command: str) -> bool:
    match = re.match(r"^(.+?\.app)/Contents/MacOS/", command)
    if not match:
        return False
    bundle = Path(match.group(1))
    metadata = macos_bundle_metadata(str(bundle))
    if metadata is None or not metadata[2]:
        return False
    expected = str(bundle / "Contents" / "MacOS" / metadata[1])
    return command_starts_executable(command, expected)


def requested_browser_bundle(tokens: list[str]) -> bool:
    """Resolve `open -a/-b` requests and detect any installed web handler."""
    if not tokens or Path(tokens[0]).name.lower() != "open":
        return False
    requested_name: str | None = None
    requested_bundle_id: str | None = None
    for index, token in enumerate(tokens[1:], start=1):
        if token in {"-a", "-na"} and index + 1 < len(tokens):
            requested_name = tokens[index + 1]
            break
        if token == "-b" and index + 1 < len(tokens):
            requested_bundle_id = tokens[index + 1]
            break
    if requested_name is None and requested_bundle_id is None:
        return False
    roots = (Path("/Applications"), Path("/System/Applications"), Path.home() / "Applications")
    for root in roots:
        if requested_name is not None:
            candidates = (root / f"{requested_name.removesuffix('.app')}.app",)
        else:
            try:
                candidates = tuple(root.glob("*.app"))
            except OSError:
                candidates = ()
        for bundle in candidates:
            metadata = macos_bundle_metadata(str(bundle))
            if metadata is None:
                continue
            if requested_bundle_id is not None and metadata[0].lower() != requested_bundle_id.lower():
                continue
            if metadata[2]:
                return True
    return False


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
        str(Path("/Applications") / ("Google " + "Chrome Beta.app") / "Contents" / "MacOS" / ("Google " + "Chrome Beta")),
        str(Path("/Applications") / ("Google " + "Chrome Dev.app") / "Contents" / "MacOS" / ("Google " + "Chrome Dev")),
        str(Path("/Applications") / ("Google " + "Chrome Canary.app") / "Contents" / "MacOS" / ("Google " + "Chrome Canary")),
        str(Path("/Applications") / ("Safari Technology " + "Preview.app") / "Contents" / "MacOS" / ("Safari Technology " + "Preview")),
        str(Path("/Applications") / "Waterfox.app" / "Contents" / "MacOS" / "waterfox"),
        "/opt/homebrew/bin/geckodriver",
        "/usr/local/bin/geckodriver",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Arc.app/Contents/MacOS/Arc",
        "/Applications/Opera.app/Contents/MacOS/Opera",
        "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
        "/Applications/Comet.app/Contents/MacOS/Comet",
        "/Applications/Dia.app/Contents/MacOS/Dia",
        "/Applications/Orion.app/Contents/MacOS/Orion",
        "/Applications/DuckDuckGo.app/Contents/MacOS/DuckDuckGo",
        "/Applications/Zen.app/Contents/MacOS/zen",
        "/Applications/LibreWolf.app/Contents/MacOS/librewolf",
        "/Applications/Floorp.app/Contents/MacOS/floorp",
        "/Applications/SigmaOS.app/Contents/MacOS/SigmaOS",
        "/Applications/Sidekick.app/Contents/MacOS/Sidekick",
        "/Applications/Wavebox.app/Contents/MacOS/Wavebox",
        "/Applications/Polypane.app/Contents/MacOS/Polypane",
        "/Applications/Ghost Browser.app/Contents/MacOS/Ghost Browser",
    }
    root_names = {
        "google chrome beta", "google chrome dev", "google chrome canary",
        "safari technology preview", "waterfox", "geckodriver",
        "chromium", "chrome", "chrome-headless-shell", "chromium_headless_shell",
        "headless_shell", "google chrome for testing", "firefox", "firefox-bin",
        "minibrowser", "webkittestrunner", "microsoft edge", "brave browser",
        "arc", "opera", "vivaldi", "comet", "dia", "orion", "duckduckgo",
        "zen", "librewolf", "floorp", "sigmaos", "sidekick", "wavebox",
        "polypane", "ghost browser",
    }
    cached_root_names = root_names | {"playwright"}
    browser_hints = (
        "chrome beta", "chrome dev", "chrome canary", "safari technology preview",
        "waterfox", "geckodriver",
        "chrome", "chromium", "firefox", "webkit", "minibrowser",
        "headless", "playwright", "microsoft edge", "brave browser",
        "/arc.app/", "/opera.app/", "vivaldi", "/comet.app/", "/dia.app/",
        "/orion.app/", "/duckduckgo.app/", "/zen.app/", "/librewolf.app/",
        "/floorp.app/", "/sigmaos.app/", "/sidekick.app/", "/wavebox.app/",
        "/polypane.app/", "/ghost browser.app/",
    )
    candidates: list[dict[str, Any]] = []
    for process in processes:
        command = process["command"]
        lowered_command = command.lower()
        allowed_singleton_root = bool(chrome_roots([process]) or safari_roots([process]))
        generic_browser_root = bool(
            not allowed_singleton_root
            and macos_browser_command(command)
        )
        # Avoid shell-tokenizing every process on the host each second. Only
        # browser-engine candidates need the more expensive argv/path checks.
        if not generic_browser_root and not any(hint in lowered_command for hint in browser_hints):
            continue
        argv = command_argv(command)
        if not argv:
            continue
        matched_exact = next((path for path in exact_paths if command_starts_executable(command, path)), None)
        executable = matched_exact or argv[0]
        basename = Path(executable).name.lower()
        cached_playwright = "/ms-playwright/" in executable.lower() and basename in cached_root_names
        if generic_browser_root or executable in exact_paths or basename in root_names or cached_playwright:
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


def lsappinfo_entries(output: str) -> list[tuple[str, str]]:
    """Return ``(display_name, body)`` records from ``lsappinfo list``.

    LaunchServices is the only unprivileged macOS source on this host that
    preserves the owning application's name after WebKit XPC helpers have been
    reparented to launchd. Keep this parser strict: an unknown format must
    under-count rather than charge another application's WebKit process to
    Safari and trigger a destructive restart.
    """
    matches = list(re.finditer(r'(?m)^[ \t]*\d+\)[ \t]+"([^"]+)"[ \t]+ASN:[^\n]*\n', output))
    entries: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(output)
        entries.append((match.group(1), output[match.end():end]))
    return entries


def safari_webkit_registrations(output: str, root_pids: set[int]) -> dict[int, str]:
    """Map LaunchServices-verified Safari WebKit PIDs to bundle identifiers."""
    parsed: list[tuple[str, str, int]] = []
    safari_root_registered = False
    for display_name, body in lsappinfo_entries(output):
        bundle_match = re.search(r'(?m)^[ \t]*bundleID="([^"]+)"[ \t]*$', body)
        pid_match = re.search(r"(?m)^[ \t]*pid[ \t]*=[ \t]*(\d+)\b", body)
        if not bundle_match or not pid_match:
            continue
        bundle_id = bundle_match.group(1)
        pid = int(pid_match.group(1))
        if display_name == "Safari" and bundle_id == "com.apple.Safari" and pid in root_pids:
            safari_root_registered = True
        parsed.append((display_name, bundle_id, pid))
    if not safari_root_registered:
        return {}
    return {
        pid: bundle_id
        for display_name, bundle_id, pid in parsed
        if display_name.startswith("Safari ") and bundle_id in SAFARI_WEBKIT_BUNDLE_IDS
    }


def system_webkit_xpc(process: dict[str, Any], bundle_id: str) -> bool:
    """Verify that a registered helper is the exact Apple WebKit executable."""
    if bundle_id not in SAFARI_WEBKIT_BUNDLE_IDS:
        return False
    argv = command_argv(process["command"])
    if not argv:
        return False
    executable = Path(argv[0]).resolve(strict=False)
    executable_name = bundle_id
    expected = {
        (
            Path("/System/Library/Frameworks/WebKit.framework")
            / relative
            / f"{executable_name}.xpc"
            / "Contents"
            / "MacOS"
            / executable_name
        ).resolve(strict=False)
        for relative in (Path("Versions/A/XPCServices"), Path("XPCServices"))
    }
    return executable in expected


def safari_processes(processes: list[dict[str, Any]], roots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the root tree plus WebKit helpers proven to belong to Safari.

    WebKit XPC helpers normally have PPID 1, so ancestry alone omits most of
    Safari's CPU and RSS. Conversely, matching every WebKit path charges Mail,
    authentication views, and other WKWebView hosts to Safari. LaunchServices
    labels the actual helpers as ``Safari Networking``, ``Safari Graphics and
    Media``, or ``Safari Web Content``. Require that registration, the live
    Safari root registration, the PID, the exact bundle allowlist, and Apple's
    system executable path to agree before attribution.
    """
    root_pids = {process["pid"] for process in roots}
    selected = {process["pid"] for process in descendants(processes, root_pids)}
    if not root_pids:
        return []
    try:
        listing = run(["/usr/bin/lsappinfo", "list"], timeout=2, check=True).stdout
        registrations = safari_webkit_registrations(listing, root_pids)
    except (OSError, subprocess.SubprocessError):
        registrations = {}
    for process in processes:
        bundle_id = registrations.get(process["pid"])
        if bundle_id and system_webkit_xpc(process, bundle_id):
            selected.add(process["pid"])
    return [process for process in processes if process["pid"] in selected]


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


def private_token(path: Path) -> str:
    metadata = os.lstat(path)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise RuntimeError(f"control token ownership or mode is unsafe: {path}")
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise RuntimeError(f"control token is empty: {path}")
    return token


def browserd_control_json(
    method: str,
    path: str,
    data: dict[str, Any] | None = None,
    timeout: float = 4,
) -> Any:
    return unix_control_json(
        BROWSERD_CONTROL_SOCKET,
        method,
        path,
        data=data,
        timeout=timeout,
        label="browserd",
    )


def unix_control_json(
    socket_path: Path,
    method: str,
    path: str,
    *,
    data: dict[str, Any] | None = None,
    timeout: float = 4,
    label: str,
) -> Any:
    """Bounded JSON-over-HTTP request to a private, peer-attested Unix socket."""
    metadata = os.lstat(socket_path)
    if (
        not stat.S_ISSOCK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise RuntimeError(f"{label} control socket ownership or mode is unsafe")
    normalized_method = method.upper()
    payload = None if data is None else json.dumps(data, separators=(",", ":")).encode("utf-8")
    headers = [
        f"{normalized_method} {path} HTTP/1.0",
        "Host: localhost",
        "Accept: application/json",
        "User-Agent: ACTP-Browser-Enforcer/1",
        "Connection: close",
    ]
    if payload is not None:
        headers.extend(("Content-Type: application/json", f"Content-Length: {len(payload)}"))
    request = ("\r\n".join(headers) + "\r\n\r\n").encode("ascii") + (payload or b"")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(timeout)
        client.connect(str(socket_path))
        client.sendall(request)
        response = http.client.HTTPResponse(client)
        response.begin()
        raw_length = response.getheader("Content-Length")
        if raw_length is None or not raw_length.isdigit() or int(raw_length) > 131_072:
            raise RuntimeError(f"{label} control response length is missing or unsafe")
        body = response.read(int(raw_length) + 1)
        if len(body) != int(raw_length):
            raise RuntimeError(f"{label} control response body is incomplete")
        if not str(response.getheader("Content-Type") or "").lower().startswith("application/json"):
            raise RuntimeError(f"{label} control response is not JSON")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"{label} control response JSON is invalid") from exc
    if response.status != 200:
        code = value.get("code") if isinstance(value, dict) else None
        raise RuntimeError(f"{label} control returned HTTP {response.status} code={code or 'unknown'}")
    return value


def safari_control_json(path: str, timeout: float = 4) -> Any:
    """Read Safari state over the lane credential; TCP has no write routes."""
    token = private_token(SAFARI_PRESENCE_TOKEN)
    request = urllib.request.Request(
        f"{SAFARI_CONTROL_URL}{path}",
        headers={
            "Accept": "application/json",
            "User-Agent": "ACTP-Browser-Enforcer/1",
            "X-ACTP-Browser-Token": token,
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def safari_trim_json(maximum: int, timeout: float = 17) -> dict[str, Any]:
    """Request ownership-aware trim over the enforcer-attested Unix socket."""
    value = unix_control_json(
        SAFARI_TRIM_SOCKET,
        "POST",
        "/trim",
        data={"maximum": int(maximum)},
        timeout=timeout,
        label="Safari trim",
    )
    if not isinstance(value, dict):
        raise RuntimeError("Safari trim response is not an object")
    return value


def publish_control_readiness() -> dict[str, Any]:
    value: dict[str, Any] = {
        "version": 1,
        "pid": os.getpid(),
        "updated_at": utc_now(),
        "chrome": {"ok": False},
        "safari": {"ok": False},
    }
    try:
        observed = browserd_control_json("GET", "/health", timeout=5)
        value["chrome"] = {"ok": bool(
            isinstance(observed, dict)
            and observed.get("ok") is True
            and observed.get("service") == "browserd-control"
            and observed.get("transport") == "unix_peer_attested"
        )}
    except Exception as exc:
        value["chrome"] = {"ok": False, "error": type(exc).__name__}
    try:
        observed = unix_control_json(
            SAFARI_TRIM_SOCKET,
            "POST",
            "/authorize",
            timeout=5,
            label="secondary authorization",
        )
        value["safari"] = {"ok": bool(
            isinstance(observed, dict)
            and observed.get("ok") is True
            and observed.get("authorized") is True
        )}
    except Exception as exc:
        value["safari"] = {"ok": False, "error": type(exc).__name__}
    atomic_write_json(CONTROL_READINESS_FILE, value)
    return value


def control_readiness_valid(expected_pid: int, maximum_age_seconds: float = 15) -> bool:
    value = load_json(CONTROL_READINESS_FILE, None)
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("pid") != expected_pid:
        return False
    try:
        stamp = datetime.fromisoformat(str(value.get("updated_at", "")).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return False
    names = ("ch" + "rome", "sa" + "fari")
    return bool(
        -5 <= time.time() - stamp <= maximum_age_seconds
        and all(isinstance(value.get(name), dict) and value[name].get("ok") is True for name in names)
    )


def frontmost_application() -> tuple[str | None, str | None]:
    """Return the frontmost app name and bundle id without activating an app."""
    try:
        front = run(["/usr/bin/lsappinfo", "front"], timeout=2, check=True).stdout.strip()
        if not front:
            return None, None
        detail = run(
            ["/usr/bin/lsappinfo", "info", "-only", "name", "-only", "bundleID", front],
            timeout=2,
            check=True,
        ).stdout
        name_match = re.search(r'"LSDisplayName"="([^"]+)"', detail)
        bundle_match = re.search(r'"CFBundleIdentifier"="([^"]+)"', detail)
        return (
            name_match.group(1) if name_match else None,
            bundle_match.group(1) if bundle_match else None,
        )
    except (OSError, subprocess.SubprocessError):
        return None, None


def hid_idle_seconds() -> float | None:
    """Return seconds since physical keyboard/mouse input from IOHIDSystem."""
    try:
        result = run(["/usr/sbin/ioreg", "-r", "-c", "IOHIDSystem", "-d", "1"], timeout=2, check=True)
        match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', result.stdout)
        return int(match.group(1)) / 1_000_000_000 if match else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def browser_foreground(name: str | None, bundle_id: str | None) -> dict[str, bool]:
    normalized_name = (name or "").strip().lower()
    normalized_bundle = (bundle_id or "").strip().lower()
    return {
        "chrome": normalized_name == "google chrome" or normalized_bundle == "com.google.chrome",
        "safari": normalized_name == "safari" or normalized_bundle == "com.apple.safari",
    }


def refresh_human_presence(policy: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """Publish one fail-closed human/browser activity sample for all agents.

    Presence is advisory for background-safe work on already-owned tabs and a
    hard gate for focus, allocation, trimming, and restarts. A missing or stale
    detector result intentionally protects both browsers.
    """
    cfg = policy.get("human_presence", {})
    recent_seconds = float(cfg.get("recent_input_seconds", 60))
    restart_idle_seconds = float(cfg.get("restart_requires_idle_seconds", 300))
    now = time.time()
    name, bundle_id = frontmost_application()
    idle = hid_idle_seconds()
    source_available = bool((name or bundle_id) and idle is not None)
    foreground = browser_foreground(name, bundle_id) if source_available else {"chrome": True, "safari": True}

    previous = state.get("human_presence", {})
    holds = previous.get("manual_hold_until", {}) if isinstance(previous, dict) else {}
    manual_holds = {
        browser: max(0.0, float(holds.get(browser, 0.0) or 0.0))
        for browser in ("chrome", "safari")
    }
    human_recent = idle is None or idle < recent_seconds
    active: dict[str, bool] = {}
    restart_allowed: dict[str, bool] = {}
    retry_after: dict[str, int | None] = {}
    any_browser_foreground = foreground["chrome"] or foreground["safari"]
    for browser in ("chrome", "safari"):
        held = manual_holds[browser] > now
        active[browser] = not source_available or foreground[browser] or held
        quiet_enough = idle is not None and idle >= restart_idle_seconds
        restart_allowed[browser] = bool(
            source_available
            and quiet_enough
            and not any_browser_foreground
            and not held
        )
        if active[browser] and held:
            retry_after[browser] = max(1, int(manual_holds[browser] - now))
        elif any_browser_foreground or idle is None:
            retry_after[browser] = max(1, int(cfg.get("poll_seconds", 5)))
        elif not quiet_enough:
            retry_after[browser] = max(1, int(restart_idle_seconds - idle))
        else:
            retry_after[browser] = 0

    value = {
        "version": 1,
        "updated_at": utc_now(),
        "observed_at": now,
        "source_available": source_available,
        "frontmost_app": name,
        "frontmost_bundle_id": bundle_id,
        "idle_seconds": round(idle, 3) if idle is not None else None,
        "browser_foreground": foreground,
        "human_recent": human_recent,
        "active": active,
        "manual_hold_until": manual_holds,
        "restart_allowed": restart_allowed,
        "retry_after_seconds": retry_after,
    }
    state["human_presence"] = value
    atomic_write_json(HUMAN_PRESENCE_FILE, value)
    return value


def refresh_human_presence_serialized(
    policy: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    """Sample presence without racing a manual hold/release publication."""
    with exclusive_file_lock(STATE_LOCK_FILE):
        merge_current_manual_holds(state)
        return refresh_human_presence(policy, state)


def human_active(browser: str, state: dict[str, Any]) -> bool:
    presence = state.get("human_presence", {})
    return not isinstance(presence, dict) or bool(presence.get("active", {}).get(browser, True))


def missing_browser_launch_allowed(browser: str, policy: dict[str, Any], state: dict[str, Any]) -> bool:
    """Permit an automatic launch only in a fresh, human-idle foreground window.

    Launching a missing browser is less destructive than restarting one, so it
    uses the shorter recent-input threshold rather than the maintenance idle
    threshold. It can still steal focus, therefore any recent input, either
    browser being foreground, a manual hold, a stale sample, or detector
    failure denies the launch.
    """
    presence = state.get("human_presence", {})
    if not isinstance(presence, dict) or presence.get("source_available") is not True:
        return False
    try:
        observed_at = float(presence.get("observed_at", 0.0))
        updated_at = datetime.fromisoformat(
            str(presence.get("updated_at", "")).replace("Z", "+00:00")
        ).timestamp()
        now = time.time()
        observed_age = now - observed_at
        updated_age = now - updated_at
        stale_seconds = float(policy.get("human_presence", {}).get("stale_seconds", 15))
        hold_until = float(presence.get("manual_hold_until", {}).get(browser, 0.0) or 0.0)
    except (TypeError, ValueError):
        return False
    foreground = presence.get("browser_foreground", {})
    if not isinstance(foreground, dict):
        return False
    return bool(
        -5 <= observed_age <= stale_seconds
        and -5 <= updated_age <= stale_seconds
        and presence.get("human_recent") is False
        and not bool(foreground.get("chrome", True))
        and not bool(foreground.get("safari", True))
        and hold_until <= now
        and not human_active(browser, state)
    )


def restart_allowed(browser: str, state: dict[str, Any]) -> bool:
    presence = state.get("human_presence", {})
    return isinstance(presence, dict) and bool(presence.get("restart_allowed", {}).get(browser, False))


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
    # The broker runs inside an already-authorized tmux identity. launchd
    # itself may not receive AppleEvents/TCC permission, so use the broker
    # first and retain direct control as a fallback for interactive/manual
    # execution.
    try:
        value = safari_control_json("/counts", timeout=4)
        if isinstance(value, dict) and value.get("control_available") is True:
            windows = int(value["windows"])
            tabs = int(value["tabs"])
            if windows >= 0 and tabs >= 0:
                return windows, tabs, None
    except (KeyError, TypeError, ValueError, OSError, urllib.error.URLError, json.JSONDecodeError):
        pass

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


def chrome_code_sign_clone_root() -> Path | None:
    """Resolve Chrome's exact per-user code-sign clone cache directory."""
    try:
        result = run(["/usr/bin/getconf", "DARWIN_USER_TEMP_DIR"], timeout=2, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    raw = result.stdout.strip().rstrip("/")
    if not raw or not Path(raw).is_absolute():
        return None
    temporary = Path(raw).resolve()
    # getconf must resolve to this user's Darwin cache T directory. Refuse any
    # unexpected root rather than letting cleanup scope broaden.
    if temporary.name != "T" or not str(temporary).startswith("/private/var/folders/"):
        return None
    root = temporary.parent / "X" / "com.google.Chrome.code_sign_clone"
    if root.exists():
        metadata = os.lstat(root)
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.getuid()
        ):
            return None
    return root


def chrome_code_sign_clone_candidates() -> list[tuple[Path, os.stat_result]]:
    root = chrome_code_sign_clone_root()
    if root is None or not root.is_dir():
        return []
    candidates: list[tuple[Path, os.stat_result]] = []
    pattern = re.compile(r"^code_sign_clone\.[A-Za-z0-9_-]+$")
    for child in root.iterdir():
        try:
            metadata = os.lstat(child)
        except OSError:
            continue
        if (
            pattern.fullmatch(child.name)
            and stat.S_ISDIR(metadata.st_mode)
            and not stat.S_ISLNK(metadata.st_mode)
            and metadata.st_uid == os.getuid()
            and child.resolve().parent == root.resolve()
        ):
            candidates.append((child, metadata))
    return candidates


def directory_sizes_bytes(paths: list[Path]) -> list[int | None]:
    if not paths:
        return []
    try:
        # One bounded du process is materially cheaper than walking every
        # multi-gigabyte clone in a separate subprocess during status checks.
        result = run(["/usr/bin/du", "-sk", *(str(path) for path in paths)], timeout=30, check=True)
        sizes: dict[str, int] = {}
        for line in result.stdout.splitlines():
            size_text, path_text = line.split(None, 1)
            sizes[path_text] = int(size_text) * 1024
        return [sizes.get(str(path)) for path in paths]
    except (OSError, ValueError, IndexError, subprocess.SubprocessError):
        return [None for _ in paths]


def directory_size_bytes(path: Path) -> int | None:
    return directory_sizes_bytes([path])[0]


def code_sign_clone_status(force: bool = False) -> dict[str, Any]:
    global _clone_status_cache_at, _clone_status_cache
    now = time.monotonic()
    with _clone_status_lock:
        if (
            not force
            and _clone_status_cache
            and now - _clone_status_cache_at <= CODE_SIGN_CLONE_STATUS_CACHE_SECONDS
        ):
            return dict(_clone_status_cache)
        candidates = chrome_code_sign_clone_candidates()
        sizes = directory_sizes_bytes([path for path, _ in candidates])
        known_bytes = sum(size for size in sizes if size is not None)
        wall_now = time.time()
        stale = [
            index for index, (_, metadata) in enumerate(candidates)
            if wall_now - metadata.st_mtime >= CODE_SIGN_CLONE_MIN_AGE_SECONDS
        ]
        root = chrome_code_sign_clone_root()
        disk_path = root
        if disk_path is not None and not disk_path.exists():
            disk_path = disk_path.parent
        if disk_path is None or not disk_path.exists():
            disk_path = RUNTIME_DIR if RUNTIME_DIR.exists() else Path.home()
        try:
            free_bytes = shutil.disk_usage(disk_path).free
        except OSError:
            free_bytes = 0
        required_free_bytes = CODE_SIGN_CLONE_MIN_FREE_BYTES + CODE_SIGN_CLONE_RELAUNCH_RESERVE_BYTES
        value = {
            "code_sign_clone_root": str(root) if root is not None else None,
            "code_sign_clone_count": len(candidates),
            "code_sign_clone_mb": round(known_bytes / (1024 * 1024), 1),
            "code_sign_clone_size_complete": all(size is not None for size in sizes),
            "stale_code_sign_clone_count": len(stale),
            "stale_code_sign_clone_mb": round(
                sum(sizes[index] or 0 for index in stale) / (1024 * 1024),
                1,
            ),
            "filesystem_free_mb": round(free_bytes / (1024 * 1024), 1),
            "relaunch_required_free_mb": round(required_free_bytes / (1024 * 1024), 1),
            "relaunch_disk_blocked": free_bytes < required_free_bytes,
        }
        _clone_status_cache = value
        _clone_status_cache_at = time.monotonic()
        return dict(value)


def clone_has_live_reference(path: Path, processes: list[dict[str, Any]]) -> bool:
    exact = str(path)
    if any(exact in str(process.get("command", "")) for process in processes):
        return True
    try:
        result = run(["/usr/sbin/lsof", "-nP", "-Fpn", "+D", exact], timeout=20)
    except (OSError, subprocess.SubprocessError):
        # Reference attribution failed, so deletion is denied fail-closed.
        return True
    # macOS lsof can emit valid matching records yet return 1 for +D when the
    # caller itself owns the descriptor. Treat machine-readable PID/file/name
    # output as authoritative instead of relying only on the exit status.
    records = [line for line in result.stdout.splitlines() if line]
    if any(line.startswith("p") and line[1:].isdigit() for line in records):
        return True
    if records:
        return True
    return result.returncode != 1


def maintain_code_sign_clones() -> list[dict[str, Any]]:
    """Daily, exact-scope cleanup of abandoned Chrome code-sign clones."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(CODE_SIGN_CLONE_CLEANUP_LOCK, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return []
        previous = load_json(CODE_SIGN_CLONE_CLEANUP_STAMP, {})
        now = time.time()
        try:
            last_attempt = float(previous.get("attempted_at", 0.0)) if isinstance(previous, dict) else 0.0
        except (TypeError, ValueError):
            last_attempt = 0.0
        if now - last_attempt < CODE_SIGN_CLONE_CLEANUP_INTERVAL_SECONDS:
            return []
        candidates = chrome_code_sign_clone_candidates()
        # Record the attempt before expensive lsof walks so a failure cannot
        # create a five-second cleanup storm.
        atomic_write_json(CODE_SIGN_CLONE_CLEANUP_STAMP, {"attempted_at": now, "updated_at": utc_now()})
        if len(candidates) <= 1:
            code_sign_clone_status(force=True)
            return []
        newest = max(candidates, key=lambda item: item[1].st_mtime)[0]
        invalidate_process_table_cache()
        processes = process_table()
        removed: list[dict[str, Any]] = []
        for candidate, original_metadata in sorted(candidates, key=lambda item: item[1].st_mtime):
            if candidate == newest or now - original_metadata.st_mtime < CODE_SIGN_CLONE_MIN_AGE_SECONDS:
                continue
            size = directory_size_bytes(candidate)
            if size is None or clone_has_live_reference(candidate, processes):
                continue
            # Re-resolve every destructive target and inode immediately before
            # deletion. Never widen this to the cache parent or a glob.
            current = chrome_code_sign_clone_candidates()
            if len(current) <= 1:
                break
            current_by_path = {path: metadata for path, metadata in current}
            current_metadata = current_by_path.get(candidate)
            current_newest = max(current, key=lambda item: item[1].st_mtime)[0]
            if (
                current_metadata is None
                or candidate == current_newest
                or (current_metadata.st_dev, current_metadata.st_ino)
                != (original_metadata.st_dev, original_metadata.st_ino)
                or time.time() - current_metadata.st_mtime < CODE_SIGN_CLONE_MIN_AGE_SECONDS
            ):
                continue
            shutil.rmtree(candidate)
            record = {"path": str(candidate), "bytes": size}
            removed.append(record)
            log(f"removed abandoned Chrome code-sign clone path={candidate} bytes={size}")
        code_sign_clone_status(force=True)
        return removed
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def code_sign_clone_maintenance_loop() -> None:
    while True:
        try:
            maintain_code_sign_clones()
        except Exception as exc:
            log(f"Chrome code-sign clone maintenance error: {type(exc).__name__}: {exc}")
        time.sleep(60 * 60)


def inspect(policy: dict[str, Any]) -> dict[str, Any]:
    processes = process_table()
    chrome = chrome_roots(processes)
    safari = safari_roots(processes)
    canonical = [p for p in chrome if canonical_chrome(p, policy)]
    chrome_tree = descendants(processes, {p["pid"] for p in canonical})
    safari_tree = safari_processes(processes, safari)
    rogue_browsers = rogue_chromium_roots(processes)
    windows, safari_tabs, safari_control_error = safari_counts() if safari else (0, 0, None)
    targets = chrome_targets(policy) if canonical else []
    return {
        "timestamp": utc_now(),
        "chrome": {
            "root_pids": [p["pid"] for p in chrome],
            "canonical_pids": [p["pid"] for p in canonical],
            "unauthorized_pids": [p["pid"] for p in chrome if p not in canonical],
            "rogue_chromium_pids": [p["pid"] for p in rogue_browsers],
            "rogue_browser_pids": [p["pid"] for p in rogue_browsers],
            "tabs": len(targets),
            "cdp_available": (bool(targets) or chrome_cdp_available(policy)) if canonical else False,
            "launch_policy_compliant": len(canonical) == 1 and chrome_launch_compliant(canonical[0], policy),
            "attributed_pids": [p["pid"] for p in chrome_tree],
            **aggregate(chrome_tree),
        },
        "safari": {
            "root_pids": [p["pid"] for p in safari],
            "windows": windows,
            "tabs": safari_tabs,
            "control_available": safari_control_error is None,
            "control_error": safari_control_error,
            "attributed_pids": [p["pid"] for p in safari_tree],
            **aggregate(safari_tree),
        },
        "maintenance": code_sign_clone_status(),
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
            ttl = 10 * 60 * 1000 if path == BRIDGE_CLAIMS else 90 * 1000
            age = now_ms - stamp
            if age < -60 * 1000 or age > ttl:
                continue
            claim_pid = entry.get("pid")
            if isinstance(claim_pid, (int, float)) and claim_pid > 1 and not pid_alive(int(claim_pid)):
                continue
            count += 1
    if browser == "chrome":
        try:
            drain = browserd_control_json("GET", "/drain", timeout=2)
            active_leases = drain.get("active_leases") if isinstance(drain, dict) else None
            if isinstance(active_leases, bool) or not isinstance(active_leases, int) or active_leases < 0:
                raise RuntimeError("browserd lease ledger returned an invalid active count")
            count += active_leases
        except Exception:
            # Restart admission cannot prove Chrome is lease-free without the
            # authenticated browserd ledger. One protective synthetic claim
            # keeps maintenance fail-closed until control health is restored.
            count += 1
    return count


def drain_state_value(draining: bool, retry_after_seconds: int = 0) -> dict[str, Any]:
    retry = max(0, int(retry_after_seconds))
    return {
        "version": 1,
        "updated_at": utc_now(),
        "draining": {"chrome": bool(draining), "safari": bool(draining)},
        "retry_after_seconds": {
            "chrome": retry if draining else 0,
            "safari": retry if draining else 0,
        },
    }


def write_safari_drain_state_locked(draining: bool, retry_after_seconds: int = 0) -> None:
    atomic_write_json(DRAIN_STATE_FILE, drain_state_value(draining, retry_after_seconds))


def live_safari_claims_locked() -> list[dict[str, Any]]:
    """Read live Safari claims while the cross-process claims lock is held."""
    try:
        raw = SAFARI_CLAIMS.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Safari claim registry is not valid JSON") from exc
    if not isinstance(value, list):
        raise RuntimeError("Safari claim registry must be a JSON array")
    now_ms = time.time() * 1000
    live: list[dict[str, Any]] = []
    for index, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise RuntimeError(f"Safari claim registry entry {index} is malformed")
        stamp = entry.get("heartbeat") or entry.get("claimedAt") or entry.get("claimed_at")
        if isinstance(stamp, str):
            try:
                stamp = datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000
            except ValueError as exc:
                raise RuntimeError(f"Safari claim registry entry {index} has an invalid timestamp") from exc
        if not isinstance(stamp, (int, float)):
            raise RuntimeError(f"Safari claim registry entry {index} has no heartbeat")
        # A future heartbeat is suspicious but protective. It remains active
        # rather than allowing a destructive restart through clock corruption.
        if now_ms - float(stamp) >= SAFARI_CLAIM_TTL_MS:
            continue
        claim_pid = entry.get("pid")
        if isinstance(claim_pid, (int, float)) and claim_pid > 1 and not pid_alive(int(claim_pid)):
            continue
        live.append(entry)
    return live


def validate_browserd_drain(response: Any) -> tuple[str, list[str], bool]:
    if not isinstance(response, dict) or response.get("ok") is not True or response.get("active") is not True:
        raise RuntimeError("browserd did not confirm an active authenticated drain")
    drain_id = response.get("drain_id")
    lease_ids = response.get("active_lease_ids")
    active_leases = response.get("active_leases")
    active_operations = response.get("active_operations")
    queued_operations = response.get("queued_operations")
    if not isinstance(drain_id, str) or not drain_id:
        raise RuntimeError("browserd drain response omitted drain_id")
    if not isinstance(response.get("already_active"), bool):
        raise RuntimeError("browserd drain response omitted its ownership state")
    if (
        not isinstance(lease_ids, list)
        or not all(isinstance(value, str) and value for value in lease_ids)
        or isinstance(active_leases, bool)
        or not isinstance(active_leases, int)
        or active_leases != len(lease_ids)
        or isinstance(active_operations, bool)
        or not isinstance(active_operations, int)
        or active_operations < 0
        or isinstance(queued_operations, bool)
        or not isinstance(queued_operations, int)
        or queued_operations < 0
    ):
        raise RuntimeError("browserd drain response omitted its atomic live-lease snapshot")
    return drain_id, lease_ids, bool(response.get("launch_in_progress", False))


def validate_browserd_drain_renewal(
    response: Any,
    expected_id: str,
) -> tuple[list[str], bool, int, int]:
    if not isinstance(response, dict) or response.get("ok") is not True or response.get("active") is not True:
        raise RuntimeError("browserd did not confirm drain renewal")
    if response.get("drain_id") != expected_id:
        raise RuntimeError("browserd renewed a different drain owner")
    lease_ids = response.get("active_lease_ids")
    counts = (
        response.get("active_leases"),
        response.get("active_operations"),
        response.get("queued_operations"),
    )
    if (
        not isinstance(lease_ids, list)
        or not all(isinstance(value, str) and value for value in lease_ids)
        or any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in counts)
        or counts[0] != len(lease_ids)
    ):
        raise RuntimeError("browserd drain renewal omitted its atomic work snapshot")
    launch_in_progress = response.get("launch_in_progress", False)
    if not isinstance(launch_in_progress, bool):
        raise RuntimeError("browserd drain renewal has invalid launch state")
    # Existing leases/operations may finish after admission closes. They are
    # not a lost drain; the destructive boundary waits for this snapshot to
    # reach zero under the configured timeout.
    return lease_ids, launch_in_progress, counts[1], counts[2]


def clear_cross_browser_drain(drain_id: str | None) -> None:
    """Clear both allocation gates while preventing a Safari claim race."""
    chrome_error: Exception | None = None
    with exclusive_file_lock(SAFARI_CLAIMS_LOCK_FILE):
        if drain_id:
            try:
                result = browserd_control_json(
                    "DELETE",
                    f"/drain/{urllib.parse.quote(drain_id, safe='')}",
                    timeout=4,
                )
                if not isinstance(result, dict) or result.get("ok") is not True or result.get("active") is not False:
                    raise RuntimeError("browserd did not confirm drain release")
            except Exception as exc:
                chrome_error = exc
        # Never reopen Safari while Chrome's allocation gate has an unknown
        # owner/state. The caller retries the authenticated release; a fresh
        # true publication keeps the local lane fail-closed in the meantime.
        write_safari_drain_state_locked(chrome_error is not None, 600 if chrome_error else 0)
    if chrome_error is not None:
        raise chrome_error


def acquire_cross_browser_drain(
    policy: dict[str, Any],
) -> tuple[dict[str, Any], threading.Event, threading.Event, threading.Thread]:
    """Atomically close both allocation lanes before waiting for quiescence."""
    del policy
    # browserd clamps at ten minutes. Request the full bound because an
    # age/reference-checked code-sign clone sweep can precede Chrome relaunch;
    # the drain is still explicitly released immediately in ``finally``.
    ttl_seconds = 600
    drain_id: str | None = None
    browserd_drain_owned = False
    try:
        with exclusive_file_lock(SAFARI_CLAIMS_LOCK_FILE):
            # Safari coordinators take this exact lock before checking the
            # drain and claiming, so no claim can appear after this write.
            write_safari_drain_state_locked(True, ttl_seconds)
            response = browserd_control_json(
                "POST",
                "/drain",
                {"reason": "enforcer_restart", "ttl_s": ttl_seconds},
                timeout=6,
            )
            candidate_id = response.get("drain_id") if isinstance(response, dict) else None
            candidate_owned = isinstance(response, dict) and response.get("already_active") is False
            if candidate_owned and isinstance(candidate_id, str) and candidate_id:
                drain_id = candidate_id
                # Remember ownership before validating the remainder so a
                # malformed response cannot strand a drain we just created.
                browserd_drain_owned = True
            validated_id, lease_ids, launch_in_progress = validate_browserd_drain(response)
            browserd_drain_owned = response["already_active"] is False
            if not browserd_drain_owned:
                # A separate maintainer owns this allocation gate. Never use
                # its drain as authority for our restart and never DELETE it.
                drain_id = None
                raise RuntimeError("browserd is already draining for another owner")
            drain_id = validated_id
            # Validate Safari's registry while claims are linearized with the
            # admission close. Existing work is expected and drains below.
            live_safari_claims_locked()
            del lease_ids, launch_in_progress
    except Exception:
        try:
            clear_cross_browser_drain(drain_id if browserd_drain_owned else None)
        except Exception as clear_error:
            log(f"failed to clear aborted browser drains: {type(clear_error).__name__}: {clear_error}")
        raise

    stopped = threading.Event()
    lost = threading.Event()
    lease_lock = threading.Lock()
    lease_state: dict[str, Any] = {
        "drain_id": drain_id,
        "last_success": time.monotonic(),
        "last_error": None,
    }

    def heartbeat() -> None:
        while not stopped.wait(DRAIN_STATE_HEARTBEAT_SECONDS):
            try:
                with exclusive_file_lock(SAFARI_CLAIMS_LOCK_FILE):
                    write_safari_drain_state_locked(True, ttl_seconds)
                with lease_lock:
                    current_id = str(lease_state["drain_id"])
                renewal = browserd_control_json(
                    "POST",
                    f"/drain/{urllib.parse.quote(current_id, safe='')}/heartbeat",
                    {"ttl_s": ttl_seconds},
                    timeout=6,
                )
                validate_browserd_drain_renewal(renewal, current_id)
                with lease_lock:
                    recovered = lease_state.get("last_error") is not None
                    lease_state["last_success"] = time.monotonic()
                    lease_state["last_error"] = None
                lost.clear()
                if recovered:
                    log("browserd drain heartbeat recovered")
            except Exception as exc:
                message = f"{type(exc).__name__}: {exc}"
                with lease_lock:
                    should_log = lease_state.get("last_error") != message
                    lease_state["last_error"] = message
                lost.set()
                if should_log:
                    log(f"browser drain heartbeat lost: {message}")
                # A request can time out after browserd committed the renewal,
                # or browserd can restart after its persisted drain expired.
                # Re-establish an owned gate, but never adopt/delete a foreign
                # maintainer's drain and never declare recovery while work is
                # live behind a newly acquired gate.
                try:
                    with lease_lock:
                        previous_id = str(lease_state["drain_id"])
                    response = browserd_control_json(
                        "POST",
                        "/drain",
                        {"reason": "enforcer_restart", "ttl_s": ttl_seconds},
                        timeout=6,
                    )
                    candidate_id, lease_ids, launch_in_progress = validate_browserd_drain(response)
                    same_owner = candidate_id == previous_id
                    newly_owned = response.get("already_active") is False
                    if not same_owner and not newly_owned:
                        raise RuntimeError("a foreign browserd drain owns recovery")
                    with lease_lock:
                        lease_state["drain_id"] = candidate_id
                    # Recovery proves ownership/admission closure. Existing
                    # work is allowed to drain under the caller's timeout.
                    del lease_ids, launch_in_progress
                    with lease_lock:
                        lease_state["last_success"] = time.monotonic()
                        lease_state["last_error"] = None
                    lost.clear()
                    log("browserd drain ownership re-established after heartbeat loss")
                except Exception as recovery_exc:
                    recovery_message = f"{type(recovery_exc).__name__}: {recovery_exc}"
                    with lease_lock:
                        if lease_state.get("last_error") != recovery_message:
                            lease_state["last_error"] = recovery_message
                            log(f"browserd drain recovery pending: {recovery_message}")

    thread = threading.Thread(target=heartbeat, name="safari-drain-heartbeat", daemon=True)
    thread.start()
    return lease_state, stopped, lost, thread


def finish_cross_browser_drain(
    lease_state: dict[str, Any],
    stopped: threading.Event,
    thread: threading.Thread,
) -> None:
    """Release both gates reliably before automation workers are resumed."""
    stopped.set()
    # A heartbeat iteration can include one bounded renewal and one bounded
    # ownership-recovery request. Do not clear its drain concurrently: a timed
    # join could otherwise let that thread reacquire a gate after our DELETE.
    while thread.is_alive():
        thread.join(timeout=1)
    last_log = 0.0
    while True:
        drain_id = str(lease_state.get("drain_id") or "")
        if not drain_id:
            raise RuntimeError("owned browserd drain id is unavailable during release")
        try:
            clear_cross_browser_drain(drain_id)
            return
        except Exception as exc:
            now = time.time()
            if now - last_log >= 60:
                log(
                    "browser drain release pending; Safari remains closed and workers paused: "
                    f"{type(exc).__name__}: {exc}"
                )
                last_log = now
            time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)


def publish_idle_drain_state() -> None:
    """Keep the fail-closed Safari admission file fresh outside maintenance."""
    with exclusive_file_lock(SAFARI_CLAIMS_LOCK_FILE):
        # Check while holding the claims lock. This ordering ensures a restart
        # can never publish true and then be overwritten by a stale daemon tick.
        if not restart_in_progress():
            write_safari_drain_state_locked(False)


def wait_for_cross_browser_drain(
    policy: dict[str, Any],
    lease_state: dict[str, Any],
    lost: threading.Event,
) -> bool:
    """Wait for pre-drain Chrome/Safari work after admission is closed."""
    timeout_seconds = max(1, int(policy.get("drain_timeout_seconds", 30)))
    deadline = time.monotonic() + timeout_seconds
    last_log = 0.0
    while time.monotonic() < deadline:
        try:
            with exclusive_file_lock(SAFARI_CLAIMS_LOCK_FILE):
                safari_claims = live_safari_claims_locked()
            drain_id = str(lease_state.get("drain_id") or "")
            if not drain_id:
                raise RuntimeError("owned browserd drain id is unavailable")
            renewal = browserd_control_json(
                "POST",
                f"/drain/{urllib.parse.quote(drain_id, safe='')}/heartbeat",
                {"ttl_s": 600},
                timeout=6,
            )
            lease_ids, launch_in_progress, active_operations, queued_operations = (
                validate_browserd_drain_renewal(renewal, drain_id)
            )
            lease_state["last_success"] = time.monotonic()
            lease_state["last_error"] = None
            lost.clear()
            if (
                not safari_claims
                and not lease_ids
                and not launch_in_progress
                and active_operations == 0
                and queued_operations == 0
            ):
                return True
            now = time.monotonic()
            if now - last_log >= 5:
                log(
                    "restart drain waiting for active work: "
                    f"chrome_leases={len(lease_ids)} safari_claims={len(safari_claims)} "
                    f"chrome_launch={launch_in_progress} active_operations={active_operations} "
                    f"queued_operations={queued_operations}"
                )
                last_log = now
        except Exception as exc:
            lost.set()
            lease_state["last_error"] = f"{type(exc).__name__}: {exc}"
            now = time.monotonic()
            if now - last_log >= 5:
                log(f"restart drain verification pending: {type(exc).__name__}: {exc}")
                last_log = now
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(1, remaining))
    log(f"restart drain timeout after {timeout_seconds}s; browsers remain running")
    return False


def set_nice(pid: int, value: int) -> None:
    try:
        os.setpriority(os.PRIO_PROCESS, pid, value)
    except (PermissionError, ProcessLookupError, AttributeError):
        pass


def normalize_browser_priorities(policy: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, list[int]]:
    """Reapply the low-priority budget to every attributed browser helper.

    Chrome descendants usually inherit the root nice value, while Safari's
    launchd-owned WebKit XPC services may not. This once-per-cycle operation is
    idempotent; a process already at a numerically higher (more restrictive)
    nice value remains there if macOS refuses to raise its priority.
    """
    adjusted: dict[str, list[int]] = {"chrome": [], "safari": []}
    for browser in ("chrome", "safari"):
        raw_pids = snapshot.get(browser, {}).get("attributed_pids", [])
        pids = sorted({int(pid) for pid in raw_pids if isinstance(pid, int) and pid > 1})
        target = int(policy[browser].get("nice", 8))
        for pid in pids:
            set_nice(pid, target)
        adjusted[browser] = pids
    return adjusted


def cooling(browser: str, state: dict[str, Any]) -> bool:
    return float(state["cool_until"].get(browser, 0)) > time.time()


def _launch_chrome_unlocked(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
    if cooling("chrome", state):
        remaining = int(float(state["cool_until"]["chrome"]) - time.time())
        log(f"Chrome launch denied during cooling window ({remaining}s remaining)")
        return None
    maintain_code_sign_clones()
    disk = code_sign_clone_status(force=True)
    if disk.get("relaunch_disk_blocked") is True:
        log(
            "Chrome launch denied because filesystem free space is below the "
            f"{disk.get('relaunch_required_free_mb')}MB relaunch reserve "
            f"(free_mb={disk.get('filesystem_free_mb')})"
        )
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


def _launch_safari_unlocked(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
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


def launch_chrome(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
    """Serialize Chrome ensures across launchd, browserd, and manual callers."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with CHROME_LAUNCH_LOCK_FILE.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            invalidate_process_table_cache()
            roots = [
                process for process in chrome_roots(process_table())
                if canonical_chrome(process, policy)
            ]
            if roots:
                if chrome_cdp_available(policy):
                    return int(roots[0]["pid"])
                # Starting another root cannot repair a root that already owns
                # the profile lock. It creates a duplicate which the singleton
                # guard then kills, usually leaving the original broken root.
                # Only the controlled restart path may retire this root first.
                log(
                    "Chrome launch deferred: canonical root exists but CDP is unavailable; "
                    "a controlled restart is required"
                )
                return None
            return _launch_chrome_unlocked(policy, state)
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def launch_safari(policy: dict[str, Any], state: dict[str, Any]) -> int | None:
    """Serialize Safari ensures so one application root is created."""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with SAFARI_LAUNCH_LOCK_FILE.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            invalidate_process_table_cache()
            roots = safari_roots(process_table())
            if roots:
                return int(roots[0]["pid"])
            return _launch_safari_unlocked(policy, state)
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


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


def restart_browser(
    browser: str,
    reason: str,
    policy: dict[str, Any],
    state: dict[str, Any],
    force: bool = False,
) -> bool:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    restart_lock = RESTART_LOCK_FILE.open("a+", encoding="utf-8")
    try:
        fcntl.flock(restart_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        restart_lock.close()
        log(f"{browser} restart skipped because another controlled restart is active")
        return False
    now = time.time()
    minimum = int(policy["minimum_restart_interval_seconds"])
    since = now - float(state["last_restart"].get(browser, 0))
    if since < minimum:
        log(f"{browser} restart suppressed by backoff ({int(minimum - since)}s remaining): {reason}")
        restart_lock.close()
        return False
    paused: list[int] = []
    drain_lease: dict[str, Any] | None = None
    drain_stopped: threading.Event | None = None
    drain_lost: threading.Event | None = None
    drain_thread: threading.Thread | None = None
    maintenance_started = False
    browsers_verified_healthy = False
    try:
        refresh_human_presence_serialized(policy, state)
        if not force and not restart_allowed(browser, state):
            state["restart_pending"][browser] = {"reason": reason, "requested_at": utc_now()}
            persist_state(state)
            log(f"{browser} restart deferred for human activity or an active lease: {reason}")
            return False
        if browser == "chrome":
            try:
                maintain_code_sign_clones()
                disk = code_sign_clone_status(force=True)
            except Exception as exc:
                disk = {
                    "relaunch_disk_blocked": True,
                    "last_error": f"{type(exc).__name__}: {exc}",
                }
            if disk.get("relaunch_disk_blocked") is True:
                state["restart_pending"][browser] = {
                    "reason": reason,
                    "requested_at": utc_now(),
                    "last_error": "Chrome restart denied by relaunch disk reserve",
                    "filesystem_free_mb": disk.get("filesystem_free_mb"),
                    "relaunch_required_free_mb": disk.get("relaunch_required_free_mb"),
                }
                persist_state(state)
                log(
                    "Chrome restart aborted before termination because the relaunch disk "
                    f"reserve is unavailable: free_mb={disk.get('filesystem_free_mb')} "
                    f"required_mb={disk.get('relaunch_required_free_mb')}"
                )
                return False
        try:
            drain_lease, drain_stopped, drain_lost, drain_thread = acquire_cross_browser_drain(policy)
        except Exception as exc:
            state["restart_pending"][browser] = {
                "reason": reason,
                "requested_at": utc_now(),
                "last_error": f"{type(exc).__name__}: {exc}",
            }
            persist_state(state)
            log(f"{browser} restart aborted before termination: {type(exc).__name__}: {exc}")
            return False
        if not wait_for_cross_browser_drain(policy, drain_lease, drain_lost):
            state["restart_pending"][browser] = {
                "reason": reason,
                "requested_at": utc_now(),
                "last_error": (
                    f"active browser work did not quiesce within "
                    f"{int(policy.get('drain_timeout_seconds', 30))}s"
                ),
            }
            persist_state(state)
            log(f"{browser} restart deferred; active work exceeded the drain timeout")
            return False
        cooldown_seconds = int(policy["cooldown_seconds"])
        # Linearize the emergency human hold with the destructive boundary.
        # Either hold wins this lock and the restart aborts, or termination has
        # already begun before the hold command returns to its caller.
        with exclusive_file_lock(STATE_LOCK_FILE):
            merge_current_manual_holds(state)
            refresh_human_presence(policy, state)
            if not force and not restart_allowed(browser, state):
                state["restart_pending"][browser] = {"reason": reason, "requested_at": utc_now()}
                atomic_write_json(STATE_FILE, state)
                log(f"{browser} restart deferred because the human became active during drain")
                return False
            if drain_lost is None or drain_lost.is_set():
                state["restart_pending"][browser] = {
                    "reason": reason,
                    "requested_at": utc_now(),
                    "last_error": "browserd drain heartbeat was not healthy at the stop boundary",
                }
                atomic_write_json(STATE_FILE, state)
                log(f"{browser} restart aborted because browserd drain renewal was lost")
                return False
            if browser == "safari":
                paused = pause_safari_automation()
            # Publish cooling before the root disappears so a concurrent daemon
            # cycle cannot race in and immediately relaunch it.
            state["cool_until"][browser] = (
                time.time() + int(policy["stop_grace_seconds"]) + cooldown_seconds
            )
            state["last_reason"][browser] = reason
            atomic_write_json(STATE_FILE, state)
            maintenance_started = True
            stop_browser(browser, policy)
        state["cool_until"][browser] = time.time() + cooldown_seconds
        persist_state(state)
        log(f"{browser} cooling for {cooldown_seconds}s: {reason}")
        while cooling(browser, state):
            time.sleep(min(1, max(0.1, state["cool_until"][browser] - time.time())))
        state["cool_until"][browser] = 0.0
        refresh_human_presence_serialized(policy, state)
        if not force and not missing_browser_launch_allowed(browser, policy, state):
            state["last_reason"][browser] = f"relaunch deferred after controlled stop: {reason}"
            state["restart_pending"][browser] = {
                "reason": reason,
                "requested_at": utc_now(),
                "last_error": "human activity or hold appeared during cooling",
            }
            persist_state(state)
            log(f"{browser} relaunch deferred because human activity appeared during cooling")
            if drain_lost is None:
                raise RuntimeError("cross-browser drain heartbeat state is unavailable")
            recover_browsers_under_drain(policy, state, drain_lost)
            browsers_verified_healthy = True
        launch_error: str | None = None
        try:
            launched_pid = (
                launch_chrome(policy, state)
                if browser == "chrome"
                else launch_safari(policy, state)
            )
        except Exception as exc:
            launched_pid = None
            launch_error = f"{type(exc).__name__}: {exc}"
        if launched_pid is None:
            launch_error = launch_error or "browser did not become ready"
            state["last_reason"][browser] = f"relaunch failed after controlled stop: {reason}"
            state["restart_pending"][browser] = {
                "reason": reason,
                "requested_at": utc_now(),
                "last_error": launch_error,
            }
            persist_state(state)
            log(f"{browser} relaunch failed; browser remains stopped: {launch_error}")
            if drain_lost is None:
                raise RuntimeError("cross-browser drain heartbeat state is unavailable")
            recover_browsers_under_drain(policy, state, drain_lost)
            browsers_verified_healthy = True
        final_health = browser_health_snapshot(policy)
        if drain_lost is None:
            raise RuntimeError("cross-browser drain heartbeat state is unavailable")
        if not final_health["healthy"] or drain_lost.is_set():
            recover_browsers_under_drain(policy, state, drain_lost)
        browsers_verified_healthy = True
        state["last_restart"][browser] = time.time()
        state["restart_count"][browser] = int(state["restart_count"].get(browser, 0)) + 1
        state["breaches"][browser] = 0
        state["restart_pending"]["chrome"] = None
        state["restart_pending"]["safari"] = None
        persist_state(state)
        return True
    finally:
        if maintenance_started and not browsers_verified_healthy:
            if drain_lost is None or drain_thread is None:
                # This state should be unreachable: termination occurs only
                # after the heartbeat tuple exists. Do not resume paused work.
                log("critical: maintenance started without a drain keeper; preserving paused state")
                while True:
                    time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)
            if not drain_thread.is_alive():
                drain_lost.set()
            recover_browsers_under_drain(policy, state, drain_lost)
            browsers_verified_healthy = True
        if drain_lease is not None and drain_stopped is not None and drain_thread is not None:
            finish_cross_browser_drain(drain_lease, drain_stopped, drain_thread)
        if not maintenance_started or browsers_verified_healthy:
            resume_processes(paused)
        fcntl.flock(restart_lock.fileno(), fcntl.LOCK_UN)
        restart_lock.close()


def trim_chrome_tabs(policy: dict[str, Any]) -> int:
    maximum = int(policy["chrome"]["max_tabs"])
    try:
        value = browserd_control_json(
            "POST",
            "/trim-managed",
            {"maximum": maximum, "max_close": 3},
            timeout=17,
        )
    except (OSError, RuntimeError, TypeError, urllib.error.URLError, json.JSONDecodeError):
        return 0
    if not isinstance(value, dict) or value.get("ok") is not True:
        return 0
    closed_raw = value.get("closed_count")
    if isinstance(closed_raw, bool) or not isinstance(closed_raw, int) or not 0 <= closed_raw <= 3:
        return 0
    closed = closed_raw
    if closed:
        log(f"Chrome agent-tab reclaim: atomically_closed={closed} total_cap={maximum}")
    return closed


def trim_safari_tabs(policy: dict[str, Any]) -> int:
    maximum = int(policy["safari"]["max_tabs"])
    _, tabs, control_error = safari_counts()
    if control_error:
        return 0
    excess = tabs - maximum
    if excess <= 0:
        return 0
    try:
        value = safari_trim_json(maximum, timeout=17)
        if value.get("ok") is True:
            closed_raw = value.get("closed", 0)
            if isinstance(closed_raw, bool) or not isinstance(closed_raw, int) or not 0 <= closed_raw <= 2:
                return 0
            if closed_raw:
                log(f"Safari tab cap enforced through enforcer-only control socket: closed={closed_raw} max={maximum}")
            return closed_raw
    except (OSError, RuntimeError, ValueError, socket.timeout, json.JSONDecodeError):
        return 0
    # No ownership-blind AppleScript fallback. If the authenticated broker is
    # unavailable, preserving human tabs is safer than forcing the cap.
    return 0


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
    safari = safari_roots(processes)
    if len(safari) > 1:
        terminate_pids(
            [p["pid"] for p in safari[1:]],
            int(policy.get("rogue_kill_grace_seconds", 2)),
            "duplicate Safari root denied",
        )
        safari = safari[:1]
    restart_active = restart_in_progress()
    if (
        ensure_running
        and not restart_active
        and policy["chrome"].get("enabled", True)
        and not canonical
        and not cooling("chrome", state)
        and missing_browser_launch_allowed("chrome", policy, state)
    ):
        launch_chrome(policy, state)
    if (
        ensure_running
        and not restart_active
        and policy["safari"].get("enabled", True)
        and not safari
        and not cooling("safari", state)
        and missing_browser_launch_allowed("safari", policy, state)
    ):
        launch_safari(policy, state)


def browser_health_snapshot(policy: dict[str, Any]) -> dict[str, Any]:
    """Return a fresh, bounded readiness proof for both singleton browsers."""
    invalidate_process_table_cache()
    processes = process_table()
    chrome_rows = chrome_roots(processes)
    canonical = [process for process in chrome_rows if canonical_chrome(process, policy)]
    rogues = rogue_chromium_roots(processes)
    safari_rows = safari_roots(processes)
    chrome_ready = bool(
        len(chrome_rows) == 1
        and len(canonical) == 1
        and not rogues
        and chrome_launch_compliant(canonical[0], policy)
        and chrome_cdp_available(policy)
    )
    safari_error: str | None = None
    if len(safari_rows) == 1:
        _, _, safari_error = safari_counts()
    safari_ready = len(safari_rows) == 1 and safari_error is None
    value: dict[str, Any] = {"healthy": chrome_ready and safari_ready}
    value["chrome"] = {
        "healthy": chrome_ready,
        "roots": [process["pid"] for process in chrome_rows],
        "canonical": [process["pid"] for process in canonical],
        "rogues": [process["pid"] for process in rogues],
    }
    value["safari"] = {
        "healthy": safari_ready,
        "roots": [process["pid"] for process in safari_rows],
        "control_error": safari_error,
    }
    return value


def recover_browsers_under_drain(
    policy: dict[str, Any],
    state: dict[str, Any],
    drain_lost: threading.Event,
) -> dict[str, Any]:
    """Keep both lanes closed until both singleton applications are healthy."""
    attempts = {"chrome": 0, "safari": 0}
    next_attempt = {"chrome": 0.0, "safari": 0.0}
    last_status_log = 0.0
    last_state_write = 0.0
    while True:
        try:
            health = browser_health_snapshot(policy)
        except Exception as exc:
            now = time.time()
            if now - last_status_log >= 60:
                log(
                    "browser maintenance health probe failed; drains remain active: "
                    f"{type(exc).__name__}: {exc}"
                )
                last_status_log = now
            time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)
            continue
        heartbeat_healthy = not drain_lost.is_set()
        if health["healthy"] and heartbeat_healthy:
            return health
        now = time.time()
        if now - last_status_log >= 60:
            log(
                "browser maintenance recovery holding drains: "
                f"chrome_healthy={health['chrome']['healthy']} "
                f"safari_healthy={health['safari']['healthy']} "
                f"drain_heartbeat_healthy={heartbeat_healthy} attempts={attempts}"
            )
            last_status_log = now
        if now - last_state_write >= 30:
            for browser in ("chrome", "safari"):
                if not health[browser]["healthy"]:
                    pending = state["restart_pending"].get(browser)
                    reason = pending.get("reason") if isinstance(pending, dict) else "browser recovery"
                    state["restart_pending"][browser] = {
                        "reason": reason,
                        "requested_at": utc_now(),
                        "last_error": "maintenance drain retained until both browsers are healthy",
                        "launch_attempts": attempts[browser],
                    }
            try:
                persist_state(state)
            except Exception as exc:
                log(f"browser recovery state publication failed: {type(exc).__name__}: {exc}")
            last_state_write = now
        if not heartbeat_healthy:
            time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)
            continue

        try:
            refresh_human_presence_serialized(policy, state)
        except Exception as exc:
            log(f"browser recovery presence probe failed: {type(exc).__name__}: {exc}")
            time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)
            continue
        for browser in ("chrome", "safari"):
            roots = health[browser]["roots"]
            if (
                health[browser]["healthy"]
                or roots
                or attempts[browser] >= 3
                or now < next_attempt[browser]
                or not missing_browser_launch_allowed(browser, policy, state)
            ):
                continue
            attempts[browser] += 1
            delay = min(300, 5 * (2 ** (attempts[browser] - 1)))
            next_attempt[browser] = time.time() + delay
            try:
                launcher = globals()[f"launch_{browser}"]
                launched = launcher(policy, state)
                if launched is None:
                    log(
                        f"{browser} recovery start attempt={attempts[browser]}/3 failed; "
                        f"next attempt in {delay}s"
                    )
            except Exception as exc:
                log(
                    f"{browser} recovery start attempt={attempts[browser]}/3 error: "
                    f"{type(exc).__name__}: {exc}"
                )
        time.sleep(DRAIN_STATE_HEARTBEAT_SECONDS)


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
    if not restart_allowed(browser, state):
        state["breaches"][browser] = 0
        state["restart_pending"][browser] = {"reason": reason, "requested_at": utc_now()}
        log(f"{browser} maintenance pending until human/lease quiet window: {reason}")
        return
    policy_path = RUNTIME_POLICY if RUNTIME_POLICY.exists() else DEFAULT_POLICY
    command = [
        TRUSTED_PYTHON,
        str(Path(__file__).resolve()),
        "--policy",
        str(policy_path),
        "restart",
        browser,
        "--reason",
        "policy_breach",
    ]
    with (RUNTIME_DIR / "restart-worker.log").open("a", encoding="utf-8") as output:
        worker = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    state["breaches"][browser] = 0
    state["last_reason"][browser] = reason
    log(f"scheduled controlled {browser} restart worker pid={worker.pid}: {reason}")


def command_runs_script(command: str, script: Path, interpreters: set[str]) -> bool:
    """Match an interpreter's first script argument without shell re-parsing.

    ``ps`` does not re-quote paths containing spaces. Comparing the exact raw
    argument prefix avoids treating an allowed script name later in an
    attacker's command line as authorization.
    """
    executable, separator, arguments = command.strip().partition(" ")
    if not separator or Path(executable).name not in interpreters:
        return False
    expected = str(script)
    return arguments == expected or arguments.startswith(expected + " ")


UNSAFE_RUNTIME_ENVIRONMENT = frozenset({
    "BASH_ENV",
    "ENV",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONINSPECT",
    "PYTHONSTARTUP",
    "PYTHONUSERBASE",
    "PYTHONWARNINGS",
    "RUBYOPT",
    "PERL5OPT",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "ZDOTDIR",
})


def process_has_safe_runtime_environment(pid: int) -> bool:
    """Fail closed when a purported broker has a preload/search-path override."""
    result = run(["ps", "eww", "-p", str(pid), "-o", "command="], timeout=2)
    if result.returncode != 0:
        return False
    return not any(
        re.search(rf"(?:^|\s){re.escape(name)}=", result.stdout)
        for name in UNSAFE_RUNTIME_ENVIRONMENT
    )


def launchd_service_pid(label: str) -> int | None:
    result = run(["launchctl", "print", f"gui/{os.getuid()}/{label}"], timeout=2)
    if result.returncode != 0:
        return None
    match = re.search(r"(?m)^\s*pid\s*=\s*(\d+)\s*$", result.stdout)
    return int(match.group(1)) if match else None


def approved_cdp_client(process: dict[str, Any]) -> bool:
    """Authorize only the exact launchd-owned installed browserd process."""
    command = process["command"]
    return bool(
        command_runs_script(command, BROWSERD_RUNTIME, {"node"})
        and int(process.get("ppid", -1)) == 1
        and launchd_service_pid(BROWSERD_LAUNCHD_LABEL) == int(process["pid"])
        and process_has_safe_runtime_environment(int(process["pid"]))
    )


def playwright_mcp_connector(process: dict[str, Any]) -> bool:
    """Identify an executing Playwright MCP connector, not text search tools."""
    command = process["command"]
    executable, separator, arguments = command.strip().partition(" ")
    name = Path(executable).name.lower()
    if name == "playwright-mcp":
        return True
    if name not in {"node", "npm", "npx", "npm-cli.js", "npx-cli.js"} or not separator:
        return False
    lowered = arguments.lower()
    return (
        lowered.startswith("playwright-mcp ")
        or "/playwright-mcp " in lowered
        or "/playwright-mcp/" in lowered
        or "@playwright/mcp" in lowered
    )


def cdp_client_pids() -> set[int]:
    """Return client-side PIDs with an established outbound CDP connection."""
    result = run(
        [
            "/usr/sbin/lsof", "-nP", "-a", "-iTCP:9222",
            "-sTCP:ESTABLISHED", "-Fpn",
        ],
        timeout=3,
    )
    if result.returncode not in (0, 1):
        raise RuntimeError(f"CDP socket ownership query failed: {result.stderr.strip()}")
    current_pid: int | None = None
    clients: set[int] = set()
    for line in result.stdout.splitlines():
        if line.startswith("p") and line[1:].isdigit():
            current_pid = int(line[1:])
        elif (
            current_pid is not None
            and line.startswith("n")
            and line[1:].endswith("->127.0.0.1:9222")
        ):
            clients.add(current_pid)
    return clients


def process_rows_for_pids(pids: set[int]) -> list[dict[str, Any]]:
    """Refresh only socket-owning PIDs instead of rescanning every process."""
    positive = sorted(pid for pid in pids if isinstance(pid, int) and pid > 0)
    if not positive:
        return []
    result = run(
        [
            "ps", "-p", ",".join(str(pid) for pid in positive),
            "-o", "pid=,ppid=,pcpu=,rss=,command=",
        ],
        timeout=3,
    )
    # ps exits 1 when every requested PID disappeared between lsof and ps.
    if result.returncode not in (0, 1):
        raise RuntimeError(f"targeted CDP process query failed: {result.stderr.strip()}")
    return parse_process_rows(result.stdout)


def cdp_policy_offenders() -> dict[int, str]:
    """Find idle Playwright connectors and unauthorized raw CDP clients."""
    client_pids = cdp_client_pids()
    # The broad table is intentionally cached: the fast guard must not run a
    # host-wide ps scan twice a second. Socket owners get one targeted refresh
    # so a new direct client cannot hide behind that cache.
    processes = process_table()
    by_pid = {process["pid"]: process for process in process_rows_for_pids(client_pids)}
    offenders = {
        process["pid"]: "direct Playwright MCP connector bypasses browser leases"
        for process in processes
        if playwright_mcp_connector(process)
    }
    for pid in client_pids:
        process = by_pid.get(pid)
        if process is not None and not approved_cdp_client(process):
            offenders[pid] = "unauthorized raw client connected directly to Chrome CDP 9222"
    return offenders


def immediate_cdp_offenders(offenders: dict[int, str]) -> dict[int, str]:
    return {
        pid: reason for pid, reason in offenders.items()
        if reason == "unauthorized raw client connected directly to Chrome CDP 9222"
    }


def fast_singleton_guard(policy: dict[str, Any]) -> None:
    """Kill forbidden browser roots quickly, independent of resource polling.

    Many browser-backed renderers live for only a few seconds. A two-second
    process guard prevents those dormant or dynamically invoked paths from
    escaping the slower CPU/RSS/tab enforcement cycle.
    """
    pending: dict[int, tuple[float, str]] = {}
    cdp_offenders: dict[int, str] = {}
    last_cdp_scan = 0.0
    grace = float(policy.get("rogue_kill_grace_seconds", 2))
    interval = float(policy.get("rogue_poll_seconds", 1))
    while True:
        try:
            processes = browser_process_table()
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
            now = time.monotonic()
            cdp_scan_interval = max(CDP_CLIENT_SCAN_SECONDS, interval)
            if now - last_cdp_scan >= cdp_scan_interval:
                try:
                    cdp_offenders = cdp_policy_offenders()
                except Exception as exc:
                    # Socket attribution is defense in depth. A transient lsof
                    # failure must not disable root singleton enforcement.
                    log(f"CDP client ownership scan error: {type(exc).__name__}: {exc}")
                last_cdp_scan = now
            offenders.update({
                pid: reason for pid, reason in cdp_offenders.items() if pid_alive(pid)
            })
            immediate_cdp = immediate_cdp_offenders(offenders)
            for pid, reason in immediate_cdp.items():
                log(f"fast guard immediately force-stopping pid={pid}: {reason}")
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                offenders.pop(pid, None)
                cdp_offenders.pop(pid, None)
                pending.pop(pid, None)
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
    publish_idle_drain_state()
    presence = refresh_human_presence_serialized(policy, state)
    reconcile_singletons(policy, state, ensure_running=True)
    if not presence["active"]["chrome"]:
        trim_chrome_tabs(policy)
    if not presence["active"]["safari"]:
        trim_safari_tabs(policy)
    snapshot = inspect(policy)
    snapshot["priority_normalization"] = normalize_browser_priorities(policy, snapshot)
    snapshot["human_presence"] = presence
    for browser in ("chrome", "safari"):
        reasons = violations(snapshot, browser, policy)
        # Tabs/windows are capacity constraints, not permission to destroy a
        # person's browser session. Ownership-aware reclaim handles them; if
        # only human tabs remain, new agent work queues instead.
        restart_reasons = [
            reason for reason in reasons
            if not reason.startswith("tabs=") and not reason.startswith("windows=")
        ]
        snapshot[browser]["policy_violations"] = reasons
        if restart_reasons:
            state["breaches"][browser] = int(state["breaches"].get(browser, 0)) + 1
            sample = int(state["breaches"][browser])
            required = int(policy["sustained_breach_samples"])
            if sample == 1 or sample == required or sample % 12 == 0:
                log(f"{browser} resource breach sample={sample}/{required}: {', '.join(restart_reasons)}")
        else:
            state["breaches"][browser] = 0
            state["restart_pending"][browser] = None
        pending = state["restart_pending"].get(browser)
        if restart_reasons and pending and restart_allowed(browser, state):
            schedule_restart(browser, str(pending.get("reason") or "; ".join(restart_reasons)), state)
            continue
        if int(state["breaches"][browser]) >= int(policy["sustained_breach_samples"]):
            schedule_restart(browser, "; ".join(restart_reasons), state)
    state["last_check"] = utc_now()
    state["snapshot"] = snapshot
    # A separately invoked controlled restart owns state while it holds the
    # restart lock. Do not overwrite its cooling deadline with a stale cycle.
    persist_state(state, skip_during_restart=True)
    return snapshot


TRUSTED_NODE = "/opt/homebrew/bin/node"
TRUSTED_TSX = str((REPO_DIR / "node_modules" / "tsx" / "dist" / "cli.mjs").resolve(strict=False))
SAFE_SAFARI_MCP_ENVIRONMENT = {
    **{name: "" for name in sorted(UNSAFE_RUNTIME_ENVIRONMENT)},
    "HOME": str(Path.home()),
    "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    "PYTHONNOUSERSITE": "1",
    "PYTHONSAFEPATH": "1",
}
SAFE_SAFARI_MCP_ENTRYPOINTS = {
    "safari-cloud-sync": ("packages/cloud-sync/src/api/mcp-server.ts", {}),
    "safari-instagram-comments": ("packages/instagram-comments/src/api/mcp-server.ts", {}),
    "safari-instagram-dm": ("packages/instagram-dm/src/api/mcp-server.ts", {}),
    "safari-linkedin": ("packages/linkedin-automation/src/api/mcp-server.ts", {}),
    "safari-market-research": ("packages/market-research/src/api/mcp-server.ts", {}),
    "safari-medium": (
        "packages/medium-automation/src/api/mcp-server.ts",
        {"MEDIUM_PORT": "3108", "SAFARI_AUTOMATION_WINDOW": "2"},
    ),
    "safari-threads-comments": ("packages/threads-comments/src/api/mcp-server.ts", {}),
    "safari-tiktok-comments": ("packages/tiktok-comments/src/api/mcp-server.ts", {}),
    "safari-tiktok-dm": ("packages/tiktok-dm/src/api/mcp-server.ts", {}),
    "safari-twitter-comments": ("packages/twitter-comments/src/api/mcp-server.ts", {}),
    "safari-twitter-dm": ("packages/twitter-dm/src/api/mcp-server.ts", {}),
    "safari-upwork": ("packages/upwork-automation/src/api/mcp-server.ts", {}),
}


def canonical_chrome_bridge_config() -> dict[str, Any]:
    return {
        "command": TRUSTED_NODE,
        "args": [str(CHROME_BRIDGE_SERVER)],
        "env": dict(SAFE_SAFARI_MCP_ENVIRONMENT),
    }


def canonical_safari_service_config(name: str) -> dict[str, Any] | None:
    spec = SAFE_SAFARI_MCP_ENTRYPOINTS.get(name)
    if spec is None:
        return None
    entrypoint, environment = spec
    absolute_entrypoint = str((REPO_DIR / entrypoint).resolve(strict=False))
    return {
        "command": TRUSTED_NODE,
        "args": [TRUSTED_TSX, absolute_entrypoint],
        "env": {**SAFE_SAFARI_MCP_ENVIRONMENT, **environment},
    }


def migratable_safari_service_mcp(name: str, config: Any) -> bool:
    """Recognize only the reviewed legacy-relative form for one-time migration."""
    spec = SAFE_SAFARI_MCP_ENTRYPOINTS.get(name)
    if spec is None or not isinstance(config, dict):
        return False
    if set(config) - {"command", "args", "env"}:
        return False
    entrypoint, environment = spec
    if config.get("args") != ["tsx", entrypoint]:
        return False
    if config.get("env", {}) != environment:
        return False
    legacy_npx = str(Path("/opt/homebrew/bin/npx").resolve(strict=False))
    return config.get("command") in {"npx", "/opt/homebrew/bin/npx", legacy_npx}


def canonical_safari_service_mcp(name: str, config: Any) -> bool:
    """Allow only exact reviewed Safari proxies with fixed executable/env."""
    canonical = canonical_safari_service_config(name)
    return canonical is not None and config == canonical


def direct_browser_mcp(name: str, config: Any) -> bool:
    """Identify MCPs that can launch/control a browser outside leased lanes."""
    normalized_name = name.strip().lower()
    canonical_bridge = canonical_chrome_bridge_config()
    if normalized_name == "chrome-bridge" and config == canonical_bridge:
        return False
    if canonical_safari_service_mcp(normalized_name, config):
        return False
    if isinstance(config, dict):
        arguments = config.get("args")
        if isinstance(arguments, list):
            argument_paths = {
                str(Path(value).expanduser().resolve(strict=False))
                for value in arguments
                if isinstance(value, str) and ("/" in value or value.endswith((".js", ".ts")))
            }
            reviewed_entrypoints = {
                str((REPO_DIR / entrypoint).resolve(strict=False))
                for entrypoint, _ in SAFE_SAFARI_MCP_ENTRYPOINTS.values()
            }
            reviewed_entrypoints.add(str(CHROME_BRIDGE_SERVER.resolve(strict=False)))
            if argument_paths & reviewed_entrypoints:
                # A reviewed broker under another name or with any altered
                # command/args/environment is not the reviewed broker.
                return True
    command_text = ""
    if isinstance(config, dict):
        def scalar_strings(value: Any) -> list[str]:
            if isinstance(value, dict):
                flattened: list[str] = []
                for key, child in value.items():
                    flattened.append(str(key))
                    flattened.extend(scalar_strings(child))
                return flattened
            if isinstance(value, list):
                flattened = []
                for child in value:
                    flattened.extend(scalar_strings(child))
                return flattened
            if isinstance(value, (str, int, float, bool)):
                return [str(value)]
            return []

        # Endpoints are frequently hidden in `url`, `env`, or transport
        # sub-objects rather than command/args. Inspect the complete server
        # record while never logging any of its possibly secret values.
        command_text = " ".join(scalar_strings(config)).lower()
        environment = config.get("env")
        if isinstance(environment, dict) and any(
            str(key).upper() in UNSAFE_RUNTIME_ENVIRONMENT for key in environment
        ):
            return True
        flattened = scalar_strings(config)
        if any(
            (match := re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", value)) is not None
            and match.group(1).upper() in UNSAFE_RUNTIME_ENVIRONMENT
            for value in flattened
        ):
            return True
        # MCP transports often split an endpoint into independently innocent
        # fields.  Treat any loopback spelling plus the reserved CDP port as
        # direct browser access, including IPv4 shorthand such as 127.1.
        flattened_lower = [value.lower() for value in flattened]
        loopback = any(loopback_reference(value) for value in flattened_lower)
        cdp_port = any(cdp_port_reference(value) for value in flattened_lower)
        if loopback and cdp_port:
            return True
        cdp_hint = any(
            any(marker in value for marker in ("cdp", "devtools", "debug_port", "debug-port"))
            for value in flattened_lower
        )
        numeric_fragments = "".join(value.strip() for value in flattened_lower if value.strip().isdigit())
        if loopback and cdp_hint and "9222" in numeric_fragments:
            return True
        command = config.get("command")
        arguments = config.get("args", [])
        if isinstance(command, str) and isinstance(arguments, list) and all(
            isinstance(argument, str) for argument in arguments
        ):
            executable_text = shlex.join([command, *arguments])
            if command_denial(executable_text, default_state()) is not None:
                return True
    combined = f"{normalized_name} {command_text}"
    return any(pattern in combined for pattern in (
        "playwright",
        "puppeteer",
        "chrome-devtools",
        "chrome-remote-interface",
        "connectovercdp",
        "cdp.new",
        "cdp.list",
        "--cdp-endpoint",
        "--remote-debugging-port",
        "127.0.0.1:9222",
        "localhost:9222",
        "2130706433:9222",
        "0x7f000001:9222",
        "[::1]:9222",
        "9222/json/",
        "9222/devtools/",
        "/json/new",
        "/json/list",
        "safaridriver",
        "waterfox_bridge",
        "waterfox-bridge",
        "geckodriver",
        "brave browser",
        "packages/services/src/sora/sora-mcp.ts",
        "sora-full-automation",
        "safari-mcp-lxman",
        "lxman-safari-mcp",
        "applescript-mcp",
        "macos-automator-mcp",
    )) or any(pattern in normalized_name for pattern in (
        "applescript",
        "macos-automator",
        "browser",
        "chrome",
        "safari",
        "waterfox",
    ))


CHROME_BRIDGE_TOOL_NAMES = frozenset({
    "claim", "release", "list_profiles", "status", "tabs", "launch", "launch_profile",
    "navigate", "new_tab", "close_tab", "screenshot", "get_content", "evaluate",
    "click", "type", "press_key", "scroll", "wait", "batch",
    "chrome_claim_profile", "chrome_release_profile", "chrome_list_profiles",
    "chrome_status", "chrome_tabs", "chrome_launch", "chrome_launch_profile",
    "chrome_navigate", "chrome_new_tab", "chrome_close_tab", "chrome_screenshot",
    "chrome_get_content", "chrome_evaluate", "chrome_click", "chrome_type",
    "chrome_press_key", "chrome_scroll", "chrome_wait", "chrome_batch",
})


def canonical_leased_tool_name(tool_name: str) -> bool:
    """Match only tools exported by exact, installed leased browser servers."""
    match = re.fullmatch(r"mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)", tool_name.strip())
    if match is None:
        return False
    server_name = match.group(1).lower().replace("_", "-")
    method_name = match.group(2).lower().replace("-", "_")
    if server_name == "chrome-bridge":
        return method_name in CHROME_BRIDGE_TOOL_NAMES
    return server_name in SAFE_SAFARI_MCP_ENTRYPOINTS


def leased_tool_denial(tool_name: str) -> str | None:
    if not canonical_leased_tool_name(tool_name):
        return "Direct browser-capable tool is not an approved leased Chrome/Safari MCP"
    findings = config_violations()
    if findings:
        return "Leased browser tool denied until the installed agent configuration passes audit"
    return None


def parsed_toml(text: str) -> dict[str, Any]:
    try:
        value = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise RuntimeError("Codex configuration is not valid TOML") from exc
    if not isinstance(value, dict):
        raise RuntimeError("Codex configuration root must be a TOML table")
    return value


def blocked_codex_mcp_names(text: str) -> set[str]:
    value = parsed_toml(text)
    servers = value.get("mcp_servers", {})
    if not isinstance(servers, dict):
        raise RuntimeError("Codex mcp_servers must be a TOML table")
    return {
        str(name) for name, config in servers.items()
        if direct_browser_mcp(str(name), config)
    }


def toml_header_path(raw_header: str) -> tuple[str, ...] | None:
    """Parse a TOML table header without implementing TOML key quoting."""
    marker = "__actp_browser_enforcer_table_marker__"
    opening = "[[" if raw_header.lstrip().startswith("[[") else "["
    closing = "]]" if opening == "[[" else "]"
    stripped = raw_header.strip()
    if not stripped.startswith(opening) or closing not in stripped:
        return None
    end = stripped.find(closing, len(opening))
    table = stripped[len(opening):end].strip()
    try:
        root = tomllib.loads(f"{opening}{table}{closing}\n{marker} = true\n")
    except tomllib.TOMLDecodeError:
        return None

    def find(value: Any, path: tuple[str, ...]) -> tuple[str, ...] | None:
        if isinstance(value, dict):
            if value.get(marker) is True:
                return path
            for key, child in value.items():
                found = find(child, (*path, str(key)))
                if found is not None:
                    return found
        elif isinstance(value, list):
            for child in value:
                found = find(child, path)
                if found is not None:
                    return found
        return None

    return find(root, ())


def remove_codex_mcp_servers(text: str, names: set[str]) -> str:
    """Remove selected MCP table families, including quoted/dotted names."""
    if not names:
        return text
    kept: list[str] = []
    removing = False
    for line, structural in toml_structural_lines(text):
        stripped = line.lstrip()
        if structural and stripped.startswith("["):
            path = toml_header_path(line)
            removing = bool(
                path is not None
                and len(path) >= 2
                and path[0] == "mcp_servers"
                and path[1] in names
            )
        if not removing:
            kept.append(line)
    configured = "".join(kept)
    survivors = blocked_codex_mcp_names(configured) & names
    if survivors:
        raise RuntimeError(
            "cannot safely rewrite inline/unsupported browser MCP TOML entries: "
            + ", ".join(sorted(survivors))
        )
    return configured


def rewrite_playwright_json(value: Any, inject_root_bridge: bool = False, _root: bool = True) -> int:
    """Remove direct browser MCPs recursively and configure one root bridge."""
    changes = 0
    if isinstance(value, dict):
        servers = value.get("mcpServers")
        if isinstance(servers, dict):
            for name, config in list(servers.items()):
                normalized = str(name).strip().lower()
                if migratable_safari_service_mcp(normalized, config):
                    canonical = canonical_safari_service_config(normalized)
                    if canonical is not None and config != canonical:
                        servers[name] = canonical
                        changes += 1
            removed = [name for name, config in servers.items() if direct_browser_mcp(name, config)]
            for name in removed:
                del servers[name]
                changes += 1
        elif _root and inject_root_bridge:
            servers = {}
            value["mcpServers"] = servers
            changes += 1
        if _root and inject_root_bridge:
            if not isinstance(servers, dict):
                raise RuntimeError("root mcpServers must be a JSON object")
            canonical = canonical_chrome_bridge_config()
            if servers.get("chrome-bridge") != canonical:
                servers["chrome-bridge"] = canonical
                changes += 1
        for child in value.values():
            changes += rewrite_playwright_json(child, False, False)
    elif isinstance(value, list):
        for child in value:
            changes += rewrite_playwright_json(child, False, False)
    elif _root and inject_root_bridge:
        raise RuntimeError("root agent configuration must be a JSON object")
    return changes


def rewrite_claude_desktop_browser_preferences(value: Any) -> int:
    """Unpair and disable Claude Desktop's unleased built-in browser lane."""
    if not isinstance(value, dict):
        raise RuntimeError("Claude Desktop configuration must be a JSON object")
    changes = 0
    preferences = value.get("preferences")
    if preferences is None:
        preferences = {}
        value["preferences"] = preferences
        changes += 1
    if not isinstance(preferences, dict):
        raise RuntimeError("Claude Desktop preferences must be a JSON object")
    if "chromeExtension" in preferences:
        del preferences["chromeExtension"]
        changes += 1
    if preferences.get("allowAllBrowserActions") is not False:
        preferences["allowAllBrowserActions"] = False
        changes += 1
    return changes


def rewrite_openclaw_browser_policy(value: Any) -> int:
    """Disable OpenClaw's dedicated browser and deny its browser tool."""
    if not isinstance(value, dict):
        raise RuntimeError("OpenClaw configuration must be a JSON object")
    changes = 0
    browser = value.get("browser")
    if browser is None:
        browser = {}
        value["browser"] = browser
        changes += 1
    if not isinstance(browser, dict):
        raise RuntimeError("OpenClaw browser configuration must be a JSON object")
    if browser.get("enabled") is not False:
        browser["enabled"] = False
        changes += 1
    tools = value.get("tools")
    if tools is None:
        tools = {}
        value["tools"] = tools
        changes += 1
    if not isinstance(tools, dict):
        raise RuntimeError("OpenClaw tools configuration must be a JSON object")
    deny = tools.get("deny")
    if deny is None:
        deny = []
        tools["deny"] = deny
        changes += 1
    if not isinstance(deny, list) or not all(isinstance(item, str) for item in deny):
        raise RuntimeError("OpenClaw tools.deny must be an array of strings")
    if "browser" not in deny:
        deny.append("browser")
        changes += 1
    return changes


def rewrite_claude_browser_extensions(value: Any) -> int:
    """Unregister Claude Desktop's built-in direct Chrome controller."""
    if not isinstance(value, dict):
        raise RuntimeError("Claude Desktop extension registry must be a JSON object")
    extensions = value.get("extensions")
    if extensions is None:
        return 0
    if not isinstance(extensions, dict):
        raise RuntimeError("Claude Desktop extensions must be a JSON object")
    return 1 if extensions.pop("ant.dir.ant.anthropic.chrome-control", None) is not None else 0


def canonical_claude_command_hook() -> dict[str, Any]:
    return {
        "matcher": "Bash",
        "hooks": [{
            "type": "command",
            "command": f"{TRUSTED_PYTHON} {CLAUDE_COMMAND_HOOK}",
        }],
    }


def rewrite_claude_command_hook(value: Any) -> int:
    """Install one exact, fail-closed Bash policy gate without dropping other hooks."""
    if not isinstance(value, dict):
        raise RuntimeError("Claude settings configuration must be a JSON object")
    hooks = value.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise RuntimeError("Claude settings hooks must be an object")
    entries = hooks.setdefault("PreToolUse", [])
    if not isinstance(entries, list):
        raise RuntimeError("Claude PreToolUse hooks must be an array")
    expected = canonical_claude_command_hook()
    if expected in entries:
        return 0
    entries.append(expected)
    return 1


def configured_json_file(
    path: Path,
    inject_root_bridge: bool = False,
    claude_desktop: bool = False,
    openclaw: bool = False,
    claude_extensions: bool = False,
    command_hook: bool = False,
) -> tuple[bytes, bytes, os.stat_result, int] | None:
    if not path.exists():
        return None
    original, metadata = read_owned_regular_file(path)
    try:
        value = json.loads(original.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot safely rewrite invalid JSON configuration: {path}") from exc
    changes = rewrite_playwright_json(value, inject_root_bridge)
    if claude_desktop:
        changes += rewrite_claude_desktop_browser_preferences(value)
    if openclaw:
        changes += rewrite_openclaw_browser_policy(value)
    if claude_extensions:
        changes += rewrite_claude_browser_extensions(value)
    if command_hook:
        changes += rewrite_claude_command_hook(value)
    if not changes:
        return None
    configured = json.dumps(value, indent=2).encode("utf-8") + b"\n"
    return configured, original, metadata, changes


def remove_toml_table_family(text: str, table: str) -> str:
    target = toml_header_path(f"[{table}]")
    if target is None:
        raise RuntimeError(f"invalid TOML table path requested for removal: {table}")
    kept: list[str] = []
    removing = False
    for line, structural in toml_structural_lines(text):
        path = toml_header_path(line) if structural and line.lstrip().startswith("[") else None
        if path is not None:
            removing = path == target or path[:len(target)] == target
        if not removing:
            kept.append(line)
    return "".join(kept)


def force_toml_plugin_disabled(text: str, table: str) -> str:
    # These are browser plugins whose entire configuration must be disabled.
    # Replacing the complete parsed table family avoids regex edits inside a
    # multiline string and prevents an overlooked nested enable switch.
    text = remove_toml_table_family(text, table)
    return text.rstrip() + f"\n\n[{table}]\nenabled = false\n"


def toml_structural_lines(text: str) -> list[tuple[str, bool]]:
    """Mark lines whose first token is outside TOML multiline strings."""
    result: list[tuple[str, bool]] = []
    multiline: str | None = None
    for line in text.splitlines(keepends=True):
        result.append((line, multiline is None))
        index = 0
        normal_quote: str | None = None
        while index < len(line):
            if multiline is not None:
                end = line.find(multiline, index)
                if end < 0:
                    break
                if multiline == '\"\"\"':
                    slashes = 0
                    cursor = end - 1
                    while cursor >= 0 and line[cursor] == "\\":
                        slashes += 1
                        cursor -= 1
                    if slashes % 2:
                        index = end + 3
                        continue
                multiline = None
                index = end + 3
                continue
            character = line[index]
            if normal_quote is not None:
                if character == normal_quote:
                    if normal_quote == "'" or index == 0 or line[index - 1] != "\\":
                        normal_quote = None
                index += 1
                continue
            if character == "#":
                break
            triple = line[index:index + 3]
            if triple in {'\"\"\"', "'''"}:
                multiline = triple
                index += 3
                continue
            if character in {'\"', "'"}:
                normal_quote = character
            index += 1
    return result


def remove_toml_assignments(text: str, names: set[str]) -> str:
    assignment = re.compile(r"^[ \t]*([A-Za-z0-9_-]+)[ \t]*=")
    kept: list[str] = []
    for line, structural in toml_structural_lines(text):
        match = assignment.match(line) if structural else None
        if match and match.group(1) in names:
            continue
        kept.append(line)
    return "".join(kept)


def decode_toml_string(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1]
    if len(value) >= 2 and value[0] == value[-1] == '"':
        decoded = json.loads(value)
        if isinstance(decoded, str):
            return decoded
    raise ValueError("expected a quoted TOML string")


def encode_toml_string(value: str) -> str:
    return f"'{value}'" if "'" not in value else json.dumps(value)


def blocked_trusted_service(name: str, service: Any) -> bool:
    normalized = name.strip().lower()
    if normalized in {"browser", "chrome", "chrome-browser", "chrome_browser"}:
        return True
    if isinstance(service, str):
        lowered = service.lower()
        return (
            "/plugins/cache/openai-bundled/browser/" in lowered
            or "/plugins/cache/openai-bundled/chrome/" in lowered
        )
    return False


def rewrite_trusted_services(text: str) -> str:
    assignment = re.compile(r"(?m)^(?P<prefix>[ \t]*NODE_REPL_TRUSTED_SERVICES[ \t]*=[ \t]*)(?P<value>[^\n]+)$")
    match = next(
        (
            assignment.match(line.rstrip("\r\n"))
            for line, structural in toml_structural_lines(text)
            if structural and assignment.match(line.rstrip("\r\n"))
        ),
        None,
    )
    if not match:
        return text
    try:
        value = json.loads(decode_toml_string(match.group("value")))
    except (ValueError, json.JSONDecodeError) as exc:
        raise RuntimeError("NODE_REPL_TRUSTED_SERVICES is not a parseable JSON object string") from exc
    if not isinstance(value, dict):
        raise RuntimeError("NODE_REPL_TRUSTED_SERVICES must contain a JSON object")
    filtered = {
        name: service for name, service in value.items()
        if not blocked_trusted_service(str(name), service)
    }
    if filtered == value:
        return text
    encoded = json.dumps(filtered, separators=(",", ":"), ensure_ascii=False)
    replacement = match.group("prefix") + encode_toml_string(encoded)
    replaced = False
    lines: list[str] = []
    for line, structural in toml_structural_lines(text):
        current = assignment.match(line.rstrip("\r\n")) if structural else None
        if current and not replaced:
            newline = "\r\n" if line.endswith("\r\n") else "\n" if line.endswith("\n") else ""
            lines.append(replacement + newline)
            replaced = True
        else:
            lines.append(line)
    return "".join(lines)


def canonical_safari_mcp_toml_block(name: str) -> str:
    config = canonical_safari_service_config(name)
    if config is None:
        raise RuntimeError(f"unknown reviewed Safari MCP: {name}")
    lines = [
        f"[mcp_servers.{name}]",
        f"command = {json.dumps(config['command'])}",
        "args = [" + ", ".join(json.dumps(value) for value in config["args"]) + "]",
    ]
    environment = config.get("env")
    if isinstance(environment, dict) and environment:
        lines.append("")
        lines.append(f"[mcp_servers.{name}.env]")
        lines.extend(f"{key} = {json.dumps(value)}" for key, value in environment.items())
    return "\n".join(lines) + "\n"


def migrate_codex_safari_mcps(text: str) -> str:
    value = parsed_toml(text)
    servers = value.get("mcp_servers", {})
    if not isinstance(servers, dict):
        raise RuntimeError("Codex mcp_servers must be a TOML table")
    names = {
        str(name).strip().lower()
        for name, config in servers.items()
        if migratable_safari_service_mcp(str(name).strip().lower(), config)
        and not canonical_safari_service_mcp(str(name).strip().lower(), config)
    }
    if not names:
        return text
    text = remove_codex_mcp_servers(text, names)
    blocks = "\n".join(canonical_safari_mcp_toml_block(name) for name in sorted(names))
    return text.rstrip() + "\n\n" + blocks


def canonical_codex_command_hook() -> dict[str, Any]:
    return {
        "type": "command",
        "command": f"{TRUSTED_PYTHON} '{CODEX_COMMAND_HOOK}'",
        "timeout": 8,
        "statusMessage": "Enforcing singleton browser policy",
    }


def codex_command_hook_present(value: Any) -> bool:
    hooks = value.get("hooks") if isinstance(value, dict) else None
    entries = hooks.get("PreToolUse") if isinstance(hooks, dict) else None
    if entries is None:
        return False
    if not isinstance(entries, list):
        raise RuntimeError("Codex hooks.PreToolUse must be an array of tables")
    expected = canonical_codex_command_hook()
    return any(
        isinstance(entry, dict)
        and isinstance(entry.get("hooks"), list)
        and expected in entry["hooks"]
        for entry in entries
    )


def ensure_codex_command_hook(text: str) -> str:
    value = parsed_toml(text)
    if codex_command_hook_present(value):
        return text
    expected = canonical_codex_command_hook()
    block = "\n".join((
        "[[hooks.PreToolUse]]",
        "[[hooks.PreToolUse.hooks]]",
        f"type = {json.dumps(expected['type'])}",
        f"command = {json.dumps(expected['command'])}",
        f"timeout = {expected['timeout']}",
        f"statusMessage = {json.dumps(expected['statusMessage'])}",
    ))
    configured = text.rstrip() + "\n\n" + block + "\n"
    if not codex_command_hook_present(parsed_toml(configured)):
        raise RuntimeError("canonical Codex command hook failed TOML verification")
    return configured


def ensure_codex_hooks_enabled(text: str) -> str:
    value = parsed_toml(text)
    features = value.get("features")
    if isinstance(features, dict) and features.get("hooks") is True:
        return text
    lines = text.splitlines(keepends=True)
    structural = toml_structural_lines(text)
    target_index: int | None = None
    end_index = len(lines)
    for index, (line, is_structural) in enumerate(structural):
        path = toml_header_path(line) if is_structural and line.lstrip().startswith("[") else None
        if path == ("features",):
            target_index = index
            continue
        if target_index is not None and index > target_index and path is not None:
            end_index = index
            break
    if target_index is None:
        configured = text.rstrip() + "\n\n[features]\nhooks = true\n"
    else:
        assignment = re.compile(r"^\s*hooks\s*=")
        replaced = False
        for index in range(target_index + 1, end_index):
            if structural[index][1] and assignment.match(lines[index]):
                newline = "\r\n" if lines[index].endswith("\r\n") else "\n"
                lines[index] = "hooks = true" + newline
                replaced = True
                break
        if not replaced:
            lines.insert(end_index, "hooks = true\n")
        configured = "".join(lines)
    verified = parsed_toml(configured).get("features")
    if not isinstance(verified, dict) or verified.get("hooks") is not True:
        raise RuntimeError("could not enable Codex command hooks safely")
    return configured


def configured_codex_toml(text: str) -> str:
    """Return the canonical bridge-only Codex browser configuration text."""
    # Neither Playwright nor the bundled Chrome/in-app-browser plugins enforce
    # browserd leases. Codex gets one chrome-bridge MCP instead, so every action
    # is pinned to an agent-owned target and human tabs stay opaque.
    parsed_toml(text)
    text = migrate_codex_safari_mcps(text)
    blocked = blocked_codex_mcp_names(text)
    text = remove_codex_mcp_servers(text, blocked | {"chrome-bridge"})
    bridge_block = (
        "[mcp_servers.chrome-bridge]\n"
        f"command = {json.dumps(TRUSTED_NODE)}\n"
        f"args = [{json.dumps(str(CHROME_BRIDGE_SERVER))}]\n"
        "env = { "
        + ", ".join(
            f"{key} = {json.dumps(value)}"
            for key, value in SAFE_SAFARI_MCP_ENVIRONMENT.items()
        )
        + " }\n\n"
    )
    text = text.rstrip() + "\n\n" + bridge_block
    text = force_toml_plugin_disabled(text, 'plugins."chrome@openai-bundled"')
    text = force_toml_plugin_disabled(text, 'plugins."browser@openai-bundled"')
    text = force_toml_plugin_disabled(text, 'plugins."computer-use@openai-bundled"')
    text = remove_toml_assignments(text, {
        "BROWSER_USE_AVAILABLE_BACKENDS",
        "NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER",
        "NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME",
    })
    text = rewrite_trusted_services(text)
    text = ensure_codex_hooks_enabled(text)
    text = ensure_codex_command_hook(text)
    configured = parsed_toml(text)
    servers = configured.get("mcp_servers")
    canonical = canonical_chrome_bridge_config()
    if not isinstance(servers, dict) or servers.get("chrome-bridge") != canonical:
        raise RuntimeError("canonical leased Chrome bridge failed TOML verification")
    survivors = {
        str(name) for name, config in servers.items()
        if str(name) != "chrome-bridge" and direct_browser_mcp(str(name), config)
    }
    if survivors:
        raise RuntimeError("direct browser MCP survived Codex rewrite: " + ", ".join(sorted(survivors)))
    return text


def create_configuration_backups(plans: list[dict[str, Any]]) -> tuple[Path, Path]:
    for plan in plans:
        verify_configuration_plan_current(plan)
    backup_root = RUNTIME_DIR / "config-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    backup_root.chmod(0o700)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    transaction = backup_root / f"{timestamp}-{os.getpid()}-{secrets.token_hex(6)}"
    transaction.mkdir(mode=0o700)
    entries: list[dict[str, Any]] = []
    for index, plan in enumerate(plans):
        path = plan["path"]
        metadata = plan["metadata"]
        backup = transaction / f"{index:02d}-{path.name}.backup"
        atomic_write_bytes(
            backup,
            plan["original"],
            stat.S_IMODE(metadata.st_mode),
            metadata.st_uid,
            metadata.st_gid,
        )
        verify_file_replacement(backup, plan["original"], metadata)
        plan["backup"] = backup
        entries.append({
            "path": str(path),
            "backup": str(backup),
            "sha256": hashlib.sha256(plan["original"]).hexdigest(),
            "mode": oct(stat.S_IMODE(metadata.st_mode)),
            "uid": metadata.st_uid,
            "gid": metadata.st_gid,
        })
    manifest = transaction / "manifest.json"
    atomic_write_json(manifest, {
        "version": 1,
        "created_at": utc_now(),
        "status": "prepared",
        "entries": entries,
    })
    return transaction, manifest


def update_configuration_manifest(manifest: Path, status_value: str) -> None:
    value = load_json(manifest, None)
    if not isinstance(value, dict) or not isinstance(value.get("entries"), list):
        raise RuntimeError(f"configuration backup manifest is invalid: {manifest}")
    value["status"] = status_value
    value["updated_at"] = utc_now()
    atomic_write_json(manifest, value)


def restore_configuration_backups(plans: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for plan in plans:
        path = plan["path"]
        metadata = plan["metadata"]
        try:
            backup = plan.get("backup")
            if not isinstance(backup, Path):
                raise RuntimeError("backup path was not recorded")
            original = backup.read_bytes()
            if hashlib.sha256(original).digest() != hashlib.sha256(plan["original"]).digest():
                raise RuntimeError("backup hash mismatch")
            atomic_write_bytes(
                path,
                original,
                stat.S_IMODE(metadata.st_mode),
                metadata.st_uid,
                metadata.st_gid,
            )
            verify_file_replacement(path, original, metadata)
        except Exception as exc:
            errors.append(f"{path}:{type(exc).__name__}:{exc}")
    return errors


def validate_external_agent_configs() -> None:
    """Use app-owned schema validation where a non-launching validator exists."""
    if OPENCLAW_CONFIG.exists():
        executable = shutil.which("openclaw")
        if not executable:
            raise RuntimeError("OpenClaw config exists but its schema validator is unavailable")
        result = run([executable, "config", "validate", "--json"], timeout=20)
        if result.returncode != 0:
            raise RuntimeError(
                f"OpenClaw configuration schema validation failed (exit={result.returncode})"
            )


def apply_configuration_transaction(plans: list[dict[str, Any]]) -> int:
    if not plans:
        findings = config_violations()
        if findings:
            raise RuntimeError(f"agent configuration audit failed: {findings}")
        validate_external_agent_configs()
        return 0
    _, manifest = create_configuration_backups(plans)
    written: list[dict[str, Any]] = []
    total_changes = sum(int(plan["changes"]) for plan in plans)
    try:
        for plan in plans:
            verify_configuration_plan_current(plan)
            metadata = plan["metadata"]
            atomic_write_bytes(
                plan["path"],
                plan["payload"],
                stat.S_IMODE(metadata.st_mode),
                metadata.st_uid,
                metadata.st_gid,
            )
            written.append(plan)
            verify_file_replacement(plan["path"], plan["payload"], metadata)
        findings = config_violations()
        if findings:
            raise RuntimeError(f"agent configuration audit failed: {findings}")
        validate_external_agent_configs()
        # Logging remains inside the transaction. Once the manifest is marked
        # committed, returning the precomputed integer is the only operation.
        log(f"agent configuration transaction validated; backups={manifest.parent}")
        update_configuration_manifest(manifest, "committed")
        return total_changes
    except BaseException as exc:
        # Restore every file this transaction actually replaced. Planning and
        # per-file preflight checks prevent overwriting a config that changed
        # before our replacement; readback failures still roll back as a unit.
        rollback_errors = restore_configuration_backups(written)
        try:
            update_configuration_manifest(
                manifest,
                "rollback_failed" if rollback_errors else "rolled_back",
            )
        except BaseException as manifest_error:
            rollback_errors.append(f"manifest:{type(manifest_error).__name__}:{manifest_error}")
        suffix = (
            f"; rollback errors={rollback_errors}"
            if rollback_errors
            else "; all enforcer-written configs restored"
        )
        raise RuntimeError(f"agent configuration transaction failed: {type(exc).__name__}: {exc}{suffix}") from exc


def configure_agents() -> int:
    if not CHROME_BRIDGE_SERVER.is_file():
        raise RuntimeError(f"leased Chrome bridge entrypoint is missing: {CHROME_BRIDGE_SERVER}")
    plans: list[dict[str, Any]] = []
    json_configs = (
        (Path.home() / ".claude.json", True, False, False, False, False),
        (CLAUDE_SETTINGS_CONFIG, False, False, False, False, True),
        (WORKSPACE / "acd" / ".mcp.json", False, False, False, False, False),
        (WINDSURF_MCP_CONFIG, False, False, False, False, False),
        (CURSOR_MCP_CONFIG, False, False, False, False, False),
        (CLAUDE_DESKTOP_CONFIG, False, True, False, False, False),
        (CLAUDE_EXTENSIONS_CONFIG, False, False, False, True, False),
        (OPENCLAW_CONFIG, False, False, True, False, False),
    )
    for (
        path,
        inject_root_bridge,
        claude_desktop,
        openclaw,
        claude_extensions,
        command_hook,
    ) in json_configs:
        configured = configured_json_file(
            path,
            inject_root_bridge,
            claude_desktop,
            openclaw,
            claude_extensions,
            command_hook,
        )
        if configured is not None:
            payload, original, metadata, changes = configured
            plans.append({
                "path": path,
                "payload": payload,
                "original": original,
                "metadata": metadata,
                "changes": changes,
            })
    codex = CODEX_CONFIG
    if codex.exists():
        original, metadata = read_owned_regular_file(codex)
        try:
            original_text = original.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RuntimeError(f"cannot safely rewrite non-UTF-8 configuration: {codex}") from exc
        configured = configured_codex_toml(original_text).encode("utf-8")
        if configured != original:
            plans.append({
                "path": codex,
                "payload": configured,
                "original": original,
                "metadata": metadata,
                "changes": 1,
            })
    # All parsing and preservation checks above complete before the first
    # secret-bearing configuration is replaced.
    return apply_configuration_transaction(plans)


def toml_plugin_enabled(text: str, table: str) -> bool | None:
    path = toml_header_path(f"[{table}]")
    if path is None:
        return None
    value: Any = parsed_toml(text)
    for component in path:
        if not isinstance(value, dict) or component not in value:
            return None
        value = value[component]
    enabled = value.get("enabled") if isinstance(value, dict) else None
    return enabled if isinstance(enabled, bool) else None


def trusted_service_violations(text: str) -> tuple[bool, bool]:
    try:
        root = parsed_toml(text)
    except RuntimeError:
        return True, False
    values: list[Any] = []

    def collect(node: Any) -> None:
        if isinstance(node, dict):
            if "NODE_REPL_TRUSTED_SERVICES" in node:
                values.append(node["NODE_REPL_TRUSTED_SERVICES"])
            for child in node.values():
                collect(child)
        elif isinstance(node, list):
            for child in node:
                collect(child)

    collect(root)
    for encoded in values:
        if not isinstance(encoded, str):
            return True, False
        try:
            value = json.loads(encoded)
        except json.JSONDecodeError:
            return True, False
        if not isinstance(value, dict):
            return True, False
        if any(blocked_trusted_service(str(name), service) for name, service in value.items()):
            return False, True
    return False, False


def command_hook_integrity_violations() -> list[str]:
    findings: list[str] = []
    if not RUNTIME_COMMAND_HOOK.exists():
        return [f"{RUNTIME_COMMAND_HOOK}:installed-command-hook-missing"]
    try:
        runtime_metadata = os.lstat(RUNTIME_COMMAND_HOOK)
        if (
            not stat.S_ISREG(runtime_metadata.st_mode)
            or stat.S_ISLNK(runtime_metadata.st_mode)
            or runtime_metadata.st_uid != os.getuid()
            or stat.S_IMODE(runtime_metadata.st_mode) != 0o700
        ):
            findings.append(f"{RUNTIME_COMMAND_HOOK}:unsafe-installed-command-hook-metadata")
        runtime_hash = sha256_file(RUNTIME_COMMAND_HOOK)
        if COMMAND_HOOK_SOURCE.exists() and sha256_file(COMMAND_HOOK_SOURCE) != runtime_hash:
            findings.append(f"{RUNTIME_COMMAND_HOOK}:installed-command-hook-source-mismatch")
    except OSError:
        return [f"{RUNTIME_COMMAND_HOOK}:installed-command-hook-unreadable"]
    for path in (CODEX_COMMAND_HOOK, CLAUDE_COMMAND_HOOK):
        try:
            metadata = os.lstat(path)
            if (
                not stat.S_ISREG(metadata.st_mode)
                or stat.S_ISLNK(metadata.st_mode)
                or metadata.st_uid != os.getuid()
                or stat.S_IMODE(metadata.st_mode) != 0o700
            ):
                findings.append(f"{path}:unsafe-command-hook-metadata")
                continue
            if sha256_file(path) != runtime_hash:
                findings.append(f"{path}:command-hook-hash-mismatch")
        except FileNotFoundError:
            findings.append(f"{path}:command-hook-missing")
        except OSError:
            findings.append(f"{path}:command-hook-unreadable")
    return findings


def config_violations() -> list[str]:
    findings: list[str] = command_hook_integrity_violations()
    claude_root = Path.home() / ".claude.json"
    for path in (
        claude_root,
        CLAUDE_SETTINGS_CONFIG,
        WORKSPACE / "acd" / ".mcp.json",
        WINDSURF_MCP_CONFIG,
        CURSOR_MCP_CONFIG,
        CLAUDE_DESKTOP_CONFIG,
        CLAUDE_EXTENSIONS_CONFIG,
        OPENCLAW_CONFIG,
    ):
        if not path.exists():
            continue
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            findings.append(f"{path}:invalid-json-config")
            continue

        def scan(node: Any, location: str) -> None:
            if isinstance(node, dict):
                servers = node.get("mcpServers")
                if isinstance(servers, dict):
                    for name, cfg in servers.items():
                        if direct_browser_mcp(name, cfg):
                            findings.append(f"{path}:{location}/mcpServers/{name}:bypasses-browser-lanes")
                for key, child in node.items():
                    scan(child, f"{location}/{key}")
            elif isinstance(node, list):
                for index, child in enumerate(node):
                    scan(child, f"{location}/{index}")

        scan(value, "")
        if path == claude_root:
            root_servers = value.get("mcpServers") if isinstance(value, dict) else None
            expected = canonical_chrome_bridge_config()
            if not isinstance(root_servers, dict) or root_servers.get("chrome-bridge") != expected:
                findings.append(f"{path}:/mcpServers/chrome-bridge:leased-bridge-missing-or-invalid")
        if path == CLAUDE_SETTINGS_CONFIG:
            hooks = value.get("hooks") if isinstance(value, dict) else None
            entries = hooks.get("PreToolUse") if isinstance(hooks, dict) else None
            if not isinstance(entries, list) or canonical_claude_command_hook() not in entries:
                findings.append(f"{path}:/hooks/PreToolUse:singleton-command-hook-missing")
        if path == CLAUDE_DESKTOP_CONFIG:
            preferences = value.get("preferences") if isinstance(value, dict) else None
            if not isinstance(preferences, dict):
                findings.append(f"{path}:/preferences:browser-controls-not-disabled")
            else:
                if "chromeExtension" in preferences:
                    findings.append(f"{path}:/preferences/chromeExtension:paired-unleased-browser")
                if preferences.get("allowAllBrowserActions") is not False:
                    findings.append(f"{path}:/preferences/allowAllBrowserActions:not-disabled")
        if path == CLAUDE_EXTENSIONS_CONFIG:
            extensions = value.get("extensions") if isinstance(value, dict) else None
            if not isinstance(extensions, dict):
                findings.append(f"{path}:/extensions:invalid-extension-registry")
            elif "ant.dir.ant.anthropic.chrome-control" in extensions:
                findings.append(f"{path}:/extensions/chrome-control:direct-browser-extension-enabled")
        if path == OPENCLAW_CONFIG:
            browser = value.get("browser") if isinstance(value, dict) else None
            tools = value.get("tools") if isinstance(value, dict) else None
            deny = tools.get("deny") if isinstance(tools, dict) else None
            if not isinstance(browser, dict) or browser.get("enabled") is not False:
                findings.append(f"{path}:/browser/enabled:dedicated-browser-not-disabled")
            if not isinstance(deny, list) or "browser" not in deny:
                findings.append(f"{path}:/tools/deny:browser-tool-not-denied")
    codex = CODEX_CONFIG
    if codex.exists():
        try:
            text = codex.read_text(encoding="utf-8")
            value = parsed_toml(text)
        except (OSError, RuntimeError):
            findings.append(f"{codex}:invalid-toml-config")
            return findings
        servers = value.get("mcp_servers")
        expected = canonical_chrome_bridge_config()
        if not isinstance(servers, dict) or servers.get("chrome-bridge") != expected:
            findings.append(f"{codex}:leased-chrome-bridge-missing-or-invalid")
        if isinstance(servers, dict):
            for name, config in servers.items():
                if str(name) == "chrome-bridge":
                    continue
                if direct_browser_mcp(str(name), config):
                    findings.append(f"{codex}:mcp_servers/{name}:bypasses-browser-lanes")
        if toml_plugin_enabled(text, 'plugins."chrome@openai-bundled"') is not False:
            findings.append(f"{codex}:unleased-chrome-plugin-enabled")
        if toml_plugin_enabled(text, 'plugins."browser@openai-bundled"') is not False:
            findings.append(f"{codex}:in-app-browser-enabled")
        if toml_plugin_enabled(text, 'plugins."computer-use@openai-bundled"') is not False:
            findings.append(f"{codex}:unleased-computer-use-enabled")
        features = value.get("features")
        if not isinstance(features, dict) or features.get("hooks") is not True:
            findings.append(f"{codex}:command-hooks-not-enabled")
        try:
            hook_present = codex_command_hook_present(value)
        except RuntimeError:
            hook_present = False
        if not hook_present:
            findings.append(f"{codex}:singleton-command-hook-missing")
        advertised_keys = {
            "BROWSER_USE_AVAILABLE_BACKENDS",
            "NODE_REPL_INSTRUCTIONS_USE_CASE_BROWSER",
            "NODE_REPL_INSTRUCTIONS_USE_CASE_CHROME",
        }

        def contains_advertised_key(node: Any) -> bool:
            if isinstance(node, dict):
                return bool(advertised_keys & {str(key) for key in node}) or any(
                    contains_advertised_key(child) for child in node.values()
                )
            if isinstance(node, list):
                return any(contains_advertised_key(child) for child in node)
            return False

        if contains_advertised_key(value):
            findings.append(f"{codex}:unleased-browser-backend-advertised")
        trusted_invalid, trusted_blocked = trusted_service_violations(text)
        if trusted_invalid:
            findings.append(f"{codex}:trusted-services-unparseable")
        elif trusted_blocked:
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
        empty_braces = "__ACTP_LITERAL_EMPTY_BRACES__"
        protected_command = command.replace("{}", empty_braces)
        lexer = shlex.shlex(protected_command, posix=True, punctuation_chars="();&|{}!\n")
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
            token = token.replace(empty_braces, "{}")
            lowered = token.lower()
            command_separator = token and all(character in ";&|\n" for character in token)
            grouping_separator = token and all(character in "(){}" for character in token)
            mixed_separator = token and all(character in "();&|{}\n" for character in token)
            prefix_separator = not current and (
                lowered in control_boundaries
                or (token and all(character == "!" for character in token))
            )
            if command_separator or grouping_separator or mixed_separator or prefix_separator:
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
            while remaining:
                token = remaining[0]
                if token == "--":
                    remaining.pop(0)
                    break
                if token in {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}:
                    remaining.pop(0)
                    if remaining:
                        remaining.pop(0)
                    continue
                if token.startswith(("--unset=", "--chdir=", "--split-string=")):
                    remaining.pop(0)
                    continue
                if token.startswith("-") or (
                    "=" in token and not token.startswith(("/", "./"))
                ):
                    remaining.pop(0)
                    continue
                break
            continue
        if name in {"command", "builtin"}:
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
            continue
        if name == "exec":
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
                if option in {"-a", "--argv0"} and remaining:
                    remaining.pop(0)
            continue
        if name == "nohup":
            remaining.pop(0)
            if remaining and remaining[0] == "--":
                remaining.pop(0)
            continue
        if name in {"corepack", "xcrun"}:
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
            continue
        if name == "launchctl" and len(remaining) >= 3 and remaining[1] in {"asuser", "bsexec"}:
            remaining = remaining[3:]
            if remaining and remaining[0] == "--":
                remaining.pop(0)
            continue
        if name == "arch":
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                remaining.pop(0)
            continue
        if name == "caffeinate":
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
                if option in {"-t", "-w"} and remaining:
                    remaining.pop(0)
            continue
        if name in {"timeout", "gtimeout"}:
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
                if option in {"-k", "--kill-after", "-s", "--signal"} and remaining:
                    remaining.pop(0)
            # GNU timeout requires one duration before the utility.
            if remaining:
                remaining.pop(0)
            continue
        if name in {"setsid", "chronic", "unbuffer"}:
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option == "--":
                    break
            continue
        if name == "stdbuf":
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option in {"-i", "--input", "-o", "--output", "-e", "--error"} and remaining:
                    remaining.pop(0)
            continue
        if name in {"nice", "time"}:
            remaining.pop(0)
            while remaining and remaining[0].startswith("-"):
                option = remaining.pop(0)
                if option in {"-n", "--adjustment", "-o", "--output", "-f", "--format"} and remaining:
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


def env_split_payload(tokens: list[str]) -> str | None:
    """Extract macOS/BSD env split-string payloads before prefix stripping."""
    if not tokens or Path(tokens[0]).name != "env":
        return None
    for index, token in enumerate(tokens[1:], start=1):
        if token in {"-S", "--split-string"}:
            return tokens[index + 1] if index + 1 < len(tokens) else ""
        for prefix in ("--split-string=", "-S"):
            if token.startswith(prefix) and len(token) > len(prefix):
                return token[len(prefix):]
    return None


def wrapper_embedded_commands(tokens: list[str]) -> list[list[str]]:
    """Find commands executed by common data-driven shell wrappers."""
    if not tokens:
        return []
    executable = Path(tokens[0]).name.lower()
    if executable in {"npm", "npx", "pnpm", "yarn", "bunx"}:
        index = 1
        if executable in {"npm", "pnpm"} and index < len(tokens) and tokens[index] in {"exec", "x", "dlx"}:
            index += 1
        elif executable == "yarn" and index < len(tokens) and tokens[index] == "exec":
            index += 1
        options_with_values = {"-c", "--call", "-p", "--package", "--cache", "--prefix", "-C", "--cwd"}
        while index < len(tokens):
            token = tokens[index]
            if token == "--":
                index += 1
                break
            if not token.startswith("-"):
                break
            index += 1
            if token in options_with_values and index < len(tokens):
                index += 1
        return [tokens[index:]] if index < len(tokens) else []
    if executable == "zargs":
        separators = [index for index, token in enumerate(tokens[1:], start=1) if token == "--"]
        if separators and separators[-1] + 1 < len(tokens):
            return [tokens[separators[-1] + 1:]]
        return []
    if executable in {"xargs", "parallel"}:
        index = 1
        replacement_markers = ["{}", "{.}", "{/}", "{//}", "{#}", "{%}"] if executable == "parallel" else []
        options_with_values = {
            "-e", "-l", "-n", "-p", "-s", "-P", "-L", "-E",
            "--arg-file", "--delimiter", "--eof", "--max-args", "--max-chars",
            "--max-lines", "--max-procs", "--process-slot-var",
        }
        while index < len(tokens):
            token = tokens[index]
            if token == "--":
                index += 1
                break
            if not token.startswith("-"):
                break
            if token in {"-I", "-J", "--replace"}:
                index += 1
                if index < len(tokens):
                    replacement_markers.append(tokens[index])
                    index += 1
                continue
            if token == "-i":
                replacement_markers.append("{}")
                index += 1
                continue
            attached = next((
                prefix for prefix in ("--replace=", "-I", "-J", "-i")
                if token.startswith(prefix) and len(token) > len(prefix)
            ), None)
            if attached is not None:
                replacement_markers.append(token[len(attached):])
                index += 1
                continue
            index += 1
            if token in options_with_values and index < len(tokens):
                index += 1
        if index >= len(tokens):
            return []
        command = list(tokens[index:])
        for position, value in enumerate(command):
            replaced = value
            for marker in replacement_markers:
                if marker:
                    replaced = replaced.replace(marker, "$ACTP_WRAPPER_INPUT")
            command[position] = replaced
        return [command]
    if executable == "find":
        commands: list[list[str]] = []
        for index, token in enumerate(tokens):
            if token not in {"-exec", "-execdir", "-ok", "-okdir"}:
                continue
            command: list[str] = []
            for candidate in tokens[index + 1:]:
                if candidate in {";", "+"}:
                    break
                command.append(candidate)
            if command:
                commands.append(command)
        return commands
    return []


PACKAGE_OPTION_VALUES = frozenset({
    "--cache", "--config", "--cwd", "--dir", "--prefix", "--userconfig",
    "--use-yarnrc", "--workspace", "-C", "-c", "-w",
})


def browser_named_package_script(tokens: list[str]) -> bool:
    """Recognize browser-capable package recipes after global CLI options."""
    if not tokens:
        return False
    executable = Path(tokens[0]).name.lower()
    if executable not in {"npm", "pnpm", "yarn", "bun"}:
        return False
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            index += 1
            break
        if not token.startswith("-"):
            break
        index += 1
        if token in PACKAGE_OPTION_VALUES and index < len(tokens):
            index += 1
    if index >= len(tokens):
        return False
    verb = tokens[index].lower()
    if verb in {"run", "run-script"}:
        index += 1
        while index < len(tokens) and tokens[index].startswith("-"):
            index += 1
        return index < len(tokens) and BROWSER_MARKERS.search(tokens[index]) is not None
    # yarn, pnpm, and bun also accept a package script as the first command.
    return executable in {"pnpm", "yarn", "bun"} and BROWSER_MARKERS.search(verb) is not None


def unsafe_runtime_environment_in_command(tokens: list[str]) -> str | None:
    """Return a dangerous loader/search-path variable present in a command."""
    for token in tokens:
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", token)
        if match and match.group(1).upper() in UNSAFE_RUNTIME_ENVIRONMENT:
            return match.group(1).upper()
    return None


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


def invoked_enforcer_path(tokens: list[str]) -> Path | None:
    """Return the executable script path when this is an enforcer invocation."""
    if not tokens:
        return None
    executable = Path(tokens[0]).name
    if executable in {"python", "python3"}:
        index = 1
        while index < len(tokens):
            token = tokens[index]
            if token in {"-c", "-m"}:
                return None
            if token in {"-W", "-X"}:
                index += 2
                continue
            if token.startswith("-"):
                index += 1
                continue
            path = Path(token)
            return path if path.name == "browser-enforcer.py" else None
        return None
    path = Path(tokens[0])
    return path if executable == "browser-enforcer.py" else None


def is_enforcer_invocation(tokens: list[str]) -> bool:
    """Allow only the two canonical enforcer scripts, never a same-named copy."""
    path = invoked_enforcer_path(tokens)
    if path is None:
        return False
    resolved = path.expanduser().resolve(strict=False)
    allowed = {
        ENFORCER_SOURCE.resolve(strict=False),
        RUNTIME_PROGRAM.resolve(strict=False),
    }
    return resolved in allowed


def enforcer_cli_arguments(tokens: list[str]) -> list[str] | None:
    """Return arguments following the canonical enforcer script."""
    path = invoked_enforcer_path(tokens)
    if path is None:
        return None
    for index, token in enumerate(tokens):
        candidate = Path(token)
        if candidate.name == "browser-enforcer.py" and candidate == path:
            return tokens[index + 1:]
    return None


def enforcer_agent_denial(tokens: list[str]) -> str | None:
    """Allow agents only read-only control-plane calls with canonical policy."""
    arguments = enforcer_cli_arguments(tokens)
    if arguments is None:
        return "Untrusted browser-enforcer.py invocation denied"
    index = 0
    policy_path: Path | None = None
    while index < len(arguments):
        token = arguments[index]
        if token == "--policy":
            if index + 1 >= len(arguments):
                return "Browser enforcer policy option is missing its path"
            policy_path = Path(arguments[index + 1]).expanduser().resolve(strict=False)
            index += 2
            continue
        if token.startswith("--policy="):
            policy_path = Path(token.split("=", 1)[1]).expanduser().resolve(strict=False)
            index += 1
            continue
        if token in {"-h", "--help"}:
            return None
        if token.startswith("-"):
            return "Unsupported browser enforcer option denied to agents"
        break
    if policy_path is not None and policy_path not in {
        DEFAULT_POLICY.resolve(strict=False),
        RUNTIME_POLICY.resolve(strict=False),
    }:
        return "Alternate browser policy denied; use the installed canonical thresholds"
    action = arguments[index] if index < len(arguments) else ""
    if action not in {"status", "presence", "audit-config", "check-command", "check-tool"}:
        return (
            f"Browser enforcer mutation denied to agents ({action or 'missing action'}); "
            "only a human or the installed daemon may change browser lifecycle/holds"
        )
    return None


def node_script_entrypoint(tokens: list[str]) -> Path | None:
    if not tokens:
        return None
    executable = Path(tokens[0]).name.lower()
    if executable not in {"node", "tsx", "ts-node", "bun", "deno"}:
        return None
    lowered = [token.lower() for token in tokens[1:]]
    if any(token in {"--check", "-c", "--test", "--test-only"} for token in lowered):
        return None
    index = 1
    if executable in {"bun", "deno"} and index < len(tokens) and tokens[index] in {"run", "task"}:
        index += 1
    options_with_values = {
        "-r", "--require", "--import", "--loader", "--experimental-loader",
        "--conditions", "--env-file", "--inspect-port",
    }
    while index < len(tokens):
        token = tokens[index]
        if token in {"-e", "--eval", "-p", "--print"}:
            return None
        if token == "--":
            index += 1
            break
        if token in options_with_values:
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        break
    if index >= len(tokens):
        return None
    candidate = Path(tokens[index]).expanduser().resolve(strict=False)
    return candidate if candidate.is_file() else None


def opaque_runtime_loader(tokens: list[str]) -> str | None:
    """Return a pre-execution loader flag whose code cannot be preflighted."""
    if not tokens:
        return None
    executable = Path(tokens[0]).name.lower()
    if executable not in {"node", "tsx", "ts-node", "bun", "deno"}:
        return None
    loader_flags = {
        "-r", "--require", "--import", "--loader", "--experimental-loader",
        "--env-file", "--env-file-if-exists", "--preload",
    }
    for token in tokens[1:]:
        if token == "--":
            break
        if token in loader_flags:
            return token
        for flag in loader_flags:
            if token.startswith(f"{flag}=") or (flag in {"-r"} and token.startswith(flag) and token != flag):
                return flag
    return None


def direct_cdp_script(path: Path) -> bool:
    approved = {
        BROWSERD_SOURCE.resolve(strict=False),
        BROWSERD_RUNTIME.resolve(strict=False),
    }
    resolved = path.resolve(strict=False)
    if resolved in approved:
        return False
    try:
        metadata = os.lstat(resolved)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_size > 2 * 1024 * 1024
        ):
            return False
        content = resolved.read_text(encoding="utf-8", errors="ignore").lower()
    except OSError:
        return False
    direct_apis = (
        "chrome-remote-interface",
        "connectovercdp",
        "puppeteer.connect",
        "cdp.new",
        "cdp.list",
        "target.createtarget",
        "target.gettargets",
    )
    return any(pattern in content for pattern in direct_apis)


NETWORK_CAPABLE_COMMANDS = frozenset({
    "curl", "wget", "wscat", "websocat", "nc", "ncat", "telnet",
    "node", "tsx", "ts-node", "bun", "deno", "python", "python3",
    "ruby", "perl", "php", "bash", "zsh", "sh", "dash", "ksh",
})
NATIVE_NETWORK_COMMANDS = frozenset({
    "curl", "wget", "wscat", "websocat", "nc", "ncat", "telnet",
})


def loopback_reference(text: str) -> bool:
    lowered = text.lower()
    return bool(
        re.search(r"(?<![0-9a-z])127(?:\.\d{1,3}){0,3}(?![0-9a-z.])", lowered)
        or re.search(r"(?<![0-9a-z])0177(?:\.0){2}\.1(?![0-9a-z.])", lowered)
        or re.search(r"(?<![0-9a-z-])localhost(?![0-9a-z.-])", lowered)
        or any(re.search(pattern, lowered) for pattern in (
            r"(?<![0-9a-z.])0\.0\.0\.0(?![0-9a-z.])",
            r"(?<![0-9a-z])2130706433(?![0-9a-z])",
            r"(?<![0-9a-z])0x7f000001(?![0-9a-z])",
            r"\[::1\]", r"0:0:0:0:0:0:0:1", r"::ffff:127\.", r"::ffff:7f00:1",
        ))
        or encoded_loopback_reference(lowered)
    )


def exact_loopback_host(value: str) -> bool:
    host = value.strip().lower()
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    return bool(
        host in {
            "localhost", "0.0.0.0", "2130706433", "0x7f000001", "::1",
            "0:0:0:0:0:0:0:1", "::ffff:7f00:1",
        }
        or re.fullmatch(r"127(?:\.\d{1,3}){0,3}", host)
        or re.fullmatch(r"0177(?:\.0){2}\.1", host)
        or re.fullmatch(r"::ffff:127(?:\.\d{1,3}){1,3}", host)
    )


def encoded_loopback_reference(text: str) -> bool:
    """Recognize common literal encodings of 127.0.0.1 without evaluation."""
    lowered = text.lower().replace(" ", "")
    if re.search(r"(?:fromhex|unhexlify)\(['\"]0*7f000001['\"]\)", lowered):
        return True
    if "\\x7f\\x00\\x00\\x01" in lowered:
        return True
    if re.search(r"bytes\(\[(?:0x7f|127),(?:0x0+|0),(?:0x0+|0),(?:0x0*1|1)\]\)", lowered):
        return True
    return "7f000001" in lowered and any(
        marker in lowered for marker in ("inet_ntoa", "inet_aton", "fromhex", "unhexlify", "struct.")
    )

BROWSER_APPLICATION_MARKERS = (
    "google chrome", "com.google.chrome", "chromium", "firefox", "waterfox",
    "brave browser", "com.brave.browser", "microsoft edge", "com.microsoft.edgemac",
    "vivaldi", "com.vivaldi.vivaldi", "opera", "com.operasoftware.opera", " arc ",
    "company.thebrowser.browser", "ai.perplexity.comet", "company.thebrowser.dia",
    "com.kagi.kagimac", "com.duckduckgo.macos.browser", "com.sigmaos.sigmaos",
    "com.pushplaylabs.sidekick", "com.wavebox.wavebox", "app.zen-browser.zen",
    "io.gitlab.librewolf-community", "one.ablaze.floorp", "com.firstversionist.polypane",
    "com.lovingcup.ghostbrowser", "safari", "com.apple.safari", "librewolf", "floorp",
    "sigmaos", "sidekick", "wavebox", "polypane", "ghost browser", "duckduckgo",
    " comet ", " dia ", " orion ", " zen ",
)
BROWSER_MARKERS = re.compile(
    r"(?:^|[^a-z0-9])(?:browser|chrome|chromium|safari|webkit|firefox|"
    r"playwright|puppeteer|selenium|cdp|webdriver)(?:$|[^a-z0-9])",
    re.IGNORECASE,
)


def browser_application_reference(text: str) -> bool:
    lowered = f" {text.lower()} "
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    return (
        any(marker in lowered for marker in BROWSER_APPLICATION_MARKERS)
        or re.search(r"\b(?:arc|comet|dia|orion|zen)\b", lowered) is not None
        or any(
        marker in compact for marker in (
            "googlechrome", "comgooglechrome", "bravebrowser", "microsoftedge",
            "thebrowserarc", "perplexitycomet", "thebrowserdia", "zenbrowser",
            "ghostbrowser", "safaritechnologypreview",
        )
        )
    )


def decoded_browser_payload(text: str) -> bool:
    """Inspect bounded, literal base64 fragments without executing user code."""
    for match in re.finditer(r"(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{12,512}={0,2})(?![A-Za-z0-9+/])", text):
        encoded = match.group(1)
        try:
            decoded = base64.b64decode(encoded, validate=True).decode("utf-8", errors="ignore")
        except (ValueError, UnicodeError):
            continue
        lowered = decoded.lower()
        if browser_application_reference(lowered) or any(marker in lowered for marker in (
            "chrome-remote-interface", "connectovercdp", "target.createtarget",
            "cdp.new", "cdp.list", "127.0.0.1:9222", "localhost:9222",
        )):
            return True
    for match in re.finditer(r"(?:fromhex|decode)\s*\(\s*['\"]([0-9a-fA-F]{16,1024})['\"]", text):
        try:
            decoded = bytes.fromhex(match.group(1)).decode("utf-8", errors="ignore").lower()
        except ValueError:
            continue
        if browser_application_reference(decoded) or (
            loopback_reference(decoded)
            and (
                re.search(r"(?<!\d)9222(?!\d)", decoded) is not None
                or re.search(r"(?<!\d)9222(?!\d)", text) is not None
                or encoded_cdp_port(text)
            )
        ):
            return True
    return False


def safe_constant_integer(expression: str) -> int | None:
    """Evaluate only a tiny, bounded integer-arithmetic grammar."""
    if len(expression) > 80:
        return None
    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError):
        return None

    def evaluate(node: ast.AST) -> int:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            value = node.value
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            operand = evaluate(node.operand)
            value = operand if isinstance(node.op, ast.UAdd) else -operand
        elif isinstance(node, ast.BinOp) and isinstance(
            node.op,
            (ast.Add, ast.Sub, ast.Mult, ast.FloorDiv, ast.Mod, ast.LShift, ast.RShift, ast.BitOr, ast.BitAnd, ast.BitXor),
        ):
            left = evaluate(node.left)
            right = evaluate(node.right)
            if isinstance(node.op, (ast.LShift, ast.RShift)) and not 0 <= right <= 31:
                raise ValueError("shift out of bounds")
            if isinstance(node.op, ast.Add):
                value = left + right
            elif isinstance(node.op, ast.Sub):
                value = left - right
            elif isinstance(node.op, ast.Mult):
                value = left * right
            elif isinstance(node.op, ast.FloorDiv):
                value = left // right
            elif isinstance(node.op, ast.Mod):
                value = left % right
            elif isinstance(node.op, ast.LShift):
                value = left << right
            elif isinstance(node.op, ast.RShift):
                value = left >> right
            elif isinstance(node.op, ast.BitOr):
                value = left | right
            elif isinstance(node.op, ast.BitAnd):
                value = left & right
            else:
                value = left ^ right
        else:
            raise ValueError("unsupported expression")
        if abs(value) > 2**31:
            raise ValueError("expression out of bounds")
        return value

    try:
        return evaluate(tree)
    except (ArithmeticError, ValueError):
        return None


def computed_cdp_port(text: str) -> bool:
    number = r"(?:0[xX][0-9a-fA-F]+|\d+)"
    operator = r"(?:\+|-|\*|//|%|<<|>>|\||&|\^)"
    pattern = re.compile(rf"(?<![\w.])({number}(?:\s*{operator}\s*{number})+)(?![\w.])")
    return any(safe_constant_integer(match.group(1)) == 9222 for match in pattern.finditer(text))


def encoded_cdp_port(text: str) -> bool:
    if any(int(match.group(1), 16) == 9222 for match in re.finditer(r"0[xX]([0-9a-fA-F]{1,8})", text)):
        return True
    for match in re.finditer(r"(?:fromhex|unhexlify)\s*\(\s*['\"]([0-9a-fA-F]{2,16})['\"]", text):
        encoded = match.group(1)
        if len(encoded) % 2 == 0 and int(encoded, 16) == 9222:
            return True
    compact = re.sub(r"\s+", "", text.lower())
    if "\\x24\\x06" in compact:
        return True
    if re.search(r"bytes\(\[(?:0x24|36),(?:0x0*6|6)\]\)", compact):
        return True
    for match in re.finditer(r"int\s*\(\s*['\"]([0-9a-fA-F]+)['\"]\s*,\s*(2|8|10|16)\s*\)", text):
        try:
            if int(match.group(1), int(match.group(2))) == 9222:
                return True
        except ValueError:
            continue
    # Bounded literal aggregate forms used by Python, JavaScript, and Ruby.
    number = r"(?:0[xX][0-9a-fA-F]+|\d+)"
    for match in re.finditer(
        rf"[\[(]\s*({number}(?:\s*,\s*{number}){{1,63}})\s*[\])]",
        text,
    ):
        context = text[max(0, match.start() - 24):min(len(text), match.end() + 96)].lower()
        if "sum" not in context and ".reduce" not in context:
            continue
        try:
            values = [int(value.strip(), 0) for value in match.group(1).split(",")]
        except ValueError:
            continue
        if sum(values) == 9222:
            return True
    return any(
        int(match.group(1), 16) == 9222
        for match in re.finditer(r"int\s*\(\s*['\"]([0-9a-fA-F]{1,8})['\"]\s*,\s*16\s*\)", text)
    )


def cdp_port_reference(value: str) -> bool:
    """Recognize the reserved CDP port in scalar or encoded configuration."""
    stripped = value.strip().lower()
    if re.search(r"(?<!\d)9222(?!\d)", stripped) is not None:
        return True
    try:
        if int(stripped, 0) == 9222:
            return True
    except (TypeError, ValueError):
        pass
    return computed_cdp_port(stripped) or encoded_cdp_port(stripped)


def browser_alias_definition(command: str) -> bool:
    """Deny shell aliases that conceal a browser-control executable."""
    pattern = re.compile(
        r"\balias\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"
        r"(?:'([^'\n]{1,512})'|\"([^\"\n]{1,512})\"|([^\s;]{1,512}))",
        re.IGNORECASE,
    )
    for match in pattern.finditer(command):
        value = next((part for part in match.groups() if part is not None), "")
        try:
            alias_tokens = strip_command_prefixes(shlex.split(value))
        except ValueError:
            return True
        if not alias_tokens:
            continue
        executable = Path(alias_tokens[0]).name.lower()
        if executable in {
            "open", "xdg-open", "osascript", "safaridriver", "chrome", "chromium",
            "firefox", "waterfox", "playwright", "playwright-mcp", "geckodriver",
        } or browser_application_reference(" ".join(alias_tokens)):
            return True
    return False


def unverifiable_osascript(tokens: list[str]) -> bool:
    """Return true when AppleScript comes from a file/stdin or dynamic source."""
    inline_statements: list[str] = []
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token == "--":
            return True
        if token in {"-e", "--execute"}:
            if index + 1 >= len(tokens):
                return True
            inline_statements.append(tokens[index + 1])
            index += 2
            continue
        if token in {"-l", "--language", "-s"}:
            if index + 1 >= len(tokens):
                return True
            index += 2
            continue
        if token in {"-i", "--interactive"}:
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        # A positional operand is a script/compiled-script path or an argument
        # supplied to one. Neither can be proven browser-safe by this hook.
        return True
    if not inline_statements:
        return True
    source = " ".join(inline_statements)
    lowered = source.lower()
    # AppleScript may compute an application target from concatenation,
    # variables, ASCII characters, or environment values. Only an immediate
    # quoted application name/bundle identifier is statically reviewable.
    for match in re.finditer(r"\b(?:tell|using\s+terms\s+from)\s+(?:application|app)\s+", source, re.IGNORECASE):
        target = source[match.end():].lstrip()
        if re.match(r"id\s+", target, re.IGNORECASE):
            target = re.sub(r"^id\s+", "", target, count=1, flags=re.IGNORECASE).lstrip()
        if re.match(r'"(?:[^"\\]|\\.)+"', target) is None:
            return True
    return any(marker in lowered for marker in (
        "run script", "load script", "do shell script", "eval(",
        "objc.import", "currentapplication()", "path to resource", "open location",
    ))


def expand_static_shell_assignments(command: str) -> str:
    """Expand bounded literal shell variables for policy inspection only.

    The command is never executed and this is deliberately not a shell
    interpreter. It only joins simple literal assignments such as
    ``A=92; B=22; curl ...:${A}${B}``, closing an evasion route without
    accepting command substitutions, parameter operators, or recursive data.
    """
    assignment_pattern = re.compile(
        r"(?<![A-Za-z0-9_${])([A-Za-z_][A-Za-z0-9_]*)="
        r"(?:'([^'\n]{0,256})'|\"([^\"$`\n]{0,256})\"|([A-Za-z0-9._:/+\-]{1,256}))"
    )
    assignments: dict[str, str] = {}
    for match in assignment_pattern.finditer(command):
        value = next((part for part in match.groups()[1:] if part is not None), "")
        assignments[match.group(1)] = value
        if len(assignments) >= 64:
            break
    if not assignments:
        return command

    variable_pattern = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)")
    expanded = command
    for _ in range(4):
        updated = variable_pattern.sub(
            lambda match: assignments.get(match.group(1) or match.group(2), match.group(0)),
            expanded,
        )
        if updated == expanded:
            break
        expanded = updated
        if len(expanded) > 32_768:
            return command
    return expanded


def fold_literal_string_concatenations(text: str) -> str:
    """Join bounded same-quote literals for inspection, never evaluation."""
    patterns = (
        re.compile(r"'([^'\\\n]{0,256})'\s*\+\s*'([^'\\\n]{0,256})'"),
        re.compile(r'"([^"\\\n]{0,256})"\s*\+\s*"([^"\\\n]{0,256})"'),
    )
    folded = text
    for _ in range(8):
        previous = folded
        for pattern in patterns:
            quote = "'" if pattern.pattern.startswith("'") else '"'
            folded = pattern.sub(lambda match: quote + match.group(1) + match.group(2) + quote, folded)
        if folded == previous or len(folded) > 32_768:
            break
    return folded


def fold_static_string_transforms(text: str) -> str:
    """Decode bounded literal reversals/fromCharCode without running code."""
    folded = text
    reversal = re.compile(r"(['\"])([^'\"\\\n]{1,128})\1\s*\[\s*::\s*-1\s*\]")
    folded = reversal.sub(lambda match: repr(match.group(2)[::-1]), folded)
    character_codes = re.compile(
        r"(?:String\.)?fromCharCode\s*\(\s*([0-9xXa-fA-F,\s]{1,512})\s*\)",
        re.IGNORECASE,
    )

    def decode_codes(match: re.Match[str]) -> str:
        values: list[int] = []
        for encoded in match.group(1).split(","):
            try:
                value = int(encoded.strip(), 0)
            except ValueError:
                return match.group(0)
            if not 0 <= value <= 0x10FFFF:
                return match.group(0)
            values.append(value)
        return repr("".join(chr(value) for value in values))

    return character_codes.sub(decode_codes, folded)


def inline_network_connection(tokens: list[str]) -> bool:
    if not tokens:
        return False
    executable = Path(tokens[0]).name.lower()
    if executable in {"bash", "zsh", "sh", "dash", "ksh"}:
        return any("/dev/tcp/" in token.lower() for token in tokens[1:])
    payload: str | None = None
    for index, token in enumerate(tokens[1:], start=1):
        if token in {"-c", "-e", "--eval"} and index + 1 < len(tokens):
            payload = tokens[index + 1]
            break
    if payload is None:
        return False
    if executable in {"python", "python3"}:
        try:
            tree = ast.parse(payload)
        except (SyntaxError, ValueError):
            return False

        def call_name(node: ast.AST) -> str:
            if isinstance(node, ast.Name):
                return node.id.lower()
            if isinstance(node, ast.Attribute):
                parent = call_name(node.value)
                return f"{parent}.{node.attr.lower()}" if parent else node.attr.lower()
            return ""

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = call_name(node.func)
            if (
                name.endswith((".connect", ".create_connection", ".urlopen", ".get", ".post", ".request"))
                or name in {"urlopen", "create_connection"}
                or name.startswith(("requests.", "http.client.", "websocket."))
            ):
                return True
        return False
    # For JavaScript/Ruby, remove literal contents before looking for call
    # syntax. Endpoint evidence is computed separately from the original text.
    executable_payload = re.sub(r"(['\"`])(?:\\.|(?!\1).)*\1", r"\1\1", payload)
    return any(marker in executable_payload.lower() for marker in (
        "fetch(", "new websocket(", ".connect(", ".get(", ".request(", "http.get(", "http.request(",
        "require('net')", 'require("net")', "require('http')", 'require("http")',
        "tcpsocket.new(",
    ))


def url_has_loopback_cdp_endpoint(text: str) -> bool:
    """Require 9222 in URL authority, never merely in a path or body."""
    lowered = text.lower()
    cdp_route = any(route in lowered for route in (
        "/json/list", "/json/new", "/json/version", "/json/protocol",
        "/devtools/browser", "/devtools/page",
    ))
    for match in re.finditer(r"(?:https?|wss?|tcp)://([^\s'\"<>/]+)", lowered):
        authority = match.group(1).rsplit("@", 1)[-1]
        host = ""
        port = ""
        if authority.startswith("["):
            closing = authority.find("]")
            if closing >= 0 and authority[closing + 1:closing + 2] == ":":
                host = authority[:closing + 1]
                port = authority[closing + 2:]
        elif ":" in authority:
            host, port = authority.rsplit(":", 1)
        if not exact_loopback_host(host):
            continue
        if cdp_port_reference(port):
            return True
        if cdp_route and any(marker in port for marker in ("$", "`", "$(", "${")):
            return True
    return False


def native_client_has_loopback_cdp_endpoint(tokens: list[str], full_text: str) -> bool:
    if url_has_loopback_cdp_endpoint(" ".join(tokens)):
        return True
    executable = Path(tokens[0]).name.lower() if tokens else ""
    if executable not in {"nc", "ncat", "telnet"}:
        return False
    for index, token in enumerate(tokens[1:-1], start=1):
        if not exact_loopback_host(token):
            continue
        port = tokens[index + 1]
        if cdp_port_reference(port):
            return True
        if any(marker in port for marker in ("$", "`")) and (
            re.search(r"printf[^\n;]{0,100}92[^\n;]{0,30}22", full_text) is not None
            or encoded_cdp_port(full_text)
        ):
            return True
    return False


def inline_client_has_loopback_cdp_endpoint(tokens: list[str]) -> bool:
    payload: str | None = None
    for index, token in enumerate(tokens[1:], start=1):
        if token in {"-c", "-e", "-r", "--eval"} and index + 1 < len(tokens):
            payload = tokens[index + 1]
            break
    if payload is None:
        return False
    folded = fold_static_string_transforms(fold_literal_string_concatenations(payload))
    if url_has_loopback_cdp_endpoint(folded):
        return True
    raw_socket = any(marker in folded.lower() for marker in (
        "socket.create_connection", "tcpsocket.new", "require('net')", 'require("net")',
        ".connect(", "new socket(", "/dev/tcp/",
    ))
    # Inline raw-socket clients to loopback are deliberately fail-closed when
    # the reserved port is statically present in any bounded representation.
    return raw_socket and loopback_reference(folded) and cdp_port_reference(folded)


def direct_cdp_shell_text(command: str, segments: list[list[str]]) -> bool:
    """Catch CDP intent split by shell arithmetic or string concatenation."""
    executables: set[str] = set()
    for segment in segments:
        stripped = strip_command_prefixes(segment)
        if stripped:
            executables.add(Path(stripped[0]).name.lower())
    if not (executables & NETWORK_CAPABLE_COMMANDS):
        return False
    folded = fold_static_string_transforms(
        fold_literal_string_concatenations(expand_static_shell_assignments(command))
    )
    lowered = folded.lower()
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    if any(marker in compact for marker in (
        "chromeremoteinterface",
        "connectovercdp",
        "targetcreatetarget",
        "targetgettargets",
        "cdpnew",
        "cdplist",
    )):
        return True
    if decoded_browser_payload(command):
        return True
    if url_has_loopback_cdp_endpoint(folded):
        return True
    expanded_segments = shell_command_segments(folded)
    for segment in expanded_segments:
        stripped = strip_command_prefixes(segment)
        if not stripped:
            continue
        executable = Path(stripped[0]).name.lower()
        if executable in NATIVE_NETWORK_COMMANDS and native_client_has_loopback_cdp_endpoint(
            stripped, lowered
        ):
            return True
        if executable in {
            "node", "tsx", "ts-node", "bun", "deno", "python", "python3",
            "ruby", "perl", "php", "bash", "zsh", "sh", "dash", "ksh",
        }:
            if inline_network_connection(stripped) and inline_client_has_loopback_cdp_endpoint(stripped):
                return True
    return False


def direct_cdp_command(tokens: list[str]) -> bool:
    if not tokens:
        return False
    executable = Path(tokens[0]).name.lower()
    lowered = " ".join(token.lower() for token in tokens)
    compact = re.sub(r"[^a-z0-9]", "", lowered)
    endpoint_markers = (
        "127.0.0.1:9222",
        "localhost:9222",
        "--cdp-endpoint",
        "--remote-debugging-port=9222",
    )
    has_endpoint = any(marker in lowered for marker in endpoint_markers)
    direct_api_markers = (
        "chrome-remote-interface",
        "connectovercdp",
        "cdp.new",
        "cdp.list",
        "target.createtarget",
        "/json/new",
        "/json/list",
    )
    if executable in {"node", "tsx", "ts-node", "bun", "deno", "python", "python3"} and (
        any(marker in lowered for marker in direct_api_markers)
        or any(marker in compact for marker in (
            "chromeremoteinterface", "connectovercdp", "targetcreatetarget",
            "targetgettargets", "cdpnew", "cdplist",
        ))
    ):
        return True
    if executable in {"chrome-remote-interface", "cri", "playwright", "playwright-mcp"}:
        return True
    if executable in {"npx", "npm", "pnpm", "yarn", "bunx"} and any(
        "chrome-remote-interface" in token.lower() for token in tokens[1:]
    ):
        return True
    if has_endpoint and executable in NATIVE_NETWORK_COMMANDS:
        return True
    if has_endpoint and executable in {
        "node", "tsx", "ts-node", "bun", "deno", "python", "python3",
    } and inline_network_connection(tokens):
        return True
    script = node_script_entrypoint(tokens)
    if script is not None and script.resolve(strict=False) in {
        BROWSERD_SOURCE.resolve(strict=False),
        BROWSERD_RUNTIME.resolve(strict=False),
    }:
        preload_options = {
            "-r", "--require", "--import", "--loader", "--experimental-loader", "--env-file",
        }
        if any(
            token in preload_options or any(token.startswith(f"{option}=") for option in preload_options)
            for token in tokens[1:]
        ):
            return True
    return script is not None and direct_cdp_script(script)


def command_denial(command: str, state: dict[str, Any], depth: int = 0) -> str | None:
    if depth > 3:
        return "Nested shell command denied because browser policy safety could not be established"
    if browser_alias_definition(command):
        return "Shell alias to browser control denied; use the installed leased browser lanes"
    normalized_start = command.lstrip().replace("\\ ", " ").lower()
    if normalized_start.startswith((
        "/applications/google chrome.app/contents/macos/google chrome",
        "/applications/chromium.app/contents/macos/chromium",
        "/applications/google chrome for testing.app/contents/macos/google chrome for testing",
    )):
        return "Direct Chrome/Chromium launch denied; use the canonical browser enforcer on CDP 9222"
    # Inspect statically joinable shell assignments before tokenization so an
    # indirect loader name (V=NODE_OPTIONS; export "$V=...") cannot evade the
    # same checks as a direct assignment.
    inspection_command = expand_static_shell_assignments(command)
    segments = shell_command_segments(inspection_command)
    if direct_cdp_shell_text(command, segments):
        return "Direct CDP access is denied; use the leased Chrome bridge/browserd target API"
    for tokens in segments:
        if not tokens:
            continue
        split_payload = env_split_payload(tokens)
        if split_payload is not None:
            if not split_payload:
                return "Unverifiable env split-string execution denied by the browser singleton policy"
            nested_denial = command_denial(split_payload, state, depth + 1)
            if nested_denial:
                return nested_denial
        for embedded in wrapper_embedded_commands(tokens):
            candidate = embedded
            stripped_embedded = strip_command_prefixes(candidate)
            if stripped_embedded and Path(stripped_embedded[0]).name.lower() in {"open", "xdg-open"}:
                if any(
                    option.lower() in {"-a", "-b"} and index + 1 >= len(stripped_embedded)
                    for index, option in enumerate(stripped_embedded)
                ):
                    return "Wrapper-supplied browser handler is untrusted; use a claimed shared tab"
                # Wrapper input can become either an application selector or
                # a web document. Add one synthetic web operand so only
                # explicit reveal/text-editor forms can be proven safe.
                candidate = [*candidate, "/tmp/actp-untrusted-wrapper-input.html"]
            nested_denial = command_denial(shlex.join(candidate), state, depth + 1)
            if nested_denial:
                return nested_denial
        unsafe_environment = unsafe_runtime_environment_in_command(tokens)
        if unsafe_environment:
            return (
                f"Runtime injection environment denied ({unsafe_environment}); "
                "browser-capable processes must use the installed brokers"
            )
        tokens = strip_command_prefixes(tokens)
        if not tokens:
            continue
        executable = Path(tokens[0]).name.lower()
        lowered_tokens = [token.lower() for token in tokens]
        joined = " ".join(lowered_tokens)

        protected_control_markers = (
            "browserd/control-token",
            "browserd/control.sock",
            "safari-control.token",
            "/trim-managed",
            "safari-trim.sock",
        )
        browserd_drain_route = (
            ("127.0.0.1:5590" in joined or "localhost:5590" in joined)
            and "/drain" in joined
        )
        control_capable = executable in {
            "cat", "head", "tail", "less", "more", "strings", "xxd", "od", "dd",
            "cp", "mv", "install", "base64", "curl", "wget", "wscat", "websocat",
            "nc", "ncat", "socat", "telnet", "node", "tsx", "ts-node", "bun",
            "deno", "python", "python3", "ruby", "perl", "php", "bash", "zsh",
            "sh", "dash", "ksh", "eval", "source", ".",
        }
        protected_path_argument = any(
            any(marker in token for marker in protected_control_markers)
            and (
                token.startswith(("/", "~/", "$home/", "${home}/"))
                or "/library/application support/actp/" in token
            )
            for token in lowered_tokens[1:]
        )
        if (
            any(marker in joined for marker in protected_control_markers)
            or browserd_drain_route
        ) and (control_capable or protected_path_argument):
            return "Direct browser control-plane access denied; use the installed enforcer status/presence interface"

        if executable == "launchctl" and len(lowered_tokens) > 2 and lowered_tokens[1] == "setenv":
            if tokens[2].upper() in UNSAFE_RUNTIME_ENVIRONMENT:
                return "Persistent runtime-loader mutation denied for supervised browser processes"
        if executable == "tmux" and any(
            token in {"set-environment", "setenv"} for token in lowered_tokens[1:]
        ) and any(token.upper() in UNSAFE_RUNTIME_ENVIRONMENT for token in tokens[1:]):
            return "Persistent runtime-loader mutation denied for supervised Safari processes"

        legacy_invocation = executed_legacy_script(tokens)
        if legacy_invocation:
            legacy, action = legacy_invocation
            if action in LEGACY_BROWSER_ACTIONS[legacy]:
                return f"Legacy browser action denied ({legacy} {action}); use the singleton enforcer and a claimed shared tab"

        if "packages/services/src/sora/sora-mcp.ts" in joined or "sora-full-automation" in joined:
            return "Legacy unclaimed Safari automation denied; use the claimed sora-automation service lane"

        # Status, audit, smoke, ensure, and controlled restart calls to the
        # exact enforcer are the supported control plane. A same-named script
        # elsewhere is a policy bypass, and agents may never override the
        # human/lease gate with --force.
        enforcer_path = invoked_enforcer_path(tokens)
        if enforcer_path is not None:
            if not is_enforcer_invocation(tokens):
                return "Untrusted browser-enforcer.py path denied; use the installed singleton control plane"
            enforcer_denial = enforcer_agent_denial(tokens)
            if enforcer_denial:
                return enforcer_denial
            continue

        browser_executable = (
            executable in {"chromium", "chrome", "chrome-headless-shell", "chromium_headless_shell", "headless_shell", "google chrome", "google chrome for testing", "google chrome beta", "google chrome dev", "google chrome canary", "firefox", "firefox-bin", "waterfox", "geckodriver", "brave browser", "microsoft edge", "arc", "opera", "vivaldi", "comet", "dia", "orion", "duckduckgo", "zen", "librewolf", "floorp", "sigmaos", "sidekick", "wavebox", "polypane", "ghost browser", "safari", "safari technology preview", "minibrowser", "webkittestrunner"}
            or any(".app/contents/macos/" in token.lower() and any(name in token.lower() for name in ("chrome", "chromium", "firefox", "comet", "dia", "orion", "duckduckgo", "librewolf", "floorp", "sigmaos", "sidekick", "wavebox", "polypane", "ghost browser")) for token in tokens[:1])
            or any("/ms-playwright/" in token.lower() and Path(token).name.lower() in {"chromium", "chrome", "headless_shell", "firefox", "minibrowser", "webkittestrunner"} for token in tokens[:1])
            or macos_browser_command(" ".join(tokens))
        )
        if browser_executable:
            return "Direct browser-engine launch denied; use the canonical Chrome on CDP 9222 or installed Safari singleton"

        if executable in {"python", "python3", "uvicorn"} and any(
            marker in joined for marker in ("waterfox_bridge", "waterfox-bridge", "geckodriver")
        ):
            return "Alternate browser bridge denied; all agent work must use the leased Chrome/Safari lanes"

        script_entry = node_script_entrypoint(tokens)
        if script_entry is not None and script_entry.resolve(strict=False) in {
            BROWSERD_SOURCE.resolve(strict=False),
            BROWSERD_RUNTIME.resolve(strict=False),
        }:
            return "Direct browserd execution denied; only its launchd service may own CDP"
        if executable in {"node", "tsx", "ts-node", "bun", "deno"} and any(
            flag in tokens[1:] for flag in ("-e", "--eval")
        ) and any(str(path).lower() in joined for path in (BROWSERD_SOURCE, BROWSERD_RUNTIME)):
            return "Inline browserd import denied; only its launchd service may own CDP"

        loader_flag = opaque_runtime_loader(tokens)
        if loader_flag:
            return (
                f"Opaque runtime preload denied ({loader_flag}); browser-capable code must run "
                "through an installed reviewed broker"
            )

        if direct_cdp_command(tokens):
            return "Direct CDP access is denied; use the leased Chrome bridge/browserd target API"

        if executable == "openclaw" and len(lowered_tokens) > 1 and lowered_tokens[1] == "browser":
            return "OpenClaw's dedicated browser is denied; use the leased singleton browser lanes"

        if executable == "automator" or (
            executable == "shortcuts" and any(token == "run" for token in lowered_tokens[1:])
        ):
            return "Opaque automation workflows are denied because browser actions cannot be preflighted"

        if browser_named_package_script(tokens):
            return "Opaque browser-named package script denied; use a reviewed leased browser service"
        if executable in {"make", "just"} and BROWSER_MARKERS.search(" ".join(lowered_tokens[1:])):
            return "Opaque browser-named build recipe denied; use a reviewed leased browser service"

        if executable in {"open", "xdg-open"}:
            app_request = joined.replace("-na", "-a")
            reveal_only = any(option in lowered_tokens[1:] for option in ("-r", "--reveal"))
            text_editor_only = any(option in lowered_tokens[1:] for option in ("-e", "-t"))
            explicit_static_handler = any(
                token in {"-a", "-b"}
                and index + 1 < len(tokens)
                and "$" not in tokens[index + 1]
                and "`" not in tokens[index + 1]
                for index, token in enumerate(lowered_tokens[1:], start=1)
            )
            dynamic_application = any(option in lowered_tokens[1:] for option in ("-a", "-b", "-n", "-na")) and (
                "$" in app_request or "`" in app_request
            )
            dynamic_target = "$" in app_request or "`" in app_request
            if (
                requested_browser_bundle(tokens)
                or browser_application_reference(app_request)
                or dynamic_application
                or dynamic_target
            ):
                return "OS browser launch denied; use the singleton browser lanes"
            web_document = any(
                token.lower().startswith(("http://", "https://", "ftp://", "file://", "data:", "blob:", "javascript:"))
                or re.search(r"\.(?:html?|xhtml|webloc|url|webarchive|mhtml?|svg)(?:[?#].*)?$", token.lower()) is not None
                for token in tokens[1:]
                if not token.startswith("-")
            )
            if web_document and not (reveal_only or text_editor_only or explicit_static_handler):
                return "Opening URLs through the OS may spawn another browser; use a claimed shared tab"

        playwright_cli = executable in {"playwright", "playwright-mcp"} or (
            executable in {"npx", "npm", "pnpm", "yarn", "bunx"} and any("playwright" in token for token in lowered_tokens[1:])
        )
        if playwright_cli:
            return "Direct Playwright tooling is denied; use the leased Chrome bridge/browserd target API"

        if executable in {"python", "python3"} and "-m" in tokens[1:] and "webbrowser" in joined:
            return "Python webbrowser launch denied; use a claimed singleton tab"
        inline_interpreter = executable in {
            "python", "python3", "node", "bun", "deno", "ruby", "perl", "php",
            "bash", "zsh", "sh",
        } and any(flag in tokens[1:] for flag in ("-c", "-e", "-r", "--eval"))
        launch_primitives = (
            "chromium.launch", "firefox.launch", "webkit.launch", "puppeteer.launch",
            "launchpersistentcontext", "webdriver.chrome", "webdriver.firefox",
            "webdriver.safari", "new_context(", "newcontext(",
        )
        generic_inline_launch = ".launch(" in joined and any(
            library in joined for library in ("playwright", "puppeteer", "selenium", "chromium", "webkit", "firefox")
        )
        if inline_interpreter and (generic_inline_launch or any(primitive in joined for primitive in launch_primitives)):
            return (
                "Inline browser launch denied; use the browserd lease/action API "
                "or the claimed Safari agent window"
            )
        inline_process_execution = inline_interpreter and any(marker in joined for marker in (
            "subprocess", "os.system(", "os.popen(", "child_process", ".spawn(",
            ".exec(", "exec(", "system(", "system ", "open3.", "kernel.exec", "%x(", "`open ",
        ))
        if inline_process_execution and (
            browser_application_reference(joined)
            or "http://" in joined
            or "https://" in joined
        ):
            return "Inline OS browser launch denied; use the singleton browser lanes"
        if inline_interpreter and "webbrowser" in joined and (".open(" in joined or "open_new" in joined):
            return "Inline webbrowser launch denied; use a claimed singleton tab"
        inline_obfuscated_browser = inline_interpreter and (
            "string.fromcharcode" in joined
            or "base64.b64decode" in joined
            or ("buffer.from" in joined and "base64" in joined)
            or "atob(" in joined
            or "codecs.decode" in joined
        ) and decoded_browser_payload(command)
        if inline_obfuscated_browser:
            return "Obfuscated inline runtime/network capability denied by the browser singleton policy"
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
        if executable == "osascript":
            if unverifiable_osascript(tokens):
                return (
                    "External or dynamic AppleScript denied because browser safety cannot be verified; "
                    "use an inline non-browser script or a claimed singleton lane"
                )
            if browser_application_reference(joined):
                return "Direct browser Apple Events access denied; use the claimed singleton lane"
        if executable in {"killall", "pkill"} and any(
            browser_name in joined for browser_name in ("safari", "google chrome", "chromium", "firefox")
        ):
            return "Direct browser termination denied; use a controlled browser-enforcer restart"

        if cooling("chrome", state) and (browser_executable or playwright_cli):
            return "Chrome is in the enforced cooling window; wait for the singleton relaunch"
        if cooling("safari", state) and executable == "osascript":
            return "Safari is in the enforced cooling window; wait for the singleton relaunch"
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def install_command_hooks() -> dict[str, str]:
    """Atomically deploy one reviewed hook to both supported agent runtimes."""
    payload, source_metadata = read_owned_regular_file(RUNTIME_COMMAND_HOOK)
    if stat.S_IMODE(source_metadata.st_mode) != 0o700:
        raise RuntimeError("verified runtime command hook must be mode 0700")
    source_hash = hashlib.sha256(payload).hexdigest()
    installed: dict[str, str] = {}
    for path in (CODEX_COMMAND_HOOK, CLAUDE_COMMAND_HOOK):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        parent = os.lstat(path.parent)
        if not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or parent.st_uid != os.getuid():
            raise RuntimeError(f"refusing unsafe command-hook directory: {path.parent}")
        if path.exists() or path.is_symlink():
            existing_file_metadata(path)
        atomic_write_bytes(path, payload, 0o700, os.getuid(), os.getgid())
        metadata = existing_file_metadata(path)
        if stat.S_IMODE(metadata.st_mode) != 0o700 or sha256_file(path) != source_hash:
            raise RuntimeError(f"installed command hook failed verification: {path}")
        installed[str(path)] = source_hash
    return installed


def repair_command_hook_registrations() -> int:
    """Restore only the two hook registrations, preserving every other setting."""
    plans: list[dict[str, Any]] = []
    if CLAUDE_SETTINGS_CONFIG.exists():
        original, metadata = read_owned_regular_file(CLAUDE_SETTINGS_CONFIG)
        try:
            value = json.loads(original.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Claude hook configuration is invalid") from exc
        changes = rewrite_claude_command_hook(value)
        if changes:
            plans.append({
                "path": CLAUDE_SETTINGS_CONFIG,
                "payload": json.dumps(value, indent=2).encode("utf-8") + b"\n",
                "original": original,
                "metadata": metadata,
                "changes": changes,
            })
    if CODEX_CONFIG.exists():
        original, metadata = read_owned_regular_file(CODEX_CONFIG)
        try:
            text = original.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise RuntimeError("Codex hook configuration is not UTF-8") from exc
        configured = ensure_codex_command_hook(ensure_codex_hooks_enabled(text)).encode("utf-8")
        if configured != original:
            plans.append({
                "path": CODEX_CONFIG,
                "payload": configured,
                "original": original,
                "metadata": metadata,
                "changes": 1,
            })
    repaired = 0
    for plan in plans:
        verify_configuration_plan_current(plan)
        metadata = plan["metadata"]
        atomic_write_bytes(
            plan["path"],
            plan["payload"],
            stat.S_IMODE(metadata.st_mode),
            metadata.st_uid,
            metadata.st_gid,
        )
        verify_file_replacement(plan["path"], plan["payload"], metadata)
        repaired += int(plan["changes"])
    return repaired


def command_hook_maintenance_loop() -> None:
    """Repair removed or altered agent gates from the verified runtime copy."""
    while True:
        try:
            runtime_metadata = existing_file_metadata(RUNTIME_COMMAND_HOOK)
            if stat.S_IMODE(runtime_metadata.st_mode) != 0o700:
                raise RuntimeError("runtime command hook metadata is unsafe")
            expected = sha256_file(RUNTIME_COMMAND_HOOK)
            repair = False
            for path in (CODEX_COMMAND_HOOK, CLAUDE_COMMAND_HOOK):
                try:
                    metadata = existing_file_metadata(path)
                    repair = repair or stat.S_IMODE(metadata.st_mode) != 0o700 or sha256_file(path) != expected
                except (OSError, RuntimeError):
                    repair = True
            if repair:
                install_command_hooks()
                log("repaired an altered or missing agent command-policy hook")
            registration_repairs = repair_command_hook_registrations()
            if registration_repairs:
                log(f"repaired agent command-hook registrations changes={registration_repairs}")
            if config_violations():
                configuration_repairs = configure_agents()
                log(f"repaired browser-capable agent configuration changes={configuration_repairs}")
        except Exception as exc:
            log(f"command-hook maintenance degraded: {type(exc).__name__}: {exc}")
        time.sleep(30)


def control_readiness_loop() -> None:
    """Keep a fresh receipt proving the launchd identity owns both sockets."""
    previous: bool | None = None
    while True:
        value = publish_control_readiness()
        names = ("ch" + "rome", "sa" + "fari")
        ready = all(
            isinstance(value.get(name), dict) and value[name].get("ok") is True
            for name in names
        )
        if ready != previous:
            log("peer-attested control readiness healthy" if ready else "peer-attested control readiness degraded")
            previous = ready
        time.sleep(10)


def tmux_binary() -> Path:
    preferred = Path("/opt/homebrew/bin/tmux")
    if preferred.exists():
        return preferred
    resolved = shutil.which("tmux")
    if not resolved:
        raise RuntimeError("tmux is required for the authorized Safari control broker")
    return Path(resolved)


TMUX_ENVIRONMENT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
TMUX_ENVIRONMENT_MAX_BYTES = 1024 * 1024
TMUX_ENVIRONMENT_MAX_ENTRIES = 4096


def parse_tmux_environment(
    payload: str,
    *,
    hidden: bool = False,
) -> dict[str, dict[str, Any]]:
    """Parse ``show-environment -s`` output without executing shell text."""
    if len(payload.encode("utf-8")) > TMUX_ENVIRONMENT_MAX_BYTES:
        raise RuntimeError("Safari broker tmux environment exceeds the snapshot limit")
    lexer = shlex.shlex(payload, posix=True, punctuation_chars=";")
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError as exc:
        raise RuntimeError("malformed quoted Safari broker tmux environment") from exc
    statements: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token == ";":
            if current:
                statements.append(current)
                current = []
        else:
            current.append(token)
    if current:
        raise RuntimeError("unterminated Safari broker tmux environment statement")

    environment: dict[str, dict[str, Any]] = {}
    index = 0
    while index < len(statements):
        statement = statements[index]
        value: str | None
        if len(statement) == 2 and statement[0] == "unset":
            name = statement[1]
            value = None
            index += 1
        elif len(statement) == 1 and "=" in statement[0]:
            name, _, value = statement[0].partition("=")
            if index + 1 >= len(statements) or statements[index + 1] != ["export", name]:
                raise RuntimeError("tmux environment assignment is missing its matching export")
            index += 2
        else:
            raise RuntimeError("malformed Safari broker tmux environment statement")
        if not TMUX_ENVIRONMENT_NAME.fullmatch(name):
            raise RuntimeError("unsafe Safari broker tmux environment name")
        if name in environment:
            raise RuntimeError("duplicate Safari broker tmux environment entry")
        environment[name] = {"value": value, "hidden": hidden}
        if len(environment) > TMUX_ENVIRONMENT_MAX_ENTRIES:
            raise RuntimeError("Safari broker tmux environment has too many entries")
    return environment


def snapshot_tmux_environment(tmux: Path) -> dict[str, dict[str, Any]]:
    environment: dict[str, dict[str, Any]] = {}
    for hidden, flags in ((False, ["-s"]), (True, ["-h", "-s"])):
        result = run(
            [str(tmux), "show-environment", *flags, "-t", SAFARI_CONTROL_SESSION],
            timeout=5,
        )
        if result.returncode != 0:
            kind = "hidden" if hidden else "normal"
            raise RuntimeError(f"could not snapshot the existing Safari broker {kind} environment")
        parsed = parse_tmux_environment(result.stdout, hidden=hidden)
        duplicates = environment.keys() & parsed.keys()
        if duplicates:
            raise RuntimeError("Safari broker tmux environment contains duplicate hidden entries")
        environment.update(parsed)
    if len(environment) > TMUX_ENVIRONMENT_MAX_ENTRIES:
        raise RuntimeError("Safari broker tmux environment has too many entries")
    return environment


def tmux_environment_restore_commands(
    tmux: Path,
    current: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
) -> list[list[str]]:
    """Build argv-only commands that exactly replace tmux session overrides."""
    prefix = [str(tmux), "set-environment", "-t", SAFARI_CONTROL_SESSION]
    commands: list[list[str]] = []
    for name in sorted(current):
        record = current[name]
        commands.append([
            *prefix,
            *(["-h"] if record.get("hidden") is True else []),
            "-u",
            name,
        ])
    for name in sorted(target):
        record = target[name]
        value = record.get("value")
        hidden_flags = ["-h"] if record.get("hidden") is True else []
        commands.append(
            [*prefix, *hidden_flags, "-r", name]
            if value is None
            else [*prefix, *hidden_flags, name, str(value)]
        )
    return commands


def restore_tmux_environment(
    tmux: Path,
    target: dict[str, dict[str, Any]],
) -> None:
    current = snapshot_tmux_environment(tmux)
    for command in tmux_environment_restore_commands(tmux, current, target):
        run(command, timeout=5, check=True)
    restored = snapshot_tmux_environment(tmux)
    if restored != target:
        raise RuntimeError("restored Safari broker tmux environment does not match its snapshot")


def snapshot_installation() -> dict[str, Any]:
    """Capture every file/service the install path can replace or stop."""
    paths = (
        STATE_FILE,
        HUMAN_PRESENCE_FILE,
        DRAIN_STATE_FILE,
        CONTROL_READINESS_FILE,
        RUNTIME_POLICY,
        SAFARI_CONTROL_PROGRAM,
        RUNTIME_PROGRAM,
        RUNTIME_COMMAND_HOOK,
        CODEX_COMMAND_HOOK,
        CLAUDE_COMMAND_HOOK,
        SAFARI_CONTROL_TOKEN,
        SAFARI_PRESENCE_TOKEN,
        BRIDGE_CLAIMS,
        LAUNCH_AGENT,
        Path.home() / ".claude.json",
        Path.home() / ".claude" / "settings.json",
        WORKSPACE / "acd" / ".mcp.json",
        WINDSURF_MCP_CONFIG,
        CURSOR_MCP_CONFIG,
        CLAUDE_DESKTOP_CONFIG,
        CLAUDE_EXTENSIONS_CONFIG,
        OPENCLAW_CONFIG,
        CODEX_CONFIG,
    )
    files: dict[Path, dict[str, Any]] = {}
    for path in paths:
        if path.exists():
            payload, metadata = read_owned_regular_file(path)
            files[path] = {
                "exists": True,
                "payload": payload,
                "mode": stat.S_IMODE(metadata.st_mode),
                "uid": metadata.st_uid,
                "gid": metadata.st_gid,
            }
        else:
            files[path] = {"exists": False}

    domain = f"gui/{os.getuid()}"
    label = f"{domain}/com.isaiah.actp-browser-enforcer"
    launchd_loaded = run(["launchctl", "print", label], timeout=5).returncode == 0
    tmux = tmux_binary()
    safari_session = run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3).returncode == 0
    safari_command: str | None = None
    safari_cwd: str | None = None
    safari_window_name: str | None = None
    safari_environment: dict[str, dict[str, Any]] | None = None
    safari_healthy = False
    if safari_session:
        panes = run([
            str(tmux), "list-panes", "-t", SAFARI_CONTROL_SESSION, "-F", "#{pane_id}",
        ], timeout=3)
        windows = run([
            str(tmux), "list-windows", "-t", SAFARI_CONTROL_SESSION, "-F", "#{window_id}",
        ], timeout=3)
        if (
            panes.returncode != 0
            or windows.returncode != 0
            or len(panes.stdout.splitlines()) != 1
            or len(windows.stdout.splitlines()) != 1
        ):
            raise RuntimeError("existing Safari broker must have exactly one window and one pane")
        command = run([
            str(tmux), "display-message", "-p", "-t", SAFARI_CONTROL_SESSION,
            "#{pane_start_command}",
        ], timeout=3)
        cwd = run([
            str(tmux), "display-message", "-p", "-t", SAFARI_CONTROL_SESSION,
            "#{pane_current_path}",
        ], timeout=3)
        window_name = run([
            str(tmux), "display-message", "-p", "-t", SAFARI_CONTROL_SESSION,
            "#{window_name}",
        ], timeout=3)
        if command.returncode != 0 or not command.stdout.rstrip("\n"):
            raise RuntimeError("could not snapshot the existing Safari broker command")
        safari_command = command.stdout.rstrip("\n")
        safari_cwd = cwd.stdout.rstrip("\n") if cwd.returncode == 0 else ""
        safari_window_name = window_name.stdout.rstrip("\n") if window_name.returncode == 0 else ""
        if not safari_cwd or not Path(safari_cwd).is_absolute() or not Path(safari_cwd).is_dir():
            raise RuntimeError("could not snapshot a valid existing Safari broker working directory")
        if not safari_window_name or "\x00" in safari_window_name:
            raise RuntimeError("could not snapshot the existing Safari broker window name")
        safari_environment = snapshot_tmux_environment(tmux)
        safari_healthy = broker_control_healthy()
    return {
        "files": files,
        "launchd_loaded": launchd_loaded,
        "safari_session": safari_session,
        "safari_command": safari_command,
        "safari_cwd": safari_cwd,
        "safari_window_name": safari_window_name,
        "safari_environment": safari_environment,
        "safari_healthy": safari_healthy,
    }


def rollback_installation(snapshot: dict[str, Any]) -> list[BaseException]:
    """Best-effort exact restoration; return every rollback failure."""
    failures: list[BaseException] = []
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    broker_lock = SAFARI_BROKER_SESSION_LOCK.open("a+", encoding="utf-8")
    fcntl.flock(broker_lock.fileno(), fcntl.LOCK_EX)
    domain = f"gui/{os.getuid()}"
    label = f"{domain}/com.isaiah.actp-browser-enforcer"
    try:
        tmux = tmux_binary()
        stopped = run([str(tmux), "kill-session", "-t", SAFARI_CONTROL_SESSION], timeout=5)
        missing = any(marker in (stopped.stderr or "").lower() for marker in (
            "can't find session", "no server running", "no sessions",
        ))
        if stopped.returncode != 0 and not missing:
            raise RuntimeError(
                f"tmux kill-session exited {stopped.returncode}: {stopped.stderr.strip()}"
            )
        if run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3).returncode == 0:
            raise RuntimeError("replacement Safari broker session remained alive after stop")
    except BaseException as exc:
        failures.append(RuntimeError(f"failed to stop replacement Safari broker: {exc}"))
        tmux = None
    try:
        stopped = run(["launchctl", "bootout", label], timeout=10)
        missing = any(marker in ((stopped.stderr or "") + (stopped.stdout or "")).lower() for marker in (
            "could not find service", "no such process", "service not found",
        ))
        if stopped.returncode != 0 and not missing:
            raise RuntimeError(
                f"launchctl bootout exited {stopped.returncode}: {stopped.stderr.strip()}"
            )
        if run(["launchctl", "print", label], timeout=5).returncode == 0:
            raise RuntimeError("replacement browser enforcer remained loaded after stop")
    except BaseException as exc:
        failures.append(RuntimeError(f"failed to stop replacement browser enforcer: {exc}"))

    for path, record in snapshot["files"].items():
        try:
            if record["exists"]:
                atomic_write_bytes(
                    path,
                    record["payload"],
                    record["mode"],
                    record["uid"],
                    record["gid"],
                )
            elif path.exists():
                existing_file_metadata(path)
                path.unlink()
        except BaseException as exc:
            failures.append(RuntimeError(f"failed to restore {path}: {exc}"))

    if snapshot["launchd_loaded"]:
        try:
            if not LAUNCH_AGENT.is_file():
                raise RuntimeError("restored launch-agent plist is missing")
            run(["launchctl", "bootstrap", domain, str(LAUNCH_AGENT)], timeout=15, check=True)
            run(["launchctl", "enable", label], timeout=10, check=True)
            deadline = time.time() + 15
            while time.time() < deadline:
                service = run(["launchctl", "print", label], timeout=5)
                if service.returncode == 0 and "state = running" in service.stdout:
                    break
                time.sleep(0.25)
            else:
                raise RuntimeError("restored browser enforcer did not return to running state")
        except BaseException as exc:
            failures.append(RuntimeError(f"failed to restore prior browser enforcer service: {exc}"))

    if snapshot["safari_session"]:
        try:
            if tmux is None:
                tmux = tmux_binary()
            command = snapshot.get("safari_command")
            cwd = snapshot.get("safari_cwd")
            window_name = snapshot.get("safari_window_name")
            environment = snapshot.get("safari_environment")
            if not command:
                raise RuntimeError("prior Safari broker command was not captured")
            if not isinstance(cwd, str) or not Path(cwd).is_absolute() or not Path(cwd).is_dir():
                raise RuntimeError("prior Safari broker working directory was not captured")
            if not isinstance(window_name, str) or not window_name:
                raise RuntimeError("prior Safari broker window name was not captured")
            if not isinstance(environment, dict):
                raise RuntimeError("prior Safari broker environment was not captured")
            # Start an inert pane, replace every session-environment override,
            # then respawn the one broker pane. The prior command never sees
            # the installer's environment, and removed variables stay removed.
            run([
                str(tmux), "new-session", "-d", "-E", "-s", SAFARI_CONTROL_SESSION,
                "-n", window_name, "-c", cwd, "/bin/sleep", "86400",
            ], timeout=10, check=True)
            restore_tmux_environment(tmux, environment)
            run([
                str(tmux), "respawn-pane", "-k", "-t", SAFARI_CONTROL_SESSION,
                "-c", cwd, command,
            ], timeout=10, check=True)
            if run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3).returncode != 0:
                raise RuntimeError("restored Safari broker tmux session is unavailable")
            restored_command = run([
                str(tmux), "display-message", "-p", "-t", SAFARI_CONTROL_SESSION,
                "#{pane_start_command}",
            ], timeout=3, check=True).stdout.rstrip("\n")
            restored_cwd = run([
                str(tmux), "display-message", "-p", "-t", SAFARI_CONTROL_SESSION,
                "#{pane_current_path}",
            ], timeout=3, check=True).stdout.rstrip("\n")
            if restored_command != command or restored_cwd != cwd:
                raise RuntimeError("restored Safari broker pane metadata does not match its snapshot")
            if snapshot.get("safari_healthy"):
                deadline = time.time() + 15
                while time.time() < deadline:
                    if broker_control_healthy():
                        break
                    time.sleep(0.25)
                else:
                    raise RuntimeError("previously healthy Safari broker did not recover its control health")
        except BaseException as exc:
            failures.append(RuntimeError(f"failed to restore prior Safari broker session: {exc}"))
    fcntl.flock(broker_lock.fileno(), fcntl.LOCK_UN)
    broker_lock.close()
    return failures


def install_runtime_bundle(policy_path: Path) -> dict[str, str]:
    """Stage, hash, and atomically promote the self-contained runtime bundle."""
    validate_trusted_python()
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.chmod(0o700)
    sources = (
        (policy_path.resolve(), RUNTIME_POLICY, 0o600),
        (SAFARI_CONTROL_SOURCE.resolve(), SAFARI_CONTROL_PROGRAM, 0o700),
        (COMMAND_HOOK_SOURCE.resolve(), RUNTIME_COMMAND_HOOK, 0o700),
        # The primary launchd entrypoint is promoted only after every support
        # file has been staged and verified.
        (Path(__file__).resolve(), RUNTIME_PROGRAM, 0o700),
    )
    for source, _, _ in sources:
        if not source.is_file():
            raise RuntimeError(f"runtime source is missing: {source}")
    staging = Path(tempfile.mkdtemp(prefix=".install-", dir=str(RUNTIME_DIR)))
    staged: list[tuple[Path, Path, Path, int, str]] = []
    try:
        for index, (source, target, mode) in enumerate(sources):
            candidate = staging / f"{index}-{target.name}"
            shutil.copy2(source, candidate)
            candidate.chmod(mode)
            source_hash = sha256_file(source)
            if sha256_file(candidate) != source_hash:
                raise RuntimeError(f"staged runtime hash mismatch: {source}")
            staged.append((source, candidate, target, mode, source_hash))
        installed: dict[str, str] = {}
        for source, candidate, target, mode, source_hash in staged:
            atomic_write_bytes(target, candidate.read_bytes(), mode)
            installed_hash = sha256_file(target)
            if installed_hash != source_hash:
                raise RuntimeError(f"installed runtime hash mismatch: {target}")
            installed[str(target)] = installed_hash
        return installed
    finally:
        for candidate in staging.iterdir() if staging.exists() else ():
            candidate.unlink(missing_ok=True)
        staging.rmdir()


def ensure_control_token(path: Path, create: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    if path.exists():
        private_token(path)
        return
    if not create:
        raise RuntimeError(f"required browserd control token is missing: {path}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        payload = (secrets.token_urlsafe(48) + "\n").encode("utf-8")
        if os.write(descriptor, payload) != len(payload):
            raise OSError(f"short write while creating control token: {path}")
        os.fchmod(descriptor, 0o600)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    private_token(path)


def browserd_control_ready() -> None:
    """Verify public limits plus the daemon-published peer-attestation receipt."""
    health = http_json(f"{BROWSERD_CONTROL_URL}/health", timeout=3)
    limits = health.get("limits", {}) if isinstance(health, dict) else {}
    capabilities = health.get("capabilities", {}) if isinstance(health, dict) else {}
    if not (
        isinstance(health, dict)
        and health.get("ok") is True
        and isinstance(limits, dict)
        and limits.get("managed_tabs") == 3
        and limits.get("concurrent_leases") == 2
        and isinstance(capabilities, dict)
        and capabilities.get("managed_trim") is True
        and capabilities.get("destructive_control_transport") == "unix_peer_attested"
        and capabilities.get("control_socket_ready") is True
        and isinstance(health.get("chrome_drain"), dict)
    ):
        raise RuntimeError("browserd health does not expose the leased/drain/managed-trim contract")
    label = f"gui/{os.getuid()}/com.isaiah.actp-browser-enforcer"
    service = run(["launchctl", "print", label], timeout=5, check=True)
    match = re.search(r"^\s*pid\s*=\s*(\d+)\s*$", service.stdout, re.MULTILINE)
    if not match or not control_readiness_valid(int(match.group(1))):
        raise RuntimeError("launchd daemon has not proved both peer-attested control planes")


def install_launch_agent(policy_path: Path) -> None:
    del policy_path  # The verified bundle is promoted before launchd is touched.
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    # macOS privacy controls deny background launch agents access to files
    # under Documents. Install self-contained runtime copies in Application
    # Support, which remains readable after logout/login and reboot.
    legacy_claims = Path("/Users/isaiahdupree/Documents/Chrome/chrome-bridge/claims.json")
    if legacy_claims.exists() and not BRIDGE_CLAIMS.exists():
        shutil.copy2(legacy_claims, BRIDGE_CLAIMS)
        BRIDGE_CLAIMS.chmod(0o600)
    if not RUNTIME_PROGRAM.is_file() or not RUNTIME_POLICY.is_file():
        raise RuntimeError("verified browser-enforcer runtime bundle is incomplete")
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.isaiah.actp-browser-enforcer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>-i</string>
    <string>HOME={Path.home()}</string>
    <string>PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <string>PYTHONNOUSERSITE=1</string>
    <string>PYTHONSAFEPATH=1</string>
    <string>{TRUSTED_PYTHON}</string>
    <string>{RUNTIME_PROGRAM}</string>
    <string>--policy</string><string>{RUNTIME_POLICY}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>Nice</key><integer>8</integer>
  <key>StandardOutPath</key><string>{RUNTIME_DIR / 'launchd.log'}</string>
  <key>StandardErrorPath</key><string>{RUNTIME_DIR / 'launchd-error.log'}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
"""
    plist_mode = existing_file_mode(LAUNCH_AGENT) if LAUNCH_AGENT.exists() else 0o600
    atomic_write_text(LAUNCH_AGENT, plist, plist_mode)
    domain = f"gui/{os.getuid()}"
    label = f"{domain}/com.isaiah.actp-browser-enforcer"
    if run(["launchctl", "print", label], timeout=5).returncode == 0:
        run(["launchctl", "bootout", label], timeout=10, check=True)
        if run(["launchctl", "print", label], timeout=5).returncode == 0:
            raise RuntimeError("prior browser enforcer remained loaded after bootout")
    installed_at = time.time()
    run(["launchctl", "bootstrap", domain, str(LAUNCH_AGENT)], timeout=15, check=True)
    run(["launchctl", "enable", label], timeout=10, check=True)
    deadline = time.time() + 20
    while time.time() < deadline:
        service = run(["launchctl", "print", label], timeout=5)
        pid_match = re.search(r"^\s*pid\s*=\s*(\d+)\s*$", service.stdout, re.MULTILINE)
        service_pid = int(pid_match.group(1)) if pid_match else 0
        fresh_state = STATE_FILE.exists() and STATE_FILE.stat().st_mtime >= installed_at
        drain = load_json(DRAIN_STATE_FILE, None)
        drain_fresh = False
        if (
            isinstance(drain, dict)
            and drain.get("version") == 1
            and drain.get("draining") == {"chrome": False, "safari": False}
        ):
            try:
                drain_age = time.time() - datetime.fromisoformat(
                    str(drain.get("updated_at", "")).replace("Z", "+00:00")
                ).timestamp()
                drain_fresh = -5 <= drain_age <= 15
            except ValueError:
                drain_fresh = False
        controls_ready = service_pid > 1 and control_readiness_valid(service_pid)
        if (
            service.returncode == 0
            and "state = running" in service.stdout
            and fresh_state
            and drain_fresh
            and controls_ready
        ):
            break
        time.sleep(0.5)
    else:
        raise RuntimeError(f"browser enforcer launch agent failed readiness verification; inspect {RUNTIME_DIR}")
    log(f"installed launch agent: {LAUNCH_AGENT}")


def broker_supervisor_command() -> tuple[list[str], list[str]]:
    broker = shlex.join([
        "/usr/bin/env", "-i",
        f"HOME={Path.home()}",
        "PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "SHELL=/bin/zsh",
        "PYTHONNOUSERSITE=1",
        "PYTHONSAFEPATH=1",
        "LC_ALL=C",
        "/usr/bin/nice", "-n", "8", TRUSTED_PYTHON, str(SAFARI_CONTROL_PROGRAM),
        "--read-token-file", str(SAFARI_PRESENCE_TOKEN),
        "--trim-socket", str(SAFARI_TRIM_SOCKET),
        "--log-file", str(SAFARI_CONTROL_LOG),
    ])
    loop = "\n".join([
        "attempt=0", "while true; do", "  started=$(/bin/date +%s)",
        f"  {broker} >/dev/null 2>&1",
        "  runtime=$(( $(/bin/date +%s) - started ))",
        "  if (( runtime >= 300 )); then attempt=0; elif (( attempt < 7 )); then attempt=$((attempt + 1)); fi",
        "  if (( attempt > 0 )); then shift_count=$((attempt - 1)); else shift_count=0; fi",
        "  delay=$((5 * (1 << shift_count)))", "  if (( delay > 300 )); then delay=300; fi",
        "  jitter=$((RANDOM % 11))", "  /bin/sleep $((delay + jitter))", "done",
    ])
    command = [
        "/usr/bin/env", "-i", f"HOME={Path.home()}",
        "PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", "SHELL=/bin/zsh",
        "PYTHONNOUSERSITE=1", "PYTHONSAFEPATH=1", "LC_ALL=C",
        "/bin/zsh", "-f", "-c", loop,
    ]
    cleared = [
        value
        for name in sorted(UNSAFE_RUNTIME_ENVIRONMENT | {"BASH_ENV", "ENV", "ZDOTDIR"})
        for value in ("-e", f"{name}=")
    ]
    return command, cleared


def _install_safari_control_broker() -> None:
    """Run Safari AppleEvents behind the user's authorized tmux identity."""
    if not SAFARI_CONTROL_SOURCE.exists():
        raise RuntimeError(f"Safari control broker source is missing: {SAFARI_CONTROL_SOURCE}")
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_DIR.chmod(0o700)
    if not SAFARI_CONTROL_PROGRAM.is_file():
        raise RuntimeError("verified Safari control broker runtime is missing")
    tmux = tmux_binary()
    existing_session = run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3)
    if existing_session.returncode == 0:
        run([str(tmux), "kill-session", "-t", SAFARI_CONTROL_SESSION], timeout=5, check=True)
        if run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3).returncode == 0:
            raise RuntimeError("prior Safari broker session remained alive after stop")
    elif existing_session.returncode != 1:
        raise RuntimeError(f"could not query prior Safari broker session: {existing_session.stderr.strip()}")

    private_token(SAFARI_PRESENCE_TOKEN)

    clean_session_command, cleared_tmux_environment = broker_supervisor_command()
    try:
        run([
            str(tmux), "new-session", "-d", "-s", SAFARI_CONTROL_SESSION,
            *cleared_tmux_environment,
            *clean_session_command,
        ], timeout=10, check=True)
        deadline = time.time() + 15
        last_error = "not started"
        while time.time() < deadline:
            try:
                health = safari_control_json("/health", timeout=2)
                counts = safari_control_json("/counts", timeout=4)
                socket_metadata = os.lstat(SAFARI_TRIM_SOCKET)
                trim_ready = bool(
                    stat.S_ISSOCK(socket_metadata.st_mode)
                    and socket_metadata.st_uid == os.getuid()
                    and stat.S_IMODE(socket_metadata.st_mode) == 0o600
                )
                if health.get("ok") is True and counts.get("control_available") is True and trim_ready:
                    log(
                        "Safari control broker ready "
                        f"windows={int(counts['windows'])} tabs={int(counts['tabs'])}"
                    )
                    return
                last_error = str(counts.get("error") or counts)[-500:]
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(0.5)
        raise RuntimeError(f"Safari control broker failed readiness verification: {last_error}")
    except Exception:
        subprocess.run([str(tmux), "kill-session", "-t", SAFARI_CONTROL_SESSION], capture_output=True)
        raise


def install_safari_control_broker() -> None:
    with exclusive_file_lock(SAFARI_BROKER_SESSION_LOCK):
        _install_safari_control_broker()


def broker_session_exists() -> bool:
    tmux = tmux_binary()
    result = run([str(tmux), "has-session", "-t", SAFARI_CONTROL_SESSION], timeout=3)
    if result.returncode not in (0, 1):
        raise RuntimeError(f"could not query broker supervisor session: {result.stderr.strip()}")
    return result.returncode == 0


def start_missing_broker_session() -> bool:
    with exclusive_file_lock(SAFARI_BROKER_SESSION_LOCK):
        if broker_session_exists():
            return False
        private_token(SAFARI_PRESENCE_TOKEN)
        if not SAFARI_CONTROL_PROGRAM.is_file():
            raise RuntimeError("installed broker program is missing")
        command, cleared = broker_supervisor_command()
        tmux = tmux_binary()
        run([
            str(tmux), "new-session", "-d", "-s", SAFARI_CONTROL_SESSION,
            *cleared, *command,
        ], timeout=10, check=True)
        if not broker_session_exists():
            raise RuntimeError("recovered broker supervisor session did not remain alive")
        return True


def broker_control_healthy() -> bool:
    try:
        health = safari_control_json("/health", timeout=2)
        counts = safari_control_json("/counts", timeout=4)
        metadata = os.lstat(SAFARI_TRIM_SOCKET)
        return bool(
            health.get("ok") is True
            and counts.get("control_available") is True
            and stat.S_ISSOCK(metadata.st_mode)
            and metadata.st_uid == os.getuid()
            and stat.S_IMODE(metadata.st_mode) == 0o600
        )
    except Exception:
        return False


def broker_supervision_loop() -> None:
    """Recover a lost tmux session and replace a persistently wedged one."""
    unhealthy_since: float | None = None
    last_replacement = 0.0
    failure_delay = 10.0
    while True:
        try:
            created = start_missing_broker_session()
            if created:
                log("recovered missing broker supervisor session")
            if broker_control_healthy():
                unhealthy_since = None
                failure_delay = 10.0
            else:
                now = time.monotonic()
                unhealthy_since = unhealthy_since or now
                if now - unhealthy_since >= 360 and now - last_replacement >= 600:
                    with exclusive_file_lock(SAFARI_BROKER_SESSION_LOCK):
                        tmux = tmux_binary()
                        stopped = run([str(tmux), "kill-session", "-t", SAFARI_CONTROL_SESSION], timeout=5)
                        if stopped.returncode not in (0, 1):
                            raise RuntimeError("could not replace unhealthy broker supervisor")
                    start_missing_broker_session()
                    last_replacement = now
                    unhealthy_since = now
                    log("replaced persistently unhealthy broker supervisor session")
            delay = 10.0
        except Exception as exc:
            log(f"broker supervisor recovery degraded: {type(exc).__name__}: {exc}")
            delay = failure_delay
            failure_delay = min(300.0, failure_delay * 2)
        time.sleep(delay)


def watchdog_browser_lifecycle_violations(path: Path) -> list[str]:
    """Find active lifecycle calls while allowing one uncalled legacy helper."""
    if not path.exists():
        return []
    violations: list[str] = []
    in_dormant_helper = False
    brace_depth = 0
    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        code = raw.split("#", 1)[0].strip()
        if not code:
            continue
        if not in_dormant_helper and re.match(r"^ensure_agent_chrome\s*\(\)\s*\{", code):
            in_dormant_helper = True
            brace_depth = code.count("{") - code.count("}")
            continue
        if in_dormant_helper:
            brace_depth += code.count("{") - code.count("}")
            if brace_depth <= 0:
                in_dormant_helper = False
            continue
        lowered = code.lower()
        helper_called = bool(re.search(r"(^|[;&|])[ \t]*ensure_agent_chrome(?:[ \t;]|$)", lowered))
        enforcer_called = (
            "browser-enforcer.py" in lowered or "$browser_enforcer" in lowered
        ) and any(action in lowered for action in (" ensure ", " restart ", " stop "))
        denied = command_denial(code, default_state())
        if helper_called or enforcer_called or denied:
            violations.append(f"{path}:{number}:{code[:240]}")
    return violations


def audit_service_watchdog_browser_lifecycle() -> None:
    """Preserve service supervision but reject a second lifecycle owner."""
    findings: list[str] = []
    for path in (WATCHDOG_SOURCE, WATCHDOG_RUNTIME):
        findings.extend(watchdog_browser_lifecycle_violations(path))
    if findings:
        raise RuntimeError(f"service watchdog contains active browser lifecycle calls: {findings}")
    log("service watchdog lifecycle audit passed; service supervision left unchanged")


def daemon(policy: dict[str, Any]) -> None:
    if Path(sys.executable).resolve(strict=True) != Path(TRUSTED_PYTHON).resolve(strict=True):
        raise RuntimeError(f"browser enforcer must run under {TRUSTED_PYTHON}")
    validate_trusted_python()
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
    threading.Thread(target=code_sign_clone_maintenance_loop, daemon=True).start()
    threading.Thread(target=command_hook_maintenance_loop, daemon=True).start()
    threading.Thread(target=control_readiness_loop, daemon=True).start()
    threading.Thread(target=broker_supervision_loop, daemon=True).start()
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


def set_human_hold(
    browser: str,
    minutes: float,
    policy: dict[str, Any],
    state: dict[str, Any],
) -> dict[str, Any]:
    del state  # The CLI snapshot predates lock acquisition and is not authoritative.
    with exclusive_file_lock(STATE_LOCK_FILE):
        current = load_state()
        merge_current_manual_holds(current)
        presence = current.setdefault("human_presence", default_state()["human_presence"])
        holds = presence.setdefault("manual_hold_until", {"chrome": 0.0, "safari": 0.0})
        until = time.time() + max(1.0, minutes * 60)
        browsers = ("chrome", "safari") if browser == "all" else (browser,)
        for name in browsers:
            holds[name] = until
        value = refresh_human_presence(policy, current)
        atomic_write_json(STATE_FILE, current)
        return value


def release_human_hold(browser: str, policy: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    del state
    with exclusive_file_lock(STATE_LOCK_FILE):
        current = load_state()
        merge_current_manual_holds(current)
        presence = current.setdefault("human_presence", default_state()["human_presence"])
        holds = presence.setdefault("manual_hold_until", {"chrome": 0.0, "safari": 0.0})
        browsers = ("chrome", "safari") if browser == "all" else (browser,)
        for name in browsers:
            holds[name] = 0.0
        value = refresh_human_presence(policy, current)
        atomic_write_json(STATE_FILE, current)
        return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY)
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("daemon")
    subparsers.add_parser("status")
    subparsers.add_parser("presence")
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
    restart.add_argument("--force", action="store_true", help="override the human/lease quiet gate")
    hold = subparsers.add_parser("human-hold")
    hold.add_argument("browser", choices=("chrome", "safari", "all"), default="all", nargs="?")
    hold.add_argument("--minutes", type=float, default=60)
    release = subparsers.add_parser("human-release")
    release.add_argument("browser", choices=("chrome", "safari", "all"), default="all", nargs="?")
    check = subparsers.add_parser("check-command")
    check.add_argument("command", nargs="?")
    check_tool = subparsers.add_parser("check-tool")
    check_tool.add_argument("tool_name")
    args = parser.parse_args()
    policy = load_policy(args.policy)
    state = load_state()

    if args.action == "daemon":
        daemon(policy)
    elif args.action == "status":
        presence = refresh_human_presence_serialized(policy, state)
        snapshot = inspect(policy)
        snapshot["human_presence"] = presence
        snapshot["policy"] = {
            "chrome_max_tabs": policy["chrome"]["max_tabs"],
            "safari_max_tabs": policy["safari"]["max_tabs"],
            "chrome_agent_max_tabs": policy["chrome"].get("agent_max_tabs"),
            "safari_agent_max_tabs": policy["safari"].get("agent_max_tabs"),
            "safari_max_windows": policy["safari"].get("max_windows"),
            "cooldown_seconds": policy["cooldown_seconds"],
            "sustained_breach_samples": policy["sustained_breach_samples"],
        }
        snapshot["state"] = state
        print(json.dumps(snapshot, indent=2))
    elif args.action == "presence":
        print(json.dumps(refresh_human_presence_serialized(policy, state), indent=2))
    elif args.action == "enforce-once":
        print(json.dumps(enforce_once(policy, state), indent=2))
    elif args.action == "configure-agents":
        changes = configure_agents()
        print(json.dumps({"changed": changes, "violations": []}))
        return 0
    elif args.action == "audit-config":
        findings = config_violations()
        print(json.dumps({"ok": not findings, "violations": findings}, indent=2))
        return 1 if findings else 0
    elif args.action == "install":
        snapshot = snapshot_installation()
        try:
            installed_hashes = install_runtime_bundle(args.policy)
            installed_hooks = install_command_hooks()
            ensure_control_token(SAFARI_PRESENCE_TOKEN, create=True)
            audit_service_watchdog_browser_lifecycle()
            if args.no_start:
                print(json.dumps({
                    "staged": installed_hashes,
                    "command_hooks": installed_hooks,
                    "launch_agent": str(LAUNCH_AGENT),
                }, indent=2))
                return 0
            install_safari_control_broker()
            # The former shared destructive credential is retired only after
            # the peer-attested Unix control socket is healthy. Rollback can
            # restore it from the installation snapshot if a later step fails.
            SAFARI_CONTROL_TOKEN.unlink(missing_ok=True)
            install_launch_agent(args.policy)
            browserd_control_ready()
            # Agent configuration is the transaction's final mutation. Its
            # own transaction plus the outer service/runtime snapshot makes
            # the complete installation recoverable.
            changes = configure_agents()
        except BaseException as error:
            rollback_failures = rollback_installation(snapshot)
            if rollback_failures:
                raise BaseExceptionGroup(
                    "browser-enforcer install failed and rollback was incomplete",
                    [error, *rollback_failures],
                ) from error
            raise
        else:
            # Output transport failure is not an installation failure. By the
            # time this branch runs, runtime, services, and configs committed.
            print(json.dumps({
                "installed": installed_hashes,
                "command_hooks": installed_hooks,
                "configured": changes,
            }, indent=2))
    elif args.action == "ensure":
        refresh_human_presence_serialized(policy, state)
        if args.browser == "all":
            reconcile_singletons(policy, state, ensure_running=True)
        else:
            reconcile_singletons(policy, state, ensure_running=False)
            invalidate_process_table_cache()
            processes = process_table()
            roots = chrome_roots(processes) if args.browser == "chrome" else safari_roots(processes)
            if args.browser == "chrome" and roots:
                canonical = [process for process in roots if canonical_chrome(process, policy)]
                if not canonical or not chrome_cdp_available(policy):
                    log("Chrome ensure failed: existing root is non-canonical or CDP is unavailable")
                    return 1
            if not roots:
                if cooling(args.browser, state):
                    log(f"{args.browser} ensure deferred during cooling")
                    return 75
                if not missing_browser_launch_allowed(args.browser, policy, state):
                    log(f"{args.browser} ensure deferred until the human foreground lane is idle")
                    return 75
                launched_pid = (
                    launch_chrome(policy, state)
                    if args.browser == "chrome"
                    else launch_safari(policy, state)
                )
                if launched_pid is None:
                    return 1
    elif args.action == "restart":
        return 0 if restart_browser(args.browser, args.reason, policy, state, force=args.force) else 1
    elif args.action == "human-hold":
        print(json.dumps(set_human_hold(args.browser, args.minutes, policy, state), indent=2))
    elif args.action == "human-release":
        print(json.dumps(release_human_hold(args.browser, policy, state), indent=2))
    elif args.action == "check-command":
        command = args.command if args.command is not None else sys.stdin.read()
        reason = command_denial(command, state)
        if reason:
            print(reason)
            return 42
    elif args.action == "check-tool":
        reason = leased_tool_denial(args.tool_name)
        if reason:
            print(reason)
            return 42
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
