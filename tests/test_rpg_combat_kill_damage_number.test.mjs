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
// THE BUG (pre-rebuild hand-patched core.js)
//   ActionMagicAttackAll.preproccess applied the spell's damage to every target,
//   THEN built the per-target raise animations — but guarded each one with
//   `if (item.isAlive)`. Because damage was applied first, a target killed by
//   THIS spell already had isAlive === false and was skipped: no number floated,
//   the enemy simply vanished. (The sibling group actions —
//   ActionPhysicalAttackAll, ActionThrowItemAll, ActionCoopMagic — add the
//   animation for every target unconditionally, so they never had this bug.)
//
// THE FIX (current shape, recompiled from fmj_kt/src)
//   ActionMagicAttackAll.preproccess now filters the target list down to the
//   LIVING targets FIRST (`aliveTargets = mTargets.filter { it.isAlive }`), then
//   casts the spell on that filtered list (`magic.use(attacker, aliveTargets)`),
//   and finally raises a damage number for EVERY entry of that same list
//   (`mRaiseAnimations.addAll(aliveTargets.map { it.diffToAnimation() })`).
//   A monster killed by this very spell was alive at filter time, so it is still
//   in aliveTargets when the numbers are built and floats its real damage; a
//   corpse that was dead before the spell never enters the list, keeps delta 0,
//   and RaiseAnimation no-ops (no "0" ever appears).
//
// WHY THE LIST-FORM MagicAttack.use NEEDS NO isAlive GUARD OF ITS OWN
//   Both callers of the list-form use pass a pre-filtered target list:
//   ActionMagicAttackAll's isAlive filter (above) and ActionCoopMagic's
//   `mMonsters.removeAll { !it.isAlive }`. So the list-form use never sees a
//   pre-dead combatant in the first place, and an untouched corpse keeps delta 0
//   and shows no number. And because the delta is unclamped, an overkill hit
//   (e.g. 500 damage on a 100-hp enemy) floats "-500", the real damage, not
//   "-100".
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

// Mirrors FightingCharacter.prototype hp setter (rpg/core.js ~70225): clamp the
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
    // Step 1 of the fix: the target list is filtered down to the ALIVE ones
    // before anything is cast (`filter { it.isAlive }` compiled to a
    // while/destination loop; temp identifiers and mangled suffixes vary).
    const filterMatch = body.match(
        /while\s*\([^)]*\.hasNext\(\)\)\s*\{[^{}]*if\s*\(\s*[A-Za-z0-9$_]+\.isAlive\s*\)[^{}]*destination\.add_11rb\$\(\s*[A-Za-z0-9$_]+\s*\)\s*;?\s*\}/
    );
    assert.ok(
        filterMatch,
        "found the isAlive filter loop building the alive target list in ActionMagicAttackAll.preproccess"
    );
    const aliveDeclIdx = body.indexOf("var aliveTargets = destination;");
    assert.ok(aliveDeclIdx !== -1, "the filtered list must be captured as aliveTargets");
    assert.ok(
        filterMatch.index < aliveDeclIdx,
        "the isAlive filter must run BEFORE the filtered list is captured"
    );
    // Step 2: the spell is cast on the alive-filtered list (not the raw target
    // list), so every entry of it — including whoever this spell is about to
    // kill — takes the hit and records a delta.
    const castMatch = body.match(/\.use[A-Za-z0-9$_]*\$\(\s*attacker\s*,\s*aliveTargets\s*\)/);
    assert.ok(castMatch, "the spell must be cast on the alive-filtered list");
    assert.ok(
        castMatch.index > aliveDeclIdx,
        "the cast must happen after the isAlive filter (a target killed by this spell stays in the list)"
    );
    // Step 3: the raise animations are built from that SAME aliveTargets list,
    // with no further isAlive gate — that late gate is exactly what used to
    // hide the number of an enemy killed by the spell (dead by then).
    const aliveIterIdx = body.indexOf("aliveTargets.iterator()", castMatch.index);
    assert.ok(aliveIterIdx !== -1, "the raise animations must be built from aliveTargets");
    const addAllIdx = body.indexOf("addAll", aliveIterIdx);
    assert.ok(addAllIdx !== -1, "the raise animations must be added to mRaiseAnimations");
    const animLoop = body.slice(aliveIterIdx, addAllIdx);
    assert.match(
        animLoop,
        /diffToAnimation[A-Za-z0-9$_]*\$\(\)/,
        "every entry of aliveTargets must contribute a diffToAnimation raise"
    );
    assert.doesNotMatch(
        animLoop,
        /isAlive/,
        "the per-target damage loop must not gate on isAlive (it would hide a killed enemy's damage number)"
    );
});

