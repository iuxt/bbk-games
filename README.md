# 步步高电子词典经典游戏合集

在浏览器里重温步步高（BBK）电子词典时代的经典游戏。本项目将当年运行在 ibox 9288 / 9588、朗文 4980 等机型上的 RPG、策略游戏重新带到 Web 端，无需安装、打开即玩。

## 在线游玩

- 地址一：<https://bbk-games.vercel.app>
- 地址二：<https://bbk-games.zahui.fan/>

## 游戏内容

项目包含三大模块：

| 模块 | 说明 | 引擎 |
|------|------|------|
| **RPG 合集** | 140+ 款经典 RPG，覆盖众多系列与版本 | fmj 引擎（Kotlin → JS） |
| **三国霸业** | 三国题材回合策略，含多个版本 / MOD | iBaye 引擎 |
| **魔塔** | 经典层数探索 RPG（160×96） | Emscripten 编译引擎 |

### RPG 合集亮点系列

合集收录的游戏大多来自当年步步高玩家社区的原创与移植，以下按系列归类：

- **伏魔记系列** —— 步步高上最具代表性的国产奇幻回合 RPG，本合集收录了正式版、完美版、经典版、WG 版、伏魔记 2、新伏魔记、伏魔记外传、伏魔新传、封魔录、屠魔等多个版本。
- **仙剑系列** —— 致敬大宇《仙剑奇侠传》的移植 / 同人作品，涵盖仙剑二、仙剑三（含豪华版 / 贺岁版）、仙剑四、多部外传与序章。
- **金庸群侠传系列** —— 取材金庸武侠世界，含原版、超级版、暗黑时代等变体。
- **三国题材** —— 赤壁之战、三国群英、真三国志、混战三国、大话三国、战国争霸、忠义水浒等。
- **经典作品致敬** —— 暗黑破坏神、洛克人、蜘蛛侠三、火影乱斗、口袋怪兽、最终幻想、冒险岛、梦幻西游、问道等在词典上的移植版本。
- **校园 / 论坛题材** —— 校园传奇、疯狂校园、拖鞋校园、论坛风云录、一中传奇、步步高网友俱乐部等，带有浓厚的当年学生与网友社区印记。
- **其他原创 RPG** —— 侠客行、英雄坛说、绝代双骄、大唐双龙传、盗墓录、地牢围攻、天之痕、七剑、走江湖等。

> 完整游戏清单见 [`rpg/roms/catalog.json`](rpg/roms/catalog.json)，共 140 余款。

## 本地运行

纯静态站点，任意静态服务器即可：

```bash
# 方式一：Python
python3 -m http.server 8000

# 方式二：Node（如装了 serve）
npx serve
```

然后浏览器打开 <http://localhost:8000>，进入对应游戏页面。

## 导入自己的游戏（ROM）

除了内置游戏，RPG 页面支持导入你自己的游戏文件。

### 方式一：直接导入 `.lib`

进入 RPG 页面 →「导入 .lib / .gam」选择 `.lib` 文件即可立即游玩。`.lib` 是 fmj 引擎的资源库格式，也是本项目内置 ROM 使用的格式。

### 方式二：导入 `.gam`（自动转换）

从步步高原生平台下载的游戏通常是 `.gam` 格式。RPG 页面同样支持直接导入 `.gam`——前端会**自动提取其中的资源库并加载**，无需手动转换。

### 方式三：命令行批量转换 `gam → lib`

提供命令行工具 [`scripts/gam2lib.mjs`](scripts/gam2lib.mjs)，适合批量转换或把游戏永久收录进游戏列表：

```bash
# 转换单个文件（生成同名 .lib 到同目录）
node scripts/gam2lib.mjs 伏魔记.gam

# 指定输出路径
node scripts/gam2lib.mjs 伏魔记.gam -o out.lib

# 批量处理某个目录下的所有 .gam
node scripts/gam2lib.mjs /path/to/gams/

# 转换并收录进游戏列表（写入 rpg/roms/ 并登记到 catalog.json）
node scripts/gam2lib.mjs 伏魔记.gam --install fmj_custom "伏魔记（自定义版）"
```

**转换原理**：经逆向分析（对照伏魔记引擎源码 [fmj.kt](http://gitee.com/bgwp/fmj.kt) 中的 `DatLib` 类），`.gam` 包内部在某个偏移处**内嵌了一个完整、标准的 `.lib`** 资源库。工具动态定位其中的 `"LIB"` 段并校验结构（索引表 / 偏移表 / 资源类型自洽）后截取，无需逆向任何资源格式，也无需翻译脚本。实测从伏魔记 `.gam` 提取的 `.lib` 与官方 `fmj.lib` 逐字节一致。

> ⚠️ **适用范围**：仅支持 fmj 系引擎的 `.gam`（即内嵌 LIB 者）。魔塔等其它引擎的 `.gam` 不含此类资源库，会被识别并提示「不是 fmj 引擎格式」，无法转换。

## 存档管理

每个游戏提供 3 个独立存档槽，可在「存档管理」弹窗中导入 / 导出。存档以 JSON 备份文件形式保存，包含版本与槽位信息，方便备份与迁移。

## 技术架构

三大模块各自独立，技术栈不同：

- **RPG 合集**（`rpg/`）：引擎源自 [redwolf-zh/bbk-games](https://github.com/redwolf-zh/bbk-games)，由伏魔记引擎 [fmj.kt](http://gitee.com/bgwp/fmj.kt)（Kotlin）编译为 JavaScript；ROM 采用 `.lib` 资源库格式，游戏逻辑由引擎自带的脚本 VM 解释执行。
- **三国霸业**（`sanguobaye/`）：基于 [iBaye](http://gitee.com/bgwp/iBaye) 引擎。
- **魔塔**（`mota/`）：原生 C 引擎经 Emscripten 编译为 JavaScript（`mtower.js`）。

`.gam` 与 `.lib` 的区别：`.gam`（magic `GAM\0`）是步步高原生平台分发的**游戏包**，内含原生数据与内嵌资源库；`.lib`（magic `LIB`）是 fmj 引擎的**资源库**，按资源类型（剧情脚本 GUT、地图 MAP、角色 ARS、法术 MRS、动画 SRS、道具 GRS、图块 TIL 等）索引组织，供引擎按需读取。

## 目录结构

```
.
├── index.html          # 门户首页
├── rpg/                # RPG 合集（页面、引擎 core.js、ROM）
│   └── roms/           # catalog.json + 140+ 个 .lib
├── sanguobaye/         # 三国霸业（页面、引擎、多版本 lib）
├── mota/               # 魔塔（页面 + mtower.js）
├── scripts/
│   ├── build-site.mjs  # 站点构建
│   └── gam2lib.mjs     # gam → lib 转换工具
├── css/  js/           # 门户及各游戏共用资源
└── tests/              # Node + Python 测试
```

## 开发与测试

```bash
npm test          # 运行全部测试（Node + Python）
npm run build     # 构建站点到 dist/
```

## 致谢

本项目建立在前辈们逆向与移植工作之上，鸣谢：

- 伏魔记引擎：[bgwp/fmj.kt](http://gitee.com/bgwp/fmj.kt)、[redwolf-zh/bbk-games](https://github.com/redwolf-zh/bbk-games)
- 三国霸业引擎：[bgwp/iBaye](http://gitee.com/bgwp/iBaye)
- https://codeberg.org/iyzsong/gam4980
- 当年所有为步步高电子词典贡献游戏与工具的玩家与开发者

游戏版权归各自作者所有，本项目仅作学习与怀旧用途。
