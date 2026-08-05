# EEBBK 游戏切换 + 分槽存档管理 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 eebbk 模拟器页面加入「选择游戏」对话框（列表来自 `eebbk/roms/` 的 4 个伏魔记版本，热切换）与「按游戏分槽的存档管理」对话框（含自动断点续玩），界面参考 rpg。

**Architecture:** 数据层扁平化 rom + catalog.json 清单；逻辑层在 `glue.js` 复用内核 `_web_load_game`（热切换，不 reload）/ `_web_save` / `_web_load`（存档），并导出纯函数供单测；样式层 eebbk 自带 `dialog.css`（不动 rpg，避开 markup 测试约束）；构建层在白名单中补 `roms/` 复制。

**Tech Stack:** 原生 JS（Emscripten wasm 内核）、HTML/CSS、`node --test`（JS 纯函数）、`python3 -m unittest`（HTML markup / 静态资源）、`scripts/build-site.mjs`（站点构建）。

**参考 spec:** `docs/superpowers/specs/2026-08-05-eebbk-game-switcher-design.md`

---

## File Structure

| 文件 | 职责 |
|---|---|
| `eebbk/roms/catalog.json` | 游戏清单 `[{id,name}]`，picker 数据源 |
| `eebbk/roms/fmj-1.0.gam` ~ `fmj-1.3.gam` | 扁平化的 4 个 rom（热切换 fetch 目标） |
| `eebbk/dialog.css` | game-picker + save-manager 对话框样式（复制自 rpg 并适配） |
| `eebbk/style.css` | 补桌面态 `.footer-action`；保留画面层 / 触控样式 |
| `eebbk/index.html` | footer 改造、两个对话框 DOM、标题 id、dialog.css 引用 |
| `eebbk/glue.js` | picker 状态机、save-manager、热切换、存档编解码、自动续玩、bootstrap 恢复；导出 `globalThis.BBK4980Glue` |
| `scripts/build-site.mjs` | emuRuntime 段补 `roms/` 递归复制 |
| `tests/eebbk.test.mjs` | glue.js 纯函数单元测试（新建） |
| `tests/test_portal_markup.py` | 追加 eebbk 对话框结构 + catalog/rom 一致性断言 |

---

## Task 1: 扁平化 rom + catalog 清单 + 一致性测试

**Files:**
- Create: `eebbk/roms/catalog.json`
- Move: `eebbk/roms/1.0伏魔记完整版/Rpg-11.gam` → `eebbk/roms/fmj-1.0.gam`（其余 3 个同理）
- Delete: 4 个空的版本子目录
- Modify: `tests/test_portal_markup.py`（新增 eebbk catalog 一致性测试）

- [ ] **Step 1: 写失败的 catalog 一致性测试**

在 `tests/test_portal_markup.py` 的 `EebbkSimulatorMarkupTests` 类内追加方法：

```python
    def test_catalog_lists_every_bundled_rom_exactly_once(self):
        catalog_path = ROOT / "eebbk" / "roms" / "catalog.json"
        self.assertTrue(catalog_path.is_file(), "eebbk/roms/catalog.json 缺失")

        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        catalog_ids = [item["id"] for item in catalog]

        rom_ids = sorted(p.stem for p in (ROOT / "eebbk" / "roms").glob("*.gam"))
        self.assertEqual(len(catalog_ids), len(set(catalog_ids)), "catalog id 重复")
        self.assertEqual(
            sorted(catalog_ids),
            rom_ids,
            "catalog id 与 roms/*.gam 文件名不一致",
        )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m unittest tests.test_portal_markup.EebbkSimulatorMarkupTests -v`
Expected: FAIL（catalog.json 缺失 / glob 为空）

- [ ] **Step 3: 创建 catalog.json**

写入 `eebbk/roms/catalog.json`：

```json
[
  {"id": "fmj-1.0", "name": "伏魔记 1.0"},
  {"id": "fmj-1.1", "name": "伏魔记 1.1"},
  {"id": "fmj-1.2", "name": "伏魔记 1.2"},
  {"id": "fmj-1.3", "name": "伏魔记 1.3"}
]
```

- [ ] **Step 4: 扁平化移动 rom 文件**

Run（注意 `1.3` 原文件名是小写 `rpg-11.gam`）:

```bash
cd eebbk/roms
mv "1.0伏魔记完整版/Rpg-11.gam" fmj-1.0.gam
mv "1.1伏魔记完整版/Rpg-11.gam" fmj-1.1.gam
mv "1.2伏魔记完整版/Rpg-11.gam" fmj-1.2.gam
mv "1.3伏魔记完整版/rpg-11.gam" fmj-1.3.gam
rmdir "1.0伏魔记完整版" "1.1伏魔记完整版" "1.2伏魔记完整版" "1.3伏魔记完整版"
cd ../..
```

Expected: `eebbk/roms/` 下剩 `catalog.json` + `fmj-1.0.gam`~`fmj-1.3.gam`，无子目录。

- [ ] **Step 5: 运行测试确认通过**

Run: `python3 -m unittest tests.test_portal_markup.EebbkSimulatorMarkupTests -v`
Expected: PASS（4 个测试全过）

- [ ] **Step 6: 提交**

```bash
git add eebbk/roms/catalog.json eebbk/roms/fmj-1.0.gam eebbk/roms/fmj-1.1.gam eebbk/roms/fmj-1.2.gam eebbk/roms/fmj-1.3.gam tests/test_portal_markup.py
git commit -m "feat(eebbk): 扁平化 roms 并新增 catalog 清单"
```

---

## Task 2: 构建脚本补 roms 复制（防线上 404）

**Files:**
- Modify: `scripts/build-site.mjs`（emuRuntime 复制段，约 33-63 行）

- [ ] **Step 1: 在 emuRuntime 复制段新增 roms 目录复制**

定位 `scripts/build-site.mjs` 中这段（`for (const rel of emuRuntime) {...}` 之后、`console.log("copied eebbk runtime ...")` 之前）：

```js
    console.log(`copied eebbk runtime (${emuRuntime.length} files)`);
```

在其**之前**插入 roms 目录复制块：

