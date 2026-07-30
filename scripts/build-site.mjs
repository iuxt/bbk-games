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
