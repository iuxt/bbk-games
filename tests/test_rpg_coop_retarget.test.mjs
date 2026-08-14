import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "a coop-magic (合击) action whose target dies before it
// executes throws a ClassCastException and crashes the game" in rpg/core.js
// (fmj engine, 伏魔记 et al.) — ActionExecutor.prepareAction_0 (~core.js:41604).
//
// THE BUG
//   When an action's target died mid-round, prepareAction_0 redirects it to
//   another living monster:
//
//       } else if (!isType(this.mCurrentAction_0, ActionFlee)) {
//         (isType(tmp$_0 = this.mCurrentAction_0, ActionSingleTarget) ? tmp$_0 : throwCCE())
//             .setTarget_qpjxya$(newTarget);
//       }
//
//   ActionCoopMagic sets `isSingleTarget = true` (so it takes this branch) but
//   its $metadata$.interfaces is [Action] only — it is NOT an
//   ActionSingleTarget subclass and has no setTarget. `throwCCE()` fires and
//   the exception escapes the update loop.
//
//   Trigger: queue 合击 on monster A; before the (defend-priority, slow) coop
//   action runs, a faster ally kills A while monster B still lives ->
//   newTarget = B != null -> cast fails -> crash. (When ALL monsters are dead
//   the b30469e early-exit saves it; the crash needs exactly "target dead,
//   another alive". The 41588 revive exemption covers ActionMagicHelpOne only.)
//
// THE FIX
//   Give ActionCoopMagic its own branch BEFORE the cast: its targets live in
//   mMonsters_0, and the mMonster_0 property setter replaces the whole list
//   (`this.mCurrentAction_0.mMonster_0 = newTarget`), which is exactly the
//   retarget coop magic needs. targetIsMonster() is true for coop actions, so
//   newTarget is a Monster from firstAliveMonster.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the redirect dispatch ---

function makeAction(name, base) {
    // Simulates the prototype chain via an `instOf` marker set.
    const a = { kind: name, instOf: new Set([name, ...(base || [])]) };
    return a;
}

function throwCCE() {
    throw new Error("ClassCastException: ActionCoopMagic cannot be cast to ActionSingleTarget");
}

// Mirrors the BUGGY dispatch: unconditional ActionSingleTarget cast.
function redirectBuggy(action, newTarget) {
    if (action.instOf.has("ActionFlee")) return;
    (action.instOf.has("ActionSingleTarget") ? action : throwCCE()).setTarget(newTarget);
}

// Mirrors the FIXED dispatch: coop gets its own property-assignment branch.
function redirectFixed(action, newTarget) {
    if (action.instOf.has("ActionCoopMagic")) {
        // mMonster_0 setter: mMonsters_0 = mutableListOf([value])
        action.mMonsters = [newTarget];
        return;
    }
    if (action.instOf.has("ActionFlee")) return;
    (action.instOf.has("ActionSingleTarget") ? action : throwCCE()).setTarget(newTarget);
}

test("mechanism (buggy): redirecting a coop action throws ClassCastException", () => {
    const coop = makeAction("ActionCoopMagic", ["Action"]); // isSingleTarget=true, NOT ActionSingleTarget
    coop.isSingleTarget = true;
    assert.throws(
        () => redirectBuggy(coop, { name: "monsterB", isAlive: true }),
        /ClassCastException/,
        "the unguarded cast crashes when the coop target died but another monster lives"
    );
});

test("mechanism (fixed): redirecting a coop action retargets via the mMonster_0 setter", () => {
    const coop = makeAction("ActionCoopMagic", ["Action"]);
    coop.mMonsters = [{ name: "monsterA", isAlive: false }];
    const monsterB = { name: "monsterB", isAlive: true };
    redirectFixed(coop, monsterB);
    assert.deepEqual(
        coop.mMonsters,
        [monsterB],
        "the monster list is replaced with the new living target"
    );
});

test("mechanism (fixed): regular single-target actions still use setTarget", () => {
    const one = makeAction("ActionThrowItemOne", ["ActionSingleTarget", "Action"]);
    let got = null;
    one.setTarget = (t) => {
        got = t;
    };
    const monsterB = { name: "monsterB" };
    redirectFixed(one, monsterB);
    assert.equal(got, monsterB, "unaffected path");
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

test("core.js: prepareAction_0 retargets coop magic via mMonster_0, not a setTarget cast", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "ActionExecutor.prototype.prepareAction_0");
    assert.match(
        body,
        /isType\(this\.mCurrentAction_0, ActionCoopMagic\)\) \{[\s\S]*?this\.mCurrentAction_0\.mMonster_0 = newTarget;/,
        "coop magic must be redirected by assigning mMonster_0 (its property setter replaces the monster list)"
    );
    // And the coop branch must come before / instead of reaching the cast for coop.
    const coopIdx = body.indexOf("ActionCoopMagic");
    const castIdx = body.indexOf("ActionSingleTarget) ? tmp$_0 : throwCCE()");
    assert.ok(coopIdx !== -1 && castIdx !== -1, "both branches present");
    assert.ok(
        coopIdx < castIdx,
        "the coop exemption must be checked before the ActionSingleTarget cast"
    );
});
