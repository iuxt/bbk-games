# fmj_kt 重编译打包说明（实验分支）

本目录是上游 [baye-fmj-app](https://github.com/erduoniba/baye-fmj-app) 的
`Fmj/fmj_kt` Kotlin/JS 源码副本，用于把 `rpg/core.js` 从「手修补丁的成品」
切换为「上游源码直接编译」的产物。

## 目录

- `src/` —— 上游 Kotlin 源码（107 个 .kt，未做任何修改）
- `glue/head.js`、`glue/tail.js` —— 从旧 core.js 提取的 bbk 宿主胶水：
  GB18030 polyfill、sys* 原生函数（键盘映射 / canvas 绘制 / localStorage
  存档隔离 / `game.rom` ROM 桥），并追加了上游新增 external 函数的打桩
  （存档槽 3、倍数 1、不显示事件点等，均保持原版默认行为）；
  `GAME.ROM.LIB` 是 `sysGetChoiceLibName()` 新读取路径到旧 `GAME.ROM` 键的别名。
- `smoke-boot.mjs` —— Node vm 沙箱启动冒烟（mock 宿主 + 真实 ROM）。
- `build.gradle.kts` 等 —— 上游原始 gradle 配置（本流水线不用 gradle，
  直接调 K2JSCompiler，见下）。

## 构建步骤

```bash
# 前置：JDK（brew install openjdk@17）+ kotlin-compiler-1.6.21.zip（GitHub Releases）

unzip -o kotlinc/lib/kotlin-stdlib-js.jar kotlin.js -d fmj_kt/build

JAVA_HOME=$(/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home) \
  java -cp "kotlinc/lib/*" org.jetbrains.kotlin.cli.js.K2JSCompiler \
  -main noCall -output fmj_kt/build/game.core.js fmj_kt/src

node scripts/build-fmj-core.mjs   # 缝合 → rpg/core.js
node fmj_kt/smoke-boot.mjs        # 沙箱冒烟
```

打包脚本会把 kotlin 标准库与模块做 `kotlin→typescript` 词边界重命名
（与历史 core.js 一致），缝合 `main([])` 自启动，并保留宿主胶水层。
`fmj_kt/build/` 为编译中间产物，不入库。

## 已知差异（与 main 分支手修版相比）

- 上游 HEAD 源码自带部分同等修复（满级队员跳过经验、回合上限生效、
  每回合重置回合事件标志、复活量用 max(0,hp) 等）；
- 上游新增功能带较多 console 调试日志（PlayerStats/HP_CHANGE 等）；
- `tests/test_rpg_*` 中约 48 个「源码 pin」测试失败：它们匹配的是旧手修
  补丁的文本特征，不适用于编译产物格式，同时其中部分 bbk 修复上游源码
  并不包含——本分支用于对比验证上游行为，合入前需逐项评估。
