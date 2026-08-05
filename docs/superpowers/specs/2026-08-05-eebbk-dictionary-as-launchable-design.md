# EEBBK 电子词典改为「可启动条目」+ 进入不自动加载词典 设计

- 日期：2026-08-05
- 范围：`eebbk/` 模拟器（朗文 4980，`gam4980.wasm` 内核）
- 前置：已落地的 game-switcher（选择游戏 / 存档管理 / 断点续玩，见 `2026-08-05-eebbk-game-switcher-design.md`）

## 1. 目标

1. **进入不自动加载词典**：打开 eebbk 页面时，不再无条件开机进入电子词典主屏；默认停在占位画面（"拖拽 .gam / 点击选择游戏"）。
2. **词典做成选择器里的可启动条目**：在「选择游戏」列表最顶部新增「电子词典系统」，带一个淡淡的「系统」小标签。
3. **选中即进入词典系统**：选中该条目并「使用」后，开机进入电子词典主屏。
4. **记住选择并自动进入**：用户一旦明确选择过（词典或某款游戏），下次打开页面自动进入该项；断点续玩（上次在玩的游戏自动恢复）保持不变。

## 2. 背景与关键约束

### 2.1 现状（`eebbk/glue.js`）

- 启动处 `Gam4980Module().then`：`_web_init()` 加载固件后，**无条件**调用 `startEmulator()` → 设备开机进入主屏（即电子词典界面）。这正是"自动加载词典"的来源（约第 841 行）。
- picker 列表来自 `fetch('roms/catalog.json')`，条目结构 `{id, name, py, initial}`；选中 + 「使用」→ `fetch('roms/<id>.gam')` → `loadGame()`。
- 返回页面时：`pendingRomId`（关机态热切换的一次性指令）优先；否则若 `currentRomId` 有对应 autosave，恢复该游戏（断点续玩）；否则落到"开机进主屏"的默认分支。
- `setCurrentRom(id, name)`：写 `currentRomId/currentRomName`、更新标题、按 `id` 非空启用「存档管理」。
- `autosaveCurrent()`：对 `local-` 开头的本地导入 ROM 已跳过持久化。

### 2.2 内核约束

- wasm 导出面无"退出游戏回主屏"接口（仅有 `_web_init/_web_load_game/_web_run_frame/_web_save/_web_load/_web_save_size/_web_keydown` 及 framebuffer getter）。因此"从运行中的游戏切回词典主屏"无法热切换，需 `location.reload()`；"从占位画面进入词典"可即时 `startEmulator()`。
- 词典主屏是固件自身 UI：`_web_init()` 加载固件后，运行帧循环即引导进入主屏。延迟调用 `startEmulator()` 即可延迟主屏出现。

### 2.3 标识约定

- 用哨兵 id `'__home__'` 代表电子词典系统。catalog 真实 id 均为中文游戏名，无碰撞。
- `__home__` 在存档/续玩体系中等同于"无 ROM"：不参与槽位存档、不写 autosave。

## 3. 行为规格

### 3.1 启动 / 进入（bootstrap）

页面加载 → 占位画面默认可见（HTML 默认，无闪烁）。wasm 就绪后按"记住的选择"决策：

```
Module = mod
web_init() 失败 → fatalError（原逻辑，不变）
restoreCurrentRomFromStorage(); loadCatalog()        // 原逻辑，不变
// 不再无条件 startEmulator()；按下表决策：
pendingRomId 存在:                                     // 关机态热切换的一次性指令
   '__home__'  → setCurrentRom('__home__', pendingRomName); startEmulator()
   游戏名 id   → fetch roms/<id>.gam → loadGame(...)        // 原逻辑
   （消费后清除 pendingRomId/pendingRomName）
否则按 currentRomId:
   '__home__'  → startEmulator()                         // 记住的选择=词典 → 进主屏
   某游戏 id   → fetch roms/<id>.gam → _web_load_game（填 flash）
                 若有 autosave → _web_load 叠加恢复 ram/cpu/bk_tab   // 断点续玩
                 gameLoaded=true; startEmulator()        // 推广：无 autosave 也进入该游戏
                 fetch 失败 → console.warn + 清除该 currentRomId，停留占位画面
   空 / 未选择 → 不调用 startEmulator()，停留占位画面
```

要点：
- 移除原来"无条件 `startEmulator()` 进主屏"的兜底；仅当记住的选择是 `__home__` 或某游戏时才开机/加载。
- `pendingRomId` 分支必须特判 `__home__`（否则会 `fetch('roms/__home__.gam')` 404）。
- 断点续玩由"仅当有 autosave 才恢复"推广为"有 autosave 则恢复、否则也加载该游戏进入"，以兑现"用户选过就自动进入"。`_web_load_game` 先于 `_web_load`，顺序同现有 resume 块（先填 flash 再叠加 ram/cpu）。

### 3.2 选择器列表（`loadCatalog` / `renderGames`）

- `loadCatalog` fetch 成功后，向 `picker.games` **第 0 位**注入合成条目：
  `{ id: '__home__', name: '电子词典系统', py: 'dianzicidianxitong', initial: 'dzcdxt', isSystem: true }`
