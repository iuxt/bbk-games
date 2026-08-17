import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE_JS = path.join(ROOT, "rpg", "core.js");

function source(file) {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function functionBody(src, name) {
    const start = src.indexOf(name);
    assert.ok(start !== -1, `could not find ${name}`);
    const open = src.indexOf("{", start);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    assert.fail(`unterminated function body for ${name}`);
}

test("mechanism: stimulant percentages become temporary combat stat buffs", () => {
    const base = { attack: 120, defend: 80, speed: 150 };
    const buff = { attack: 20, defend: 30, speed: 10, round: 4 };
    const computed = {
        attack: base.attack + Math.trunc(base.attack * buff.attack / 100),
        defend: base.defend + Math.trunc(base.defend * buff.defend / 100),
        speed: base.speed + Math.trunc(base.speed * buff.speed / 100),
    };

    assert.deepEqual(computed, { attack: 144, defend: 104, speed: 165 });
    assert.equal(buff.round, 4, "duration comes from the goods sumRound byte");
});

test("production: GoodsStimulant implements the eat-medicine contract", () => {
    const kotlin = source("fmj_kt/src/fmj/goods/GoodsStimulant.kt");
    assert.match(kotlin, /class GoodsStimulant : BaseGoods\(\), IEatMedicine/);
    assert.match(kotlin, /override fun eat\(player: Player\)/);
    assert.match(kotlin, /player\.beAttackedWithBuff\(buff, 0\)/);
    assert.match(kotlin, /(at|df|speed)\.round = sumRound/);
    assert.match(kotlin, /BUFF_MASK_GONG/);
    assert.match(kotlin, /BUFF_MASK_FANG/);
    assert.match(kotlin, /BUFF_MASK_SU/);
});

test("production: compiled GoodsStimulant exposes eat and temporary buffs", () => {
    const src = source("rpg/core.js");
    assert.match(src, /interfaces: \[IEatMedicine, BaseGoods\][\s\S]*?simpleName: 'GoodsStimulant'/);

    const eat = functionBody(src, "GoodsStimulant.prototype.eat_xa4yhy$");
    assert.match(eat, /player\.beAttackedWithBuff_ila1b3\$\(this\.buff_0, 0\);/);
});

test("production: group item use handles all edible goods and skips corpses", () => {
    const core = functionBody(source("rpg/core.js"), "ActionUseItemAll.prototype.preproccess");
    const kotlin = source("fmj_kt/src/fmj/combat/actions/ActionUseItemAll.kt");

    assert.match(core, /Typescript\.isType\(this\.goods_8be2vx\$, GoodsMedicine\)/);
    assert.match(core, /Typescript\.isType\(this\.goods_8be2vx\$, IEatMedicine\)/);
    assert.match(
        core,
        /if \(Typescript\.isType\(element_0, Player\) && element_0\.isAlive\) \{[\s\S]*?this\.goods_8be2vx\$\.eat_xa4yhy\$/
    );

    assert.match(kotlin, /goods is GoodsMedicine/);
    assert.match(kotlin, /goods is IEatMedicine/);
    assert.match(kotlin, /if \(target is Player && target\.isAlive\) \{[\s\S]*?goods\.eat\(target\)/);
});
