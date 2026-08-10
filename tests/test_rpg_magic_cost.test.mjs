import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the magic MP-cost (BaseMagic.costMp) sign bug in
// rpg/core.js (BaseMagic.prototype.setData_ir89t6$, ~core.js:49097).
//
// Magic records are decoded from a Kotlin ByteArray, which the Kotlin->JS
// compiler emits as a SIGNED Int8Array. In BaseMagic.setData_ir89t6$, every
// single-byte field is read as unsigned with `& 255` — EXCEPT costMp, which was
// read as a bare `buf[offset + 4]`, i.e. SIGNED. For a skill whose cost byte is
// >= 128 (伏魔记's 百火炼金术, byte 0xA0 == 160), the signed read yields -96.
// That negative cost then:
//   * always passes the "can afford" check (costMp < mp is trivially true), and
//   * makes casting the spell ADD mp instead of spending it:
//       attacker.mp = attacker.mp - costMp = attacker.mp - (-96) = attacker.mp + 96
// The fix reads costMp unsigned, matching every sibling field:
//   this.costMp = buf[offset + 4 | 0] & 255;   // 0xA0 -> 160
//
// Because core.js is a 2.9MB browser-bound bundle, we follow the project's
// established pattern (see test_rpg_sale_money.test.mjs / test_rpg_text_wrap)
// and exercise the byte-read semantics here. Since the bug IS Int8Array
// signedness, we use a real Int8Array (the exact mechanism) rather than a pure
// mirror, and pin the production line with a source-level assertion.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// Magic record layout consumed by BaseMagic.setData_ir89t6$ (byte offsets):
//   +0 type, +1 index, +2 (len), +3 roundNum/isForAll,
//   +4 costMp,  +5 magicAni,  +6 magicName(string), +26 magicDescription(string)
// Only +4 (costMp) matters here.
const COST_MP_OFFSET = 4;

// 0xA0 == 160 unsigned == -96 signed (Int8Array). 百火炼金术's cost byte.
const BAIHUO_COST_BYTE = 0xa0;

function makeBuf(costByte) {
    const buf = new Int8Array(32); // Kotlin ByteArray -> signed
    buf[COST_MP_OFFSET] = costByte;
    return buf;
}

// OLD buggy read — bare index, inherits Int8Array signedness.
function readCostMpOld(buf) {
    return buf[COST_MP_OFFSET];
}

// NEW fixed read — masked to unsigned, matching sibling fields.
function readCostMpNew(buf) {
    return buf[COST_MP_OFFSET] & 255;
}

test("OLD: cost byte >= 128 reads as a negative signed value (documents bug)", () => {
    const buf = makeBuf(BAIHUO_COST_BYTE);
    const cost = readCostMpOld(buf);
    assert.equal(cost, -96);
    assert.ok(cost < 0, "百火炼金术 cost should be negative under the buggy read");
});

test("NEW: cost byte 0xA0 reads as unsigned 160", () => {
    const buf = makeBuf(BAIHUO_COST_BYTE);
    assert.equal(readCostMpNew(buf), 160);
});

test("NEW: a negative cost no longer grants MP when a spell is cast", () => {
    // attacker.mp = attacker.mp - costMp. The buggy signed read (-96) refunds
    // 96 MP; the unsigned read (160) correctly spends 160 MP.
    const buf = makeBuf(BAIHUO_COST_BYTE);
    let mpBuggy = 200;
    mpBuggy = mpBuggy - readCostMpOld(buf);
    assert.equal(mpBuggy, 296, "buggy read refunds MP");

    let mpFixed = 200;
    mpFixed = mpFixed - readCostMpNew(buf);
    assert.equal(mpFixed, 40, "fixed read spends MP");
});

test("NEW: normal low-byte costs (e.g. 24) are unaffected by the mask", () => {
    const buf = makeBuf(24);
    assert.equal(readCostMpNew(buf), 24);
    assert.equal(readCostMpOld(buf), 24);
});

test("NEW: boundary byte 0xFF reads as 255, not -1", () => {
    const buf = makeBuf(0xff);
    assert.equal(readCostMpOld(buf), -1);
    assert.equal(readCostMpNew(buf), 255);
});

test("core.js: costMp is read unsigned (& 255) like its sibling fields", () => {
    // Pins the production fix. Fails if the `& 255` mask is removed again.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const m = src.match(/this\.costMp\s*=\s*buf\[offset\s*\+\s*4[^;\n]*/);
    assert.ok(m, "could not locate the costMp assignment in rpg/core.js");
    assert.match(
        m[0],
        /&\s*255/,
        `costMp must be masked to unsigned; found: ${m[0].trim()}`
    );
});
