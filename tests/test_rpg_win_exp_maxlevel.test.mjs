import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for "once the FIRST alive party member hits max level, every
// later member stops gaining EXP from all future victories" in rpg/core.js
// (fmj engine, 伏魔记 et al.) — Combat.update, "PerformAction" case, Win branch.
//
// HOW WIN EXP WORKS
//   When the executor drains the action queue and all monsters are dead,
//   Combat transitions to Win and iterates mPlayerList_0 to hand out exp:
//
//       while (tmp$_1.hasNext()) {
//         var p = tmp$_1.next();
//         if (p.isAlive) {
//           if (p.level >= p.levelupChain.maxLevel) break;   // <-- BUG
//           ...accumulate currentExp / level up...
//         }
//       }
//
// THE BUG
//   The max-level guard uses `break`, which exits the WHOLE party loop, not
//   just skipping that member. mPlayerList_0 order is fixed (柳清风 first).
//   Once the first-listed alive member reaches maxLevel, every subsequent
//   member receives neither `p.currentExp = exp` nor a level-up — silently,
//   for the rest of the game. Dead members already get nothing by design;
//   a capped member should likewise just be skipped, not abort the loop.
//
// THE FIX
//   `break` -> `continue`: the capped member gains nothing (no exp banking,
//   matching the old skip semantics for that member), everyone else keeps
//   earning exp normally.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism tests: model the win-exp distribution loop ---

function makePlayer(name, level, maxLevel) {
    return { name, level, maxLevel, currentExp: 0, leveled: false };
}

// Mirrors the BUGGY Win branch: `break` aborts the whole loop at a capped member.
function distributeExpBuggy(players, winExp) {
    for (const p of players) {
        if (p.isAlive !== false) {
            if (p.level >= p.maxLevel) break;
            p.currentExp += winExp;
        }
    }
}

// Mirrors the FIXED Win branch: `continue` skips only the capped member.
function distributeExpFixed(players, winExp) {
    for (const p of players) {
        if (p.isAlive !== false) {
            if (p.level >= p.maxLevel) continue;
            p.currentExp += winExp;
        }
    }
}

test("mechanism (buggy): a capped first member starves the whole party of exp", () => {
    const party = [makePlayer("柳清风", 60, 60), makePlayer("于华", 20, 60), makePlayer("陈清", 15, 60)];
    distributeExpBuggy(party, 100);
    assert.equal(party[0].currentExp, 0, "capped member banks nothing (by design)");
    assert.equal(party[1].currentExp, 0, "于华 got NOTHING — the break aborted the loop");
    assert.equal(party[2].currentExp, 0, "陈清 got NOTHING either");
});

test("mechanism (fixed): a capped first member only skips themself", () => {
    const party = [makePlayer("柳清风", 60, 60), makePlayer("于华", 20, 60), makePlayer("陈清", 15, 60)];
    distributeExpFixed(party, 100);
    assert.equal(party[0].currentExp, 0, "capped member still gains nothing");
    assert.equal(party[1].currentExp, 100, "于华 keeps earning exp");
    assert.equal(party[2].currentExp, 100, "陈清 keeps earning exp");
});

test("mechanism (fixed): a capped member in the MIDDLE doesn't block later members", () => {
    const party = [makePlayer("于华", 20, 60), makePlayer("柳清风", 60, 60), makePlayer("陈清", 15, 60)];
    distributeExpFixed(party, 50);
    assert.deepEqual(party.map((p) => p.currentExp), [50, 0, 50]);
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract a function body by brace matching so the pins survive formatting
// churn and don't bleed into neighbouring functions.
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

test("core.js: the Win exp loop skips capped members with continue, not break", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = functionBody(src, "Combat.prototype.update_s8cxhz$");
    // The max-level guard must skip only that member…
    assert.match(
        body,
        /if \(p\.level >= p\.levelupChain\.maxLevel\) continue;/,
        "the max-level guard must `continue` (skip that member) so later members still get exp"
    );
    // …and must not abort the whole party loop.
    assert.doesNotMatch(
        body,
        /if \(p\.level >= p\.levelupChain\.maxLevel\) break;/,
        "`break` starves every member listed after a capped one — regression"
    );
});
