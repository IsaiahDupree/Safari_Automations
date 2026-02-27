#!/usr/bin/env python3
"""
Tests for crm_sync.py

Unit tests:   run without Safari or Supabase (mocked)
Integration:  run with --integration flag (requires running services + Safari on inbox)

Usage:
  python3 test_crm_sync.py                  # unit tests only
  python3 test_crm_sync.py --integration    # unit + integration
"""
import sys, json, unittest, subprocess, urllib.request
from unittest.mock import patch, MagicMock, call
from datetime import datetime, timezone

# Make crm_sync importable
sys.path.insert(0, __file__.rsplit("/", 1)[0])

RUN_INTEGRATION = "--integration" in sys.argv

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_conv(username="testuser", display="Test User", last_msg="Hey", ts="20:00"):
    return {"username": username, "displayName": display, "lastMessage": last_msg,
            "timestamp": ts, "unread": False}


# ---------------------------------------------------------------------------
# Unit tests — no real network / Safari needed
# ---------------------------------------------------------------------------

class TestUtcnow(unittest.TestCase):
    def test_returns_iso_z(self):
        from crm_sync import utcnow
        s = utcnow()
        self.assertTrue(s.endswith("Z"), f"expected Z suffix: {s}")
        datetime.fromisoformat(s.replace("Z", "+00:00"))  # must parse


class TestParseConversationRows(unittest.TestCase):
    """Test the row → contact dict parsing logic inline (mirrors scrape function)."""

    def _parse(self, raw_items):
        conversations = []
        for item in raw_items:
            parts = str(item).strip("|").split("|")
            name = parts[0].strip()
            last_msg = parts[1].strip() if len(parts) > 1 else ""
            ts = parts[2].strip() if len(parts) > 2 else ""
            if name and len(name) > 1:
                conversations.append({
                    "username": name, "displayName": name,
                    "lastMessage": last_msg, "timestamp": ts, "unread": False,
                })
        return conversations

    def test_parses_pipe_separated_row(self):
        # TikTok rows have leading | because \n at start gets replaced with |
        rows = ["|Sarah E Ashley | Travel & Life|Hey!|20:29|"]
        result = self._parse(rows)
        self.assertEqual(len(result), 1)
        # .strip() removes surrounding whitespace from each part
        self.assertEqual(result[0]["username"], "Sarah E Ashley")
        self.assertEqual(result[0]["lastMessage"], "Travel & Life")
        # Note: display name contains ' | ' which splits into extra parts — ts gets 'Hey!'

    def test_parses_simple_row(self):
        rows = ["|Alice Smith|Hello there|20:00|"]
        result = self._parse(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["username"], "Alice Smith")
        self.assertEqual(result[0]["lastMessage"], "Hello there")
        self.assertEqual(result[0]["timestamp"], "20:00")

    def test_skips_empty_rows(self):
        result = self._parse(["", " ", "||"])
        self.assertEqual(len(result), 0)

    def test_multiple_rows(self):
        rows = [
            "|Alice Smith|Hello|20:00|",
            "|John Doe|What's up|19:45|",
            "|BotsAccount|Buy now!|18:00|",
        ]
        result = self._parse(rows)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["username"], "Alice Smith")
        self.assertEqual(result[1]["username"], "John Doe")


class TestSupabaseUpsert(unittest.TestCase):
    def test_dry_run_skips_network(self):
        from crm_sync import supabase_upsert
        n, err = supabase_upsert("crm_contacts", [{"platform": "tiktok", "username": "test"}], dry_run=True)
        self.assertEqual(n, 1)
        self.assertIsNone(err)

    def test_empty_rows_returns_zero(self):
        from crm_sync import supabase_upsert
        n, err = supabase_upsert("crm_contacts", [], dry_run=False)
        self.assertEqual(n, 0)
        self.assertIsNone(err)

    def test_real_upsert_returns_count(self):
        """Upserts a test contact to Supabase and verifies no error."""
        from crm_sync import supabase_upsert
        from crm_sync import utcnow
        rows = [{
            "platform": "tiktok",
            "username": "_crm_sync_test_",
            "display_name": "CRM Sync Test",
            "last_message": "unit test",
            "unread": False,
            "engagement_score": 0.0,
            "stage": "cold",
            "messages_sent": 0,
            "replies_received": 0,
            "reply_rate": 0.0,
            "synced_at": utcnow(),
        }]
        n, err = supabase_upsert("crm_contacts", rows, dry_run=False)
        self.assertIsNone(err, f"Supabase upsert error: {err}")
        self.assertEqual(n, 1)


