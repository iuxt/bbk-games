# RPG Skill Damage Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent higher-spirit RPG enemies from reducing attack-skill damage below its authored base value, and make the simplified formula the actual startup default.

**Architecture:** The behavior is owned by `MagicAttack` in the Kotlin source and mirrored in the checked-in browser bundle `rpg/core.js`. Regression tests model the integer calculation in Node and pin both production copies, following the repository's established tests for the large fmj bundle. `GameSettings.initialize()` is corrected separately so its no-storage fallback agrees with the declared default.

**Tech Stack:** Kotlin source (`fmj_kt`), generated/manual browser JavaScript (`rpg/core.js`), Node's built-in test runner.

## Global Constraints

- The simplified formula is the default: `useOriginalDamageFormula` starts as `false`.
- A stored player choice for `useOriginalDamageFormula` must continue to override the startup default.
- In the simplified branch, the HP and MP attack calculations clamp the spirit difference at zero: `max(caster.lingli - target.lingli, 0)`.
- The original-formula branch, absorb/level scaling, magic costs, misses, buffs, and other damage formulas remain unchanged.
- `fmj_kt/src` and `rpg/core.js` must receive matching changes; there is no Kotlin-to-core build step in this repository.

---

### Task 1: Floor Simplified Magic Damage

**Files:**
- Create: `tests/test_rpg_magic_damage_floor.test.mjs`
- Modify: `fmj_kt/src/fmj/magic/MagicAttack.kt:69-78`
- Modify: `fmj_kt/src/fmj/magic/MagicAttack.kt:191-199`
- Modify: `rpg/core.js:82545-82553`
- Modify: `rpg/core.js:82621-82628`

**Interfaces:**
- Consumes: `MagicAttack.calcHurt(src, dst, hp)` and `MagicAttack.calcMpHurt(src, dst, mp)` with `FightingCharacter.lingli`.
- Produces: simplified HP/MP damage equal to `base + trunc(base * max(src.lingli - dst.lingli, 0) / 100)`, never below zero.

- [x] **Step 1: Write the failing regression tests**

Create `tests/test_rpg_magic_damage_floor.test.mjs`:

```js
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
```

- [x] **Step 2: Run the tests and verify the source pin fails**

Run: `node --test tests/test_rpg_magic_damage_floor.test.mjs`

Expected: FAIL in `production: both simplified HP and MP paths clamp negative spirit differences` because the production formula is still unbounded.

- [x] **Step 3: Implement the floor in Kotlin and core.js**

In both simplified branches of `fmj_kt/src/fmj/magic/MagicAttack.kt`, replace:

```kotlin
val add = (src.lingli - dst.lingli).toDouble() / 100
```

with:

```kotlin
val add = max(src.lingli - dst.lingli, 0).toDouble() / 100
```

In both simplified branches of `rpg/core.js`, replace:

```js
var add = (src.lingli - dst.lingli | 0) / 100;
```

with:

```js
var add = JsMath.max(src.lingli - dst.lingli | 0, 0) / 100;
```

There must be one replacement in `calcHurt_0` and one in `calcMpHurt_0`; do not change `calcMagicDamageOriginal_0` or `calcMpDamageOriginal_0`.

- [x] **Step 4: Run the focused tests**

Run: `node --test tests/test_rpg_magic_damage_floor.test.mjs`

Expected: PASS for all tests in the new file.

- [ ] **Step 5: Commit the damage floor**

```bash
git add tests/test_rpg_magic_damage_floor.test.mjs \
  fmj_kt/src/fmj/magic/MagicAttack.kt \
  rpg/core.js
git commit -m "fix(rpg): floor simplified skill damage"
```

### Task 2: Align Startup Formula Default

**Files:**
- Modify: `tests/test_rpg_magic_damage_floor.test.mjs`
- Modify: `fmj_kt/src/fmj/config/GameSettings.kt:155`
- Modify: `rpg/core.js` in `GameSettings.prototype.initialize`

**Interfaces:**
- Consumes: `GameSettings.initialize()` and `loadSetting(key, defaultValue)`.
- Produces: no-storage startup with `useOriginalDamageFormula === false`; stored `"true"` or `"false"` remains authoritative.

- [ ] **Step 1: Append the failing startup-default tests**

Append to `tests/test_rpg_magic_damage_floor.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests and verify the production pin fails**

Run: `node --test tests/test_rpg_magic_damage_floor.test.mjs`

Expected: FAIL in `production: startup fallback selects the simplified formula` because both production copies still pass `"true"` as the fallback.

- [ ] **Step 3: Correct the fallback in Kotlin and core.js**

In `fmj_kt/src/fmj/config/GameSettings.kt`, replace:

```kotlin
_useOriginalDamageFormula = loadSetting("useOriginalDamageFormula", "true").toBoolean()
```

with:

```kotlin
_useOriginalDamageFormula = loadSetting("useOriginalDamageFormula", "false").toBoolean()
```

In `rpg/core.js`, replace:

```js
this._useOriginalDamageFormula_0 = toBoolean(this.loadSetting_0('useOriginalDamageFormula', 'true'));
```

with:

```js
this._useOriginalDamageFormula_0 = toBoolean(this.loadSetting_0('useOriginalDamageFormula', 'false'));
```

Do not change the field initializer, reset value, settings screen, or save behavior.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/test_rpg_magic_damage_floor.test.mjs`

Expected: PASS for every test in the file.

- [ ] **Step 5: Commit the startup default**

```bash
git add tests/test_rpg_magic_damage_floor.test.mjs \
  fmj_kt/src/fmj/config/GameSettings.kt \
  rpg/core.js
git commit -m "fix(rpg): default startup to simplified damage"
```

### Task 3: Full Verification

**Files:**
- Verify only; no source edits.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: Verified test suite and deployable minified bundle.

- [ ] **Step 1: Run all Node and Python tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: build completes, terser parses `rpg/core.js` successfully, and no source-level regression is introduced.

- [ ] **Step 3: Inspect final repository state**

Run: `git status --short`

Expected: only intentional generated/ignored build output, if any; no unstaged source or test changes.
