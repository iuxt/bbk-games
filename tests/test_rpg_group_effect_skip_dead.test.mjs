import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression tests for two "group effect still lands on corpses" bugs in
// rpg/core.js (fmj engine, 伏魔记 et al.). Both are siblings of the family
// already fixed for magic in f2e4eec (MagicRestore.applyToTarget skip-dead,
// MagicAttack.use skip-dead) — the item/throw paths were missed.
//
// BUG A — group medicine revives KO'd teammates
//   ActionUseItemAll.preproccess (~core.js:44312) eats the medicine for EVERY
//   target with no isAlive check, and GoodsMedicine.eat does
//   `player.hp = player.hp + mHp` — the hp setter pushes a corpse back above
//   zero. Revival is supposed to be the 起死回生 magic line only (that is why
//   MagicRestore.applyToTarget got `if (!dst.isAlive) return;` in f2e4eec).
//   The raise-animation loop also floats "+N" over the corpse.
//
// BUG B — group thrown weapon damages corpses
//   ActionThrowItemAll.preproccess (~core.js:44068) calls
//   weapon.attack(element) for every target with no isAlive check, unlike the
//   guarded siblings ActionPhysicalAttackAll (`if (!fc.isAlive) continue;`)
//   and MagicAttack.use_h32lzv. A corpse killed earlier in the round by a
//   faster ally still takes the hit and floats a damage number.
//
// THE FIX
//   The throw path guards its attack loop (`if (element_0.isAlive)` before
//   weapon.attack). The medicine path moved the guard INTO GoodsMedicine.eat:
//   it snapshots `wasAlive = player.hp > 0` / `wasDead = player.hp <= 0` up
//   front, only writes hp/mp/debuff under wasAlive, and makes the wasDead
//   branch a pure no-op. A corpse therefore keeps hp=0 AND deltaSinceBackup=0,
//   so the raise animation built from diffToAnimation floats nothing
//   (RaiseAnimation draws its "+N" only when the diff is non-zero).

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests ---

function makePlayer(hp, maxHP) {
    return { hp, maxHP, backup: { hp }, deltaSinceBackup: 0 };
}

function backupStatus(p) {
    p.backup.hp = p.hp;
    p.deltaSinceBackup = 0;
}

// Mirrors GoodsMedicine.eat(): heals via the hp setter (clamped [0, maxHP]).
function eat(medicine, p) {
    const requested = p.hp + medicine.hp;
    p.deltaSinceBackup += requested - p.hp;
    p.hp = Math.max(0, Math.min(p.maxHP, requested));
}

// Mirrors the BUGGY ActionUseItemAll eat loop: no dead check.
function groupMedicineBuggy(targets, medicine) {
    for (const t of targets) {
        backupStatus(t);
        eat(medicine, t);
    }
}

// Mirrors the FIXED ActionUseItemAll eat loop: skip the dead.
function groupMedicineFixed(targets, medicine) {
    for (const t of targets) {
        backupStatus(t);
        if (t.hp <= 0) continue; // !isAlive
        eat(medicine, t);
    }
}

// Mirrors Throwable.attack(): hp -= affectHp via the setter.
function throwHit(weapon, target) {
    const requested = target.hp - weapon.affectHp;
    target.deltaSinceBackup += requested - target.hp;
    target.hp = Math.max(0, Math.min(target.maxHP, requested));
}

function throwAllBuggy(targets, weapon) {
    for (const t of targets) throwHit(weapon, t);
}

function throwAllFixed(targets, weapon) {
    for (const t of targets) {
        if (t.hp <= 0) continue;
        throwHit(weapon, t);
    }
}

test("mechanism (buggy): an all-target medicine brings a KO'd ally back to life", () => {
    const alive = makePlayer(80, 200);
    const corpse = makePlayer(0, 200);
    groupMedicineBuggy([alive, corpse], { hp: 100 });
    assert.equal(alive.hp, 180, "living target healed normally");
    assert.equal(corpse.hp, 100, "BUG: corpse revived by ordinary medicine");
});

