import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

await import("../eebbk/glue.js");
const G = globalThis.BBK4988Glue;
const glueSource = fs.readFileSync("eebbk/glue.js", "utf8");

test("BBK4988Glue is exported", () => {
    assert.ok(G, "globalThis.BBK4988Glue 未导出");
});

test("base64 round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 65]);
    assert.deepEqual(Array.from(G.base64ToBytes(G.bytesToBase64(bytes))), Array.from(bytes));
});

test("base64 handles empty and large buffers", () => {
    assert.equal(G.bytesToBase64(new Uint8Array([])), "");
    assert.equal(G.base64ToBytes("").length, 0);
    const big = new Uint8Array(40000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const rt = G.base64ToBytes(G.bytesToBase64(big));
    assert.equal(rt.length, big.length);
    assert.equal(rt[12345], big[12345]);
});

test("romStorageId prefers catalog id", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(G.romStorageId(bytes, "fmj-1.0"), "fmj-1.0");
});

test("romStorageId hashes local roms stably", () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([3, 2, 1]);
    assert.equal(G.romStorageId(a, ""), G.romStorageId(b, ""), "相同内容须同 id");
    assert.notEqual(G.romStorageId(a, ""), G.romStorageId(c, ""), "不同内容须不同 id");
    assert.match(G.romStorageId(a, ""), /^local-/);
});

test("slotKey, autosave/recovery keys and nativeSaveKey format and range", () => {
    assert.equal(G.slotKey("fmj-1.0", 0), "sav/gamesave0-fmj-1.0");
    assert.equal(G.slotKey("fmj-1.0", 2), "sav/gamesave2-fmj-1.0");
    assert.equal(G.slotScreenshotKey("fmj-1.0", 2), "sav/gamesave2-fmj-1.0.screenshot");
    assert.equal(G.autosaveKey("fmj-1.0"), "sav/autosave-fmj-1.0");
    assert.equal(G.recoveryCheckpointKey("fmj-1.0"), "sav/autosave-fmj-1.0.checkpoint");
    assert.equal(G.recoveryCheckpointBackupKey("fmj-1.0"), "sav/autosave-fmj-1.0.checkpoint.prev");
    assert.deepEqual(G.resumeSnapshotKeys("fmj-1.0"), [
        "sav/autosave-fmj-1.0",
        "sav/autosave-fmj-1.0.ts",
        "sav/autosave-fmj-1.0.checkpoint",
        "sav/autosave-fmj-1.0.checkpoint.ts",
        "sav/autosave-fmj-1.0.checkpoint.prev",
    ]);
    assert.equal(G.nativeSaveKey("fmj-1.0"), "sav/native-fmj-1.0");
    assert.throws(() => G.slotKey("fmj-1.0", 3));
    assert.throws(() => G.slotKey("fmj-1.0", -1));
    assert.throws(() => G.nativeSaveKey(""));
    assert.throws(() => G.recoveryCheckpointKey(""));
});

test("chooseLaunchSnapshot：普通打开恢复精确离开快照", () => {
    assert.equal(G.chooseLaunchSnapshot({
        isReload: false,
        resume: "resume",
        checkpoint: "checkpoint",
        checkpointBackup: "backup",
    }), "resume");
    assert.equal(G.chooseLaunchSnapshot({
        isReload: false,
        resume: "",
        checkpoint: "checkpoint",
        checkpointBackup: "backup",
    }), "checkpoint");
});

test("chooseLaunchSnapshot：刷新时避开可能卡死的离开快照", () => {
    assert.equal(G.chooseLaunchSnapshot({
        isReload: true,
        resume: "possibly-dead",
        checkpoint: "checkpoint",
        checkpointBackup: "backup",
    }), "backup");
    assert.equal(G.chooseLaunchSnapshot({
        isReload: true,
        resume: "possibly-dead",
        checkpoint: "checkpoint",
        checkpointBackup: "",
    }), "checkpoint");
    assert.equal(G.chooseLaunchSnapshot({
        isReload: true,
        resume: "possibly-dead",
        checkpoint: "",
        checkpointBackup: "",
    }), "", "无检查点时应冷启动 ROM，不应再读取死循环快照");
});

