import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "柳清风 36 级只剩妙手空空" bug in rpg/core.js
// (ResLevelupChain.prototype.setData_ir89t6$ / getLearnMagicNum_za3lpa$).
//
// The 伏魔记 .lib stores, per level, a byte (offset +19 within each 20-byte
// level record) = cumulative count of magics learnt SO FAR. The sequence is
// monotonic non-decreasing until the character has learnt every magic in its
// magicChain (magicSum), AFTER WHICH every remaining level's byte is 0:
//
//   柳清风  magicSum=18  byte19[1..60] = 1,2,2,3,...,18, 0,0,0,...,0   (35级学满, 36级起=0)
//   慕容小梅 magicSum=30  ...30, 0,0,...                                      (36级学满, 37级起=0)
//   袁萍芷   magicSum=16  ...16, 0,0,...                                      (33级学满, 34级起=0)
//
// The engine reads this byte verbatim (getLearnMagicNum) and assigns it
// directly to magicChain.learnNum on level-up. slice(0 until learnNum) then
// returns the magics the character "has learnt". Crossing the learn-cap level
// sets learnNum=0, so getAllLearntMagics() empties out and every magic from
// the magicChain vanishes — leaving only Player.privateLearntMagics (脚本授予的
// 妙手空空). Symptom: "柳清风到36级所有技能只剩妙手空空".
//
// Fix: when loading the levelupChain (setData), make the byte19 column
// monotonic non-decreasing (propagate the peak forward). This also rescues
// saves already corrupted to learnNum=0, because the levelupChain is reloaded
// from the .lib on every load and getLearnMagicNum then returns the peak.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");
const ROM = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "roms", "fmj_rpg.lib");
const LEVEL_BYTES = 20;

// Parse a fmj .lib: index table @0x10, offset table @0x2000.
function parseLib(u) {
    const offsets = new Map(); // (resType<<16 | type<<8 | index) -> file offset
    let i = 0x10, j = 0x2000;
    while (i < u.length && u[i] !== 0xff) {
        const resType = u[i], type = u[i + 1], index = u[i + 2];
        const block = u[j], low = u[j + 1], high = u[j + 2];
        offsets.set((resType << 16) | (type << 8) | index, block * 0x4000 + ((high << 8) | low));
        i += 3; j += 3;
    }
    return offsets;
}
const gbkStr = (u, start) => { let x = start; while (u[x]) x++; return new TextDecoder("gbk").decode(u.subarray(start, x)); };

// --- the fix as a pure function on the byte19 column ---
function monotizeLearnNumColumn(bytes /* Uint8Array of the raw level data */) {
    const n = Math.floor(bytes.length / LEVEL_BYTES);
    for (let lv = 2; lv <= n; lv++) {
        const prev = (lv - 2) * LEVEL_BYTES + 19;
        const cur = (lv - 1) * LEVEL_BYTES + 19;
        if (bytes[cur] < bytes[prev]) bytes[cur] = bytes[prev];
    }
    return bytes;
}

test("pure fix: a byte19 column that drops to 0 after the cap becomes monotonic", () => {
    // mini level table: 4 levels, byte19 = [3, 5, 0, 0] (cap reached at lvl2=5)
    const raw = new Uint8Array(4 * LEVEL_BYTES);
    raw[0 * 20 + 19] = 3;
    raw[1 * 20 + 19] = 5;
    raw[2 * 20 + 19] = 0;
    raw[3 * 20 + 19] = 0;
    const fixed = monotizeLearnNumColumn(raw);
    assert.equal(fixed[0 * 20 + 19], 3);
    assert.equal(fixed[1 * 20 + 19], 5);
    assert.equal(fixed[2 * 20 + 19], 5, "lvl3 keeps the peak 5, not 0");
    assert.equal(fixed[3 * 20 + 19], 5, "lvl4 keeps the peak 5, not 0");
});

test("pure fix: an already-monotonic column is unchanged", () => {
    const raw = new Uint8Array(3 * LEVEL_BYTES);
    raw[0 * 20 + 19] = 1; raw[1 * 20 + 19] = 1; raw[2 * 20 + 19] = 2;
    const fixed = monotizeLearnNumColumn(raw);
    assert.deepEqual(Array.from(fixed), Array.from(raw));
});

test("ROM: 柳清风 levelupChain byte19 drops 18->0 at level 36 (documents the bug)", () => {
    if (!fs.existsSync(ROM)) { console.warn(`skip: ${ROM} not present`); return; }
    const u = new Uint8Array(fs.readFileSync(ROM));
    const off = parseLib(u);
    // 柳清风 is Player idx=1 (ARS=3,type=1); levelupChain is MLR=12,type=2,idx=1
    const lc = off.get((12 << 16) | (2 << 8) | 1);
    assert.ok(lc, "柳清风 levelupChain record exists");
    const maxLevel = u[lc + 2];
    assert.equal(maxLevel, 60, "柳清风 maxLevel=60");
    const data = lc + 4;
    const byte19 = (lv) => u[data + (lv - 1) * LEVEL_BYTES + 19];
    assert.equal(byte19(35), 18, "lvl35 has learnt all 18 magics");
    assert.equal(byte19(36), 0, "lvl36 byte19 is 0 (the bug)");
    assert.equal(byte19(60), 0, "lvl60 byte19 is still 0");
    // simulate the fix on the real column
    const col = u.slice(data, data + maxLevel * LEVEL_BYTES);
    monotizeLearnNumColumn(col);
    const fixed = (lv) => col[(lv - 1) * LEVEL_BYTES + 19];
    assert.equal(fixed(36), 18, "after fix lvl36 keeps peak 18");
    assert.equal(fixed(60), 18, "after fix lvl60 keeps peak 18");
});

