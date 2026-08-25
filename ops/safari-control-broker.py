#!/usr/bin/env python3
"""Authenticated loopback Safari control for the browser enforcer.

This process must run inside the user's already-authorized tmux control plane.
The launchd enforcer calls it over loopback because launchd itself does not
reliably receive macOS AppleEvents/TCC permission for Safari.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import fcntl
import hmac
import json
import logging
import logging.handlers
import os
import re
import secrets
import socket
import socketserver
import stat
import struct
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APPLE_EVENTS_LOCK = threading.RLock()
MAX_REQUEST_THREADS = 4
MAX_TRIM_REQUEST_THREADS = 1
SOCKET_TIMEOUT_SECONDS = 5
MAX_REQUEST_BODY_BYTES = 4096
READ_REQUEST_DEADLINE_SECONDS = 3.5
TRIM_REQUEST_DEADLINE_SECONDS = 14.0
APPLE_EVENTS_QUEUE_SECONDS = 0.25
MAX_TRIM_CLOSES_PER_REQUEST = 2
CLAIMS_FILE = Path("/tmp/safari-tab-claims.json")
CLAIMS_LOCK_FILE = Path("/tmp/safari-tab-claims.lock")
OWNERSHIP_FILE = Path("/tmp/safari-tab-ownership.json")
OWNERSHIP_SCHEMA_VERSION = 1
CLAIM_TTL_SECONDS = 60
NATIVE_SIGNAL_TIMEOUT_SECONDS = 1.0
HUMAN_RECENT_INPUT_SECONDS = 60.0
RESTART_IDLE_SECONDS = 300.0
PRESENCE_SCHEMA_VERSION = 1
CHROME_BUNDLE_IDS = {
    "com.google.Chrome",
    "com.google.Chrome.beta",
    "com.google.Chrome.canary",
    "com.google.Chrome.dev",
}
SAFARI_BUNDLE_IDS = {"com.apple.Safari", "com.apple.SafariTechnologyPreview"}
AGENT_TAB_MARKER_PREFIX = "__ACTP_SAFARI_AGENT_TAB__:"
AGENT_TAB_MARKER_PATTERN = re.compile(
    rf"^{re.escape(AGENT_TAB_MARKER_PREFIX)}[0-9a-f]{{8}}-"
    r"[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
READ_TOKEN_FILENAME = "safari-presence.token"
TRIM_SOCKET_FILENAME = "safari-trim.sock"
ENFORCER_LAUNCHD_LABEL = "com.isaiah.actp-browser-enforcer"
CANONICAL_ENFORCER_PYTHON = Path("/opt/homebrew/bin/python3")
CANONICAL_ENFORCER_PYTHON_APP = Path(
    "/opt/homebrew/opt/python@3.14/Frameworks/Python.framework/Versions/Current/"
    "Resources/Python.app/Contents/MacOS/Python"
)
DARWIN_SOL_LOCAL = 0
DARWIN_LOCAL_PEERPID = 0x002
CTL_KERN = 1
KERN_PROCARGS2 = 49
MAX_PROCARGS_BYTES = 1024 * 1024


class OwnershipStateError(RuntimeError):
    """The broker cannot prove that a Safari tab is safe to destroy."""


class OperationDeadlineExceeded(TimeoutError):
    """One absolute broker operation deadline expired."""


class AppleEventsBusy(RuntimeError):
    """Another bounded AppleEvent operation owns the serialized lane."""


def remaining_seconds(deadline: float | None, maximum: float) -> float:
    if deadline is None:
        return maximum
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise OperationDeadlineExceeded("Safari control operation deadline expired")
    return max(0.001, min(maximum, remaining))


def check_deadline(deadline: float | None) -> None:
    remaining_seconds(deadline, 1.0)


@contextmanager
def apple_events_lock(deadline: float | None):
    wait_seconds = remaining_seconds(deadline, APPLE_EVENTS_QUEUE_SECONDS)
    if not APPLE_EVENTS_LOCK.acquire(timeout=wait_seconds):
        raise AppleEventsBusy("Safari AppleEvent lane is busy; retry without creating fallback work")
    try:
        check_deadline(deadline)
        yield
    finally:
        APPLE_EVENTS_LOCK.release()


def run_osascript(script: str, timeout: float) -> str:
    result = subprocess.run(
        ["/usr/bin/osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=True,
    )
    return result.stdout.strip()


def run_native(command: list[str], timeout: float = NATIVE_SIGNAL_TIMEOUT_SECONDS) -> str:
    """Run a fixed native presence probe with a strict wall-clock bound."""
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=True,
    )
    return result.stdout.strip()


def frontmost_bundle_id(deadline: float | None = None) -> str:
    application = run_native(
        ["/usr/bin/lsappinfo", "front"],
        timeout=remaining_seconds(deadline, NATIVE_SIGNAL_TIMEOUT_SECONDS),
    )
    if not application.startswith("ASN:"):
        raise ValueError(f"unexpected lsappinfo front output: {application[-200:]}")
    detail = run_native(
        ["/usr/bin/lsappinfo", "info", "-only", "bundleID", application],
        timeout=remaining_seconds(deadline, NATIVE_SIGNAL_TIMEOUT_SECONDS),
    )
    match = re.search(r'"CFBundleIdentifier"="([^"]+)"', detail)
    if not match:
        raise ValueError(f"frontmost bundle identifier unavailable: {detail[-200:]}")
    return match.group(1)


def input_idle_seconds(deadline: float | None = None) -> float:
    detail = run_native(
        ["/usr/sbin/ioreg", "-r", "-c", "IOHIDSystem", "-d", "1"],
        timeout=remaining_seconds(deadline, NATIVE_SIGNAL_TIMEOUT_SECONDS),
    )
    match = re.search(r'"HIDIdleTime"\s*=\s*(\d+)', detail)
    if not match:
        raise ValueError("IOHIDSystem did not report HIDIdleTime")
    return int(match.group(1)) / 1_000_000_000


def human_presence(deadline: float | None = None) -> dict[str, Any]:
    """Return raw native signals plus conservative, schema-stable decisions.

    Both signals must be available before automation is permitted. A missing or
    timed-out signal therefore fails closed and reports the human as active.
    """
    sampled_at = datetime.now(timezone.utc).isoformat()
    started = time.monotonic()
    errors: list[str] = []
    bundle_id: str | None = None
    idle_seconds: float | None = None

    try:
        bundle_id = frontmost_bundle_id(deadline)
    except OperationDeadlineExceeded:
        raise
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        errors.append(f"frontmost_app:{type(exc).__name__}:{str(exc)[-200:]}")
    try:
        idle_seconds = input_idle_seconds(deadline)
    except OperationDeadlineExceeded:
        raise
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        errors.append(f"input_idle:{type(exc).__name__}:{str(exc)[-200:]}")

    if bundle_id in CHROME_BUNDLE_IDS:
        frontmost_browser = "chrome"
    elif bundle_id in SAFARI_BUNDLE_IDS:
        frontmost_browser = "safari"
    else:
        frontmost_browser = None

    signals_available = bundle_id is not None and idle_seconds is not None
    browser_foreground = frontmost_browser is not None
    recent_input = idle_seconds is not None and idle_seconds < HUMAN_RECENT_INPUT_SECONDS
    human_active = not signals_available or browser_foreground or recent_input
    return {
        "schema_version": PRESENCE_SCHEMA_VERSION,
        "sampled_at": sampled_at,
        "sample_duration_ms": round((time.monotonic() - started) * 1000, 1),
        "signals_available": signals_available,
        "fail_closed": not signals_available,
        "human_active": human_active,
        "interactive_automation_allowed": (
            signals_available and not browser_foreground and not recent_input
        ),
        "restart_maintenance_allowed": (
            signals_available
            and not browser_foreground
            and idle_seconds is not None
            and idle_seconds >= RESTART_IDLE_SECONDS
        ),
        "frontmost_bundle_id": bundle_id,
        "frontmost_browser": frontmost_browser,
        "browser_foreground": browser_foreground,
        "input_idle_seconds": round(idle_seconds, 3) if idle_seconds is not None else None,
        "recent_input": recent_input,
        "thresholds": {
            "human_recent_input_seconds": HUMAN_RECENT_INPUT_SECONDS,
            "restart_idle_seconds": RESTART_IDLE_SECONDS,
        },
        "errors": errors,
    }


def trim_presence_allowed(value: Any) -> bool:
    """Validate the destructive-maintenance subset of a native presence sample."""
    if not isinstance(value, dict):
        return False
    idle_seconds = value.get("input_idle_seconds")
    return bool(
        value.get("schema_version") == PRESENCE_SCHEMA_VERSION
        and value.get("signals_available") is True
        and value.get("fail_closed") is False
        and value.get("human_active") is False
        and value.get("browser_foreground") is False
        and value.get("recent_input") is False
        and value.get("restart_maintenance_allowed") is True
        and isinstance(idle_seconds, (int, float))
        and not isinstance(idle_seconds, bool)
        and idle_seconds >= RESTART_IDLE_SECONDS
    )


def safari_counts(deadline: float | None = None) -> dict[str, int]:
    with apple_events_lock(deadline):
        gui_script = 'tell application "System Events" to tell process "Safari" to count windows'
        windows = int(run_osascript(gui_script, timeout=remaining_seconds(deadline, 3)))
        if windows == 0:
            return {"windows": 0, "tabs": 0}
        safari_script = """
