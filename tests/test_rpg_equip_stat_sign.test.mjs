import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the equipment stat-modifier sign bug in rpg/core.js
// (ResBase$Companion.prototype.get1ByteSInt_ir89t6$, ~core.js:48590).
//
// The 伏魔记 .lib stores every 1-byte equipment/medicine stat delta
// (mMpMax, mHpMax, mdf, mlingli, mSpeed, mLuck) in SIGN-MAGNITUDE form:
// bit 7 is the sign flag, bits 0..6 are the magnitude.
//   e.g. 金缕衣 "身法-10" -> mSpeed byte 0x8a -> bit7 set, magnitude 0x0a=10 -> -10
//
// The engine loads the .lib into a Kotlin ByteArray, which the Kotlin->JS compiler
// emits as a SIGNED Int8Array (two's-complement, -128..127). get1ByteSInt returned
// `buf[start]` verbatim, so it interpreted these bytes as two's-complement:
//   0x8a -> -118  (instead of -10)
// Equipping 金缕衣 on a character with 身法 99 then yielded 99 + (-118) = -19
// instead of 99 + (-10) = 89. Same class of bug as the earlier costMp fix
// (tests/test_rpg_magic_cost.test.mjs), but the correct decode here is
// sign-magnitude, not plain unsigned.
//
// Proof the encoding is sign-magnitude (not two's-complement) comes from the
// in-game description strings, which match sign-magnitude exactly for every
// item with a penalty byte — e.g. 嗜血剑 "灵力-40/防御-30/吉运-30/生命上限-50"
// maps to bytes 0xa8/0x9e/0x9e/0xb2 = sign-magnitude -40/-30/-30/-50
// (two's-complement would give -88/-98/-98/-78). See docs/fmj-goods-data.md.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");
const ROM = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "roms", "fmj_zsb.lib");

// --- OLD buggy read: bare Int8Array index -> two's-complement signed value.
function read1ByteSIntOld(buf, start) {
    return buf[start];
}

// --- NEW fixed read: sign-magnitude. bit7 = sign, bits 0..6 = magnitude.
function read1ByteSIntNew(buf, start) {
    const b = buf[start] & 255; // normalise signed Int8Array element to 0..255
    return (b & 0x80) !== 0 ? -(b & 0x7f) : (b & 0x7f);
}

test("OLD: sign-magnitude penalty bytes misread as large two's-complement negatives (documents bug)", () => {
    const buf = new Int8Array([0x8a, 0x83, 0x87, 0x82]);
    assert.equal(read1ByteSIntOld(buf, 0), -118, "0x8a -> -118 under buggy read");
    assert.equal(read1ByteSIntOld(buf, 1), -125, "0x83 -> -125");
    assert.equal(read1ByteSIntOld(buf, 2), -121, "0x87 -> -121");
    assert.equal(read1ByteSIntOld(buf, 3), -126, "0x82 -> -126");
});

test("NEW: sign-magnitude penalty bytes decode to small negatives", () => {
    // 金缕衣/玄铁剑 "身法-10", 青铜铠 "身法-7", 铁锁衣 "身法-3", 砍刀 "身法-2"
    const buf = new Int8Array([0x8a, 0x87, 0x83, 0x82]);
    assert.equal(read1ByteSIntNew(buf, 0), -10, "0x8a -> -10");
    assert.equal(read1ByteSIntNew(buf, 1), -7, "0x87 -> -7");
    assert.equal(read1ByteSIntNew(buf, 2), -3, "0x83 -> -3");
    assert.equal(read1ByteSIntNew(buf, 3), -2, "0x82 -> -2");
});

test("NEW: 嗜血剑 curse penalties match its description exactly", () => {
    // bytes from 嗜血剑 +22..+29: 00 b2 9e fa a8 00 00 9e
    // desc: "灵力-40、防御-30、吉运-30，生命上限-50"
    const buf = new Int8Array([0x00, 0xb2, 0x9e, 0xfa, 0xa8, 0x00, 0x00, 0x9e]);
    assert.equal(read1ByteSIntNew(buf, 4), -40, "mlingli 0xa8 -> -40");
    assert.equal(read1ByteSIntNew(buf, 2), -30, "mdf 0x9e -> -30");
    assert.equal(read1ByteSIntNew(buf, 7), -30, "mLuck 0x9e -> -30");
    assert.equal(read1ByteSIntNew(buf, 1), -50, "mHpMax 0xb2 -> -50");
});

