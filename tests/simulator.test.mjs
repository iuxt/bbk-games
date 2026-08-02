import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

await import("../rpg/srs-anchor.js");
await import("../rpg/app.js");

const Simulator = globalThis.BBKSimulator;
const SrsAnchor = globalThis.BBKSrsAnchor;

function readLibraryEntries(buffer) {
    const entries = [];
    let directoryOffset = 16;
    let addressOffset = 8192;

    while (directoryOffset + 2 < buffer.length &&
            buffer[directoryOffset] !== 0xFF) {
        const resourceType = buffer[directoryOffset];
        const type = buffer[directoryOffset + 1];
        const index = buffer[directoryOffset + 2];
        const block = buffer[addressOffset];
        const low = buffer[addressOffset + 1];
        const high = buffer[addressOffset + 2];

        entries.push({
            resourceType,
            type,
            index,
            offset: block * 16384 + (high << 8) + low,
        });
        directoryOffset += 3;
        addressOffset += 3;
    }

    return entries;
}

function readSrsAt(buffer, offset) {
    const frameCount = buffer[offset + 2];
    const imageCount = buffer[offset + 3];
    const frameHeaders = [];
    let cursor = offset + 6;

    for (let i = 0; i < frameCount; i += 1) {
        frameHeaders.push(Array.from(buffer.subarray(cursor, cursor + 5)));
        cursor += 5;
    }

    const images = [];
    for (let i = 0; i < imageCount; i += 1) {
        const width = buffer[cursor + 2];
        const height = buffer[cursor + 3];
        const number = buffer[cursor + 4];
        const mode = buffer[cursor + 5];
        const rowBytes = Math.ceil(width / 8);

        images.push({ width, height });
        cursor += 6 + number * rowBytes * height * mode;
    }

    return { frameHeaders, images };
}

function readSrs(fileName, type, index) {
    const buffer = readFileSync(new URL(`../rpg/roms/${fileName}`, import.meta.url));
    const entry = readLibraryEntries(buffer).find((candidate) =>
        candidate.resourceType === 5 &&
        candidate.type === type &&
        candidate.index === index
    );

    assert.ok(entry, `missing SRS ${type}:${index} in ${fileName}`);
    return readSrsAt(buffer, entry.offset);
}

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
    for (const keyCode of [13, 27, 32, 37, 38, 39, 40, 82, 219, 221]) {
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
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /gameRomId\s*=\s*localStorage\.getItem\("gameRomStorageId"\)\s*\|\|\s*localStorage\.getItem\("gameRomId"\)/
    );
    assert.match(
        source,
        /gameRomLength\s*=\s*gameRomId\s*\|\|\s*\(gameRom\s*\?\s*gameRom\.length\s*:\s*1114112\)/
    );
});

test("magic screen shows the MP cost of the selected spell", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const loader = readFileSync(new URL("../rpg/app.js", import.meta.url), "utf8");

    assert.match(
        source,
        /"耗真气:"\s*\+\s*toString\(this\.magics_0\[this\.mCurItemIndex_0\]\.costMp\)/
    );
    assert.doesNotMatch(
        source,
        /"耗真气:"\s*\+\s*toString\(hlMagic\.costMp\)/
    );
    assert.match(loader, /script\.src\s*=\s*"core\.js\?v=10"/);
});

test("healing applies coerced HP values through a reusable target effect", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /MagicRestore\.prototype\.applyToTarget_qpjxya\$\s*=\s*function\(dst\)[\s\S]*?var currentHp\s*=\s*dst\.hp\s*\|\s*0;[\s\S]*?var restoredHp\s*=\s*this\.mHp_0\s*\|\s*0;[\s\S]*?dst\.hp\s*=\s*currentHp\s*\+\s*restoredHp\s*\|\s*0;/
    );
    assert.equal(("84" | 0) + ("4" | 0), 88);
});

