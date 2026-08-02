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
                "baye": "sanguobaye/index.html",
                "bbk": "rpg/index.html",
                "tower": "mota/index.html",
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
        cls.parser = parse("sanguobaye/index.html")

    def test_has_one_primary_heading(self):
        self.assertEqual(self.parser.h1_count, 1)

    def test_game_settings_are_removed(self):
        markup = (ROOT / "sanguobaye" / "index.html").read_text(encoding="utf-8")
        self.assertEqual(self.parser.storage_keys, set())
        self.assertNotIn("settings-title", self.parser.ids)
        self.assertNotIn("baye/resolution", markup)
        self.assertNotIn("baye/clearmode", markup)

    def test_loads_only_version_list_assets(self):
        self.assertEqual(
            self.parser.scripts,
            [
                "../js/jquery.min.js",
                "../js/lcd.js?ver=17",
            ],
        )

    def test_keeps_backup_link(self):
        self.assertIn("backup.html", self.parser.links)

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
        for page in ("sanguobaye/m.html", "mota/index.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertTrue(markup.rstrip().endswith("</html>"))
                self.assertLess(markup.rfind("<script"), markup.rfind("</body>"))

    def test_baye_pages_expose_rom_load_errors(self):
        for page in ("sanguobaye/m.html", "sanguobaye/pc.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertIn('id="game-load-error"', markup)
                self.assertIn("../js/lcd.js?ver=17", markup)

    def test_game_pages_do_not_load_retired_codec_helpers(self):
        for page in (
            "sanguobaye/m.html",
            "mota/index.html",
            "sanguobaye/pc.html",
        ):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertNotIn("base64.js", markup)
                self.assertNotIn("lzma_worker-min.js", markup)

    def test_mobile_pages_do_not_use_eval_or_inline_tap_code(self):
        for page in ("sanguobaye/m.html", "mota/index.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertNotIn("eval(", markup)
                self.assertNotIn("ontap=", markup)
                self.assertIn('data-key="enter"', markup)

    def test_mobile_gameplay_shell_prevents_ios_text_selection(self):
        for page in ("sanguobaye/m.html", "mota/index.html"):
            with self.subTest(page=page):
                markup = (ROOT / page).read_text(encoding="utf-8")
                self.assertIn(".utility-shell {", markup)
                self.assertIn("-webkit-user-select: none", markup)
                self.assertIn("-webkit-touch-callout: none", markup)
                self.assertIn("touch-action: none", markup)

    def test_baye_exit_key_can_leave_after_the_engine_stops(self):
        markup = (ROOT / "sanguobaye" / "m.html").read_text(encoding="utf-8")

        self.assertNotIn("window.bayeExitToHome = false", markup)
        self.assertIn('data-key="exit">返回</button>', markup)

    def test_tower_exit_key_can_leave_after_the_engine_stops(self):
        markup = (ROOT / "mota" / "index.html").read_text(encoding="utf-8")

        self.assertNotIn("window.bayeExitToHome = false", markup)
        self.assertIn('data-key="exit">返回</button>', markup)

    def test_game_pages_load_iphone_safari_pull_refresh_guard(self):
        pages = (
            ROOT / "sanguobaye" / "m.html",
            ROOT / "mota" / "index.html",
            ROOT / "sanguobaye" / "pc.html",
            ROOT / "rpg" / "index.html",
        )
        for page in pages:
            with self.subTest(page=page.relative_to(ROOT)):
                markup = page.read_text(encoding="utf-8")
                self.assertIn("game-page.js?v=1", markup)

        script = (ROOT / "js" / "game-page.js").read_text(encoding="utf-8")
        self.assertIn('"touchmove"', script)
        self.assertIn("passive: false", script)
        self.assertIn("event.preventDefault()", script)

    def test_gameplay_pages_hide_page_scroll_indicator(self):
        css = (ROOT / "css" / "portal.css").read_text(encoding="utf-8")
        self.assertIn("html.gameplay-page::-webkit-scrollbar", css)
        self.assertIn("scrollbar-width: none", css)


class SimulatorMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = parse("rpg/index.html")

    def test_uses_shared_game_center_chrome(self):
        self.assertEqual(self.parser.h1_count, 1)
        self.assertEqual(
            self.parser.stylesheets,
            ["../css/portal.css?v=2", "app.css?v=8"],
        )
        self.assertEqual(
            self.parser.scripts,
            ["../js/game-page.js?v=1", "srs-anchor.js?v=1", "app.js?v=10"],
        )
        self.assertIn("../index.html", self.parser.links)

        markup = (ROOT / "rpg" / "index.html").read_text(encoding="utf-8")
        self.assertIn('class="gameplay-page"', markup)

    def test_ui_assets_cover_responsive_and_accessible_states(self):
        markup = (ROOT / "rpg" / "index.html").read_text(encoding="utf-8")
        css = (ROOT / "rpg" / "app.css").read_text(encoding="utf-8")
        script = (ROOT / "rpg" / "app.js").read_text(encoding="utf-8")

        self.assertIn("#touchpad .kb-row", css)
        self.assertIn(".rom-card.is-selected", css)
        self.assertIn(".footer-action", css)
        self.assertIn(".desktop-controls", css)
        self.assertIn(".save-slot-card", css)
        self.assertIn("100dvh", css)
        self.assertIn("safe-area-inset-bottom", css)
        self.assertIn("overscroll-behavior-y: none", css)
        self.assertIn("-webkit-overflow-scrolling: touch", css)
        self.assertIn("touch-action: pan-y", css)
        self.assertIn("touch-action: none", css)
        self.assertIn("scrollbar-width: none", css)
        self.assertIn(".rom-list::-webkit-scrollbar", css)
        self.assertIn("@media (max-width: 520px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn('global.fetch("roms/catalog.json")', script)
        self.assertIn("arrayBufferToHex", script)
        self.assertIn("isMappedGameKey", script)
        self.assertIn("buildSavePayload", script)
        self.assertIn("parseSavePayload", script)
        self.assertIn('<link rel="icon" href="../favicon.png">', markup)
        self.assertIn('id="game-picker-open"', markup)
        self.assertIn('id="save-manager-open"', markup)
        self.assertIn('id="desktop-controls"', markup)
        self.assertIn('id="touchpad"', markup)
        self.assertNotIn('class="simulator-tools"', markup)
        self.assertNotIn("static/js", markup)
        self.assertNotIn("src_cross", markup)

    def test_catalog_has_one_entry_for_every_bundled_rom(self):
        catalog = json.loads(
            (ROOT / "rpg" / "roms" / "catalog.json").read_text(
                encoding="utf-8"
            )
        )
        catalog_ids = [item["id"] for item in catalog]
        rom_ids = sorted(
            path.stem
            for path in (ROOT / "rpg" / "roms").glob("*.lib")
        )

        self.assertEqual(len(catalog_ids), len(set(catalog_ids)))
        self.assertEqual(sorted(catalog_ids), rom_ids)


if __name__ == "__main__":
    unittest.main()
