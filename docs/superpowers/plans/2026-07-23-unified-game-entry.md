# Unified Game Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the root page with a polished, responsive electronic-dictionary-style game lobby while preserving every existing game route and all 三国霸业 settings.

**Architecture:** `index.html` will contain accessible, progressively enhanced lobby markup and ordinary fallback links. `css/portal.css` will own the electronic-dictionary visual system and responsive layout, while `js/portal.js` will own only settings persistence and drawer behavior; the existing `js/lcd.js` continues to provide device-aware 三国霸业 launching.

**Tech Stack:** Static HTML5, CSS3, browser JavaScript, existing jQuery and `js/lcd.js`, Python 3 standard-library tests, Node.js 24 built-in test runner.

## Global Constraints

- `/` is the only recommended game-lobby entry.
- `/bbk-games/index.html` remains a direct playable route and must not redirect.
- Preserve `/mt.html`, `/fm/index.html`, `/choose.html`, and `/get-sav.html`.
- Preserve `baye/mpage`, `baye/resolution`, and `baye/clearmode` exactly.
- Do not modify game engines, ROM files, save formats, or the React emulator bundle.
- Do not add runtime dependencies, image assets, accounts, cloud saves, search, favorites, or recent-game features.
- The lobby must work at 390×844 and 1440×900 without horizontal overflow.

## File Map

- Modify `index.html`: semantic lobby markup, four game links, 三国霸业 actions, settings dialog, and script/style loading.
- Create `css/portal.css`: theme tokens, electronic-dictionary shell, LCD panel, cards, controls, dialog, responsive layout, focus states, and reduced motion.
- Create `js/portal.js`: safe storage helpers, settings binding, dialog controller, keyboard handling, focus restoration, scroll locking, and enhanced 三国霸业 launch.
- Create `tests/test_portal_markup.py`: dependency-free structural and route contract tests for HTML and CSS.
- Create `tests/portal.test.mjs`: dependency-free unit tests for storage and dialog behavior.

---

### Task 1: Lock the portal contract and replace the root markup

**Files:**
- Create: `tests/test_portal_markup.py`
- Create: `css/portal.css` (empty behavior scaffold; implemented test-first in Task 3)
- Create: `js/portal.js` (empty behavior scaffold; implemented test-first in Task 2)
- Modify: `index.html`

**Interfaces:**
- Consumes: Existing routes `/bbk-games/index.html`, `/mt.html`, `/fm/index.html`, `/choose.html`, `/get-sav.html`, and existing global function `redirect()`.
- Produces: DOM IDs `settings-trigger`, `settings-dialog`, `settings-overlay`, `settings-close`, and `start-baye`; settings elements with `data-storage-key`; four elements with `data-game`.

- [ ] **Step 1: Write the failing structural tests**

Create `tests/test_portal_markup.py`:

```python
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
```

- [ ] **Step 2: Run the structural tests and verify they fail**

Run:

```bash
python3 -m unittest tests/test_portal_markup.py -v
```

Expected: `test_exposes_all_game_routes`, `test_preserves_baye_actions_and_dialog_hooks`, `test_preserves_storage_keys`, and `test_loads_portal_assets_and_existing_launcher` fail against the old page.

- [ ] **Step 3: Replace `index.html` with semantic, progressively enhanced markup**

Replace `index.html` with:

```html
<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#dfe3d1">
    <meta name="description" content="步步高电子词典经典游戏合集">
    <title>BBK 经典游戏</title>
    <link rel="icon" href="favicon.png">
    <link rel="stylesheet" href="css/portal.css">
</head>
<body>
    <main class="device-shell">
        <header class="device-header">
            <a class="brand" href="/" aria-label="返回 BBK 经典游戏首页">
                <span class="brand-mark">BBK</span>
                <span>经典游戏</span>
            </a>
            <span class="power-light" aria-hidden="true"></span>
        </header>

        <section class="lcd-panel" aria-labelledby="portal-title">
            <p class="lcd-kicker">GAME CENTER / 游戏中心</p>
            <h1 id="portal-title">请选择游戏<span aria-hidden="true">_</span></h1>
            <p class="lcd-help">点击游戏卡片即可开始</p>
        </section>

        <section class="game-section" aria-labelledby="game-list-title">
            <div class="section-heading">
                <h2 id="game-list-title">游戏列表</h2>
                <span>4 GAMES</span>
            </div>
            <div class="game-grid">
                <article class="game-card game-card-featured">
                    <a id="start-baye" class="game-link" href="pc.html" data-game="baye">
                        <span class="game-key" aria-hidden="true">01</span>
                        <span class="game-copy">
                            <strong>三国霸业</strong>
                            <small>策略 · 经典战役</small>
                        </span>
                        <span class="game-arrow" aria-hidden="true">›</span>
                    </a>
                    <button id="settings-trigger" class="settings-key" type="button"
                            aria-haspopup="dialog" aria-expanded="false"
                            aria-controls="settings-dialog">
                        <span aria-hidden="true">⚙</span>
                        <span class="sr-only">打开三国霸业设置</span>
                    </button>
                </article>

                <a class="game-card game-link" href="bbk-games/index.html" data-game="bbk">
                    <span class="game-key" aria-hidden="true">02</span>
                    <span class="game-copy">
                        <strong>电子词典游戏</strong>
                        <small>模拟器 · ROM 合集</small>
                    </span>
                    <span class="game-arrow" aria-hidden="true">›</span>
                </a>

                <a class="game-card game-link" href="mt.html" data-game="tower">
                    <span class="game-key" aria-hidden="true">03</span>
                    <span class="game-copy">
                        <strong>魔塔</strong>
                        <small>解谜 · 闯关冒险</small>
                    </span>
                    <span class="game-arrow" aria-hidden="true">›</span>
                </a>

                <a class="game-card game-link" href="fm/index.html" data-game="rpg">
                    <span class="game-key" aria-hidden="true">04</span>
                    <span class="game-copy">
                        <strong>RPG 游戏</strong>
                        <small>伏魔记 · 群侠传</small>
                    </span>
                    <span class="game-arrow" aria-hidden="true">›</span>
                </a>
            </div>
        </section>

        <footer class="device-footer">
            <span>WEB EDITION</span>
            <p>把经典电子词典游戏，重新装进口袋。</p>
        </footer>
    </main>

    <div id="settings-overlay" class="dialog-overlay" hidden>
        <section id="settings-dialog" class="settings-dialog" role="dialog"
                 aria-modal="true" aria-labelledby="settings-title">
            <header class="dialog-header">
                <div>
                    <p>GAME 01</p>
                    <h2 id="settings-title">三国霸业设置</h2>
                </div>
                <button id="settings-close" class="close-key" type="button"
                        aria-label="关闭设置">×</button>
            </header>

            <div class="settings-list">
                <label class="setting-row">
                    <span><strong>操作模式</strong><small>选择手机端控制方式</small></span>
                    <select data-storage-key="baye/mpage">
                        <option value="0">横屏 &amp; 触控</option>
                        <option value="1">竖屏 &amp; 键盘</option>
                        <option value="2">横屏 &amp; 手势</option>
                    </select>
                </label>
                <label class="setting-row">
                    <span><strong>分辨率</strong><small>调整游戏画面尺寸</small></span>
                    <select data-storage-key="baye/resolution">
                        <option value="0">4988</option>
                        <option value="1">加大</option>
                    </select>
                </label>
                <label class="setting-row">
                    <span><strong>像素锐化</strong><small>切换像素显示效果</small></span>
                    <select data-storage-key="baye/clearmode">
                        <option value="0">禁用</option>
                        <option value="1">启用</option>
                    </select>
                </label>
            </div>

            <nav class="dialog-actions" aria-label="三国霸业辅助功能">
                <a class="device-button" href="choose.html">选择版本</a>
                <a class="device-button" href="get-sav.html">传送存档</a>
            </nav>
        </section>
    </div>

    <noscript>
        <p class="noscript-note">JavaScript 已关闭；其他游戏入口仍可直接使用，三国霸业将进入桌面版。</p>
    </noscript>
    <script src="js/jquery.min.js"></script>
    <script src="js/lcd.js?ver=10"></script>
    <script src="js/portal.js"></script>
</body>
</html>
```

Create `css/portal.css` with only this non-behavioral scaffold:

```css
/* Portal theme is implemented test-first in Task 3. */
```

Create `js/portal.js` with only this non-behavioral scaffold:

```javascript
/* Portal behavior is implemented test-first in Task 2. */
```

- [ ] **Step 4: Run the structural tests and verify they pass**

Run:

```bash
python3 -m unittest tests/test_portal_markup.py -v
```

Expected: `Ran 6 tests` and `OK`.

- [ ] **Step 5: Commit the semantic portal**

```bash
git add index.html css/portal.css js/portal.js tests/test_portal_markup.py
git commit -m "feat: add unified game portal markup"
```

Expected: commit succeeds with `index.html`, the two non-behavioral asset scaffolds, and `tests/test_portal_markup.py`.

---

### Task 2: Add tested settings persistence and dialog behavior

**Files:**
- Create: `tests/portal.test.mjs`
- Modify: `js/portal.js`

**Interfaces:**
- Consumes: Task 1 DOM IDs and `data-storage-key` attributes; existing global `redirect()`.
- Produces: `globalThis.BBKPortal` with `readStoredValue`, `writeStoredValue`, `bindSettings`, `createDialogController`, and `init`.

- [ ] **Step 1: Write failing JavaScript unit tests**

Create `tests/portal.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

await import("../js/portal.js");
const Portal = globalThis.BBKPortal;

function makeClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
    };
}

function makeFocusable() {
    return {
        focused: false,
        attributes: {},
        focus() { this.focused = true; },
        setAttribute(name, value) { this.attributes[name] = value; },
    };
}

test("readStoredValue accepts valid values and defaults invalid values", () => {
    const storage = { getItem: () => "2" };
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1", "2"]), "2");
    storage.getItem = () => "unexpected";
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1", "2"]), "0");
});

test("storage errors fall back without throwing", () => {
    const storage = {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("blocked"); },
    };
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1"]), "0");
    assert.equal(Portal.writeStoredValue(storage, "mode", "1"), false);
});

test("bindSettings restores values and persists changes", () => {
    const saved = new Map([["baye/mpage", "1"]]);
    const storage = {
        getItem(key) { return saved.get(key) ?? null; },
        setItem(key, value) { saved.set(key, value); },
    };
    const select = {
        value: "",
        dataset: { storageKey: "baye/mpage" },
        options: [{ value: "0" }, { value: "1" }, { value: "2" }],
        addEventListener(type, handler) { this.changeHandler = handler; },
    };
    const document = { querySelectorAll: () => [select] };

    Portal.bindSettings(document, storage);
    assert.equal(select.value, "1");
    select.value = "2";
    select.changeHandler();
    assert.equal(saved.get("baye/mpage"), "2");
});

test("dialog controller opens, closes, locks scroll, and restores focus", () => {
    const overlay = { hidden: true };
    const opener = makeFocusable();
    const closeButton = makeFocusable();
    const body = { classList: makeClassList() };
    const controller = Portal.createDialogController({
        overlay,
        opener,
        closeButton,
        body,
    });

    controller.open();
    assert.equal(overlay.hidden, false);
    assert.equal(opener.attributes["aria-expanded"], "true");
    assert.equal(body.classList.contains("dialog-open"), true);
    assert.equal(closeButton.focused, true);

    controller.close();
    assert.equal(overlay.hidden, true);
    assert.equal(opener.attributes["aria-expanded"], "false");
    assert.equal(body.classList.contains("dialog-open"), false);
    assert.equal(opener.focused, true);
});
```

- [ ] **Step 2: Run the unit tests and verify they fail**

Run:

```bash
node --test tests/portal.test.mjs
```

Expected: FAIL with `TypeError: Portal.readStoredValue is not a function`; the scaffold module loads, but the behavior does not exist yet.

- [ ] **Step 3: Implement `js/portal.js`**

Create `js/portal.js`:

```javascript
(function (global) {
    "use strict";

    function readStoredValue(storage, key, validValues) {
        try {
            var value = storage.getItem(key);
            return validValues.indexOf(value) !== -1 ? value : "0";
        } catch (error) {
            return "0";
        }
    }

    function writeStoredValue(storage, key, value) {
        try {
            storage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function bindSettings(document, storage) {
        var controls = document.querySelectorAll("[data-storage-key]");
        Array.prototype.forEach.call(controls, function (control) {
            var validValues = Array.prototype.map.call(
                control.options,
                function (option) { return option.value; }
            );
            control.value = readStoredValue(
                storage,
                control.dataset.storageKey,
                validValues
            );
            control.addEventListener("change", function () {
                writeStoredValue(storage, control.dataset.storageKey, control.value);
            });
        });
    }

    function createDialogController(elements) {
        function open() {
            elements.overlay.hidden = false;
            elements.opener.setAttribute("aria-expanded", "true");
            elements.body.classList.add("dialog-open");
            elements.closeButton.focus();
        }

        function close() {
            elements.overlay.hidden = true;
            elements.opener.setAttribute("aria-expanded", "false");
            elements.body.classList.remove("dialog-open");
            elements.opener.focus();
        }

        return { open: open, close: close };
    }

    function init(document, storage) {
        bindSettings(document, storage);

        var overlay = document.getElementById("settings-overlay");
        var opener = document.getElementById("settings-trigger");
        var closeButton = document.getElementById("settings-close");
        var startLink = document.getElementById("start-baye");
        var controller = createDialogController({
            overlay: overlay,
            opener: opener,
            closeButton: closeButton,
            body: document.body,
        });

        opener.addEventListener("click", controller.open);
        closeButton.addEventListener("click", controller.close);
        overlay.addEventListener("click", function (event) {
            if (event.target === overlay) {
                controller.close();
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !overlay.hidden) {
                controller.close();
            }
        });
        startLink.addEventListener("click", function (event) {
            if (typeof global.redirect === "function") {
                event.preventDefault();
                global.redirect();
            }
        });

        return controller;
    }

    global.BBKPortal = {
        readStoredValue: readStoredValue,
        writeStoredValue: writeStoredValue,
        bindSettings: bindSettings,
        createDialogController: createDialogController,
        init: init,
    };

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", function () {
                init(global.document, global.localStorage);
            });
        } else {
            init(global.document, global.localStorage);
        }
    }
}(typeof window !== "undefined" ? window : globalThis));
```

- [ ] **Step 4: Run JavaScript and structural tests**

Run:

```bash
node --test tests/portal.test.mjs
python3 -m unittest tests/test_portal_markup.py -v
```

Expected: Node reports `4` passing tests; Python reports `Ran 5 tests` and `OK`.

- [ ] **Step 5: Commit portal behavior**

```bash
git add js/portal.js tests/portal.test.mjs
git commit -m "feat: add portal settings interactions"
```

Expected: commit succeeds with only `js/portal.js` and `tests/portal.test.mjs`.

---

### Task 3: Apply the visual system and complete browser verification

**Files:**
- Modify: `css/portal.css`
- Modify: `tests/test_portal_markup.py`

**Interfaces:**
- Consumes: Task 1 class names and Task 2 `dialog-open` body class.
- Produces: Responsive single-column layout below 760px, two-column layout at and above 760px, bottom-sheet dialog below 760px, centered dialog at and above 760px.

- [ ] **Step 1: Add failing CSS contract tests**

Add to `PortalMarkupTests` in `tests/test_portal_markup.py`:

```python
    def test_css_has_responsive_and_accessibility_contracts(self):
        css = (ROOT / "css" / "portal.css").read_text(encoding="utf-8")
        self.assertIn("@media (min-width: 760px)", css)
        self.assertIn("@media (prefers-reduced-motion: reduce)", css)
        self.assertIn(".game-grid", css)
        self.assertIn(".settings-dialog", css)
        self.assertIn(":focus-visible", css)
```

- [ ] **Step 2: Run the CSS contract test and verify it fails**

Run:

```bash
python3 -m unittest tests.test_portal_markup.PortalMarkupTests.test_css_has_responsive_and_accessibility_contracts -v
```

Expected: FAIL because the scaffold stylesheet does not yet contain `@media (min-width: 760px)`.

- [ ] **Step 3: Create the complete portal stylesheet**

Create `css/portal.css`:

```css
:root {
    --body: #c8cbbd;
    --shell: #dfe3d1;
    --shell-edge: #b4b9a9;
    --lcd: #c5d09b;
    --lcd-ink: #253024;
    --key: #4b5349;
    --key-edge: #30362f;
    --paper: rgba(255, 255, 255, .34);
    --line: rgba(48, 59, 46, .17);
    --accent: #ad4c3d;
    --focus: #d76145;
    --shadow: 0 24px 70px rgba(30, 35, 29, .22);
}

* { box-sizing: border-box; }

html { min-width: 320px; background: var(--body); }

body {
    min-height: 100vh;
    margin: 0;
    padding: 18px 12px;
    color: var(--lcd-ink);
    background:
        radial-gradient(circle at 50% -20%, #eef0e5 0, transparent 44%),
        var(--body);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

a { color: inherit; }
button, select { font: inherit; }

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

.device-shell {
    width: min(100%, 980px);
    margin: 0 auto;
    padding: 18px;
    border: 1px solid var(--shell-edge);
    border-radius: 28px 28px 52px 28px;
    background: var(--shell);
    box-shadow: var(--shadow), inset 0 1px 0 rgba(255,255,255,.65);
}

.device-header,
.section-heading,
.dialog-header,
.game-link,
.game-card-featured {
    display: flex;
    align-items: center;
}

.device-header { justify-content: space-between; margin-bottom: 16px; }

.brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: #3e473d;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .08em;
    text-decoration: none;
}

.brand-mark {
    padding: 5px 7px;
    border-radius: 5px;
    color: #e9ecdf;
    background: var(--key);
    box-shadow: inset 0 -2px 0 var(--key-edge);
    letter-spacing: .04em;
}

.power-light {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #e76543;
    box-shadow: 0 0 0 4px rgba(231,101,67,.14), 0 0 12px rgba(231,101,67,.28);
}

.lcd-panel {
    position: relative;
    overflow: hidden;
    padding: 24px 19px;
    border: 7px solid #4c5449;
    border-radius: 11px;
    background: var(--lcd);
    box-shadow: inset 0 0 0 2px #899474, inset 0 8px 25px rgba(62,76,55,.11);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.lcd-panel::after {
    position: absolute;
    inset: 0;
    content: "";
    pointer-events: none;
    background: repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 3px,
        rgba(45,57,42,.035) 4px
    );
}

.lcd-kicker,
.lcd-help {
    margin: 0;
    font-size: 10px;
    letter-spacing: .08em;
    opacity: .65;
}

.lcd-panel h1 {
    margin: 8px 0 10px;
    font-size: clamp(27px, 8vw, 48px);
    line-height: 1;
    letter-spacing: -.06em;
}

.game-section { margin-top: 22px; }
.section-heading { justify-content: space-between; margin-bottom: 10px; }
.section-heading h2 { margin: 0; font-size: 15px; }
.section-heading span { font: 700 9px/1 ui-monospace, monospace; opacity: .52; }
.game-grid { display: grid; gap: 10px; }

.game-card {
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.45);
}

.game-card-featured { padding-right: 8px; }
.game-card-featured .game-link { flex: 1; min-width: 0; }

.game-link {
    min-height: 76px;
    gap: 12px;
    padding: 12px;
    text-decoration: none;
    transition: transform .16s ease, background-color .16s ease;
}

.game-key {
    display: grid;
    place-items: center;
    flex: 0 0 48px;
    height: 48px;
    border-radius: 8px;
    color: #dbe1c3;
    background: var(--key);
    box-shadow: inset 0 -4px 0 var(--key-edge), 0 3px 7px rgba(37,45,35,.18);
    font: 800 13px/1 ui-monospace, monospace;
}

.game-copy { min-width: 0; }
.game-copy strong, .game-copy small { display: block; }
.game-copy strong { font-size: 15px; }
.game-copy small { margin-top: 5px; font-size: 11px; opacity: .62; }
.game-arrow { margin-left: auto; font-size: 25px; opacity: .6; }

.settings-key,
.close-key {
    border: 0;
    color: #edf0e5;
    background: var(--key);
    box-shadow: inset 0 -3px 0 var(--key-edge);
    cursor: pointer;
}

.settings-key {
    flex: 0 0 42px;
    height: 42px;
    border-radius: 8px;
}

.device-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 15px;
    margin-top: 22px;
    color: #50594e;
}

.device-footer span { font: 800 9px/1 ui-monospace, monospace; letter-spacing: .08em; }
.device-footer p { margin: 0; font-size: 10px; opacity: .62; text-align: right; }

.dialog-overlay {
    position: fixed;
    z-index: 20;
    inset: 0;
    padding: 14px;
    background: rgba(25,31,24,.6);
    backdrop-filter: blur(3px);
}

.dialog-overlay:not([hidden]) {
    display: flex;
    align-items: flex-end;
    justify-content: center;
}

.settings-dialog {
    width: min(100%, 560px);
    max-height: calc(100vh - 28px);
    overflow: auto;
    padding: 18px;
    border: 1px solid var(--shell-edge);
    border-radius: 20px 20px 14px 14px;
    background: var(--shell);
    box-shadow: 0 26px 80px rgba(20,25,19,.42);
}

.dialog-header { justify-content: space-between; gap: 20px; }
.dialog-header p { margin: 0 0 3px; font: 800 9px/1 ui-monospace, monospace; opacity: .55; }
.dialog-header h2 { margin: 0; font-size: 20px; }

.close-key {
    flex: 0 0 38px;
    height: 38px;
    border-radius: 8px;
    font-size: 23px;
}

.settings-list {
    margin-top: 17px;
    border: 2px solid #63705e;
    border-radius: 10px;
    background: var(--lcd);
    box-shadow: inset 0 0 0 2px #98a27e;
}

.setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 13px;
    border-bottom: 1px dashed rgba(46,56,43,.27);
}

.setting-row:last-child { border-bottom: 0; }
.setting-row strong, .setting-row small { display: block; }
.setting-row strong { font-size: 13px; }
.setting-row small { margin-top: 3px; font-size: 9px; opacity: .6; }

.setting-row select {
    max-width: 48%;
    min-height: 36px;
    border: 1px solid #505a4c;
    border-radius: 7px;
    color: #eef0e7;
    background: var(--key);
    padding: 0 27px 0 9px;
}

.dialog-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 14px; }

.device-button {
    padding: 12px 10px;
    border-radius: 8px;
    color: #eef0e7;
    background: var(--key);
    box-shadow: inset 0 -4px 0 var(--key-edge);
    font-size: 12px;
    font-weight: 800;
    text-align: center;
    text-decoration: none;
}

.dialog-open { overflow: hidden; }
.noscript-note { width: min(100%, 980px); margin: 12px auto 0; font-size: 12px; text-align: center; }

.game-link:hover { background: rgba(255,255,255,.2); }
.game-link:active, .device-button:active, .settings-key:active, .close-key:active { transform: translateY(2px); }

:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
}

@media (min-width: 760px) {
    body { padding: 38px 24px; }
    .device-shell { padding: 28px; }
    .lcd-panel { padding: 32px 28px; }
    .game-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .dialog-overlay:not([hidden]) { align-items: center; }
    .settings-dialog { border-radius: 20px; padding: 22px; }
}

@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        scroll-behavior: auto !important;
        transition-duration: .01ms !important;
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
    }
}
```