tell application "Safari"
  set windowCount to count of windows
  set tabCount to 0
  repeat with safariWindow in windows
    set tabCount to tabCount + (count of tabs of safariWindow)
  end repeat
  return (windowCount as text) & "|" & (tabCount as text)
end tell
"""
        window_text, tab_text = run_osascript(
            safari_script,
            timeout=remaining_seconds(deadline, 6),
        ).split("|", 1)
        result = {"windows": int(window_text), "tabs": int(tab_text)}
        if result["windows"] < 0 or result["tabs"] < 0:
            raise ValueError(f"invalid Safari counts: {result}")
        return result


def pid_alive(pid: Any) -> bool:
    try:
        parsed = int(pid)
        if parsed <= 1:
            return False
        os.kill(parsed, 0)
        return True
    except (OSError, TypeError, ValueError):
        return False


def heartbeat_epoch_seconds(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value) / 1000 if value > 10_000_000_000 else float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def claim_is_live(claim: dict[str, Any], now: float | None = None) -> bool:
    heartbeat = heartbeat_epoch_seconds(claim.get("heartbeat"))
    reference = time.time() if now is None else now
    age = reference - heartbeat if heartbeat is not None else None
    if heartbeat is None or age is None or age < -5 or age > CLAIM_TTL_SECONDS:
        return False
    return pid_alive(claim.get("pid"))


def claim_identity(claim: dict[str, Any]) -> tuple[int, int]:
    """Return the stable window id and current tab index from a valid claim."""
    try:
        window_id = int(claim["windowId"])
        tab_index = int(claim["tabIndex"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnershipStateError("Safari claim lacks a stable windowId/tabIndex") from exc
    if window_id < 1 or tab_index < 1:
        raise OwnershipStateError("Safari claim has an invalid stable windowId/tabIndex")
    return window_id, tab_index


def validate_claim(claim: Any, now: float | None = None) -> dict[str, Any]:
    if not isinstance(claim, dict):
        raise OwnershipStateError("Safari claim registry contains a non-object entry")
    agent_id = claim.get("agentId")
    if not isinstance(agent_id, str) or not agent_id or len(agent_id) > 200:
        raise OwnershipStateError("Safari claim registry contains an invalid agentId")
    claim_identity(claim)
    heartbeat = heartbeat_epoch_seconds(claim.get("heartbeat"))
    reference = time.time() if now is None else now
    if heartbeat is None or heartbeat > reference + 5:
        raise OwnershipStateError("Safari claim registry contains an invalid heartbeat")
    try:
        pid = int(claim["pid"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnershipStateError("Safari claim registry contains an invalid pid") from exc
    if pid <= 1:
        raise OwnershipStateError("Safari claim registry contains an invalid pid")
    if not isinstance(claim.get("agentOwned"), bool):
        raise OwnershipStateError("Safari claim registry contains invalid ownership metadata")
    ownership_marker = claim.get("ownershipMarker")
    if ownership_marker is not None and (
        not isinstance(ownership_marker, str)
        or not AGENT_TAB_MARKER_PATTERN.fullmatch(ownership_marker)
    ):
        raise OwnershipStateError("Safari claim registry contains an invalid ownership marker")
    return dict(claim)


def load_claims_strict(path: Path = CLAIMS_FILE, now: float | None = None) -> list[dict[str, Any]]:
    """Read the exclusion ledger without converting unsafe state into no claims."""
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise OwnershipStateError("Safari claim registry ownership or mode is unsafe")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = -1
            value = json.load(handle)
    except OwnershipStateError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        raise OwnershipStateError("Safari claim registry is missing or corrupt") from exc
    finally:
        if "descriptor" in locals() and descriptor >= 0:
            os.close(descriptor)
    if not isinstance(value, list):
        raise OwnershipStateError("Safari claim registry root must be an array")
    return [validate_claim(claim, now=now) for claim in value]


def validate_ownership_entry(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise OwnershipStateError("Safari ownership ledger contains a non-object entry")
    marker = entry.get("marker")
    if not isinstance(marker, str) or not AGENT_TAB_MARKER_PATTERN.fullmatch(marker):
        raise OwnershipStateError("Safari ownership ledger contains an invalid marker")
    try:
        window_id = int(entry["windowId"])
        created_at = float(entry["createdAt"])
    except (KeyError, TypeError, ValueError) as exc:
        raise OwnershipStateError("Safari ownership ledger contains invalid identity metadata") from exc
    if window_id < 1 or created_at <= 0:
        raise OwnershipStateError("Safari ownership ledger contains invalid identity metadata")
    agent_id = entry.get("agentId")
    service = entry.get("service")
    if not isinstance(agent_id, str) or not agent_id or len(agent_id) > 200:
        raise OwnershipStateError("Safari ownership ledger contains an invalid agentId")
    if not isinstance(service, str) or not service or len(service) > 120:
        raise OwnershipStateError("Safari ownership ledger contains an invalid service")
    return dict(entry)


def load_ownership_ledger_strict(
    path: Path = OWNERSHIP_FILE,
) -> list[dict[str, Any]]:
    """Load durable agent-tab identities; absence safely authorizes no closes."""
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except FileNotFoundError:
        return []
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise OwnershipStateError("Safari ownership ledger ownership or mode is unsafe")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = -1
            value = json.load(handle)
    except OwnershipStateError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        raise OwnershipStateError("Safari ownership ledger is corrupt") from exc
    finally:
        if "descriptor" in locals() and descriptor >= 0:
            os.close(descriptor)
    if not isinstance(value, dict) or value.get("version") != OWNERSHIP_SCHEMA_VERSION:
        raise OwnershipStateError("Safari ownership ledger has an unsupported schema")
    raw_entries = value.get("entries")
    if not isinstance(raw_entries, list):
        raise OwnershipStateError("Safari ownership ledger entries must be an array")
    entries = [validate_ownership_entry(entry) for entry in raw_entries]
    markers = [str(entry["marker"]) for entry in entries]
    if len(set(markers)) != len(markers):
        raise OwnershipStateError("Safari ownership ledger contains duplicate markers")
    return entries


def live_claim_protections(
    claims: list[dict[str, Any]],
    ownership: list[dict[str, Any]],
    now: float | None = None,
) -> tuple[set[str], set[int]]:
    """Return exact live markers plus legacy/unproven windows to protect."""
    owned_by_marker = {str(entry["marker"]): entry for entry in ownership}
    protected_markers: set[str] = set()
    protected_windows: set[int] = set()
    for claim in claims:
        if not claim_is_live(claim, now=now):
            continue
        window_id, _ = claim_identity(claim)
        # Closing any earlier tab in this window would shift the live claim's
        # mutable ordinal. Defer all trimming in a window that contains real
        # in-flight work; idle durable ownership is trimmed after release.
        protected_windows.add(window_id)
        marker = claim.get("ownershipMarker")
        entry = owned_by_marker.get(marker) if isinstance(marker, str) else None
        if entry is None:
            # Pre-ledger claims and a missing durable binding protect their
            # entire stable window; neither can authorize a close.
            continue
        if int(entry["windowId"]) != window_id:
            raise OwnershipStateError("Live Safari claim disagrees with its ownership ledger binding")
        protected_markers.add(marker)
    return protected_markers, protected_windows


def idle_agent_owned_candidates(
    inspected: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    ownership: list[dict[str, Any]],
    now: float | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Return only ledger-bound, idle tabs outside current human Window 1."""
    owned_by_marker = {str(entry["marker"]): entry for entry in ownership}
    protected_markers, protected_windows = live_claim_protections(
        claims, ownership, now=now
    )
    candidates: list[dict[str, Any]] = []
    protected_count = 0
    for raw_candidate in inspected:
        candidate = dict(raw_candidate)
        marker = str(candidate["marker"])
        entry = owned_by_marker.get(marker)
        if entry is None:
            # A page can forge the public marker prefix/UUID shape. Without a
            # durable entry created under the claims lock it remains human.
            protected_count += 1
            continue
        if int(entry["windowId"]) != int(candidate["windowId"]):
            raise OwnershipStateError("Safari marker appeared outside its ledger-bound stable window")
        if (
            int(candidate["windowIndex"]) == 1
            or int(candidate["windowId"]) in protected_windows
            or marker in protected_markers
        ):
            protected_count += 1
            continue
        candidates.append(candidate)
    candidates = sorted(
        candidates,
        key=lambda candidate: (candidate["windowId"], candidate["tabIndex"]),
        reverse=True,
    )
    return candidates, protected_count


