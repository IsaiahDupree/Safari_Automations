from __future__ import annotations

import builtins
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("browser_command_hook", ROOT / "ops" / "browser-command-hook.py")
assert SPEC and SPEC.loader
HOOK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HOOK)


class BrowserCommandHookTests(unittest.TestCase):
    def test_policy_runtime_failure_blocks_every_shell_command(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(HOOK, "BROWSER_ENFORCER", Path(directory) / "missing.py"), mock.patch.object(
                HOOK, "BROWSER_POLICY", Path(directory) / "missing.json"
            ):
                self.assertIsNotNone(HOOK.browser_policy_denial("echo safe"))

    def test_dependency_free_damage_pattern_parser(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            patterns = Path(directory) / "patterns.yaml"
            patterns.write_text(
                'blocked:\n  - pattern: "UNSAFE_FLAG"\n    reason: "blocked"\n'
                'risky:\n  - pattern: "RISKY_FLAG"\n    reason: "risky"\n',
                encoding="utf-8",
            )
            real_import = builtins.__import__

            def import_without_yaml(name, *args, **kwargs):
                if name == "yaml":
                    raise ImportError("test dependency-free path")
                return real_import(name, *args, **kwargs)

            with mock.patch.object(HOOK, "PATTERNS_FILE", patterns), mock.patch(
                "builtins.__import__", side_effect=import_without_yaml
            ):
                loaded = HOOK.load_damage_patterns()
            self.assertEqual(loaded["blocked"][0]["pattern"], "UNSAFE_FLAG")

    def test_direct_tool_denial_and_hash_only_audit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            command = "secret-command-with-private-payload"
            with mock.patch.object(HOOK, "AUDIT_LOG", audit_path):
                HOOK.audit("blocked", "computer_tool", command, "direct tool denied")
            line = audit_path.read_text(encoding="utf-8")
            self.assertNotIn(command, line)
            record = json.loads(line)
            self.assertEqual(len(record["command_sha256"]), 64)

            for tool_name in (
                "mcp__chrome-bridge__claim",
                "mcp__chrome_bridge__chrome_claim_profile",
                "mcp__safari-instagram-dm__instagram_status",
                "mcp__safari_instagram_dm__instagram_status",
            ):
                stdout = io.StringIO()
                payload = {
                    "tool_name": tool_name,
                    "tool_input": {
                        "agent_id": "test-agent",
                        **({"command": "navigate"} if tool_name.endswith("instagram_status") else {}),
                    },
                }
                with self.subTest(tool_name=tool_name), mock.patch(
                    "sys.argv", ["hook", "--client", "codex"]
                ), mock.patch(
                    "sys.stdin", io.StringIO(json.dumps(payload) + "\n")
                ), mock.patch("sys.stdout", stdout), mock.patch.object(
                    HOOK, "AUDIT_LOG", audit_path
                ), mock.patch.object(HOOK, "leased_tool_policy_denial", return_value=None):
                    self.assertEqual(HOOK.main(), 0)
                    self.assertEqual(stdout.getvalue(), "")

            payload = {"tool_name": "computer_browser", "tool_input": {"url": "https://example.com"}}
            stdout = io.StringIO()
            with mock.patch("sys.argv", ["hook", "--client", "codex"]), mock.patch(
                "sys.stdin", io.StringIO(json.dumps(payload) + "\n")
            ), mock.patch("sys.stdout", stdout), mock.patch.object(
                HOOK, "AUDIT_LOG", audit_path
            ), mock.patch.object(
                HOOK, "leased_tool_policy_denial", return_value="direct tool denied"
            ):
                with self.assertRaises(SystemExit) as raised:
                    HOOK.main()
            self.assertEqual(raised.exception.code, 0)
            decision = json.loads(stdout.getvalue())
            self.assertEqual(decision["hookSpecificOutput"]["permissionDecision"], "deny")

            payload = {"tool_name": "computer_browser", "tool_input": {"command": "click"}}
            stdout = io.StringIO()
            with mock.patch("sys.argv", ["hook", "--client", "codex"]), mock.patch(
                "sys.stdin", io.StringIO(json.dumps(payload) + "\n")
            ), mock.patch("sys.stdout", stdout), mock.patch.object(
                HOOK, "AUDIT_LOG", audit_path
            ), mock.patch.object(
                HOOK, "leased_tool_policy_denial", return_value="direct tool denied"
            ):
                with self.assertRaises(SystemExit):
                    HOOK.main()
            self.assertEqual(
                json.loads(stdout.getvalue())["hookSpecificOutput"]["permissionDecision"],
                "deny",
            )


if __name__ == "__main__":
    unittest.main()
