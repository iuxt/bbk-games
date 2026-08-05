# gam4980

步步高A系列电子词典模拟器的 libretro 核心

## 仓库原始来源: https://codeberg.org/iyzsong/gam4980.git

- `master` 分支为原始代码

---

本项目提供步步高朗文4980电子词典游戏模拟器的 libretro 核心。

本项目基于：

- [BA4988 模拟器](https://gitee.com/BA4988/BBK-simulator)，作者：无云。
- [vrEmu6502](https://github.com/visrealm/vrEmu6502) by Troy Schrapel, optimizing with computed goto and macros.
- [sph-sc](https://github.com/sph-mn/sph-sc), generate C code with tidier scheme code.

This project provides a libretro core to play games from BBK Longman
4980 electronic dictionary. 2 ROM files (8.BIN and E.BIN) are needed,
which can be dumped from 0x800000-0x9fffff and 0xe00000-0xffffff.

---

## 编译

[build](./build/) 目录下包含各平台的构建脚本。

### macOS

**前提条件：**

```sh
# 安装 Xcode Command Line Tools（如未安装）
xcode-select --install
```

**构建：**

```sh
# 仅编译当前架构 (arm64 或 x86_64)
./build/build-macos.sh

# 编译通用二进制 (arm64 + x86_64)
./build/build-macos.sh --universal
```

### Linux / 其他平台

使用 dockcross 交叉编译，或直接使用 Zig 构建系统。详见 [build](./build/) 目录。

---

## 安装与使用

以下以 macOS 为例，其他平台路径参见 RetroArch 文档。

### 1. 安装核心文件

```sh
# 复制核心动态库
cp gam4980_libretro.dylib ~/Library/Application\ Support/RetroArch/cores/

# 复制核心信息文件（RetroArch 靠它识别核心）
cp retroarch/core_info/gam4980_libretro.info ~/Library/Application\ Support/RetroArch/info/
```

### 2. 放置 ROM 文件

```sh
# 创建 ROM 目录并复制 BIOS 文件
mkdir -p ~/Library/Application\ Support/RetroArch/system/gam4980
cp retroarch/system/gam4980/8.BIN ~/Library/Application\ Support/RetroArch/system/gam4980/
cp retroarch/system/gam4980/E.BIN ~/Library/Application\ Support/RetroArch/system/gam4980/
```

> ⚠️ 文件名区分大小写，必须为大写的 **8.BIN** 和 **E.BIN**。

### 3. 加载游戏

1. 打开 RetroArch
2. **Main Menu → Load Core** → 选择 **GAM4980**
3. **Main Menu → Load Content** → 选择 `.gam` 游戏文件（位于 `retroarch/downloads/bbk/`）
4. 开始游戏

> 核心支持无游戏启动 (`supports_no_game = true`)，不加载内容直接启动核心将进入词典主界面。

### 各平台路径速查

| 内容 | macOS | Linux |
|------|-------|-------|
| 核心 `.dylib` / `.so` | `~/Library/Application Support/RetroArch/cores/` | `~/.config/retroarch/cores/` |
| 核心信息 `.info` | `~/Library/Application Support/RetroArch/info/` | `~/.config/retroarch/info/` |
| System/BIOS | `~/Library/Application Support/RetroArch/system/` | `~/.config/retroarch/system/` |
| ROM 文件 | `…/system/gam4980/8.BIN` | `…/system/gam4980/8.BIN` |

### 故障排查

**"Missing 8.BIN" 错误：**
1. 确认文件已放入正确的 system 目录：RetroArch 内 **Settings → Directory → System/BIOS** 可查看实际路径
2. 确认文件名是大写的 `8.BIN` 和 `E.BIN`
3. 如果用 DMG 安装的 RetroArch，其目录可能独立于 `~/Library`，以 RetroArch 设置中显示的路径为准

**核心未出现在 Load Core 列表中：**
1. 确认 `gam4980_libretro.info` 已放入 `info/` 目录
2. RetroArch 内 **Settings → Core → Manage Cores** 刷新核心列表

---

## ROM

[retroarch](./retroarch/) 目录下为 retroarch 需要的文件

## 修改

- 增加条件编译符 `SWAP_LCD_WIDTH_HEIGHT`, 用以对换LCD宽高，使某些环境使用核心屏幕比例时能正常工作(RG28XX)
