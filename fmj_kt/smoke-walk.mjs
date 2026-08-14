/**
 * 诊断：模拟浏览器流程进入游戏，检查地图相机取景。
 * boot core.js → 手动 tick 主循环 → 菜单按 ENTER 开新游戏 → tick →
 * 输出 player.posInMap / SaveLoadGame.MapScreen* / 玩家屏幕格坐标。
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const romHex = fs.readFileSync(path.join(root, "rpg/roms/fmj_rpg.lib")).toString("hex").toUpperCase();

const logs = [];
const consoleMock = {
    log: (...a) => logs.push(a.join(" ")),
    warn: () => {}, error: (...a) => logs.push("ERR " + a.join(" ")), info: () => {},
};
const storage = new Map([["gameRom", romHex]]);
let loopCb = null;
const sandbox = {
    console: consoleMock,
    setTimeout: () => 1, clearTimeout: () => {},
    setInterval: (fn) => { loopCb = fn; return 1; },
    clearInterval: () => {},
    performance: { now: () => Date.now() },
    navigator: { userAgent: "diag" },
    localStorage: {
        getItem: (k) => (storage.has(k) ? storage.get(k) : null),
        setItem: (k, v) => storage.set(String(k), String(v)),
        removeItem: (k) => storage.delete(k),
    },
};
const canvasCtx = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {}, imageSmoothingEnabled: true,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.renderPeixel = [1, 1, 1];
sandbox.document = {
    getElementById: (id) => (id === "canvas" ? { getContext: () => canvasCtx, width: 160, height: 96 } : null),
    createElement: () => ({
        getContext: () => canvasCtx,
        toDataURL: () => "data:image/png;base64,",
        set src(v) {}, addEventListener() {},
    }),
    addEventListener() {},
    body: { onkeydown: null, onkeyup: null },
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "rpg/core.js"), "utf8"), sandbox, { filename: "core.js" });

const tick = (n) => {
    for (let i = 0; i < n && loopCb; i++) {
        try { loopCb(); } catch (e) { logs.push("TICK-ERR " + (e && e.message)); }
    }
};
const key = (code) => {
    sandbox.document.body.onkeydown({ keyCode: code });
    sandbox.document.body.onkeyup({ keyCode: code });
};

tick(200);           // 走完开机动画
key(13);             // 主菜单 ENTER（新游戏）
tick(400);           // 跑开场脚本到稳定

const gc = sandbox.window["game.core"];
console.log("module keys:", Object.keys(gc).join(", "));
const game = (gc.fmj && gc.fmj.game) || (gc.game && gc.game.fmj && gc.game.fmj.game);
const findPkg = (obj, name, depth = 0) => {
    if (!obj || depth > 3) return null;
    for (const k of Object.keys(obj)) {
        if (k === name) return obj[k];
        const found = findPkg(obj[k], name, depth + 1);
        if (found) return found;
    }
    return null;
};
const scenePkg = findPkg(gc, "scene") || {};
const slg = scenePkg.SaveLoadGame || findPkg(gc, "SaveLoadGame");
const main = game && game.mainScene;
const player = main.player;
console.log("=== 相机诊断 ===");
console.log("mainScene 类型:", main && main.constructor && main.constructor.name);
if (player) {
    const px = player.posInMap.x, py = player.posInMap.y;
    const sx = slg.MapScreenX, sy = slg.MapScreenY;
    console.log(`player.posInMap = (${px}, ${py})`);
    console.log(`SaveLoadGame.MapScreen = (${sx}, ${sy})`);
    console.log(`玩家屏幕格坐标 = (${px - sx}, ${py - sy})  [可视区 0..8 × 0..5]`);
    console.log(main.currentMap ? `currentMap: ${main.currentMap.mapWidth}x${main.currentMap.mapHeight}` : "currentMap: null");
} else {
    console.log("player 为空（脚本未跑到 createactor？）");
}
const interesting = logs.filter((l) => /loadMap|屏幕|Player at|Fixed player|AdjustScreenPos|chapter/i.test(l)).slice(-12);
console.log("--- 行走跟随验证 ---");
const walkChecks = [];
const dirs = [[39, "右"], [39, "右"], [40, "下"], [37, "左"], [38, "上"], [39, "右"], [40, "下"], [40, "下"], [37, "左"], [39, "右"]];
for (const [code, name] of dirs) {
    key(code);
    tick(30);
    const p = main.player.posInMap;
    walkChecks.push(`${name}: 屏幕(${p.x - slg.MapScreenX}, ${p.y - slg.MapScreenY})`);
}
console.log(walkChecks.join("  "));
const last = main.player.posInMap;
const fx = last.x - slg.MapScreenX, fy = last.y - slg.MapScreenY;
console.log(fx >= 0 && fx <= 8 && fy >= 0 && fy <= 5 ? "WALK OK（始终在可视区）" : `WALK FAIL：屏幕坐标 (${fx}, ${fy}) 出界`);
console.log("--- 相关日志 ---");
for (const l of interesting) console.log(l.slice(0, 180));
