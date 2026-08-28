#!/opt/homebrew/bin/python3
"""Pre-tool browser-singleton and damage-control gate for Codex and Claude."""

from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


MAX_INPUT_BYTES = 1024 * 1024
RUNTIME_DIR = Path.home() / "Library" / "Application Support" / "ACTP" / "browser-enforcer"
BROWSER_ENFORCER = RUNTIME_DIR / "browser-enforcer.py"
BROWSER_POLICY = RUNTIME_DIR / "browser-policy.json"
PATTERNS_FILE = Path.home() / ".claude" / "hooks" / "patterns.yaml"
AUDIT_LOG = RUNTIME_DIR / "command-hook-audit.jsonl"
TRUSTED_PYTHON = "/opt/homebrew/bin/python3"
BROWSER_MARKERS = re.compile(
    r"browser|chrome|chromium|cdp|9222|safari|safaridriver|webkit|playwright|"
    r"puppeteer|selenium|firefox|waterfox|geckodriver|brave|edge|arc|opera|"
    r"vivaldi|comet|dia|orion|duckduckgo|zen|librewolf|floorp|sigmaos|"
    r"sidekick|wavebox|polypane|ghost[ _-]?browser|headless|remote[ _-]?debugging|"
    r"control-token|trim-managed|safari-trim\.sock|/dev/tcp",
    re.IGNORECASE,
)
SHELL_TOOL_NAMES = frozenset({
    "bash", "shell", "terminal", "exec", "exec_command", "run_command",
    "functions.exec", "functions.exec_command", "computer.run_command",
})


SAFE_CONTENT_TOOLS = {
    "apply_patch",
    "update_plan",
    "update_goal",
    "get_goal",
    "create_goal",
    "mcp__supabase__apply_migration",
    "collaborationspawn_agent",
    "collaborationfollowup_task",
    "collaborationsend_message",
    "collaborationlist_agents",
    "collaborationwait_agent",
    "collaborationinterrupt_agent",
}


def shell_tool_name(tool_name: str) -> bool:
    lowered = tool_name.strip().lower()
    return lowered in SHELL_TOOL_NAMES or lowered.endswith("__exec_command")


def installed_client(explicit: str | None) -> str:
    if explicit in {"codex", "claude"}:
        return explicit
    lowered_parts = {part.lower() for part in Path(__file__).parts}
    return "claude" if ".claude" in lowered_parts else "codex"


def load_input(client: str) -> dict[str, Any]:
    # Codex may keep the pipe open and sends one compact line. Claude closes
    # stdin and may pretty-print the payload across multiple lines.
    raw = (
        sys.stdin.readline(MAX_INPUT_BYTES + 1)
        if client == "codex"
        else sys.stdin.read(MAX_INPUT_BYTES + 1)
    )
    if len(raw.encode("utf-8", errors="ignore")) > MAX_INPUT_BYTES:
        raise ValueError("hook input exceeds the one-megabyte boundary")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("hook input must be an object")
    return value


def extract_command(value: dict[str, Any]) -> tuple[str, str, str]:
    tool_name = str(value.get("tool_name", ""))
    tool_input = value.get("tool_input", {})
    if not isinstance(tool_input, dict):
        return tool_name, "", json.dumps(tool_input, separators=(",", ":"), default=str)
    command = tool_input.get("command", tool_input.get("cmd", ""))
    if command is None:
        command = ""
    if not isinstance(command, str):
        raise ValueError("shell command must be a string")
    return tool_name, command, json.dumps(tool_input, separators=(",", ":"), default=str)