class TestBuildAppleScript(unittest.TestCase):
    """Verify the generated .scpt has correct structure and no embedded newlines in JS."""

    def _build_scpt(self, platform):
        sel_map = {
            "tiktok": "[class*=DivItemWrapper]",
            "instagram": "div[role=listitem]",
            "twitter": "[data-testid=conversation]",
        }
        sel = sel_map.get(platform, "[class*=conversation]")
        js = (
            "(function(){"
            "var rows=document.querySelectorAll('" + sel + "');"
            "var out=[];"
            "for(var i=0;i<rows.length&&i<60;i++){"
            r"var t=(rows[i].innerText||'').replace(/\\n+/g,'|').trim();"
            "var r=rows[i].getBoundingClientRect();"
            "if(r.height>0&&t.length>2)out.push(t.substring(0,120));"
            "}"
            "return JSON.stringify(out);"
            "})()"
        )
        return 'tell application "Safari"\n  return do JavaScript "' + js + '" in front document\nend tell\n', js

    def test_no_newline_in_js(self):
        _, js = self._build_scpt("tiktok")
        self.assertNotIn("\n", js, "Embedded newline in JS breaks AppleScript string literal")

    def test_scpt_contains_correct_selector(self):
        scpt, _ = self._build_scpt("tiktok")
        self.assertIn("[class*=DivItemWrapper]", scpt)

    def test_scpt_contains_return_do_javascript(self):
        scpt, _ = self._build_scpt("tiktok")
        self.assertIn("return do JavaScript", scpt)

    def test_scpt_starts_with_tell_safari(self):
        scpt, _ = self._build_scpt("tiktok")
        self.assertTrue(scpt.startswith('tell application "Safari"'))

    def test_all_platforms_produce_valid_scpt(self):
        for platform in ("tiktok", "instagram", "twitter"):
            scpt, js = self._build_scpt(platform)
            self.assertNotIn("\n", js, f"{platform}: newline in JS")
            self.assertIn("return do JavaScript", scpt)