test("恢复检查点在按键送入 wasm 前捕获", () => {
    const sendStart = glueSource.indexOf("function sendEmulatorKey(key)");
    const launchHomeStart = glueSource.indexOf("function launchHome()", sendStart);
    assert.ok(sendStart >= 0 && launchHomeStart > sendStart);
    const sendBody = glueSource.slice(sendStart, launchHomeStart);
    const checkpointAt = sendBody.indexOf("checkpointBeforeInput()");
    const keydownAt = sendBody.indexOf("Module._web_keydown(");
    assert.ok(checkpointAt >= 0, "每次模拟器按键前必须尝试建立检查点");
    assert.ok(keydownAt > checkpointAt, "检查点必须早于可能触发死循环的 wasm 按键");
});

test("重置游戏复用内存 ROM，不刷新页面或重新请求资源", () => {
    const resetStart = glueSource.indexOf("function resetCurrentGame()");
    const launchStart = glueSource.indexOf("function launchHome()", resetStart);
    assert.ok(resetStart >= 0 && launchStart > resetStart);
    const resetBody = glueSource.slice(resetStart, launchStart);
    assert.match(resetBody, /suppressSnapshotAutosave\s*=\s*true/);
    assert.match(resetBody, /clearResumeSnapshots\(currentRom\.id\)/);
    assert.match(resetBody, /loadGame\(currentRomData, currentRom\.name, currentRom\.id\)/);
    assert.doesNotMatch(resetBody, /fetch\s*\(/);
    assert.doesNotMatch(resetBody, /location\.reload\(\)/);
    assert.match(resetBody, /suppressSnapshotAutosave\s*=\s*false/);

    const loadStart = glueSource.indexOf("function loadGame(");
    const saveLoadStart = glueSource.indexOf("/* ---------- Save/Load state", loadStart);
    const loadBody = glueSource.slice(loadStart, saveLoadStart);
    assert.match(loadBody, /persistNativeSave\(\)/, "重置仍应保留游戏自己的 Flash 存档");
    assert.match(loadBody, /currentRomData\s*=\s*data\.slice\(0\)/);

    const autoSaveStart = glueSource.indexOf("function handleAutoSave()");
    const dragStart = glueSource.indexOf("/* ---------- Drag & drop", autoSaveStart);
    const autoSaveBody = glueSource.slice(autoSaveStart, dragStart);
    assert.match(autoSaveBody, /if \(!suppressSnapshotAutosave\) autosaveCurrent\(\)/);
});

test("native Flash saves mirror synchronously before the async IndexedDB write", () => {
    const persistStart = glueSource.indexOf("function persistNativeSave()");
    const scheduleStart = glueSource.indexOf("function scheduleNativeSaveIfDirty()", persistStart);
    const restoreStart = glueSource.indexOf("function restoreNativeSave(", scheduleStart);
    assert.ok(persistStart >= 0 && scheduleStart > persistStart && restoreStart > scheduleStart);

    const persistBody = glueSource.slice(persistStart, scheduleStart);
    const mirrorAt = persistBody.indexOf("writeNativeSaveFallback(");
    const indexedAt = persistBody.indexOf("writeNativeSaveRecord(");
    const cleanupAt = persistBody.indexOf("removeNativeSaveFallback(");
    assert.ok(mirrorAt >= 0, "必须先写同步 localStorage 镜像");
    assert.ok(indexedAt > mirrorAt, "IndexedDB 写入必须排在同步镜像之后");
    assert.ok(cleanupAt > indexedAt, "IndexedDB 提交后必须清理临时 localStorage 镜像");

    const scheduleBody = glueSource.slice(scheduleStart, restoreStart);
    assert.match(scheduleBody, /persistNativeSave\(\)/, "检测到 Flash 变化后须立即持久化");
    assert.doesNotMatch(scheduleBody, /setTimeout/, "不能延迟到刷新可能中断的定时器");
});

test("buildSavePayload wraps base64 save data", () => {
    const payload = G.buildSavePayload("fmj-1.0", "伏魔记 1.0", 1, "QUJD", "2026-08-05T00:00:00.000Z");
    assert.equal(payload.app, "bbk-games");
    assert.equal(payload.type, "eebbk-save-slot");
    assert.equal(payload.version, 1);
    assert.equal(payload.romId, "fmj-1.0");
    assert.equal(payload.slot, 1);
    assert.equal(payload.data, "QUJD");
});

test("save payload carries an optional LCD screenshot", () => {
    const screenshot = "data:image/png;base64,iVBORw0KGgo=";
    const payload = G.buildSavePayload(
        "fmj-1.0", "伏魔记 1.0", 1, "QUJD", "2026-08-05T00:00:00.000Z", screenshot
    );
    assert.equal(payload.screenshot, screenshot);
    assert.equal(G.parseSavePayload(JSON.stringify(payload), "fmj-1.0").ok, true);
});

test("save screenshot only accepts bounded PNG data URLs", () => {
    assert.equal(G.isValidScreenshotDataUrl("data:image/png;base64,iVBORw0KGgo="), true);
    assert.equal(G.isValidScreenshotDataUrl("data:image/jpeg;base64,iVBORw0KGgo="), false);
    assert.equal(G.isValidScreenshotDataUrl("javascript:alert(1)"), false);
    assert.throws(() => G.buildSavePayload("fmj-1.0", "n", 0, "QUJD", undefined, "bad"));

    const payload = G.buildSavePayload("fmj-1.0", "n", 0, "QUJD");
    payload.screenshot = "data:image/svg+xml;base64,PHN2Zz4=";
    assert.equal(G.parseSavePayload(payload, "fmj-1.0").ok, false);
});

test("buildSavePayload rejects empty or non-base64 data", () => {
    assert.throws(() => G.buildSavePayload("fmj-1.0", "n", 0, ""));
    assert.throws(() => G.buildSavePayload("fmj-1.0", "n", 0, "不是 base64!!"));
});

test("parseSavePayload accepts a well-formed payload", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", romName: "伏魔记 1.0", slot: 0, data: "QUJD",
    });
    const r = G.parseSavePayload(src, "fmj-1.0");
    assert.equal(r.ok, true);
    assert.equal(r.payload.slot, 0);
});