```js
    // eebbk 游戏目录（catalog.json + 各版本 .gam）→ dist/client/eebbk/roms/
    await cp(
        path.join(emuSrc, "roms"),
        path.join(emuOut, "roms"),
        { recursive: true }
    ).catch(() => {
        throw new Error("eebbk/roms/ 目录缺失，无法复制游戏清单。");
    });
    console.log("copied eebbk/roms (catalog + roms)");
```

- [ ] **Step 2: 构建并验证产物含 roms**

Run: `npm run build`
Expected: 输出含 `copied eebbk/roms (catalog + roms)`，且 `dist/client/eebbk/roms/` 下有 `catalog.json` + 4 个 `.gam`。

验证命令：

```bash
ls dist/client/eebbk/roms/
```
Expected: 列出 `catalog.json fmj-1.0.gam fmj-1.1.gam fmj-1.2.gam fmj-1.3.gam`

- [ ] **Step 3: 全量测试确认无回归**

Run: `npm test`
Expected: 全部 PASS（build-site 改动不影响 node/python 测试）

- [ ] **Step 4: 提交**

```bash
git add scripts/build-site.mjs
git commit -m "build: 构建产物纳入 eebbk/roms 游戏清单"
```

---

## Task 3: glue.js 纯函数 + 导出 + 单元测试（TDD）

把 `glue.js` 改造为「可在 node 中 import（纯函数可测）+ 浏览器中正常运行」的结构（参考 `rpg/app.js` 的 `global.BBKSimulator` 导出模式）。

**Files:**
- Modify: `eebbk/glue.js`（顶部插入纯函数 + 导出 + DOM 守卫）
- Create: `tests/eebbk.test.mjs`

- [ ] **Step 1: 写失败的纯函数测试**

创建 `tests/eebbk.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";

await import("../eebbk/glue.js");
const G = globalThis.BBK4980Glue;

test("BBK4980Glue is exported", () => {
    assert.ok(G, "globalThis.BBK4980Glue 未导出");
});

test("base64 round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 65]);
    assert.deepEqual(Array.from(G.base64ToBytes(G.bytesToBase64(bytes))), Array.from(bytes));
});

test("base64 handles empty and large buffers", () => {
    assert.equal(G.bytesToBase64(new Uint8Array([])), "");
    assert.equal(G.base64ToBytes("").length, 0);
    const big = new Uint8Array(40000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const rt = G.base64ToBytes(G.bytesToBase64(big));
    assert.equal(rt.length, big.length);
    assert.equal(rt[12345], big[12345]);
});

test("romStorageId prefers catalog id", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(G.romStorageId(bytes, "fmj-1.0"), "fmj-1.0");
});

test("romStorageId hashes local roms stably", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([3, 2, 1]);
    assert.equal(G.romStorageId(a, ""), G.romStorageId(b, ""), "相同内容须同 id");
    assert.notEqual(G.romStorageId(a, ""), G.romStorageId(c, ""), "不同内容须不同 id");
    assert.match(G.romStorageId(a, ""), /^local-/);
});

test("slotKey and autosaveKey format and range", () => {
    assert.equal(G.slotKey("fmj-1.0", 0), "sav/gamesave0-fmj-1.0");
    assert.equal(G.slotKey("fmj-1.0", 2), "sav/gamesave2-fmj-1.0");
    assert.equal(G.autosaveKey("fmj-1.0"), "sav/autosave-fmj-1.0");
    assert.throws(() => G.slotKey("fmj-1.0", 3));
    assert.throws(() => G.slotKey("fmj-1.0", -1));
});

test("buildSavePayload wraps base64 save data", () => {
    const payload = G.buildSavePayload("fmj-1.0", "伏魔记 1.0", 1, "QUJD", "2026-08-05T00:00:00.000Z");
    assert.equal(payload.app, "bbk-games");
    assert.equal(payload.type, "eebbk-save-slot");
    assert.equal(payload.version, 1);
    assert.equal(payload.romId, "fmj-1.0");
    assert.equal(payload.slot, 1);
    assert.equal(payload.data, "QUJD");
});

test("buildSavePayload rejects empty or non-base64 data", () => {
    assert.throws(() => G.buildSavePayload("fmj-1.0", "n", 0, ""));
    assert.throws(() => G.buildSavePayload("fmj-1.0", "n", 0, "不是 base64!!"));
});

test("parseSavePayload accepts a well-formed payload", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", romName: "伏魔记 1.0", slot: 0, data: "QUJD",
    });
    const r = G.parseSavePayload(src, "fmj-1.0");
    assert.equal(r.ok, true);
    assert.equal(r.payload.slot, 0);
});

test("parseSavePayload rejects rpg (dictionary) saves", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "dictionary-save-slot", version: 1,
        romId: "x", slot: 0, data: "ABCD",
    });
    assert.equal(G.parseSavePayload(src, "x").ok, false);
});

test("parseSavePayload rejects mismatched romId", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", slot: 0, data: "QUJD",
    });
    assert.equal(G.parseSavePayload(src, "fmj-1.1").ok, false);
});

test("parseSavePayload rejects out-of-range slot", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", slot: 3, data: "QUJD",
    });
    assert.equal(G.parseSavePayload(src, "fmj-1.0").ok, false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/eebbk.test.mjs`
Expected: FAIL（`BBK4980Glue is exported` 失败 → glbue.js 未导出）

- [ ] **Step 3: 重构 glue.js 顶部：纯函数 + 导出 + DOM 守卫**

把 `eebbk/glue.js` 开头的 IIFE 签名从 `(function() {` 改为接收 global，并在 `'use strict';` 之后、现有 `/* ---------- DOM refs ---------- */` 之前，插入纯函数与导出，再加 DOM 守卫。

将文件第 1-3 行：

```js
/* ---- glue.js — GAM4980 Web Emulator JS Glue ---- */

(function() {
  'use strict';
```

改为：

