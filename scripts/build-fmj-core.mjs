/**
 * 把上游 fmj_kt（Kotlin/JS 1.6.21 legacy 后端）的编译产物打包成 rpg/core.js。
 *
 * 打包形态与历史 core.js 逐段同构：
 *   [kotlin.js 运行时，重命名 kotlin→typescript / Kotlin→Typescript]
 *   [fmj_kt/glue/head.js  —— GB18030 polyfill + bbk 宿主 sys* 原生函数 + ROM 桥]
 *   [游戏模块（-main noCall 编译，缝合时注入 main([]) 自启动）]
 *   [fmj_kt/glue/tail.js  —— 收尾 "}" ]
 *
 * 编译命令（需要 JDK 与 kotlin-compiler-1.6.21，产物放 fmj_kt/build/）：
 *   # 1) 提取与编译器同版本的 JS 标准库运行时
 *   unzip -o kotlinc/lib/kotlin-stdlib-js.jar kotlin.js -d fmj_kt/build
 *   # 2) 编译游戏模块（模块名取自输出文件名，须为 game.core）
 *   java -cp "kotlinc/lib/*" org.jetbrains.kotlin.cli.js.K2JSCompiler \
 *     -main noCall -output fmj_kt/build/game.core.js fmj_kt/src
 *
 * 用法：node scripts/build-fmj-core.mjs [--module path] [--kotlin-js path]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function argValue(name, fallback) {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const modulePath = path.resolve(argValue("--module", path.join(root, "fmj_kt/build/game.core.js")));
const kotlinJsPath = path.resolve(argValue("--kotlin-js", path.join(root, "fmj_kt/build/kotlin.js")));
const headPath = path.join(root, "fmj_kt/glue/head.js");
const tailPath = path.join(root, "fmj_kt/glue/tail.js");
const outPath = path.join(root, "rpg/core.js");

/**
 * 历史打包对 stdlib 与模块做过重命名（kotlin→typescript），保持一致。
 * 只重命名独立 token（\b 词边界）：KotlinVersion、kotlinx、
 * sysLoadBoxMappingsIntoKotlin 等含 kotlin 子串的标识符不受影响。
 * package$kotlin 中 $ 为非词字符，会被正常重命名（与历史文件一致）。
 */
function renameKotlinToTypescript(source) {
    return source.replace(/\bKotlin\b/g, "Typescript").replace(/\bkotlin\b/g, "typescript");
}

function transformStdlib(source) {
    let out = renameKotlinToTypescript(source);
    // 没有随包部署 source map，去掉尾部引用注释
    out = out.replace(/^\/\/# sourceMappingURL=.*$/m, "");
    if (!out.includes("Typescript.defineModule('typescript', _)")) {
        throw new Error("stdlib 缺少 defineModule('typescript')：输入可能不是 legacy 后端产物");
    }
    return out.trimEnd();
}

function transformModule(source) {
    let lines = source.split("\n");
    // 剥离 prologue：if (typeof kotlin === 'undefined') { throw ... }（3 行）
    if (!lines[0].startsWith("if (typeof kotlin === 'undefined')")) {
        throw new Error("模块 prologue 不符合预期：期待 'if (typeof kotlin ...' 开头");
    }
    lines = lines.slice(3);

    let out = renameKotlinToTypescript(lines.join("\n"));

    // 头部：this['game.core'] = function (_, Typescript) { → window["game.core"] = ...
    const header = `this['game.core'] = function (_, Typescript) {`;
    if (!out.includes(header)) {
        throw new Error("未找到模块头部声明 this['game.core'] = function (...)");
    }
    out = out.replace(header, `window["game.core"] = function(_, Typescript) {`);

    // 尾部调用：}(typeof this['game.core'] === 'undefined' ? {} : this['game.core'], typescript);
    const footer = `}(typeof this['game.core'] === 'undefined' ? {} : this['game.core'], typescript);`;
    if (!out.trimEnd().endsWith(footer)) {
        throw new Error("未找到模块尾部调用 }(..., typescript);");
    }
    out = out.replace(footer, `}(typeof window["game.core"] === "undefined" ? {} : window["game.core"], typescript);`);

    // 注入自启动：与历史 seam 一致，在 defineModule 前调用 main([])
    const defineLine = `  Typescript.defineModule('game.core', _);`;
    if (!out.includes(defineLine)) {
        throw new Error("未找到 Typescript.defineModule('game.core', _)");
    }
    out = out.replace(defineLine, `  main([]);\n${defineLine}`);
    return out.trimEnd();
}

const [stdlib, moduleJs, head, tail] = await Promise.all([
    readFile(kotlinJsPath, "utf8"),
    readFile(modulePath, "utf8"),
    readFile(headPath, "utf8"),
    readFile(tailPath, "utf8"),
]);

const parts = [
    transformStdlib(stdlib),
    "", // stdlib 与 polyfill 之间空一行，与历史文件一致
    head.trimEnd("\n"),
    transformModule(moduleJs),
    tail.trimEnd(),
    "",
];

const result = parts.join("\n");
await writeFile(outPath, result);

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
console.log(`rpg/core.js 已生成：${kb(result.length)}（stdlib ${kb(stdlib.length)} + 胶水 ${kb(head.length)} + 模块 ${kb(moduleJs.length)}）`);
