import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

await import("../rpg/srs-anchor.js");
await import("../rpg/app.js");

const Simulator = globalThis.BBKSimulator;
const SrsAnchor = globalThis.BBKSrsAnchor;

function readLibraryEntries(buffer) {
    const entries = [];
    let directoryOffset = 16;
    let addressOffset = 8192;

    while (directoryOffset + 2 < buffer.length &&
            buffer[directoryOffset] !== 0xFF) {
        const resourceType = buffer[directoryOffset];
        const type = buffer[directoryOffset + 1];
        const index = buffer[directoryOffset + 2];
        const block = buffer[addressOffset];
        const low = buffer[addressOffset + 1];
        const high = buffer[addressOffset + 2];

        entries.push({
            resourceType,
            type,
            index,
            offset: block * 16384 + (high << 8) + low,
        });
        directoryOffset += 3;
        addressOffset += 3;
    }

    return entries;
}

function readSrsAt(buffer, offset) {
    const frameCount = buffer[offset + 2];
    const imageCount = buffer[offset + 3];
    const frameHeaders = [];
    let cursor = offset + 6;

    for (let i = 0; i < frameCount; i += 1) {
        frameHeaders.push(Array.from(buffer.subarray(cursor, cursor + 5)));
        cursor += 5;
    }

    const images = [];
    for (let i = 0; i < imageCount; i += 1) {
        const width = buffer[cursor + 2];
        const height = buffer[cursor + 3];
        const number = buffer[cursor + 4];
        const mode = buffer[cursor + 5];
        const rowBytes = Math.ceil(width / 8);

        images.push({ width, height });
        cursor += 6 + number * rowBytes * height * mode;
    }

    return { frameHeaders, images };
}

function readSrs(fileName, type, index) {
    const buffer = readFileSync(new URL(`../rpg/roms/${fileName}`, import.meta.url));
    const entry = readLibraryEntries(buffer).find((candidate) =>
        candidate.resourceType === 5 &&
        candidate.type === type &&
        candidate.index === index
    );

    assert.ok(entry, `missing SRS ${type}:${index} in ${fileName}`);
    return readSrsAt(buffer, entry.offset);
}

test("simulator converts ROM bytes to uppercase hexadecimal", () => {
    const bytes = Uint8Array.from([0, 1, 15, 16, 127, 128, 255]);

    assert.equal(
        Simulator.arrayBufferToHex(bytes.buffer),
        "00010F107F80FF"
    );
});

test("simulator handles an empty ROM buffer", () => {
    assert.equal(Simulator.arrayBufferToHex(new ArrayBuffer(0)), "");
});

test("simulator recognizes every physical key handled by the game core", () => {
    for (const keyCode of [13, 27, 32, 37, 38, 39, 40, 82, 219, 221]) {
        assert.equal(Simulator.isMappedGameKey({ keyCode }), true);
    }
    assert.equal(Simulator.isMappedGameKey({ keyCode: 65 }), false);
});

test("simulator gives same-length local ROMs distinct stable storage IDs", () => {
    const first = Uint8Array.from([1, 2, 3, 4]).buffer;
    const second = Uint8Array.from([4, 3, 2, 1]).buffer;

    assert.equal(Simulator.romStorageId(first, "catalog-game"), "catalog-game");
    assert.equal(Simulator.romStorageId(first, ""), Simulator.romStorageId(first, ""));
    assert.notEqual(Simulator.romStorageId(first, ""), Simulator.romStorageId(second, ""));
});

test("simulator addresses three save slots by current ROM identity", () => {
    assert.equal(Simulator.saveStorageKey("xkx", 0), "sav/gamesave0-xkx");
    assert.equal(Simulator.saveStorageKey("xkx", 2), "sav/gamesave2-xkx");
    assert.throws(() => Simulator.saveStorageKey("", 0));
    assert.throws(() => Simulator.saveStorageKey("xkx", 3));
});

test("simulator exports and validates a save for the current game", () => {
    const payload = Simulator.buildSavePayload(
        "xkx",
        "侠客行",
        1,
        "00A1FF",
        "2026-07-28T00:00:00.000Z"
    );

    assert.deepEqual(payload, {
        app: "bbk-games",
        type: "dictionary-save-slot",
        version: 1,
        romId: "xkx",
        romName: "侠客行",
        slot: 1,
        data: "00A1FF",
        exportedAt: "2026-07-28T00:00:00.000Z",
    });
    assert.equal(
        Simulator.parseSavePayload(JSON.stringify(payload), "xkx").ok,
        true
    );
    assert.equal(
        Simulator.parseSavePayload(JSON.stringify(payload), "jyqxz").ok,
        false
    );
});

