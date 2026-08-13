import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "swapping gear at the stat cap permanently lowers
// the stat" bug in rpg/core.js (fmj engine, 伏魔记 et al.).
//
// THE BUG
//   Equipment wear/remove is a SYMMETRIC delta on each stat
//   (GoodsEquipment.prototype.putOn_xa4yhy$ ~47266 / takeOff_xa4yhy$ ~47283):
//       p.speed = p.speed + this.mSpeed;   // putOn
//       p.speed = p.speed - this.mSpeed;   // takeOff
//   But assigning triggers the setter, which CLAMPS the value to an upper
//   bound (FightingCharacter prototype, ~40088-40158):
//       speed  -> Math.min(99, s)    lingli -> Math.min(99, l)
//       luck   -> Math.min(99, l)    attack -> Math.min(999, at)
//       defend -> Math.min(999, d)   maxMP  -> Math.min(999, maxMP)
//   The clamp is ONE-SIDED: putOn discards anything above the cap, yet takeOff
//   subtracts the FULL bonus. The two are no longer inverses, so the base stat
//   is permanently eroded — and every gear swap while sitting at the cap eats
//   more of it.
//
//   Reproducing the reported scenario (base 身法 85, old armour +14, better
//   armour +30, cap 99):
//     wear +14        : min(85+14, 99) = 99
//     swap to +30     : takeOff +14 -> 99-14 = 85 ; putOn +30 -> min(85+30,99) = 99
//                      (the 16 above 99 is silently dropped)
//     swap back to +14: takeOff +30 -> 99-30 = 69  <-- WRONG (should be 85)
//                      ; putOn +14  -> min(69+14,99) = 83
//   => 83, exactly the "掉到 80 多" the player saw.
//
// THE FIX (chosen: lift the cap)
//   Remove the upper-bound clamp from those six setters. With no one-sided
//   clamp disrupting the symmetric ±bonus delta, wear/remove become exact
//   inverses again — equipping past the cap keeps the real accumulated value
//   (speed can read 115), and unequipping restores the base precisely. Combat
//   and display simply use the now-uncapped value. Same class of "clamp eats
//   the real value" problem already solved once for the hp setter via
//   deltaSinceBackup (see test_rpg_group_heal_overheal_number); here the clean
//   fix is to stop clamping at the source.
//
// As with the other rpg tests, the 2.9MB browser bundle can't be instantiated
// in Node, so we (a) model the mechanism in plain JS and (b) pin the
// production source with structural assertions.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the setter + symmetric wear/remove in isolation ---

function makeChar(initial, cap) {
    return { v: initial, cap };
}

// Buggy setter: clamps the stored value to [.., cap] on every write, like the
// pre-fix FightingCharacter setters.
function setClamped(ch, v) {
    ch.v = Math.min(ch.cap, v);
}
// Fixed setter (chosen fix): no upper clamp.
function setUncapped(ch, v) {
    ch.v = v;
}

// putOn/takeOff are symmetric deltas routed through whichever setter.
function putOn(ch, bonus, setter) { setter(ch, ch.v + bonus); }
function takeOff(ch, bonus, setter) { setter(ch, ch.v - bonus); }

test("mechanism (buggy): swapping back to the original gear does NOT restore the stat", () => {
    const p = makeChar(/*base*/ 85, /*cap*/ 99);
    putOn(p, 14, setClamped);                 // 99 (was 99, clamped from 99)
    assert.equal(p.v, 99, "base 85 + 14 = 99, sits at the cap");
    // swap to the better +30 piece: take off old, put on new
    takeOff(p, 14, setClamped);               // 99 - 14 = 85  (coincidentally right)
    putOn(p, 30, setClamped);                 // min(85+30, 99) = 99
    assert.equal(p.v, 99, "85 + 30 clamps back to 99; the 16 above is lost");
    // swap back to the original +14 piece
    takeOff(p, 30, setClamped);               // 99 - 30 = 69  <-- the corruption
    assert.equal(p.v, 69, "BUG: takeOff subtracts the full 30 from the clamped 99");
    putOn(p, 14, setClamped);                 // min(69+14, 99) = 83
    assert.equal(p.v, 83, "the player's reported '掉到 80 多'");
    assert.notEqual(p.v, 99, "the stat should have returned to 99 but cannot");
});

test("mechanism (fixed): swapping back to the original gear restores the stat exactly", () => {
    const p = makeChar(85, 99);
    putOn(p, 14, setUncapped);                // 99
    assert.equal(p.v, 99);
    takeOff(p, 14, setUncapped);              // 85
    putOn(p, 30, setUncapped);                // 115  (no clamp; the real value survives)
    assert.equal(p.v, 115, "the accumulated value can exceed the old cap");
    takeOff(p, 30, setUncapped);              // 85   (exact inverse)
    assert.equal(p.v, 85, "unequipping restores the base precisely");
    putOn(p, 14, setUncapped);                // 99
    assert.equal(p.v, 99, "back to the original gear, back to the original stat");
});