test("mechanism (fixed): an all-target medicine leaves the dead dead", () => {
    const alive = makePlayer(80, 200);
    const corpse = makePlayer(0, 200);
    groupMedicineFixed([alive, corpse], { hp: 100 });
    assert.equal(alive.hp, 180);
    assert.equal(corpse.hp, 0, "KO'd ally stays KO'd (revival is 起死回生-only)");
});

test("mechanism (buggy): an all-target thrown weapon still hits a corpse killed earlier", () => {
    const monsterA = makePlayer(0, 150); // killed by a faster ally this round
    const monsterB = makePlayer(120, 150);
    throwAllBuggy([monsterA, monsterB], { affectHp: 40 });
    assert.equal(monsterB.hp, 80);
    assert.equal(monsterA.deltaSinceBackup, -40, "BUG: damage number floats over the corpse");
});

test("mechanism (fixed): an all-target thrown weapon skips the corpse", () => {
    const monsterA = makePlayer(0, 150);
    const monsterB = makePlayer(120, 150);
    throwAllFixed([monsterA, monsterB], { affectHp: 40 });
    assert.equal(monsterB.hp, 80);
    assert.equal(monsterA.deltaSinceBackup, 0, "no hit, no floating number");
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

test("core.js: GoodsMedicine.eat no-ops for the dead, so ActionUseItemAll cannot revive corpses", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "GoodsMedicine.prototype.eat_xa4yhy$");
    // The dead check lives inside GoodsMedicine.eat (f2e4eec family): living /
    // dead is snapshotted before any state is touched...
    assert.match(body, /var wasAlive = player\.hp > 0;/,
        "eat must snapshot wasAlive = player.hp > 0 before healing");
    assert.match(body, /var wasDead = player\.hp <= 0;/,
        "eat must snapshot wasDead = player.hp <= 0 before healing");
    // ...the heal write only runs under the wasAlive guard (plus mHp > 0)...
    assert.match(
        body,
        /if \(wasAlive && this\.mHp_0 > 0\) \{[^{}]*player\.hp = player\.hp \+ this\.mHp_0 \| 0;/,
        "the hp write must be guarded by wasAlive — ordinary medicine must not revive"
    );
    // ...and the wasDead branch is a pure no-op: no hp/mp/debuff writes at all,
    // so a corpse keeps hp=0 and deltaSinceBackup=0.
    const deadBranch = body.match(/else if \(wasDead\) \{([\s\S]*?)\}/);
    assert.ok(deadBranch, "eat must have a dedicated wasDead branch");
    assert.doesNotMatch(deadBranch[1], /player\s*\.\s*[\w$]+\s*=/,
        "the wasDead branch must not write any player state (no revival, no delta)");
    // Supplementary: ActionUseItemAll's eat loop routes every target through
    // this guarded GoodsMedicine.eat instead of poking hp directly.
    const loop = functionBody(src, "ActionUseItemAll.prototype.preproccess");
    assert.match(loop, /this\.goods_8be2vx\$\.eat_xa4yhy\$\(/,
        "the all-target eat loop must go through the guarded GoodsMedicine.eat");
    // With the corpse's deltaSinceBackup left at 0, the raise animation the
    // loop builds from diffToAnimation floats nothing: RaiseAnimation only
    // shows a number for a non-zero diff.
    const raise = functionBody(src, "function RaiseAnimation(");
    assert.match(raise, /this\.bShowNum_0 = hitpoint !== 0;/,
        "a zero diff must not float a number over the corpse");
});

test("core.js: ActionThrowItemAll skips dead targets in the attack loop", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "ActionThrowItemAll.prototype.preproccess");
    assert.match(
        body,
        /if \(element_0\.isAlive\) \{\s*this\.weapon_8be2vx\$\.attack_qpjxya\$/,
        "attack() must only run for living targets (ActionPhysicalAttackAll parity)"
    );
});
