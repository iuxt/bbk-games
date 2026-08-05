import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const client = path.join(dist, "client");
const files = [
    "index.html",
    "favicon.png",
    "robots.txt",
    "sitemap.xml",
];
const directories = ["css", "js", "sanguobaye", "mota", "rpg"];

// EEBBK 模拟器运行时文件（前端 + 预构建的 wasm 产物）位于 eebbk/ 根目录。
// wasm 产物由 `npm run build:4980`（本地 emsdk）预构建后提交，Vercel 上的 build 只负责拷贝。
const emuRuntime = [
    "index.html",
    "style.css",
    "dialog.css",
    "glue.js",
    "gam4980.js",
    "gam4980.wasm",
    "gam4980.data",
];

// 源码中保持可读/原样的大体积引擎脚本：仅在写入 dist 时做 minify，以最小化线上体积。
// 新增大文件时，把其相对 client 的路径追加到这里即可。
const minifiable = [
    "rpg/core.js",
    "sanguobaye/js/baye.js",
    "mota/js/mtower.js",
];

await rm(dist, { recursive: true, force: true });
await mkdir(client, { recursive: true });

for (const file of files) {
    await cp(path.join(root, file), path.join(client, file));
}
for (const directory of directories) {
    await cp(path.join(root, directory), path.join(client, directory), {
        recursive: true,
    });
}

// EEBBK 模拟器运行时文件 → dist/client/eebbk/
{
    const emuSrc = path.join(root, "eebbk");
    const emuOut = path.join(client, "eebbk");
    await mkdir(emuOut, { recursive: true });
    for (const rel of emuRuntime) {
        await cp(path.join(emuSrc, rel), path.join(emuOut, rel)).catch(() => {
            throw new Error(
                `eebbk 运行时文件缺失：eebbk/${rel}\n` +
                    (rel.startsWith("gam4980")
                        ? '请先在本地执行 "npm run build:4980"（需要 emsdk）生成 wasm 产物，再提交。'
                        : "该文件应已在仓库中，请检查 eebbk/ 是否完整。")
            );
        });
    }
    // eebbk 游戏目录（catalog.json + 各版本 .gam）→ dist/client/eebbk/roms/
    await cp(
        path.join(emuSrc, "roms"),
        path.join(emuOut, "roms"),
        { recursive: true }
    ).catch(() => {
        throw new Error("eebbk/roms/ 目录缺失，无法复制游戏清单。");
    });
    console.log("copied eebbk/roms (catalog + roms)");

    console.log(`copied eebbk runtime (${emuRuntime.length} files)`);
}

for (const rel of minifiable) {
    const target = path.join(client, rel);
    const code = await readFile(target, "utf8");
    const result = await minify(code, {
        compress: true,
        mangle: true,
        format: { comments: false },
    });
    if (result.error) {
        throw result.error;
    }
    // 校验压缩产物可被引擎解析，避免把损坏的脚本发布上线。
    new Function(result.code);
    await writeFile(target, result.code);
    const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
    console.log(`minified ${rel}: ${kb(code.length)} -> ${kb(result.code.length)}`);
}

await mkdir(path.join(dist, "server"), { recursive: true });
await writeFile(
    path.join(dist, "server", "index.js"),
    `export default {
    async fetch(request, env) {
        return env.ASSETS.fetch(request);
    }
};
`,
    "utf8"
);

await mkdir(path.join(dist, ".openai"), { recursive: true });
await cp(
    path.join(root, ".openai", "hosting.json"),
    path.join(dist, ".openai", "hosting.json")
);