test("all-target healing pays once and applies healing to every target", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const action = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.preproccess"),
        source.indexOf("ActionMagicHelpAll.prototype.update_s8cxhz$")
    );

    assert.match(
        action,
        /attacker\.mp\s*=\s*attacker\.mp\s*-\s*this\.magic_8be2vx\$\.costMp\s*\|\s*0;/
    );
    assert.match(
        action,
        /while\s*\(tmp\$_1\.hasNext\(\)\)[\s\S]*?applyToTarget_qpjxya\$\(restoreTarget\)/
    );
    assert.equal(
        (action.match(/attacker\.mp\s*=\s*attacker\.mp\s*-/g) || []).length,
        1
    );
});

test("single-target effects use the shared safe SRS anchor", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /BBKSrsAnchor\.compute\(this\.mFrameHeader_0, this\.mImage_0\)/
    );
    assert.match(
        source,
        /BBKSrsAnchor\.imageFor\(this\.mFrameHeader_0\[index\], this\.mImage_0\)/
    );
    assert.match(
        source,
        /ActionMagicAttackOne[\s\S]*?drawAtTarget_2g4tob\$\(canvas, this\.mAniX_0, this\.mAniY_0\)/
    );
    assert.match(source, /this\.mAniY_0\s*=\s*target\.combatY/);
    assert.match(
        source,
        /else\s*\{\s*this\.mAni_0\.drawAbsolutely_2g4tob\$\(canvas, 0, 0\)/
    );
});

test("SRS anchor chooses the latest endpoint when simple frames tie", () => {
    const headers = [
        [10, 20, 2, 2, 0],
        [30, 40, 2, 2, 0],
        [50, 60, 2, 2, 0],
    ];
    const images = [{ width: 10, height: 6 }];

    assert.deepEqual(SrsAnchor.compute(headers, images), { x: 55, y: 63 });
});

test("SRS anchor centers the peak group and ignores invalid image records", () => {
    const headers = [
        [0, 0, 10, 2, 0],
        [20, 10, 4, 1, 0],
        [200, 200, 4, 1, 9],
        [40, 20, 4, 1, 0],
    ];
    const images = [{ width: 10, height: 10 }];

    assert.equal(SrsAnchor.imageFor(headers[2], images), null);
    assert.deepEqual(SrsAnchor.compute(headers, images), { x: 25, y: 15 });
});

test("FML flying-sword anchor uses its visual climax instead of the last particle", () => {
    const animation = readSrs("fml.lib", 2, 2);

    assert.deepEqual(
        SrsAnchor.compute(animation.frameHeaders, animation.images),
        { x: 78, y: 52 }
    );
});

test("佛光普照 aligns its authored group with the current player formation", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const animation = readSrs("fmj_zsb.lib", 2, 11);
    const targetCenter = {
        x: (76 + 108 + 140) / 3 | 0,
        y: (70 + 66 + 58) / 3 | 0,
    };

    assert.deepEqual(
        SrsAnchor.compute(animation.frameHeaders, animation.images),
        { x: 77, y: 65 }
    );
    assert.deepEqual(targetCenter, { x: 108, y: 64 });
    assert.match(
        source,
        /ActionMagicHelpAll[\s\S]*?drawAtTarget_2g4tob\$\(canvas, this\.animationX_0, this\.animationY_0\)/
    );
});

test("every bundled SRS can calculate a safe finite anchor", () => {
    const romsUrl = new URL("../rpg/roms/", import.meta.url);
    const files = readdirSync(romsUrl).filter((file) => file.endsWith(".lib"));
    let animationCount = 0;
    let invalidImageRecordCount = 0;

    for (const file of files) {
        const buffer = readFileSync(new URL(file, romsUrl));
        const entries = readLibraryEntries(buffer);

        for (const entry of entries) {
            if (entry.resourceType !== 5) {
                continue;
            }

            const animation = readSrsAt(buffer, entry.offset);
            invalidImageRecordCount += animation.frameHeaders.filter(
                (header) => header[4] >= animation.images.length
            ).length;

            const anchor = SrsAnchor.compute(
                animation.frameHeaders,
                animation.images
            );
            assert.equal(Number.isFinite(anchor.x), true, `${file} SRS ${entry.index} x`);
            assert.equal(Number.isFinite(anchor.y), true, `${file} SRS ${entry.index} y`);
            animationCount += 1;
        }
    }

    assert.ok(animationCount > 6000);
    assert.ok(invalidImageRecordCount > 0);
});
