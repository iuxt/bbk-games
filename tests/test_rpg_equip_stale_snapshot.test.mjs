import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression tests for equipment-duplication hazards via the equip screens in
// rpg/core.js (fmj engine, 伏魔记 et al.) —
// ScreenActorWearing$onKeyUp$ObjectLiteral.onItemSelected (~core.js:46130) and
// ScreenChgEquipment.onKeyUp ENTER (~core.js:46230).
//
// BUG A (directly reachable): 穿戴 (ScreenActorWearing) had NO hasEquipt guard
//   at all — every other equip path (combat ~45900/45947, field ~46893/46940)
//   blocks selecting goods the actor already wears. Since 装饰 has TWO slots
//   (equipmentsArray[0..1]), the same ornament could be worn in both, doubling
//   its stat bonuses (meaningful since c9282f5 made bonuses uncapped).
//
// BUG B (hardening): ScreenChgEquipment's ENTER ignored the deleteGoods()
//   return value and unconditionally addGoods()ed the old equipment back. If
//   the new goods is not in the bag anymore (goods list snapshot gone stale,
//   or a gut script mutating the bag mid-flow), the swap mints a copy of the
//   old equipment out of thin air. The pick list currently gets rebuilt on
//   every open, so the normal UI flow cannot trigger it today — but the
//   invariant "never credit the old equipment unless the new one was actually
//   consumed" is cheap to enforce and protects script-driven and future flows.
//
// THE FIX (two layers)
//   1. ScreenActorWearing's item-selected listener now re-validates bag
//      ownership (snapshot staleness) and rejects goods the actor already
//      wears (hasEquipt checks both decoration slots — see
//      test_rpg_has_equipt_slots.test.mjs) before opening ScreenChgEquipment.
//   2. ScreenChgEquipment's ENTER consumes the deleteGoods result: on failure
//      it rolls the swap back (takeOff the new item, put the old one back —
//      the same state restore the CANCEL key performs) instead of crediting
//      the old equipment.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the swap state machine ---

function makeWorld() {
    return {
        bag: new Map(), // key -> goods object (the authoritative inventory)
        worn: [null, null, null, null, null, null, null, null], // actor slots
        messages: [],
    };
}
const key = (g) => `${g.type}:${g.index}`;

function deleteGoods(world, goods) {
    // Mirrors GoodsManage.deleteGoods_0: false when the entry is gone.
    if (!world.bag.has(key(goods))) return false;
    const entry = world.bag.get(key(goods));
    entry.goodsNum -= 1;
    if (entry.goodsNum <= 0) world.bag.delete(key(goods));
    return true;
}
function addGoods(world, goods) {
    const entry = world.bag.get(key(goods));
    if (entry) entry.goodsNum += 1;
    else world.bag.set(key(goods), { ...goods, goodsNum: 1 });
}

// Mirrors the ScreenChgEquipment ctor: takeOff old, putOn new.
function openChgScreen(world, slot, oldEquip, newGoods) {
    const mGoods = oldEquip == null ? [newGoods] : [oldEquip, newGoods];
    if (oldEquip != null) world.worn[slot] = null;
    world.worn[slot] = newGoods;
    return { mGoods, mSelIndex: mGoods.length - 1 };
}

// Mirrors the BUGGY ENTER: deleteGoods result ignored, addGoods unconditional.
function enterBuggy(world, screen, slot) {
    const newGoods = screen.mGoods[screen.mGoods.length - 1];
    deleteGoods(world, newGoods); // return value ignored
    if (screen.mGoods.length > 1) addGoods(world, screen.mGoods[0]);
}

// Mirrors the FIXED ENTER: on deleteGoods failure roll back like CANCEL.
function enterFixed(world, screen, slot) {
    const newGoods = screen.mGoods[screen.mGoods.length - 1];
    if (deleteGoods(world, newGoods)) {
        if (screen.mGoods.length > 1) addGoods(world, screen.mGoods[0]);
        return;
    }
    // Roll back: takeOff the (stale) new goods, restore the old equipment.
    world.worn[slot] = null;
    if (screen.mGoods.length > 1) world.worn[slot] = screen.mGoods[0];
}

function bagCount(world, goods) {
    return world.bag.get(key(goods))?.goodsNum || 0;
}

// The reported exploit loop: own exactly 1 ornament X, equip it via the pick
// list, then keep re-selecting the STALE list entry (the list screen never
// refreshed, so it still offers X although the bag no longer has it).
function exploitCycles(enter, cycles) {
    const world = makeWorld();
    const X = { type: 6, index: 3, name: "夜明珠" };
    world.bag.set(key(X), { ...X, goodsNum: 1 });
    const slot = 0;
    for (let i = 0; i < cycles; i++) {
        const oldEquip = world.worn[slot];
        const screen = openChgScreen(world, slot, oldEquip, X);
        enter(world, screen, slot);
    }
    return { worn: world.worn[slot]?.name, copies: bagCount(world, X) };
}

test("mechanism (buggy): re-confirming the stale entry duplicates the ornament", () => {
    const r = exploitCycles(enterBuggy, 2);
    assert.equal(r.worn, "夜明珠", "still worn");
    assert.equal(r.copies, 1, "BUG: a copy ALSO sits in the bag — the single ornament now exists twice");
});

test("mechanism (fixed): re-confirming the stale entry rolls back, no copies minted", () => {
    const r = exploitCycles(enterFixed, 3);
    assert.equal(r.worn, "夜明珠", "rollback keeps the original equipment on");
    assert.equal(r.copies, 0, "no copy ever enters the bag");
});

test("mechanism (fixed): a legitimate swap still works", () => {
    const world = makeWorld();
    const oldSword = { type: 1, index: 1, name: "铁剑" };
    const newSword = { type: 1, index: 2, name: "玄铁剑" };
    // The old sword is WORN (not in the bag); only the new one is in the bag.
    world.bag.set(key(newSword), { ...newSword, goodsNum: 1 });
    world.worn[2] = oldSword;
    const screen = openChgScreen(world, 2, oldSword, newSword);
    enterFixed(world, screen, 2);
    assert.equal(world.worn[2].name, "玄铁剑", "new sword equipped");
    assert.equal(bagCount(world, newSword), 0, "removed from bag");
    assert.equal(bagCount(world, oldSword), 1, "old sword returned to bag");
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

test("core.js: 穿戴 item-selected re-validates bag ownership and duplicate equip", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "ScreenActorWearing$onKeyUp$ObjectLiteral.prototype.onItemSelected_6xxg66$");
    assert.match(
        body,
        /getGoodsNum_vux9f0\$\(goods\.type, goods\.index\) < 1/,
        "must verify the bag still holds the goods (the pick list is a snapshot)"
    );
    assert.match(
        body,
        /hasEquipt_vux9f0\$\(goods\.type, goods\.index\)/,
        "must block equipping an ornament already worn in either decoration slot"
    );
});

test("core.js: ScreenChgEquipment ENTER rolls back when deleteGoods fails", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "ScreenChgEquipment.prototype.onKeyUp_za3lpa$");
    // The confirm path must branch on the deleteGoods result…
    assert.match(
        body,
        /if \(Player\$Companion_getInstance\(\)\.sGoodsList\.deleteGoods_vux9f0\$\(/,
        "ENTER must consume the deleteGoods return value"
    );
    // …and the failure branch must restore the pre-swap equipment state.
    assert.match(
        body,
        /else \{[\s\S]*?takeOff_6sxnot\$[\s\S]*?putOn_sp4jd8\$/,
        "the failure branch must roll back (takeOff the new, putOn the old) like CANCEL"
    );
});
