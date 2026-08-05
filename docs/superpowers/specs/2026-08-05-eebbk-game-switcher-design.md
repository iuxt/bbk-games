# EEBBK 游戏切换 + 按游戏分槽存档管理 设计

- 日期：2026-08-05
- 范围：`eebbk/` 模拟器（朗文 4980，`gam4980.wasm` 内核）
- 参考：`rpg/` 模拟器已有的游戏切换（game-picker）与存档管理（save-manager）对话框

## 1. 目标

1. **游戏切换**：在 eebbk 页面提供「选择游戏」对话框，游戏列表来自 `eebbk/roms/`（首批 4 个伏魔记版本），界面参考 rpg 的 game-picker。
2. **热切换**：选中后直接调用内核加载新 gam，不重载页面。
3. **按游戏分槽存档管理**：参考 rpg 的 save-manager，提供 3 个槽位的存档管理，存档按游戏隔离；并叠加自动断点续玩。
4. 保留外部 `.gam` 导入入口。

## 2. 背景与关键约束

### 2.1 两套内核的存档模型差异（决定存档管理实现）

| 维度 | rpg（fmj 引擎） | eebbk（gam4980 内核） |
|---|---|---|
| ROM 数据存放 | localStorage（hex），reload 后内核读取 | wasm 内存，`_web_load_game(ptr,size)` 直接加载 |
| 切换游戏 | fetch `.lib` → 存 localStorage → `location.reload()` | `fetch` `.gam` → `loadGame()` 热加载（内核 `_web_load_game` 重置 CPU） |
| 内核状态 | 以 hex 常驻 localStorage，存档由游戏内菜单触发、`core.js` 自动写槽 | 状态仅在 wasm 内存，需主动 `_web_save()` / `_web_load()` |
| 存档管理按钮 | 每槽仅「导出 / 导入」（存档动作已在游戏内完成） | 每槽需「保存 / 读取 / 导出 / 导入」（内核无自动落盘钩子） |

结论：eebbk 存档管理**外观对齐 rpg**，但每槽多出「保存 / 读取」两个必要操作；额外提供 rpg 没有的**自动断点续玩**作为补偿。

### 2.2 内核导出函数（`eebbk/src/web_main.c`，已存在，无需改 C）

- `web_init()` → 初始化系统，进入设备主屏
- `web_load_game(data, size)` → 加载 gam 并重置 CPU（`sys_load` 末尾 `sys.cpu.pc = start`）→ **热切换可行**
- `web_save(buf)` / `web_load(buf, size)` / `web_save_size()` → 整机状态（`struct sys_state`：ram[0x8000] + cpu + bk_tab + flash 状态，约 33KB）序列化/反序列化
- `web_run_frame()` / `web_get_framebuffer()` / `web_keydown(key)` → 帧循环、显示、按键

### 2.3 构建约束（关键）

`scripts/build-site.mjs` 用**白名单**把 eebbk 文件复制到 `dist/client/eebbk/`（当前仅 `index.html / style.css / glue.js / gam4980.*`）。`eebbk/roms/` 目前**不会**进构建产物，部署后 picker 会 fetch 404。**必须在构建脚本里补上 roms 目录复制。**

## 3. 数据层

### 3.1 扁平化 rom 目录

把现有嵌套结构整理为扁平：

```
eebbk/roms/
├── catalog.json
├── fmj-1.0.gam   ← 原 1.0伏魔记完整版/Rpg-11.gam
├── fmj-1.1.gam   ← 原 1.1伏魔记完整版/Rpg-11.gam
├── fmj-1.2.gam   ← 原 1.2伏魔记完整版/Rpg-11.gam
└── fmj-1.3.gam   ← 原 1.3伏魔记完整版/rpg-11.gam（注意原为小写）
```

迁移后删除 4 个空的版本子目录。

### 3.2 catalog.json

沿用 rpg 的 `{id, name}` 结构：

```json
[
  {"id": "fmj-1.0", "name": "伏魔记 1.0"},
  {"id": "fmj-1.1", "name": "伏魔记 1.1"},
  {"id": "fmj-1.2", "name": "伏魔记 1.2"},
  {"id": "fmj-1.3", "name": "伏魔记 1.3"}
]
```

fetch 路径约定：`roms/<id>.gam`（即 `roms/fmj-1.0.gam`）。

## 4. 构建层