- [ ] **Step 4: Run all automated tests**

Run:

```bash
python3 -m unittest tests/test_portal_markup.py -v
node --test tests/portal.test.mjs
git diff --check
```

Expected: Python reports `Ran 7 tests` and `OK`; Node reports `4` passing tests; `git diff --check` prints no output.

- [ ] **Step 5: Verify the lobby in real browsers**

Start a static server:

```bash
python3 -m http.server 4173
```

Using the available browser automation, verify:

1. At `390×844`, `document.documentElement.scrollWidth === 390`, `.game-grid` has one computed column, and the dialog aligns to the bottom.
2. At `1440×900`, `.game-grid` has two computed columns and the dialog is vertically centered.
3. The browser loads `/`, `/bbk-games/index.html`, `/mt.html`, and `/fm/index.html` without HTTP errors.
4. Clicking the settings key opens the dialog, `Escape` closes it, and focus returns to `#settings-trigger`.
5. Changing all three selects, reloading, and reopening the dialog preserves their values.
6. On desktop, clicking `#start-baye` navigates to a URL beginning with `/pc.html?name=`.
7. Browser console contains no uncaught errors on `/`.

Expected: all seven checks pass; save mobile and desktop screenshots as temporary QA artifacts outside Git.

- [ ] **Step 6: Commit the completed visual portal**

```bash
git add css/portal.css tests/test_portal_markup.py
git commit -m "style: add electronic dictionary portal theme"
```

Expected: commit succeeds and `git status --short` is empty.