test("parseSavePayload rejects rpg (dictionary) saves", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "dictionary-save-slot", version: 1,
        romId: "x", slot: 0, data: "ABCD",
    });
    assert.equal(G.parseSavePayload(src, "x").ok, false);
});

test("parseSavePayload rejects mismatched romId", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", slot: 0, data: "QUJD",
    });
    assert.equal(G.parseSavePayload(src, "fmj-1.1").ok, false);
});

test("parseSavePayload rejects out-of-range slot", () => {
    const src = JSON.stringify({
        app: "bbk-games", type: "eebbk-save-slot", version: 1,
        romId: "fmj-1.0", slot: 3, data: "QUJD",
    });
    assert.equal(G.parseSavePayload(src, "fmj-1.0").ok, false);
});

test("buildSavePayload output round-trips through parseSavePayload", () => {
    const payload = G.buildSavePayload("fmj-1.1", "伏魔记 1.1", 2, "QUJDRA==", "2026-08-05T00:00:00.000Z");
    const r = G.parseSavePayload(JSON.stringify(payload), "fmj-1.1");
    assert.equal(r.ok, true);
    assert.equal(r.payload.data, "QUJDRA==");
    assert.equal(r.payload.slot, 2);
});

test("parseSavePayload rejects malformed JSON", () => {
    assert.equal(G.parseSavePayload("{not json", "fmj-1.0").ok, false);
});

test("HOME_ROM 与 buildPickerGames：词典条目恒居首位", () => {
    assert.equal(G.HOME_ROM_ID, "__home__");
    assert.equal(G.HOME_ROM.id, "__home__");
    assert.equal(G.HOME_ROM.name, "电子词典系统");
    assert.equal(G.HOME_ROM.isSystem, true);

    const catalog = [{ id: "魔塔", name: "魔塔" }, { id: "伏魔记", name: "伏魔记" }];
    const list = G.buildPickerGames(catalog);
    assert.equal(list.length, 3);
    assert.equal(list[0].id, "__home__", "home 必须第一");
    // 伏魔记系列置顶，故排在魔塔之前
    assert.equal(list[1].id, "伏魔记");
    assert.equal(list[2].id, "魔塔");

    // 空目录也要有词典条目
    assert.equal(G.buildPickerGames([]).length, 1);
    assert.equal(G.buildPickerGames().length, 1);
});

