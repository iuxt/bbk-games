import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "group skill kills an enemy but no damage number
// floats up — it just vanishes" bug in rpg/core.js (fmj engine, 伏魔记 et al.),
// and for the related requirement that the floating number show the REAL damage
// dealt, not the enemy's remaining HP.
//
// HOW THE DAMAGE NUMBER WORKS
//   FightingCharacter has an `hp` setter that CLAMPS the stored hp to
//   [0, maxHP] (so hp bottoms out at 0 on death). On every write it also
//   accumulates the UNCLAMPED delta into `deltaSinceBackup`. After an action,
//   diff_6taknv$() builds a Diff whose `hp` is that accumulated delta (the real
//   damage/healing), and diffToAnimation() turns it into a RaiseAnimation that
//   floats "-N" / "+N" over the combatant. RaiseAnimation shows a number iff the
//   delta is non-zero, otherwise it no-ops (no "0" ever appears).
//
// THE BUG
//   ActionMagicAttackAll.preproccess applies the spell's damage to every target,
//   THEN builds the per-target raise animations — but guarded each one with
//   `if (item.isAlive)`. Because damage was applied first, a target killed by
//   THIS spell already has isAlive === false and is skipped: no number floats,
//   the enemy simply disappears. (The sibling group actions —
//   ActionPhysicalAttackAll, ActionThrowItemAll, ActionCoopMagic — add the
//   animation for every target unconditionally, so they never had this bug.)
//
// WHY SIMPLY REMOVING THE GUARD IS SAFE
//   MagicAttack.use already skips combatants that were dead BEFORE the spell
//   (`if (!fc.isAlive) continue;`), so an untouched corpse keeps delta 0 and its
//   RaiseAnimation no-ops — no spurious number appears over a KO'd body. Only a
//   target that was alive and actually took the hit has a non-zero delta, so only
//   those raise a number. And because the delta is unclamped, an overkill hit
//   (e.g. 500 damage on a 100-hp enemy) floats "-500", the real damage, not "-100".
//
// We can't instantiate the 2.9MB browser bundle in Node, so — per the project's
// established pattern (test_rpg_combat_stop_on_victory / test_rpg_magic_cost) —
// we (a) model the relevant mechanics in plain JS and (b) pin the production
// source with structural assertions.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the hp setter + delta tracking in isolation ---

function makeCharacter(maxHP, hp) {
    return { maxHP, hpStored: hp, deltaSinceBackup: 0 };
}

// Mirrors FightingCharacter.prototype hp setter (rpg/core.js ~40094): clamp the
// stored hp to [0, maxHP], but accumulate the raw delta for display.
function setHp(ch, hp) {
    const delta = (hp - ch.hpStored) | 0;
    ch.deltaSinceBackup = (ch.deltaSinceBackup + delta) | 0;
    ch.hpStored = Math.max(0, Math.min(ch.maxHP, hp));
}

test("mechanism: an overkill hit clamps stored hp to 0 but records the REAL damage", () => {
    const enemy = makeCharacter(/*maxHP*/ 9999, /*hp*/ 100);
    setHp(enemy, 100 - 500); // a 500-damage spell on a 100-hp enemy
    assert.equal(enemy.hpStored, 0, "stored hp clamps to 0 (enemy dies)");
    assert.equal(enemy.deltaSinceBackup, -500, "delta records the real 500 damage, not the 100 remainder");
    assert.equal(enemy.hpStored + enemy.deltaSinceBackup, -500, "remaining-HP read would be -100+100=0; real damage is -500");
});

test("mechanism: a non-lethal hit records exactly the damage taken", () => {
    const enemy = makeCharacter(9999, 300);
    setHp(enemy, 300 - 80); // 80 damage, survives
    assert.equal(enemy.hpStored, 220);
    assert.equal(enemy.deltaSinceBackup, -80);
});

// Mirrors RaiseAnimation ctor: a number floats iff the delta is non-zero.
function showsNumber(hitpoint) {
    return hitpoint !== 0;
}

test("mechanism: a number floats iff the combatant actually took damage", () => {
    assert.equal(showsNumber(-500), true, "a freshly-killed enemy with real damage shows a number");
    assert.equal(showsNumber(0), false, "an untouched corpse (delta 0) shows nothing");
});

// Mirrors the per-target raise-animation loop in ActionMagicAttackAll.preproccess.
// `guardAlive` models the buggy `if (item.isAlive)` skip.
function buildTargetAnimations(targets, guardAlive) {
    const out = [];
    for (const t of targets) {
        if (guardAlive && !t.isAlive) continue;
        out.push({ showNum: showsNumber(t.deltaSinceBackup) });
    }
    return out;
}

test("mechanism (buggy): the isAlive guard drops a killed enemy's number entirely", () => {
    const killed = { isAlive: false, deltaSinceBackup: -500 };
    const out = buildTargetAnimations([killed], /*guardAlive*/ true);
    assert.equal(out.length, 0, "the buggy guard skips the freshly-killed target");
});

test("mechanism (fixed): killed-by-spell enemy raises its number; untouched corpse does not", () => {
    const killedBySpell = { isAlive: false, deltaSinceBackup: -500 }; // was alive, now dead, took 500
    const corpse = { isAlive: false, deltaSinceBackup: 0 };           // already dead, spell skipped it
    const survivor = { isAlive: true, deltaSinceBackup: -80 };        // took 80, alive
    const out = buildTargetAnimations([killedBySpell, corpse, survivor], /*guardAlive*/ false);
    assert.equal(out.length, 3, "every target gets an animation entry");
    assert.equal(out[0].showNum, true, "killed-by-spell enemy floats its real -500 damage");
    assert.equal(out[1].showNum, false, "untouched corpse floats nothing (delta 0)");
    assert.equal(out[2].showNum, true, "survivor floats its -80 damage");
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract a prototype-method body by brace matching so the pins survive
// formatting churn and don't bleed into neighbouring functions.
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

test("core.js: ActionMagicAttackAll raises the damage number over a killed target", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "ActionMagicAttackAll.prototype.preproccess");
    // Locate the per-target loop that pushes each target's diffToAnimation.
    const loopMatch = body.match(
        /while\s*\([^)]*\.hasNext\(\)\)\s*\{[\s\S]*?item\.diffToAnimation_6taknv\$\(\)[\s\S]*?\}/
    );
    assert.ok(loopMatch, "found the per-target raise-animation loop in ActionMagicAttackAll.preproccess");
    // The loop must NOT gate the animation on isAlive — that hides the number of
    // an enemy killed by this very spell.
    assert.doesNotMatch(
        loopMatch[0],
        /isAlive/,
        "the per-target damage loop must not gate on isAlive (it would hide a killed enemy's damage number)"
    );
});

test("core.js: hp setter tracks the unclamped delta (real damage, not remaining HP)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "Object.defineProperty(FightingCharacter.prototype, \"hp\"");
    assert.match(body, /deltaSinceBackup/, "the hp setter must accumulate the unclamped delta for display");
    assert.match(body, /Math_0\.max\(\s*0/, "the stored hp must still be clamped to 0 (death/revive correctness)");
});

test("core.js: MagicAttack.use skips already-dead corpses (so removing the guard is safe)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "MagicAttack.prototype.use_h32lzv$");
    assert.match(
        body,
        /!fc\.isAlive[\s\S]{0,40}continue/,
        "MagicAttack.use must skip pre-dead combatants so an untouched corpse keeps delta 0 and shows no number"
    );
});