`scripts/build-site.mjs`：在 eebbk 复制段，新增把整个 `eebbk/roms/` 递归复制到 `dist/client/eebbk/roms/`（catalog.json + 4 个 gam）。写法参考同文件中 `directories` 的 `cp(..., {recursive:true})`。

## 5. 样式层

### 5.1 eebbk 自带对话框样式（不改动 rpg）

新建 `eebbk/dialog.css`，从 `rpg/app.css` **复制** game-picker / save-manager 对话框样式，并按 eebbk 差异微调（基础类 `.dialog-overlay` / `.device-button` / `.dialog-open` 已在共享的 `css/portal.css`，直接复用）。`eebbk/index.html` 在 `style.css` 之外新增引用：

```html
<link rel="stylesheet" href="dialog.css?v=1">
```

复制范围：`.game-picker-overlay` `.game-picker-dialog` `.game-picker-display` `.rom-list` `.rom-card`（含 `.is-selected` / `.rom-number` / `.rom-name`）`.game-picker-actions` `.primary-button` `.import-button` `.empty-result` `.dialog-error` `.dialog-busy` `.save-manager-overlay` `.save-manager-dialog` `.save-manager-help` `.save-slot-list` `.save-slot-card`（含 `.has-save` / `.save-slot-number` / `.save-slot-copy` / `.save-slot-actions`）`.slot-action` `.save-manager-actions` `.dialog-status` 及相关响应式分支。

eebbk 差异微调：picker 不渲染搜索框（无 `.game-search` 依赖）；save-manager 每槽 4 按钮（保存/读取/导出/导入），`.save-slot-actions` 用 2×2 网格而非 rpg 的 2 列。

### 5.2 footer-action 样式补全

eebbk 现有 footer 的 `class="footer-action"` 按钮**没有样式定义**（`.footer-action` 仅存在于 `rpg/app.css`，eebbk 未引用；portal.css 仅有 `.device-footer` / `.utility-footer`，style.css 仅在窄屏 media 里有 `.footer-actions` 网格）。在 `eebbk/style.css` 补充桌面态 `.footer-action` / `.footer-actions` 样式（从 `rpg/app.css` 复制），让「选择游戏」「存档管理」按钮具备 rpg 一致的按键外观。

### 5.3 为什么不抽取共享

`tests/test_portal_markup.py::SimulatorMarkupTests.test_ui_assets_cover_responsive_and_accessible_states` 直接断言 `rpg/app.css` 文本包含 `.rom-card.is-selected` / `.save-slot-card` / `.rom-list::-webkit-scrollbar` / `100dvh` 等字符串。抽取到共享文件会破坏该测试，且需同步改测试——风险高于收益。此外两边对话框本就有差异（eebbk picker 无搜索框、save-manager 每槽 4 按钮 vs rpg 2 按钮），独立维护更清晰。**rpg 保持零改动。**

## 6. UI 层（`eebbk/index.html`）

### 6.1 标题区

`game-title` 的 `<h1>` 加 `id="current-game-name"`，默认文本「EEBBK模拟器」；切换/恢复游戏后动态写入游戏名。

### 6.2 footer

```
SIMULATOR · 朗文4980
[选择游戏]  [存档管理]  ‹ 返回游戏中心
```

- 移除原有「选择 .gam」「存档」「读档」三个按钮
- 新增「选择游戏」（打开 game-picker）、「存档管理」（打开 save-manager，未加载游戏时 disabled）

### 6.3 game-picker 对话框（参考 rpg，省略搜索框）

```
┌─ LCD: ROM COLLECTION / 游戏合集 ──┐
│ 选择游戏_                          │
│ 4 GAMES / 点击卡片后选择使用       │
├────────────────────────────────────┤
│ [01 伏魔记 1.0 ›] [02 伏魔记 1.1 ›]│
│ [03 伏魔记 1.2 ›] [04 伏魔记 1.3 ›]│
├────────────────────────────────────┤
│ [导入 .gam]      [取消]    [使用]  │
└────────────────────────────────────┘
```

- 仅 4 个游戏，**不加搜索框**（YAGNI）
- 底部「导入 .gam」保留外部导入入口（复用现有 file-input / 拖拽逻辑）

### 6.4 save-manager 对话框（参考 rpg）

```
┌─ LCD: CURRENT GAME / 当前游戏 ─────┐
│ 存档管理_                          │
│ <当前游戏名>                       │
├────────────────────────────────────┤
│ 存档槽 1   存档槽 2   存档槽 3      │
│ [保存][读取] ...                   │
├────────────────────────────────────┤
│                              [完成] │
└────────────────────────────────────┘
```