- 该条目照常参与搜索过滤（搜"魔塔"时隐藏；搜"词典"/"dz"时命中）；显示时固定排首位、编号 `01`。
- `renderGames` 渲染该卡片时，在名字旁追加一个淡淡的「系统」小标签（新样式 `.rom-tag`，见 §5）；其余卡片不变。
- 选中态、计数文本等沿用现有逻辑（注入后 `__home__` 即在 `picker.games` 内，选中/计数自然兼容）。

### 3.3 启动电子词典（`useSelectedGame` 特判 `__home__`）

```
useSelectedGame():
  id = picker.selectedId
  若 id === '__home__':
     name = '电子词典系统'
     setBusy(true)
     若 exited（已关机）:
        writeLS(pendingRomId, '__home__'); writeLS(pendingRomName, name); location.reload()
     否则若 !started（占位画面，未开机）:
        setCurrentRom('__home__', name); startEmulator(); setBusy(false); closePicker()
     否则（运行游戏中切换）:
        autosaveCurrent(); setCurrentRom('__home__', name); location.reload()
     return
  // 以下为原有游戏分支，不变
  fetch roms/<id>.gam → ...
```

reload 后由 §3.1 消费 `__home__` → `startEmulator()` 进主屏。切走前的游戏 autosave 已保留（按游戏 id 隔离），下次选该游戏仍可续。

### 3.4 存档管理 / autosave 对 `__home__`

- `setCurrentRom`：当 `id === '__home__` 时**禁用**「存档管理」（主屏无有意义进度）。
- `autosaveCurrent`：`id === '__home__'` 时跳过（与 `local-` 跳过并列）。
- bootstrap 恢复：`__home__` 不走 fetch ROM / `_web_load` 路径，仅 `startEmulator()`。

## 4. 记住选择的语义

- "记住的选择"= localStorage 中的 `currentRomId`：`__home__`（词典）/ 游戏名 id（游戏）/ 空（从未选过）。
- 首次（空）→ 占位画面；一旦在 picker 里「使用」过任一项，即写入 `currentRomId`，下次自动进入。
- 持久保留，仅清浏览器存储才会重置。不做"忘记选择"按钮（YAGNI）。
- 与断点续玩一致：选过游戏 → 下次自动恢复/进入该游戏；选过词典 → 下次自动进主屏。

## 5. 样式（`eebbk/dialog.css`）

新增「系统」小标签样式，复用现有 LCD 视觉语言（低饱和、小字号）：

```css
.rom-card .rom-tag {
  display: inline-block;
  margin-left: .5em;
  padding: 0 .4em;
  font-size: .7em;
  line-height: 1.4;
  border: 1px solid currentColor;
  border-radius: .3em;
  opacity: .6;
  text-transform: uppercase;
  letter-spacing: .05em;
}
```

仅在 `isSystem` 卡片渲染时插入 `<span class="rom-tag">系统</span>`；普通卡片零改动。

## 6. 文件改动清单

| 文件 | 改动 |
|---|---|
| `eebbk/glue.js` | bootstrap：去掉无条件 `startEmulator()`，改为按 `currentRomId` 决策（`__home__`/游戏/空）；`loadCatalog` 注入 `__home__` 置顶；`renderGames` 给系统卡片加 `rom-tag`；`useSelectedGame` 特判 `__home__`；`setCurrentRom` 对 `__home__` 禁用存档管理；`autosaveCurrent` 跳过 `__home__`；推广断点续玩（无 autosave 也进入游戏） |
| `eebbk/dialog.css` | 新增 `.rom-tag` 样式 |

HTML、`catalog.json`、构建脚本、wasm 内核均不改。

## 7. 不做的事（YAGNI）

- 不把 `__home__` 写进 `catalog.json`（合成注入即可，避免污染生成的 ROM 清单）。
- 不为"游戏 → 词典"热切换找特殊接口（无此 wasm 接口；用 reload 兜底）。
- 不给词典主屏做存档/续玩（无意义进度）。
- 不做"忘记上次选择"按钮。
- 不改 HTML 结构（系统标签由 JS 渲染插入）。

## 8. 测试要点

- 全新存储（无 `currentRomId`）：打开页面停占位画面，不自动进词典。
- 占位画面 → picker → 选「电子词典系统」→ 使用 → 即时进入词典主屏，标题变「电子词典系统」，存档管理保持禁用。
- 选过词典后刷新 → 自动进词典主屏（记住选择）。
- 选过某游戏后刷新 → 自动恢复/进入该游戏（断点续玩不变）。
- 运行游戏中打开 picker → 选词典 → autosave 当前游戏后 reload → 进词典主屏；再选回该游戏 → 能从 autosave 续上。
- 关机态（`exited`）选词典 → reload 后进主屏。
- 搜索：输入游戏名时词典条目随之隐藏/出现；清空后词典回到首位 01。
- 词典卡片显示「系统」小标签，普通卡片无标签、视觉无其他回归。
- `npm run build` 产物与 `npm run test` 保持通过。
