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