每槽卡片：编号 +「存档槽 N」+ 状态（「空档案」/「已有存档 · 大小 · 时间」）+ 操作按钮。

## 7. 逻辑层（`eebbk/glue.js`）

### 7.1 状态与命名

- `state.games` / `state.selectedId` / `state.opener`（参考 rpg）
- localStorage：
  - `currentRomId` / `currentRomName`：当前游戏（catalog id 或 `local-<hash>`，导入 gam 的名字）
  - `sav/gamesave<slot>-<storageId>`：槽位存档，值 = 内核状态 base64
  - `sav/autosave-<storageId>`：自动断点续玩，值 = 内核状态 base64
  - `pendingRomId` / `pendingRomName`：关机态切换游戏的一次性指令（reload 后消费并清除）

### 7.2 picker 状态机

- `loadCatalog()` → fetch `roms/catalog.json` → `state.games` → `renderGames()`（编号 + 名字卡片）
- `selectGame(id)` → 高亮选中卡片，启用「使用」
- `useSelectedGame(id)` → 核心切换流程（见 7.4）

### 7.3 存档编解码

- `bytesToBase64(Uint8Array)` / `base64ToBytes(str)`：分块处理，避免大数组 `btoa` 栈溢出（内核状态约 33KB，分块 0x8000 安全）
- 槽位存取：`readSlot(storageId, slot)` / `writeSlot(storageId, slot, b64)` / `slotKey(storageId, slot)`

### 7.4 切换游戏（热切换 + 关机兜底）

```
useSelectedGame(id):
  game = state.games.find(id)
  setBusy(true, "游戏载入中…")
  fetch roms/<id>.gam → arrayBuffer
    若 !exited（内核存活）:
       autosaveCurrent()             // 切走前先把当前进度存自动槽
       loadGame(buf, game.name)      // 热加载：_web_load_game 重置 CPU
       setCurrentRom(id, game.name)  // 更新标题 + localStorage
       closePicker()
    若 exited（内核已销毁）:
       localStorage[pendingRomId]   = id
       localStorage[pendingRomName] = game.name
       location.reload()             // 重载后由 bootstrap 消费
  catch → setError("游戏载入失败…")
```

`loadGame()` 已存在（malloc → `_web_load_game` → startEmulator）。新增：加载成功后调用 `setCurrentRom` 写 `currentRomId/currentRomName` 并更新标题。

### 7.5 bootstrap 适配（`Gam4980Module().then`）

```
Module = mod
web_init() 失败 → fatalError（原逻辑）
startEmulator()                       // 进入主屏（原逻辑，已隐藏 placeholder、显示 canvas）
// 新增：启动后续玩恢复（两条互斥路径）
if pendingRomId 存在:                                     // 关机态切换游戏
   id = pendingRomId; name = pendingRomName; 清除两者
   fetch roms/<id>.gam → loadGame(buf, name)              // 进入目标游戏
else if localStorage['sav/autosave-'+currentRomId] 存在:  // 上次离开的现场
   bytes = base64ToBytes(autosave); _web_load(bytes); gameLoaded = true
   setCurrentRom(currentRomId, currentRomName)           // 覆盖主屏为游戏现场
```

说明：startEmulator 已隐藏 placeholder 并显示 canvas，恢复后下一帧 `web_run_frame` 即渲染恢复后的画面，无闪烁。`_web_load` 用 sizeof(sys_state) 校验长度（`size > sizeof 则 return`，见 `web_main.c`）。

注意 `_web_load` 恢复整机状态会覆盖主屏进入游戏现场，这正是期望行为。

### 7.6 存档管理（save-manager）

对话框打开时 `renderSaveSlots()`：读 `currentRomId` 作 storageId，遍历槽 0-2 显示状态。

每槽 4 操作（保存/读取为主按钮，导出/导入为次按钮）：

- **保存**（`saveToSlot(slot)`）：`_web_save_size()` → malloc → `_web_save()` → bytes → base64 → `writeSlot`。覆盖非空槽前 `confirm("覆盖存档槽 N？")`。更新时间戳。
- **读取**（`loadFromSlot(slot)`）：`readSlot` → base64ToBytes → malloc → `_web_load()`（仅非空可用）。
- **导出**（`exportSlot(slot)`）：`readSlot` → 组装 JSON → Blob 下载 `bbk-<游戏名>-save-<slot+1>.json`（仅非空）。
- **导入**（`importToSlot(slot)`）：读 JSON 文件 → 校验（见 7.7）→ `writeSlot`。

