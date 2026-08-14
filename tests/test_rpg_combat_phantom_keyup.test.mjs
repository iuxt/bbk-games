import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for the "pressing Enter to start a scripted battle auto-
// confirms the first character's normal attack" bug in rpg/core.js (fmj engine,
// 伏魔记 et al.).
//
// THE BUG
//   Scripted battles are started from the overworld by pressing Enter on a scene
//   trigger. ScreenMainGame.onKeyDown handles that Enter while Combat is NOT yet
//   active (it runs case 7 -> triggerSceneObjEvent -> script -> Combat.EnterFight
//   -> prepareForNewCombat, which sets mCombatState = SelectAction and
//   sIsFighting = true IMMEDIATELY). The Enter key is still physically held.
//   When the player releases it -- which, given the combat-setup latency, often
//   happens just AFTER combat has become active -- ScreenMainGame.onKeyUp now
//   sees Combat.IsActive() and routes the Enter keyup into Combat ->
//   MainMenu.onKeyUp(KEY_ENTER), which confirms the default menu item
//   (mCurIconIndex 1 = 普通攻击 / normal attack).
//
//   Combat thus processes a keyUP for a key whose keyDOWN it never saw: that
//   keydown happened in the overworld/script context, before combat existed. The
//   same phantom-release mechanism also corrupts state afterward (e.g. pressing
//   ESC then R lands on normal attack), because the unwanted confirm already
//   opened the target-select screen.
//
// THE FIX
//   Track per-key "pressed during this combat" state on Combat. onKeyDown marks
//   the key; onKeyUp ignores any release whose keydown was not seen in this
//   combat (a phantom release). The battle menu then correctly waits for the
//   player's explicit input. The tracker is reset at the start of every combat.

const CORE_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "rpg", "core.js");

// --- mechanism test: a release with no prior press in the same context is a phantom ---

test("mechanism: a key released in a context that never saw its press is ignored", () => {
    // Models the per-key press tracker added to Combat.
    const pressed = {};
    function onKeyDown(k) { pressed[k] = true; }
    function onKeyUp(k) {
        if (!pressed[k]) return false; // phantom release -> swallow
        pressed[k] = false;
        return true; // real release -> process
    }

    // Enter was pressed in the OVERWORLD (combat not active), so combat never saw
    // its keydown. The release arrives inside combat and must be swallowed:
    assert.equal(onKeyUp("ENTER"), false, "phantom Enter release must be swallowed, not confirmed");

    // A key genuinely pressed inside combat is processed normally:
    onKeyDown("DOWN");
    assert.equal(onKeyUp("DOWN"), true, "a real release must be processed");
    assert.equal(pressed["DOWN"], false, "a real release clears the press flag");

    // Re-pressing the same key re-arms it (repeatable confirms):
    onKeyDown("DOWN");
    assert.equal(onKeyUp("DOWN"), true, "a second press/release cycle is processed");
});

// --- source-level pins on rpg/core.js (fail before the fix, pass after) ---

// Extract a prototype-method body by brace matching, so the pins survive
// minification-friendly formatting and don't cross into neighboring functions.
function methodBody(src, name) {
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
    assert.fail(`unterminated method body for ${name}`);
}

test("core.js: Combat.onKeyDown records keys pressed during combat", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "Combat.prototype.onKeyDown_za3lpa$");
    const putIdx = body.search(/this\.mPressedKeys_0\.put_[A-Za-z0-9$_]+\(\s*key\s*,\s*true\s*\)/);
    assert.ok(
        putIdx !== -1,
        "onKeyDown must mark the key as pressed so its release can be told apart from a phantom"
    );
    // ...and it must mark BEFORE dispatching the key into the combat state
    // machine, so no early dispatch path can skip the marking.
    const dispatchIdx = body.search(/this\.mCombatState_0/);
    assert.ok(
        dispatchIdx !== -1 && putIdx < dispatchIdx,
        "the pressed-key marking must be the first thing onKeyDown does"
    );
});

test("core.js: Combat.onKeyUp swallows phantom releases (no matching keydown in this combat)", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    const body = methodBody(src, "Combat.prototype.onKeyUp_za3lpa$");
    // A release whose key was never seen down in this combat (get !== true)
    // must be detected and bailed out on BEFORE any dispatch, so the menu is
    // not confirmed:
    const guardIdx = body.search(
        /if\s*\(\s*this\.mPressedKeys_0\.get_[A-Za-z0-9$_]+\(\s*key\s*\)\s*!==\s*true\s*\)\s*\{[^{}]*return/
    );
    assert.ok(
        guardIdx !== -1,
        "onKeyUp must return early for a phantom release instead of dispatching it"
    );
    const dispatchIdx = body.search(/this\.mCombatState_0/);
    assert.ok(
        dispatchIdx !== -1 && guardIdx < dispatchIdx,
        "the phantom guard must run before any combat-state dispatch"
    );
    // A genuine release must still clear the flag so the key can be re-pressed:
    assert.match(
        body,
        /this\.mPressedKeys_0\.put_[A-Za-z0-9$_]+\(\s*key\s*,\s*false\s*\)/,
        "onKeyUp must clear the press flag for a real release"
    );
});

test("core.js: the press tracker is reset at the start of every combat", () => {
    const src = fs.readFileSync(CORE_JS, "utf8");
    // prepareForNewCombat_0 is reached for both scripted (EnterFight) and random
    // (StartNewRandomCombat) battles via Combat$Companion.prepareForNewCombat_0,
    // so resetting here covers every entry point. The tracker is a
    // mutableMapOf (LinkedHashMap), so the reset is clear(), not a fresh `{}`.
    const body = methodBody(src, "Combat.prototype.prepareForNewCombat_0");
    assert.match(
        body,
        /this\.mPressedKeys_0\.clear\(\)/,
        "prepareForNewCombat must reset the press tracker for the new combat"
    );
});
