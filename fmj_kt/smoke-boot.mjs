/**
 * 冒烟测试：在 Node vm 沙箱里启动重打包后的 rpg/core.js。
 *
 * mock 掉宿主环境（window/document/localStorage/interval），用 rpg/roms 下的
 * 真实 ROM 以 hex 形式模拟 localStorage["gameRom"]，断言：
 *   1. 整个 core.js 无异常执行完毕；
 *   2. window["game.core"] 模块已定义（游戏模块缝合成功）；
 *   3. main([]) 启动链路走到 sysSetInterval（游戏主循环已注册）。
 *
 * 用法：node fmj_kt/smoke-boot.mjs [rom文件名，默认 fmj_rpg.lib]
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const romName = process.argv[2] || "fmj_rpg.lib";
const corePath = path.join(root, "rpg/core.js");
const romPath = path.join(root, "rpg/roms", romName);

const romHex = fs.readFileSync(romPath).toString("hex").toUpperCase();

const logs = [];
const consoleMock = {
    log: (...a) => logs.push(["log", ...a]),
    warn: (...a) => logs.push(["warn", ...a]),
    error: (...a) => logs.push(["error", ...a]),
    info: (...a) => logs.push(["info", ...a]),
};

function makeCanvasContext() {
    return {
        createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
        },
        putImageData() {},
        imageSmoothingEnabled: true,
    };
}

const storage = new Map();
const sandbox = {
    console: consoleMock,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 2,
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    navigator: { userAgent: "smoke-boot" },
    localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(String(k), String(v)),
        removeItem: (k) => storage.delete(k),
        get length() { return storage.size; },
    },
};
storage.set("gameRom", romHex);

const canvasMock = { getContext: () => makeCanvasContext(), width: 320, height: 192 };
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.document = {
    getElementById: (id) => (id === "canvas" ? canvasMock : null),
    createElement: () => ({ set src(v) {}, addEventListener() {} }),
    addEventListener() {},
    body: { onkeydown: null, onkeyup: null, onpointerdown: null, onpointerup: null },
};
sandbox.global = sandbox;
vm.createContext(sandbox);

const source = fs.readFileSync(corePath, "utf8");
vm.runInContext(source, sandbox, { filename: "core.js" });

const failures = [];
const gameCore = sandbox.window["game.core"];
if (!gameCore || typeof gameCore !== "object") {
    failures.push("window['game.core'] 未定义：游戏模块没有执行");
}
if (!sandbox.game || !sandbox.game.rom || !sandbox.game.rom["GAME.ROM"]) {
    failures.push("window.game.rom['GAME.ROM'] 为空：ROM 桥未生效");
}
if (!sandbox.game.updateInterval) {
    failures.push("game.updateInterval 未设置：main([]) 没有跑到 sysSetInterval");
}

const errors = logs.filter(([level]) => level === "error");
if (errors.length > 0) {
    failures.push(`启动期间 console.error x${errors.length}：\n` +
        errors.slice(0, 5).map((e) => "  " + e.slice(1).join(" ")).join("\n"));
}

if (failures.length > 0) {
    console.error("SMOKE FAIL\n" + failures.join("\n"));
    process.exit(1);
}

console.log(`SMOKE OK（ROM=${romName}，updateInterval=${sandbox.game.updateInterval}）`);
for (const [level, ...msg] of logs.slice(0, 12)) {
    console.log(`  [${level}] ${msg.join(" ").slice(0, 160)}`);
}
