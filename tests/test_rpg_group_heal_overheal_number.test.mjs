import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "group heal floats '+spell amount' over an ally who
// recovered far less (or nothing)" bug in rpg/core.js (fmj engine, 伏魔记 et al.).
//
// HOW THE HEAL NUMBER WORKS
//   FightingCharacter has an `hp` setter that CLAMPS the stored hp to
//   [0, maxHP]. On every write it also accumulates the UNCLAMPED delta into
//   `deltaSinceBackup`. diff_6taknv$().hp returns that accumulated delta, and
//   diffToAnimation() turns it into a RaiseAnimation floating "+N" / "-N".
//   RaiseAnimation shows a number iff the delta is non-zero (no "0" ever
//   appears). The unclamped delta is deliberate for DAMAGE — an overkill hit
//   (500 dmg on a 100-hp foe) must float "-500", the real damage.
//
// THE BUG
//   Single-target restore (ActionMagicHelpOne.preproccess) builds its floating
//   number from `target.hp - ohp` — the CLAMPED, actually-restored amount — so a
//   full-HP ally shows nothing and a near-full ally shows only the real gain.
//   But the all-target restore (ActionMagicHelpAll.preproccess) builds its
//   numbers from `diffToAnimation`, which reads the UNCLAMPED deltaSinceBackup.
//   So the same heal that correctly shows "+20" on a single target floats the
//   whole spell amount ("+200") over every ally in the group — even a full-HP
//   one, where the real gain is 0.
//
// THE FIX
//   MagicRestore.applyToTarget is the one place every restore cast flows
//   through (single, group, in-battle, menu). After writing the clamped hp,
//   overwrite the accumulated delta with the real (clamped) gain. Damage is
//   unaffected — it never goes through MagicRestore — and single-target display
//   is unaffected — ActionMagicHelpOne ignores deltaSinceBackup and reads the hp
//   diff directly.
//
// We can't instantiate the 2.9MB browser bundle in Node, so — per the project's
// established pattern (test_rpg_combat_kill_damage_number) — we (a) model the
// relevant mechanics in plain JS and (b) pin the production source with
// structural assertions.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the hp setter + restore in isolation ---

function makeCharacter(maxHP, hp) {
    return { maxHP, hpStored: hp, deltaSinceBackup: 0 };
}

// Mirrors FightingCharacter hp setter (rpg/core.js ~40094): clamp stored hp to
// [0, maxHP], but accumulate the raw delta for display.
function setHp(ch, hp) {
    const delta = (hp - ch.hpStored) | 0;
    ch.deltaSinceBackup = (ch.deltaSinceBackup + delta) | 0;
    ch.hpStored = Math.max(0, Math.min(ch.maxHP, hp));
}

// Mirrors RaiseAnimation ctor: a number floats iff the delta is non-zero.
function showsNumber(hitpoint) {
    return hitpoint !== 0;
}

test("mechanism (buggy): the raw setter delta makes a full-HP ally show the whole heal", () => {
    const full = makeCharacter(/*maxHP*/ 100, /*hp*/ 100);
    setHp(full, 100 + 200); // a 200-point group heal on a full-HP ally
    assert.equal(full.hpStored, 100, "stored hp is already capped, nothing was gained");
    // BUG: the unclamped delta is the full spell amount, so it would float "+200".
    assert.equal(full.deltaSinceBackup, 200, "unclamped delta is the spell amount, not the 0 actually gained");
    assert.equal(showsNumber(full.deltaSinceBackup), true, "a full-HP ally would wrongly float a number");
});

test("mechanism (buggy): a near-full ally shows the spell amount, not the real gain", () => {
    const nearFull = makeCharacter(100, 80); // 20 below cap
    setHp(nearFull, 80 + 200); // a 200-point heal
    assert.equal(nearFull.hpStored, 100, "stored hp caps at maxHP");
    assert.equal(nearFull.deltaSinceBackup, 200, "unclamped delta is 200");
    assert.notEqual(nearFull.deltaSinceBackup, 20, "but the real gain is only 20");
});

// Mirrors the FIXED MagicRestore.applyToTarget: after writing the clamped hp,
// overwrite the accumulated delta with the real (clamped) gain.
function applyRestoreFixed(ch, spellHp) {
    if (ch.hpStored <= 0) return; // skip the dead, like the real guard
    const currentHp = ch.hpStored | 0;
    setHp(ch, currentHp + (spellHp | 0));
    ch.deltaSinceBackup = (ch.hpStored - currentHp) | 0; // <-- the fix
}

test("mechanism (fixed): a full-HP ally shows nothing", () => {
    const full = makeCharacter(100, 100);
    applyRestoreFixed(full, 200);
    assert.equal(full.hpStored, 100);
    assert.equal(full.deltaSinceBackup, 0, "no gain → no number");
    assert.equal(showsNumber(full.deltaSinceBackup), false, "a full-HP ally floats nothing");
});

test("mechanism (fixed): a near-full ally shows only what was actually restored", () => {
    const nearFull = makeCharacter(100, 80);
    applyRestoreFixed(nearFull, 200);
    assert.equal(nearFull.hpStored, 100);
    assert.equal(nearFull.deltaSinceBackup, 20, "floats the 20 actually gained, not the 200 spell amount");
    assert.equal(showsNumber(nearFull.deltaSinceBackup), true);
});

test("mechanism (fixed): a badly-wounded ally still shows the full spell amount", () => {
    const hurt = makeCharacter(100, 10);
    applyRestoreFixed(hurt, 60); // 60 < 90 deficit, nothing wasted
    assert.equal(hurt.hpStored, 70);
    assert.equal(hurt.deltaSinceBackup, 60, "no overheal → whole spell amount shown");
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

test("core.js: MagicRestore.applyToTarget clamps the display delta to the real HP gained", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "MagicRestore.prototype.applyToTarget_qpjxya$");
    // After writing the (clamped) hp, the accumulated deltaSinceBackup must be
    // overwritten with the actually-restored amount, so an all-target restore
    // floats nothing over a full-HP ally and only the real gain over a partial
    // one — instead of the unclamped spell amount.
    assert.match(
        body,
        /deltaSinceBackup_12x06j\$_0\s*=\s*dst\.hp\s*-\s*currentHp/,
        "applyToTarget must reset deltaSinceBackup to dst.hp - currentHp (the clamped gain) after healing"
    );
});

test("core.js: single-target restore still reads the hp diff directly (unaffected by the fix)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "ActionMagicHelpOne.prototype.preproccess");
    assert.match(
        body,
        /var ohp\s*=\s*this\.mTarget\.hp;[\s\S]*?var diff\s*=\s*this\.mTarget\.hp\s*-\s*ohp/,
        "single-target restore computes its number from the clamped hp diff, not deltaSinceBackup"
    );
});