test("buildPickerGames：伏魔记/三国霸业/魔塔系列紧跟电子词典系统置顶", () => {
    const catalog = [
        { id: "澳游", name: "澳游" },                 // 拼音靠前但不置顶
        { id: "魔塔", name: "魔塔" },
        { id: "伏魔记", name: "伏魔记" },
        { id: "三国霸业", name: "三国霸业" },
        { id: "魔塔超级版", name: "魔塔超级版" },
        { id: "新伏魔记", name: "新伏魔记" },
        { id: "伏魔记 加秘籍", name: "伏魔记 加秘籍" },
        { id: "封魔录", name: "封魔录" },             // 含「魔」但非魔塔，不置顶
        { id: "屠魔", name: "屠魔" }                  // 同上
    ];
    const list = G.buildPickerGames(catalog);
    assert.equal(list[0].id, "__home__");

    // 伏魔记系列聚为一组，组内保持 catalog 原相对顺序
    assert.deepEqual(list.slice(1, 4).map((g) => g.id),
        ["伏魔记", "新伏魔记", "伏魔记 加秘籍"]);
    // 三国霸业
    assert.equal(list[4].id, "三国霸业");
    // 魔塔系列
    assert.deepEqual(list.slice(5, 7).map((g) => g.id), ["魔塔", "魔塔超级版"]);
    // 其余游戏保持原序（含未命中的封魔录、屠魔）
    assert.deepEqual(list.slice(7).map((g) => g.id), ["澳游", "封魔录", "屠魔"]);
});

test("decideLaunch：pending 优先", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "__home__", currentRomId: "魔塔", hasAutosave: true }),
                     { action: "home" });
    assert.deepEqual(G.decideLaunch({ pendingId: "魔塔", currentRomId: "", hasAutosave: false }),
                     { action: "rom", id: "魔塔", applyAutosave: false });
});

test("decideLaunch：无 pending 时按 currentRomId", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "__home__", hasAutosave: false }),
                     { action: "home" });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "", hasAutosave: false }),
                     { action: "placeholder" });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "魔塔", hasAutosave: true }),
                     { action: "rom", id: "魔塔", applyAutosave: true });
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "魔塔", hasAutosave: false }),
                     { action: "rom", id: "魔塔", applyAutosave: false });
});

test("decideLaunch：本地导入 rom 无法跨 reload 恢复 → placeholder", () => {
    assert.deepEqual(G.decideLaunch({ pendingId: "", currentRomId: "local-123-abc", hasAutosave: false }),
                     { action: "placeholder" });
});

test("decideHomeLaunch：按设备状态分三种路径", () => {
    assert.equal(G.decideHomeLaunch({ exited: true, started: false }), "pending-reload");
    assert.equal(G.decideHomeLaunch({ exited: true, started: true }), "pending-reload");
    assert.equal(G.decideHomeLaunch({ exited: false, started: false }), "start");
    assert.equal(G.decideHomeLaunch({ exited: false, started: true }), "autosave-reload");
});

test("saveManagerEnabledFor：home 与空 id 禁用", () => {
    assert.equal(G.saveManagerEnabledFor("魔塔"), true);
    assert.equal(G.saveManagerEnabledFor("local-1-2"), true);
    assert.equal(G.saveManagerEnabledFor("__home__"), false);
    assert.equal(G.saveManagerEnabledFor(""), false);
});

test("isDictionarySystem：仅电子词典系统为 true", () => {
    assert.equal(G.isDictionarySystem("__home__"), true);
    assert.equal(G.isDictionarySystem("魔塔"), false);
    assert.equal(G.isDictionarySystem("local-1-2"), false);
    assert.equal(G.isDictionarySystem(""), false);
});

