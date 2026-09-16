import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本地专用：用 emsdk 把 eebbk 的 C 核心编译为 WebAssembly 运行时产物。
// 产物（gam4988.js/.wasm/.data）拷到 eebbk/ 下提交进 git，
// 这样 Vercel 上的 `npm run build` 不需要 emsdk，只负责拷贝。
//
// 仅当 eebbk/src 下的 C 源码或 A4988 固件数据变动后才需重跑：`npm run build:4988`。

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

const artifacts = ["gam4988.js", "gam4988.wasm"];
for (const f of artifacts) {
    await cp(path.join(build, f), path.join(emu, f));
    console.log(`  ✓ ${f}`);
}

// A4988 完整内存图：可写 Flash、字库、A/C/E 数据，以及 PB[7:6] 选择的四组
// 4/6 MiB 词典库。运行时直接复制到 wasm，不使用 MEMFS，避免重复常驻。
const packageFiles = [
    "4988.flash", "4988.font", "0A00.DAT", "0C00.DAT", "0E00.DAT",
    "0400_3F.DAT", "0600_3F.DAT", "0400_7F.DAT", "0600_7F.DAT",
    "0400_BF.DAT", "0600_BF.DAT", "0400_FF.DAT", "0600_FF.DAT",
];
const packageParts = [];
for (const file of packageFiles) {
    const bytes = await readFile(path.join(web, "preload", file));
    if (bytes.length !== 0x200000) throw new Error(`${file} 必须为 2 MiB`);
    packageParts.push(bytes);
}
await writeFile(path.join(emu, "gam4988.data"), Buffer.concat(packageParts));
console.log("  ✓ gam4988.data (26 MiB complete A4988 firmware + dictionaries)");

console.log(
    "\neebbk artifacts written to eebbk/. Commit them (git add eebbk/gam4988.*)."
);
