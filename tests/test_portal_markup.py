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
        self.links = set()

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
        if tag == "a" and values.get("href"):
            self.links.add(values["href"])


def parse(page):
    parser = PortalParser()
    parser.feed((ROOT / page).read_text(encoding="utf-8"))
    return parser


class IndexMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = parse("index.html")

    def test_has_one_primary_heading(self):
        self.assertEqual(self.parser.h1_count, 1)

    def test_exposes_all_game_routes(self):
        self.assertEqual(
            self.parser.games,
            {
                "baye": "choose.html",
                "bbk": "bbk-games/index.html",
                "tower": "mt.html",
                "rpg": "fm/index.html",
            },
        )

    def test_is_static_without_dialog_hooks(self):
        self.assertEqual(self.parser.scripts, [])
        self.assertEqual(self.parser.storage_keys, set())
        self.assertFalse(
            {
                "start-baye",
                "settings-trigger",
                "settings-dialog",
                "settings-overlay",
                "settings-close",
            }
            & self.parser.ids
        )

    def test_loads_portal_stylesheet(self):
        self.assertIn("css/portal.css", self.parser.stylesheets)


class ChooseMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = parse("choose.html")

    def test_has_one_primary_heading(self):
        self.assertEqual(self.parser.h1_count, 1)

    def test_preserves_storage_keys(self):
        self.assertEqual(
            self.parser.storage_keys,
            {"baye/mpage", "baye/resolution", "baye/clearmode"},
        )

    def test_loads_version_list_and_settings_assets(self):
        self.assertEqual(
            self.parser.scripts,
            [
                "js/jquery.min.js",
                "js/lcd.js?ver=13",
                "js/base64.js",
                "js/portal.js",
            ],
        )

    def test_keeps_backup_link(self):
        self.assertIn("backup.html?game=baye", self.parser.links)

    def test_declared_local_assets_exist(self):
        self.assertTrue((ROOT / "css" / "portal.css").is_file())
        self.assertTrue((ROOT / "js" / "portal.js").is_file())
        self.assertTrue((ROOT / "js" / "lcd.js").is_file())

    def test_css_has_responsive_and_accessibility_contracts(self):
        css = (ROOT / "css" / "portal.css").read_text(encoding="utf-8")
        self.assertIn("@media (min-width: 760px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn(".game-grid", css)
        self.assertIn(".settings-list", css)
        self.assertIn(":focus-visible", css)


if __name__ == "__main__":
    unittest.main()
