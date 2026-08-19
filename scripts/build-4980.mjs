import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本地专用：用 emsdk 把 eebbk 的 C 核心编译为 WebAssembly 运行时产物。
// 产物（gam4980.js/.wasm/.data）拷到 eebbk/ 下提交进 git，
// 这样 Vercel 上的 `npm run build` 不需要 emsdk，只负责拷贝。
//
// 仅当 eebbk/src 下的 C 源码变动后才需要手动重跑：`npm run build:4980`，再提交产物。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emu = path.join(root, "eebbk");
const web = path.join(emu, "web"); // CMakeLists/preload 所在的构建输入目录
const build = path.join(web, "build");

function run(cmd, args) {
    const res = spawnSync(cmd, args, { stdio: "inherit" });
    if (res.status !== 0) {
        throw new Error(
            `\`${cmd} ${args.join(" ")}\` exited with status ${res.status}`
        );
    }
}

console.log("→ configuring (emcmake cmake)");
await rm(build, { recursive: true, force: true });
run("emcmake", ["cmake", "-B", build, "-S", web]);

console.log("→ building (emmake make)");
run("emmake", ["make", "-C", build, "-j4"]);

const artifacts = ["gam4980.js", "gam4980.wasm"];
for (const f of artifacts) {
    await cp(path.join(build, f), path.join(emu, f));
    console.log(`  ✓ ${f}`);
}

// 固件包保持为 8.BIN + E.BIN 的简单拼接，由 glue.js 按需拉取并直接复制进 wasm。
// 不再使用 Emscripten preload/MEMFS，避免浏览器常驻一份额外的 4 MiB 固件副本。
const bios8 = await readFile(path.join(web, "preload", "8.BIN"));
const biosE = await readFile(path.join(web, "preload", "E.BIN"));
if (bios8.length !== 0x200000 || biosE.length !== 0x200000) {
    throw new Error("8.BIN / E.BIN 必须各为 2 MiB");
}
await writeFile(path.join(emu, "gam4980.data"), Buffer.concat([bios8, biosE]));
console.log("  ✓ gam4980.data");

console.log(
    "\neebbk artifacts written to eebbk/. Commit them (git add eebbk/gam4980.*)."
);
