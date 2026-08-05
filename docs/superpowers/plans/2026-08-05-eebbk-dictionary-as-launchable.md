# EEBBK 电子词典改为「可启动条目」实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 eebbk 页面进入时不再自动加载电子词典主屏，而是把「电子词典系统」作为「选择游戏」列表首位可启动条目（带「系统」标签），选中即进入；并记住用户选择、下次自动进入。

**Architecture:** 把所有分支判定抽成 `eebbk/glue.js` 顶部已有的「纯函数区」并导出到 `globalThis.BBK4980Glue`（与现有 `romStorageId`/`slotKey` 等同模式，可在 node 单测）。DOM 层只做薄接线：picker 注入合成条目、`useSelectedGame` 特判、`setCurrentRom`/`autosaveCurrent` 走纯函数判定、bootstrap 用纯函数 `decideLaunch` 决策。词典用哨兵 id `'__home__'` 标识，不进 `catalog.json`。

**Tech Stack:** 原生 JS（无框架）、`node --test` 单测、`python3 -m unittest` 标记/资源测试、`node scripts/build-site.mjs` 构建。

## Global Constraints

- 哨兵 id 恒为字符串 `'__home__'`；词典显示名恒为 `'电子词典系统'`。
- 仅改 `eebbk/glue.js` 与 `eebbk/dialog.css`。**不得改** `eebbk/index.html`、`eebbk/roms/catalog.json`、`scripts/build-site.mjs`、wasm 内核。
- 纯函数须放在 `eebbk/glue.js` 的纯函数区（`if (!global.document) return;` 之前），并挂到 `globalThis.BBK4980Glue` 导出对象，使其在 node 下可测（DOM 段在 node 下 early-return）。
- 现有测试须保持通过：`npm run test:node`（`tests/eebbk.test.mjs` 等）、`npm run test:python`（`tests/test_portal_markup.py` 等，含 `test_catalog_lists_every_bundled_rom_exactly_once`——因不改 catalog，必然仍绿）。
- `npm run build` 须成功。
- 新增/改动的 DOM 行为无法在 node 单测（无 DOM/wasm），其验证靠「现有测试不回归 + 构建通过 + 手动场景清单」。

## File Structure

- `eebbk/glue.js`（修改）
  - 纯函数区：新增 `HOME_ROM_ID`、`HOME_ROM`、`buildPickerGames`、`decideLaunch`、`decideHomeLaunch`、`saveManagerEnabledFor`、`shouldAutosave`，并加入导出对象。
  - DOM 段：`loadCatalog`（注入合成条目）、`renderGames`（系统标签）、新增 `launchHome` + `useSelectedGame` 特判、`setCurrentRom`（存档管理开关）、`autosaveCurrent`（跳过）、bootstrap `.then`（用 `decideLaunch` 决策）。
- `eebbk/dialog.css`（修改）：新增 `.rom-tag` 样式。
- `tests/eebbk.test.mjs`（修改）：新增纯函数单测。
- `tests/test_portal_markup.py`（修改）：新增 `.rom-tag` 存在性断言。

---

### Task 1: 纯决策函数 + node 单测

**Files:**
- Modify: `eebbk/glue.js:94-103`（导出对象，新增 7 个键）
- Modify: `eebbk/glue.js:6-103`（纯函数区，在 `global.BBK4980Glue = {...}` 之前插入新函数）
- Test: `tests/eebbk.test.mjs`（末尾追加）

**Interfaces:**
- Consumes: 无（纯函数区不依赖 DOM/wasm）。
- Produces（均挂到 `globalThis.BBK4980Glue`，后续 DOM 任务消费）：
  - `HOME_ROM_ID` → `'__home__'`（字符串常量）
  - `HOME_ROM` → `{ id: HOME_ROM_ID, name: '电子词典系统', py: 'dianzicidianxitong', initial: 'dzcdxt', isSystem: true }`
  - `buildPickerGames(catalogGames: Game[]) → Game[]`：返回 `[HOME_ROM, ...catalogGames]`；`catalogGames` 为空数组或缺省时仍返回仅含 `HOME_ROM` 的数组。
  - `decideLaunch({ pendingId: string, currentRomId: string, hasAutosave: boolean }) → { action: 'home' } | { action: 'rom', id: string, applyAutosave: boolean } | { action: 'placeholder' }`
  - `decideHomeLaunch({ exited: boolean, started: boolean }) → 'pending-reload' | 'start' | 'autosave-reload'`
  - `saveManagerEnabledFor(id: string) → boolean`
  - `shouldAutosave(id: string) → boolean`

