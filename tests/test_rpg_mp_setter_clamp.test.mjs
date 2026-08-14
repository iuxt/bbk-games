import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "真气 can go (and render) negative" in rpg/core.js
// (fmj engine, 伏魔记 et al.) — FightingCharacter mp setter (~core.js:40111).
//
// THE BUG
//   The hp setter clamps to [0, maxHP], but the mp setter only clamps the
//   upper bound:
//
//       set: function(mp) {
//         var a = this.maxMP;
//         this.mp_oo4f3b$_0 = Math_0.min(a, mp);      // <-- no Math_0.max(0, ...)
//       }
//
//   MP-damage writes flow through it unclamped on the low end:
//     - MagicAttack.use drains `dst.mp = dst.mp - abs(mpHurt)` unconditionally,
//     - Throwable.attack does `other.mp = other.mp - affectMp` (thrown 暗器).
//   A monster/player with less MP than the drain ends up with negative MP:
//   drawSmallNum renders garbage, and exitCurrentCombat_0 band-aids players
//   after battle (`if (p.mp <= 0) p.mp = 1;`) instead of preventing it.
//
// THE FIX
//   Clamp the low end too, symmetric with the hp setter:
//   `Math_0.max(0, Math_0.min(a, mp))`.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the mp setter ---

function makeFighter(maxMP, mp) {
    return { maxMP, mpStored: mp };
}

// Mirrors the BUGGY mp setter: upper clamp only.
function setMpBuggy(ch, mp) {
    ch.mpStored = Math.min(ch.maxMP, mp);
}

// Mirrors the FIXED mp setter: clamp to [0, maxMP], like the hp setter.
function setMpFixed(ch, mp) {
    ch.mpStored = Math.max(0, Math.min(ch.maxMP, mp));
}

test("mechanism (buggy): draining below zero stores negative MP", () => {
    const f = makeFighter(200, 30);
    setMpBuggy(f, f.mpStored - 250); // 百火炼金术-style MP drain of 250
    assert.equal(f.mpStored, -220, "stored MP is negative — renders as garbage");
});

test("mechanism (fixed): draining below zero clamps at 0", () => {
    const f = makeFighter(200, 30);
    setMpFixed(f, f.mpStored - 250);
    assert.equal(f.mpStored, 0, "MP floors at 0");
});

test("mechanism (fixed): upper clamp and normal writes unchanged", () => {
    const f = makeFighter(100, 50);
    setMpFixed(f, 130); // overheal
    assert.equal(f.mpStored, 100, "still capped at maxMP");
    setMpFixed(f, 70); // ordinary restore
    assert.equal(f.mpStored, 70);
    setMpFixed(f, 0); // exactly zero is fine
    assert.equal(f.mpStored, 0);
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

function functionBody(src, name) {
    const start = src.indexOf(name);
    assert.ok(start !== -1, `could not find ${name} in rpg/core.js`);
    const open = src.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    assert.fail(`unterminated function body for ${name}`);
}

test("core.js: mp setter clamps to [0, maxMP] like the hp setter", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    // The mp setter is defined via Object.defineProperty; grab its setter body
    // by locating the mp getter first, then brace-matching the set function.
    const anchor = src.indexOf('Object.defineProperty(FightingCharacter.prototype, "mp"');
    assert.ok(anchor !== -1, 'could not locate the "mp" property definition');
    const open = src.indexOf("{", src.indexOf("set: function(mp)", anchor));
    let depth = 0;
    let body = null;
    for (let i = open; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
            depth--;
            if (depth === 0) {
                body = src.slice(open, i + 1);
                break;
            }
        }
    }
    assert.ok(body, "could not extract the mp setter body");
    assert.match(
        body,
        /Math_0\.max\(0,\s*Math_0\.min\(a,\s*mp\)\)/,
        `mp setter must clamp to [0, maxMP]; found: ${body.trim()}`
    );
});