test("simulator rejects malformed save files", () => {
    assert.equal(Simulator.parseSavePayload("not-json", "xkx").ok, false);
    assert.equal(
        Simulator.parseSavePayload({
            app: "bbk-games",
            type: "dictionary-save-slot",
            version: 1,
            romId: "xkx",
            slot: 0,
            data: "not-hex",
        }, "xkx").ok,
        false
    );
});

test("simulator core namespaces saves by stable ROM identity", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /gameRomId\s*=\s*localStorage\.getItem\("gameRomStorageId"\)\s*\|\|\s*localStorage\.getItem\("gameRomId"\)/
    );
    assert.match(
        source,
        /gameRomLength\s*=\s*gameRomId\s*\|\|\s*\(gameRom\s*\?\s*gameRom\.length\s*:\s*1114112\)/
    );
});

test("magic screen shows the MP cost of the selected spell", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const loader = readFileSync(new URL("../rpg/app.js", import.meta.url), "utf8");

    // The Kotlin source (ScreenMagic.draw) binds the currently selected spell
    // into `val hlMagic = magics[mCurItemIndex]` and renders its cost as
    // "耗真气:<costMp>" (the GBK string literal compiles to \u escapes). The
    // binding proves the shown cost belongs to the selected spell, not a
    // stale list entry.
    assert.match(
        source,
        /var hlMagic = this\.magics_0\[this\.mCurItemIndex_0\];\s*TextRender_getInstance\(\)\.drawText_kkuqvh\$\(canvas, '\\u8017\\u771F\\u6C14:' \+ toString\(hlMagic\.costMp\)/
    );
    // The loader must reference core.js through a cache-busting version
    // parameter (currently v=22) — a bare unversioned reference is rejected.
    assert.match(loader, /script\.src\s*=\s*"core\.js\?v=\d+"/);
    assert.doesNotMatch(loader, /["']core\.js["']/);
});

test("thrown/used goods are refunded when their target dies before the action runs", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const prepare = source.slice(
        source.indexOf("ActionExecutor.prototype.prepareAction_0"),
        source.indexOf("ActionExecutor.prototype.draw_9in0vv$")
    );
    assert.ok(prepare, "ActionExecutor.prepareAction_0 not found");

    // Item count is deducted at selection time (deleteGoods) and the throw/use
    // action is queued. If the target dies before the action executes, the
    // action is dropped in prepareAction_0; it must call cancel() (which
    // addGoods the item back) instead of silently losing the goods.

    // Multi-target drop (no surviving target): cancel() before nulling the action.
    assert.match(
        prepare,
        /isTargetAlive[\s\S]*?isSingleTarget[\s\S]*?ensureNotNull\(this\.mCurrentAction_0\)\.cancel\(\);\s*this\.mCurrentAction_0 = null;/
    );
    // Single-target drop (no alive target to retarget): cancel() before postAction_1().
    assert.match(
        prepare,
        /newTarget == null\) \{\s*ensureNotNull\(this\.mCurrentAction_0\)\.cancel\(\);\s*this\.postAction_1\(\);\s*return;/
    );
    // The refund is what cancel() does for throw/use-item actions (the fresh
    // compile emits `function () {` with a space after `function`).
    assert.match(
        source,
        /ActionThrowItemOne\.prototype\.cancel = function \(\) \{[\s\S]{0,300}?addGoods_6xxg66\$/
    );
    assert.match(
        source,
        /ActionUseItemOne\.prototype\.cancel = function \(\) \{[\s\S]{0,300}?addGoods_6xxg66\$/
    );
});

test("healing applies coerced HP values through a reusable target effect", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // MagicRestore.applyEffect_qwqr58$ was extracted out of use() so group
    // heals can reuse it without paying MP again. It captures the pre-heal
    // HP, applies the int32-coerced heal, re-clamps to maxHP, and finally
    // overwrites deltaSinceBackup with the actually-applied (clamped) delta
    // so popups show the real restoration instead of the nominal one.
    assert.match(
        source,
        /MagicRestore\.prototype\.applyEffect_qwqr58\$ = function \(src, dst\) \{[\s\S]{0,400}?var currentHp = dst\.hp;[\s\S]{0,400}?dst\.hp = dst\.hp \+ this\.mHp_0 \| 0;[\s\S]{0,120}?if \(dst\.hp > dst\.maxHP\) \{\s*dst\.hp = dst\.maxHP;\s*\}[\s\S]{0,600}?dst\.deltaSinceBackup = dst\.hp - currentHp \| 0;/
    );
    // The single-target path pays MP then reuses the very same effect.
    assert.match(
        source,
        /MagicRestore\.prototype\.use_qwqr58\$ = function \(src, dst\) \{[\s\S]{0,250}?this\.applyEffect_qwqr58\$\(src, dst\);/
    );
    assert.equal((84 + 4) | 0, 88);
});

test("all-target healing pays once and applies healing to every target", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const action = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.preproccess"),
        source.indexOf("ActionMagicHelpAll.prototype.update_s8cxhz$")
    );
    assert.ok(action, "ActionMagicHelpAll.preproccess not found");

    // Group Restore magic pays the MP cost exactly once — inside the
    // affordability gate — and then applies the reusable effect (not use(),
    // which would pay again) to every target inside the same branch.
    assert.match(
        action,
        /var currentMagic = this\.magic_8be2vx\$;\s*if \(Typescript\.isType\(currentMagic, MagicRestore\)\) \{\s*if \(attacker\.mp >= currentMagic\.costMp\) \{\s*attacker\.mp = attacker\.mp - currentMagic\.costMp \| 0;[\s\S]{0,250}?while \(tmp\$_\d+\.hasNext\(\)\) \{\s*var element_\d* = tmp\$_\d+\.next\(\);\s*currentMagic\.applyEffect_qwqr58\$\((attacker, element_\d*)\);\s*\}/
    );
    assert.equal(
        (action.match(/attacker\.mp\s*=\s*attacker\.mp\s*-/g) || []).length,
        1
    );
});

test("single-target attack magic renders at the device-accurate target anchor", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Single-target attack magic anchors the authored frame 0 at the target's
    // top-centre (combatX, combatY - height/2) via drawAbsolutely, reproducing
    // the original device behaviour (the authored layout settles the effect at
    // the target's feet) and matching ActionCoopMagic. Anchoring the area-
    // weighted visual centre there instead (drawAtTarget) centred the burst on
    // the top-centre and floated it over the target's head.
    assert.match(
        source,
        /this\.mAniY_0\s*=\s*target\.combatY\s*-\s*\(ensureNotNull\(target\.fightingSprite\)\.height\s*\/\s*2\s*\|\s*0\)\s*\|\s*0/
    );
    assert.match(
        source,
        /this\.mAniY_0\s*=\s*this\.mMonster_8be2vx\$\.combatY\s*-\s*\(ensureNotNull\(this\.mMonster_8be2vx\$\.fightingSprite\)\.height\s*\/\s*2\s*\|\s*0\)\s*\|\s*0/
    );

    const attackDraw = source.slice(
        source.indexOf("ActionMagicAttackOne.prototype.draw_9in0vv$"),
        source.indexOf("ActionMagicAttackOne.prototype.rollbackToPhysical")
    );
    assert.ok(attackDraw, "ActionMagicAttackOne.draw_9in0vv$ not found");
    assert.match(attackDraw, /drawAbsolutely_2g4tob\$\(canvas, this\.mAniX_0, this\.mAniY_0\)/);
    assert.doesNotMatch(attackDraw, /drawAtTarget_2g4tob/);
});

test("all-target attack magic anchors its effect on the target formation", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const action = source.slice(
        source.indexOf("ActionMagicAttackAll.prototype.preproccess"),
        source.indexOf("ActionMagicAttackAll.prototype.update_s8cxhz$")
    );
    const draw = source.slice(
        source.indexOf("ActionMagicAttackAll.prototype.draw_9in0vv$"),
        source.indexOf("ActionMagicAttackAll.prototype.rollbackToPhysical")
    );
    assert.ok(action, "ActionMagicAttackAll.preproccess not found");
    assert.ok(draw, "ActionMagicAttackAll.draw_9in0vv$ not found");

    // The group effect must be centred on the enemy formation's GEOMETRIC
    // centre (formationCenter over the full Monster.arr / sPlayerPos slot
    // table), not on the living targets' centroid — so a lone survivor in the
    // top/bottom slot no longer drags the burst off-centre — and never at the
    // ROM's raw coordinates which sit over the player party. The Kotlin js()
    // interop guard compiles to a typeof-ternary around the module call.
    assert.match(
        action,
        /var slots = Typescript\.isType\(this\.mTargets\.get_za3lpa\$\((0)\), Player\) \? Combat\$Companion_getInstance\(\)\.sPlayerPos : Monster\$Companion_getInstance\(\)\.arr;/
    );
    assert.match(action, /window\.BBKSrsAnchor\.formationCenter\(slots, width, height\)/);
    assert.match(action, /this\.mAnix_0 = center\.x;\s*this\.mAniy_0 = center\.y;/);
    assert.match(
        draw,
        /drawAtTarget_2g4tob\$\(canvas, this\.mAnix_0, this\.mAniy_0\)/
    );
    assert.doesNotMatch(draw, /draw_2g4tob\$\(canvas, 0, 0\)/);
});

test("single-target help, throw and use-item effects render at the target anchor", () => {
    // The climax-anchor heuristic (drawAtTarget via BBKSrsAnchor.compute) placed
    // spell/item particle bursts off the target. Single-target help magic,
    // thrown weapons and used items revert to the device-accurate behaviour:
    // anchor the authored frame 0 at the target's top-centre
    // (combatX, combatY - height/2) via drawAbsolutely, matching
    // ActionMagicAttackOne and ActionCoopMagic.
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // All single-target effects must anchor frame 0 at the target top-centre,
    // not at the target centre, so the effect settles at the character's feet
    // instead of floating above their head. The fresh compile emits two
    // shapes: HelpOne uses fightingSprite!! (ensureNotNull), while
    // ThrowItem/UseItem use the elvis fallback (fightingSprite?.height ?: 16).
    const yAnchorEnsure =
        /combatY\s*-\s*\(ensureNotNull\(this\.mTarget\.fightingSprite\)\.height\s*\/\s*2\s*\|\s*0\)\s*\|\s*0/;
    const yAnchorElvis =
        /combatY\s*-\s*\(\(\(tmp\$_\d+ = \(tmp\$_\d+ = this\.mTarget\.fightingSprite\) != null \? tmp\$_\d+\.height : null\) != null \? tmp\$_\d+ : 16\) \/ 2 \| 0\) \| 0/;

    const cases = [
        {
            name: "ActionMagicHelpOne",
            preproccessStart: "ActionMagicHelpOne.prototype.preproccess",
            preproccessEnd: "ActionMagicHelpOne.prototype.update_s8cxhz$",
            drawStart: "ActionMagicHelpOne.prototype.draw_9in0vv$",
            drawEnd: "ActionMagicHelpOne.prototype.rollbackToPhysical",
            yAnchor: yAnchorEnsure,
            drawCall: /drawAbsolutely_2g4tob\$\(canvas, this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$\)/,
        },
        {
            name: "ActionThrowItemOne",
            preproccessStart: "ActionThrowItemOne.prototype.preproccess",
            preproccessEnd: "ActionThrowItemOne.prototype.update_s8cxhz$",
            drawStart: "ActionThrowItemOne.prototype.draw_9in0vv$",
            drawEnd: "ActionThrowItemOne.prototype.cancel",
            yAnchor: yAnchorElvis,
            drawCall: /drawAbsolutely_2g4tob\$\(canvas, this\.mAniX_0, this\.mAniY_0\)/,
        },
        {
            name: "ActionUseItemOne",
            preproccessStart: "ActionUseItemOne.prototype.preproccess",
            preproccessEnd: "ActionUseItemOne.prototype.update_s8cxhz$",
            drawStart: "ActionUseItemOne.prototype.draw_9in0vv$",
            drawEnd: "ActionUseItemOne.prototype.cancel",
            yAnchor: yAnchorElvis,
            drawCall: /drawAbsolutely_2g4tob\$\(canvas, this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$\)/,
        },
    ];

    for (const { name, preproccessStart, preproccessEnd, drawStart, drawEnd, yAnchor, drawCall } of cases) {
        const preproccess = source.slice(source.indexOf(preproccessStart), source.indexOf(preproccessEnd));
        assert.ok(preproccess, `${name} preproccess not found`);
        assert.match(preproccess, yAnchor, `${name} Y must anchor at target top-centre (combatY - height/2)`);

        const draw = source.slice(source.indexOf(drawStart), source.indexOf(drawEnd));
        assert.ok(draw, `${name} draw method not found`);
        assert.match(draw, drawCall, `${name} should anchor at the target via drawAbsolutely`);
        assert.doesNotMatch(draw, /drawAtTarget_2g4tob/, `${name} must not use the climax anchor`);
    }
});

test("multi-target healing still aligns via the shared SRS anchor", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const preproccess = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.preproccess"),
        source.indexOf("ActionMagicHelpAll.prototype.update_s8cxhz$")
    );
    const draw = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.draw_9in0vv$"),
        source.indexOf("ActionMagicHelpAll.prototype.rollbackToPhysical")
    );
    assert.ok(preproccess, "ActionMagicHelpAll.preproccess not found");
    assert.ok(draw, "ActionMagicHelpAll.draw_9in0vv$ not found");

    // The SRS anchor module stays wired for the all-target heal: ResSrs
    // resolves its impact anchor through window.BBKSrsAnchor.compute
    // (updateImpactAnchor_0, with a first-frame-header fallback), the action
    // centres the authored group on the target-formation centroid and scales
    // the spread by occupied-vs-full formation span, and drawing goes through
    // drawAtTargetScaled which offsets every frame by that shared anchor.
    assert.match(
        source,
        /var anchor = typeof window\.BBKSrsAnchor !== 'undefined' \? window\.BBKSrsAnchor\.compute\(frameHeaders, images\) : null;/
    );
    assert.match(
        source,
        /this\.mImpactAnchorX_0 = anchor\.x;\s*this\.mImpactAnchorY_0 = anchor\.y;/
    );
    // Centroid of the actual targets (box-accumulator locals targetX/targetY).
    assert.match(
        preproccess,
        /if \(targetCount\.v > 0\) \{\s*this\.mAnix_8be2vx\$ = targetX\.v \/ targetCount\.v \| 0;\s*this\.mAniy_8be2vx\$ = targetY\.v \/ targetCount\.v \| 0;\s*\}/
    );
    // Slot-table normalisation (sPlayerPos for players, Monster.arr for
    // monsters) feeding the occupied/full-span scale factors.
    assert.match(preproccess, /Combat\$Companion_getInstance\(\)\.sPlayerPos\[i\]\.x;/);
    assert.match(preproccess, /Monster\$Companion_getInstance\(\)\.arr\[i_1\]\[0\];/);
    assert.match(
        preproccess,
        /if \(targetCount\.v < slotTotal\) \{[\s\S]{0,700}?this\.animationScaleX_8be2vx\$ = tmp\$_\d+ \/ JsMath\.abs\([a-z_0-9]+\);[\s\S]{0,300}?this\.animationScaleY_8be2vx\$ = tmp\$_\d+ \/ JsMath\.abs\([a-z_0-9]+\);/
    );
    // The draw itself anchors and scales through the shared mechanism.
    assert.match(
        draw,
        /this\.animation_0\.drawAtTargetScaled_eamxi9\$\((canvas, )?this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$, this\.animationScaleX_8be2vx\$, this\.animationScaleY_8be2vx\$\)/
    );
    assert.match(
        source,
        /ResSrs\.prototype\.drawAtTargetScaled_eamxi9\$ = function \(canvas, x, y, sx, sy\) \{[\s\S]{0,900}?var imageIndex = frameHeaders\[frameIndex\]\[4\];\s*if \(imageIndex >= 0 && imageIndex < images\.length\) \{[\s\S]{0,300}?numberToInt\(\(frameHeaders\[frameIndex\]\[0\] - this\.mImpactAnchorX_0 \| 0\) \* sx \+ x\)[\s\S]{0,80}?numberToInt\(\(frameHeaders\[frameIndex\]\[1\] - this\.mImpactAnchorY_0 \| 0\) \* sy \+ y\)/
    );
});

test("all-target attack magic skips dead enemies", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Dead combatants are out of the fight: an all-target spell must neither
    // damage a corpse nor pop a damage number over it. In the fresh compile
    // the dead-skip moved to the CALLER: ActionMagicAttackAll.preproccess
    // filters mTargets into aliveTargets BEFORE casting, passes aliveTargets
    // (not mTargets) to MagicAttack.use_h32lzv$, and raises damage numbers
    // only over aliveTargets. Because the filter runs before use, a target
    // killed by this very spell is still in aliveTargets and pops its real
    // damage number, while a pre-existing corpse is neither damaged nor
    // given a popup.
    const attackAction = source.slice(
        source.indexOf("ActionMagicAttackAll.prototype.preproccess"),
        source.indexOf("ActionMagicAttackAll.prototype.update_s8cxhz$")
    );
    assert.ok(attackAction, "ActionMagicAttackAll.preproccess not found");

    // Filter, then cast on the filtered list — in that order.
    assert.match(
        attackAction,
        /while \(tmp\$_\d+\.hasNext\(\)\) \{\s*var element_1 = tmp\$_\d+\.next\(\);\s*if \(element_1\.isAlive\)\s*destination\.add_11rb\$\((element_1)\);\s*\}\s*var aliveTargets = destination;\s*this\.magic_8be2vx\$\.use_h32lzv\$\((attacker, aliveTargets)\);/
    );
    // The raise-animation loop iterates aliveTargets only (tightly bounded so
    // it cannot be confused with the isAlive filter loop above).
    assert.match(
        attackAction,
        /tmp\$_\d+ = aliveTargets\.iterator\(\);\s*while \(tmp\$_\d+\.hasNext\(\)\) \{\s*var item = tmp\$_\d+\.next\(\);\s*destination_\d*\.add_11rb\$\((item\.diffToAnimation_6taknv\$\(\))\);\s*\}/
    );
    // And the unfiltered list must NOT be passed to the damage step.
    assert.doesNotMatch(
        attackAction,
        /use_h32lzv\$\((attacker, this\.mTargets)\)/
    );
});

test("ordinary healing skips the dead but revive magic raises them", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Death is HP <= 0 and there is no revive flag: revival is just pushing HP
    // positive again. The intended split is by magic subclass — Restore (flat
    // heal / cure-all, e.g. 培元术, 佛光普照) must leave the dead alone, while
    // Auxiliary (the 招魂咒/唤灵术/赦魂术 "起死回生" line) is the revive and
    // must keep affecting KO'd allies.
    const restore = source.slice(
        source.indexOf("MagicRestore.prototype.applyEffect_qwqr58$"),
        source.indexOf("MagicRestore.$metadata$")
    );
    assert.ok(restore, "MagicRestore.applyEffect_qwqr58$ not found");
    // Ordinary Restore magic only heals targets that were alive when the spell
    // landed; the dead branch is a logging-only no-op (no HP write), and the
    // delta override then reports 0 actual restoration for the dead.
    assert.match(restore, /var wasAlive = dst\.hp > 0;\s*var wasDead = dst\.hp <= 0;/);
    assert.match(
        restore,
        /if \(wasAlive && this\.mHp_0 > 0\) \{[\s\S]{0,400}?dst\.hp = dst\.hp \+ this\.mHp_0 \| 0;/
    );
    assert.match(
        restore,
        /else if \(wasDead\) \{\s*println\([^)]*\);\s*\}/
    );

    const auxiliary = source.slice(
        source.indexOf("MagicAuxiliary.prototype.use_qwqr58$"),
        source.indexOf("MagicAuxiliary.$metadata$")
    );
    assert.ok(auxiliary, "MagicAuxiliary.use_qwqr58$ not found");
    // The revive line heals the dead directly (percentage of maxHP) with no
    // isAlive guard, and floors the result at 1 HP so revival always sticks.
    assert.match(
        auxiliary,
        /if \(dst\.hp <= 0\) \{\s*println\([^)]*\);\s*dst\.hp = Typescript\.imul\(dst\.maxHP, this\.mHp_0\) \/ 100 \| 0;/
    );
    assert.match(auxiliary, /if \(dst\.hp <= 0\) \{\s*dst\.hp = 1;\s*\}/);
    assert.doesNotMatch(auxiliary, /if \(!dst\.isAlive\)/);

    // Targeting matches: only the revive line (Auxiliary) can select a KO'd
    // ally (ignoreDead=false); Restore and every other help type keep the
    // dead unselectable (ignoreDead=true). The Kotlin when-chain compiles to
    // a tmp branch chain feeding `var ignoreDead`.
    const helpTargeting = source.slice(
        source.indexOf("CombatUI$MainMenu$onKeyUp$lambda$ObjectLiteral.prototype.onItemSelected_3fncnk$"),
        source.indexOf("CombatUI$MainMenu$onKeyUp$lambda$ObjectLiteral.$metadata$")
    );
    assert.ok(helpTargeting, "CombatUI MainMenu onItemSelected lambda not found");
    assert.match(
        helpTargeting,
        /if \(Typescript\.isType\(magic, MagicAuxiliary\)\) \{[\s\S]{0,300}?tmp\$_\d+ = false;/
    );
    assert.match(
        helpTargeting,
        /else if \(Typescript\.isType\(magic, MagicRestore\)\) \{[\s\S]{0,300}?tmp\$_\d+ = true;/
    );
    assert.match(helpTargeting, /var ignoreDead = tmp\$_\d+;/);
    assert.match(
        helpTargeting,
        /new CombatUI\$MenuCharacterSelect\([\s\S]{0,400}?, ignoreDead\)\);/
    );
});

test("lowering maxHP re-clamps current HP so it can never exceed the cap", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // The hp setter clamps HP to maxHP on every write, but a maxHP decrease
    // must also pull an already-stored HP back down, otherwise current HP can
    // read higher than max HP after unequipping gear or a stat recalculation.
    // The fresh compile quotes defineProperty names with single quotes and
    // re-clamps through the hp property setter (so the [0, maxHP] clamp in
    // the hp setter applies as well).
    const maxHpSetter = source.slice(
        source.indexOf("Object.defineProperty(FightingCharacter.prototype, 'maxHP'"),
        source.indexOf("Object.defineProperty(FightingCharacter.prototype, 'maxMP'")
    );
    assert.ok(maxHpSetter, "FightingCharacter maxHP setter not found");
    assert.match(
        maxHpSetter,
        /set: function \(maxHP\) \{\s*this\.maxHP_aqimg2\$_0 = maxHP;\s*if \(this\.maxHP_aqimg2\$_0 < this\.hp\) \{\s*this\.hp = this\.maxHP_aqimg2\$_0;\s*\}\s*\}/
    );
});