```js
/* ---- glue.js — GAM4980 Web Emulator JS Glue ---- */

(function (global) {
  'use strict';

  /* ---------- 纯函数（供 node 单测，不依赖 DOM / wasm） ---------- */

  function bytesToBase64(bytes) {
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(str) {
    if (!str) return new Uint8Array(0);
    const binary = global.atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function isValidBase64(value) {
    return typeof value === 'string' && value.length > 0 && value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function romStorageId(bytes, catalogId) {
    if (catalogId) return catalogId;
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return 'local-' + bytes.length + '-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  function slotKey(storageId, slot) {
    if (!storageId || !Number.isInteger(slot) || slot < 0 || slot > 2) {
      throw new Error('无效的游戏或存档槽位');
    }
    return 'sav/gamesave' + slot + '-' + storageId;
  }

  function autosaveKey(storageId) {
    if (!storageId) throw new Error('无效的游戏');
    return 'sav/autosave-' + storageId;
  }

  function buildSavePayload(storageId, gameName, slot, base64Data, exportedAt) {
    if (!isValidBase64(base64Data)) {
      throw new Error('存档数据为空或不是合法 base64');
    }
    slotKey(storageId, slot);  // 复用其范围校验
    return {
      app: 'bbk-games',
      type: 'eebbk-save-slot',
      version: 1,
      romId: storageId,
      romName: gameName || storageId,
      slot: slot,
      data: base64Data,
      exportedAt: exportedAt || new Date().toISOString()
    };
  }

  function parseSavePayload(source, expectedStorageId) {
    let payload;
    try {
      payload = typeof source === 'string' ? JSON.parse(source) : source;
    } catch (e) {
      return { ok: false, error: '无法读取备份文件。' };
    }
    if (!payload ||
        payload.app !== 'bbk-games' ||
        payload.type !== 'eebbk-save-slot' ||
        payload.version !== 1 ||
        !Number.isInteger(payload.slot) ||
        payload.slot < 0 || payload.slot > 2 ||
        !isValidBase64(payload.data) ||
        typeof payload.romId !== 'string' || !payload.romId) {
      return { ok: false, error: '这不是有效的 EEBBK 存档。' };
    }
    if (expectedStorageId && payload.romId !== expectedStorageId) {
      return { ok: false, error: '该存档属于其他游戏，不能导入到当前游戏。' };
    }
    return { ok: true, payload: payload };
  }

  global.BBK4980Glue = {
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    isValidBase64: isValidBase64,
    romStorageId: romStorageId,
    slotKey: slotKey,
    autosaveKey: autosaveKey,
    buildSavePayload: buildSavePayload,
    parseSavePayload: parseSavePayload
  };

  /* ---------- 以下依赖 DOM / wasm，仅在浏览器执行 ---------- */
  if (!global.document) return;
```

然后**把文件末尾**的 IIFE 收尾 `})();` 改为：

```js
}(typeof window !== "undefined" ? window : globalThis));
```

（现有 DOM refs、render、frame、loadGame、事件绑定、bootstrap 等代码整体保留不动，位于上面 `if (!global.document) return;` 之后。）

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/eebbk.test.mjs`
Expected: 12 个测试全 PASS

- [ ] **Step 5: 确认未破坏其他测试**

Run: `npm test`
Expected: 全部 PASS（rpg simulator 测试、portal markup、static assets 均不受影响）

- [ ] **Step 6: 提交**

```bash
git add eebbk/glue.js tests/eebbk.test.mjs
git commit -m "refactor(eebbk): glue.js 导出纯函数并补单测"
```

---

## Task 4: 对话框样式 dialog.css + footer-action

**Files:**
- Create: `eebbk/dialog.css`
- Modify: `eebbk/style.css`（补桌面态 footer-action）

- [ ] **Step 1: 创建 dialog.css（复制 rpg/app.css 对话框样式并适配）**

创建 `eebbk/dialog.css`，内容 = `rpg/app.css` 中以下选择器的规则**原样复制**（这些是 eebbk 缺失、需要自带的对话框样式；基础类 `.dialog-overlay` / `.device-button` / `.dialog-open` 已在 `portal.css`，不要重复）：

从 `rpg/app.css` 复制这些选择器块（按原顺序）：
`.game-picker-overlay` `.game-picker-dialog` `.game-picker-display` `.game-picker-display h2` `.game-search` `.game-search input` `.game-search input::placeholder` `.rom-list` `.rom-list::-webkit-scrollbar` `.rom-card` `.rom-card::after` `.rom-card.is-selected` `.rom-card.is-selected::after` `.rom-number` `.rom-name` `.empty-result` `.dialog-error` `.dialog-status` `.game-picker-actions` `.game-picker-actions .device-button` `.import-button` `.primary-button` `.primary-button:disabled` `.dialog-busy` `.dialog-busy span` `.save-manager-overlay` `.save-manager-dialog` `.save-manager-help` `.save-slot-list` `.save-slot-list::-webkit-scrollbar` `.save-slot-card` `.save-slot-card.has-save` `.save-slot-number` `.save-slot-copy` `.save-slot-copy strong/small` `.save-slot-actions` `.slot-action` `.slot-action-primary` `.slot-action:active` `.slot-action:disabled` `.save-manager-actions` `.save-manager-actions .device-button` `[hidden]`。

再复制 `rpg/app.css` 末尾响应式分支中与对话框/footer 相关的规则：`@media (max-width: 520px)` 内的 `.game-picker-overlay, .save-manager-overlay` / `.game-picker-dialog, .save-manager-dialog` / `.game-picker-display` / `.game-picker-display h2` / `.rom-list` / `.rom-card` / `.game-picker-actions` / `.import-button` / `.save-slot-list` / `.save-slot-card` / `.save-slot-actions` / `.save-manager-actions .device-button` / `.utility-footer` / `.footer-actions` / `.footer-link`，以及 `@supports (height: 100dvh)` 的 `@media (max-width: 520px)` 块、`@media (prefers-reduced-motion: reduce)` 块。

文件开头加注释：

```css
/* eebbk 对话框（game-picker / save-manager）样式。
   复制自 rpg/app.css 的对应选择器并按 eebbk 差异微调；
   基础类 .dialog-overlay / .device-button / .dialog-open 见 ../css/portal.css。 */
```

- [ ] **Step 2: 微调 save-slot-actions 为 2×2（eebbk 每槽 4 按钮）**

在 `eebbk/dialog.css` 中，把从 rpg 复制来的：

```css
.save-slot-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 7px;
    margin-top: auto;
}
```

保持不变（2 列即 2×2，容纳 保存/读取/导出/导入 四个按钮）。无需改动——记录此步确认。

- [ ] **Step 3: style.css 补桌面态 footer-action**

在 `eebbk/style.css` 末尾（`@media (prefers-reduced-motion: reduce)` 块**之前**）追加：

```css
/* footer 操作按钮（桌面态）。窄屏布局见下方 media query。
   规则与 rpg/app.css 的 .footer-action 一致，eebbk 此前缺失。 */
