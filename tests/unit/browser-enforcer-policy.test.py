from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import tomllib
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("browser_enforcer", ROOT / "ops" / "browser-enforcer.py")
assert SPEC and SPEC.loader
ENFORCER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ENFORCER)


class BrowserEnforcerPolicyTests(unittest.TestCase):
    def denial(self, command: str) -> str | None:
        return ENFORCER.command_denial(command, ENFORCER.default_state())

    def test_exact_supervised_python_executes_enforcer_and_broker(self) -> None:
        runtime = ENFORCER.validate_trusted_python()
        self.assertEqual(runtime["path"], "/opt/homebrew/bin/python3")
        environment = {
            "HOME": str(Path.home()),
            "PATH": "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            "PYTHONNOUSERSITE": "1",
            "PYTHONSAFEPATH": "1",
        }
        safe = subprocess.run(
            [
                ENFORCER.TRUSTED_PYTHON,
                str(ENFORCER.ENFORCER_SOURCE),
                "--policy",
                str(ENFORCER.DEFAULT_POLICY),
                "check-command",
                "echo safe",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            env=environment,
        )
        self.assertEqual(safe.returncode, 0, safe.stderr)
        rejected_tool = subprocess.run(
            [
                ENFORCER.TRUSTED_PYTHON,
                str(ENFORCER.ENFORCER_SOURCE),
                "--policy",
                str(ENFORCER.DEFAULT_POLICY),
                "check-tool",
                "computer_browser",
            ],
            capture_output=True,
            text=True,
            timeout=5,
            env=environment,
        )
        self.assertEqual(rejected_tool.returncode, 42, rejected_tool.stderr)
        broker = subprocess.run(
            [ENFORCER.TRUSTED_PYTHON, str(ENFORCER.SAFARI_CONTROL_SOURCE), "--help"],
            capture_output=True,
            text=True,
            timeout=5,
            env=environment,
        )
        self.assertEqual(broker.returncode, 0, broker.stderr)

    def test_short_lived_and_obfuscated_cdp_commands_are_denied(self) -> None:
        commands = [
            "curl http://127.0.0.1:$((9000+222))/json/list",
            "node -e \"require('chrome-'+'remote-interface')()\"",
            "python3 -c 'import socket; socket.create_connection((\"127.0.0.1\",9000+222))'",
            "curl http://2130706433:9222/json/list",
            'A=92; B=22; nc 127.0.0.1 "${A}${B}"',
            'P=$(printf 92%s 22); nc 127.0.0.1 "$P"',
            'H=127.0.0.; H2=1; A=92; B=22; R=json; S=list; '
            'curl "http://${H}${H2}:${A}${B}/${R}/${S}"',
            'node -e "require(Buffer.from(\'Y2hyb21lLXJlbW90ZS1pbnRlcmZhY2U=\','
            '\'base64\').toString())({port:9000+222})"',
            "bash -c 'exec 3<>/dev/tcp/127.0.0.1/9222; printf x >&3'",
            'python3 -c "import socket;socket.create_connection((\'127.\'+\'0.0.1\','
            'int(\'9\'+\'222\')))"',
            "curl http://0.0.0.0:9222/json/list",
            "curl http://0177.0.0.1:9222/json/list",
            "curl http://[0:0:0:0:0:0:0:1]:9222/json/list",
            "curl http://[::ffff:7f00:1]:9222/json/list",
            "python3 -c \"import socket;socket.create_connection((bytes.fromhex('3132372e302e302e31').decode(),9222))\"",
            "python3 -c \"import socket;socket.create_connection((bytes.fromhex('3132372e302e302e31').decode(),int.from_bytes(bytes.fromhex('2406'))))\"",
            "python3 -c \"import socket;socket.create_connection((socket.inet_ntoa(bytes.fromhex('7f000001')),int.from_bytes(b'\\x24\\x06','big')))\"",
            "python3 -c \"import socket,struct;socket.create_connection((socket.inet_ntoa(bytes.fromhex('7f000001')),struct.unpack('>H',bytes.fromhex('2406'))[0]))\"",
            "python3 -c \"import socket;socket.create_connection(('1.0.0.721'[::-1],int('2229'[::-1])))\"",
            "python3 -c \"import socket;socket.create_connection(('127.0.0.1',int('10010000000110',2)))\"",
            "node -e \"require('net').connect(Number(String.fromCharCode(57,50,50,50)),String.fromCharCode(49,50,55,46,48,46,48,46,49))\"",
            "python3 -c \"import socket;socket.create_connection(('127.0.0.1',sum((9000,222))))\"",
            "node -e \"require('net').connect([9000,222].reduce((a,b)=>a+b),'127.0.0.1')\"",
            "ruby -e \"TCPSocket.new('127.0.0.1',[9000,222].sum)\"",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertIsNotNone(self.denial(command))

    def test_browser_launch_indirection_is_denied_without_blocking_normal_network_clients(self) -> None:
        denied = [
            'B=$(printf com.google.Chrome); open -b "$B"',
            'bash -c \'B=$(printf com.google.Chrome); open -b "$B"\'',
            'python3 -c "import subprocess; subprocess.run([\'open\',\'-b\',\'com.google.Chrome\'])"',
            'python3 -c "import os; os.system(\'open -b com.google.Chrome\')"',
            'node -e "require(\'child_process\').spawn(\'open\',[\'-b\',\'com.google.Chrome\'])"',
            'ruby -e "system(\'open -b com.google.Chrome\')"',
            'osascript -e \'tell application id "com.google.Chrome" to activate\'',
            'osascript -e \'tell application "Comet" to launch\'',
            'osascript -e \'tell application "Safari" to get URL of current tab of window 1\'',
            'osascript -e \'tell application "Safari" to set URL of current tab of window 1 to "https://example.com"\'',
            'osascript -e \'tell application ("Sa" & "fari") to activate\'',
            'osascript -e \'set a to "Sa" & "fari"\' -e \'tell application a to activate\'',
            'osascript -e \'tell application (ASCII character 83 & "afari") to activate\'',
            'osascript -e \'tell application (system attribute "BROWSER_APP") to activate\'',
            'python3 -c "from subprocess import run as r;r([\'open\',\'-b\',\'com.google.Chrome\'])"',
            'python3 -c "import webbrowser;webbrowser.open(\'https://example.com\')"',
            'python3 -m webbrowser https://example.com',
            'open "$(printf https://example.com)"',
            'U=$(printf https://example.com); open "$U"',
            'python3 -c "import subprocess;subprocess.run([\'open\',\'https://example.com\'])"',
            'perl -e \'system "open -b com.google.Chrome"\'',
            'php -r "exec(\'open -b com.google.Chrome\');"',
            "arch -arm64 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --user-data-dir=/tmp/x",
            "nice -n 5 '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' --user-data-dir=/tmp/x",
            "env -u NODE_OPTIONS open -b com.google.Chrome",
            "command -- open -b com.google.Chrome",
            "command -p open -b com.google.Chrome",
            "zsh -ic 'alias x=open; x -b com.google.Chrome'",
            "osascript /tmp/browser-control.scpt",
            "printf 'tell application Safari to activate' | osascript",
            "open /tmp/page.html",
            "open file:///tmp/page.html",
            "open /tmp/link.webloc",
            "open 'data:text/html,<h1>x</h1>'",
            "open ftp://example.com/file",
            "env -S 'open -b com.google.Chrome'",
            "env --split-string='open -b com.google.Chrome'",
            "printf '%s\\n' https://example.com | xargs open",
            "printf '%s\\n' com.google.Chrome | xargs open -b",
            "printf '%s\\n' com.google.Chrome | xargs -I{} open -b {}",
            "printf '%s\\n' com.google.Chrome | xargs --replace={} open -b {}",
            "find /tmp -name page.html -exec open {} \\;",
            "launchctl asuser 501 open -b com.google.Chrome",
            "automator /tmp/x.workflow",
            "shortcuts run 'Open URL'",
            "zsh -c 'autoload -Uz zargs; zargs -- https://example.com -- open'",
            "node -r /tmp/preload.js app.js",
            "node --import /tmp/preload.mjs app.js",
            "node --loader /tmp/loader.mjs app.js",
            "node --env-file /tmp/evil.env app.js",
            "tsx -r /tmp/preload.js app.ts",
            "bun --preload /tmp/preload.js app.js",
            "npm exec -- node -r /tmp/preload.js app.js",
            "npx --yes node -r /tmp/preload.js app.js",
            "pnpm exec node --import /tmp/preload.mjs app.js",
            "yarn node --loader /tmp/loader.mjs app.js",
            "caffeinate open -b com.google.Chrome",
            "caffeinate -i open -b com.google.Chrome",
            "caffeinate -dimsu open https://example.com",
            "timeout 5 open -b com.google.Chrome",
            "gtimeout --signal TERM 5 open -b com.google.Chrome",
            "setsid open -b com.google.Chrome",
            "npm run browser",
            "make browser",
            "just browser",
            "npm --silent run browser",
            "npm --prefix /tmp run browser",
            "npm -C /tmp run chrome",
            "pnpm --dir /tmp run safari",
            "pnpm -C /tmp run browser",
            "yarn --cwd /tmp run chrome",
            "yarn --silent run webdriver",
            "bun --cwd /tmp run browser",
        ]
        allowed = [
            'curl "http://localhost:5563/api/${PATH_NAME}"',
            'python3 -c "import requests; requests.get(\'https://example.com\')"',
            'node -e "fetch(\'https://example.com\')"',
            'python3 -c "print(\'socket.create_connection is documented here\')"',
            'python3 -c "print(\'socket.create_connection 127.0.0.1:9222\')"',
            'osascript -e \'tell application "Finder" to get name of startup disk\'',
            "open -R /tmp/page.html",
            "open -t /tmp/page.html",
            "printf '%s\\n' /tmp/page.html | xargs open -R",
            "open -a TextEdit /tmp/page.html",
            "open -b com.apple.TextEdit /tmp/page.html",
            "open -b md.obsidian /tmp/page.html",
            "caffeinate curl https://example.com",
            "timeout 5 curl https://example.com",
            "curl http://localhost:5563/api/jobs/9222",
            "curl -X POST http://127.0.0.1:8767/api/services/foo -d '{\"value\":9222}'",
            "node -e \"fetch('http://localhost:5563/api/jobs/9222')\"",
            "curl http://127.example.com:9222/api",
            "curl http://127a.example.com:9222/api",
        ]
        for command in denied:
            with self.subTest(command=command):
                self.assertIsNotNone(self.denial(command))
        for command in allowed:
            with self.subTest(command=command):
                self.assertIsNone(self.denial(command))

    def test_agents_cannot_mutate_holds_or_supply_alternate_policy(self) -> None:
        source = str(ENFORCER.ENFORCER_SOURCE)
        invocation = f"python3 {shlex.quote(source)}"
        self.assertIsNone(self.denial(f"{invocation} status"))
        self.assertIsNotNone(self.denial(f"{invocation} human-release all"))
        self.assertIsNotNone(self.denial(f"{invocation} --policy /tmp/weak.json enforce-once"))

    def test_alternate_browser_launches_and_legacy_sora_are_denied(self) -> None:
        commands = [
            "open -b " + "com.brave.Browser",
            "open -a " + repr("Brave Browser"),
            "open -a " + "Waterfox",
            "open -b ai.perplexity.comet",
            "open -b company.thebrowser.dia",
            "open -b app.zen-browser.zen",
            "open -b io.gitlab.librewolf-community",
            "open -b one.ablaze.floorp",
            "open -b com.firstversionist.polypane",
            "open -b com.lovingcup.ghostbrowser",
            "open -a Zen",
            "open -a LibreWolf",
            "open -a Floorp",
            "open -a Polypane",
            "open -a 'Ghost Browser'",
            "open -a Sidekick",
            "open -a Wavebox",
            "open -a Orion",
            "open -a DuckDuckGo",
            "open -a SigmaOS",
            "npx tsx packages/services/src/sora/" + "sora-mcp.ts",
            "python3 -m uvicorn " + "waterfox_bridge.server:get_app --port 3110",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertIsNotNone(self.denial(command))

    def test_safe_safari_service_proxy_is_preserved_but_unsafe_variants_are_not(self) -> None:
        safe = ENFORCER.canonical_safari_service_config("safari-instagram-dm")
        self.assertIsNotNone(safe)
        self.assertFalse(ENFORCER.direct_browser_mcp("safari-instagram-dm", safe))
        self.assertTrue(ENFORCER.direct_browser_mcp(
            "safari-instagram-dm",
            {**safe, "command": "/tmp/node"},
        ))
        self.assertTrue(ENFORCER.direct_browser_mcp(
            "safari-instagram-dm",
            {**safe, "env": {**safe["env"], "NODE_OPTIONS": "--require /tmp/inject.js"}},
        ))
        self.assertEqual(safe["command"], "/opt/homebrew/bin/node")
        self.assertTrue(Path(safe["args"][0]).is_absolute())
        self.assertTrue(Path(safe["args"][1]).is_absolute())
        self.assertEqual(safe["env"]["PATH"], "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        for key in ENFORCER.UNSAFE_RUNTIME_ENVIRONMENT:
            self.assertIn(key, safe["env"])
            self.assertEqual(safe["env"][key], "")
        bridge = ENFORCER.canonical_chrome_bridge_config()
        self.assertEqual(bridge["command"], "/opt/homebrew/bin/node")
        self.assertEqual(bridge["env"], safe["env"])
        self.assertTrue(ENFORCER.direct_browser_mcp(
            "generic",
            {"command": "tool", "transport": {"url": "http://127.0.0.1:9222/json/list"}},
        ))
        self.assertTrue(ENFORCER.direct_browser_mcp(
            "sora-mcp",
            {"command": "npx", "args": ["tsx", "packages/services/src/sora/sora-mcp.ts"]},
        ))
        renamed = dict(safe)
        renamed.pop("env")
        self.assertTrue(ENFORCER.direct_browser_mcp("generic-service", renamed))
        self.assertTrue(ENFORCER.direct_browser_mcp("generic-bridge", {
            "command": bridge["command"],
            "args": bridge["args"],
        }))
        for config in (
            {"command": "node", "args": ["server.js"], "transport": {"host": "127.0.0.1", "port": 9222}},
            {"command": "node", "args": ["server.js"], "env": {"CDP_HOST": "127.0.0.1", "CDP_PORT": "9222"}},
            {"command": "node", "args": ["server.js"], "url": "http://127.1:9222"},
            {"command": "python3", "args": ["-c", "import socket;socket.create_connection(('127.0.0.1',9222))"]},
            {"command": "env", "args": ["NODE_OPTIONS=--require /tmp/x.js", "node", "server.js"]},
            {"command": "node", "args": ["server.js"], "transport": {"host": "0.0.0.0", "port": 9222}},
            {"command": "node", "args": ["server.js"], "transport": {"host": "0177.0.0.1", "port": 9222}},
            {"command": "node", "args": ["server.js"], "transport": {"host": "0:0:0:0:0:0:0:1", "port": 9222}},
            {"command": "node", "args": ["server.js"], "env": {"CDP_HOST": "127.0.0.1", "CDP_PORT_A": "92", "CDP_PORT_B": "22"}},
            {"command": "tool", "transport": {"host": "127.0.0.1", "port": "0x2406"}},
            {"command": "python3", "args": ["-c", "import socket;socket.create_connection(('127.0.0.1',sum((9000,222))))"]},
            {"command": "node", "args": ["-e", "require('net').connect([9000,222].reduce((a,b)=>a+b),'127.0.0.1')"]},
        ):
            with self.subTest(config=config):
                self.assertTrue(ENFORCER.direct_browser_mcp("generic", config))

    def test_only_exact_leased_browser_tool_names_are_eligible(self) -> None:
        for tool_name in (
            "mcp__chrome-bridge__claim",
            "mcp__chrome_bridge__chrome_claim_profile",
            "mcp__chrome-bridge__chrome_navigate",
            "mcp__safari-instagram-dm__instagram_status",
            "mcp__safari_instagram_dm__instagram_status",
        ):
            with self.subTest(tool_name=tool_name):
                self.assertTrue(ENFORCER.canonical_leased_tool_name(tool_name))
        for tool_name in (
            "computer_browser",
            "mcp__evil-browser__claim",
            "mcp__chrome-bridge__arbitrary_shell",
            "mcp__chrome-bridge-extra__claim",
        ):
            with self.subTest(tool_name=tool_name):
                self.assertFalse(ENFORCER.canonical_leased_tool_name(tool_name))

    def test_codex_rewrite_preserves_multiline_literals_and_removes_only_direct_mcp(self) -> None:
        original = '''note = """documentation example
[mcp_servers.generic]
url = "http://127.0.0.1:9222/json/list"
"""

[mcp_servers.generic]
url = "http://127.0.0.1:9222/json/list"

[mcp_servers.safari-instagram-dm]
command = "npx"
args = ["tsx", "packages/instagram-dm/src/api/mcp-server.ts"]

[unrelated]
value = 7
'''
        configured = ENFORCER.configured_codex_toml(original)
        value = tomllib.loads(configured)
        self.assertIn("[mcp_servers.generic]", value["note"])
        self.assertNotIn("generic", value["mcp_servers"])
        self.assertIn("safari-instagram-dm", value["mcp_servers"])
        self.assertEqual(value["unrelated"]["value"], 7)
        self.assertEqual(
            value["mcp_servers"]["chrome-bridge"],
            ENFORCER.canonical_chrome_bridge_config(),
        )
        self.assertTrue(value["features"]["hooks"])
        self.assertTrue(ENFORCER.codex_command_hook_present(value))
        self.assertFalse(value["plugins"]["chrome@openai-bundled"]["enabled"])
        self.assertFalse(value["plugins"]["browser@openai-bundled"]["enabled"])
        self.assertFalse(value["plugins"]["computer-use@openai-bundled"]["enabled"])

    def test_claude_command_hook_is_added_without_dropping_existing_hooks(self) -> None:
        value = {"hooks": {"PostToolUse": [{"matcher": "Write", "hooks": []}]}}
        self.assertEqual(ENFORCER.rewrite_claude_command_hook(value), 1)
        self.assertIn(ENFORCER.canonical_claude_command_hook(), value["hooks"]["PreToolUse"])
        self.assertIn("PostToolUse", value["hooks"])
        self.assertEqual(ENFORCER.rewrite_claude_command_hook(value), 0)

    def test_command_hook_registration_repair_preserves_unrelated_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            claude = root / "settings.json"
            codex = root / "config.toml"
            claude.write_text(json.dumps({"model": "kept", "hooks": {}}), encoding="utf-8")
            codex.write_text('model = "kept"\n\n[features]\nhooks = false\n', encoding="utf-8")
            with mock.patch.object(ENFORCER, "CLAUDE_SETTINGS_CONFIG", claude), mock.patch.object(
                ENFORCER, "CODEX_CONFIG", codex
            ):
                self.assertEqual(ENFORCER.repair_command_hook_registrations(), 2)
            self.assertEqual(json.loads(claude.read_text())["model"], "kept")
            codex_value = tomllib.loads(codex.read_text())
            self.assertEqual(codex_value["model"], "kept")
            self.assertTrue(codex_value["features"]["hooks"])

    def test_alternate_roots_are_classified(self) -> None:
        parts = [
            ("Waterfox.app", "waterfox"),
            ("Safari Technology Preview.app", "Safari Technology Preview"),
            ("Google Chrome Beta.app", "Google Chrome Beta"),
            ("Comet.app", "Comet"),
            ("Dia.app", "Dia"),
        ]
        processes = []
        for index, (bundle, executable) in enumerate(parts, 100):
            command = str(Path("/Applications") / bundle / "Contents" / "MacOS" / executable)
            processes.append({"pid": index, "ppid": 1, "cpu": 0.0, "rss_kb": 1, "command": command})
        processes.append({
            "pid": 200,
            "ppid": 1,
            "cpu": 0.0,
            "rss_kb": 1,
            "command": "/opt/homebrew/bin/geckodriver --port 50000",
        })
        processes.extend([
            {
                "pid": 201, "ppid": 1, "cpu": 0.0, "rss_kb": 1,
                "command": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            },
            {
                "pid": 202, "ppid": 1, "cpu": 0.0, "rss_kb": 1,
                "command": "/Applications/Safari.app/Contents/MacOS/Safari",
            },
        ])
        offenders = ENFORCER.rogue_chromium_roots(processes)
        self.assertEqual({row["pid"] for row in offenders}, {100, 101, 102, 103, 104, 200})
        source = (ROOT / "ops" / "browser-enforcer.py").read_text(encoding="utf-8")
        for process_name in (
            "Comet", "Dia", "Orion", "DuckDuckGo", "Zen", "LibreWolf", "Floorp",
            "SigmaOS", "Sidekick", "Wavebox", "Polypane", "Ghost Browser",
        ):
            self.assertIn(process_name, source)

    def test_unknown_web_handler_is_a_root_even_when_launched_by_a_shell(self) -> None:
        processes = [
            {"pid": 401, "ppid": 77, "cpu": 0.0, "rss_kb": 1, "command": "/Applications/Stealth.app/Contents/MacOS/Stealth"},
            {"pid": 77, "ppid": 1, "cpu": 0.0, "rss_kb": 1, "command": "/bin/zsh"},
        ]
        with mock.patch.object(
            ENFORCER,
            "macos_browser_command",
            side_effect=lambda command: command.startswith("/Applications/Stealth.app/"),
        ):
            offenders = ENFORCER.rogue_chromium_roots(processes)
        self.assertEqual([row["pid"] for row in offenders], [401])

        comet = Path("/Applications/Comet.app")
        if comet.exists():
            metadata = ENFORCER.macos_bundle_metadata(str(comet))
            self.assertIsNotNone(metadata)
            executable = comet / "Contents" / "MacOS" / metadata[1]
            self.assertTrue(ENFORCER.macos_browser_command(str(executable)))
            self.assertTrue(ENFORCER.requested_browser_bundle(["open", "-b", metadata[0]]))
        obsidian = Path("/Applications/Obsidian.app")
        if obsidian.exists():
            metadata = ENFORCER.macos_bundle_metadata(str(obsidian))
            self.assertTrue(metadata is None or metadata[2] is False)
        for non_browser_name in ("Hammerspoon", "ChatGPT"):
            bundle = Path("/Applications") / f"{non_browser_name}.app"
            if bundle.exists():
                metadata = ENFORCER.macos_bundle_metadata(str(bundle))
                self.assertIsNotNone(metadata)
                self.assertFalse(metadata[2])

    def test_agents_cannot_read_or_call_destructive_control_plane(self) -> None:
        commands = [
            "cat \"$HOME/Library/Application Support/ACTP/browserd/control-token\"",
            "P=control-; Q=token; cat \"$HOME/Library/Application Support/ACTP/browserd/${P}${Q}\"",
            "python3 -c 'from pathlib import Path; Path.home().joinpath(\"Library/Application Support/ACTP/browserd/control-token\").read_text()'",
            "curl -X POST http://127.0.0.1:5590/drain",
            "curl -X POST http://127.0.0.1:5590/trim-managed",
            "printf '{}' | nc -U ~/Library/Application Support/ACTP/browser-enforcer/safari-trim.sock",
            f"node {shlex.quote(str(ENFORCER.BROWSERD_SOURCE))}",
            f"node {shlex.quote(str(ENFORCER.BROWSERD_RUNTIME))}",
            f"node -e \"import({json.dumps(str(ENFORCER.BROWSERD_RUNTIME))})\"",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertIsNotNone(self.denial(command))

        self.assertIsNone(self.denial('rg -n "safari-control.token|/trim-managed" ops/browser-enforcer.py'))

    def test_agents_cannot_poison_supervisor_or_tmux_loader_environment(self) -> None:
        commands = [
            'launchctl setenv NODE_OPTIONS "--require /tmp/preload.js"',
            'launchctl setenv PYTHONPATH /tmp/preload',
            'tmux set-environment -g NODE_OPTIONS "--require /tmp/preload.js"',
            'tmux setenv -g PYTHONPATH /tmp/preload',
            'V=NODE_OPTIONS; export "$V=--require /tmp/preload.js"; '
            f'node {ENFORCER.BROWSERD_RUNTIME}',
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertIsNotNone(self.denial(command))

    def test_tmux_rollback_environment_preserves_values_and_removed_names(self) -> None:
        parsed = ENFORCER.parse_tmux_environment(
            'SAFE="value with spaces=and-equals"; export SAFE;\n'
            'unset DISPLAY;\nEMPTY=""; export EMPTY;\n'
        )
        self.assertEqual(parsed, {
            "SAFE": {"value": "value with spaces=and-equals", "hidden": False},
            "DISPLAY": {"value": None, "hidden": False},
            "EMPTY": {"value": "", "hidden": False},
        })
        tmux = Path("/opt/homebrew/bin/tmux")
        commands = ENFORCER.tmux_environment_restore_commands(
            tmux,
            {
                "OLD": {"value": "unsafe", "hidden": True},
                "DISPLAY": {"value": "stale", "hidden": False},
            },
            parsed,
        )
        self.assertEqual(commands[:2], [
            [str(tmux), "set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "-u", "DISPLAY"],
            [str(tmux), "set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "-h", "-u", "OLD"],
        ])
        self.assertIn(
            [str(tmux), "set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "-r", "DISPLAY"],
            commands,
        )
        self.assertIn(
            [str(tmux), "set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "SAFE", "value with spaces=and-equals"],
            commands,
        )
        with self.assertRaises(RuntimeError):
            ENFORCER.parse_tmux_environment('BAD-NAME="value"; export BAD-NAME;\n')

    def test_tmux_environment_round_trip_on_isolated_server(self) -> None:
        tmux = Path("/opt/homebrew/bin/tmux")
        if not tmux.exists():
            self.skipTest("Homebrew tmux is unavailable")
        socket_name = f"actp-enforcer-test-{os.getpid()}"

        def isolated(command: list[str], timeout: float = 15, check: bool = False):
            rewritten = [command[0], "-L", socket_name, *command[1:]]
            return subprocess.run(
                rewritten,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=check,
            )

        raw = lambda *args: subprocess.run(
            [str(tmux), "-L", socket_name, *args],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        try:
            raw("new-session", "-d", "-s", ENFORCER.SAFARI_CONTROL_SESSION, "/bin/sleep", "30")
            raw("set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "NORMAL", "one\ntwo=three")
            raw("set-environment", "-r", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "REMOVED")
            raw("set-environment", "-h", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "SECRET", "hidden value")
            raw("set-environment", "-h", "-r", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "HIDDEN_REMOVED")
            with mock.patch.object(ENFORCER, "run", side_effect=isolated):
                target = ENFORCER.snapshot_tmux_environment(tmux)
                self.assertEqual(target["NORMAL"]["value"], "one\ntwo=three")
                self.assertFalse(target["NORMAL"]["hidden"])
                self.assertEqual(target["SECRET"], {"value": "hidden value", "hidden": True})
                self.assertEqual(target["REMOVED"], {"value": None, "hidden": False})
                # tmux records removed variables in the normal namespace even
                # when -h and -r are supplied together.
                self.assertEqual(target["HIDDEN_REMOVED"], {"value": None, "hidden": False})
                raw("set-environment", "-u", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "NORMAL")
                raw("set-environment", "-h", "-u", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "SECRET")
                raw("set-environment", "-t", ENFORCER.SAFARI_CONTROL_SESSION, "EXTRA", "remove me")
                ENFORCER.restore_tmux_environment(tmux, target)
                self.assertEqual(ENFORCER.snapshot_tmux_environment(tmux), target)
        finally:
            subprocess.run(
                [str(tmux), "-L", socket_name, "kill-server"],
                capture_output=True,
                text=True,
                timeout=5,
            )


if __name__ == "__main__":
    unittest.main()
