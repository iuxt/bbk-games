# 三国霸业启动版本选择保护 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 未选择游戏版本时，所有三国霸业启动入口都进入 `choose.html`；选择版本后继续按现有设备规则启动。

**Architecture:** 在 `js/lcd.js` 内集中读取和清理版本选择状态。`redirect()` 负责启动前拦截，`bayeMain()` 负责直接访问游戏页时兜底，`chooseLib()` 则保证先保存新版本再启动。

**Tech Stack:** 浏览器原生 JavaScript、Node.js `node:test`、`node:vm`、Python `unittest`

---

## 文件结构

- Create: `tests/lcd.test.mjs` — 在隔离的浏览器桩环境中加载 `js/lcd.js`，验证启动、游戏初始化和版本选择顺序。
- Modify: `js/lcd.js:168-176` — 提取版本路径读取与版本状态清理函数。
- Modify: `js/lcd.js:300-321` — 让游戏初始化在缺少版本时进入选择页，并调整选择版本后的启动顺序。
- Modify: `js/lcd.js:364-393` — 在公共设备跳转之前增加版本选择保护。

### Task 1: 公共启动入口保护

**Files:**
- Create: `tests/lcd.test.mjs`
- Modify: `js/lcd.js:168-176`
- Modify: `js/lcd.js:364-393`

- [ ] **Step 1: 写入失败测试和最小测试环境**

创建 `tests/lcd.test.mjs`：

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const LCD_SOURCE = readFileSync(
    new URL("../js/lcd.js", import.meta.url),
    "utf8"
);

function createDollarStub() {
    return function () {
        return {
            attr() { return this; },
            css() { return this; },
            hide() { return this; },
            html() { return this; },
            removeAttr() { return this; },
            show() { return this; },
        };
    };
}

function loadLcd(initialStorage = {}, userAgent = "Desktop") {
    const storage = Object.assign({
        removeItem(key) { delete this[key]; },
        getItem(key) {
            return Object.prototype.hasOwnProperty.call(this, key)
                ? this[key]
                : null;
        },
        setItem(key, value) { this[key] = String(value); },
    }, initialStorage);
    const browserWindow = {
        innerHeight: 600,
        innerWidth: 1280,
        localStorage: storage,
        location: { href: "" },
    };
    const context = {
        $: createDollarStub(),
        Storage: function Storage() {},
        alert() {},
        console: { log() {} },
        navigator: { userAgent },
        window: browserWindow,
    };

    vm.runInNewContext(LCD_SOURCE, context, { filename: "js/lcd.js" });
    return { browserWindow, context, storage };
}

test("redirect sends users without a selected version to choose.html", () => {
    const { browserWindow, context } = loadLcd();

    context.redirect();

    assert.equal(browserWindow.location.href, "choose.html");
});

