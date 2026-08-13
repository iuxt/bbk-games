import test from "node:test";
import assert from "node:assert/strict";

await import("../eebbk/glue.js");
const G = globalThis.BBK4980Glue;

test("BBK4980Glue is exported", () => {
    assert.ok(G, "globalThis.BBK4980Glue 未导出");
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

test("slotKey and autosaveKey format and range", () => {
    assert.equal(G.slotKey("fmj-1.0", 0), "sav/gamesave0-fmj-1.0");
    assert.equal(G.slotKey("fmj-1.0", 2), "sav/gamesave2-fmj-1.0");
    assert.equal(G.autosaveKey("fmj-1.0"), "sav/autosave-fmj-1.0");
    assert.throws(() => G.slotKey("fmj-1.0", 3));
    assert.throws(() => G.slotKey("fmj-1.0", -1));
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

test("planLogicSteps：负 delta 不倒退", () => {
    const r = G.planLogicSteps(-20, 5);
    assert.equal(r.steps, 0);
    assert.equal(r.acc, 5);
});