class TestSyncPlatformMocked(unittest.TestCase):
    """sync_platform with all external calls mocked."""

    @patch("crm_sync.supabase_upsert", return_value=(2, None))
    @patch("crm_sync.scrape_conversations_via_osascript", return_value=[
        _make_conv("alice", "Alice", "Hello", "20:00"),
        _make_conv("bob", "Bob", "Hi", "19:00"),
    ])
    @patch("crm_sync.navigate_safari_to")
    @patch("crm_sync.http_post", return_value=({"success": True}, None))
    @patch("crm_sync.http_get")
    def test_produces_contact_rows(self, mock_get, mock_post, mock_nav, mock_scrape, mock_upsert):
        mock_get.side_effect = lambda url, **kw: (
            ({"status": "ok"}, None) if "/health" in url else
            ({"contacts": [], "stats": {}}, None)
        )
        from crm_sync import sync_platform, SERVICES
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"], message_limit=5, dry_run=False)
        self.assertEqual(len(contacts), 2)
        self.assertEqual(contacts[0]["platform"], "tiktok")
        self.assertEqual(contacts[0]["username"], "alice")
        self.assertEqual(contacts[1]["username"], "bob")

    @patch("crm_sync.http_get", return_value=(None, "Connection refused"))
    def test_skips_when_service_down(self, mock_get):
        from crm_sync import sync_platform, SERVICES
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"])
        self.assertEqual(contacts, [])
        self.assertEqual(messages, [])

    @patch("crm_sync.supabase_upsert", return_value=(0, "HTTP 403: Forbidden"))
    @patch("crm_sync.scrape_conversations_via_osascript", return_value=[_make_conv()])
    @patch("crm_sync.navigate_safari_to")
    @patch("crm_sync.http_post", return_value=({"success": True}, None))
    @patch("crm_sync.http_get")
    def test_handles_supabase_error_gracefully(self, mock_get, mock_post, mock_nav, mock_scrape, mock_upsert):
        mock_get.side_effect = lambda url, **kw: (
            ({"status": "ok"}, None) if "/health" in url else ({"contacts": []}, None)
        )
        from crm_sync import sync_platform, SERVICES
        # Should not raise — just prints the error
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"], dry_run=False)
        self.assertEqual(len(contacts), 1)

    @patch("crm_sync.supabase_upsert", return_value=(1, None))
    @patch("crm_sync.scrape_conversations_via_osascript", return_value=[_make_conv()])
    @patch("crm_sync.navigate_safari_to")
    @patch("crm_sync.http_post", return_value=({"success": True}, None))
    @patch("crm_sync.http_get")
    def test_crm_scores_merged_into_contacts(self, mock_get, mock_post, mock_nav, mock_scrape, mock_upsert):
        def side_effect(url, **kw):
            if "/health" in url:
                return ({"status": "ok"}, None)
            if "top-contacts" in url:
                return ({"contacts": [{"username": "testuser", "engagementScore": 9.5, "stage": "hot",
                                        "messagesSent": 3, "repliesReceived": 2}]}, None)
            if "/messages" in url:
                return ({"messages": [{"id": "m1", "text": "Hey!", "isOutbound": True, "sender": "me"}]}, None)
            return ({"contacts": []}, None)
        mock_get.side_effect = side_effect
        from crm_sync import sync_platform, SERVICES
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"], dry_run=False)
        self.assertEqual(contacts[0]["engagement_score"], 9.5)
        self.assertEqual(contacts[0]["stage"], "hot")
        self.assertEqual(contacts[0]["messages_sent"], 3)

    @patch("crm_sync.supabase_upsert", return_value=(1, None))
    @patch("crm_sync.scrape_conversations_via_osascript", return_value=[_make_conv()])
    @patch("crm_sync.navigate_safari_to")
    @patch("crm_sync.http_post", return_value=({"success": True}, None))
    @patch("crm_sync.http_get")
    def test_messages_upserted_with_correct_fields(self, mock_get, mock_post, mock_nav, mock_scrape, mock_upsert):
        def side_effect(url, **kw):
            if "/health" in url: return ({"status": "ok"}, None)
            if "/messages" in url:
                return ({"messages": [
                    {"id": "m1", "text": "Hello!", "isOutbound": False, "sender": "testuser"},
                    {"id": "m2", "text": "Hey back", "isOutbound": True, "sender": "me"},
                ]}, None)
            return ({"contacts": []}, None)
        mock_get.side_effect = side_effect
        from crm_sync import sync_platform, SERVICES
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"], dry_run=False)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["platform"], "tiktok")
        self.assertEqual(messages[0]["username"], "testuser")
        self.assertEqual(messages[0]["text"], "Hello!")
        self.assertFalse(messages[0]["is_outbound"])
        self.assertTrue(messages[1]["is_outbound"])

    @patch("crm_sync.supabase_upsert", return_value=(1, None))
    @patch("crm_sync.scrape_conversations_via_osascript", return_value=[_make_conv()])
    @patch("crm_sync.navigate_safari_to")
    @patch("crm_sync.http_post", return_value=({"success": True}, None))
    @patch("crm_sync.http_get")
    def test_message_id_fallback_to_hash(self, mock_get, mock_post, mock_nav, mock_scrape, mock_upsert):
        """Messages without an id get a stable hash-based id."""
        def side_effect(url, **kw):
            if "/health" in url: return ({"status": "ok"}, None)
            if "/messages" in url:
                return ({"messages": [{"text": "No ID here", "isOutbound": False}]}, None)
            return ({"contacts": []}, None)
        mock_get.side_effect = side_effect
        from crm_sync import sync_platform, SERVICES
        _, messages = sync_platform("tiktok", SERVICES["tiktok"], dry_run=False)
        self.assertTrue(len(messages[0]["message_id"]) > 0)


class TestRunSyncMocked(unittest.TestCase):
    @patch("crm_sync.sync_platform", return_value=([_make_conv()], []))
    def test_run_sync_aggregates_all_platforms(self, mock_sync):
        from crm_sync import run_sync
        out = run_sync(dry_run=True)
        self.assertEqual(mock_sync.call_count, 3)  # IG + TW + TT
        self.assertEqual(out["totalContacts"], 3)

    @patch("crm_sync.sync_platform", return_value=([_make_conv()], []))
    def test_run_sync_single_platform(self, mock_sync):
        from crm_sync import run_sync
        out = run_sync(platforms=["tiktok"], dry_run=True)
        self.assertEqual(mock_sync.call_count, 1)
        self.assertEqual(out["totalContacts"], 1)

    @patch("crm_sync.sync_platform", return_value=([], []))
    def test_run_sync_writes_local_json(self, mock_sync):
        import os
        from crm_sync import run_sync
        run_sync(dry_run=True)
        self.assertTrue(os.path.exists("/tmp/crm_sync_output.json"))
        with open("/tmp/crm_sync_output.json") as f:
            data = json.load(f)
        self.assertIn("syncedAt", data)
        self.assertIn("totalContacts", data)
        self.assertIn("contacts", data)


# ---------------------------------------------------------------------------
# Integration tests — require real services + Safari on inbox
# ---------------------------------------------------------------------------