test("NEW: positive modifiers (bit7 clear) are unaffected", () => {
    const buf = new Int8Array([0x00, 0x05, 0x0a, 0x7f]);
    assert.equal(read1ByteSIntNew(buf, 0), 0);
    assert.equal(read1ByteSIntNew(buf, 1), 5);
    assert.equal(read1ByteSIntNew(buf, 2), 10);
    assert.equal(read1ByteSIntNew(buf, 3), 127);
    // agrees with the old read for 0x00..0x7f
    for (let v = 0; v <= 0x7f; v++) {
        const b = new Int8Array([v]);
        assert.equal(read1ByteSIntNew(b, 0), read1ByteSIntOld(b, 0));
    }
});

test("user scenario: 身法 99 + 金缕衣(身法-10) = 89, not -19", () => {
    const mSpeedByte = 0x8a; // 金缕衣 mSpeed
    const buf = new Int8Array([mSpeedByte]);
    let speed = 99;
    speed = speed + read1ByteSIntOld(buf, 0) | 0;
    assert.equal(speed, -19, "buggy: 99 + (-118) = -19");
    speed = 99;
    speed = speed + read1ByteSIntNew(buf, 0) | 0;
    assert.equal(speed, 89, "fixed: 99 + (-10) = 89");
});

test("ROM: 金缕衣 mSpeed byte is 0x8a and decodes to -10 (sign-magnitude)", () => {
    if (!fs.existsSync(ROM)) {
        console.warn(`skip: ${ROM} not present`);
        return;
    }
    const u = new Uint8Array(fs.readFileSync(ROM));
    const dec = new TextDecoder("gbk");
    // index table @0x10, offset table @0x2000 (per docs/fmj-goods-data.md)
    const entries = [];
    let i = 0x10, j = 0x2000;
    while (u[i] !== 0xff) {
        entries.push({ rt: u[i], t: u[i + 1], ix: u[i + 2], o: u[j] * 0x4000 + ((u[j + 2] << 8) | u[j + 1]) });
        i += 3; j += 3;
    }
    const str = o => { let x = o; while (u[x]) x++; return dec.decode(u.subarray(o, x)); };
    // 金缕衣 = GoodsEquipment type 2 (衣服), name "金缕衣"
    const jinlu = entries.find(r => r.rt === 6 && r.t === 2 && str(r.o + 6) === "金缕衣");
    assert.ok(jinlu, "金缕衣 record should exist in fmj_zsb.lib");
    const mSpeedByte = u[jinlu.o + 27];
    assert.equal(mSpeedByte, 0x8a, "金缕衣 mSpeed byte must be 0x8a");
    const buf = new Int8Array([mSpeedByte]);
    assert.equal(read1ByteSIntNew(buf, 0), -10, "金缕衣 mSpeed decodes to -10");
    assert.equal(read1ByteSIntOld(buf, 0), -118, "buggy read gives -118 (the reported bug)");
});

test("core.js: get1ByteSInt decodes sign-magnitude (bit7 = sign, bits0..6 = magnitude)", () => {
    // Pins the production fix. Fails if the helper reverts to `return buf[start]`.
    // (Kotlin->JS output: single-quoted members, `function (buf, start)` with a
    // space, decimal 255/128/127 for the hex masks.)
    const src = fs.readFileSync(CORE_JS, "utf8");
    const m = src.match(/ResBase\$Companion\.prototype\.get1ByteSInt_ir89t6\$\s*=\s*function\s*\(buf,\s*start\)\s*\{([\s\S]*?)\n\s*\};/);
    assert.ok(m, "could not locate get1ByteSInt_ir89t6$ definition in rpg/core.js");
    const body = m[1];
    // must normalise the Int8Array element to unsigned first (compiler temp var name captured)
    const varM = body.match(/var (\w+) = buf\[start\] & 255/);
    assert.ok(varM, `get1ByteSInt must mask buf[start] to unsigned first; found: ${body.trim()}`);
    const b = varM[1];
    // must test the sign bit (bit 7)…
    assert.match(body, new RegExp(`\\(\\s*${b}\\s*&\\s*(?:0x80|128)\\s*\\)\\s*!==\\s*0`), `get1ByteSInt must test the sign bit (0x80); found: ${body.trim()}`);
    // …and the negative branch must be sign-magnitude: NEGATE THE 0x7f-MASKED
    // magnitude, i.e. `-(b & 0x7f)`. This is the load-bearing shape: a plain
    // `-b` or a two's-complement `b - 256` would both mis-decode (e.g. 0xFF as
    // -255/-1 instead of -127) yet could sneak past looser assertions.
    assert.match(body, new RegExp(`-\\s*\\(\\s*${b}\\s*&\\s*(?:0x7f|127)\\s*\\)`), `get1ByteSInt's negative branch must be -(b & 0x7f), not -b / b-256; found: ${body.trim()}`);
    // must NOT be the old bare return
    assert.doesNotMatch(body, /return\s+buf\[start\]\s*;\s*$/, "get1ByteSInt must not return buf[start] verbatim");
});