test("hp setter clamps to zero so dead characters never display a false-positive bar", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // The hp setter must clamp HP to [0, maxHP]. Without the lower clamp,
    // overkill damage produces negative HP; drawSmallNum renders the absolute
    // value, so a character at -300/200 HP displays "300 / 200" — HP > maxHP.
    // The setter accumulates the nominal (unclamped) delta first — so damage
    // popups stay honest — and only then clamps the stored HP into
    // [0, maxHP] via JsMath.min/max (Math_0 in the previous hand-patched
    // build; JsMath in the fresh Kotlin compile).
    const hpSetter = source.slice(
        source.indexOf("Object.defineProperty(FightingCharacter.prototype, 'hp'"),
        source.indexOf("Object.defineProperty(FightingCharacter.prototype, 'isAlive'")
    );
    assert.ok(hpSetter, "FightingCharacter hp setter not found");
    assert.match(
        hpSetter,
        /this\.deltaSinceBackup = this\.deltaSinceBackup \+ \(hp - this\.hp_oo4bdu\$_0\) \| 0;\s*var a = this\.maxHP;\s*var b = JsMath\.min\(a, hp\);\s*this\.hp_oo4bdu\$_0 = JsMath\.max\(0, b\);/
    );
});

test("resurrection magic is not retargeted when its target is dead", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const prepare = source.slice(
        source.indexOf("ActionExecutor.prototype.prepareAction_0"),
        source.indexOf("ActionExecutor.prototype.draw_9in0vv$")
    );
    assert.ok(prepare, "ActionExecutor.prepareAction_0 not found");

    // prepareAction_0 redirects single-target actions away from dead targets
    // to a random alive one when the original target died mid-round.  But
    // resurrection actions intentionally target the dead — the dead target is
    // the whole point — so the executor must NOT retarget them.  The fresh
    // compile recognises two revival shapes, keeping the Kotlin variable
    // names: a type-10 (起死回生) goods used via ActionUseItemOne, and
    // ActionMagicHelpOne carrying MagicAuxiliary.
    assert.match(
        prepare,
        /var tmp\$_\d+ = Typescript\.isType\(this\.mCurrentAction_0, ActionUseItemOne\);[\s\S]{0,250}?\.goods_8be2vx\$\.type === 10;[\s\S]{0,80}?var isRevivalItemAction = tmp\$_\d+;/
    );
    assert.match(
        prepare,
        /var tmp\$_\d+ = Typescript\.isType\(this\.mCurrentAction_0, ActionMagicHelpOne\);[\s\S]{0,250}?magic_8be2vx\$, MagicAuxiliary\);[\s\S]{0,80}?var isRevivalMagicAction = tmp\$_\d+;/
    );
    // The revival branch keeps the dead target (it only logs); the retarget
    // lookup (newTarget) lives in the else branch.
    assert.match(
        prepare,
        /if \(isRevivalItemAction \|\| isRevivalMagicAction\) \{\s*println\([^)]*\);\s*\} else \{[\s\S]{0,500}?var newTarget = tmp\$_\d+;/
    );
});