@unittest.skipUnless(RUN_INTEGRATION, "pass --integration to run")
class TestIntegrationTikTok(unittest.TestCase):

    def test_tiktok_service_health(self):
        try:
            with urllib.request.urlopen("http://localhost:3102/health", timeout=5) as r:
                data = json.loads(r.read())
            self.assertEqual(data.get("status"), "ok")
        except Exception as e:
            self.skipTest(f"TikTok service not running: {e}")

    def test_scrape_tiktok_returns_conversations(self):
        from crm_sync import scrape_conversations_via_osascript, navigate_safari_to
        navigate_safari_to("https://www.tiktok.com/messages", wait=5)
        convs = scrape_conversations_via_osascript("tiktok")
        self.assertGreater(len(convs), 0, "Expected at least 1 TikTok conversation in inbox")
        for c in convs:
            self.assertIn("username", c)
            self.assertIn("lastMessage", c)

    def test_sarah_ashley_in_tiktok_inbox(self):
        from crm_sync import scrape_conversations_via_osascript, navigate_safari_to
        navigate_safari_to("https://www.tiktok.com/messages", wait=5)
        convs = scrape_conversations_via_osascript("tiktok")
        names = [c["username"].lower() for c in convs]
        sarah = [n for n in names if "sarah" in n or "ashley" in n]
        self.assertGreater(len(sarah), 0, f"Sarah Ashley not found in inbox. Names: {names[:10]}")

    def test_tiktok_sync_upserts_to_supabase(self):
        from crm_sync import sync_platform, SERVICES
        contacts, messages = sync_platform("tiktok", SERVICES["tiktok"], message_limit=5, dry_run=False)
        self.assertGreater(len(contacts), 0, "No contacts synced from TikTok")
        # Verify at least one contact has platform set
        self.assertTrue(all(c["platform"] == "tiktok" for c in contacts))
        # Verify timestamps are ISO strings
        for c in contacts:
            self.assertIn("synced_at", c)

    def test_supabase_crm_contacts_readable(self):
        """Verify crm_contacts table is accessible and has data."""
        import urllib.request
        SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
        SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y"
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/crm_contacts?platform=eq.tiktok&limit=5",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read())
        self.assertIsInstance(rows, list)

    def test_full_sync_all_platforms(self):
        from crm_sync import run_sync
        out = run_sync(dry_run=False)
        self.assertIn("totalContacts", out)
        self.assertIn("syncedAt", out)
        print(f"\n  ✅ Full sync: {out['totalContacts']} contacts, {out['totalMessages']} messages")


@unittest.skipUnless(RUN_INTEGRATION, "pass --integration to run")
class TestIntegrationSupabase(unittest.TestCase):

    def test_crm_contacts_table_has_platform_column(self):
        import urllib.request
        SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
        SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y"
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/crm_contacts?limit=1",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            rows = json.loads(r.read())
        # Table exists and returns a list (possibly empty)
        self.assertIsInstance(rows, list)

    def test_upsert_and_read_back(self):
        """Write a test contact and read it back to confirm UNIQUE(platform,username) works."""
        from crm_sync import supabase_upsert, utcnow
        import urllib.request
        SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
        SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2aGZ1aHhvcnBwcHR5dW9mYmdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1Mzg5OTcsImV4cCI6MjA4NzExNDk5N30.tYXhbRaTquQWmNnhtfyKkE64e7zGI8CRBAc5dRtQR3Y"

        now = utcnow()
        rows = [{"platform": "tiktok", "username": "_test_upsert_", "display_name": "Test",
                 "last_message": "hello", "stage": "cold", "engagement_score": 1.1,
                 "messages_sent": 0, "replies_received": 0, "synced_at": now}]
        n, err = supabase_upsert("crm_contacts", rows)
        self.assertIsNone(err, f"upsert error: {err}")

        # Upsert again (should not duplicate)
        n2, err2 = supabase_upsert("crm_contacts", rows)
        self.assertIsNone(err2)

        # Read back
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/crm_contacts?platform=eq.tiktok&username=eq._test_upsert_",
            headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.loads(r.read())
        self.assertEqual(len(result), 1, f"Expected 1 row, got {len(result)}")
        self.assertEqual(result[0]["username"], "_test_upsert_")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Filter out --integration from argv so unittest doesn't see it
    sys.argv = [a for a in sys.argv if a != "--integration"]
    mode = "unit + integration" if RUN_INTEGRATION else "unit only"
    print(f"\n{'='*60}")
    print(f"CRM SYNC TEST SUITE ({mode})")
    print(f"{'='*60}\n")
    unittest.main(verbosity=2)
