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

    assert.match(
        source,
        /"耗真气:"\s*\+\s*toString\(this\.magics_0\[this\.mCurItemIndex_0\]\.costMp\)/
    );
    assert.doesNotMatch(
        source,
        /"耗真气:"\s*\+\s*toString\(hlMagic\.costMp\)/
    );
    assert.match(loader, /script\.src\s*=\s*"core\.js\?v=16"/);
});

test("thrown/used goods are refunded when their target dies before the action runs", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Item count is deducted at selection time (deleteGoods) and the throw/use
    // action is queued. If the target dies before the action executes, the
    // action is dropped in prepareAction_0; it must call cancel() (which
    // addGoods the item back) instead of silently losing the goods.

    // Multi-target drop (no surviving target): cancel() before nulling the action.
    assert.match(
        source,
        /isTargetAlive[\s\S]*?isSingleTarget[\s\S]*?ensureNotNull\(this\.mCurrentAction_0\)\.cancel\(\);\s*this\.mCurrentAction_0 = null;/
    );
    // Single-target drop (no alive target to retarget): cancel() before postAction_1().
    assert.match(
        source,
        /newTarget == null\) \{\s*ensureNotNull\(this\.mCurrentAction_0\)\.cancel\(\);\s*this\.postAction_1\(\);/
    );
    // The refund is what cancel() does for throw/use-item actions.
    assert.match(
        source,
        /ActionThrowItemOne\.prototype\.cancel = function\(\) \{[\s\S]*?addGoods_6xxg66\$/
    );
});

test("healing applies coerced HP values through a reusable target effect", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    assert.match(
        source,
        /MagicRestore\.prototype\.applyToTarget_qpjxya\$\s*=\s*function\(dst\)[\s\S]*?var currentHp\s*=\s*dst\.hp\s*\|\s*0;[\s\S]*?var restoredHp\s*=\s*this\.mHp_0\s*\|\s*0;[\s\S]*?dst\.hp\s*=\s*currentHp\s*\+\s*restoredHp\s*\|\s*0;/
    );
    assert.equal(("84" | 0) + ("4" | 0), 88);
});

test("all-target healing pays once and applies healing to every target", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");
    const action = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.preproccess"),
        source.indexOf("ActionMagicHelpAll.prototype.update_s8cxhz$")
    );

    assert.match(
        action,
        /attacker\.mp\s*=\s*attacker\.mp\s*-\s*this\.magic_8be2vx\$\.costMp\s*\|\s*0;/
    );
    assert.match(
        action,
        /while\s*\(tmp\$_1\.hasNext\(\)\)[\s\S]*?applyToTarget_qpjxya\$\(restoreTarget\)/
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
        /this\.mMonster_0\.combatY\s*-\s*\(ensureNotNull\(this\.mMonster_0\.fightingSprite\)\.height\s*\/\s*2\s*\|\s*0\)\s*\|\s*0/
    );

    const attackDraw = source.slice(
        source.indexOf("ActionMagicAttackOne.prototype.draw_9in0vv$"),
        source.indexOf("ActionMagicAttackOne.prototype.rollbackToPhysical")
    );
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

    // The group effect must be centred on the current enemy formation (mean
    // combat position of the targets), not drawn at the ROM's raw coordinates
    // which sit over the player party.
    assert.match(
        action,
        /targetX\s*=\s*targetX\s*\+\s*element\.combatX\s*\|\s*0;/
    );
    assert.match(
        action,
        /this\.animationX_0\s*=\s*targetX\s*\/\s*targetCount\s*\|\s*0;/
    );
    assert.match(
        draw,
        /drawAtTarget_2g4tob\$\(canvas, this\.animationX_0, this\.animationY_0\)/
    );
    assert.doesNotMatch(draw, /draw_2g4tob\$\(canvas, 0, 0\)/);
});

