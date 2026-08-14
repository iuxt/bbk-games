import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "buying the same (not-yet-owned) item twice during one
// shop visit debits the money a second time but delivers nothing" in
// rpg/core.js (fmj engine, 伏魔记 et al.) — OperateBuy$BuyGoodsScreen
// (~core.js:50530).
//
// HOW BUYING WORKS
//   OperateBuy's ctor builds the shop list ONCE per visit: each item is the
//   player's live bag entry if owned, else a fresh goodsNum=0 object. UP bumps
//   buyCnt AND goods.addGoodsNum(1) and debits money_0; ENTER commits the
//   money and — only when `buyCnt === goods.goodsNum && buyCnt > 0` — merges
//   buyCnt copies into the bag (GoodsManage.addGoods_0 increments an existing
//   entry or creates one).
//
//   The two paths both work the FIRST time:
//     owned:  UPs mutate the bag entry directly; ENTER's equality check fails
//             (N+j !== j) so addGoods is (correctly) skipped.
//     fresh:  goodsNum goes 0 -> j; ENTER sees j === j and calls addGoods.
//
// THE BUG
//   After a completed fresh-path purchase the shop object KEEPS goodsNum = j
//   (init resets buyCnt but not goodsNum, and the object never syncs with the
//   now-existing bag entry). Selecting the same item again in the same visit:
//   UP×m makes goodsNum = j+m while buyCnt = m and money is debited; ENTER's
//   check m === j+m fails -> addGoods skipped -> money committed (line 50545)
//   with zero items delivered. Re-entering the shop rebuilds the list via
//   getGoods (now finding the bag entry), which masks the bug in casual play.
//
// THE FIX
//   In init, zero the stale count when the goods object is NOT the live bag
//   entry (`getGoods(type, index) !== goods`). Every purchase of an unowned
//   item then walks the first-purchase path; addGoods merges into the
//   now-existing bag entry, so quantities stay exact.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the buy screen state machine ---

function makeShop() {
    const s = { money: 1000, bag: new Map() }; // "type:index" -> { goodsNum }
    s.sGoodsList = {
        getGoods(type, index) {
            return s.bag.get(`${type}:${index}`) || null;
        },
        addGoods(type, index, num) {
            const key = `${type}:${index}`;
            const entry = s.bag.get(key);
            if (entry) entry.goodsNum += num; // GoodsManage.addGoods_0 merge
            else s.bag.set(key, { goodsNum: num, type, index });
        },
    };
    return s;
}

// All state-machine helpers take the shop explicitly (no shared mutable state).
function initBuggy(screen, goods, shop) {
    screen.goods = goods;
    screen.buyCnt = 0;
    screen.money = shop.money;
}

function initFixed(screen, goods, shop) {
    screen.goods = goods;
    if (shop.sGoodsList.getGoods(goods.type, goods.index) !== goods) {
        goods.goodsNum = 0;
    }
    screen.buyCnt = 0;
    screen.money = shop.money;
}

function pressUp(screen, price) {
    if (screen.goods.goodsNum < 99 && screen.money >= price) {
        screen.buyCnt += 1;
        screen.goods.goodsNum += 1; // addGoodsNum(1)
        screen.money -= price;
    }
}

function pressEnter(screen, shop) {
    shop.money = screen.money; // commit money FIRST — the crux of the bug
    if (screen.buyCnt === screen.goods.goodsNum && screen.buyCnt > 0) {
        shop.sGoodsList.addGoods(screen.goods.type, screen.goods.index, screen.buyCnt);
    }
}

function buyTwice(init, price) {
    const shop = makeShop();
    const fresh = { type: 9, index: 5, goodsNum: 0 }; // the shop list object
    const screen = {};
    // first purchase: 2 金创药
    init(screen, fresh, shop);
    pressUp(screen, price);
    pressUp(screen, price);
    pressEnter(screen, shop);
    // second purchase, same visit, same list object: 1 more
    init(screen, fresh, shop);
    pressUp(screen, price);
    pressEnter(screen, shop);
    return { money: shop.money, bagNum: shop.bag.get("9:5")?.goodsNum || 0 };
}

test("mechanism (buggy): second purchase of the same item loses the money", () => {
    const r = buyTwice(initBuggy, 100);
    assert.equal(r.bagNum, 2, "only the first purchase delivered");
    assert.equal(r.money, 1000 - 300, "but ALL three purchases were paid");
});

test("mechanism (fixed): second purchase delivers and money matches", () => {
    const r = buyTwice(initFixed, 100);
    assert.equal(r.bagNum, 3, "all purchased items are in the bag");
    assert.equal(r.money, 1000 - 300);
});

test("mechanism (fixed): owned-item purchases (bag-entry path) are unchanged", () => {
    const shop = makeShop();
    shop.sGoodsList.addGoods(9, 5, 4); // player already owns 4
    const bagEntry = shop.sGoodsList.getGoods(9, 5);
    const screen = {};
    initFixed(screen, bagEntry, shop);
    pressUp(screen, 100);
    pressUp(screen, 100);
    pressEnter(screen, shop);
    assert.equal(bagEntry.goodsNum, 6, "bag entry incremented directly by the UPs");
    assert.equal(shop.money, 800);
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

test("core.js: BuyGoodsScreen.init zeroes the stale count of non-bag shop objects", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "OperateBuy$BuyGoodsScreen.prototype.init_6xxg66$");
    assert.match(
        body,
        /getGoods_vux9f0\$\(goods\.type, goods\.index\) !== goods/,
        "init must detect that the shop object is not the live bag entry"
    );
    assert.match(
        body,
        /goods\.goodsNum = 0;/,
        "init must reset the stale goodsNum so the next purchase walks the first-purchase path"
    );
});