test("ROM: 慕容小梅 / 袁萍芷 hit the same drop (bug is global, not 柳清风-specific)", () => {
    if (!fs.existsSync(ROM)) { console.warn(`skip: ${ROM} not present`); return; }
    const u = new Uint8Array(fs.readFileSync(ROM));
    const off = parseLib(u);
    for (const [idx, name, capLv] of [[2, "慕容小梅", 36], [3, "袁萍芷", 33]]) {
        const lc = off.get((12 << 16) | (2 << 8) | idx);
        assert.ok(lc, `${name} levelupChain exists`);
        const data = lc + 4;
        const byte19 = (lv) => u[data + (lv - 1) * LEVEL_BYTES + 19];
        assert.ok(byte19(capLv) > 0 && byte19(capLv + 1) === 0,
            `${name}: byte19 drops to 0 right after lvl${capLv}`);
    }
});

test("core.js: setData_ir89t6$ monotizes the learnNum column (pins the production fix)", () => {
    // Fails until the patch is applied to rpg/core.js.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const m = src.match(/ResLevelupChain\.prototype\.setData_ir89t6\$\s*=\s*function\(buf,\s*offset\)\s*\{([\s\S]*?)\n    \};/);
    assert.ok(m, "could not locate setData_ir89t6$ body in rpg/core.js");
    const body = m[1];
    // must iterate level records and propagate byte19 forward when it would decrease
    assert.match(body, /LEVEL_BYTES/, "fix must reference LEVEL_BYTES stride");
    assert.match(body, /\+\s*19/, "fix must address the byte19 column (offset +19)");
    assert.match(body, /<=\s*this\.maxLevel/, "fix must walk every level up to maxLevel");
    // the propagation: when current < previous, set current = previous
    assert.match(body, /mLevelData_0\[[\w$]+\]\s*=\s*this\.mLevelData_0\[[\w$]+\]/,
        "fix must copy the previous peak into the current byte19 slot");
});

test("scenario: learnNum at lvl36 stays 18 (fixed) instead of becoming 0 (buggy)", () => {
    // Models getLearnMagicNum(level) feeding magicChain.learnNum + slice(0 until learnNum)
    const rawSeq = []; // 柳清风 byte19 column (lvl 1..60)
    const fill = (lv, v) => { while (rawSeq.length < lv) rawSeq.push(rawSeq.length + 1 <= 35 ? Math.min(18, rawSeq.length + 1) : 0); rawSeq[lv - 1] = v; };
    // build the documented sequence: 1,2,2,3,3,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,9,10,11,12,12,13,13,14,14,15,16,17,18,0,0,...
    const documented = [1,2,2,3,3,4,4,4,5,5,5,5,6,6,6,6,7,7,7,7,8,8,9,10,11,12,12,13,13,14,14,15,16,17,18];
    for (let i = 0; i < documented.length; i++) rawSeq[i] = documented[i];
    for (let lv = 36; lv <= 60; lv++) rawSeq[lv - 1] = 0;

    const learnNumAt = (seq, lv) => seq[lv - 1]; // engine: learnNum = getLearnMagicNum(lv)

    // buggy engine: at lvl36 learnNum becomes 0 -> slice(0 until 0) = empty magic list
    assert.equal(learnNumAt(rawSeq, 36), 0, "buggy: lvl36 learnNum=0");
    const buggyMagicCount = Math.max(0, learnNumAt(rawSeq, 36)); // slice length
    assert.equal(buggyMagicCount, 0, "buggy: all magicChain magics vanish");

    // fixed engine: monotized column keeps the peak
    const fixed = [...rawSeq];
    for (let i = 1; i < fixed.length; i++) if (fixed[i] < fixed[i - 1]) fixed[i] = fixed[i - 1];
    assert.equal(learnNumAt(fixed, 36), 18, "fixed: lvl36 learnNum stays 18");
    assert.equal(learnNumAt(fixed, 60), 18, "fixed: lvl60 learnNum stays 18");
});

test("core.js: readArchive (decode_setnfj$) clamps a corrupted learnNum back up to the level peak", () => {
    // Defense-in-depth: a save written under the bug has magicChain.learnNum = 0.
    // On load it must be corrected using levelupChain so the player doesn't have
    // to gain yet another level just to see their magics return.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const m = src.match(/Player\.prototype\.decode_setnfj\$\s*=\s*function\(coder\)\s*\{([\s\S]*?)\n    \};/);
    assert.ok(m, "could not locate decode_setnfj$ body in rpg/core.js");
    const body = m[1];
    assert.match(body, /getLearnMagicNum_za3lpa\$\([^)]*this\.level/,
        "decode must recompute the peak via getLearnMagicNum(this.level)");
    assert.match(body, />\s*this\.magicChain\.learnNum/,
        "decode must guard with (peak > current learnNum)");
    assert.match(body, /this\.magicChain\.learnNum\s*=/,
        "decode must write the corrected value back into magicChain.learnNum");
});

test("scenario: corrupted save (learnNum=0 at lvl36) is restored on load", () => {
    // After the setData fix, the levelupChain byte19 column is monotonic, so the
    // peak for any level >= 35 is 18. A corrupted save stored learnNum=0.
    const peak = (lv) => lv >= 35 ? 18 : Math.min(18, lv);
    let learnNum = 0;                 // what the buggy save stored
    const level = 36;
    const ln = peak(level);           // decode_setnfj$ recomputes the peak
    if (ln > learnNum) learnNum = ln; // decode_setnfj$ clamp
    assert.equal(learnNum, 18, "corrupted save restored to 18 immediately on load");
});
