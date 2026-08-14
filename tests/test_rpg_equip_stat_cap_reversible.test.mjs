import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "swapping gear at the stat cap permanently lowers
// the stat" bug in rpg/core.js (fmj engine, 伏魔记 et al.).
//
// THE BUG
//   Equipment wear/remove used to be a SYMMETRIC delta on each stat
//   (GoodsEquipment.prototype.putOn_xa4yhy$ / takeOff_xa4yhy$):
//       p.speed = p.speed + this.mSpeed;   // putOn
//       p.speed = p.speed - this.mSpeed;   // takeOff
//   But assigning triggers the setter, which CLAMPS the value to an upper
//   bound (FightingCharacter prototype; nowadays the limit comes from
//   GameSettings.enableEnhancedLimits — 99/127 for speed-class stats,
//   999/9999 for attack-class stats):
//       speed  -> min(99, s)    lingli -> min(99, l)
//       luck   -> min(99, l)    attack -> min(999, at)
//       defend -> min(999, d)   maxMP  -> min(999, maxMP)
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
// THE FIX (shipped: total* accumulators in GoodsEquipment putOn/takeOff)
//   The visible-value setters KEEP their GameSettings clamp (display/balance),
//   but the wear/remove pair no longer runs the ±bonus through them. Every
//   gear-adjusted stat gets a plain total* accumulator that putOn/takeOff
//   update symmetrically and then publish as the visible value:
//       putOn  : p.totalSpeed += this.mSpeed; p.speed = p.totalSpeed
//       takeOff: p.totalSpeed -= this.mSpeed; p.speed = p.totalSpeed
//   The total* fields are plain data fields (no accessor property), so the
//   one-sided clamp can never eat the bonus again: equipping past the cap
//   keeps the real accumulated value in totalSpeed (the visible speed just
//   reads the cap while worn), and unequipping restores the base precisely.
//   maxHP is handled separately: its setter has no upper cap of its own and
//   keeps only the correctness guard that pulls hp down when the ceiling
//   drops (pinned below). Same class of "clamp eats the real value" problem
//   already solved once for the hp setter via deltaSinceBackup
//   (see test_rpg_group_heal_overheal_number).
//
// As with the other rpg tests, the 2.9MB browser bundle can't be instantiated
// in Node, so we (a) model the mechanism in plain JS and (b) pin the
// production source with structural assertions.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the setter + symmetric wear/remove in isolation ---

function makeChar(initial, cap) {
    return { v: initial, cap };
}

// Buggy model: the setter clamps the stored value to [.., cap] on every write
// (like the FightingCharacter visible-value setters), and the pre-fix
// putOn/takeOff routed their ±bonus straight through it.
function setClamped(ch, v) {
    ch.v = Math.min(ch.cap, v);
}
function putOnBuggy(ch, bonus) { setClamped(ch, ch.v + bonus); }
function takeOffBuggy(ch, bonus) { setClamped(ch, ch.v - bonus); }

// FIXED model (shipped design): the visible-value setter still clamps, but
// putOn/takeOff keep the true value in a plain accumulator (the engine's
// total* fields, which no accessor intercepts) and publish from it.
function makeAccChar(initial, cap) {
    return { total: initial, v: initial, cap };
}
function setVisible(ch, v) { ch.v = Math.min(ch.cap, v); }
function putOnFixed(ch, bonus) { ch.total += bonus; setVisible(ch, ch.total); }
function takeOffFixed(ch, bonus) { ch.total -= bonus; setVisible(ch, ch.total); }

test("mechanism (buggy): swapping back to the original gear does NOT restore the stat", () => {
    const p = makeChar(/*base*/ 85, /*cap*/ 99);
    putOnBuggy(p, 14);                          // 99 (was 99, clamped from 99)
    assert.equal(p.v, 99, "base 85 + 14 = 99, sits at the cap");
    // swap to the better +30 piece: take off old, put on new
    takeOffBuggy(p, 14);                        // 99 - 14 = 85  (coincidentally right)
    putOnBuggy(p, 30);                          // min(85+30, 99) = 99
    assert.equal(p.v, 99, "85 + 30 clamps back to 99; the 16 above is lost");
    // swap back to the original +14 piece
    takeOffBuggy(p, 30);                        // 99 - 30 = 69  <-- the corruption
    assert.equal(p.v, 69, "BUG: takeOff subtracts the full 30 from the clamped 99");
    putOnBuggy(p, 14);                          // min(69+14, 99) = 83
    assert.equal(p.v, 83, "the player's reported '掉到 80 多'");
    assert.notEqual(p.v, 99, "the stat should have returned to 99 but cannot");
});

test("mechanism (fixed): swapping back to the original gear restores the stat exactly", () => {
    const p = makeAccChar(85, 99);
    putOnFixed(p, 14);                          // total 99, visible 99
    assert.equal(p.v, 99);
    takeOffFixed(p, 14);                        // total 85
    putOnFixed(p, 30);                          // total 115, visible clamped at 99
    assert.equal(p.total, 115, "the accumulator keeps the real value past the cap");
    assert.equal(p.v, 99, "the visible value just reads the cap while worn");
    takeOffFixed(p, 30);                        // total 85 (exact inverse)
    assert.equal(p.v, 85, "unequipping restores the base precisely");
    putOnFixed(p, 14);                          // total 99
    assert.equal(p.v, 99, "back to the original gear, back to the original stat");
});