test("revive magic uses max(0, hp) so overkill damage cannot prevent revival", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // MagicAuxiliary's death branch heals by a percentage of maxHP. The fresh
    // Kotlin source no longer ADDS the heal to the current (possibly deeply
    // negative, overkill) HP — it assigns imul(maxHP, mHp)/100 directly in
    // the dst.hp <= 0 branch, which is algebraically identical to using
    // max(0, hp) as the base: the negative HP never enters the sum. The
    // additive form is only used on the alive branch, and a <= 0 result is
    // floored to 1 so revival always sticks.
    const auxiliary = source.slice(
        source.indexOf("MagicAuxiliary.prototype.use_qwqr58$"),
        source.indexOf("MagicAuxiliary.$metadata$")
    );
    assert.ok(auxiliary, "MagicAuxiliary.use_qwqr58$ not found");
    assert.match(
        auxiliary,
        /if \(dst\.hp <= 0\) \{\s*println\([^)]*\);\s*dst\.hp = Typescript\.imul\(dst\.maxHP, this\.mHp_0\) \/ 100 \| 0;/
    );
    assert.match(auxiliary, /if \(dst\.hp <= 0\) \{\s*dst\.hp = 1;\s*\}/);
});

test("SRS anchor takes the area-weighted visual centre of simple frames", () => {
    const headers = [
        [10, 20, 2, 2, 0],
        [30, 40, 2, 2, 0],
        [50, 60, 2, 2, 0],
    ];
    const images = [{ width: 10, height: 6 }];

    // Each frame is 10x6 at centres (15,23), (35,43), (55,63): the shared
    // anchor is the area-weighted mean (35,43), not the last frame.
    assert.deepEqual(SrsAnchor.compute(headers, images), { x: 35, y: 43 });
});