test("shouldAutosave：home / local / 空 都跳过", () => {
    assert.equal(G.shouldAutosave("魔塔"), true);
    assert.equal(G.shouldAutosave("__home__"), false);
    assert.equal(G.shouldAutosave("local-1-2"), false);
    assert.equal(G.shouldAutosave(""), false);
});

/* ---------- 恢复出厂 Flash：deleteHomeNativeSave ---------- */

function makeFakeHomeSaveStorage({ withStore = true, openFails = false } = {}) {
    const env = {
        removedKeys: [],
        deletedIds: [],
        openArgs: null,
        txArgs: null,
        db: {
            closed: false,
            objectStoreNames: { contains: (n) => withStore && n === "native-save-ram" },
            close() { this.closed = true; },
        },
    };
    env.storage = { removeItem(key) { env.removedKeys.push(key); } };
    env.db.transaction = function (name, mode) {
        env.txArgs = [name, mode];
        const tx = { objectStore: () => ({ delete: (id) => env.deletedIds.push(id) }) };
        queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete(); });
        return tx;
    };
    env.indexedDB = {
        open(name, version) {
            env.openArgs = [name, version];
            const req = { result: env.db };
            queueMicrotask(() => {
                if (openFails) { if (req.onerror) req.onerror(new Error("open failed")); }
                else if (req.onsuccess) req.onsuccess();
            });
            return req;
        },
    };
    return env;
}

test("deleteHomeNativeSave：删除 IndexedDB __home__ 记录并清掉 localStorage 镜像", async () => {
    const env = makeFakeHomeSaveStorage();
    const ok = await G.deleteHomeNativeSave(env.indexedDB, env.storage);
    assert.equal(ok, true);
    assert.deepEqual(env.removedKeys, ["sav/native-__home__"], "必须删除 localStorage 同步镜像");
    assert.deepEqual(env.openArgs, ["bbk-eebbk-saves", 1]);
    assert.deepEqual(env.txArgs, ["native-save-ram", "readwrite"]);
    assert.deepEqual(env.deletedIds, ["__home__"], "只能删 __home__，不得触碰其他游戏存档");
    assert.equal(env.db.closed, true, "完成后必须关闭数据库连接");
});

test("deleteHomeNativeSave：库中无存档表（从未写过存档）视为成功", async () => {
    const env = makeFakeHomeSaveStorage({ withStore: false });
    const ok = await G.deleteHomeNativeSave(env.indexedDB, env.storage);
    assert.equal(ok, true, "没有记录可删时应视为恢复成功");
    assert.deepEqual(env.deletedIds, []);
    assert.equal(env.db.closed, true);
    assert.deepEqual(env.removedKeys, ["sav/native-__home__"], "镜像仍要清");
});

test("deleteHomeNativeSave：无 indexedDB 时仍清镜像并成功", async () => {
    const env = makeFakeHomeSaveStorage();
    assert.equal(await G.deleteHomeNativeSave(null, env.storage), true);
    assert.deepEqual(env.removedKeys, ["sav/native-__home__"]);
    assert.equal(env.openArgs, null, "不应尝试打开数据库");
});

test("deleteHomeNativeSave：打开数据库失败返回 false（镜像已清）", async () => {
    const env = makeFakeHomeSaveStorage({ openFails: true });
    assert.equal(await G.deleteHomeNativeSave(env.indexedDB, env.storage), false);
    assert.deepEqual(env.removedKeys, ["sav/native-__home__"]);
});

test("恢复出厂：武装写回抑制 → 等写入链落定 → 删除 __home__ → 重载", () => {
    const confirmAt = glueSource.indexOf("恢复出厂 Flash？");
    assert.ok(confirmAt >= 0, "glue.js 需要恢复出厂的确认弹窗");
    const region = glueSource.slice(confirmAt, confirmAt + 1600);
    const armAt = region.indexOf("nativeSaveResetPending = true");
    const deleteAt = region.indexOf("deleteHomeNativeSave(");
    const reloadAt = region.indexOf("location.reload()");
    assert.ok(armAt >= 0, "确认后必须先武装写回抑制标志");
    assert.ok(deleteAt > armAt, "必须等在飞行中的存档写入落定后再删除");
    assert.ok(reloadAt > deleteAt, "删除成功后才刷新页面");

    const persistStart = glueSource.indexOf("function persistNativeSave()");
    const persistBody = glueSource.slice(persistStart, glueSource.indexOf("function scheduleNativeSaveIfDirty()"));
    assert.match(
        persistBody,
        /if \(nativeSaveResetPending\)/,
        "恢复出厂进行中必须阻止 pagehide 自动保存把内存 Flash 写回",
    );
});