### 7.7 存档文件格式（与 rpg 区分，互不串档）

```json
{
  "app": "bbk-games",
  "type": "eebbk-save-slot",
  "version": 1,
  "romId": "fmj-1.0",
  "romName": "伏魔记 1.0",
  "slot": 0,
  "data": "<base64>",
  "exportedAt": "2026-08-05T12:00:00.000Z"
}
```

校验（`parseSavePayload`）：`app` / `type==="eebbk-save-slot"` / `version===1` / slot∈[0,2] / data 是合法 base64；导入时若 `romId !== currentRomId` 报「该存档属于其他游戏」。rpg 的 `dictionary-save-slot`(hex) 不会被误当作 eebbk 存档。

### 7.8 自动断点续玩

时机（仅在 `gameLoaded && !exited` 时执行）：
- `visibilitychange`（`document.hidden` 为真）
- `pagehide`
- 切换游戏前（`useSelectedGame` 热加载新 gam 前，见 7.4）

动作：`_web_save()` → base64 → `localStorage['sav/autosave-'+currentRomId]` + 时间戳。

恢复：见 7.5 bootstrap。

### 7.9 导入外部 .gam

复用现有 file-input / 拖拽 → `loadGame(buf, fileName)`。新增：导入后 `setCurrentRom` 用内容 hash 作 id（`local-<size>-<fnvhash>`，参考 rpg `romStorageId`），名字用文件名。导入的 gam 同样享有按 id 隔离的存档与自动续玩。

### 7.10 键盘与焦点

参考 rpg：对话框打开时拦截方向键/空格等，避免传给游戏内核；Esc 关闭对话框；点击 overlay 空白处关闭；焦点在打开/关闭间还原。

## 8. 不做的事（YAGNI）

- 不引入 rpg 那套「rom hex 存 localStorage + reload」加载模型（eebbk 走 wasm 热加载，更轻）。
- 不做 rom 内嵌 lib 提取（那是 rpg/fmj 引擎的事；eebbk 直接吃 `.gam`）。
- 不兼容旧 `.sav` 裸二进制文件（移除旧「存档」「读档」按钮，统一到新存档管理）。
- picker 不加搜索框（仅 4 个游戏）。
- 不改动 `eebbk/src/*.c` 内核源码（所需导出函数已齐全）。

## 9. 文件改动清单

| 文件 | 改动 |
|---|---|
| `eebbk/roms/catalog.json` | 新建 |
| `eebbk/roms/fmj-1.0.gam` ~ `fmj-1.3.gam` | 由原嵌套目录扁平化而来 |
| `eebbk/roms/1.0伏魔记完整版/` 等 4 目录 | 删除（迁移后） |
| `scripts/build-site.mjs` | emuRuntime 段新增复制 `roms/` 到产物 |
| `eebbk/dialog.css` | 新建（复制 `rpg/app.css` 对话框样式并适配 eebbk 差异） |
| `eebbk/index.html` | 新增 `dialog.css` link；footer 改造；新增 game-picker / save-manager 对话框；标题加 id |
| `eebbk/glue.js` | 新增 picker / save-manager / 热切换 / 存档编解码 / 自动续玩 / bootstrap 恢复；导出纯函数供测试 |
| `eebbk/style.css` | 补充桌面态 `.footer-action` 样式（当前缺失）；保留画面层 / 触控样式 |

## 10. 测试要点

- 4 个版本都能从 picker 选中并热切换进入；切换后标题、存档命名空间随之切换。
- 关机态（触发设备关机后）仍能从 picker 切换（走 pendingRomId + reload）。
- 存档：保存到槽 → 切换到别的游戏 → 切回 → 读取槽位，状态正确恢复。
- 导出 JSON → 删除槽位 → 导入回槽位，状态一致；导入 rpg 的存档文件被拒。
- 自动续玩：游戏中刷新页面，恢复到刷新前现场；切换游戏前自动保存，切回可续。
- 移动端（窄屏 / 触屏）对话框与 footer 布局正常，按钮可达。
- `npm run build` 后 `dist/client/eebbk/roms/` 含 catalog.json + 4 个 gam；rpg 页面视觉无变化。
- `npm run test`（node + python）保持通过（如有相关测试）。
