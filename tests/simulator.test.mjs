import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../bbk-games/app.js");

const Simulator = globalThis.BBKSimulator;

test("simulator converts ROM bytes to uppercase hexadecimal", () => {
    const bytes = Uint8Array.from([0, 1, 15, 16, 127, 128, 255]);

    assert.equal(
        Simulator.arrayBufferToHex(bytes.buffer),
        "00010F107F80FF"
    );
});

test("simulator handles an empty ROM buffer", () => {
    assert.equal(Simulator.arrayBufferToHex(new ArrayBuffer(0)), "");
});

test("simulator recognizes every physical key handled by the game core", () => {
    for (const keyCode of [13, 27, 32, 37, 38, 39, 40, 219, 221]) {
        assert.equal(Simulator.isMappedGameKey({ keyCode }), true);
    }
    assert.equal(Simulator.isMappedGameKey({ keyCode: 65 }), false);
});

test("simulator gives same-length local ROMs distinct stable storage IDs", () => {
    const first = Uint8Array.from([1, 2, 3, 4]).buffer;
    const second = Uint8Array.from([4, 3, 2, 1]).buffer;

    assert.equal(Simulator.romStorageId(first, "catalog-game"), "catalog-game");
    assert.equal(Simulator.romStorageId(first, ""), Simulator.romStorageId(first, ""));
    assert.notEqual(Simulator.romStorageId(first, ""), Simulator.romStorageId(second, ""));
});

test("simulator addresses three save slots by current ROM identity", () => {
    assert.equal(Simulator.saveStorageKey("xkx", 0), "sav/gamesave0-xkx");
    assert.equal(Simulator.saveStorageKey("xkx", 2), "sav/gamesave2-xkx");
    assert.throws(() => Simulator.saveStorageKey("", 0));
    assert.throws(() => Simulator.saveStorageKey("xkx", 3));
});

test("simulator exports and validates a save for the current game", () => {
    const payload = Simulator.buildSavePayload(
        "xkx",
        "侠客行",
        1,
        "00A1FF",
        "2026-07-28T00:00:00.000Z"
    );

    assert.deepEqual(payload, {
        app: "bbk-games",
        type: "dictionary-save-slot",
        version: 1,
        romId: "xkx",
        romName: "侠客行",
        slot: 1,
        data: "00A1FF",
        exportedAt: "2026-07-28T00:00:00.000Z",
    });
    assert.equal(
        Simulator.parseSavePayload(JSON.stringify(payload), "xkx").ok,
        true
    );
    assert.equal(
        Simulator.parseSavePayload(JSON.stringify(payload), "jyqxz").ok,
        false
    );
});

test("simulator rejects malformed save files", () => {
    assert.equal(Simulator.parseSavePayload("not-json", "xkx").ok, false);
    assert.equal(
        Simulator.parseSavePayload({
            app: "bbk-games",
            type: "dictionary-save-slot",
            version: 1,
            romId: "xkx",
            slot: 0,
            data: "not-hex",
        }, "xkx").ok,
        false
    );
});

test("simulator core namespaces saves by stable ROM identity", () => {
    const source = readFileSync(new URL("../bbk-games/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /gameRomId=localStorage\.getItem\("gameRomStorageId"\)\|\|localStorage\.getItem\("gameRomId"\)/
    );
    assert.match(
        source,
        /gameRomLength=gameRomId\|\|\(gameRom\?gameRom\.length:1114112\)/
    );
});
