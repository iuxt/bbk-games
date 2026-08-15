import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE_JS = path.join(ROOT, "rpg", "core.js");
const MAGIC_KT = path.join(ROOT, "fmj_kt", "src", "fmj", "magic", "MagicAttack.kt");

function simplifiedDamage(base, casterLingli, targetLingli, floorPenalty) {
    const difference = casterLingli - targetLingli;
    const rate = (floorPenalty ? Math.max(difference, 0) : difference) / 100;
    return Math.max(base + Math.trunc(base * rate), 0);
}

test("mechanism: spirit-power penalties no longer reduce skill damage below base", () => {
    assert.equal(simplifiedDamage(500, 0, 100, false), 0, "old formula can zero out a skill");
    assert.equal(simplifiedDamage(500, 0, 100, true), 500, "target spirit cannot reduce base damage");
    assert.equal(simplifiedDamage(500, 20, 80, true), 500, "a modest penalty stays clamped");
});

test("mechanism: equal and higher caster spirit keep the existing scaling", () => {
    assert.equal(simplifiedDamage(500, 50, 50, true), 500);
    assert.equal(simplifiedDamage(500, 80, 20, true), 800);
    assert.equal(simplifiedDamage(120, 80, 20, true), 192);
});

test("production: both simplified HP and MP paths clamp negative spirit differences", () => {
    const core = fs.readFileSync(CORE_JS, "utf8");
    const kotlin = fs.readFileSync(MAGIC_KT, "utf8");

    const coreMatches = core.match(
        /var add = JsMath\.max\(src\.lingli - dst\.lingli \| 0, 0\) \/ 100;/g
    );
    assert.equal(coreMatches?.length, 2, "rpg/core.js must floor both HP and MP damage");

    const kotlinMatches = kotlin.match(
        /val add = max\(src\.lingli - dst\.lingli, 0\)\.toDouble\(\) \/ 100/g
    );
    assert.equal(kotlinMatches?.length, 2, "MagicAttack.kt must floor both HP and MP damage");

    assert.doesNotMatch(
        core,
        /var add = \(src\.lingli - dst\.lingli \| 0\) \/ 100;/,
        "the unbounded compiled penalty formula must not remain"
    );
});

test("mechanism: startup preserves explicit damage-formula choices", () => {
    function startupChoice(storedValue) {
        if (storedValue === undefined) return false;
        return storedValue === "true";
    }

    assert.equal(startupChoice(undefined), false, "no stored choice uses the simplified default");
    assert.equal(startupChoice("false"), false);
    assert.equal(startupChoice("true"), true, "a stored original-formula choice wins");
});

test("production: startup fallback selects the simplified formula", () => {
    const core = fs.readFileSync(CORE_JS, "utf8");
    const kotlin = fs.readFileSync(
        path.join(ROOT, "fmj_kt", "src", "fmj", "config", "GameSettings.kt"),
        "utf8"
    );

    assert.match(
        kotlin,
        /loadSetting\("useOriginalDamageFormula", "false"\)/,
        "Kotlin startup fallback must agree with the declared default"
    );
    assert.match(
        core,
        /loadSetting_0\('useOriginalDamageFormula', 'false'\)/,
        "compiled startup fallback must agree with the declared default"
    );
});