def browser_policy_denial(command: str) -> str | None:
    if not command:
        return None
    if not BROWSER_ENFORCER.is_file() or not BROWSER_POLICY.is_file():
        return "Browser singleton policy runtime is unavailable; shell execution fails closed"
    try:
        result = subprocess.run(
            [
                TRUSTED_PYTHON,
                str(BROWSER_ENFORCER),
                "--policy",
                str(BROWSER_POLICY),
                "check-command",
                command,
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            env={
                "HOME": str(Path.home()),
                "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                "PYTHONNOUSERSITE": "1",
                "PYTHONSAFEPATH": "1",
            },
        )
    except (OSError, subprocess.SubprocessError):
        return "Browser singleton policy check is unavailable; shell execution fails closed"
    if result.returncode == 42:
        return result.stdout.strip()[:1000] or "Browser singleton policy denied this command"
    if result.returncode != 0:
        return "Browser singleton policy check failed; shell execution fails closed"
    return None


def leased_tool_policy_denial(tool_name: str) -> str | None:
    """Ask the installed enforcer to attest an exact leased MCP tool/config."""
    if not BROWSER_ENFORCER.is_file() or not BROWSER_POLICY.is_file():
        return "Browser singleton policy runtime is unavailable; browser tools fail closed"
    try:
        result = subprocess.run(
            [
                TRUSTED_PYTHON,
                str(BROWSER_ENFORCER),
                "--policy",
                str(BROWSER_POLICY),
                "check-tool",
                tool_name,
            ],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            env={
                "HOME": str(Path.home()),
                "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                "PYTHONNOUSERSITE": "1",
                "PYTHONSAFEPATH": "1",
            },
        )
    except (OSError, subprocess.SubprocessError):
        return "Browser singleton policy check is unavailable; browser tools fail closed"
    if result.returncode == 0:
        return None
    if result.returncode == 42:
        return result.stdout.strip()[:1000] or "Browser singleton policy denied this tool"
    return "Browser singleton policy check failed; browser tools fail closed"


def load_damage_patterns() -> dict[str, list[dict[str, str]]]:
    if not PATTERNS_FILE.is_file():
        return {"blocked": [], "risky": []}
    try:
        import yaml  # type: ignore[import-not-found]

        value = yaml.safe_load(PATTERNS_FILE.read_text(encoding="utf-8"))
    except ImportError:
        # The launch hook deliberately runs under Apple's dependency-free
        # Python.  The installed patterns file uses a tiny, constrained YAML
        # subset; parse only its two lists and quoted scalar fields rather
        # than falling back to eval or silently dropping damage control.
        try:
            parsed: dict[str, list[dict[str, str]]] = {"blocked": [], "risky": []}
            section: str | None = None
            entry: dict[str, str] | None = None
            for raw_line in PATTERNS_FILE.read_text(encoding="utf-8").splitlines():
                stripped = raw_line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if stripped in {"blocked:", "risky:"}:
                    section = stripped[:-1]
                    entry = None
                    continue
                match = re.fullmatch(r"(?:-\s*)?(pattern|reason):\s*(.+)", stripped)
                if section is None or match is None:
                    raise ValueError("unsupported damage-pattern YAML")
                key, encoded = match.groups()
                value = ast.literal_eval(encoded)
                if not isinstance(value, str):
                    raise ValueError("damage-pattern fields must be strings")
                if stripped.startswith("-"):
                    entry = {}
                    parsed[section].append(entry)
                if entry is None:
                    raise ValueError("damage-pattern field precedes its list item")
                entry[key] = value
            if any(set(item) != {"pattern", "reason"} for items in parsed.values() for item in items):
                raise ValueError("damage-pattern item is incomplete")
            value = parsed
        except (OSError, ValueError, SyntaxError):
            return {"blocked": [], "risky": []}
    except (OSError, ValueError):
        return {"blocked": [], "risky": []}
    return value if isinstance(value, dict) else {"blocked": [], "risky": []}


def damage_decision(command: str) -> tuple[str, str]:
    patterns = load_damage_patterns()
    for status in ("blocked", "risky"):
        entries = patterns.get(status, [])
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            pattern = entry.get("pattern")
            if isinstance(pattern, str) and re.search(pattern, command, re.IGNORECASE):
                return status, str(entry.get("reason", "damage-control pattern matched"))[:1000]
    return "safe", ""


def audit(status: str, tool_name: str, command: str, reason: str) -> None:
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "tool": tool_name[:120],
            "command_sha256": hashlib.sha256(command.encode("utf-8")).hexdigest(),
            "reason": reason[:500],
        }
        descriptor = os.open(AUDIT_LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            os.write(descriptor, (json.dumps(payload, separators=(",", ":")) + "\n").encode("utf-8"))
        finally:
            os.close(descriptor)
    except OSError:
        pass


def deny(client: str, reason: str) -> None:
    if client == "claude":
        print(json.dumps({"decision": "block", "reason": f"Browser enforcement: {reason}"}))
        raise SystemExit(1)
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"Browser enforcement: {reason}",
        }
    }))
    raise SystemExit(0)


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--client", choices=("codex", "claude"))
    args, _ = parser.parse_known_args()
    client = installed_client(args.client)
    try:
        value = load_input(client)
        tool_name, command, serialized_input = extract_command(value)
        safe_content_tool = tool_name.strip().lower() in SAFE_CONTENT_TOOLS
        if safe_content_tool:
            serialized_input = ""
    except (ValueError, json.JSONDecodeError) as exc:
        deny(client, f"invalid hook input ({type(exc).__name__})")

    browser_tool_surface = bool(
        BROWSER_MARKERS.search(tool_name)
        or (not shell_tool_name(tool_name) and BROWSER_MARKERS.search(serialized_input))
    )
    if browser_tool_surface:
        tool_reason = leased_tool_policy_denial(tool_name)
        if tool_reason:
            audit("blocked", tool_name, serialized_input, tool_reason)
            deny(client, tool_reason)
        audit("allowed", tool_name, serialized_input, "attested leased browser tool")
        return 0

    if not command:
        return 0

    reason = None if safe_content_tool else browser_policy_denial(command)
    status, damage_reason = ("blocked", reason) if reason else damage_decision(command)
    if status == "blocked":
        audit(status, tool_name, command, damage_reason)
        deny(client, damage_reason)
    if status == "risky":
        audit(status, tool_name, command, damage_reason)
        if client == "claude":
            print(json.dumps({"decision": "ask", "message": f"Risky command: {damage_reason}"}))
            return 2
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": f"Risky command: {damage_reason}",
            }
        }))
    elif BROWSER_MARKERS.search(command):
        audit("allowed", tool_name, command, "reviewed browser-related inspection")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