def parse_agent_owned_tabs(output: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    marker_counts: dict[str, int] = {}
    for raw_row in output.splitlines():
        row = raw_row.strip()
        if not row:
            continue
        parts = row.split("||", 3)
        if len(parts) != 4:
            raise OwnershipStateError("Safari ownership inspection returned a malformed row")
        raw_window_index, raw_window_id, raw_tab_index, marker = parts
        try:
            window_index = int(raw_window_index)
            window_id = int(raw_window_id)
            tab_index = int(raw_tab_index)
        except ValueError as exc:
            raise OwnershipStateError("Safari ownership inspection returned an invalid identity") from exc
        if (
            window_index < 1
            or window_id < 1
            or tab_index < 1
            or not AGENT_TAB_MARKER_PATTERN.fullmatch(marker)
        ):
            raise OwnershipStateError("Safari ownership marker is missing, stale, or corrupt")
        candidate = {
            "windowIndex": window_index,
            "windowId": window_id,
            "tabIndex": tab_index,
            "marker": marker,
        }
        candidates.append(candidate)
        marker_counts[marker] = marker_counts.get(marker, 0) + 1

    # A duplicated marker cannot identify one tab. Fail the entire destructive
    # operation rather than guessing which copy is agent-owned.
    if any(count != 1 for count in marker_counts.values()):
        raise OwnershipStateError("Safari ownership marker is duplicated and ambiguous")
    return candidates


def apply_closed_tab_identities(
    claims: list[dict[str, Any]],
    closed_identities: list[tuple[int, int]],
) -> list[dict[str, Any]]:
    """Account for closes using stable window ids, never mutable window order."""
    updated = [dict(claim) for claim in claims]
    for window_id, tab_index in closed_identities:
        shifted: list[dict[str, Any]] = []
        for claim in updated:
            claim_window_id, claim_tab_index = claim_identity(claim)
            if claim_window_id != window_id:
                shifted.append(claim)
                continue
            if claim_tab_index == tab_index:
                continue
            if claim_tab_index > tab_index:
                claim["tabIndex"] = claim_tab_index - 1
            shifted.append(claim)
        updated = shifted
    return updated


def apply_closed_ownership_marker(
    ownership: list[dict[str, Any]],
    marker: str,
) -> list[dict[str, Any]]:
    if not AGENT_TAB_MARKER_PATTERN.fullmatch(marker):
        raise OwnershipStateError("Cannot account for an invalid Safari ownership marker")
    return [dict(entry) for entry in ownership if entry.get("marker") != marker]


@contextmanager
def claims_lock(
    path: Path = CLAIMS_LOCK_FILE,
    timeout: float = 2.0,
    deadline: float | None = None,
):
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        lock_deadline = time.monotonic() + remaining_seconds(deadline, timeout)
        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                check_deadline(deadline)
                if time.monotonic() >= lock_deadline:
                    raise TimeoutError("Safari claim registry lock remained busy")
                time.sleep(0.025)
        check_deadline(deadline)
        yield
    finally:
        fcntl.flock(descriptor, fcntl.LOCK_UN)
        os.close(descriptor)


def atomic_write_claims(
    claims: list[dict[str, Any]],
    path: Path = CLAIMS_FILE,
    deadline: float | None = None,
) -> None:
    check_deadline(deadline)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600)
    try:
        payload = (json.dumps(claims, indent=2) + "\n").encode("utf-8")
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
        check_deadline(deadline)
    finally:
        os.close(descriptor)
        temporary.unlink(missing_ok=True)