test("mechanism (fixed): repeated wear/remove never erodes the base stat", () => {
    const p = makeAccChar(85, 99);
    for (let i = 0; i < 20; i++) {
        putOnFixed(p, 30);
        takeOffFixed(p, 30);
    }
    assert.equal(p.v, 85, "20 cycles of wearing/removing the +30 piece leave the base untouched");
});

test("mechanism (buggy vs fixed): under the cap both behave identically", () => {
    // The fix only changes behaviour when a stat would exceed the cap; a normal
    // stat that never hits the cap is unaffected, so existing balance holds.
    const buggy = makeChar(40, 99);
    putOnBuggy(buggy, 10);
    assert.equal(buggy.v, 50);
    takeOffBuggy(buggy, 10);
    assert.equal(buggy.v, 40);
    const fixed = makeAccChar(40, 99);
    putOnFixed(fixed, 10);
    assert.equal(fixed.v, 50);
    takeOffFixed(fixed, 10);
    assert.equal(fixed.v, 40);
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract an Object.defineProperty(FightingCharacter.prototype, 'name', { ... });
// block by brace matching, so the pin survives formatting churn and does not
// bleed into the neighbouring property.
function definePropertyBlock(src, propName) {
    const needle = `Object.defineProperty(FightingCharacter.prototype, '${propName}'`;
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

// The six stats whose VISIBLE setters clamp to an upper bound (speed-class
// <= 99/127, attack-class <= 999/9999, per GameSettings.enableEnhancedLimits)
// and are adjusted by equipment wear/remove. Reversibility no longer lives in
// the setters — it lives in putOn/takeOff's total* accumulators: putOn adds
// the bonus to the plain accumulator, takeOff subtracts it, and both publish
// the visible value from the accumulator, so the pair stays an exact inverse
// even while the visible value sits at the cap.
const EQUIP_STATS = [
    ["speed", "totalSpeed", "mSpeed", 99],
    ["lingli", "totalLingli", "mlingli", 99],
    ["luck", "totalLuck", "mLuck", 99],
    ["attack", "totalAttack", "mat", 999],
    ["defend", "totalDefend", "mdf", 999],
    ["maxMP", "totalMaxMP", "mMpMax", 999],
];

for (const [stat, total, bonus, oldCap] of EQUIP_STATS) {
    test(`core.js: putOn/takeOff keep ${stat} reversible via ${total} (old cap ${oldCap})`, () => {
        const src = fs.readFileSync(CORE_JS, "utf8");
        // Name includes ` = function` so we pin the DEFINITION and not the
        // `.call(this, p)` parent-invocation inside the GoodsDecorations /
        // GoodsWeapon wrappers of the same name.
        const putOn = methodBody(src, "GoodsEquipment.prototype.putOn_xa4yhy$ = function");
        assert.match(
            putOn,
            new RegExp(`p\\.${total}\\s*=\\s*p\\.${total}\\s*\\+\\s*this\\.${bonus}[\\s\\S]{0,400}p\\.${stat}\\s*=\\s*p\\.${total};`),
            `putOn must add ${bonus} to the ${total} accumulator and then publish ${stat} from it`
        );
        const takeOff = methodBody(src, "GoodsEquipment.prototype.takeOff_xa4yhy$ = function");
        assert.match(
            takeOff,
            new RegExp(`p\\.${total}\\s*=\\s*p\\.${total}\\s*-\\s*this\\.${bonus}[\\s\\S]{0,400}p\\.${stat}\\s*=\\s*p\\.${total};`),
            `takeOff must subtract ${bonus} from the ${total} accumulator and then publish ${stat} from it`
        );
    });
}

test("core.js: maxHP setter still keeps hp within maxHP (the unrelated hp clamp is preserved)", () => {
    // maxHP's setter has no upper cap of its own; it only keeps the correctness
    // guard that pulls current hp down to the new ceiling when maxHP drops
    // (`field = maxHP; if (field < hp) hp = field`). That guard must survive
    // untouched, and no 999 cap may be reintroduced for maxHP itself.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const block = definePropertyBlock(src, "maxHP");
    assert.match(
        block,
        /this\.maxHP_aqimg2\$_0\s*=\s*maxHP;\s*if\s*\(\s*this\.maxHP_aqimg2\$_0\s*<\s*this\.hp\s*\)\s*\{\s*this\.hp\s*=\s*this\.maxHP_aqimg2\$_0;\s*\}/,
        "maxHP setter must store the value and pull hp down to it when hp exceeds the new ceiling"
    );
    assert.doesNotMatch(block, /Math_0\.min|JsMath\.min/, "maxHP itself must stay uncapped (no min-clamp in this setter)");
});

test("core.js: the total* accumulators are plain fields (never routed through the clamped setters)", () => {
    // The reversibility guarantee only holds because `p.totalSpeed = ...` etc.
    // are plain data-field writes that no accessor intercepts. If any total*
    // ever gained a defineProperty accessor, the one-sided erosion bug would
    // come straight back through the same clamp.
    const src = fs.readFileSync(CORE_JS, "utf8");
    for (const total of ["totalMaxMP", "totalMaxHP", "totalAttack", "totalDefend", "totalSpeed", "totalLingli", "totalLuck"]) {
        assert.doesNotMatch(
            src,
            new RegExp(`Object\\.defineProperty\\([^)]*\\.prototype,\\s*'${total}'`),
            `${total} must stay a plain field; an accessor would make putOn/takeOff non-reversible again`
        );
    }
});
