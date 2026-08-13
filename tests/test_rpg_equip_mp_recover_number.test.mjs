import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "equipping an ornament that recovers 真气 (MP) each turn
// does restore MP, but no '+N' floats above the character" in rpg/core.js
// (fmj engine, 伏魔记 et al.).
//
// HOW THE PER-TURN EQUIPMENT EFFECT WORKS
//   AwardAndPunishPostAction is the per-round post-action. For each living
//   Player it calls backupStatus() (snapshots hp/mp, resets the HP display
//   delta), then GoodsDecorations.affect() does:
//       fighter.hp = fighter.hp + mHp_0
//       fighter.mp = fighter.mp + mMp_0
//   and finally pushes attacker.diffToAnimation() onto its animation list.
//
// THE BUG
//   diffToAnimation() -> diff() computes BOTH deltas:
//       diff.mp = this.mp - this.backup.mp
//       diff.hp = this.deltaSinceBackup
//   but diff.toAnimation() builds `new RaiseAnimation(x, y, this.hp, buff)` —
//   it passes only this.hp and DISCARDS this.mp. RaiseAnimation shows a number
//   iff its hitpoint is non-zero, so an MP-only recovery (mMp_0>0, mHp_0=0)
//   passes hitpoint=0 and floats nothing, even though MP was restored.
//
// THE FIX
//   In AwardAndPunishPostAction, after the existing HP animation, also push an
//   MP RaiseAnimation when MP changed. The MP setter clamps to maxMP, so
//   `attacker.mp - backup.mp` is the *actual* (clamped) gain — a full-MP
//   character shows nothing, a near-full one shows only what was restored —
//   matching the "show real gain, not full amount" rule from 6ac171d.
//
// We can't run the 2.9MB browser bundle in Node, so — per the project's
// established pattern (test_rpg_group_heal_overheal_number) — we (a) model the
// relevant mechanics in plain JS and (b) pin the production source with
// structural assertions.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model mp setter + per-turn effect in isolation ---

function makeFighter(maxMP, mp) {
    return { maxMP, mpStored: mp, backup: { mp } };
}

// Mirrors FightingCharacter mp setter (rpg/core.js ~40111): clamp to [., maxMP]
// (upper clamp only, like the engine). No display-delta bookkeeping for mp —
// that is the crux of the bug.
function setMp(ch, mp) {
    ch.mpStored = Math.min(ch.maxMP, mp);
}

// Mirrors backupStatus(): snapshot mp.
function backupStatus(ch) {
    ch.backup.mp = ch.mpStored;
}

// Mirrors GoodsDecorations.affect(): add the per-turn hp/mp recovery.
function affect(ch, hpGain, mpGain) {
    // hp side is irrelevant to this bug; modelled only for completeness.
    setMp(ch, ch.mpStored + mpGain);
}

// Mirrors RaiseAnimation ctor: a number floats iff the hitpoint is non-zero.
function showsNumber(hitpoint) {
    return hitpoint !== 0;
}

// THE BUGGY DISPLAY PATH: diffToAnimation() reads only the HP delta.
function buggyHpDelta(ch) {
    // hp delta would be deltaSinceBackup; for an MP-only ornament it is 0.
    return 0;
}

// THE FIXED DISPLAY PATH: also expose the mp delta (mp - backup.mp).
function fixedMpDelta(ch) {
    return (ch.mpStored - ch.backup.mp) | 0;
}

test("mechanism (buggy): an MP-only ornament restores MP but floats no number", () => {
    const f = makeFighter(/*maxMP*/ 100, /*mp*/ 50);
    backupStatus(f);
    affect(f, /*hpGain*/ 0, /*mpGain*/ 30); // MP-only recovery ornament
    assert.equal(f.mpStored, 80, "MP was actually restored");
    // BUG: diffToAnimation passes only the HP delta (=0), so nothing floats.
    assert.equal(buggyHpDelta(f), 0);
    assert.equal(showsNumber(buggyHpDelta(f)), false, "MP recovery is invisible");
});

test("mechanism (fixed): the MP delta floats the real gain", () => {
    const f = makeFighter(100, 50);
    backupStatus(f);
    affect(f, 0, 30);
    assert.equal(f.mpStored, 80);
    assert.equal(fixedMpDelta(f), 30, "floats +30");
    assert.equal(showsNumber(fixedMpDelta(f)), true);
});

test("mechanism (fixed): a full-MP character floats nothing (no overheal number)", () => {
    const f = makeFighter(100, 100);
    backupStatus(f);
    affect(f, 0, 30); // already full → setter clamps to 100
    assert.equal(f.mpStored, 100, "stored mp is capped, nothing gained");
    assert.equal(fixedMpDelta(f), 0, "no gain -> no number");
    assert.equal(showsNumber(fixedMpDelta(f)), false);
});

test("mechanism (fixed): a near-full character floats only what was actually restored", () => {
    const f = makeFighter(100, 90); // 10 below cap
    backupStatus(f);
    affect(f, 0, 30); // 30-point recovery, but only 10 fits
    assert.equal(f.mpStored, 100);
    assert.equal(fixedMpDelta(f), 10, "floats the 10 actually gained, not the 30 ornament amount");
    assert.equal(showsNumber(fixedMpDelta(f)), true);
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract a function body by brace matching so the pins survive formatting
// churn and don't bleed into neighbouring functions.
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

test("core.js: AwardAndPunishPostAction floats an MP number when MP changed", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "function AwardAndPunishPostAction(");
    // The fix pushes a dedicated MP RaiseAnimation. Its hitpoint must be the
    // mp delta computed from the live mp minus the backup snapshot, so the
    // number reflects the actual (clamped) gain, not the ornament's full amount.
    assert.match(
        body,
        /backup_2mheeg\$_0\.mp/,
        "must read the backed-up mp to compute the delta"
    );
    assert.match(
        body,
        /new RaiseAnimation\(/,
        "must construct a RaiseAnimation for the MP delta (the HP one comes from diffToAnimation)"
    );
});

test("core.js: toAnimation still passes only hp (the global path is deliberately untouched)", () => {
    // We fix this narrowly in AwardAndPunishPostAction rather than globally in
    // toAnimation, to avoid changing every combat animation. Pin that the
    // generic path still ignores mp — so this test documents the chosen scope.
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "FightingCharacter$Diff.prototype.toAnimation_vux9f0$ = function");
    assert.match(
        body,
        /new RaiseAnimation\([^)]*\bthis\.hp\b/,
        "the generic diff->animation still renders only the hp delta"
    );
});
