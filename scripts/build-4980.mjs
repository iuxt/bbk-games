import { spawnSync } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本地专用：用 emsdk 把 4980emu 的 C 核心编译为 WebAssembly 运行时产物。
// 产物（gam4980.js/.wasm/.data）拷到 4980emu/ 下提交进 git，
// 这样 Vercel 上的 `npm run build` 不需要 emsdk，只负责拷贝。
//
// 仅当 4980emu/src 下的 C 源码变动后才需要手动重跑：`npm run build:4980`，再提交产物。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const emu = path.join(root, "4980emu");
const web = path.join(emu, "web"); // CMakeLists/shell.html/preload 所在的构建输入目录
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

const artifacts = ["gam4980.js", "gam4980.wasm", "gam4980.data"];
for (const f of artifacts) {
    await cp(path.join(build, f), path.join(emu, f));
    console.log(`  ✓ ${f}`);
}

console.log(
    "\n4980emu artifacts written to 4980emu/. Commit them (git add 4980emu/gam4980.*)."
);