.footer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
}

.footer-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 36px;
    margin: 0;
    padding: 0 14px 3px;
    border: 1px solid var(--key-edge);
    border-radius: 8px;
    color: #eef0e7;
    background: var(--key);
    box-shadow: inset 0 -3px 0 var(--key-edge), 0 2px 5px rgba(37, 45, 35, .18);
    font-size: 11px;
    font-weight: 800;
    cursor: pointer;
    -webkit-appearance: none;
    touch-action: manipulation;
}

.footer-action:hover,
.footer-action:focus-visible {
    background: #596257;
}

.footer-action:active {
    padding-top: 2px;
    padding-bottom: 1px;
    box-shadow: inset 0 -1px 0 var(--key-edge);
    transform: translateY(2px);
}

.footer-action:disabled {
    cursor: not-allowed;
    opacity: .46;
    transform: none;
}

.footer-link {
    font-size: 11px;
    font-weight: 800;
    text-decoration: none;
}
```

注意：style.css 现有的窄屏 `@media (max-width: 759px)` 内已有 `.footer-actions { display: grid; ... }`，会覆盖上面桌面态——保留不动（窄屏走 grid）。

- [ ] **Step 4: 提交**

```bash
git add eebbk/dialog.css eebbk/style.css
git commit -m "style(eebbk): 新增对话框样式并补 footer-action"
```

---

## Task 5: index.html 结构 + markup 测试

**Files:**
- Modify: `eebbk/index.html`（footer、两个对话框、标题 id、dialog.css 引用）
- Modify: `tests/test_portal_markup.py`（追加 eebbk 结构断言）

- [ ] **Step 1: 写失败的 markup 测试**

在 `tests/test_portal_markup.py` 的 `EebbkSimulatorMarkupTests` 类内追加：

```python
    def test_has_game_switcher_and_save_manager_hooks(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="current-game-name"', markup)
        self.assertIn('id="game-picker"', markup)
        self.assertIn('id="game-picker-open"', markup)
        self.assertIn('id="game-picker-use"', markup)
        self.assertIn('id="save-manager"', markup)
        self.assertIn('id="save-manager-open"', markup)
        self.assertIn('id="save-slot-list"', markup)
        self.assertIn('dialog.css', markup)

    def test_drops_legacy_save_buttons(self):
        markup = (ROOT / "eebbk" / "index.html").read_text(encoding="utf-8")
        self.assertNotIn('id="load-btn"', markup)
        self.assertNotIn('id="save-btn"', markup)
        self.assertNotIn('id="load-btn-state"', markup)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python3 -m unittest tests.test_portal_markup.EebbkSimulatorMarkupTests -v`
Expected: FAIL（新 id 不存在 / 旧 id 仍存在）

- [ ] **Step 3: index.html 引用 dialog.css**

在 `eebbk/index.html` 的 `<link rel="stylesheet" href="style.css?v=6">` 之后新增一行：

```html
    <link rel="stylesheet" href="dialog.css?v=1">
```

- [ ] **Step 4: 标题加 id**

把：

```html
            <h1>EEBBK模拟器</h1>
```

改为：

```html
            <h1 id="current-game-name">EEBBK模拟器</h1>
```

- [ ] **Step 5: 改造 footer**

把整个 `<footer class="device-footer utility-footer">...</footer>` 替换为：

```html
        <footer class="device-footer utility-footer">
            <span>SIMULATOR · 朗文4980</span>
            <nav class="footer-actions" aria-label="模拟器辅助功能">
                <button id="game-picker-open" class="footer-action" type="button"
                        aria-haspopup="dialog" aria-controls="game-picker" aria-expanded="false">
                    选择游戏
                </button>
                <button id="save-manager-open" class="footer-action" type="button"
                        aria-haspopup="dialog" aria-controls="save-manager" aria-expanded="false"
                        disabled>
                    存档管理
                </button>
                <a class="footer-link" href="../index.html">‹ 返回游戏中心</a>
            </nav>
        </footer>
```

- [ ] **Step 6: 新增 game-picker 对话框**

在 `</main>` 之后、`<noscript>` 之前插入：

```html
    <div id="game-picker" class="dialog-overlay game-picker-overlay" hidden>
        <section class="game-picker-dialog" role="dialog" aria-modal="true" tabindex="-1"
                 aria-labelledby="game-picker-title">
            <header class="lcd-panel game-picker-display">
                <p class="lcd-kicker">ROM COLLECTION / 游戏合集</p>
                <h2 id="game-picker-title">选择游戏<span aria-hidden="true">_</span></h2>
                <p id="game-count" class="lcd-help">正在读取游戏目录…</p>
            </header>

            <div id="game-list" class="rom-list" aria-live="polite">
                <p class="loading-card">正在读取游戏目录…</p>
            </div>

            <p id="game-picker-error" class="dialog-error" role="alert" hidden></p>

            <footer class="game-picker-actions">
                <label class="device-button import-button" for="file-input">
                    导入 .gam
                </label>
                <input id="file-input" class="sr-only" type="file" accept=".gam">
                <button id="game-picker-close" class="device-button" type="button">取消</button>
                <button id="game-picker-use" class="device-button primary-button" type="button" disabled>
                    使用
                </button>
            </footer>

            <div id="game-picker-busy" class="dialog-busy" role="status" hidden>
                <span>游戏载入中…</span>
            </div>
        </section>
    </div>
```

注意：原 placeholder 内的 `<input type="file" id="file-input" ...>` 需删除（已迁入 picker；`#file-input` 仍被导入逻辑引用）。把 `<div id="placeholder" ...>` 内的那行 `<input type="file" id="file-input" accept=".gam" hidden>` 移除。

- [ ] **Step 7: 新增 save-manager 对话框**

在 game-picker 对话框之后插入：

```html
    <div id="save-manager" class="dialog-overlay save-manager-overlay" hidden>
        <section class="save-manager-dialog" role="dialog" aria-modal="true"
                 aria-labelledby="save-manager-title">
            <header class="lcd-panel game-picker-display">
                <p class="lcd-kicker">CURRENT GAME / 当前游戏</p>
                <h2 id="save-manager-title">存档管理<span aria-hidden="true">_</span></h2>
                <p id="save-game-name" class="lcd-help">尚未选择游戏</p>
            </header>

            <p class="save-manager-help">保存当前进度到槽位、读取槽位，或导出/导入备份。存档按游戏独立存放。</p>

            <div id="save-slot-list" class="save-slot-list" aria-live="polite"></div>

            <p id="save-manager-error" class="dialog-error" role="alert" hidden></p>
            <p id="save-manager-status" class="dialog-status" role="status" hidden></p>

            <footer class="save-manager-actions">
                <button id="save-manager-close" class="device-button" type="button">完成</button>
            </footer>

            <input id="save-input" class="sr-only" type="file" accept=".json,application/json">
        </section>
    </div>
```

- [ ] **Step 8: 运行测试确认通过**

Run: `python3 -m unittest tests.test_portal_markup -v`
Expected: 全部 PASS

- [ ] **Step 9: 确认资源测试通过（dialog.css 真实存在）**

Run: `python3 -m unittest tests.test_static_assets -v`
Expected: PASS（`test_all_html_local_assets_exist` 会校验 `dialog.css` 存在）

- [ ] **Step 10: 提交**

```bash
git add eebbk/index.html tests/test_portal_markup.py
git commit -m "feat(eebbk): 加入游戏选择与存档管理对话框结构"
```

---

## Task 6: glue.js picker 状态机 + 热切换

**Files:**
- Modify: `eebbk/glue.js`（在 DOM 守卫之后、现有事件绑定之前插入 picker 模块；改造导入入口）

- [ ] **Step 1: 新增 picker 状态与 DOM refs**

在 `glue.js` 的 `/* ---------- state ---------- */` 区块（现有 `let Module = null;` 等）追加：

```js
  const BBK = global.BBK4980Glue;   // 复用已导出的纯函数

  const picker = {
    games: [],
    selectedId: '',
    opener: null
  };
  let currentRom = { id: '', name: '' };   // 当前游戏标识（catalog id 或 local-<hash>）
```

并在现有 DOM refs 区块（`const canvas = ...` 附近）追加 picker/save-manager 用到的 ref：

```js
  const gamePicker       = document.getElementById('game-picker');
  const gamePickerOpen   = document.getElementById('game-picker-open');
  const gamePickerClose  = document.getElementById('game-picker-close');
  const gamePickerUse    = document.getElementById('game-picker-use');
  const gameList         = document.getElementById('game-list');
  const gameCount        = document.getElementById('game-count');
  const gamePickerError  = document.getElementById('game-picker-error');
  const gamePickerBusy   = document.getElementById('game-picker-busy');
  const fileInput        = document.getElementById('file-input');   // 取代原顶部声明
  const saveManager      = document.getElementById('save-manager');
  const saveManagerOpen  = document.getElementById('save-manager-open');
  const saveManagerClose = document.getElementById('save-manager-close');
  const saveGameName     = document.getElementById('save-game-name');
  const saveSlotList     = document.getElementById('save-slot-list');
  const saveManagerErr   = document.getElementById('save-manager-error');
  const saveManagerStat  = document.getElementById('save-manager-status');
  const saveInput        = document.getElementById('save-input');
  const currentGameName  = document.getElementById('current-game-name');
```

（删除原顶部 `const fileInput = document.getElementById('file-input');` 那行，避免重复声明。）

- [ ] **Step 2: 新增 setCurrentRom + UI 更新**

```js
  function readLS(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function writeLS(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function removeLS(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function setCurrentRom(id, name) {
    currentRom = { id: id || '', name: name || 'EEBBK模拟器' };
    writeLS('currentRomId', currentRom.id);
    writeLS('currentRomName', currentRom.name);
    currentGameName.textContent = currentRom.name;
    saveManagerOpen.disabled = !currentRom.id;
  }

  function restoreCurrentRomFromStorage() {
    const id = readLS('currentRomId');
    const name = readLS('currentRomName');
    if (id) setCurrentRom(id, name || id);
  }
```

- [ ] **Step 3: 新增 catalog 渲染**

```js
  function setPickerError(msg) {
    gamePickerError.textContent = msg || '';
    gamePickerError.hidden = !msg;
  }
  function setPickerBusy(busy, msg) {
    gamePickerBusy.querySelector('span').textContent = msg || '游戏载入中…';
    gamePickerBusy.hidden = !busy;
  }

  function updateSelection() {
    const cards = gameList.querySelectorAll('.rom-card');
    Array.prototype.forEach.call(cards, function (card) {
      const sel = card.dataset.romId === picker.selectedId;
      card.classList.toggle('is-selected', sel);
      card.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
    gamePickerUse.disabled = !picker.selectedId;
  }

  function renderGames(games) {
    const frag = document.createDocumentFragment();
    gameList.textContent = '';
    games.forEach(function (game, index) {
      const card = document.createElement('button');
      const num = document.createElement('span');
      const name = document.createElement('strong');
      card.type = 'button';
      card.className = 'rom-card';
      card.dataset.romId = game.id;
      card.setAttribute('aria-pressed', 'false');
      card.addEventListener('click', function () {
        picker.selectedId = game.id;
        setPickerError('');
        updateSelection();
      });
      num.className = 'rom-number';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(index + 1).padStart(2, '0');
      name.className = 'rom-name';
      name.textContent = game.name;
      card.appendChild(num);
      card.appendChild(name);
      frag.appendChild(card);
    });
    gameList.appendChild(frag);
    updateSelection();
  }

  function loadCatalog() {
    fetch('roms/catalog.json')
      .then(function (r) { if (!r.ok) throw new Error('目录读取失败'); return r.json(); })
      .then(function (games) {
        picker.games = games;
        picker.selectedId = currentRom.id && games.some(function (g) { return g.id === currentRom.id; })
          ? currentRom.id : '';
        gameCount.textContent = games.length + ' GAMES / 点击卡片后选择使用';
        renderGames(games);
      })
      .catch(function () {
        gameList.innerHTML = '<p class="loading-card">游戏目录读取失败，请刷新后重试</p>';
        gameCount.textContent = '目录载入失败';
      });
  }
```

- [ ] **Step 4: 新增热切换 useSelectedGame + 关机兜底**

```js
  function autosaveCurrent() {
    // 见 Task 8 实现；此处先放空壳，Task 8 填充。
  }

  function useSelectedGame() {
    if (!picker.selectedId) return;
    const game = picker.games.find(function (g) { return g.id === picker.selectedId; });
    const name = game ? game.name : picker.selectedId;
    setPickerError('');
    setPickerBusy(true, '游戏载入中…');

    fetch('roms/' + encodeURIComponent(picker.selectedId) + '.gam')
      .then(function (r) { if (!r.ok) throw new Error('ROM 下载失败'); return r.arrayBuffer(); })
      .then(function (buf) {
        if (exited) {
          // 内核已销毁：记下目标，reload 后由 bootstrap 自动加载
          writeLS('pendingRomId', picker.selectedId);
          writeLS('pendingRomName', name);
          location.reload();
          return;
        }
        autosaveCurrent();            // 切走前保存当前进度（Task 8 填充）
        loadGame(buf, name);          // 热加载：_web_load_game 重置 CPU
        setCurrentRom(picker.selectedId, name);
        closePicker();
      })
      .catch(function () {
        setPickerBusy(false);
        setPickerError('游戏载入失败，请检查网络后重试。');
      });
  }
```

- [ ] **Step 5: 新增对话框开关 + 键盘/焦点**

```js
  function openPicker() {
    picker.opener = document.activeElement;
    gamePicker.hidden = false;
    gamePickerOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('dialog-open');
    gamePicker.querySelector('.game-picker-dialog').focus();
  }
  function closePicker() {
    gamePicker.hidden = true;
    gamePickerOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('dialog-open');
    if (picker.opener && picker.opener.focus) picker.opener.focus();
  }

  function isMappedGameKey(event) {
    const k = event && (event.keyCode || event.which);
    return k === 13 || k === 27 || k === 32 || k === 37 || k === 38 || k === 39 || k === 40;
  }
```

- [ ] **Step 6: 绑定 picker 事件（替换原 loadBtn/fileInput 绑定）**

删除原 `loadBtn.addEventListener('click', ...)` 与 `fileInput.addEventListener('change', ...)`（导入 .gam 的两段）。改为：

```js
  gamePickerOpen.addEventListener('click', openPicker);
  gamePickerClose.addEventListener('click', closePicker);
  gamePickerUse.addEventListener('click', useSelectedGame);

  gamePicker.addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closePicker();
  });
  gamePicker.addEventListener('keydown', function (e) {
    if (isMappedGameKey(e)) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
  });
  [gamePickerOpen, gamePicker].forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  });

  // 导入外部 .gam（picker 底部「导入 .gam」按钮 → file-input）
  fileInput.addEventListener('change', function () {
    if (!fileInput.files.length) return;
    const f = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = function () {
      const bytes = new Uint8Array(reader.result);
      const id = BBK.romStorageId(bytes, '');
      loadGame(reader.result, f.name);
      setCurrentRom(id, f.name.replace(/\.gam$/i, ''));
      closePicker();
    };
    reader.readAsArrayBuffer(f);
  });
```

（原拖拽 `drop` 逻辑保留，但其 onload 改为也调用 setCurrentRom：见 Step 7。）

- [ ] **Step 7: 拖拽入口也记录 rom 标识**

把现有 `wrapper.addEventListener('drop', ...)` 内的 `reader.onload` 改为：

```js
    reader.onload = function () {
      const bytes = new Uint8Array(reader.result);
      const id = BBK.romStorageId(bytes, '');
      loadGame(reader.result, f.name);
      setCurrentRom(id, f.name.replace(/\.gam$/i, ''));
    };
```

- [ ] **Step 8: loadGame 成功后无需额外动作（rom 标识由调用方 setCurrentRom）**

`loadGame` 现有实现保留。确认其内部不依赖已删除的 `loadBtn`/旧 `fileInput` 顶部声明。

- [ ] **Step 9: bootstrap 前恢复 currentRom 标识 + 加载 catalog**

在 `glue.js` 末尾 `Gam4980Module({...}).then(function(mod){ ... })` 的 `.then` 内、`startEmulator()` 之后追加：

```js
    restoreCurrentRomFromStorage();
    loadCatalog();
```

- [ ] **Step 10: 全量测试确认无回归**

Run: `npm test`
Expected: 全部 PASS（纯函数与 markup 测试不受影响）

- [ ] **Step 11: 提交**

```bash
git add eebbk/glue.js
git commit -m "feat(eebbk): 游戏选择对话框与热切换"
```

---

## Task 7: glue.js 存档管理（save-manager）

**Files:**
- Modify: `eebbk/glue.js`

- [ ] **Step 1: 新增存档槽读写（基于内核 _web_save / _web_load）**

```js
  function captureState() {
    // 把当前内核状态序列化为 base64 字符串；内核未运行/未加载游戏时返回 null
    if (exited || !gameLoaded || !Module) return null;
    const size = Module._web_save_size();
    const ptr = Module._malloc(size);
    Module._web_save(ptr);
    const bytes = new Uint8Array(Module.HEAPU8.buffer, ptr, size).slice();
    Module._free(ptr);
    return { b64: BBK.bytesToBase64(bytes), size: size };
  }

  function restoreState(b64) {
    if (exited || !Module) return false;
    const bytes = BBK.base64ToBytes(b64);
    const ptr = Module._malloc(bytes.byteLength);
    Module.HEAPU8.set(bytes, ptr);
    Module._web_load(ptr, bytes.byteLength);
    Module._free(ptr);
    return true;
  }

  function readSlot(slot) {
    return currentRom.id ? readLS(BBK.slotKey(currentRom.id, slot)) : '';
  }
  function writeSlot(slot, b64, ts) {
    writeLS(BBK.slotKey(currentRom.id, slot), b64);
    writeLS(BBK.slotKey(currentRom.id, slot) + '.ts', ts);
  }
  function readSlotTs(slot) {
    return readLS(BBK.slotKey(currentRom.id, slot) + '.ts');
  }
```

- [ ] **Step 2: 新增状态消息**

```js
  function setSaveMsg(type, msg) {
    saveManagerErr.textContent = type === 'error' ? msg : '';
    saveManagerErr.hidden = type !== 'error' || !msg;
    saveManagerStat.textContent = type === 'status' ? msg : '';
    saveManagerStat.hidden = type !== 'status' || !msg;
  }
```

- [ ] **Step 3: 渲染 3 个槽位（每槽 4 按钮）**

```js
  function makeSlotBtn(label, action, slot, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot-action' + ((action === 'save' || action === 'load') ? ' slot-action-primary' : '');
    b.dataset.saveAction = action;
    b.dataset.slot = String(slot);
    b.textContent = label;
    b.disabled = !!disabled;
    return b;
  }

  function fmtSize(b64) {
    const bytes = Math.floor(b64.length * 3 / 4);
    return (bytes / 1024).toFixed(0) + ' KB';
  }

  function renderSaveSlots() {
    saveGameName.textContent = currentRom.name || '尚未选择游戏';
    const frag = document.createDocumentFragment();
    saveSlotList.textContent = '';
    for (let slot = 0; slot < 3; slot += 1) {
      const data = readSlot(slot);
      const ts = readSlotTs(slot);
      const card = document.createElement('article');
      const num = document.createElement('span');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      const actions = document.createElement('span');
      card.className = 'save-slot-card' + (data ? ' has-save' : '');
      num.className = 'save-slot-number';
      num.textContent = String(slot + 1).padStart(2, '0');
      copy.className = 'save-slot-copy';
      title.textContent = '存档槽 ' + (slot + 1);
      detail.textContent = data
        ? '已有存档 · ' + fmtSize(data) + (ts ? ' · ' + new Date(ts).toLocaleString('zh-CN', {hour12:false}) : '')
        : '空档案';
      actions.className = 'save-slot-actions';
      actions.appendChild(makeSlotBtn('保存', 'save', slot, false));
      actions.appendChild(makeSlotBtn('读取', 'load', slot, !data));
      actions.appendChild(makeSlotBtn('导出', 'export', slot, !data));
      actions.appendChild(makeSlotBtn('导入', 'import', slot, false));
      copy.appendChild(title);
      copy.appendChild(detail);
      card.appendChild(num);
      card.appendChild(copy);
      card.appendChild(actions);
      frag.appendChild(card);
    }
    saveSlotList.appendChild(frag);
  }
```

- [ ] **Step 4: 槽位操作（保存/读取/导出/导入）**

```js
  function saveToSlot(slot) {
    const cap = captureState();
    if (!cap) { setSaveMsg('error', '没有可保存的游戏进度。'); return; }
    if (readSlot(slot) && !confirm('覆盖存档槽 ' + (slot + 1) + ' 的现有存档？')) return;
    writeSlot(slot, cap.b64, Date.now());
    renderSaveSlots();
    setSaveMsg('status', '当前进度已保存到槽位 ' + (slot + 1) + '。');
  }

  function loadFromSlot(slot) {
    const b64 = readSlot(slot);
    if (!b64) return;
    if (restoreState(b64)) {
      setSaveMsg('status', '已读取槽位 ' + (slot + 1) + ' 的存档。');
    } else {
      setSaveMsg('error', '读取失败：设备未运行。');
    }
  }

  function safeFilePart(value) {
    return String(value || 'game').replace(/[^0-9A-Za-z㐀-鿿_-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
  }

  function exportSlot(slot) {
    const b64 = readSlot(slot);
    if (!b64) return;
    try {
      const payload = BBK.buildSavePayload(currentRom.id, currentRom.name, slot, b64);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bbk-' + safeFilePart(currentRom.name) + '-save-' + (slot + 1) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSaveMsg('status', '槽位 ' + (slot + 1) + ' 已导出。');
    } catch (e) {
      setSaveMsg('error', e && e.message ? e.message : '导出失败。');
    }
  }

  let importSlotTarget = null;
  function chooseImport(slot) {
    importSlotTarget = slot;
    setSaveMsg('', '');
    saveInput.value = '';
    saveInput.click();
  }

  function importSaveFile(file) {
    if (!file || importSlotTarget === null) return;
    file.text().then(function (src) {
      const parsed = BBK.parseSavePayload(src, currentRom.id);
      if (!parsed.ok) throw new Error(parsed.error);
      writeSlot(importSlotTarget, parsed.payload.data, Date.now());
      renderSaveSlots();
      setSaveMsg('status', '备份已导入到槽位 ' + (importSlotTarget + 1) + '。');
    }).catch(function (e) {
      setSaveMsg('error', e && e.message ? e.message : '导入失败。');
    }).finally(function () { importSlotTarget = null; });
  }
```

- [ ] **Step 5: 对话框开关 + 事件绑定（替换原 saveBtn / loadStateBtn 逻辑）**

删除原 `saveBtn.addEventListener('click', doSave)`、`loadStateBtn.addEventListener(...)`、`stateFileInput` 相关代码以及 `doSave` / `doLoadState` 函数（它们是旧 .sav 文件级存档，已被新槽位机制取代）。新增：

```js
  function openSaveManager() {
    if (!currentRom.id) return;
    picker.opener = document.activeElement;
    setSaveMsg('', '');
    renderSaveSlots();
    saveManager.hidden = false;
    saveManagerOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('dialog-open');
    saveManagerClose.focus();
  }
  function closeSaveManager() {
    saveManager.hidden = true;
    saveManagerOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('dialog-open');
    if (picker.opener && picker.opener.focus) picker.opener.focus();
  }

  saveManagerOpen.addEventListener('click', openSaveManager);
  saveManagerClose.addEventListener('click', closeSaveManager);
  saveManager.addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeSaveManager();
  });
  saveManager.addEventListener('keydown', function (e) {
    if (isMappedGameKey(e)) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeSaveManager(); }
  });
  [saveManagerOpen, saveManager].forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  });

  saveSlotList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-save-action]');
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    switch (btn.dataset.saveAction) {
      case 'save':   saveToSlot(slot); break;
      case 'load':   loadFromSlot(slot); break;
      case 'export': exportSlot(slot); break;
      case 'import': chooseImport(slot); break;
    }
  });

  saveInput.addEventListener('change', function () {
    if (saveInput.files.length) importSaveFile(saveInput.files[0]);
  });
```

- [ ] **Step 6: 全量测试确认无回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add eebbk/glue.js
git commit -m "feat(eebbk): 按游戏分槽的存档管理对话框"
```

---

## Task 8: 自动断点续玩 + bootstrap 恢复 + 关机兜底

**Files:**
- Modify: `eebbk/glue.js`

- [ ] **Step 1: 实现 autosaveCurrent（替换 Task 6 的空壳）**

把 Task 6 Step 4 里 `function autosaveCurrent() { /* 空壳 */ }` 替换为：

```js
  function autosaveCurrent() {
    if (!currentRom.id) return;
    const cap = captureState();
    if (!cap) return;
    writeLS(BBK.autosaveKey(currentRom.id), cap.b64);
    writeLS(BBK.autosaveKey(currentRom.id) + '.ts', String(Date.now()));
  }
```

- [ ] **Step 2: 绑定自动保存时机**

在事件绑定区追加：

```js
  function handleAutoSave() {
    if (!gameLoaded || exited) return;
    autosaveCurrent();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) handleAutoSave();
  });
  global.addEventListener('pagehide', handleAutoSave);