test("SRS anchor centers the peak group and ignores invalid image records", () => {
    const headers = [
        [0, 0, 10, 2, 0],
        [20, 10, 4, 1, 0],
        [200, 200, 4, 1, 9],
        [40, 20, 4, 1, 0],
    ];
    const images = [{ width: 10, height: 10 }];

    assert.equal(SrsAnchor.imageFor(headers[2], images), null);
    assert.deepEqual(SrsAnchor.compute(headers, images), { x: 25, y: 15 });
});

test("FML flying-sword anchor uses the shared visual centre", () => {
    const animation = readSrs("fml.lib", 2, 2);

    assert.deepEqual(
        SrsAnchor.compute(animation.frameHeaders, animation.images),
        { x: 81, y: 51 }
    );
});

test("佛光普照 aligns its authored group with the current player formation", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const animation = readSrs("fmj_zsb.lib", 2, 11);
    const targetCenter = {
        x: (76 + 108 + 140) / 3 | 0,
        y: (70 + 66 + 58) / 3 | 0,
    };

    assert.deepEqual(
        SrsAnchor.compute(animation.frameHeaders, animation.images),
        { x: 76, y: 65 }
    );
    assert.deepEqual(targetCenter, { x: 108, y: 64 });
    // The all-target heal draws the authored group through
    // ResSrs.drawAtTargetScaled: the party centroid lands in mAnix/mAniy, the
    // occupied/full-formation span lands in the scale factors, and each frame
    // is offset by the shared impact anchor (mImpactAnchorX/Y from
    // BBKSrsAnchor.compute) inside the draw routine.
    assert.match(
        source,
        /ActionMagicHelpAll\.prototype\.draw_9in0vv\$[\s\S]{0,600}?drawAtTargetScaled_eamxi9\$\((canvas, )?this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$, this\.animationScaleX_8be2vx\$, this\.animationScaleY_8be2vx\$\)/
    );
    assert.match(
        source,
        /ResSrs\.prototype\.drawAtTargetScaled_eamxi9\$[\s\S]{0,900}?frameHeaders\[frameIndex\]\[0\] - this\.mImpactAnchorX_0 \| 0\) \* sx \+ x/
    );
});

test("every bundled SRS can calculate a safe finite anchor", () => {
    const romsUrl = new URL("../rpg/roms/", import.meta.url);
    const files = readdirSync(romsUrl).filter((file) => file.endsWith(".lib"));
    let animationCount = 0;
    let invalidImageRecordCount = 0;

    for (const file of files) {
        const buffer = readFileSync(new URL(file, romsUrl));
        const entries = readLibraryEntries(buffer);

        for (const entry of entries) {
            if (entry.resourceType !== 5) {
                continue;
            }

            const animation = readSrsAt(buffer, entry.offset);
            invalidImageRecordCount += animation.frameHeaders.filter(
                (header) => header[4] >= animation.images.length
            ).length;

            const anchor = SrsAnchor.compute(
                animation.frameHeaders,
                animation.images
            );
            assert.equal(Number.isFinite(anchor.x), true, `${file} SRS ${entry.index} x`);
            assert.equal(Number.isFinite(anchor.y), true, `${file} SRS ${entry.index} y`);
            animationCount += 1;
        }
    }

    assert.ok(animationCount > 6000);
    assert.ok(invalidImageRecordCount > 0);
});
