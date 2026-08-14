import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const anchorSource = readFileSync(new URL('../rpg/srs-anchor.js', import.meta.url), 'utf8');

function loadAnchor() {
    // srs-anchor.js is an IIFE that attaches to `window` when present. It runs
    // inside a vm sandbox, so the objects it returns belong to the sandbox
    // realm — assert on their primitive fields, not via deepStrictEqual.
    const sandbox = { window: {} };
    vm.runInNewContext(anchorSource, sandbox);
    return sandbox.window.BBKSrsAnchor;
}

// Real enemy formation slots (Monster$Companion.arr_0) and player slots
// (Combat$Companion.sPlayerPos), lifted from rpg/core.js so these tests lock
// the actual coordinates the engine uses.
const monsterSlots = [new Int32Array([12, 25]), new Int32Array([44, 14]), new Int32Array([82, 11])];
const playerSlots = [{ x: 76, y: 70 }, { x: 108, y: 66 }, { x: 140, y: 58 }];

// Independent reimplementation of the ORIGINAL living-centroid math in
// ActionMagicAttackAll.preproccess: average each target's combatPos, where
// combatPos applies the Monster.setOriginalCombatPos sprite-size adjustment.
// Used to prove the new formation center is pixel-identical when the whole
// formation is alive.
function legacyLivingCentroid(slots, w, h) {
    let sx = 0;
    let sy = 0;
    for (const s of slots) {
        const bx = (s && typeof s.x === 'number') ? s.x : s[0];
        const by = (s && typeof s.y === 'number') ? s.y : s[1];
        sx += bx - ((w / 6) | 0) + ((w / 2) | 0);
        sy += by - ((h / 10) | 0) + ((h / 2) | 0);
    }
    return { x: (sx / slots.length) | 0, y: (sy / slots.length) | 0 };
}

test('formationCenter returns the enemy formation geometry center with sprite adjustment', () => {
    const { formationCenter } = loadAnchor();
    const c = formationCenter(monsterSlots, 30, 40);
    // base avg = (46, 16); with w=30,h=40 -> x=56, y=32
    assert.equal(c.x, 56);
    assert.equal(c.y, 32);
});

test('formationCenter accepts player Point slots so it is side-agnostic', () => {
    const { formationCenter } = loadAnchor();
    const c = formationCenter(playerSlots, 30, 40);
    // base avg = (108, 64); with w=30,h=40 -> x=118, y=80
    assert.equal(c.x, 118);
    assert.equal(c.y, 80);
});

test('formationCenter reflects whatever formation is passed — the caller supplies the full table', () => {
    const { formationCenter } = loadAnchor();
    const full = formationCenter(monsterSlots, 30, 40);
    const onlyTopSlot = formationCenter([monsterSlots[0]], 30, 40);
    // A single top slot lands at (22, 41), not the formation centre. The fix
    // relies on the caller passing the FULL slot table, so a lone survivor in
    // the top/bottom slot can no longer drag the all-target effect off-centre.
    assert.notEqual(full.x, onlyTopSlot.x);
    assert.equal(full.x, 56);
    assert.equal(full.y, 32);
});

test('formationCenter matches the old living-centroid when the whole formation is targeted', () => {
    const { formationCenter } = loadAnchor();
    // Regression guard: at a full formation the new anchor must equal the old
    // average exactly, so the fix changes behaviour only for partial formations.
    const a = formationCenter(monsterSlots, 30, 40);
    const b = legacyLivingCentroid(monsterSlots, 30, 40);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);

    const c = formationCenter(playerSlots, 24, 36);
    const d = legacyLivingCentroid(playerSlots, 24, 36);
    assert.equal(c.x, d.x);
    assert.equal(c.y, d.y);
});

test('formationCenter returns the origin for empty or null formations', () => {
    const { formationCenter } = loadAnchor();
    assert.equal(formationCenter([], 30, 40).x, 0);
    assert.equal(formationCenter([], 30, 40).y, 0);
    assert.equal(formationCenter(null, 30, 40).x, 0);
    assert.equal(formationCenter(undefined, 30, 40).y, 0);
});
