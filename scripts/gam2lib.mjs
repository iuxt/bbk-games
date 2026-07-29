#!/usr/bin/env node
// gam2lib.mjs — 从步步高原生 .gam 包中提取内嵌的 fmj 引擎 .lib 资源库。
//
// .gam 内部在某个偏移处内嵌了一个完整、标准的 .lib（与 rpg/roms/*.lib 同源，
// 实测与 fmj.kt 自带的 fmj.lib 逐字节相同）。本脚本动态定位并截取它，无需
// 逆向任何资源格式。提取算法与 rpg/app.js 的 extractLibFromGam 保持一致。
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- 提取算法 ----
// lib 布局：头部 0x10 字节；索引表 @0x10 每条 3 字节(resType,type,index)遇 0xff 止；
// 偏移表 @0x2000 每条 3 字节(block,low,high)；定位 offset=block*0x4000+(high<<8|low)。
// ResType 取值 1-12。
function validateEmbeddedLib(u, base) {
    const libLen = u.length - base;
    if (libLen < 0x4000) return false;
    let i = base + 0x10;
    let j = base + 0x2000;
    let count = 0;
    while (i < u.length && u[i] !== 0xff) {
        const resType = u[i];
        if (resType < 1 || resType > 12) return false;
        i += 3;
        if (j + 3 > u.length) return false;
        const block = u[j];
        const low = u[j + 1];
        const high = u[j + 2];
        j += 3;
        if (block * 0x4000 + ((high << 8) | low) >= libLen) return false;
        count += 1;
        if (count > 10000) return false;
    }
    return count > 0;
}

export function extractLibFromGam(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 4; i + 3 <= u.length; i += 1) {
        if (u[i] === 0x4c && u[i + 1] === 0x49 && u[i + 2] === 0x42 &&
                validateEmbeddedLib(u, i)) {
            return u.slice(i);
        }
    }
    throw new Error("未找到有效的内嵌 lib（可能不是 fmj 引擎的 .gam）");
}

// 统计资源条数（用于日志）
function countResources(u) {
    let i = 0x10;
    let n = 0;
    while (i < u.length && u[i] !== 0xff) {
        i += 3;
        n += 1;
    }
    return n;
}

// ---- CLI ----
const HELP = `gam2lib — 从 .gam 提取内嵌 .lib

用法:
  node scripts/gam2lib.mjs <input.gam> [更多.gam ...]   转换为同名 .lib（同目录）
  node scripts/gam2lib.mjs <input.gam> -o <out.lib>     指定输出路径
  node scripts/gam2lib.mjs <目录>                       批量处理目录下所有 .gam
  node scripts/gam2lib.mjs <input.gam> --install <id> <名称>
        转换并写入 rpg/roms/<id>.lib，同时登记到 rpg/roms/catalog.json`;

async function expandInput(p) {
    const s = await stat(p);
    if (!s.isDirectory()) return [p];
    const entries = await readdir(p, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
        const sub = path.join(p, e.name);
        if (e.isDirectory()) {
            out.push(...(await expandInput(sub)));
        } else if (/\.gam$/i.test(e.name)) {
            out.push(sub);
        }
    }
    return out;
}

function defaultOutput(inputGam) {
    return inputGam.replace(/\.gam$/i, ".lib");
}

async function installToRoms(libBytes, id, name) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const romsDir = path.join(root, "rpg", "roms");
    await mkdir(romsDir, { recursive: true });
    const libPath = path.join(romsDir, id + ".lib");
    await writeFile(libPath, libBytes);

    const catPath = path.join(romsDir, "catalog.json");
    const catalog = JSON.parse(await readFile(catPath, "utf8"));
    const entry = { id, name };
    const idx = catalog.findIndex((g) => g.id === id);
    if (idx >= 0) catalog[idx] = entry;
    else catalog.push(entry);
    const body = catalog.map((g) => "  " + JSON.stringify(g)).join(",\n");
    await writeFile(catPath, "[\n" + body + "\n]\n", "utf8");
    return libPath;
}

async function convertOne(inputGam, outputLib) {
    const gam = new Uint8Array(await readFile(inputGam));
    const lib = extractLibFromGam(gam);
    await mkdir(path.dirname(outputLib), { recursive: true });
    await writeFile(outputLib, lib);
    return { lib, outputLib };
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
        console.log(HELP);
        return;
    }

    let output = null;
    let install = null;
    const inputs = [];
    for (let k = 0; k < argv.length; k += 1) {
        const a = argv[k];
        if (a === "-o" || a === "--output") {
            output = argv[++k];
        } else if (a === "--install") {
            install = { id: argv[++k], name: argv[++k] };
        } else {
            inputs.push(a);
        }
    }

    if (install && (!install.id || !install.name)) {
        console.error("--install 需要提供 <id> 和 <名称> 两个参数");
        process.exit(2);
    }
    if (install && inputs.length !== 1) {
        console.error("--install 仅支持单个输入 .gam");
        process.exit(2);
    }
    if (output && inputs.length !== 1) {
        console.error("-o/--output 仅支持单个输入 .gam");
        process.exit(2);
    }

    let files = [];
    for (const p of inputs) {
        if (!existsSync(p)) {
            console.error(`找不到: ${p}`);
            process.exitCode = 1;
            continue;
        }
        files.push(...(await expandInput(p)));
    }
    files = [...new Set(files)];
    if (files.length === 0) {
        console.error("没有可处理的 .gam 文件");
        process.exit(1);
    }

    let failures = 0;
    for (const inputGam of files) {
        try {
            if (install) {
                const { lib } = await convertOne(inputGam, install.id + ".lib");
                const libPath = await installToRoms(lib, install.id, install.name);
                console.log(
                    `${inputGam} -> ${libPath} (${lib.length} 字节, ${countResources(lib)} 资源) [已收录]`
                );
            } else {
                const outputLib = output || defaultOutput(inputGam);
                const { lib } = await convertOne(inputGam, outputLib);
                console.log(
                    `${inputGam} -> ${outputLib} (${lib.length} 字节, ${countResources(lib)} 资源)`
                );
            }
        } catch (e) {
            console.error(`失败: ${inputGam} — ${e.message}`);
            failures += 1;
        }
    }
    if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
});
