# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> `AGENTS.md` 是指向本文件的软链接（供 Codex 等其它 Agent 工具读取）——只需编辑本文件 `CLAUDE.md` 即可，无需维护两份。

## 项目概述

步步高（BBK）电子词典经典游戏的**纯静态 Web 合集**：在浏览器里运行当年 ibox 9288/9588、朗文 4980 上的 RPG、策略游戏。无打包器、无前端框架、无 TypeScript——只有原生 HTML/CSS/JavaScript，外加若干手写 `.mjs` 构建脚本。Vercel 部署，线上产物为 `dist/client/`。

门户首页 `index.html` 链接到 4 个**彼此完全独立**的游戏模块，每个模块用的是不同的引擎技术与 ROM 格式。

## 常用命令

```bash
# 本地预览（纯静态，任意静态服务器即可）
python3 -m http.server 8000        # 然后 http://localhost:8000
npx serve

# 测试
npm test                           # 全部（Node + Python）
npm run test:node                  # 仅 Node：node --test tests/*.test.mjs
npm run test:python                # 仅 Python：unittest discover
node --test tests/lcd.test.mjs     # 跑单个 Node 测试文件
python3 -m unittest discover -s tests -p 'test_portal_markup.py'   # 跑单个 Python 测试

# 构建（拷贝到 dist/client/ 并用 terser 压缩 3 个大引擎脚本）
npm run build

# 仅本地、需要 emsdk：把 eebbk 的 C 核心编译为 wasm 产物
npm run build:4980

# 把步步高原生 .gam 转成 fmj 引擎 .lib（提取内嵌资源库）
node scripts/gam2lib.mjs 伏魔记.gam                         # 同目录生成 .lib
node scripts/gam2lib.mjs foo.gam --install fmj_x "显示名"   # 收录进 rpg/roms/ 并登记到 catalog.json
```

## 架构总览

**四个独立模块，技术栈各不相同：**

| 模块 | 目录 | 引擎 | ROM 格式 |
|------|------|------|----------|
| RPG 合集 | `rpg/` | `core.js`（fmj 引擎，Kotlin→JS，~2.9MB） | `.lib` 资源库 |
| 三国霸业 | `sanguobaye/` | iBaye 引擎 `baye.js`（C→JS） | `.lib`（多版本） |
| 魔塔 | `mota/` | Emscripten 编译的 `mtower.js` | 内置于引擎 |
| 电子词典模拟器 | `eebbk/` | libretro 6502 核心 → wasm | `.gam`（4980 原生包） |

**共享资源**（`js/`、`css/`）：
- `js/lcd.js` —— 三国霸业用的单色 LCD（160×96）渲染层；近期做过热路径优化，把逐像素 JS 循环改成 `Uint32` 视图批量写入，纯变换逻辑抽成了可单测的纯函数。
- `js/game-page.js` —— 各游戏页共用的 iOS Safari 下拉刷新屏蔽（挂到 `global.BBKGamePage`）。
- `js/encoding.js` + `encoding-indexes.js` —— GBK↔Unicode 转码（游戏内文本多为 GBK）。
- `js/jquery.min.js`、`js/sprintf.js`、`js/tappy.js` —— 引擎运行时依赖。
- `css/portal.css` —— 门户与游戏页共用的「电子词典外壳」样式。

## 构建系统（关键且不直观）

**两套构建，职责分离：**

1. **`scripts/build-site.mjs`（线上构建）** —— 把仓库原样拷到 `dist/client/`，仅对 3 个大文件做 minify：
   ```js
   const minifiable = ["rpg/core.js", "sanguobaye/js/baye.js", "mota/js/mtower.js"];
   ```
   minify 后会用 `new Function(result.code)` **校验压缩产物可被解析**，防止把损坏脚本发布上线。新增大引擎脚本时，把相对 `client` 的路径追加进此数组。Vercel 的 `buildCommand` 就是 `npm run build`。

2. **`scripts/build-4980.mjs`（仅本地、需 emsdk）** —— 用 `emcmake`/`emmake` 编译 `eebbk/src/*.c` 为 `gam4980.{js,wasm,data}`，拷到 `eebbk/`。**这些 wasm 产物是提交进 git 的**，所以 Vercel 上不需要 emsdk，只负责拷贝。仅当 `eebbk/src` 下的 C 源码变动时才需手动重跑。

> 仓库中**没有 Kotlin/Gradle、没有 Emscripten（除 4980 外）的再编译步骤**——`core.js`、`baye.js`、`mtower.js` 都是直接 checked-in 的成品引擎，构建只做压缩。要改引擎逻辑需直接编辑这些大文件（RPG 引擎尤其大，搜索定位比通读更实际）。

## 各模块要点

### RPG 合集（`rpg/`）
- `core.js`：fmj 引擎，已编译为单一 JS。**直接 checked-in，不参与任何再生成**。引擎用自带脚本 VM 解释执行 `.lib` 内的剧情/逻辑。
- `app.js`：页面 UI（游戏列表、`.lib`/`.gam` 导入、3 存档槽管理），暴露 `BBKSimulator`。
- `srs-anchor.js`：动画精灵锚点计算，暴露 `BBKSrsAnchor`。
- `roms/catalog.json` + 140+ 个 `.lib`：内置游戏清单。
- 浏览器端导入 `.gam` 时会调用 `app.js` 中的 `extractLibFromGam` **动态提取内嵌 `.lib`**——其提取算法必须与 `scripts/gam2lib.mjs` 的 `extractLibFromGam` 保持一致（见下方陷阱）。

