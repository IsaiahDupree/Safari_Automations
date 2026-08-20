#!/usr/bin/env python3
"""Real loopback regression checks for the Safari control broker transport."""

from __future__ import annotations

import importlib.util
import logging
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


BROKER_SOURCE = Path(__file__).with_name("safari-control-broker.py")


def load_broker():
    spec = importlib.util.spec_from_file_location("safari_control_broker", BROKER_SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load broker source: {BROKER_SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    broker = load_broker()
    token = secrets.token_urlsafe(48)
    logger = logging.getLogger("safari-control-broker-smoke")
    logger.handlers[:] = [logging.NullHandler()]
    server = broker.SafariControlServer(("127.0.0.1", 0), token, logger)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address

    try:
        try:
            urllib.request.urlopen(f"http://{host}:{port}/health", timeout=2)
            raise AssertionError("missing token was accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401, exc.code

        slow_clients = [
            socket.create_connection((host, port), timeout=2)
            for _ in range(broker.MAX_REQUEST_THREADS)
        ]
        for client in slow_clients:
            client.sendall(b"GET /health HTTP/1.0\r\n")
        deadline = time.time() + 2
        while server.request_slots._value != 0 and time.time() < deadline:
            time.sleep(0.02)
        assert server.request_slots._value == 0, "request concurrency slots did not fill"

        overflow = socket.create_connection((host, port), timeout=2)
        overflow.sendall(
            f"GET /health HTTP/1.0\r\nHost: {host}\r\n"
            f"X-ACTP-Browser-Token: {token}\r\n\r\n".encode()
        )
        response = overflow.recv(1024)
        overflow.close()
        assert b"503 Service Unavailable" in response, response
        for client in slow_clients:
            client.close()

        deadline = time.time() + 2
        while server.request_slots._value != broker.MAX_REQUEST_THREADS and time.time() < deadline:
            time.sleep(0.02)
        assert server.request_slots._value == broker.MAX_REQUEST_THREADS, "request slots did not recover"

        health = urllib.request.Request(
            f"http://{host}:{port}/health",
            headers={"X-ACTP-Browser-Token": token},
        )
        with urllib.request.urlopen(health, timeout=2) as response:
            assert response.status == 200

        oversized = urllib.request.Request(
            f"http://{host}:{port}/trim",
            data=b"",
            headers={
                "X-ACTP-Browser-Token": token,
                "Content-Type": "application/json",
                "Content-Length": str(broker.MAX_REQUEST_BODY_BYTES + 1),
            },
            method="POST",
        )
        try:
            urllib.request.urlopen(oversized, timeout=2)
            raise AssertionError("oversized request body was accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == 413, exc.code

        print("safari-control broker transport smoke: PASS")
        return 0
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
