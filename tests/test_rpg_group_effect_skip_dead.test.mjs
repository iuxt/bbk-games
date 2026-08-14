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
//   Skip non-alive targets in the eat loop / attack loop (and in the medicine
//   animation loop, mirroring ActionMagicHelpAll's `if (item.isAlive)` guard).

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

test("core.js: ActionUseItemAll skips dead targets in the eat loop", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "ActionUseItemAll.prototype.preproccess");
    // The eat loop must guard on isAlive before calling eat (f2e4eec family).
    assert.match(
        body,
        /if \(element_0\.isAlive\) \{\s*this\.goods_8be2vx\$\.eat_xa4yhy\$/,
        "eat() must only run for living targets — ordinary medicine must not revive"
    );
    // And the raise-animation loop must skip corpses (mirrors ActionMagicHelpAll).
    assert.match(
        body,
        /if \(item\.isAlive\) \{\s*destination\.add_11rb\$/,
        "no raise animation over a KO'd ally"
    );
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
