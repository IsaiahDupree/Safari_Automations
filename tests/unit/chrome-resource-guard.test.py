import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "chrome_resource_guard", ROOT / "ops" / "browser-enforcer.py"
)
assert SPEC and SPEC.loader
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class ChromeResourceGuardTests(unittest.TestCase):
    def setUp(self):
        self.policy = GUARD.load_policy(ROOT / "config" / "browser-policy.json")

    def test_scope_is_chrome_only(self):
        source = (ROOT / "ops" / "browser-enforcer.py").read_text(encoding="utf-8")
        self.assertNotIn("safari_roots", source)
        self.assertNotIn("waterfox_roots", source)
        self.assertNotIn("human-presence.json", source)
        self.assertNotIn("check-command", source)

    def test_resource_thresholds_are_reported(self):
        snapshot = {
            "root_pids": [10],
            "canonical_pids": [10],
            "processes": 25,
            "cpu_percent": 176.0,
            "rss_mb": 3073.0,
            "tabs": 14,
            "cdp_available": True,
        }
        reasons = GUARD.violations(snapshot, self.policy)
        self.assertEqual(
            reasons,
            ["processes=25>24", "rss_mb=3073.0>3072", "cpu=176.0>175", "tabs=14>13"],
        )


if __name__ == "__main__":
    unittest.main()
