import test from "node:test";
import assert from "node:assert/strict";

// Regression test for the shop sell-screen (OperateSale$SaleGoodsScreen) money
// bug in rpg/core.js (onKeyDown_za3lpa$, ~core.js:50512).
//
// While picking how many of an item to sell, the projected money (money_0) was
// updated incrementally: +sellPrice on KEY_DOWN, -sellPrice on KEY_UP, with a
// one-sided `if (money_0 > 99999) money_0 = 99999` clamp on the increase only.
// Once money reached the 99999 cap, further increases kept it pinned there (the
// overflow was discarded), but each decrease subtracted the FULL sellPrice from
// the already-clamped value — so money_0 diverged from sMoney + saleCnt*sellPrice
// and could be driven negative. Pressing ENTER then wrote that negative value
// into real money (sMoney = money_0, ~core.js:50498).
//
// The fix recomputes money_0 as a pure function of saleCnt on every key press:
//   money = clamp(sMoney + saleCnt*sellPrice, sMoney, 99999)
// so it can never diverge or go negative, and entering the screen with
// sMoney > 99999 no longer trims gold on confirm.
//
// Per the project's established pattern (see test_rpg_text_wrap.test.mjs), the
// old and new algorithms are mirrored here rather than loading core.js, which is
// a 2.9MB browser-bound bundle.

const CAP = 99999;

// Models SaleGoodsScreen state while the quantity picker is open.
// `base` = Player.sMoney, immutable for the lifetime of the screen.
function makeState(base, sellPrice, goodsNum) {
    return { base, sellPrice, goodsNum, saleCnt: 0, money: base };
}

// OLD buggy logic — mirrors the original incremental onKeyDown: ±sellPrice per
// step with a high clamp on the increase branch only.
function oldKey(state, key) {
    if (key === "UP" && state.saleCnt > 0) {
        state.saleCnt -= 1;
        state.money -= state.sellPrice;
    } else if (key === "DOWN" && state.goodsNum > state.saleCnt) {
        state.saleCnt += 1;
        state.money += state.sellPrice;
        if (state.money > CAP) state.money = CAP;
    }
}

// NEW fixed logic — money_0 is a pure function of saleCnt, clamped to [base, CAP].
function newKey(state, key) {
    if (key === "UP" && state.saleCnt > 0) {
        state.saleCnt -= 1;
    } else if (key === "DOWN" && state.goodsNum > state.saleCnt) {
        state.saleCnt += 1;
    } else {
        return;
    }
    const m = state.base + state.saleCnt * state.sellPrice;
    state.money = Math.max(state.base, Math.min(m, CAP));
}

test("OLD: overshoot the cap then decrease back to 0 -> money goes negative (documents bug)", () => {
    const s = makeState(90000, 20000, 10); // base 90000, sellPrice 20000, own 10
    for (let i = 0; i < 5; i++) oldKey(s, "DOWN"); // saleCnt 5, money pinned at CAP
    for (let i = 0; i < 5; i++) oldKey(s, "UP");   // saleCnt 0
    assert.equal(s.saleCnt, 0);
    assert.ok(s.money < 0, `expected negative money, got ${s.money}`);
});

test("NEW: same scenario -> never negative, returns to base at saleCnt 0", () => {
    const s = makeState(90000, 20000, 10);
    for (let i = 0; i < 5; i++) newKey(s, "DOWN");
    for (let i = 0; i < 5; i++) newKey(s, "UP");
    assert.equal(s.saleCnt, 0);
    assert.equal(s.money, 90000);
});

test("NEW: selling past the cap still clamps at 99999 (cap intent preserved)", () => {
    const s = makeState(99000, 1000, 200);
    for (let i = 0; i < 50; i++) newKey(s, "DOWN"); // 99000 + 50000 -> CAP
    assert.equal(s.money, CAP);
});

test("NEW: toggling up/down around the cap never diverges", () => {
    const s = makeState(99000, 1000, 200);
    for (let i = 0; i < 30; i++) newKey(s, "DOWN");
    for (let i = 0; i < 30; i++) newKey(s, "UP");
    assert.equal(s.saleCnt, 0);
    assert.equal(s.money, 99000);
});

test("NEW: entering with sMoney > CAP does not trim gold (no confirm regression)", () => {
    const s = makeState(150000, 1000, 50);
    newKey(s, "DOWN");
    newKey(s, "DOWN");
    newKey(s, "UP");
    newKey(s, "UP");
    assert.equal(s.saleCnt, 0);
    assert.equal(s.money, 150000); // unchanged — confirm would not lose gold
});
