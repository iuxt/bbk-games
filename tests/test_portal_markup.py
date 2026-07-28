from html.parser import HTMLParser
import json
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

    def test_game_settings_are_removed(self):
        markup = (ROOT / "choose.html").read_text(encoding="utf-8")
        self.assertEqual(self.parser.storage_keys, set())
        self.assertNotIn("settings-title", self.parser.ids)
        self.assertNotIn("baye/resolution", markup)
        self.assertNotIn("baye/clearmode", markup)

    def test_loads_only_version_list_assets(self):
        self.assertEqual(
            self.parser.scripts,
            [
                "js/jquery.min.js",
                "js/lcd.js?ver=16",
            ],
        )

    def test_keeps_backup_link(self):
        self.assertIn("backup.html?game=baye", self.parser.links)

    def test_declared_local_assets_exist(self):
        self.assertTrue((ROOT / "css" / "portal.css").is_file())
        self.assertTrue((ROOT / "js" / "lcd.js").is_file())

    def test_css_has_responsive_and_accessibility_contracts(self):
        css = (ROOT / "css" / "portal.css").read_text(encoding="utf-8")
        self.assertIn("@media (min-width: 760px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn(".game-grid", css)
        self.assertNotIn(".settings-list", css)
        self.assertIn(":focus-visible", css)


class MobileGameMarkupTests(unittest.TestCase):
    def test_mobile_pages_keep_scripts_inside_document(self):
        for page in ("m.html", "mt.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertTrue(markup.rstrip().endswith("</html>"))
                self.assertLess(markup.rfind("<script"), markup.rfind("</body>"))

    def test_baye_pages_expose_rom_load_errors(self):
        for page in ("m.html", "pc.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertIn('id="game-load-error"', markup)
                self.assertIn("js/lcd.js?ver=16", markup)

    def test_game_pages_do_not_load_retired_codec_helpers(self):
        for page in ("m.html", "mt.html", "pc.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertNotIn("base64.js", markup)
                self.assertNotIn("lzma_worker-min.js", markup)

    def test_mobile_pages_do_not_use_eval_or_inline_tap_code(self):
        for page in ("m.html", "mt.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertNotIn("eval(", markup)
                self.assertNotIn("ontap=", markup)
                self.assertIn('data-key="enter"', markup)

    def test_exit_key_stays_inside_mobile_games(self):
        for page in ("m.html", "mt.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")

                self.assertIn("window.bayeExitToHome = false", markup)
                self.assertIn('data-key="exit">返回</button>', markup)
                self.assertIn('href="index.html">‹ 返回游戏中心</a>', markup)

    def test_game_pages_load_iphone_safari_pull_refresh_guard(self):
        pages = (
            ROOT / "m.html",
            ROOT / "mt.html",
            ROOT / "pc.html",
            ROOT / "bbk-games" / "index.html",
            ROOT / "fm" / "templates" / "m.tpl",
            ROOT / "fm" / "templates" / "pc.tpl",
        )
        for page in pages:
            with self.subTest(page=page.relative_to(ROOT)):
                markup = page.read_text(encoding="utf-8")
                self.assertIn("game-page.js?v=1", markup)

        script = (ROOT / "js" / "game-page.js").read_text(encoding="utf-8")
        self.assertIn('"touchmove"', script)
        self.assertIn("passive: false", script)
        self.assertIn("event.preventDefault()", script)

    def test_rpg_entries_use_relative_launch_routes(self):
        game = "伏魔记"
        markup = (ROOT / "fm" / "games" / game / "index.html").read_text(encoding="utf-8")
        self.assertIn('var page = "pc.html"', markup)
        self.assertIn('page = "m.html"', markup)
        self.assertNotIn('"/fm/games/', markup)


class SimulatorMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = parse("bbk-games/index.html")

    def test_uses_shared_game_center_chrome(self):
        self.assertEqual(self.parser.h1_count, 1)
        self.assertEqual(
            self.parser.stylesheets,
            ["../css/portal.css", "app.css?v=2"],
        )
        self.assertEqual(
            self.parser.scripts,
            ["../js/game-page.js?v=1", "app.js?v=2"],
        )
        self.assertIn("../index.html", self.parser.links)

    def test_ui_assets_cover_responsive_and_accessible_states(self):
        markup = (ROOT / "bbk-games" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "bbk-games" / "app.css").read_text(encoding="utf-8")
        script = (ROOT / "bbk-games" / "app.js").read_text(encoding="utf-8")

        self.assertIn("#touchpad .kb-row", css)
        self.assertIn(".rom-card.is-selected", css)
        self.assertIn(".footer-action", css)
        self.assertIn("@media (max-width: 520px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn('global.fetch("roms/catalog.json")', script)
        self.assertIn("arrayBufferToHex", script)
        self.assertIn('class="footer-action"', markup)
        self.assertNotIn('class="simulator-tools"', markup)
        self.assertNotIn("static/js", markup)
        self.assertNotIn("src_cross", markup)

    def test_catalog_has_one_entry_for_every_bundled_rom(self):
        catalog = json.loads(
            (ROOT / "bbk-games" / "roms" / "catalog.json").read_text(
                encoding="utf-8"
            )
        )
        catalog_ids = [item["id"] for item in catalog]
        rom_ids = sorted(
            path.stem
            for path in (ROOT / "bbk-games" / "roms").glob("*.lib")
        )

        self.assertEqual(len(catalog_ids), len(set(catalog_ids)))
        self.assertEqual(sorted(catalog_ids), rom_ids)


if __name__ == "__main__":
    unittest.main()