def atomic_write_ownership(
    ownership: list[dict[str, Any]],
    path: Path = OWNERSHIP_FILE,
    deadline: float | None = None,
) -> None:
    """Atomically persist validated durable ownership while caller holds the lock."""
    entries = [validate_ownership_entry(entry) for entry in ownership]
    markers = [str(entry["marker"]) for entry in entries]
    if len(set(markers)) != len(markers):
        raise OwnershipStateError("Safari ownership ledger contains duplicate markers")
    check_deadline(deadline)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600)
    try:
        payload = (
            json.dumps({"version": OWNERSHIP_SCHEMA_VERSION, "entries": entries}, indent=2)
            + "\n"
        ).encode("utf-8")
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        path.chmod(0o600)
        check_deadline(deadline)
    finally:
        os.close(descriptor)
        temporary.unlink(missing_ok=True)


def update_claims_after_closures(
    closed_identities: list[tuple[int, int]],
    path: Path = CLAIMS_FILE,
    lock_path: Path = CLAIMS_LOCK_FILE,
) -> None:
    if not closed_identities:
        return
    with claims_lock(lock_path):
        latest = load_claims_strict(path)
        atomic_write_claims(apply_closed_tab_identities(latest, closed_identities), path)


def applescript_literal(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def inspect_agent_owned_tabs(deadline: float | None = None) -> list[dict[str, Any]]:
    """Discover marker-shaped tabs; the durable ledger decides ownership."""
    script = f'''
tell application "Safari"
  set ownedRows to {{}}
  repeat with windowNumber from 1 to count of windows
    set safariWindow to window windowNumber
    set stableWindowId to id of safariWindow
    repeat with tabNumber from 1 to count of tabs of safariWindow
      try
        set ownerMarker to do JavaScript "window.name" in tab tabNumber of safariWindow
      on error
        return "__ACTP_OWNERSHIP_INSPECTION_ERROR__"
      end try
      if ownerMarker starts with "{AGENT_TAB_MARKER_PREFIX}" then
        set end of ownedRows to ((windowNumber as text) & "||" & (stableWindowId as text) & "||" & (tabNumber as text) & "||" & ownerMarker)
      end if
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return ownedRows as text
end tell
'''
    return parse_agent_owned_tabs(
        run_osascript(script, timeout=remaining_seconds(deadline, 8))
    )


def close_claimed_agent_tab_script(candidate: dict[str, Any]) -> str:
    """Build an atomic marker lookup/close against one stable Safari window."""
    window_id = int(candidate["windowId"])
    marker = str(candidate["marker"])
    if not AGENT_TAB_MARKER_PATTERN.fullmatch(marker):
        raise OwnershipStateError("Safari ownership marker is missing, stale, or corrupt")
    if int(candidate.get("windowIndex", 0)) == 1:
        raise OwnershipStateError("Safari human Window 1 is never eligible for trimming")
    expected_marker = applescript_literal(marker)
    return f"""
tell application "Safari"
  set stableWindowIndex to 0
  repeat with windowNumber from 1 to count of windows
    if id of window windowNumber is {window_id} then set stableWindowIndex to windowNumber
  end repeat
  if stableWindowIndex is 0 then return "missing-window"
  if stableWindowIndex is 1 then return "human-window-protected"
  try
    set stableWindow to first window whose id is {window_id}
  on error
    return "missing-window"
  end try
  set matchingTab to missing value
  set matchingIndex to 0
  set matchCount to 0
  repeat with tabNumber from 1 to count of tabs of stableWindow
    try
      set currentMarker to do JavaScript "window.name" in tab tabNumber of stableWindow
    on error
      return "inspection-error"
    end try
    if currentMarker is {expected_marker} then
      set matchCount to matchCount + 1
      set matchingTab to tab tabNumber of stableWindow
      set matchingIndex to tabNumber
    end if
  end repeat
  if matchCount is 0 then return "marker-missing"
  if matchCount is not 1 then return "marker-ambiguous"
  if (count of tabs of stableWindow) is 1 then return "sole-tab-protected"
  close matchingTab
  return "closed||" & ({window_id} as text) & "||" & (matchingIndex as text)
end tell
"""


def close_claimed_agent_tab(
    candidate: dict[str, Any],
    deadline: float | None = None,
) -> tuple[str, tuple[int, int] | None]:
    """Verify a stable marker identity and close it in one AppleEvent."""
    window_id = int(candidate["windowId"])
    script = close_claimed_agent_tab_script(candidate)
    outcome = run_osascript(script, timeout=remaining_seconds(deadline, 5))
    if not outcome.startswith("closed||"):
        return outcome, None
    parts = outcome.split("||", 2)
    if len(parts) != 3:
        raise OwnershipStateError("Safari close returned malformed identity accounting")
    try:
        closed_window_id = int(parts[1])
        closed_tab_index = int(parts[2])
    except ValueError as exc:
        raise OwnershipStateError("Safari close returned invalid identity accounting") from exc
    if closed_window_id != window_id or closed_tab_index < 1:
        raise OwnershipStateError("Safari close identity did not match the stable ownership proof")
    return "closed", (closed_window_id, closed_tab_index)


def trim_close_budget(excess: int) -> int:
    return max(0, min(int(excess), MAX_TRIM_CLOSES_PER_REQUEST))


def trim_safari(
    maximum: int,
    claims_path: Path = CLAIMS_FILE,
    lock_path: Path = CLAIMS_LOCK_FILE,
    ownership_path: Path = OWNERSHIP_FILE,
    deadline: float | None = None,
) -> dict[str, Any]:
    if deadline is None:
        deadline = time.monotonic() + TRIM_REQUEST_DEADLINE_SECONDS
    with apple_events_lock(deadline):
        maximum = min(8, max(1, int(maximum)))
        current = safari_counts(deadline)
        if current["tabs"] <= maximum:
            return {
                **current,
                "closed": 0,
                "protected_excess": 0,
                "agent_owned_candidates": 0,
            }

        with claims_lock(lock_path, deadline=deadline):
            # Re-read everything only after acquiring the same advisory lock as
            # every claimant. Keep that lock through presence, identity check,
            # close, and claim-index accounting so a new claim cannot race trim.
            current = safari_counts(deadline)
            if current["tabs"] <= maximum:
                return {
                    **current,
                    "closed": 0,
                    "protected_excess": 0,
                    "agent_owned_candidates": 0,
                }
            now = time.time()
            claims = load_claims_strict(claims_path, now=now)
            ownership = load_ownership_ledger_strict(ownership_path)
            presence = human_presence(deadline)
            if not trim_presence_allowed(presence):
                return {
                    **current,
                    "closed": 0,
                    "protected_excess": max(0, current["tabs"] - maximum),
                    "agent_owned_candidates": 0,
                    "skipped_candidates": {"human-presence": 1},
                }

            inspected = inspect_agent_owned_tabs(deadline)
            skipped: dict[str, int] = {}
            candidates, protected_count = idle_agent_owned_candidates(
                inspected, claims, ownership, now=now
            )
            if protected_count:
                skipped["live-claim-window"] = protected_count
            needed = trim_close_budget(current["tabs"] - maximum)
            closed_identities: list[tuple[int, int]] = []
            for candidate in candidates:
                if len(closed_identities) >= needed:
                    break
                # The first mouse/key event must win even after a lengthy marker
                # scan or earlier close. Missing native signals deny destruction.
                latest_presence = human_presence(deadline)
                if not trim_presence_allowed(latest_presence):
                    skipped["human-presence"] = skipped.get("human-presence", 0) + 1
                    break
                try:
                    outcome, closed_identity = close_claimed_agent_tab(candidate, deadline)
                except OperationDeadlineExceeded:
                    raise
                except (OSError, subprocess.SubprocessError) as exc:
                    check_deadline(deadline)
                    outcome, closed_identity = f"error:{type(exc).__name__}", None
                if outcome == "closed" and closed_identity is not None:
                    closed_identities.append(closed_identity)
                    ownership = apply_closed_ownership_marker(
                        ownership, str(candidate["marker"])
                    )
                    claims = apply_closed_tab_identities(claims, [closed_identity])
                    # Persist accounting before considering another destructive
                    # action. The shared lock remains held for the entire cycle.
                    atomic_write_ownership(ownership, ownership_path, deadline)
                    atomic_write_claims(claims, claims_path, deadline)
                else:
                    skipped[outcome] = skipped.get(outcome, 0) + 1

            after = safari_counts(deadline)
            return {
                **after,
                "closed": len(closed_identities),
                "protected_excess": max(0, after["tabs"] - maximum),
                "agent_owned_candidates": len(candidates),
                "skipped_candidates": skipped,
            }


def private_token(path: Path, *, create: bool = False) -> str:
    """Read or atomically create a private, owner-only broker credential."""
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            descriptor = os.open(path, flags, 0o600)
        except FileExistsError:
            descriptor = None
        if descriptor is not None:
            try:
                token = secrets.token_urlsafe(48)
                os.write(descriptor, (token + "\n").encode("utf-8"))
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise RuntimeError("token ownership or mode is unsafe")
        with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
            descriptor = -1
            token = handle.read().strip()
    except OSError as exc:
        raise RuntimeError("token is unavailable") from exc
    finally:
        if "descriptor" in locals() and descriptor >= 0:
            os.close(descriptor)
    if len(token) < 32:
        raise RuntimeError("token is missing or too short")
    return token


def unix_peer_pid(connection: socket.socket) -> int:
    """Return the kernel-authenticated peer PID for a Darwin Unix socket."""
    if sys.platform != "darwin":
        raise RuntimeError("LOCAL_PEERPID verification is only available on Darwin")
    try:
        raw = connection.getsockopt(
            getattr(socket, "SOL_LOCAL", DARWIN_SOL_LOCAL),
            getattr(socket, "LOCAL_PEERPID", DARWIN_LOCAL_PEERPID),
            struct.calcsize("i"),
        )
        peer_pid = struct.unpack("i", raw)[0]
    except (OSError, struct.error) as exc:
        raise RuntimeError("LOCAL_PEERPID verification is unavailable") from exc
    if peer_pid <= 1:
        raise RuntimeError("Unix control peer PID is invalid")
    return peer_pid


def darwin_process_argv(pid: int) -> list[str]:
    """Read argv directly from the Darwin kernel, preserving paths with spaces."""
    if sys.platform != "darwin":
        raise RuntimeError("Darwin process argv verification is unavailable")
    libc = ctypes.CDLL(None, use_errno=True)
    mib = (ctypes.c_int * 3)(CTL_KERN, KERN_PROCARGS2, int(pid))
    size = ctypes.c_size_t(0)
    if libc.sysctl(mib, 3, None, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), "sysctl KERN_PROCARGS2 size failed")
    if size.value < struct.calcsize("i") or size.value > MAX_PROCARGS_BYTES:
        raise RuntimeError("peer process argv size is invalid")
    buffer = ctypes.create_string_buffer(size.value)
    if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
        raise OSError(ctypes.get_errno(), "sysctl KERN_PROCARGS2 read failed")
    data = buffer.raw[:size.value]
    argc = struct.unpack_from("i", data)[0]
    if argc < 1 or argc > 1024:
        raise RuntimeError("peer process argc is invalid")
    offset = struct.calcsize("i")
    try:
        executable_end = data.index(b"\0", offset)
    except ValueError as exc:
        raise RuntimeError("peer process executable path is malformed") from exc
    offset = executable_end
    while offset < len(data) and data[offset] == 0:
        offset += 1
    arguments: list[str] = []
    for _ in range(argc):
        try:
            argument_end = data.index(b"\0", offset)
        except ValueError as exc:
            raise RuntimeError("peer process argv is truncated") from exc
        arguments.append(data[offset:argument_end].decode("utf-8", errors="strict"))
        offset = argument_end + 1
    return arguments


