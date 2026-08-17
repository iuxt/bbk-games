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

test("mechanism: hex decoding consumes exactly two characters per byte", () => {
    const oldCount = Math.floor("AABB".length / 2) + 1;
    const fixedCount = Math.floor("AABB".length / 2);
    assert.equal(oldCount, 3, "the old inclusive range reads a phantom fifth character");
    assert.equal(fixedCount, 2);
});

test("production: hexDecode excludes the terminating half-pair", () => {
    const core = source("rpg/core.js");
    const kotlin = source("fmj_kt/src/java/java.kt");
    const hexBody = functionBody(core, "function hexDecode");

    assert.match(hexBody, /var byteCount = s\.length \/ 2 \| 0;/);
    assert.match(hexBody, /until\(0, byteCount\)/);
    assert.doesNotMatch(hexBody, /new IntRange\(0, s\.length \/ 2 \| 0\)/);
    assert.match(kotlin, /val byteCount = s\.length \/ 2/);
    assert.match(kotlin, /\(0 until byteCount\)\.map/);
    assert.doesNotMatch(kotlin, /\(0\.\.s\.length\/2\)\.map/);
});

test("production: MagicAttack random floats use the host-hook Random", () => {
    const core = source("rpg/core.js");
    const kotlin = source("fmj_kt/src/fmj/magic/MagicAttack.kt");

    assert.doesNotMatch(kotlin, /kotlin\.random\.Random\.nextInt/);
    assert.match(kotlin, /private val random = Random\(\)/);
    assert.doesNotMatch(core, /Random\.Default\.nextInt_za3lpa\$\(1000\)/);
    assert.match(core, /this\.random_0\.nextInt_za3lpa\$\(1000\)/);
});

test("production: BaseMagic reads bounded descriptions without mutating the ROM buffer", () => {
    const core = functionBody(source("rpg/core.js"), "BaseMagic.prototype.setData_ir89t6$");
    const kotlin = source("fmj_kt/src/fmj/magic/BaseMagic.kt");

    assert.doesNotMatch(core, /buf\[offset \+ 112 \| 0\] = 0;/);
    assert.match(core, /var descriptionLength = JsMath\.min\((?:len - 26 \| 0|a), 86\);/);
    assert.match(core, /gbkString\(buf, descriptionStart, /);
    assert.match(core, /descriptionBytes\[index\] === toByte\(0\)/);

    assert.doesNotMatch(kotlin, /buf\[offset \+ 0x70\] = 0/);
    assert.match(kotlin, /val descriptionLength = minOf\(len - 0x1a, 0x70 - 0x1a\)/);
    assert.match(kotlin, /descriptionBytes\.indexOfFirst/);
    assert.match(kotlin, /gbkString\(descriptionStart, boundedLength\)/);
});