### 三国霸业（`sanguobaye/`）
- `js/baye.js`：iBaye 引擎主体；`js/bridge.js`：JS↔引擎桥接（含 `window.onerror`、`Math.random` 接管、格式化 polyfill 等）；`js/backup.js`：存档备份逻辑。
- `libs.json` 列出多版本/MOD（原版精修、无痕修复版、霸哥自制版），对应 `libs/*.lib`。
- 画面经 `js/lcd.js` 渲染为单色 LCD。

### 魔塔（`mota/`）
- `js/mtower.js`：Emscripten 编译产物，checked-in。页面逻辑内联在 `index.html`。

### 电子词典模拟器（`eebbk/`）
- `src/`：C 源码（`libretro.c`/`s6502.c`/`web_main.c`），libretro 6502 核心，源自 [gam4980](https://codeberg.org/iyzsong/gam4980)。
- `gam4980.{js,wasm,data}`：wasm 产物（提交进 git）。
- `glue.js`：JS 粘合层，含存档/导入等纯函数（`bytesToBase64`、`romStorageId`、`slotKey`、`buildSavePayload`）。
- `roms/catalog.json` + `*.gam`：4980 原生游戏包，**直接以 `.gam` 运行**（不转 `.lib`，与 RPG 模块的 `.gam` 用途不同）。

## 调试与数据工具（`tools/`）

Python 脚本，用于排查 fmj（伏魔记）RPG 的存档与 ROM 数据，**不参与构建**。直接读取导出的 JSON 存档里的 `hex` 字段或 `rpg/roms/*.lib`，沿用下方「`.lib` 布局」。

- `change_level.py <save.json> [角色:等级 ...] [--in-place]` —— 定位存档 hex 中以 GB2312 编码的角色名（校验名字长度前缀）及其后的等级字段并改写。不带参数时只列出所有角色与等级。
- `change_stat.py <save.json> [角色:属性:值 ...]` —— 同上，可改 `level/exp/maxHP/hp/maxMP/mp/attack/defend/speed/lingli/luck` 等属性。
- `dump_lqf.py [lib文件]` —— 从 `.lib`（默认 `rpg/roms/fmj_rpg.lib`）解析并打印角色的 `magicChain`/`levelupChain`，用于排查「升级后已学法术被清空」这类法术/升级链 bug。

参考文档：`docs/fmj-goods-data.md` 记录了从 `.lib` 逆向提取的伏魔记装备武器/投掷暗器数据（对照 `core.js` 核实偏移）；`docs/superpowers/` 下是历史设计草稿（plans/specs），非运行时产物。

## 关键约定与陷阱

- **`.gam` 有两种含义，别混。** RPG 的 `.gam` 是 fmj 引擎游戏包（内嵌 `.lib`，可提取）；eebbk 的 `.gam` 是朗文 4980 原生包（直接喂给 6502 模拟器）。两套互不通用——`gam2lib` 只识别 fmj 系。
- **`.lib` 布局**（fmj 引擎）：头 0x10 字节；`@0x10` 索引表每条 3 字节 `(resType, type, index)`，遇 `0xff` 结束；`@0x2000` 偏移表每条 3 字节 `(block, low, high)`，定位 `offset = block*0x4000 + (high<<8 | low)`。`resType ∈ 1..12`。提取算法在 `gam2lib.mjs` 与 `rpg/app.js` 两处**各有一份副本，必须同步修改**。
- **存档系统**：每个游戏 3 个存档槽（部分含 autosave），基于 `localStorage`，以 JSON 备份文件导入/导出。RPG（`app.js`）和 eebbk（`glue.js`）各有一套 `romStorageId`/`slotKey` 等纯函数实现，结构类似但互相独立。
- **`romStorageId` 是 FNV-1a 哈希**：导入的 ROM 用 `local-<size>-<hash>` 作存档隔离键，内置游戏用 `catalogId`。
- **改引擎逻辑后，发布前务必跑一次 `npm run build` 并本地预览**——minify 阶段会拦截语法错误，但语义回归只能靠手测。

## 测试方式

没有浏览器/无头浏览器；JS 测试在 Node 里**把源码加载进沙箱**再测纯函数：
- `vm.runInNewContext(source, mockContext)` 加载依赖 DOM 的脚本（`js/lcd.js` 等），用 mock 的 `window`/`document`/`$`。
- 或直接 `await import("../rpg/app.js")` 取挂到 `globalThis` 的对象（`BBKSimulator`、`BBKSrsAnchor`）。
- 测试夹具用**真实的 `.lib`/`.gam` ROM**（如 `rpg/roms/` 下的文件）解析后断言，覆盖 gam2lib 提取、srs 锚点、lcd 位图变换、存档序列化等。
- `test_rpg_*.test.mjs` 系列是 fmj 引擎逻辑的回归测试（法术消耗/学习、战斗胜利与击杀飘字、装备属性正负号、群体恢复过量等），用上述沙箱方式驱动 `core.js`；修 RPG 引擎后应优先确认这些测试通过。
- Python 测试（`tests/test_*.py`）校验门户与各页 HTML 标记结构、静态资源引用完整性。