def process_parent_pid(pid: int, deadline: float | None = None) -> int:
    output = run_native(
        ["/bin/ps", "-p", str(pid), "-o", "ppid="],
        timeout=remaining_seconds(deadline, NATIVE_SIGNAL_TIMEOUT_SECONDS),
    )
    try:
        return int(output.strip())
    except ValueError as exc:
        raise RuntimeError("peer process parent PID is unavailable") from exc


def launchd_service_pid(
    label: str = ENFORCER_LAUNCHD_LABEL,
    deadline: float | None = None,
) -> int:
    domain_label = f"gui/{os.getuid()}/{label}"
    output = run_native(
        ["/bin/launchctl", "print", domain_label],
        timeout=remaining_seconds(deadline, NATIVE_SIGNAL_TIMEOUT_SECONDS),
    )
    match = re.search(r"^\s*pid\s*=\s*(\d+)\s*$", output, re.MULTILINE)
    if not match:
        raise RuntimeError("browser-enforcer launchd label has no live PID")
    return int(match.group(1))


def canonical_enforcer_argv(arguments: list[str], expected_program: Path) -> bool:
    """Accept only the installed Python 3.14 enforcer daemon invocation."""
    if len(arguments) != 5:
        return False
    try:
        resolved_runtime = Path(arguments[0]).resolve(strict=True)
        expected_runtimes = {
            CANONICAL_ENFORCER_PYTHON.resolve(strict=True),
            CANONICAL_ENFORCER_PYTHON_APP.resolve(strict=True),
        }
        resolved_program = expected_program.resolve(strict=True)
        expected_policy = resolved_program.with_name("browser-policy.json").resolve(strict=True)
        supplied_program = Path(arguments[1]).resolve(strict=True)
        supplied_policy = Path(arguments[3]).resolve(strict=True)
    except OSError:
        return False
    return (
        resolved_runtime in expected_runtimes
        and supplied_program == resolved_program
        and arguments[2] == "--policy"
        and supplied_policy == expected_policy
        and arguments[4] == "daemon"
    )


