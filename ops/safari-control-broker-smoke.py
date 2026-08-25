#!/usr/bin/env python3
"""Adversarial, non-destructive checks for the Safari control broker."""

from __future__ import annotations

import importlib.util
import inspect
import json
import logging
import os
import secrets
import socket
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path


BROKER_SOURCE = Path(__file__).with_name("safari-control-broker.py")
ROOT = BROKER_SOURCE.parent.parent


def load_broker():
    spec = importlib.util.spec_from_file_location("safari_control_broker", BROKER_SOURCE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load broker source: {BROKER_SOURCE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def marker(number: int) -> str:
    return f"__ACTP_SAFARI_AGENT_TAB__:00000000-0000-4000-8000-{number:012x}"


def claim(
    *,
    agent_id: str,
    window_id: int,
    tab_index: int,
    now: float,
    heartbeat_age: float = 0,
    pid: int | None = None,
    ownership_marker: str | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "agentId": agent_id,
        "service": "smoke",
        "port": 3999,
        "urlPattern": "example.test",
        "windowIndex": 2,
        "windowId": window_id,
        "tabIndex": tab_index,
        "tabUrl": "https://same.example.test/",
        "pid": os.getpid() if pid is None else pid,
        "claimedAt": int((now - 10) * 1000),
        "heartbeat": int((now - heartbeat_age) * 1000),
        "agentOwned": True,
    }
    if ownership_marker is not None:
        value["ownershipMarker"] = ownership_marker
    return value


def ownership(*, marker_value: str, window_id: int, number: int = 1) -> dict[str, object]:
    return {
        "marker": marker_value,
        "windowId": window_id,
        "createdAt": 1_700_000_000_000 + number,
        "agentId": f"owner-{number}",
        "service": "smoke",
        "pid": os.getpid(),
    }


def write_private_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding="utf-8")
    path.chmod(0o600)


def http_json(
    url: str,
    token: str | None = None,
    *,
    data: bytes | None = None,
    headers: dict[str, str] | None = None,
    method: str | None = None,
) -> tuple[int, dict[str, object]]:
    request_headers = dict(headers or {})
    if token is not None:
        request_headers["X-ACTP-Browser-Token"] = token
    request = urllib.request.Request(
        url,
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        payload = exc.read()
        return exc.code, json.loads(payload.decode("utf-8")) if payload else {}


def unix_http_json(
    socket_path: Path,
    path: str,
    value: dict[str, object],
) -> tuple[int, dict[str, object]]:
    body = json.dumps(value, separators=(",", ":")).encode("utf-8")
    request = (
        f"POST {path} HTTP/1.0\r\n"
        "Host: localhost\r\n"
        "Content-Type: application/json\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii") + body
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.settimeout(4)
    try:
        client.connect(str(socket_path))
        client.sendall(request)
        chunks: list[bytes] = []
        while True:
            chunk = client.recv(8192)
            if not chunk:
                break
            chunks.append(chunk)
    finally:
        client.close()
    response = b"".join(chunks)
    headers, payload = response.split(b"\r\n\r\n", 1)
    status = int(headers.splitlines()[0].split()[1])
    return status, json.loads(payload.decode("utf-8")) if payload else {}


def test_ownership_and_identity_contract(broker) -> None:
    now = time.time()
    live_claim = claim(
        agent_id="live-agent",
        window_id=9101,
        tab_index=2,
        now=now,
        ownership_marker=marker(1),
    )
    stale_claim = claim(
        agent_id="stale-agent",
        window_id=9202,
        tab_index=4,
        now=now,
        heartbeat_age=broker.CLAIM_TTL_SECONDS + 1,
        ownership_marker=marker(3),
    )
    inspected = broker.parse_agent_owned_tabs(
        f"2||9101||1||{marker(1)}\n"
        f"2||9101||3||{marker(2)}\n"
        f"2||9202||4||{marker(3)}\n"
        f"1||9303||2||{marker(4)}\n"
        f"2||9404||2||{marker(5)}\n"
    )
    ledger = [
        ownership(marker_value=marker(1), window_id=9101, number=1),
        ownership(marker_value=marker(2), window_id=9101, number=2),
        ownership(marker_value=marker(3), window_id=9202, number=3),
        ownership(marker_value=marker(4), window_id=9303, number=4),
        # marker(5) deliberately has no ledger entry: a human forged the
        # public marker format and must remain protected.
    ]

    idle, protected = broker.idle_agent_owned_candidates(
        inspected,
        [live_claim, stale_claim],
        ledger,
        now=now,
    )
    # Any live operation protects its whole stable window because closing an
    # earlier idle tab would shift the live tab ordinal. Expired claims no
    # longer block cleanup. Current Window 1 and forged markers stay protected.
    assert protected == 4
    assert [(item["windowId"], item["marker"]) for item in idle] == [
        (9202, marker(3)),
    ]

    shifted = broker.apply_closed_tab_identities(
        [
            live_claim,
            claim(agent_id="later", window_id=9101, tab_index=5, now=now),
            stale_claim,
        ],
        [(9101, 3)],
    )
    by_id = {item["agentId"]: item for item in shifted}
    assert by_id["live-agent"]["tabIndex"] == 2
    assert by_id["later"]["tabIndex"] == 4
    assert by_id["stale-agent"]["tabIndex"] == 4

    close_candidate = {
        "windowIndex": 2,
        "windowId": 9101,
        # This deliberately wrong/mutable index and same-URL bait must not be
        # embedded in the close operation.
        "tabIndex": 999,
        "marker": marker(1),
        "expectedUrl": "https://same.example.test/",
    }
    close_script = broker.close_claimed_agent_tab_script(close_candidate)
    assert "first window whose id is 9101" in close_script
    assert marker(1) in close_script
    assert "repeat with tabNumber" in close_script
    assert "close matchingTab" in close_script
    assert "tab 999" not in close_script
    assert "same.example.test" not in close_script
    assert "URL of tab" not in close_script
    assert 'stableWindowIndex is 1 then return "human-window-protected"' in close_script

    try:
        broker.close_claimed_agent_tab_script({**close_candidate, "windowIndex": 1})
        raise AssertionError("current human Window 1 was eligible for close")
    except broker.OwnershipStateError:
        pass

    try:
        broker.parse_agent_owned_tabs(
            f"2||9101||1||{marker(1)}\n2||9999||2||{marker(1)}\n"
        )
        raise AssertionError("cross-window duplicated ownership marker was accepted")
    except broker.OwnershipStateError:
        pass
    for invalid in (
        "2||9101||1||__ACTP_SAFARI_AGENT_TAB__:not-a-uuid",
        "mutable-window-index||9101||1||" + marker(5),
        "__ACTP_OWNERSHIP_INSPECTION_ERROR__",
    ):
        try:
            broker.parse_agent_owned_tabs(invalid)
            raise AssertionError(f"invalid ownership row was accepted: {invalid}")
        except broker.OwnershipStateError:
            pass

    # A copied real marker in the wrong stable window is ambiguous and blocks
    # the whole destructive operation instead of authorizing either page.
    wrong_window = broker.parse_agent_owned_tabs(f"2||9999||1||{marker(2)}")
    try:
        broker.idle_agent_owned_candidates(wrong_window, [], ledger, now=now)
        raise AssertionError("ledger-bound marker was accepted in a different stable window")
    except broker.OwnershipStateError:
        pass


def test_claim_registry_fail_closed_and_lock_race(broker) -> None:
    now = time.time()
    with tempfile.TemporaryDirectory(prefix="safari-broker-claims-") as temporary:
        directory = Path(temporary)
        claims_path = directory / "claims.json"
        lock_path = directory / "claims.lock"
        ownership_path = directory / "ownership.json"
        seeded = [claim(agent_id="seed", window_id=9303, tab_index=1, now=now)]
        write_private_json(claims_path, seeded)
        assert broker.load_claims_strict(claims_path, now=now) == seeded

        claims_path.write_text("{corrupt", encoding="utf-8")
        claims_path.chmod(0o600)
        try:
            broker.load_claims_strict(claims_path, now=now)
            raise AssertionError("corrupt claim registry was treated as no claims")
        except broker.OwnershipStateError:
            pass
        claims_path.unlink()
        try:
            broker.load_claims_strict(claims_path, now=now)
            raise AssertionError("missing claim registry was treated as no claims")
        except broker.OwnershipStateError:
            pass

        write_private_json(claims_path, seeded)
        claims_path.chmod(0o644)
        try:
            broker.load_claims_strict(claims_path, now=now)
            raise AssertionError("world-readable claim registry was accepted")
        except broker.OwnershipStateError:
            pass
        write_private_json(claims_path, seeded)

        writer_started = threading.Event()
        writer_acquired = threading.Event()
        writer_finished = threading.Event()

        def claim_writer() -> None:
            writer_started.set()
            with broker.claims_lock(lock_path, timeout=2):
                writer_acquired.set()
                latest = broker.load_claims_strict(claims_path)
                latest.append(claim(
                    agent_id="racing-live-claim",
                    window_id=9303,
                    tab_index=2,
                    now=time.time(),
                ))
                broker.atomic_write_claims(latest, claims_path)
            writer_finished.set()

        with broker.claims_lock(lock_path):
            # This is the same exclusion used by trim. A claimant cannot alter
            # the ledger between its fresh read and close/accounting.
            assert broker.load_claims_strict(claims_path)
            thread = threading.Thread(target=claim_writer, daemon=True)
            thread.start()
            assert writer_started.wait(1)
            time.sleep(0.1)
            assert not writer_acquired.is_set(), "claim writer entered the destructive lock window"
        assert writer_finished.wait(2)
        thread.join(timeout=1)
        persisted = broker.load_claims_strict(claims_path)
        assert {item["agentId"] for item in persisted} == {"seed", "racing-live-claim"}
        assert stat.S_IMODE(claims_path.stat().st_mode) == 0o600
        assert stat.S_IMODE(lock_path.stat().st_mode) == 0o600

        durable = [ownership(marker_value=marker(21), window_id=9303, number=21)]
        broker.atomic_write_ownership(durable, ownership_path)
        assert broker.load_ownership_ledger_strict(ownership_path) == durable
        assert stat.S_IMODE(ownership_path.stat().st_mode) == 0o600
        assert broker.load_ownership_ledger_strict(directory / "missing-ownership.json") == []
        write_private_json(
            ownership_path,
            {"version": broker.OWNERSHIP_SCHEMA_VERSION, "entries": durable + durable},
        )
        try:
            broker.load_ownership_ledger_strict(ownership_path)
            raise AssertionError("duplicate durable ownership marker was accepted")
        except broker.OwnershipStateError:
            pass

        # Both registries mutate under the exact same advisory lock. A racing
        # ownership writer cannot interleave with a claims admission/trim cycle.
        write_private_json(
            ownership_path,
            {"version": broker.OWNERSHIP_SCHEMA_VERSION, "entries": durable},
        )
        ownership_acquired = threading.Event()

        def ownership_writer() -> None:
            with broker.claims_lock(lock_path, timeout=2):
                ownership_acquired.set()
                latest = broker.load_ownership_ledger_strict(ownership_path)
                latest.append(ownership(marker_value=marker(22), window_id=9303, number=22))
                broker.atomic_write_ownership(latest, ownership_path)

        with broker.claims_lock(lock_path):
            ownership_thread = threading.Thread(target=ownership_writer, daemon=True)
            ownership_thread.start()
            time.sleep(0.1)
            assert not ownership_acquired.is_set(), "ownership writer bypassed the shared lock"
        ownership_thread.join(timeout=2)
        assert ownership_acquired.is_set()
        assert len(broker.load_ownership_ledger_strict(ownership_path)) == 2

    # Guard against a future refactor narrowing the lock to just the read or
    # accounting write. These calls must remain lexically inside the shared
    # claims-lock block as well as APPLE_EVENTS_LOCK.
    trim_source = inspect.getsource(broker.trim_safari)
    lock_offset = trim_source.index("with claims_lock(lock_path, deadline=deadline):")
    for required in (
        "load_claims_strict(claims_path",
        "load_ownership_ledger_strict(ownership_path)",
        "human_presence(deadline)",
        "inspect_agent_owned_tabs(deadline)",
        "close_claimed_agent_tab(candidate, deadline)",
        "atomic_write_claims(claims, claims_path, deadline)",
        "atomic_write_ownership(ownership, ownership_path, deadline)",
    ):
        assert trim_source.index(required) > lock_offset, required

    assert broker.trim_close_budget(0) == 0
    assert broker.trim_close_budget(1) == 1
    assert broker.trim_close_budget(99) == broker.MAX_TRIM_CLOSES_PER_REQUEST == 2
    try:
        broker.remaining_seconds(time.monotonic() - 0.001, 10)
        raise AssertionError("expired absolute operation deadline was accepted")
    except broker.OperationDeadlineExceeded:
        pass


def test_human_presence_contract(broker) -> None:
    actual = broker.human_presence()
    assert actual["schema_version"] == broker.PRESENCE_SCHEMA_VERSION
    assert isinstance(actual["signals_available"], bool)
    assert isinstance(actual["human_active"], bool)
    assert isinstance(actual["restart_maintenance_allowed"], bool)
    if not actual["signals_available"]:
        assert actual["fail_closed"] is True
        assert actual["human_active"] is True
        assert broker.trim_presence_allowed(actual) is False

    safe = {
        "schema_version": broker.PRESENCE_SCHEMA_VERSION,
        "signals_available": True,
        "fail_closed": False,
        "human_active": False,
        "browser_foreground": False,
        "recent_input": False,
        "restart_maintenance_allowed": True,
        "input_idle_seconds": broker.RESTART_IDLE_SECONDS,
    }
    assert broker.trim_presence_allowed(safe) is True
    for unsafe in (
        {**safe, "signals_available": False, "fail_closed": True},
        {**safe, "human_active": True},
        {**safe, "browser_foreground": True},
        {**safe, "recent_input": True},
        {**safe, "input_idle_seconds": broker.RESTART_IDLE_SECONDS - 0.001},
        {**safe, "restart_maintenance_allowed": False},
        {**safe, "schema_version": 999},
        None,
    ):
        assert broker.trim_presence_allowed(unsafe) is False, unsafe


def test_token_scope_and_transport(broker) -> None:
    read_token = secrets.token_urlsafe(48)
    legacy_read_token = secrets.token_urlsafe(48)
    logger = logging.getLogger("safari-control-broker-smoke")
    logger.handlers[:] = [logging.NullHandler()]
    server = broker.SafariControlServer(
        ("127.0.0.1", 0),
        read_token,
        logger,
        legacy_read_token,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    origin = f"http://{host}:{port}"

    try:
        status, value = http_json(f"{origin}/health")
        assert (status, value["code"]) == (401, "authorization_required")

        for token in (read_token, legacy_read_token):
            status, value = http_json(f"{origin}/health", token)
            assert status == 200 and value["ok"] is True

        status, value = http_json(f"{origin}/presence", read_token)
        assert status == 200 and value["ok"] is True
        assert value["schema_version"] == broker.PRESENCE_SCHEMA_VERSION

        # Counts may be unavailable outside an AppleEvents-authorized tmux, but
        # the read credential must reach the read-only contract rather than an
        # authentication failure.
        status, value = http_json(f"{origin}/counts", read_token)
        assert status in (200, 503)
        assert status != 401 and status != 403

        # TCP never exposes destructive control. Authentication, legacy read
        # credentials, and oversized bodies cannot reach a trim scope gate.
        for route in ("/authorize", "/trim"):
            for token in (None, read_token, legacy_read_token, "wrong-token"):
                status, value = http_json(
                    f"{origin}{route}",
                    token,
                    data=b'{"maximum":8}',
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                assert (status, value["code"]) == (404, "no_tcp_control")

        # Real request threads queue behind a separately-owned AppleEvent lock.
        # They must reject quickly, restore their request slots, and never run
        # later after the client-visible request has expired.
        lock_ready = threading.Event()
        release_lock = threading.Event()

        def hold_apple_events_lane() -> None:
            with broker.APPLE_EVENTS_LOCK:
                lock_ready.set()
                release_lock.wait(2)

        lock_holder = threading.Thread(target=hold_apple_events_lane, daemon=True)
        lock_holder.start()
        assert lock_ready.wait(1)
        queued_results: list[tuple[int, dict[str, object]]] = []
        queued_threads = [
            threading.Thread(
                target=lambda: queued_results.append(http_json(f"{origin}/counts", read_token)),
                daemon=True,
            )
            for _ in range(broker.MAX_REQUEST_THREADS)
        ]
        queued_started = time.monotonic()
        for queued_thread in queued_threads:
            queued_thread.start()
        for queued_thread in queued_threads:
            queued_thread.join(timeout=2)
        queued_elapsed = time.monotonic() - queued_started
        assert len(queued_results) == broker.MAX_REQUEST_THREADS
        assert queued_elapsed < 1.5, queued_elapsed
        assert all(
            status == 503 and value.get("code") == "control_lane_busy"
            for status, value in queued_results
        ), queued_results

        release_lock.set()
        lock_holder.join(timeout=1)
        deadline = time.time() + 2
        while server.request_slots._value != broker.MAX_REQUEST_THREADS and time.time() < deadline:
            time.sleep(0.02)
        assert server.request_slots._value == broker.MAX_REQUEST_THREADS

        slow_clients = [
            socket.create_connection((host, port), timeout=2)
            for _ in range(broker.MAX_REQUEST_THREADS)
        ]
        for client in slow_clients:
            client.sendall(b"GET /health HTTP/1.0\r\n")
        deadline = time.time() + 2
        while server.request_slots._value != 0 and time.time() < deadline:
            time.sleep(0.02)
        assert server.request_slots._value == 0
        overflow = socket.create_connection((host, port), timeout=2)
        overflow.sendall(
            f"GET /health HTTP/1.0\r\nHost: {host}\r\n"
            f"X-ACTP-Browser-Token: {read_token}\r\n\r\n".encode()
        )
        response = overflow.recv(1024)
        overflow.close()
        assert b"503 Service Unavailable" in response
        for client in slow_clients:
            client.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    handler_source = inspect.getsource(broker.SafariControlHandler.do_POST)
    assert "no_tcp_control" in handler_source
    assert "trim_safari" not in handler_source

    with tempfile.TemporaryDirectory(prefix="safari-broker-unix-") as temporary:
        directory = Path(temporary)
        directory.chmod(0o700)
        socket_path = directory / broker.TRIM_SOCKET_FILENAME
        expected_program = directory / "browser-enforcer.py"
        expected_program.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
        expected_program.chmod(0o700)
        expected_policy = directory / "browser-policy.json"
        expected_policy.write_text("{}\n", encoding="utf-8")
        assert broker.canonical_enforcer_argv([
            str(broker.CANONICAL_ENFORCER_PYTHON),
            str(expected_program),
            "--policy",
            str(expected_policy),
            "daemon",
        ], expected_program)
        assert broker.canonical_enforcer_argv([
            str(broker.CANONICAL_ENFORCER_PYTHON_APP),
            str(expected_program),
            "--policy",
            str(expected_policy),
            "daemon",
        ], expected_program)
        assert not broker.canonical_enforcer_argv([
            "/usr/bin/python3",
            str(expected_program),
            "--policy",
            str(expected_policy),
            "daemon",
        ], expected_program)
        unix_server = broker.SafariTrimServer(socket_path, expected_program, logger)
        unix_thread = threading.Thread(target=unix_server.serve_forever, daemon=True)
        unix_thread.start()
        try:
            assert stat.S_ISSOCK(socket_path.stat().st_mode)
            assert stat.S_IMODE(socket_path.stat().st_mode) == 0o600
            status, value = unix_http_json(socket_path, "/trim", {"maximum": 8})
            assert (status, value["code"]) == (403, "peer_not_enforcer")
            status, value = unix_http_json(socket_path, "/authorize", {})
            assert (status, value["code"]) == (403, "peer_not_enforcer")

            original_verifier = broker.verified_enforcer_peer
            broker.verified_enforcer_peer = lambda *_args, **_kwargs: (True, "verified", os.getpid())
            try:
                status, value = unix_http_json(socket_path, "/authorize", {})
                assert status == 200 and value == {"ok": True, "authorized": True}
            finally:
                broker.verified_enforcer_peer = original_verifier

            # Even another same-UID process cannot start a competing broker or
            # inherit destructive authority from mode-0600 filesystem access.
            try:
                broker.SafariTrimServer(socket_path, expected_program, logger)
                raise AssertionError("competing Unix trim broker acquired the socket")
            except RuntimeError:
                pass
        finally:
            unix_server.shutdown()
            unix_server.server_close()
            unix_thread.join(timeout=2)
        assert not socket_path.exists()

    trim_handler_source = inspect.getsource(broker.SafariTrimHandler.do_POST)
    assert trim_handler_source.index("verified_enforcer_peer(") < trim_handler_source.index(
        "self.rfile.read(content_length)"
    )
    assert trim_handler_source.index("verified_enforcer_peer(") < trim_handler_source.index(
        "trim_safari(maximum"
    )
    authorize_branch = trim_handler_source[trim_handler_source.index('if self.path == "/authorize"'):]
    assert authorize_branch.index("self.send_json(200") < authorize_branch.index("trim_safari(maximum")
    assert broker.darwin_process_argv(os.getpid())


def test_token_files_and_lane_client_scope(broker) -> None:
    with tempfile.TemporaryDirectory(prefix="safari-broker-token-") as temporary:
        directory = Path(temporary)
        read_path = directory / broker.READ_TOKEN_FILENAME
        read_token = broker.private_token(read_path, create=True)
        assert len(read_token) >= 32
        assert stat.S_IMODE(read_path.stat().st_mode) == 0o600

    for relative in (
        "packages/shared/safari-lane-client.ts",
        "packages/shared/safari-lane-client.js",
    ):
        source = (ROOT / relative).read_text(encoding="utf-8")
        assert "safari-presence.token" in source
        assert "SAFARI_PRESENCE_TOKEN_FILE" in source
        assert "safari-control.token" not in source
        assert "SAFARI_CONTROL_TOKEN_FILE" not in source
        assert "/trim" not in source

    broker_source = BROKER_SOURCE.read_text(encoding="utf-8")
    assert '"--token-file"' not in broker_source
    assert '"--trim-token-file"' not in broker_source
    assert "trim_token" not in broker_source


def main() -> int:
    broker = load_broker()
    test_ownership_and_identity_contract(broker)
    test_claim_registry_fail_closed_and_lock_race(broker)
    test_human_presence_contract(broker)
    test_token_scope_and_transport(broker)
    test_token_files_and_lane_client_scope(broker)
    print("safari-control broker adversarial smoke: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