test("redirect preserves the existing desktop launch when a version is selected", () => {
    const { browserWindow, context } = loadLcd({
        "baye/libname": "步步高原版",
        "baye/libpath": "libs/SGBY.lib",
    });

    context.redirect();

    assert.equal(
        browserWindow.location.href,
        "pc.html?name=步步高原版"
    );
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run:

```bash
node --test tests/lcd.test.mjs
```

Expected: 第一个测试失败，实际地址为 `pc.html?name=步步高原版`，证明缺少版本时还没有进入 `choose.html`；第二个测试通过。

- [ ] **Step 3: 添加版本路径读取函数和公共启动保护**

在 `clearLib()` 前增加：

```javascript
function getLibPath() {
    return window.localStorage['baye/libpath'] || "";
}
```

在 `redirect(page)` 的第一行逻辑处增加：

```javascript
    if (!getLibPath()) {
        window.location.href = "choose.html";
        return;
    }
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```bash
node --test tests/lcd.test.mjs
```

Expected: 2 tests passed，且没有警告或错误输出。

- [ ] **Step 5: 提交公共启动保护**

```bash
git add tests/lcd.test.mjs js/lcd.js
git commit -m "fix: require a version before launching baye"
```

### Task 2: 直接游戏页启动兜底

**Files:**
- Modify: `tests/lcd.test.mjs`
- Modify: `js/lcd.js:300-309`

- [ ] **Step 1: 添加直接访问游戏页的失败测试**

向 `tests/lcd.test.mjs` 追加：

```javascript
test("bayeMain redirects direct visits without loading a version", () => {
    const { browserWindow, context } = loadLcd();
    let loaded = false;
    context.loadLibFromUrl = () => { loaded = true; };

    context.bayeMain();

    assert.equal(browserWindow.location.href, "choose.html");
    assert.equal(loaded, false);
});

test("bayeMain keeps loading the selected version", () => {
    const { context } = loadLcd({
        "baye/libpath": "libs/SGBY.lib",
    });
    let loadedPath = null;
    context.loadLibFromUrl = (path) => { loadedPath = path; };

    context.bayeMain();

    assert.equal(loadedPath, "libs/SGBY.lib");
});
```

- [ ] **Step 2: 运行新增测试并确认按预期失败**

Run:

```bash
node --test --test-name-pattern="bayeMain" tests/lcd.test.mjs
```

Expected: `bayeMain redirects direct visits without loading a version` 失败，实际地址仍为空；已有版本测试通过。

- [ ] **Step 3: 用选择页跳转替换未选择版本弹窗**

将 `bayeMain()` 改为：

```javascript
function bayeMain() {
    var url = getLibPath();
    if (!url) {
        window.location.href = "choose.html";
        return;
    }
    loadLibFromUrl(url, function(){
        _main();
    });
}
```

- [ ] **Step 4: 运行 `lcd.js` 测试并确认通过**

Run:

```bash
node --test tests/lcd.test.mjs
```

Expected: 4 tests passed，且没有警告或错误输出。

- [ ] **Step 5: 提交直接访问兜底**

```bash
git add tests/lcd.test.mjs js/lcd.js
git commit -m "fix: guard direct baye game visits"
```

### Task 3: 选择版本后的启动顺序

**Files:**
- Modify: `tests/lcd.test.mjs`
- Modify: `js/lcd.js:168-173`
- Modify: `js/lcd.js:311-321`

- [ ] **Step 1: 添加选择版本顺序的失败测试**

向 `tests/lcd.test.mjs` 追加：

```javascript
test("chooseLib stores the new version before launching", () => {
    const { context, storage } = loadLcd({
        "baye//data/dat.lib": "old cache",
        "baye/libname": "旧版本",
        "baye/libpath": "libs/old.lib",
    });
    let pathAtRedirect = null;
    context.redirect = () => {
        pathAtRedirect = storage["baye/libpath"];
    };

    context.chooseLib("步步高原版", "libs/SGBY.lib", {});

    assert.equal(storage["baye//data/dat.lib"], undefined);
    assert.equal(storage["baye/libname"], "步步高原版");
    assert.equal(storage["baye/libpath"], "libs/SGBY.lib");
    assert.equal(pathAtRedirect, "libs/SGBY.lib");
});
```

- [ ] **Step 2: 运行新增测试并确认按预期失败**

Run:

```bash
node --test --test-name-pattern="chooseLib" tests/lcd.test.mjs
```

Expected: 测试失败，`pathAtRedirect` 为 `undefined`，证明旧实现会在写入新路径之前启动。

- [ ] **Step 3: 分离状态清理，并在保存版本后启动**

用以下代码替换现有 `clearLib()`：

```javascript
function clearLibData() {
    window.localStorage.removeItem('baye//data/dat.lib');
    window.localStorage.removeItem('baye/libname');
    window.localStorage.removeItem('baye/libpath');
}

function clearLib() {
    clearLibData();
    redirect();
}
```

将 `chooseLib()` 改为：

```javascript
function chooseLib(title, path, self_) {
    var self = $(self_);
    self.html("请稍候...");
    self.attr("disabled", "disabled");

    clearLibData();
    if (path && path.length > 0) {
        window.localStorage['baye/libname'] = title;
        window.localStorage['baye/libpath'] = path;
    }
    redirect();
}
```

- [ ] **Step 4: 运行完整 JavaScript 测试并确认通过**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: `lcd.test.mjs` 的 5 个测试和现有 `portal.test.mjs` 的所有测试全部通过。

- [ ] **Step 5: 提交选择版本流程修复**

```bash
git add tests/lcd.test.mjs js/lcd.js
git commit -m "fix: save baye version before redirecting"
```

### Task 4: 完整回归验证

**Files:**
- Verify: `js/lcd.js`
- Verify: `tests/lcd.test.mjs`
- Verify: `tests/portal.test.mjs`
- Verify: `tests/test_portal_markup.py`

- [ ] **Step 1: 运行全部 Node.js 测试**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: 所有 Node.js 测试通过，无失败、警告或错误。

- [ ] **Step 2: 运行游戏大厅标记测试**

Run:

```bash
python3 -m unittest discover -s tests -p 'test_*.py'
```

Expected: 所有 Python 测试通过。

- [ ] **Step 3: 检查补丁格式和工作区范围**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` 无输出；`git status --short` 仅显示实现计划文件（如果尚未提交），没有意外文件。
