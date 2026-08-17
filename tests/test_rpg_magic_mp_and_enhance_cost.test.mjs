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

test("mechanism: group attack magic resolves MP for every hit target", () => {
    const caster = { mp: 100 };
    const targets = [
        { name: "A", missed: true, mp: 80 },
        { name: "B", missed: false, mp: 70 },
        { name: "C", missed: false, mp: 30 },
    ];

    for (const target of targets) {
        if (target.missed) continue;
        const mpHurt = -20;
        target.mp = Math.max(0, target.mp - Math.abs(mpHurt));
        if (mpHurt < 0) caster.mp = Math.min(caster.maxMP ?? Infinity, caster.mp - mpHurt);
    }

    assert.equal(targets[0].mp, 80, "missed target keeps its MP");
    assert.equal(targets[1].mp, 50);
    assert.equal(targets[2].mp, 10);
    assert.equal(caster.mp, 140, "negative MP damage restores the caster once per hit target");
});

test("production: list-form MagicAttack resolves target MP and caster MP drain", () => {
    const core = functionBody(source("rpg/core.js"), "MagicAttack.prototype.use_h32lzv$");
    const kotlin = source("fmj_kt/src/fmj/magic/MagicAttack.kt");

    assert.match(
        core,
        /var mpHurt = this\.calcMpHurt_0\(src, fc, this\.mMp_0\);/,
        "group path must compute MP damage per non-missed target"
    );
    assert.match(core, /fc\.mp = fc\.mp - abs\(mpHurt\) \| 0;/);
    assert.match(core, /if \(mpHurt < 0\) \{[\s\S]*?src\.mp = src\.mp - mpHurt \| 0;/);

    assert.match(kotlin, /val mpHurt = calcMpHurt\(src, fc, mMp\)/);
    assert.match(kotlin, /fc\.mp -= abs\(mpHurt\)/);
    assert.match(kotlin, /if \(mpHurt < 0\) \{[\s\S]*?src\.mp -= mpHurt/);
});

test("production: MagicEnhance costs MP once for single and group casts", () => {
    const enhanceCore = functionBody(source("rpg/core.js"), "MagicEnhance.prototype.use_qwqr58$");
    const helpAllCore = functionBody(
        source("rpg/core.js"),
        "ActionMagicHelpAll.prototype.preproccess"
    );
    const enhanceKt = source("fmj_kt/src/fmj/magic/MagicEnhance.kt");
    const helpAllKt = source("fmj_kt/src/fmj/combat/actions/ActionMagicHelpAll.kt");

    assert.match(enhanceCore, /if \(src\.mp < this\.costMp\)\s*return;/);
    assert.match(enhanceCore, /src\.mp = src\.mp - this\.costMp \| 0;/);
    assert.match(enhanceCore, /this\.applyEffect_qwqr58\$\(src, dst\);/);
    assert.match(helpAllCore, /Typescript\.isType\(currentMagic, MagicEnhance\)/);
    assert.match(helpAllCore, /currentMagic\.applyEffect_qwqr58\$\(attacker, element_0\);/);

    assert.match(enhanceKt, /if \(src\.mp < costMp\) return/);
    assert.match(enhanceKt, /src\.mp = src\.mp - costMp/);
    assert.match(enhanceKt, /applyEffect\(src, dst\)/);
    assert.match(helpAllKt, /currentMagic is MagicEnhance/);
    assert.match(helpAllKt, /currentMagic\.applyEffect\(attacker, it\)/);
});

test("production: a group enhance cast deducts the cost only once", () => {
    const core = functionBody(
        source("rpg/core.js"),
        "ActionMagicHelpAll.prototype.preproccess"
    );
    const branch = core.match(/if \(Typescript\.isType\(currentMagic, MagicEnhance\)\) \{([\s\S]*?)\n    \} else \{/);
    assert.ok(branch, "MagicEnhance must have a dedicated group branch");
    assert.equal((branch[1].match(/attacker\.mp = attacker\.mp - currentMagic\.costMp \| 0;/g) ?? []).length, 1);

    const kotlin = source("fmj_kt/src/fmj/combat/actions/ActionMagicHelpAll.kt");
    const ktBranch = kotlin.match(/if \(currentMagic is MagicEnhance\) \{([\s\S]*?)\n        \} else \{/);
    assert.ok(ktBranch, "Kotlin MagicEnhance must have a dedicated group branch");
    assert.equal((ktBranch[1].match(/attacker\.mp = attacker\.mp - currentMagic\.costMp/g) ?? []).length, 1);
});
