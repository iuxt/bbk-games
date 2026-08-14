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
                "eebbk": "eebbk/index.html",
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
                "../js/lcd.js?ver=18",
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
                self.assertIn("../js/lcd.js?ver=18", markup)

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
            ["../js/game-page.js?v=1", "srs-anchor.js?v=2", "app.js?v=14"],
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


class EebbkSimulatorMarkupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parser = parse("eebbk/index.html")

    def test_uses_shared_game_center_chrome(self):
        self.assertEqual(self.parser.h1_count, 1)
        self.assertTrue(
            any("portal.css" in href for href in self.parser.stylesheets),
            f"portal.css not among stylesheets: {self.parser.stylesheets}",
        )
        self.assertIn("../index.html", self.parser.links)

    def test_screen_fills_lcd_panel_without_pixel_scale_controls(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        # 画面区存在；canvas 显示尺寸由 portal.css 的
        # .lcd-panel-screen canvas { width:100%; height:auto } 接管，填满 LCD 面板。
        self.assertIn('id="screen-wrapper"', markup)
        self.assertIn('id="screen"', markup)
        # 已移除会阻止画面填满的固定像素「缩放」控件，
        # 以及从未接线的「LCD 残影」「速度」控件。
        self.assertNotIn("emu-settings", markup)
        self.assertNotIn("scale-select", markup)
        self.assertNotIn('id="ghosting"', markup)
        self.assertNotIn("cpu-rate", markup)

    def test_catalog_lists_every_bundled_rom_exactly_once(self):
        catalog_path = ROOT / "eebbk" / "roms" / "catalog.json"
        self.assertTrue(catalog_path.is_file(), "eebbk/roms/catalog.json 缺失")

        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        catalog_ids = [item["id"] for item in catalog]

        rom_ids = sorted(p.stem for p in (ROOT / "eebbk" / "roms").glob("*.gam"))
        self.assertTrue(catalog_ids, "catalog 为空：未声明任何 rom")
        self.assertEqual(len(catalog_ids), len(set(catalog_ids)), "catalog id 重复")
        self.assertEqual(
            sorted(catalog_ids),
            rom_ids,
            "catalog id 与 roms/*.gam 文件名不一致",
        )

    def test_has_game_switcher_and_save_manager_hooks(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="current-game-name"', markup)
        self.assertIn('id="game-picker"', markup)
        self.assertIn('id="game-picker-open"', markup)
        self.assertIn('id="game-picker-use"', markup)
        self.assertIn('id="save-manager"', markup)
        self.assertIn('id="save-manager-open"', markup)
        self.assertIn('id="save-slot-list"', markup)
        self.assertIn('id="file-input"', markup)
        self.assertIn('id="save-input"', markup)
        self.assertIn('dialog.css', markup)

    def test_touchpad_switches_dictionary_keys_for_game_r_key(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        # 电子词典功能键：目录 / 输入法 / 删除
        self.assertIn('id="dict-row"', markup)
        self.assertIn('data-key="1" aria-label="目录"', markup)
        self.assertIn('data-key="32" aria-label="输入法"', markup)
        self.assertIn('data-key="45" aria-label="删除"', markup)
        # 游戏模式：去掉上述三个按钮，只保留一个 R 键（data-key="19"）
        self.assertIn('id="game-row"', markup)
        self.assertIn('data-key="19" aria-label="字母 R"', markup)

    def test_drops_legacy_save_buttons(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('id="load-btn"', markup)
        self.assertNotIn('id="save-btn"', markup)
        self.assertNotIn('id="load-btn-state"', markup)

    def test_dialog_css_has_system_tag_style(self):
        css = (ROOT / "eebbk" / "dialog.css").read_text(encoding="utf-8")
        self.assertIn(".rom-tag", css, "dialog.css 缺少 .rom-tag 系统标签样式")

    def test_save_slot_rows_never_shrink_below_content(self):
        # 回归：WebKit/Safari 在高度受限的网格里会把 auto 行压到卡片 min-height
        # （移动端为 0），导致按钮块溢出卡片底边、与下一槽位重叠（手机界面保存存档时）。
        # grid-auto-rows 必须保证行高不小于内容（min-content）。
        css = (ROOT / "eebbk" / "dialog.css").read_text(encoding="utf-8")
        self.assertIn(
            "grid-auto-rows: minmax(min-content, 1fr)",
            css,
            "dialog.css 的 .save-slot-list 缺少 minmax(min-content, 1fr) 行高约束",
        )


if __name__ == "__main__":
    unittest.main()