def verified_enforcer_peer(
    connection: socket.socket,
    expected_program: Path,
    launchd_label: str = ENFORCER_LAUNCHD_LABEL,
    deadline: float | None = None,
) -> tuple[bool, str, int | None]:
    """Bind destructive authority to the exact launchd enforcer process."""
    try:
        check_deadline(deadline)
        peer_pid = unix_peer_pid(connection)
        if process_parent_pid(peer_pid, deadline) != 1:
            return False, "peer is not a direct launchd child", peer_pid
        if launchd_service_pid(launchd_label, deadline) != peer_pid:
            return False, "peer PID does not own the browser-enforcer launchd label", peer_pid
        arguments = darwin_process_argv(peer_pid)
        if not canonical_enforcer_argv(arguments, expected_program):
            return False, "peer argv is not the canonical Python 3.14 browser-enforcer daemon", peer_pid
        check_deadline(deadline)
        return True, "verified", peer_pid
    except (
        OSError,
        RuntimeError,
        ValueError,
        IndexError,
        UnicodeError,
        OperationDeadlineExceeded,
    ) as exc:
        return False, f"peer verification unavailable: {type(exc).__name__}", None


class SafariControlServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 8

    def __init__(
        self,
        address: tuple[str, int],
        read_token: str,
        logger: logging.Logger,
        legacy_read_token: str | None = None,
    ):
        if not read_token:
            raise ValueError("Safari read credential is required")
        self.read_tokens = tuple(
            token for token in (read_token, legacy_read_token) if token
        )
        self.logger = logger
        self.request_slots = threading.BoundedSemaphore(MAX_REQUEST_THREADS)
        super().__init__(address, SafariControlHandler)

    def get_request(self) -> tuple[Any, Any]:
        request, client_address = super().get_request()
        request.settimeout(SOCKET_TIMEOUT_SECONDS)
        return request, client_address

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self.request_slots.acquire(blocking=False):
            try:
                try:
                    request.sendall(
                        b"HTTP/1.0 503 Service Unavailable\r\n"
                        b"Connection: close\r\nContent-Length: 0\r\n\r\n"
                    )
                except OSError:
                    pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()


