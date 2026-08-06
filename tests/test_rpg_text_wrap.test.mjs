import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Regression test for the 伏魔记 opening scroll (cmd_showgut) line-wrap bug.
//
// The prologue text in fmj_zsb.lib is pre-formatted with ASCII spaces so that
// every poem line pads out to exactly 160px (10 Chinese glyphs). For that
// padding to line up, the renderer must wrap by *actual character width*
// (Chinese lead byte >= 0xA1 = 16px, ASCII = 8px). rpg/core.js TextRender
// previously wrapped with `x <= right - 16`, which reserves a full 16px at the
// right edge even for 8px ASCII spaces — so the trailing space padding spilled
// onto the next line and cascaded the whole block out of alignment.
//
// These tests assert the corrected per-character wrap keeps each poem phrase on
// a single line, and document that the old `right - 16` rule splits it.

const lib = readFileSync(new URL("../rpg/roms/fmj_zsb.lib", import.meta.url));

// GBK lead byte check (matches core.js: byte >= 0xA1 is a 2-byte Chinese glyph).
function isLead(b) {
    return b >= 0xa1;
}

// Corrected algorithm — mirrors the fixed drawText_tz7kd0$ / drawText_sfexxe$
// inner loop in rpg/core.js: wrap when the next glyph would overflow `right`.
function wrapFixed(buf, right, left) {
    left = left || 0;
    const lines = [[]];
    let x = left;
    let i = 0;
    while (i < buf.length) {
        const t = buf[i] & 0xff;
        const cw = isLead(t) ? 16 : 8;
        if (x + cw > right) {
            lines.push([]);
            x = left;
        }
        const n = isLead(t) && i + 1 < buf.length ? 2 : 1;
        lines[lines.length - 1].push(buf.subarray(i, i + n));
        i += n;
        x += cw;
    }
    return lines.map((seg) => Buffer.concat(seg));
}

// Old buggy algorithm — mirrors the original `while (x <= right - 16)` inner
// loop nested inside a line-advancing outer loop: it reserves a full 16px at the
// right edge for every glyph, including 8px ASCII spaces.
function wrapOld(buf, right, left) {
    left = left || 0;
    const lines = [[]];
    let x = left;
    let i = 0;
    const limit = right - 16;
    for (;;) {
        while (i < buf.length && x <= limit) {
            const t = buf[i] & 0xff;
            const n = isLead(t) && i + 1 < buf.length ? 2 : 1;
            lines[lines.length - 1].push(buf.subarray(i, i + n));
            i += n;
            x += isLead(t) ? 16 : 8;
        }
        if (i >= buf.length) break;
        lines.push([]);
        x = left;
    }
    return lines.map((seg) => Buffer.concat(seg));
}

// Locate the prologue (cmd_showgut) text span: find "道非道" and take the
// NUL-terminated string that contains it.
const DAO_FEI_DAO = Buffer.from([0xb5, 0xc0, 0xb7, 0xc7, 0xb5, 0xc0]);
const at = lib.indexOf(DAO_FEI_DAO);
assert.notEqual(at, -1, "道非道 marker not found in fmj_zsb.lib");
let start = at;
while (start > 0 && lib[start - 1] !== 0) start -= 1;
let end = at;
while (end < lib.length && lib[end] !== 0) end += 1;
const prologue = lib.subarray(start, end);

// "，道魔" (0xA3AC 0xB5C0 0xC4A7) — the 道+魔 in "世虽以道为正，道魔" must stay
// on one line. (The text also contains "自古道魔不两立", so we anchor on the
// preceding fullwidth comma to target the phrase that actually wraps wrong.)
const DAO_MO = Buffer.from([0xa3, 0xac, 0xb5, 0xc0, 0xc4, 0xa7]);
// 正(0xD5FD) 而(0xB6F8) — the 而 that ends "何以道正而" must not wrap away.
const ZHENG_ER = Buffer.from([0xd5, 0xfd, 0xb6, 0xf8]);

function someLineContains(lines, needle) {
    return lines.some((line) => line.includes(needle));
}

test("fixed per-character wrap keeps 道+魔 on the same line", () => {
    const lines = wrapFixed(prologue, 160, 0);
    assert.equal(someLineContains(lines, DAO_MO), true,
        "道魔 should appear together on one line");
});

test("fixed per-character wrap keeps 何以道正而 together (正+而)", () => {
    const lines = wrapFixed(prologue, 160, 0);
    assert.equal(someLineContains(lines, ZHENG_ER), true,
        "正而 should appear together on one line");
});

test("fixed wrap lays each poem line out to the full 160px width", () => {
    const lines = wrapFixed(prologue, 160, 0);
    // Every non-blank line in the poem section fills exactly 160px.
    const widths = lines.map((line) => {
        let px = 0;
        for (let i = 0; i < line.length; ) {
            const t = line[i] & 0xff;
            px += isLead(t) ? 16 : 8;
            i += isLead(t) ? 2 : 1;
        }
        return px;
    });
    assert.ok(widths.every((w) => w === 160 || w === 0),
        `expected every line to be 160px (or blank), got ${JSON.stringify(widths)}`);
});

test("old right-16 wrap splits 道+魔 across lines (documents the bug)", () => {
    const lines = wrapOld(prologue, 160, 0);
    assert.equal(someLineContains(lines, DAO_MO), false,
        "the old right-16 rule splits 道魔 across lines");
    assert.equal(someLineContains(lines, ZHENG_ER), false,
        "the old right-16 rule splits 正而 across lines");
});