- [ ] **Step 1: 写失败的单测（追加到 `tests/eebbk.test.mjs` 末尾）**

```js
test("HOME_ROM 与 buildPickerGames：词典条目恒居首位", () => {
    assert.equal(G.HOME_ROM_ID, "__home__");
    assert.equal(G.HOME_ROM.id, "__home__");
    assert.equal(G.HOME_ROM.name, "电子词典系统");
    assert.equal(G.HOME_ROM.isSystem, true);

    const catalog = [{ id: "魔塔", name: "魔塔" }, { id: "伏魔记", name: "伏魔记" }];
    const list = G.buildPickerGames(catalog);
    assert.equal(list.length, 3);
    assert.equal(list[0].id, "__home__", "home 必须第一");
    assert.equal(list[1].id, "魔塔");

    // 空目录也要有词典条目
    assert.equal(G.buildPickerGames([]).length, 1);
    assert.equal(G.buildPickerGames().length, 1);
});

test("decideLaunch：pending 优先", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "__home__", currentRomId: "魔塔", hasAutosave: true }),
                     { action: "home" });
    assert.deepEqual(G.decideLaunch({ pendingId: "魔塔", currentRomId: "", hasAutosave: false }),
                     { action: "rom", id: "魔塔", applyAutosave: false });
});

test("decideLaunch：无 pending 时按 currentRomId", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "__home__", hasAutosave: false }),
                     { action: "home" });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "", hasAutosave: false }),
                     { action: "placeholder" });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "魔塔", hasAutosave: true }),
                     { action: "rom", id: "魔塔", applyAutosave: true });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "魔塔", hasAutosave: false }),
                     { action: "rom", id: "魔塔", applyAutosave: false });
});

test("decideLaunch：本地导入 rom 无法跨 reload 恢复 → placeholder", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "local-123-abc", hasAutosave: false }),
                     { action: "placeholder" });
});

test("decideHomeLaunch：按设备状态分三种路径", () => {
    assert.equal(G.decideHomeLaunch({ exited: true, started: false }), "pending-reload");
    assert.equal(G.decideHomeLaunch({ exited: true, started: true }), "pending-reload");
    assert.equal(G.decideHomeLaunch({ exited: false, started: false }), "start");
    assert.equal(G.decideHomeLaunch({ exited: false, started: true }), "autosave-reload");
});

test("saveManagerEnabledFor：home 与空 id 禁用", () => {
    assert.equal(G.saveManagerEnabledFor("魔塔"), true);
    assert.equal(G.saveManagerEnabledFor("local-1-2"), true);
    assert.equal(G.saveManagerEnabledFor("__home__"), false);
    assert.equal(G.saveManagerEnabledFor(""), false);
});

test("shouldAutosave：home / local / 空 都跳过", () => {
    assert.equal(G.shouldAutosave("魔塔"), true);
    assert.equal(G.shouldAutosave("__home__"), false);
    assert.equal(G.shouldAutosave("local-1-2"), false);
    assert.equal(G.shouldAutosave(""), false);
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npm run test:node`
Expected: FAIL（新断言引用的 `G.HOME_ROM_ID` 等为 `undefined`，`buildPickerGames` 不是函数等）。

- [ ] **Step 3: 在纯函数区实现（插入到 `eebbk/glue.js` 中 `global.BBK4980Glue = {` 之前，即第 94 行之前）**