test("mechanism (fixed): repeated wear/remove never erodes the base stat", () => {
    const p = makeChar(85, 99);
    for (let i = 0; i < 20; i++) {
        putOn(p, 30, setUncapped);
        takeOff(p, 30, setUncapped);
    }
    assert.equal(p.v, 85, "20 cycles of wearing/removing the +30 piece leave the base untouched");
});

test("mechanism (buggy vs fixed): under the cap both behave identically", () => {
    // The fix only changes behaviour when a stat would exceed the cap; a normal
    // stat that never hits the cap is unaffected, so existing balance holds.
    for (const setter of [setClamped, setUncapped]) {
        const p = makeChar(40, 99);
        putOn(p, 10, setter);
        assert.equal(p.v, 50);
        takeOff(p, 10, setter);
        assert.equal(p.v, 40);
    }
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract an Object.defineProperty(FightingCharacter.prototype, "name", { ... });
// block by brace matching, so the pin survives formatting churn and does not
// bleed into the neighbouring property.
function definePropertyBlock(src, propName) {
    const needle = `Object.defineProperty(FightingCharacter.prototype, "${propName}"`;
    const start = src.indexOf(needle);
    assert.ok(start !== -1, `could not find defineProperty for ${propName} in rpg/core.js`);
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
    assert.fail(`unterminated defineProperty block for ${propName}`);
}

// Extract a prototype-method body by brace matching.
function methodBody(src, name) {
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
    assert.fail(`unterminated method body for ${name}`);
}

// The six stats whose setters clamped to an upper bound and are adjusted by
// equipment wear/remove. Each must no longer clamp (Math_0.min removed).
const CLAMPED_STATS = [
    ["speed", 99],
    ["lingli", 99],
    ["luck", 99],
    ["attack", 999],
    ["defend", 999],
    ["maxMP", 999],
];

for (const [stat, oldCap] of CLAMPED_STATS) {
    test(`core.js: ${stat} setter no longer clamps to ${oldCap} (wear/remove stays reversible)`, () => {
        const src = fs.readFileSync(CORE_JS, "utf8");
        const block = definePropertyBlock(src, stat);
        assert.doesNotMatch(
            block,
            /Math_0\.min/,
            `${stat} setter must not Math_0.min-clamp its value; the one-sided clamp is what made equip/unequip non-reversible at the cap`
        );
    });
}

test("core.js: maxHP setter still keeps hp within maxHP (the unrelated hp clamp is preserved)", () => {
    // We only lifted the six gear-adjusted upper caps. maxHP's setter has no
    // upper cap of its own, but it DOES clamp current hp down to the new
    // ceiling when maxHP drops — that correctness guard must survive untouched.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const block = definePropertyBlock(src, "maxHP");
    assert.match(block, /if\s*\([^]*hp_oo4bdu\$_0\s*>\s*[^]*maxHP_aqimg2\$_0[^]*\)/, "maxHP setter must still clamp stored hp down to maxHP");
});

test("core.js: equipment wear/remove are still symmetric ±bonus deltas", () => {
    // The fix is in the setters, NOT in the wear/remove logic. The putOn/takeOff
    // pair must remain `p.X = p.X ± this.mX`; only the setters changed.
    const src = fs.readFileSync(CORE_JS, "utf8");
    // Name includes ` = function` so we pin the DEFINITION (core.js:47266 /
    // 47283) and not the `.call(this, p)` parent-invocation inside the
    // GoodsDecorations / GoodsWeapon wrappers of the same name.
    const putOn = methodBody(src, "GoodsEquipment.prototype.putOn_xa4yhy$ = function");
    assert.match(putOn, /p\.speed\s*=\s*p\.speed\s*\+\s*this\.mSpeed/, "putOn adds mSpeed");
    assert.match(putOn, /p\.defend\s*=\s*p\.defend\s*\+\s*this\.mdf/, "putOn adds mdf");
    const takeOff = methodBody(src, "GoodsEquipment.prototype.takeOff_xa4yhy$ = function");
    assert.match(takeOff, /p\.speed\s*=\s*p\.speed\s*-\s*this\.mSpeed/, "takeOff subtracts mSpeed");
    assert.match(takeOff, /p\.defend\s*=\s*p\.defend\s*-\s*this\.mdf/, "takeOff subtracts mdf");
});