class SafariControlHandler(BaseHTTPRequestHandler):
    server: SafariControlServer

    def send_json(self, status: int, value: dict[str, Any]) -> None:
        payload = json.dumps(value, separators=(",", ":")).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        except OSError:
            self.close_connection = True

    def send_control_error(self, exc: Exception) -> None:
        if isinstance(exc, OperationDeadlineExceeded):
            self.send_json(504, {
                "ok": False,
                "control_available": False,
                "error": str(exc)[-500:],
                "code": "operation_deadline_exceeded",
            })
            return
        if isinstance(exc, (AppleEventsBusy, TimeoutError)):
            self.send_json(503, {
                "ok": False,
                "control_available": False,
                "error": str(exc)[-500:],
                "code": "control_lane_busy",
                "retry_after_seconds": 1,
            })
            return
        if isinstance(exc, OwnershipStateError):
            self.send_json(503, {
                "ok": False,
                "control_available": False,
                "error": str(exc)[-500:],
                "code": "ownership_unproven",
            })
            return
        self.send_json(503, {
            "ok": False,
            "control_available": False,
            "error": str(exc)[-500:],
            "code": "control_unavailable",
        })

    def supplied_token(self) -> str:
        return self.headers.get("X-ACTP-Browser-Token", "")

    def read_authorized(self) -> bool:
        supplied = self.supplied_token()
        if any(hmac.compare_digest(supplied, token) for token in self.server.read_tokens):
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized", "code": "authorization_required"})
        return False

    def authorized(self) -> bool:
        """Compatibility alias for tests and read-only routes."""
        return self.read_authorized()

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        deadline = time.monotonic() + READ_REQUEST_DEADLINE_SECONDS
        if not self.read_authorized():
            return
        if self.path == "/health":
            self.send_json(200, {"ok": True, "service": "safari-control-broker"})
            return
        if self.path == "/presence":
            try:
                self.send_json(200, {"ok": True, **human_presence(deadline)})
            except OperationDeadlineExceeded as exc:
                self.send_control_error(exc)
            except Exception as exc:
                self.send_json(503, {
                    "ok": False,
                    "schema_version": PRESENCE_SCHEMA_VERSION,
                    "signals_available": False,
                    "fail_closed": True,
                    "human_active": True,
                    "interactive_automation_allowed": False,
                    "restart_maintenance_allowed": False,
                    "error": f"{type(exc).__name__}: {str(exc)[-500:]}",
                })
            return
        if self.path != "/counts":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            self.send_json(200, {
                "ok": True,
                "control_available": True,
                **safari_counts(deadline),
            })
        except Exception as exc:
            self.send_control_error(exc)

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        # Destructive Safari control has no TCP route or token fallback. It is
        # available only on the peer-PID-authenticated Unix-domain socket.
        self.send_json(404, {"ok": False, "error": "not found", "code": "no_tcp_control"})

    def log_message(self, format_string: str, *args: Any) -> None:
        self.server.logger.info("client=%s %s", self.client_address[0], format_string % args)


def acquire_unix_socket_lock(socket_path: Path) -> int:
    """Take a private lifetime lock before replacing a stale control socket."""
    parent = socket_path.parent
    metadata = os.lstat(parent)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) & 0o077
    ):
        raise RuntimeError("Unix control socket directory ownership or mode is unsafe")
    lock_path = socket_path.with_name(f"{socket_path.name}.lock")
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, 0o600)
    try:
        lock_metadata = os.fstat(descriptor)
        if not stat.S_ISREG(lock_metadata.st_mode) or lock_metadata.st_uid != os.getuid():
            raise RuntimeError("Unix control socket lock ownership is unsafe")
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("another Safari trim broker owns the control socket") from exc
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def remove_stale_unix_socket(socket_path: Path) -> None:
    """Remove only a private, owner-created socket proven not to be listening."""
    try:
        metadata = os.lstat(socket_path)
    except FileNotFoundError:
        return
    if (
        not stat.S_ISSOCK(metadata.st_mode)
        or metadata.st_uid != os.getuid()
        or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise RuntimeError("existing Unix control socket ownership or mode is unsafe")
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    probe.settimeout(0.2)
    try:
        probe.connect(str(socket_path))
    except (ConnectionRefusedError, FileNotFoundError):
        pass
    except OSError as exc:
        raise RuntimeError("existing Unix control socket state is ambiguous") from exc
    else:
        raise RuntimeError("another Safari trim broker is already listening")
    finally:
        probe.close()
    socket_path.unlink()


class SafariTrimServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    """One-request destructive control plane authenticated by Darwin peer PID."""

    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 1

    def __init__(
        self,
        socket_path: Path,
        expected_program: Path,
        logger: logging.Logger,
        launchd_label: str = ENFORCER_LAUNCHD_LABEL,
    ):
        self.socket_path = socket_path
        self.expected_program = expected_program
        self.launchd_label = launchd_label
        self.logger = logger
        self.request_slots = threading.BoundedSemaphore(MAX_TRIM_REQUEST_THREADS)
        self._socket_lock_descriptor = acquire_unix_socket_lock(socket_path)
        self._bound_socket_identity: tuple[int, int] | None = None
        try:
            remove_stale_unix_socket(socket_path)
            super().__init__(str(socket_path), SafariTrimHandler, bind_and_activate=False)
            self.server_bind()
            socket_path.chmod(0o600)
            metadata = os.lstat(socket_path)
            if not stat.S_ISSOCK(metadata.st_mode) or metadata.st_uid != os.getuid():
                raise RuntimeError("created Unix control socket ownership is unsafe")
            self._bound_socket_identity = (metadata.st_dev, metadata.st_ino)
            self.server_activate()
        except Exception:
            try:
                if hasattr(self, "socket"):
                    socketserver.UnixStreamServer.server_close(self)
            finally:
                self._remove_owned_socket()
                self._release_socket_lock()
            raise

    def get_request(self) -> tuple[Any, Any]:
        request, client_address = super().get_request()
        request.settimeout(SOCKET_TIMEOUT_SECONDS)
        return request, client_address

    def process_request(self, request: Any, client_address: Any) -> None:
        if not self.request_slots.acquire(blocking=False):
            try:
                try:
                    request.sendall(
                        b"HTTP/1.0 503 Service Unavailable\r\n"
                        b"Connection: close\r\nContent-Length: 0\r\n\r\n"
                    )
                except OSError:
                    pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def _remove_owned_socket(self) -> None:
        identity = self._bound_socket_identity
        self._bound_socket_identity = None
        if identity is None:
            return
        try:
            metadata = os.lstat(self.socket_path)
            if (
                stat.S_ISSOCK(metadata.st_mode)
                and metadata.st_uid == os.getuid()
                and (metadata.st_dev, metadata.st_ino) == identity
            ):
                self.socket_path.unlink()
        except FileNotFoundError:
            pass

    def _release_socket_lock(self) -> None:
        descriptor = self._socket_lock_descriptor
        self._socket_lock_descriptor = -1
        if descriptor >= 0:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)

    def server_close(self) -> None:
        try:
            super().server_close()
        finally:
            self._remove_owned_socket()
            self._release_socket_lock()