test("single-target help, throw and use-item effects render at the target anchor", () => {
    // The climax-anchor heuristic (drawAtTarget via BBKSrsAnchor.compute) placed
    // spell/item particle bursts off the target. Single-target help magic,
    // thrown weapons and used items revert to the device-accurate behaviour:
    // anchor the authored frame 0 at the target coordinate via drawAbsolutely.
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    const cases = [
        {
            name: "ActionMagicHelpOne",
            start: "ActionMagicHelpOne.prototype.draw_9in0vv$",
            end: "ActionMagicHelpOne.prototype.rollbackToPhysical",
            call: /drawAbsolutely_2g4tob\$\(canvas, this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$\)/,
        },
        {
            name: "ActionThrowItemOne",
            start: "ActionThrowItemOne.prototype.draw_9in0vv$",
            end: "ActionThrowItemOne.prototype.cancel",
            call: /drawAbsolutely_2g4tob\$\(canvas, this\.mAniX_0, this\.mAniY_0\)/,
        },
        {
            name: "ActionUseItemOne",
            start: "ActionUseItemOne.prototype.draw_9in0vv$",
            end: "ActionUseItemOne.prototype.cancel",
            call: /drawAbsolutely_2g4tob\$\(canvas, this\.mAnix_8be2vx\$, this\.mAniy_8be2vx\$\)/,
        },
    ];

    for (const { name, start, end, call } of cases) {
        const body = source.slice(source.indexOf(start), source.indexOf(end));
        assert.ok(body, `${name} draw method not found`);
        assert.match(body, call, `${name} should anchor at the target via drawAbsolutely`);
        assert.doesNotMatch(body, /drawAtTarget_2g4tob/, `${name} must not use the climax anchor`);
    }
});

test("multi-target healing still aligns via the shared SRS anchor", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // The SRS anchor module stays wired for the all-target heal effect, which
    // centres its authored group on the current party formation.
    assert.match(
        source,
        /BBKSrsAnchor\.compute\(this\.mFrameHeader_0, this\.mImage_0\)/
    );
    assert.match(
        source,
        /BBKSrsAnchor\.imageFor\(this\.mFrameHeader_0\[index\], this\.mImage_0\)/
    );
    assert.match(
        source,
        /ActionMagicHelpAll[\s\S]*?drawAtTarget_2g4tob\$\(canvas, this\.animationX_0, this\.animationY_0\)/
    );
});