```js
  /* ---------- 电子词典（home）作为可启动条目的纯逻辑 ---------- */
  const HOME_ROM_ID = '__home__';
  const HOME_ROM_NAME = '电子词典系统';
  const HOME_ROM = {
    id: HOME_ROM_ID,
    name: HOME_ROM_NAME,
    py: 'dianzicidianxitong',
    initial: 'dzcdxt',
    isSystem: true
  };

  function buildPickerGames(catalogGames) {
    const list = Array.isArray(catalogGames) ? catalogGames : [];
    return [HOME_ROM].concat(list);
  }

  /* 启动决策：pending（关机态热切换指令）优先；否则按记住的 currentRomId。
     本地导入 rom（local-*）无法跨 reload 恢复，回落到占位画面。 */
  function decideLaunch(opts) {
    const pendingId = opts && opts.pendingId ? opts.pendingId : '';
    const currentRomId = opts && opts.currentRomId ? opts.currentRomId : '';
    const hasAutosave = !!(opts && opts.hasAutosave);
    if (pendingId) {
      if (pendingId === HOME_ROM_ID) return { action: 'home' };
      return { action: 'rom', id: pendingId, applyAutosave: false };
    }
    if (currentRomId === HOME_ROM_ID) return { action: 'home' };
    if (!currentRomId) return { action: 'placeholder' };
    if (currentRomId.indexOf('local-') === 0) return { action: 'placeholder' };
    return { action: 'rom', id: currentRomId, applyAutosave: hasAutosave };
  }

  /* 在 picker 里选中「电子词典系统」时，按当前设备状态决定如何进入。 */
  function decideHomeLaunch(opts) {
    const exited = !!(opts && opts.exited);
    const started = !!(opts && opts.started);
    if (exited) return 'pending-reload';   // 内核已销毁：写 pending + reload
    if (!started) return 'start';           // 占位画面：直接开机进主屏
    return 'autosave-reload';               // 运行游戏中切换：先 autosave 再 reload
  }

  function saveManagerEnabledFor(id) {
    return !!id && id !== HOME_ROM_ID;
  }

  function shouldAutosave(id) {
    if (!id) return false;
    if (id === HOME_ROM_ID) return false;
    if (id.indexOf('local-') === 0) return false;
    return true;
  }
```

- [ ] **Step 4: 把新函数加入导出对象（`eebbk/glue.js` 第 94-103 行的 `global.BBK4980Glue = {...}`）**

在 `parseSavePayload: parseSavePayload` 之后、闭合 `}` 之前追加：

```js
    HOME_ROM_ID: HOME_ROM_ID,
    HOME_ROM: HOME_ROM,
    buildPickerGames: buildPickerGames,
    decideLaunch: decideLaunch,
    decideHomeLaunch: decideHomeLaunch,
    saveManagerEnabledFor: saveManagerEnabledFor,
    shouldAutosave: shouldAutosave
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npm run test:node`
Expected: PASS（含新增 7 个 test，且原有 test 不回归）。

- [ ] **Step 6: 提交**

```bash
git add eebbk/glue.js tests/eebbk.test.mjs
git commit -m "feat(eebbk): 抽取电子词典可启动条目的纯决策函数

新增 HOME_ROM/buildPickerGames/decideLaunch/decideHomeLaunch/
saveManagerEnabledFor/shouldAutosave 纯函数并导出，附 node 单测。
DOM 接线与 bootstrap 改造在后续任务。"
```

---

### Task 2: 「系统」小标签样式 + python 断言

**Files:**
- Modify: `eebbk/dialog.css`（末尾追加 `.rom-tag` 规则）
- Test: `tests/test_portal_markup.py`（在 `EebbkSimulatorMarkupTests` 类内新增方法）

**Interfaces:**
- Consumes: 无。
- Produces: `.rom-tag` 样式（Task 3 的 `renderGames` 渲染 `<span class="rom-tag">系统</span>` 时引用）。

- [ ] **Step 1: 写失败的 python 断言（加到 `tests/test_portal_markup.py` 的 `EebbkSimulatorMarkupTests` 类内，例如 `test_drops_legacy_save_buttons` 之后）**

