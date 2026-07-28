import test from "node:test";
import assert from "node:assert/strict";

await import("../sanguobaye/js/backup.js");

const B = globalThis.BBKBackup;
const SGBY = B.getProfile("baye/SGBY");
const WHXF = B.getProfile("baye/whxf");
const SCMOD = B.getProfile("baye/sc-mod");

function makeStore(initial = {}) {
    const values = { ...initial };
    return {
        get: (key) => (key in values ? values[key] : null),
        set(key, value) {
            values[key] = String(value);
        },
        remove(key) {
            delete values[key];
        },
        raw: values,
    };
}

test("三个当前版本对应独立存档空间", () => {
    assert.deepEqual(
        SGBY.slotKeys(0),
        [
            "baye//data//sango0.sav@SGBY",
            "baye//data//sango1.sav@SGBY",
        ]
    );
    assert.deepEqual(
        WHXF.slotKeys(1),
        [
            "baye//data//sango2.sav@whxf",
            "baye//data//sango3.sav@whxf",
        ]
    );
    assert.deepEqual(
        SCMOD.slotKeys(2),
        [
            "baye//data//sango4.sav@sc-mod",
            "baye//data//sango5.sav@sc-mod",
        ]
    );
    assert.deepEqual(
        B.BAYE_LIBS.map((lib) => lib.id),
        ["SGBY", "whxf", "sc-mod"]
    );
});

test("导出当前格式并标注来源版本", () => {
    const store = makeStore({
        "baye//data//sango0.sav@SGBY": "AAA",
        "baye//data//sango1.sav@SGBY": "BBB",
    });

    assert.deepEqual(B.buildExportPayload(SGBY, 0, store.get), {
        app: "bbk-games",
        type: "bbk-save-slot",
        ver: 2,
        game: "baye/SGBY",
        gameName: "三国霸业-原版精修",
        slot: 0,
        files: ["AAA", "BBB"],
    });
});

test("空槽不导出", () => {
    assert.equal(B.buildExportPayload(SGBY, 0, makeStore().get), null);
});

test("不同版本的存档互不可见", () => {
    const store = makeStore({
        "baye//data//sango0.sav@SGBY": "SGBY-A",
        "baye//data//sango1.sav@SGBY": "SGBY-B",
        "baye//data//sango0.sav@whxf": "WHXF-A",
        "baye//data//sango1.sav@whxf": "WHXF-B",
    });

    assert.deepEqual(
        B.buildExportPayload(SGBY, 0, store.get).files,
        ["SGBY-A", "SGBY-B"]
    );
    assert.deepEqual(
        B.buildExportPayload(WHXF, 0, store.get).files,
        ["WHXF-A", "WHXF-B"]
    );
});

test("解析器只接受当前完整格式", () => {
    const valid = {
        app: "bbk-games",
        type: "bbk-save-slot",
        ver: 2,
        game: "baye/SGBY",
        gameName: "三国霸业-原版精修",
        slot: 0,
        files: ["AAA", "BBB"],
    };

    assert.deepEqual(B.parseBackup(valid), {
        profileId: "baye/SGBY",
        slot: 0,
        files: ["AAA", "BBB"],
    });
    assert.equal(B.parseBackup({ ...valid, app: "other" }), null);
    assert.equal(B.parseBackup({ ...valid, type: "other" }), null);
    assert.equal(B.parseBackup({ ...valid, ver: 1 }), null);
    assert.equal(B.parseBackup({ ...valid, game: "unknown" }), null);
    assert.equal(B.parseBackup({ ...valid, slot: 3 }), null);
    assert.equal(B.parseBackup({ ...valid, files: ["AAA"] }), null);
});

test("还原严格匹配版本", () => {
    const parsed = {
        profileId: "baye/SGBY",
        slot: 0,
        files: ["AAA", "BBB"],
    };

    assert.equal(B.canRestore(parsed, SGBY), true);
    assert.equal(B.canRestore(parsed, WHXF), false);
    assert.equal(B.canRestore(parsed, null), false);
    assert.equal(B.canRestore(null, SGBY), false);
});