```

- [ ] **Step 3: bootstrap 恢复（pendingRomId 优先，否则自动续玩）**

在 `Gam4980Module({...}).then(function(mod){ ... })` 的 `.then` 内、`startEmulator()` 与 Task 6 Step 9 新增的 `restoreCurrentRomFromStorage(); loadCatalog();` **之后**，追加恢复逻辑：

```js
    const pendingId = readLS('pendingRomId');
    const pendingName = readLS('pendingRomName');
    if (pendingId) {
      removeLS('pendingRomId');
      removeLS('pendingRomName');
      fetch('roms/' + encodeURIComponent(pendingId) + '.gam')
        .then(function (r) { if (!r.ok) throw new Error('ROM 下载失败'); return r.arrayBuffer(); })
        .then(function (buf) {
          loadGame(buf, pendingName || pendingId);
          setCurrentRom(pendingId, pendingName || pendingId);
        })
        .catch(function (e) { console.warn('pending rom load failed:', e); });
    } else if (currentRom.id) {
      const auto = readLS(BBK.autosaveKey(currentRom.id));
      if (auto) {
        const bytes = BBK.base64ToBytes(auto);
        const ptr = Module._malloc(bytes.byteLength);
        Module.HEAPU8.set(bytes, ptr);
        Module._web_load(ptr, bytes.byteLength);
        Module._free(ptr);
        gameLoaded = true;
        startEmulator();
      }
    }