test("all-target attack magic skips dead enemies", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Dead combatants are out of the fight: an all-target spell must neither
    // damage a corpse nor pop a damage number over it. MagicAttack.use_h32lzv$
    // (used by ActionMagicAttackAll and multi-target ActionCoopMagic) skips
    // every target whose HP is at or below zero.
    const multiAttack = source.slice(
        source.indexOf("MagicAttack.prototype.use_h32lzv$"),
        source.indexOf("MagicAttack.$metadata$")
    );
    assert.match(multiAttack, /var fc = tmp\$\.next\(\);\s*\/\/ Dead combatants[\s\S]*?if \(!fc\.isAlive\) \{\s*continue;\s*\}/);

    // ActionMagicAttackAll also only raises a number animation for living
    // targets, so a dead enemy shows no popup.
    const attackAction = source.slice(
        source.indexOf("ActionMagicAttackAll.prototype.preproccess"),
        source.indexOf("ActionMagicAttackAll.prototype.update_s8cxhz$")
    );
    assert.match(attackAction, /while \(tmp\$_2\.hasNext\(\)\) \{\s*var item = tmp\$_2\.next\(\);\s*if \(item\.isAlive\) \{\s*destination\.add_11rb/);
});

test("ordinary healing skips the dead but revive magic raises them", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // Death is HP <= 0 and there is no revive flag: revival is just pushing HP
    // positive again. The intended split is by magic subclass — Restore (flat
    // heal / cure-all, e.g. 培元术, 佛光普照) must leave the dead alone, while
    // Auxiliary (the 招魂咒/唤灵术/赦魂术 "起死回生" line) is the revive and
    // must keep affecting KO'd allies.
    const restore = source.slice(
        source.indexOf("MagicRestore.prototype.applyToTarget"),
        source.indexOf("MagicRestore.prototype.use_qwqr58$")
    );
    assert.match(restore, /if \(!dst\.isAlive\) \{\s*return;\s*\}/);

    const auxiliary = source.slice(
        source.indexOf("MagicAuxiliary.prototype.use_qwqr58$"),
        source.indexOf("MagicAuxiliary.$metadata$")
    );
    // The revive line heals directly with no isAlive guard.
    assert.match(auxiliary, /function\(src, dst\) \{\s*\/\/ Auxiliary magic is the revive line[\s\S]*?var a = dst\.maxHP;/);
    assert.doesNotMatch(auxiliary, /if \(!dst\.isAlive\)/);

    // All-target help is healing/buffing (the revive line is single-target),
    // so it raises a number only for living targets — a dead ally gets no popup.
    const helpAction = source.slice(
        source.indexOf("ActionMagicHelpAll.prototype.preproccess"),
        source.indexOf("ActionMagicHelpAll.prototype.update_s8cxhz$")
    );
    assert.match(helpAction, /while \(tmp\$_3\.hasNext\(\)\) \{\s*var item = tmp\$_3\.next\(\);[\s\S]*?if \(item\.isAlive\) \{\s*destination\.add_11rb/);

    // Targeting matches: only the revive line (Auxiliary) can select a KO'd
    // ally; ordinary single-target help/buffing skips the dead with the cursor.
    const helpTargeting = source.slice(
        source.indexOf("MagicAttack.prototype.use_h32lzv$") >= 0
            ? source.lastIndexOf("CombatUI$MainMenu$onKeyUp$lambda$ObjectLiteral.prototype.onItemSelected_3fncnk$")
            : 0,
        source.indexOf("CombatUI$MainMenu$onKeyUp$lambda$ObjectLiteral.$metadata$")
    );
    assert.match(helpTargeting, /var ignoreDead = !Typescript\.isType\(magic, MagicAuxiliary\);/);
});

test("lowering maxHP re-clamps current HP so it can never exceed the cap", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // The hp setter clamps HP to maxHP on every write, but a maxHP decrease
    // must also pull an already-stored HP back down, otherwise current HP can
    // read higher than max HP after unequipping gear or a stat recalculation.
    const maxHpSetter = source.slice(
        source.indexOf('Object.defineProperty(FightingCharacter.prototype, "maxHP"'),
        source.indexOf('Object.defineProperty(FightingCharacter.prototype, "maxMP"')
    );
    assert.match(
        maxHpSetter,
        /set: function\(maxHP\) \{\s*this\.maxHP_aqimg2\$_0 = Math_0\.min\(999, maxHP\);\s*\/\/ HP can never exceed maxHP[\s\S]*?if \(this\.hp_oo4bdu\$_0 > this\.maxHP_aqimg2\$_0\) \{\s*this\.hp_oo4bdu\$_0 = this\.maxHP_aqimg2\$_0;\s*\}/
    );
});

test("hp setter clamps to zero so dead characters never display a false-positive bar", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // The hp setter must clamp HP to [0, maxHP]. Without the lower clamp,
    // overkill damage produces negative HP; drawSmallNum renders the absolute
    // value, so a character at -300/200 HP displays "300 / 200" — HP > maxHP.
    const hpSetter = source.slice(
        source.indexOf('Object.defineProperty(FightingCharacter.prototype, "hp"'),
        source.indexOf('Object.defineProperty(FightingCharacter.prototype, "isAlive"')
    );
    assert.match(
        hpSetter,
        /this\.hp_oo4bdu\$_0\s*=\s*Math_0\.max\(0,\s*Math_0\.min\(a,\s*hp\)\)/
    );
});

test("resurrection magic is not retargeted when its target is dead", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // prepareAction_0 redirects single-target actions away from dead targets
    // to a random alive one when the original target died mid-round.  But
    // resurrection magic (ActionMagicHelpOne + MagicAuxiliary) intentionally
    // targets the dead — the dead target is the whole point.  The executor
    // must NOT retarget a revive spell.
    const prepare = source.slice(
        source.indexOf("ActionExecutor.prototype.prepareAction_0"),
        source.indexOf("ActionExecutor.prototype.draw_9in0vv$")
    );
    assert.match(
        prepare,
        /var isRevive = Typescript\.isType\(this\.mCurrentAction_0, ActionMagicHelpOne\) && Typescript\.isType\(this\.mCurrentAction_0\.magic_8be2vx\$, MagicAuxiliary\);/
    );
    assert.match(prepare, /if \(!isRevive\) \{/);
});

test("revive magic uses max(0, hp) so overkill damage cannot prevent revival", () => {
    const source = readFileSync(new URL("../rpg/core.js", import.meta.url), "utf8");

    // MagicAuxiliary.use_qwqr58$ adds a percentage-based heal to the current
    // HP. If the character died from overkill (HP deeply negative), adding the
    // heal to the negative value can still leave them at or below zero — dead.
    // Using max(0, hp) as the base prevents this.
    const auxiliary = source.slice(
        source.indexOf("MagicAuxiliary.prototype.use_qwqr58$"),
        source.indexOf("MagicAuxiliary.$metadata$")
    );
    assert.match(
        auxiliary,
        /var b = Math_0\.max\(0, dst\.hp\)/
    );
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
    assert.match(
        source,
        /ActionMagicHelpAll[\s\S]*?drawAtTarget_2g4tob\$\(canvas, this\.animationX_0, this\.animationY_0\)/
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
