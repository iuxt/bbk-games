import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "the same ornament can be worn in BOTH decoration slots
// (doubling its stat bonuses)" in rpg/core.js (fmj engine, 伏魔记 et al.) —
// Player.hasEquipt_vux9f0$ (~core.js:40976).
//
// THE BUG
//   Equipment slots: equipmentsArray[0..1] are both 装饰 (type 6), [2..7] are
//   weapon/armor slots. hasEquipt(type, id) guards the "已装备!" checks in the
//   goods/equip screens. Its type-6 branch compiled to a loop whose body
//   returns unconditionally on the FIRST iteration, so slot 1 is never
//   examined (and the trailing `return true` is dead code — and wrong anyway):
//
//       for (tmp$_0 = 0; tmp$_0 !== $receiver.length; ++tmp$_0) {
//         var element = $receiver[tmp$_0];
//         return (tmp$_1 = element != null ? element.type === type && ... : null) != null ? tmp$_1 : false;
//       }
//       return true;   // dead
//
//   With the ornament in slot 1 (or slot 0 empty), hasEquipt returns false,
//   the "已装备!" guards at ~45853/45900/46824/46871 pass, and the player can
//   equip a second copy of the same ornament into the other slot. This became
//   meaningful once c9282f5 made equipment bonuses uncapped/reversible.
//
// THE FIX
//   Return true if EITHER decoration slot matches; return false otherwise
//   (the dead `return true` was also semantically inverted).

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the two-slot lookup ---

function makeActor(slots) {
    // slots: array of 8, [0] and [1] are decorations
    return { equipmentsArray: slots };
}

const ornamentX = { type: 6, index: 3 };
const ornamentY = { type: 6, index: 7 };

// Mirrors the BUGGY hasEquipt: only the first slot is inspected.
function hasEquiptBuggy(actor, type, id) {
    if (type === 6) {
        const element = actor.equipmentsArray[0];
        return (element != null ? element.type === type && element.index === id : null) != null
            ? element.type === type && element.index === id
            : false;
    }
    for (let i = 2; i <= 7; i++) {
        const e = actor.equipmentsArray[i];
        if (e != null && e.type === type && e.index === id) return true;
    }
    return false;
}

// Mirrors the FIXED hasEquipt: both decoration slots are inspected.
function hasEquiptFixed(actor, type, id) {
    if (type === 6) {
        for (const element of [actor.equipmentsArray[0], actor.equipmentsArray[1]]) {
            if (element != null && element.type === type && element.index === id) return true;
        }
        return false;
    }
    for (let i = 2; i <= 7; i++) {
        const e = actor.equipmentsArray[i];
        if (e != null && e.type === type && e.index === id) return true;
    }
    return false;
}

test("mechanism (buggy): an ornament in slot 1 is reported as not equipped", () => {
    const actor = makeActor([null, ornamentX, null, null, null, null, null, null]);
    assert.equal(hasEquiptBuggy(actor, 6, 3), false, "slot 1 never inspected -> guard passes -> double-wear");
});

test("mechanism (fixed): an ornament in EITHER slot is reported as equipped", () => {
    const inSlot0 = makeActor([ornamentX, null, null, null, null, null, null, null]);
    const inSlot1 = makeActor([null, ornamentX, null, null, null, null, null, null]);
    const both = makeActor([ornamentX, ornamentX, null, null, null, null, null, null]);
    assert.equal(hasEquiptFixed(inSlot0, 6, 3), true, "slot 0 match");
    assert.equal(hasEquiptFixed(inSlot1, 6, 3), true, "slot 1 match");
    assert.equal(hasEquiptFixed(both, 6, 3), true);
});

test("mechanism (fixed): a different ornament in the other slot is NOT a match", () => {
    const actor = makeActor([ornamentY, null, null, null, null, null, null, null]);
    assert.equal(hasEquiptFixed(actor, 6, 3), false, "wearing Y doesn't block wearing X");
});

test("mechanism: non-decoration slots behave the same before and after", () => {
    const sword = { type: 1, index: 2 };
    const actor = makeActor([null, null, sword, null, null, null, null, null]);
    assert.equal(hasEquiptBuggy(actor, 1, 2), true);
    assert.equal(hasEquiptFixed(actor, 1, 2), true);
    assert.equal(hasEquiptFixed(actor, 1, 9), false);
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

test("core.js: hasEquipt inspects BOTH decoration slots", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "Player.prototype.hasEquipt_vux9f0$");
    // The loop body must not return unconditionally on the first element…
    assert.doesNotMatch(
        body,
        /return \(tmp\$_1 = element != null \? element\.type === type && element\.index === id : null\) != null \? tmp\$_1 : false;/,
        "the per-slot check must not `return` unconditionally inside the loop (slot 1 never inspected)"
    );
    // …a match inside the loop must return true…
    assert.match(
        body,
        /\{\s*return true;\s*\}/,
        "a matching decoration slot must return true"
    );
    // …and the type-6 fallthrough must be false, not the inverted dead `return true`.
    assert.match(
        body,
        /return false;/,
        "no match in either decoration slot must return false"
    );
});
