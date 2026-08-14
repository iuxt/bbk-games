import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "selecting 合击 (coop magic) or 围攻 (auto-attack) after a
// teammate already queued a throw/use-item action destroys the item without
// refund" in rpg/core.js (fmj engine, 伏魔记 et al.) —
// Combat.onActionSelected_wwcj9m$ / Combat.onAutoAttack (~core.js:42321).
//
// THE BUG
//   During SelectAction each player's choice is queued; thrown weapons and
//   used goods are deducted from the bag at SELECTION time (deleteGoods in
//   CombatUI$MenuGoods). Refunds rely on Action.cancel()
//   (ActionThrowItem*/ActionUseItem*.cancel -> addGoods — the same mechanism
//   b30469e relies on via cancelRemainingActions_0). But:
//
//       Combat.onActionSelected(action) {
//         ...
//         if (isType(action, ActionCoopMagic)) {
//           this.mActionQueue_0.clear();      // <-- no cancel(): eats paid items
//           this.mActionQueue_0.add_11rb$(action);
//           go();
//         }
//       Combat.onAutoAttack() {
//         ...
//         this.mActionQueue_0.clear();        // <-- same
//
//   Trigger: player 1 selects 投掷飞刀 (item deducted, action queued); player 2
//   selects 合击 (or the last player picks 围攻) -> queue cleared -> player 1's
//   item vanishes with no effect and no refund.
//
// THE FIX
//   Drain the queue with cancel() before it is discarded: for coop keep the
//   just-queued coop action itself (it is the last element) and cancel the
//   rest; for auto-attack cancel everything (the auto queue is regenerated).

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the queue discard paths ---

function makeItemAction(goods, bag) {
    // Models ActionThrowItem*/ActionUseItem*: deducted at selection; cancel() refunds.
    return {
        kind: "item",
        cancel() {
            bag.add(goods);
        },
    };
}

function makeAttackAction() {
    // Models normal attack / magic: cancel() is a harmless no-op.
    return { kind: "attack", cancel() {} };
}

function makeQueue(items) {
    return { items: [...items] };
}

// Mirrors the BUGGY onActionSelected coop branch: clear() then re-add coop.
function coopSelectionBuggy(queue, coopAction) {
    queue.items.push(coopAction);
    queue.items.length = 0;
    queue.items.push(coopAction);
}

// Mirrors the FIXED onActionSelected coop branch: cancel everything except the
// just-queued coop action (which sits at the tail), keep it as the sole entry.
function coopSelectionFixed(queue, coopAction, bag) {
    queue.items.push(coopAction);
    while (queue.items.length > 1) {
        queue.items.shift().cancel(); // pop() drains from the front, like ArrayQueue
    }
    void bag;
}

// Mirrors the FIXED onAutoAttack: cancel-drain the whole queue.
function autoAttackFixed(queue) {
    let a;
    while ((a = queue.items.shift()) != null) {
        a.cancel();
    }
}

function makeBag() {
    return { add(goods) { this[goods] = (this[goods] || 0) + 1; } };
}

test("mechanism (buggy): coop selection clear() eats the already-paid item", () => {
    const bag = makeBag();
    const queue = makeQueue([makeAttackAction(), makeItemAction("knife", bag)]);
    coopSelectionBuggy(queue, { kind: "coop", cancel() {} });
    assert.equal(bag.knife, undefined, "the deducted 飞刀 is gone forever");
    assert.deepEqual(
        queue.items.map((a) => a.kind),
        ["coop"],
        "queue holds only the coop action"
    );
});

test("mechanism (fixed): coop selection cancels the others but keeps the coop action", () => {
    const bag = makeBag();
    const queue = makeQueue([makeAttackAction(), makeItemAction("knife", bag)]);
    coopSelectionFixed(queue, { kind: "coop", cancel() {} }, bag);
    assert.equal(bag.knife, 1, "the deducted 飞刀 is refunded via cancel()");
    assert.deepEqual(
        queue.items.map((a) => a.kind),
        ["coop"],
        "the just-selected coop action survives"
    );
});

test("mechanism (fixed): auto-attack cancels every queued action (refunds items)", () => {
    const bag = makeBag();
    const queue = makeQueue([makeAttackAction(), makeItemAction("knife", bag), makeItemAction("herb", bag)]);
    autoAttackFixed(queue);
    assert.equal(bag.knife, 1);
    assert.equal(bag.herb, 1);
    assert.equal(queue.items.length, 0, "queue fully drained");
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

test("core.js: onActionSelected coop branch cancels drained actions instead of clear()", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "Combat.prototype.onActionSelected_wwcj9m$");
    assert.match(
        body,
        /\.cancel\(\)/,
        "the coop branch must cancel() the discarded actions (refund thrown/used goods)"
    );
    assert.doesNotMatch(
        body,
        /mActionQueue_0\.clear\(\)/,
        "a bare clear() silently deletes already-paid-for items — regression"
    );
});

test("core.js: onAutoAttack cancels drained actions instead of clear()", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "Combat.prototype.onAutoAttack");
    assert.match(
        body,
        /\.cancel\(\)/,
        "onAutoAttack must cancel() the drained actions (refund thrown/used goods)"
    );
    assert.doesNotMatch(
        body,
        /mActionQueue_0\.clear\(\)/,
        "a bare clear() silently deletes already-paid-for items — regression"
    );
});