```

- [ ] **Step 4: 全量测试确认无回归**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add eebbk/glue.js
git commit -m "feat(eebbk): 自动断点续玩与关机态切换恢复"
```

---

## Task 9: 全量验证与收尾

- [ ] **Step 1: 构建并核对产物**

Run: `npm run build`
Expected: 成功；`dist/client/eebbk/` 含 `index.html style.css dialog.css glue.js gam4980.* roms/(catalog.json + 4 gam)`。

验证：

```bash
ls dist/client/eebbk/ && ls dist/client/eebbk/roms/
```

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全部 PASS（含新增 `tests/eebbk.test.mjs` 与 portal markup 新断言）

- [ ] **Step 3: 手动验证清单（浏览器打开 `eebbk/index.html` 或 dev server）**

- picker 列出 4 个版本；选中「伏魔记 1.0」→「使用」→ 标题变为「伏魔记 1.0」，进入游戏。
- 游戏中打开「存档管理」→「保存」到槽 1 → 切换到「伏魔记 1.1」→ 切回 1.0 →「读取」槽 1，状态恢复。
- 槽 1「导出」得到 json；清空槽位（localStorage）后「导入」该 json，恢复且 romId 校验通过；导入 rpg 的存档 json 被拒。
- 游戏中刷新页面 → 自动续玩恢复到刷新前现场。
- 触发设备关机（F1）后，picker 选另一版本 → 页面 reload 并自动进入目标游戏。
- 移动端窄屏：对话框与 footer 布局正常，按钮可达。
- rpg 页面（`rpg/index.html`）视觉与功能无变化。

