from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class PortalParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.games = {}
        self.storage_keys = set()
        self.stylesheets = []
        self.scripts = []
        self.h1_count = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "h1":
            self.h1_count += 1
        if values.get("data-game"):
            self.games[values["data-game"]] = values.get("href")
        if values.get("data-storage-key"):
            self.storage_keys.add(values["data-storage-key"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.stylesheets.append(values.get("href"))
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"])


class PortalMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = PortalParser()
        cls.parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))

    def test_has_one_primary_heading(self):
        self.assertEqual(self.parser.h1_count, 1)

    def test_exposes_all_game_routes(self):
        self.assertEqual(
            self.parser.games,
            {
                "baye": "pc.html",
                "bbk": "bbk-games/index.html",
                "tower": "mt.html",
                "rpg": "fm/index.html",
            },
        )

    def test_preserves_baye_actions_and_dialog_hooks(self):
        self.assertTrue(
            {
                "start-baye",
                "settings-trigger",
                "settings-dialog",
                "settings-overlay",
                "settings-close",
            }.issubset(self.parser.ids)
        )

    def test_preserves_storage_keys(self):
        self.assertEqual(
            self.parser.storage_keys,
            {"baye/mpage", "baye/resolution", "baye/clearmode"},
        )

    def test_loads_portal_assets_and_existing_launcher(self):
        self.assertIn("css/portal.css", self.parser.stylesheets)
        self.assertEqual(
            self.parser.scripts,
            ["js/jquery.min.js", "js/lcd.js?ver=10", "js/portal.js"],
        )

    def test_declared_local_assets_exist(self):
        self.assertTrue((ROOT / "css" / "portal.css").is_file())
        self.assertTrue((ROOT / "js" / "portal.js").is_file())


if __name__ == "__main__":
    unittest.main()
