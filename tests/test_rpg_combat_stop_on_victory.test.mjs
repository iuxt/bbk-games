import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "battle keeps going after all enemies are dead" bug in
// rpg/core.js (fmj engine, 伏魔记 et al.).
//
// HOW COMBAT WORKS
//   Each round, every alive combatant's chosen action is pushed into a queue,
//   sorted descending by speed (priority = computedSpeed). ActionExecutor.update
//   then drains that queue one action at a time, frame by frame, returning
//   `false` ONLY when the queue is empty. Combat.update (PerformAction case) is
//   the sole place that checks the victory condition `isAllMonsterDead_0`, and
//   it does so ONLY after the executor reports the queue drained:
//
//       case "PerformAction":
//         if (!this.mActionExecutor_0.update_s8cxhz$(delta)) {   // queue empty?
//           if (this.isAllMonsterDead_0) { ... -> Win }           // victory check
//           ...
//
// THE BUG
//   Because actions run in speed order, a faster combatant can kill the LAST
//   enemy mid-round. The remaining queued actions then keep being popped and
//   executed — other players' attacks, and crucially HEALING spells (which
//   target alive players, so prepareAction_0's dead-target retarget path does
//   not catch them). Only after the whole queue drains does victory trigger.
//   So the player sees skills/attacks/healing continue after the fight is won.
//
// THE FIX
//   At the two pop sites inside ActionExecutor.update_s8cxhz$, check
//   mCombat_0.isAllMonsterDead_0 BEFORE popping the next action. If every enemy
//   is dead, stop draining: the in-flight killing action (and its AwardAndPunish
//   post-action) already resolved before we reach a pop, so it finishes
//   naturally; we then cancel() every action still queued and return false so
//   Combat runs its existing victory transition.
//
// WHY cancel() AND NOT queue.clear()
//   Thrown-weapon / consumable quantities are deducted at SELECTION time
//   (deleteGoods). Their Action subclasses override cancel() to refund the good
//   (ActionThrowItem*.cancel / ActionUseItem*.cancel -> addGoods). MP, by
//   contrast, is spent at EXECUTION time (ActionMagic*:43412), which never
//   happens for an action we stop before running; magic/attack cancel() is the
//   safe no-op base. So draining with cancel() refunds items correctly, while a
//   plain clear() would silently delete already-paid-for items — a regression.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: why we cancel() remaining actions instead of clearing ---

function makeItemAction(goods, bag) {
    // Models ActionThrowItem*/ActionUseItem*: good deducted at selection; cancel() refunds it.
    return {
        kind: "item",
        refunded: false,
        cancel() {
            bag.add(goods);
            this.refunded = true;
        },
    };
}

function makeAttackAction() {
    // Models normal attack / magic: nothing deducted at selection; cancel() is a no-op.
    return {
        kind: "attack",
        refunded: false,
        cancel() {
            this.refunded = true; // base no-op (no goods to return)
        },
    };
}

test("mechanism: a naive queue clear LOSES the item already deducted at selection", () => {
    const bag = { count: 0, add(n) { this.count += n; } };
    const queue = [makeAttackAction(), makeItemAction(1, bag)];
    // The item action's good was deducted when the player picked it (count 1 -> 0).
    // Naive "battle is over, drop the queue" never calls cancel():
    queue.length = 0;
    assert.equal(bag.count, 0, "naive clear loses the already-paid-for item");
});

test("mechanism: draining with cancel() REFUNDS items but costs nothing for attacks/magic", () => {
    const bag = { count: 0, add(n) { this.count += n; } };
    const queue = [makeAttackAction(), makeAttackAction(), makeItemAction(1, bag)];
    // Fixed path: pop every remaining action and cancel() it (mirrors cancelRemainingActions_0).
    let a;
    while ((a = queue.pop()) != null) {
        a.cancel();
    }
    assert.equal(bag.count, 1, "the deducted item is refunded via cancel()");
    assert.equal(queue.length, 0, "queue is fully drained");
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract a prototype-method body by brace matching, so the pins survive
// minification-friendly formatting and don't cross into neighboring functions.
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

test("core.js: ActionExecutor.update_s8cxhz$ stops when all monsters are dead", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "ActionExecutor.prototype.update_s8cxhz$");
    // The drain loop must consult the victory condition before popping the next action.
    assert.match(
        body,
        /isAllMonsterDead_0/,
        "ActionExecutor.update must check isAllMonsterDead_0 before popping the next action"
    );
    // And it must return false (signal Combat to evaluate victory) on that path.
    assert.match(
        body,
        /isAllMonsterDead_0[^}]*return\s+false/,
        "when all monsters are dead the executor must return false so Combat transitions to Win"
    );
});

test("core.js: remaining actions are cancel()'d (refunds items), not silently dropped", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "ActionExecutor.prototype.update_s8cxhz$");
    assert.match(
        body,
        /cancelRemainingActions_0/,
        "the stop path must drain remaining actions via cancelRemainingActions_0"
    );
    assert.match(
        src,
        /ActionExecutor\.prototype\.cancelRemainingActions_0\s*=\s*function/,
        "cancelRemainingActions_0 must be defined on ActionExecutor.prototype"
    );
    // The helper must actually call cancel() on each popped action (the refund).
    const helper = methodBody(src, "ActionExecutor.prototype.cancelRemainingActions_0");
    assert.match(helper, /\.cancel\(\)/, "cancelRemainingActions_0 must call cancel() per action");
});
