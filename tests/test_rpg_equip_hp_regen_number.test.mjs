import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "an ornament that recovers 生命 (HP) each turn floats
// '+N' even when the character is already at full HP" in rpg/core.js
// (fmj engine, 伏魔记 et al.) — AwardAndPunishPostAction (~core.js:44505).
//
// This is the HP-side sibling of the MP bug fixed earlier
// (tests/test_rpg_equip_mp_recover_number.test.mjs, commit 8e80ea1), which
// fixed the same code block for 真气 only.
//
// HOW THE PER-TURN EQUIPMENT EFFECT WORKS
//   AwardAndPunishPostAction is the per-round post-action. For each living
//   Player wearing decorations it calls backupStatus() (snapshots hp/mp),
//   applies GoodsDecorations.affect() (hp += mHp_0, mp += mMp_0), then pushes
//   a floating number built from the diff.
//
// THE BUG
//   The MP float was fixed to use the *actual* (clamped) gain
//   (`attacker.mp - backup.mp`), but the HP float still comes from
//   `diffToAnimation()`, whose Diff.hp is `deltaSinceBackup` — the UNCLAMPED
//   delta tracked by the hp setter. A full-HP character therefore floats the
//   ornament's nominal "+N" every round despite gaining nothing, and a
//   near-full one floats more than was actually restored. Same display rule
//   violation as 6ac171d (group heal overheal number).
//
// THE FIX
//   Compute the HP delta from the live hp minus the backup snapshot
//   (`attacker.hp - attacker.backup.hp`), and only float a RaiseAnimation
//   when it is non-zero — exactly mirroring the MP branch below it.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the per-turn regen display ---

function makeFighter(maxHP, hp, maxMP, mp) {
    return { maxHP, hpStored: hp, maxMP, mpStored: mp, backup: { hp, mp }, deltaSinceBackup: 0 };
}

// Mirrors the hp setter: stores the clamped value but feeds the *unclamped*
// write delta into deltaSinceBackup (that display tracking is engine-wide and
// deliberately kept for real damage numbers — see d7e8777).
function setHp(ch, hp) {
    ch.deltaSinceBackup += hp - ch.hpStored;
    ch.hpStored = Math.max(0, Math.min(ch.maxHP, hp));
}

function backupStatus(ch) {
    ch.backup.hp = ch.hpStored;
    ch.backup.mp = ch.mpStored;
    ch.deltaSinceBackup = 0;
}

// Mirrors GoodsDecorations.affect().
function affect(ch, hpGain, mpGain) {
    setHp(ch, ch.hpStored + hpGain);
    ch.mpStored = Math.min(ch.maxMP, ch.mpStored + mpGain);
}

// THE BUGGY DISPLAY PATH: diffToAnimation() floats deltaSinceBackup (unclamped).
function buggyHpFloat(ch) {
    return ch.deltaSinceBackup;
}

// THE FIXED DISPLAY PATH: float the actual (clamped) gain only.
function fixedHpFloat(ch) {
    return (ch.hpStored - ch.backup.hp) | 0;
}

test("mechanism (buggy): a full-HP character still floats the nominal regen", () => {
    const f = makeFighter(300, 300, 100, 100);
    backupStatus(f);
    affect(f, 25, 0); // +25/turn HP ornament, already at full HP
    assert.equal(f.hpStored, 300, "nothing was actually gained (capped)");
    assert.equal(buggyHpFloat(f), 25, "BUG: diffToAnimation floats the unclamped +25");
});

test("mechanism (fixed): a full-HP character floats nothing", () => {
    const f = makeFighter(300, 300, 100, 100);
    backupStatus(f);
    affect(f, 25, 0);
    assert.equal(f.hpStored, 300);
    assert.equal(fixedHpFloat(f), 0, "no gain -> no number");
});

test("mechanism (fixed): a near-full character floats only what was restored", () => {
    const f = makeFighter(300, 290, 100, 100); // 10 below cap
    backupStatus(f);
    affect(f, 25, 0); // 25-point regen, only 10 fits
    assert.equal(f.hpStored, 300);
    assert.equal(fixedHpFloat(f), 10, "floats the 10 actually gained, not the 25 ornament amount");
});

test("mechanism (fixed): a damaged character still floats the full regen", () => {
    const f = makeFighter(300, 100, 100, 100);
    backupStatus(f);
    affect(f, 25, 0);
    assert.equal(fixedHpFloat(f), 25, "unclamped path: full 25 gained, floats 25");
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

test("core.js: AwardAndPunishPostAction floats the CLAMPED HP gain from the backup snapshot", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "function AwardAndPunishPostAction(");
    // The ornament branch must compute the hp delta from the live hp minus the
    // backup snapshot (clamped real gain)…
    assert.match(
        body,
        /attacker\.hp - attacker\.backup_2mheeg\$_0\.hp/,
        "the HP float must use hp - backup.hp (actual clamped gain), like the MP branch"
    );
    // …and gate the RaiseAnimation on a non-zero delta (full HP -> no number).
    assert.match(
        body,
        /hpDelta !== 0[\s\S]{0,200}new RaiseAnimation\(/,
        "a RaiseAnimation for HP must only be pushed when hpDelta !== 0"
    );
});