test("normalizeSpeedRate：只接受页面提供的运行倍率", () => {
    assert.equal(G.normalizeSpeedRate("1"), 1);
    assert.equal(G.normalizeSpeedRate("1.5"), 1.5);
    assert.equal(G.normalizeSpeedRate(2), 2);
    assert.equal(G.normalizeSpeedRate(3), 3);
    assert.equal(G.normalizeSpeedRate(""), 1);
    assert.equal(G.normalizeSpeedRate("2.5"), 1);
    assert.equal(G.normalizeSpeedRate(Infinity), 1);
});

test("planLogicSteps：达到一帧即出一步", () => {
    const r = G.planLogicSteps(1000 / 60, 0);
    assert.equal(r.steps, 1);
});

test("planLogicSteps：120Hz 序列收敛到 60 逻辑帧/秒（与刷新率解耦）", () => {
    let acc = 0, total = 0;
    for (let i = 0; i < 120; i++) {            // 120 个 rAF 帧 = 1 秒 @120Hz
        const r = G.planLogicSteps(1000 / 120, acc);
        total += r.steps;
        acc = r.acc;
    }
    assert.ok(Math.abs(total - 60) <= 1, `期望约 60 步，实际 ${total}`);
});

test("planLogicSteps：60Hz 序列约 60 逻辑帧/秒", () => {
    let acc = 0, total = 0;
    for (let i = 0; i < 60; i++) {
        const r = G.planLogicSteps(1000 / 60, acc);
        total += r.steps;
        acc = r.acc;
    }
    assert.ok(Math.abs(total - 60) <= 1, `期望约 60 步，实际 ${total}`);
});

test("planLogicSteps：2x 在 60Hz 下推进约 120 个逻辑帧/秒", () => {
    let acc = 0, total = 0;
    for (let i = 0; i < 60; i++) {
        const r = G.planLogicSteps(1000 / 60, acc, { speed: 2 });
        total += r.steps;
        acc = r.acc;
    }
    assert.ok(Math.abs(total - 120) <= 1, `期望约 120 步，实际 ${total}`);
});

test("planLogicSteps：3x 在 120Hz 下推进约 180 个逻辑帧/秒", () => {
    let acc = 0, total = 0;
    for (let i = 0; i < 120; i++) {
        const r = G.planLogicSteps(1000 / 120, acc, { speed: 3 });
        total += r.steps;
        acc = r.acc;
    }
    assert.ok(Math.abs(total - 180) <= 1, `期望约 180 步，实际 ${total}`);
});

test("planLogicSteps：累积两个半帧才出一步", () => {
    const half = 1000 / 120;
    let r = G.planLogicSteps(half, 0);
    assert.equal(r.steps, 0);                  // 第一次不够一帧
    r = G.planLogicSteps(half, r.acc);
    assert.equal(r.steps, 1);                  // 第二次凑够一帧
});

test("planLogicSteps：丢帧后连续补步", () => {
    const r = G.planLogicSteps(55, 0);         // >3 帧时间，应连续补 3 步
    assert.equal(r.steps, 3);
});

test("planLogicSteps：超大 delta 触顶防追帧螺旋", () => {
    const r = G.planLogicSteps(1000, 0);
    assert.ok(r.steps >= 1 && r.steps <= 6);
    assert.equal(r.acc, 0);                    // 触顶清零
});

test("planLogicSteps：高倍率同步扩大补步上限", () => {
    const r = G.planLogicSteps(1000, 0, { speed: 2 });
    assert.equal(r.steps, 12);
    assert.equal(r.acc, 0);
});

test("planLogicSteps：负 delta 不倒退", () => {
    const r = G.planLogicSteps(-20, 5);
    assert.equal(r.steps, 0);
    assert.equal(r.acc, 5);
});