class SafariTrimHandler(SafariControlHandler):
    server: SafariTrimServer

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self.send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        deadline = time.monotonic() + TRIM_REQUEST_DEADLINE_SECONDS
        if self.path not in {"/authorize", "/trim"}:
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        verified, reason, peer_pid = verified_enforcer_peer(
            self.connection,
            self.server.expected_program,
            self.server.launchd_label,
            deadline,
        )
        if not verified:
            self.server.logger.warning(
                "Unix Safari control peer denied path=%s pid=%s reason=%s",
                self.path,
                peer_pid,
                reason,
            )
            self.send_json(403, {
                "ok": False,
                "error": "enforcer peer verification required",
                "code": "peer_not_enforcer",
            })
            return
        if self.path == "/authorize":
            # Readiness attestation only: no request body, claim mutation,
            # AppleEvent, count, or trim operation is reachable from this path.
            self.send_json(200, {"ok": True, "authorized": True})
            return
        try:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                self.send_json(411, {"ok": False, "error": "content length required"})
                return
            try:
                content_length = int(raw_length)
            except ValueError:
                self.send_json(400, {"ok": False, "error": "invalid content length"})
                return
            if content_length < 0:
                self.send_json(400, {"ok": False, "error": "invalid content length"})
                return
            if content_length > MAX_REQUEST_BODY_BYTES:
                self.send_json(413, {"ok": False, "error": "request body too large"})
                return
            self.connection.settimeout(remaining_seconds(deadline, SOCKET_TIMEOUT_SECONDS))
            body = self.rfile.read(content_length)
            if len(body) != content_length:
                self.send_json(400, {"ok": False, "error": "incomplete request body"})
                return
            value = json.loads(body.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("request body must be an object")
            maximum = value.get("maximum", 8)
            if isinstance(maximum, bool) or not isinstance(maximum, int):
                raise ValueError("maximum must be an integer")
            result = trim_safari(maximum, deadline=deadline)
            self.send_json(200, {"ok": True, **result})
        except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
            self.send_json(400, {"ok": False, "error": str(exc)[-500:]})
        except socket.timeout as exc:
            self.send_control_error(
                OperationDeadlineExceeded("Safari trim request body deadline expired")
            )
        except Exception as exc:
            self.server.logger.warning(
                "Unix trim failed pid=%s error=%s: %s",
                peer_pid,
                type(exc).__name__,
                str(exc)[-500:],
            )
            self.send_control_error(exc)

    def log_message(self, format_string: str, *args: Any) -> None:
        self.server.logger.info("client=unix %s", format_string % args)


def configure_logging(path: Path) -> logging.Logger:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    logger = logging.getLogger("safari-control")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    logger.handlers.clear()
    handler = logging.handlers.RotatingFileHandler(
        path,
        maxBytes=1024 * 1024,
        backupCount=2,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5591)
    parser.add_argument(
        "--read-token-file",
        type=Path,
        help=f"read-only agent credential (default: sibling {READ_TOKEN_FILENAME})",
    )
    parser.add_argument(
        "--trim-socket",
        type=Path,
        help=f"enforcer-only Unix control socket (default: sibling {TRIM_SOCKET_FILENAME})",
    )
    parser.add_argument("--log-file", type=Path, required=True)
    args = parser.parse_args()
    logger = configure_logging(args.log_file)
    tcp_server: SafariControlServer | None = None
    trim_server: SafariTrimServer | None = None
    trim_thread: threading.Thread | None = None
    try:
        if args.host != "127.0.0.1":
            raise RuntimeError("Safari control broker must remain bound to 127.0.0.1")
        runtime_directory = Path(__file__).resolve().parent
        read_token_path = args.read_token_file or runtime_directory / READ_TOKEN_FILENAME
        trim_socket_path = args.trim_socket or runtime_directory / TRIM_SOCKET_FILENAME
        expected_enforcer = runtime_directory / "browser-enforcer.py"
        if trim_socket_path.parent.resolve(strict=True) != runtime_directory:
            raise RuntimeError("Safari trim socket must be inside the installed runtime directory")
        read_token = private_token(read_token_path, create=True)
        tcp_server = SafariControlServer(
            (args.host, args.port),
            read_token,
            logger,
        )
        trim_server = SafariTrimServer(
            trim_socket_path,
            expected_enforcer,
            logger,
        )
        trim_thread = threading.Thread(
            target=trim_server.serve_forever,
            kwargs={"poll_interval": 0.2},
            name="safari-trim-unix-control",
            daemon=True,
        )
        trim_thread.start()
        logger.info(
            "broker listening host=%s port=%d trim_socket=%s "
            "max_request_threads=%d max_trim_threads=%d socket_timeout=%ds",
            args.host,
            args.port,
            trim_socket_path,
            MAX_REQUEST_THREADS,
            MAX_TRIM_REQUEST_THREADS,
            SOCKET_TIMEOUT_SECONDS,
        )
        tcp_server.serve_forever(poll_interval=0.5)
        return 0
    except KeyboardInterrupt:
        logger.info("broker interrupted")
        return 0
    except Exception:
        logger.exception("broker stopped")
        return 1
    finally:
        if trim_server is not None:
            if trim_thread is not None and trim_thread.is_alive():
                trim_server.shutdown()
                trim_thread.join(timeout=2)
            trim_server.server_close()
        if tcp_server is not None:
            tcp_server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