test("core.js: hp setter tracks the unclamped delta (real damage, not remaining HP)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "Object.defineProperty(FightingCharacter.prototype, 'hp'");
    // The setter accumulates the RAW (unclamped) delta into deltaSinceBackup
    // BEFORE clamping the stored backing field, so an overkill hit records the
    // real damage (e.g. -500 on a 100-hp enemy), not the remaining-HP delta.
    assert.match(
        body,
        /this\.deltaSinceBackup\s*=\s*this\.deltaSinceBackup\s*\+\s*\(hp\s*-\s*this\.hp[A-Za-z0-9$_]*\)\s*\|\s*0/,
        "the hp setter must accumulate the unclamped delta for display"
    );
    // The stored hp must still be clamped to [0, maxHP] (death/revive
    // correctness) — compiled as JsMath min/max (temp names vary).
    const minIdx = body.search(/JsMath\.min\(\s*[A-Za-z0-9$_]+\s*,\s*hp\s*\)/);
    assert.ok(minIdx !== -1, "the setter must clamp hp down to maxHP (JsMath.min)");
    const maxIdx = body.search(/JsMath\.max\(\s*0\s*,\s*[A-Za-z0-9$_]+\s*\)/);
    assert.ok(
        maxIdx !== -1 && maxIdx > minIdx,
        "the stored hp must still be clamped to 0 (death/revive correctness)"
    );
    // And diff() must report that accumulated delta as the displayed hp change
    // (diff.hp = deltaSinceBackup, NOT currentHp - backupHp, which is clamped).
    const diffBody = methodBody(src, "FightingCharacter.prototype.diff_6taknv$");
    assert.match(
        diffBody,
        /diff\.hp\s*=\s*this\.deltaSinceBackup\s*;/,
        "diff() must expose the accumulated unclamped delta as diff.hp"
    );
});

test("core.js: list-form MagicAttack.use callers pre-filter corpses (guardless use is safe)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    // The isAlive guard lives in the CALLERS of the list-form use: every list
    // passed to use_h32lzv$ has already had corpses stripped from it.
    // Caller 1 — ActionMagicAttackAll filters mTargets to the alive ones before
    // casting (the full filter -> cast -> raise chain is pinned above):
    const allBody = methodBody(src, "ActionMagicAttackAll.prototype.preproccess");
    assert.match(
        allBody,
        /if\s*\(\s*[A-Za-z0-9$_]+\.isAlive\s*\)[^{}]*destination\.add_11rb\$\(\s*[A-Za-z0-9$_]+\s*\)/,
        "ActionMagicAttackAll must pre-filter its target list to the alive ones before casting"
    );
    // Caller 2 — ActionCoopMagic strips dead monsters from mMonsters first:
    const coopBody = methodBody(src, "ActionCoopMagic.prototype.preproccess");
    assert.match(
        coopBody,
        /removeAll\(\s*this\.mMonsters[A-Za-z0-9$_]*\s*,\s*ActionCoopMagic\$preproccess\$lambda\s*\)/,
        "ActionCoopMagic must strip dead monsters from its target list before casting"
    );
    const coopRemoveAllIdx = coopBody.search(/removeAll\(\s*this\.mMonsters/);
    assert.ok(
        coopRemoveAllIdx !== -1 && coopRemoveAllIdx < coopBody.indexOf(".use", coopRemoveAllIdx),
        "the corpse strip must happen before coop magic casts on mMonsters"
    );
    // ...and that removeAll predicate is exactly the corpse test !isAlive:
    const lambdaBody = methodBody(src, "function ActionCoopMagic$preproccess$lambda");
    assert.match(
        lambdaBody,
        /return\s+!it\.isAlive\s*;/,
        "the removeAll predicate must be !isAlive (remove exactly the corpses)"
    );
    // With both callers pre-filtering, the list-form use itself carries no
    // per-target isAlive guard and is still safe: it never receives a
    // pre-dead combatant, so an untouched corpse keeps delta 0 and its
    // RaiseAnimation no-ops — no spurious number over a KO'd body. Only a
    // target that was alive at filter time and actually took the hit has a
    // non-zero delta, so only those raise a number.
    const useBody = methodBody(src, "MagicAttack.prototype.use_h32lzv$");
    assert.doesNotMatch(
        useBody,
        /isAlive/,
        "the list-form use must not re-gate on isAlive — the callers already excluded corpses"
    );
});
