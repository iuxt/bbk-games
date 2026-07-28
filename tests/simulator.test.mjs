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

test("legacy length saves migrate to only one ROM ID", () => {
    const values = new Map([
        ["sav/gamesave0-1114112", "OLD-SAVE"],
    ]);
    const storage = {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
    };

    assert.equal(
        Simulator.migrateLegacySaves(storage, "game-a", "1114112"),
        true
    );
    assert.equal(values.get("sav/gamesave0-game-a"), "OLD-SAVE");
    assert.equal(values.get("gameRomSaveMigration:1114112"), "game-a");

    assert.equal(
        Simulator.migrateLegacySaves(storage, "game-b", "1114112"),
        false
    );
    assert.equal(values.has("sav/gamesave0-game-b"), false);
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
