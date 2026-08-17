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

test("mechanism: one victory can cross several level thresholds", () => {
    const thresholds = [100, 150, 225];
    const player = { level: 1, currentExp: 20, levels: [] };
    let exp = 470 + player.currentExp;

    while (player.level <= thresholds.length && exp >= thresholds[player.level - 1]) {
        const threshold = thresholds[player.level - 1];
        exp -= threshold;
        player.level += 1;
        player.levels.push(player.level);
    }
    player.currentExp = exp;

    assert.deepEqual(player.levels, [2, 3, 4]);
    assert.equal(player.currentExp, 15);
});

test("production: victory settlement loops until the next threshold is not met", () => {
    const core = functionBody(source("rpg/core.js"), "Combat.prototype.update_s8cxhz$");
    const kotlin = source("fmj_kt/src/fmj/combat/Combat.kt");

    assert.match(
        core,
        /while \(p\.level < p\.levelupChain\.maxLevel && exp_0 >= nextExp_0\) \{[\s\S]*?p\.levelUp_za3lpa\$\((?:cl|p\.level) \+ 1 \| 0\);/,
        "Combat.update must repeatedly subtract thresholds and call levelUp for each level"
    );
    assert.match(
        kotlin,
        /while \(p\.level < p\.levelupChain\.maxLevel && exp >= nextExp\) \{[\s\S]*?p\.levelUp\(cl \+ 1\)/,
        "Kotlin Combat.update must use the same multi-level loop"
    );
});