- [ ] **Step 4: 收尾提交（如有遗漏的调整）**

如手动验证发现需微调，修正后：

```bash
git add -A
git commit -m "fix(eebbk): 切换与存档管理手动验证后的微调"
```

---

## Self-Review

**1. Spec 覆盖：**
- 数据层扁平 rom + catalog → Task 1 ✓
- 构建补 roms 复制 → Task 2 ✓
- 样式（dialog.css + footer-action，不动 rpg）→ Task 4 ✓
- UI（picker + save-manager 对话框、footer、标题 id）→ Task 5 ✓
- picker 状态机 + 热切换 + 关机兜底 → Task 6 + Task 8 ✓
- 存档管理（保存/读取/导出/导入，按游戏分槽）→ Task 7 ✓
- 自动断点续玩 + bootstrap 恢复 → Task 8 ✓
- 导入外部 .gam → Task 6 Step 6/7 ✓
- 纯函数导出 + 单测 → Task 3 ✓

**2. 占位符扫描：** 无 TODO/TBD/占位行；所有代码步骤均给出最终可用代码。

**3. 类型/命名一致性：** `currentRom`（{id,name}）、`BBK.*`（= `global.BBK4980Glue`）、`picker.{games,selectedId,opener}`、`captureState/restoreState/readSlot/writeSlot/saveToSlot/loadFromSlot/exportSlot/chooseImport/importSaveFile`、`autosaveCurrent/handleAutoSave`、`setCurrentRom/restoreCurrentRomFromStorage` 在各 Task 间用法一致；localStorage key（currentRomId/Name、pendingRomId/Name、sav/gamesave<slot>-<id>[.ts]、sav/autosave-<id>[.ts]）前后一致。

**4. 已知风险：**
- Task 6/7/8 属 UI 集成逻辑，单测覆盖有限，依赖 Task 9 手动验证清单兜底。
- Task 3 对 glue.js 做 IIFE 结构重构（加 global 参数 + DOM 守卫），需确保现有 bootstrap/DOM 逻辑整体下移、不丢逻辑——Step 3 已明确"现有代码保留不动"。