```python
    def test_dialog_css_has_system_tag_style(self):
        css = (ROOT / "eebbk" / "dialog.css").read_text(encoding="utf-8")
        self.assertIn(".rom-tag", css, "dialog.css 缺少 .rom-tag 系统标签样式")
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `python3 -m unittest tests.test_portal_markup.EebbkSimulatorMarkupTests.test_dialog_css_has_system_tag_style`
Expected: FAIL（`.rom-tag` not found）。

- [ ] **Step 3: 在 `eebbk/dialog.css` 末尾追加样式**

```css
/* 电子词典系统条目的「系统」小标签 */
.rom-card .rom-tag {
    display: inline-block;
    margin-left: 0.5em;
    padding: 0 0.4em;
    font-size: 0.7em;
    line-height: 1.4;
    border: 1px solid currentColor;
    border-radius: 0.3em;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `python3 -m unittest tests.test_portal_markup.EebbkSimulatorMarkupTests.test_dialog_css_has_system_tag_style`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add eebbk/dialog.css tests/test_portal_markup.py
git commit -m "feat(eebbk): 词典条目「系统」小标签样式"
```

---

### Task 3: picker 接线（注入条目 / 系统标签 / 选中词典 / 存档开关 / autosave 跳过）

**Files:**
- Modify: `eebbk/glue.js`（`loadCatalog` 253-268、`renderGames` 216-251、`useSelectedGame` 280-308、`setCurrentRom` 162-168、`autosaveCurrent` 271-278，并新增 `launchHome`）

**Interfaces:**
- Consumes: Task 1 的 `BBK.HOME_ROM_ID`、`BBK.HOME_ROM`、`BBK.buildPickerGames`、`BBK.decideHomeLaunch`、`BBK.saveManagerEnabledFor`、`BBK.shouldAutosave`。
- Produces: picker 列表首位为「电子词典系统」；选中它即进入主屏；词典态禁用存档管理、跳过 autosave。本任务不改 bootstrap（页面仍会自动开机进主屏，属中间态，Task 4 完成后端到端生效）。

> 说明：本任务为 DOM 接线，无 node 单测。验证 = 现有 `npm run test` 不回归 + `npm run build` 通过 + 下面的手动场景。

- [ ] **Step 1: `loadCatalog` 注入合成条目**

把 `eebbk/glue.js` 第 257 行 `picker.games = games;` 改为：

```js
        picker.games = BBK.buildPickerGames(games);
```

并把第 260-261 行选中态判断里的 `games.some` 改为基于已注入的 `picker.games`（确保词典为当前 rom 时能选中）：

```js
        picker.selectedId = currentRom.id && picker.games.some(function (g) { return g.id === currentRom.id; })
          ? currentRom.id : '';
```

- [ ] **Step 2: `renderGames` 给系统条目加「系统」标签**

在 `eebbk/glue.js` `renderGames` 的 `games.forEach` 内、`card.appendChild(name);`（约第 246 行）之后插入：

```js
      if (game.isSystem) {
        const tag = document.createElement('span');
        tag.className = 'rom-tag';
        tag.textContent = '系统';
        card.appendChild(tag);
      }
```

- [ ] **Step 3: 新增 `launchHome` 并在 `useSelectedGame` 顶部特判**

在 `useSelectedGame`（第 280 行）**之前**新增函数：

```js
  function launchHome() {
    const mode = BBK.decideHomeLaunch({ exited: exited, started: started });
    if (mode === 'pending-reload') {
      writeLS('pendingRomId', BBK.HOME_ROM_ID);
      writeLS('pendingRomName', BBK.HOME_ROM.name);
      location.reload();
      return;
    }
    if (mode === 'start') {
      setCurrentRom(BBK.HOME_ROM_ID, BBK.HOME_ROM.name);
      startEmulator();
      setPickerBusy(false);
      closePicker();
      return;
    }
    // autosave-reload：运行游戏中切换回词典
    setPickerBusy(true, '切换中…');
    autosaveCurrent();
    setCurrentRom(BBK.HOME_ROM_ID, BBK.HOME_ROM.name);
    location.reload();
  }
```

在 `useSelectedGame` 函数体最开头（第 281 行 `if (!picker.selectedId) return;` 之后）插入特判：

```js
    if (picker.selectedId === BBK.HOME_ROM_ID) { launchHome(); return; }
```

- [ ] **Step 4: `setCurrentRom` 用纯函数控制存档管理开关**

把 `eebbk/glue.js` 第 167 行：

```js
    saveManagerOpen.disabled = !currentRom.id;
```

改为：

```js
    saveManagerOpen.disabled = !BBK.saveManagerEnabledFor(currentRom.id);
```

- [ ] **Step 5: `autosaveCurrent` 用纯函数跳过 home / local / 空**

把 `eebbk/glue.js` `autosaveCurrent`（第 271-278 行）首行的本地 rom 跳过逻辑：

```js
    if (!currentRom.id) return;
    if (currentRom.id.indexOf('local-') === 0) return;  // 本地导入 rom 不持久化，reload 后无法恢复
```

替换为单行：

```js
    if (!BBK.shouldAutosave(currentRom.id)) return;  // home / local / 空 都不持久化
```

- [ ] **Step 6: 回归测试 + 构建**

Run: `npm run test`
Expected: node + python 全部 PASS（DOM 改动不影响纯函数测试与标记测试）。

Run: `npm run build`
Expected: 构建成功，无报错。

- [ ] **Step 7: 手动场景验证（本地起静态服务器）**

Run（后台或单独终端）: `python3 -m http.server 8000`，浏览器打开 `http://localhost:8000/eebbk/`。
Expected:
- 打开「选择游戏」→ 列表第 01 项为「电子词典系统」，名字后有「系统」小标签；其余游戏无标签。
- 在搜索框输入「词典」→ 命中该条目；输入「魔塔」→ 该条目隐藏；清空 → 它回到首位 01。
- 选中「电子词典系统」→ 点「使用」→ 进入电子词典主屏；标题变「电子词典系统」；「存档管理」按钮保持禁用。
- 选中某款游戏 → 「使用」→ 进入游戏；标题变游戏名；「存档管理」可点。（确认未破坏既有热切换。）

- [ ] **Step 8: 提交**

```bash
git add eebbk/glue.js
git commit -m "feat(eebbk): picker 注入电子词典条目并支持选中进入

词典作为列表首位合成条目（带「系统」标签），选中即进入主屏；
词典态禁用存档管理、跳过 autosave。bootstrap 改造见下一任务。"
```

---

### Task 4: bootstrap 用 decideLaunch 决策（进入不自动加载词典）

**Files:**
- Modify: `eebbk/glue.js:835-886`（`Gam4980Module().then` 回调）

**Interfaces:**
- Consumes: Task 1 的 `BBK.decideLaunch`、`BBK.HOME_ROM_ID`、`BBK.HOME_ROM`；现有 `setCurrentRom`/`startEmulator`/`loadGame`/`restoreCurrentRomFromStorage`/`loadCatalog`/`readLS`/`removeLS`。
- Produces: 页面进入时按记住的选择决策——`__home__` 进主屏、游戏 id 进游戏（有 autosave 则续、无则也进入）、未选择停占位画面；`pendingRomId` 路径特判 `__home__`。端到端完成。

> 说明：本任务为 DOM/wasm 接线，无 node 单测。验证 = 现有 `npm run test` 不回归 + `npm run build` 通过 + 下面的手动场景。

- [ ] **Step 1: 改写 bootstrap `.then` 回调**

定位 `eebbk/glue.js` 中：

```js
  }).then(function(mod) {
    Module = mod;
    if (Module._web_init() !== 0) {
      fatalError('初始化失败', '缺少 8.BIN / E.BIN 固件文件，无法启动模拟器。');
      return;
    }
    startEmulator();   /* power on → go straight to the device home screen */
    restoreCurrentRomFromStorage();
    loadCatalog();
```

把 `startEmulator();` 那一行**删除**（不再无条件开机进主屏）。保留 `restoreCurrentRomFromStorage();` 与 `loadCatalog();`。

- [ ] **Step 2: 用 decideLaunch 替换原有 pending/autosave 恢复块**

定位紧接其后的整段（原第 845-883 行，从 `const pendingId = readLS('pendingRomId');` 到对应 `}` 结束的 autosave 恢复块），整段替换为：

```js
    const pendingId = readLS('pendingRomId');
    const pendingName = readLS('pendingRomName');
    const hasAuto = currentRom.id ? !!readLS(BBK.autosaveKey(currentRom.id)) : false;
    const decision = BBK.decideLaunch({
      pendingId: pendingId,
      currentRomId: currentRom.id,
      hasAutosave: hasAuto
    });

    if (decision.action === 'home') {
      if (pendingId) { removeLS('pendingRomId'); removeLS('pendingRomName'); }
      setCurrentRom(BBK.HOME_ROM_ID, pendingId ? (pendingName || BBK.HOME_ROM.name) : (currentRom.name || BBK.HOME_ROM.name));
      startEmulator();
    } else if (decision.action === 'rom') {
      const romId = decision.id;
      const romName = pendingId ? (pendingName || romId) : (currentRom.name || romId);
      if (pendingId) { removeLS('pendingRomId'); removeLS('pendingRomName'); }
      fetch('roms/' + encodeURIComponent(romId) + '.gam')
        .then(function (r) { if (!r.ok) throw new Error('ROM 下载失败'); return r.arrayBuffer(); })
        .then(function (buf) {
          // 先 _web_load_game 填充 flash，再（如有 autosave）_web_load 叠加 ram/cpu/bk_tab
          const rp = Module._malloc(buf.byteLength);
          Module.HEAPU8.set(new Uint8Array(buf), rp);
          Module._web_load_game(rp, buf.byteLength);
          Module._free(rp);
          if (decision.applyAutosave) {
            const auto = readLS(BBK.autosaveKey(romId));
            if (auto) {
              const bytes = BBK.base64ToBytes(auto);
              const ptr = Module._malloc(bytes.byteLength);
              Module.HEAPU8.set(bytes, ptr);
              Module._web_load(ptr, bytes.byteLength);
              Module._free(ptr);
            }
          }
          gameLoaded = true;
          startEmulator();
          setCurrentRom(romId, romName);
        })
        .catch(function (e) {
          console.warn('launch rom failed:', e);
          // ROM 拉取失败（如失效的游戏 id）：清掉记住的选择，停留占位画面
          if (!pendingId) { removeLS('currentRomId'); removeLS('currentRomName'); }
        });
    }
    // decision.action === 'placeholder'：什么都不做，占位画面保持可见
```

- [ ] **Step 3: 回归测试 + 构建**

Run: `npm run test`
Expected: node + python 全部 PASS。

Run: `npm run build`
Expected: 构建成功。

- [ ] **Step 4: 手动场景验证（端到端）**

在浏览器开发者工具里用 localStorage 模拟各状态（或按场景操作）。打开 `http://localhost:8000/eebbk/`：

- **首次/未选择**：清空 localStorage（含 `currentRomId`/`currentRomName`/`pendingRomId`）后刷新 → 停在占位画面（拖拽 .gam 提示），**不**自动进入词典。
- **选过词典**：占位画面 → 选择游戏 → 选「电子词典系统」→ 使用 → 进主屏；再刷新 → 自动进主屏（记住选择）。
- **选过游戏**：选某游戏 → 使用 → 进入游戏；玩一会（触发 visibilitychange/pagehide 写 autosave，或切到别的标签页再回来）→ 刷新 → 自动恢复该游戏现场（断点续玩不变）。
- **游戏中切词典**：运行游戏中 → 选择游戏 → 选「电子词典系统」→ 使用 → 页面 reload → 进主屏；再选回该游戏 → 能从 autosave 续上。
- **关机态切词典**：触发设备关机（如游戏内退出至关机，出现「设备已关机」浮层）→ 打开选择游戏 → 选「电子词典系统」→ 使用 → reload → 进主屏。
- **本地导入**：拖一个 `.gam` 进去 → 进入该游戏；刷新 → 停占位画面（本地 rom 无法跨 reload 恢复，符合既有约定），不报错。

- [ ] **Step 5: 提交**

```bash
git add eebbk/glue.js
git commit -m "feat(eebbk): 进入页面按记住的选择决策，不再自动加载词典

bootstrap 用 decideLaunch 决策：__home__ 进主屏、游戏 id 进游戏
（有存档则续、无也进入）、未选择停占位画面；pendingRomId 特判
__home__。断点续玩与本地导入 rom 行为保持不变。"
```

---

## Self-Review（写完后自查记录）

- **Spec 覆盖**：
  - 目标1（进入不自动加载词典）→ Task 4 Step 1-2。
  - 目标2（词典作首位条目 + 系统标签）→ Task 3 Step 1-2 + Task 2。
  - 目标3（选中即进入）→ Task 3 Step 3（`launchHome` 三路径）。
  - 目标4（记住选择自动进入 + 断点续玩不变）→ Task 4（`decideLaunch` home/rom/placeholder + `applyAutosave`）。
  - 存档管理禁用 / autosave 跳过 → Task 3 Step 4-5（`saveManagerEnabledFor`/`shouldAutosave`）。
  - pendingRomId 特判 `__home__`（避免 404）→ Task 4 Step 2（`decideLaunch` + home 分支）。
- **占位符扫描**：无 TBD/TODO；每个代码步骤均给出完整代码。
- **类型/命名一致性**：`HOME_ROM_ID`/`HOME_ROM`/`buildPickerGames`/`decideLaunch`/`decideHomeLaunch`/`saveManagerEnabledFor`/`shouldAutosave` 在 Task 1 定义，Task 3/4 以相同名字通过 `BBK.*` 消费；`decision.action`/`decision.id`/`decision.applyAutosave` 字段在定义与消费处一致。
