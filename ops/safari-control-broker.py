#!/usr/bin/env python3
"""Authenticated loopback Safari control for the browser enforcer.

This process must run inside the user's already-authorized tmux control plane.
The launchd enforcer calls it over loopback because launchd itself does not
reliably receive macOS AppleEvents/TCC permission for Safari.
"""

from __future__ import annotations

import argparse
import hmac
import json
import logging
import logging.handlers
import os
import stat
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


APPLE_EVENTS_LOCK = threading.RLock()
MAX_REQUEST_THREADS = 4
SOCKET_TIMEOUT_SECONDS = 5
MAX_REQUEST_BODY_BYTES = 4096


def run_osascript(script: str, timeout: float) -> str:
    result = subprocess.run(
        ["/usr/bin/osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=True,
    )
    return result.stdout.strip()


def safari_counts() -> dict[str, int]:
    with APPLE_EVENTS_LOCK:
        gui_script = 'tell application "System Events" to tell process "Safari" to count windows'
        windows = int(run_osascript(gui_script, timeout=3))
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
        window_text, tab_text = run_osascript(safari_script, timeout=6).split("|", 1)
        result = {"windows": int(window_text), "tabs": int(tab_text)}
        if result["windows"] < 0 or result["tabs"] < 0:
            raise ValueError(f"invalid Safari counts: {result}")
        return result


def trim_safari(maximum: int) -> dict[str, int]:
    with APPLE_EVENTS_LOCK:
        maximum = min(8, max(1, int(maximum)))
        current = safari_counts()
        if current["tabs"] <= maximum:
            return {**current, "closed": 0}
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
  return ((count of windows) as text) & "|" & (totalTabs as text) & "|" & (closedTabs as text)
end tell
"""
        window_text, tab_text, closed_text = run_osascript(script, timeout=15).split("|", 2)
        return {"windows": int(window_text), "tabs": int(tab_text), "closed": int(closed_text)}


class SafariControlServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 8

    def __init__(self, address: tuple[str, int], token: str, logger: logging.Logger):
        self.token = token
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

    def authorized(self) -> bool:
        supplied = self.headers.get("X-ACTP-Browser-Token", "")
        if hmac.compare_digest(supplied, self.server.token):
            return True
        self.send_json(401, {"ok": False, "error": "unauthorized"})
        return False

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if not self.authorized():
            return
        if self.path == "/health":
            self.send_json(200, {"ok": True, "service": "safari-control-broker"})
            return
        if self.path != "/counts":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            self.send_json(200, {"ok": True, "control_available": True, **safari_counts()})
        except Exception as exc:
            self.send_json(503, {"ok": False, "control_available": False, "error": str(exc)[-500:]})

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        if not self.authorized():
            return
        if self.path != "/trim":
            self.send_json(404, {"ok": False, "error": "not found"})
            return
        try:
            length = max(0, int(self.headers.get("Content-Length", "0")))
            if length > MAX_REQUEST_BODY_BYTES:
                self.send_json(413, {"ok": False, "error": "request body too large"})
                return
            value = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            result = trim_safari(int(value.get("maximum", 8)))
            self.send_json(200, {"ok": True, "control_available": True, **result})
        except Exception as exc:
            self.send_json(503, {"ok": False, "control_available": False, "error": str(exc)[-500:]})

    def log_message(self, format_string: str, *args: Any) -> None:
        self.server.logger.info("client=%s %s", self.client_address[0], format_string % args)


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
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--log-file", type=Path, required=True)
    args = parser.parse_args()
    logger = configure_logging(args.log_file)
    try:
        if args.host != "127.0.0.1":
            raise RuntimeError("Safari control broker must remain bound to 127.0.0.1")
        token_stat = os.lstat(args.token_file)
        if (
            not stat.S_ISREG(token_stat.st_mode)
            or token_stat.st_uid != os.getuid()
            or stat.S_IMODE(token_stat.st_mode) != 0o600
        ):
            raise RuntimeError("Safari control token ownership or mode is unsafe")
        token = args.token_file.read_text(encoding="utf-8").strip()
        if len(token) < 32:
            raise RuntimeError("Safari control token is missing or too short")
        server = SafariControlServer((args.host, args.port), token, logger)
        logger.info(
            "broker listening host=%s port=%d max_request_threads=%d socket_timeout=%ds",
            args.host,
            args.port,
            MAX_REQUEST_THREADS,
            SOCKET_TIMEOUT_SECONDS,
        )
        server.serve_forever(poll_interval=0.5)
        return 0
    except Exception:
        logger.exception("broker stopped")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