test("备份可以还原到同版本的其他槽位", () => {
    const store = makeStore({
        "baye//data//sango0.sav@SGBY": "AAA",
        "baye//data//sango1.sav@SGBY": "BBB",
    });
    const payload = B.buildExportPayload(SGBY, 0, store.get);
    const parsed = B.parseBackup(payload);

    assert.equal(B.applyRestore(SGBY, 2, parsed.files, store.set), true);
    assert.equal(store.raw["baye//data//sango4.sav@SGBY"], "AAA");
    assert.equal(store.raw["baye//data//sango5.sav@SGBY"], "BBB");
    assert.equal(store.raw["baye//data//sango4.sav@whxf"], undefined);
});

test("Unicode 存档内容无损往返", () => {
    const content = "中文/emoji🎮/换行\n数据";
    const store = makeStore({
        "baye//data//sango2.sav@sc-mod": content,
        "baye//data//sango3.sav@sc-mod": "XYZ",
    });
    const parsed = B.parseBackup(
        B.buildExportPayload(SCMOD, 1, store.get)
    );

    assert.equal(
        B.applyRestore(SCMOD, 1, parsed.files, store.set),
        true
    );
    assert.equal(store.raw["baye//data//sango2.sav@sc-mod"], content);
});

test("还原第二个文件失败时回滚已有数据", () => {
    const store = makeStore({
        "baye//data//sango0.sav@SGBY": "OLD-A",
        "baye//data//sango1.sav@SGBY": "OLD-B",
    });
    let failed = false;
    function failSecondKey(key, value) {
        if (key.endsWith("sango1.sav@SGBY") &&
                value === "NEW-B" &&
                !failed) {
            failed = true;
            return false;
        }
        store.set(key, value);
        return true;
    }

    assert.equal(
        B.applyRestore(
            SGBY,
            0,
            ["NEW-A", "NEW-B"],
            failSecondKey,
            store.get,
            store.remove
        ),
        false
    );
    assert.equal(store.raw["baye//data//sango0.sav@SGBY"], "OLD-A");
    assert.equal(store.raw["baye//data//sango1.sav@SGBY"], "OLD-B");
});

test("还原到空槽失败时移除部分写入", () => {
    const store = makeStore();
    function failSecondKey(key, value) {
        if (key.endsWith("sango1.sav@SGBY")) return false;
        store.set(key, value);
        return true;
    }

    assert.equal(
        B.applyRestore(
            SGBY,
            0,
            ["NEW-A", "NEW-B"],
            failSecondKey,
            store.get,
            store.remove
        ),
        false
    );
    assert.deepEqual(store.raw, {});
});

test("非法槽位和文件结构不会写入", () => {
    const store = makeStore();

    assert.equal(B.applyRestore(SGBY, -1, ["A", "B"], store.set), false);
    assert.equal(B.applyRestore(SGBY, 0, ["A"], store.set), false);
    assert.equal(B.applyRestore(SGBY, 0, ["A", {}], store.set), false);
    assert.deepEqual(store.raw, {});
});

test("备份文件名包含版本和槽位", () => {
    assert.equal(
        B.fileName(SGBY, 0, "20260729"),
        "bbk-baye-SGBY-save-1-20260729.json"
    );
    assert.equal(
        B.fileName(SCMOD, 2, "20260729"),
        "bbk-baye-sc-mod-save-3-20260729.json"
    );
});

test("从当前库路径提取版本标识", () => {
    assert.equal(B.libIdFromPath("libs/SGBY.lib"), "SGBY");
    assert.equal(B.libIdFromPath("libs/whxf.lib"), "whxf");
    assert.equal(B.libIdFromPath("libs/sc-mod.lib"), "sc-mod");
    assert.equal(B.libIdFromPath(""), "");
});
