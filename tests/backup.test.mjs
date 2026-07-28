import test from 'node:test';
import assert from 'node:assert/strict';

// 以 ES module 方式加载 js/backup.js，对象挂在主 realm 的 globalThis.BBKBackup
await import('../js/backup.js');
const B = globalThis.BBKBackup;
const { SAVE_PROFILES } = B;

// localStorage-like 存储：get 返回原始值（缺失为 null），set 写入
function makeStore(initial = {}) {
    const s = { ...initial };
    return {
        get: (k) => (k in s ? s[k] : null),
        set(k, v) { s[k] = String(v); },
        remove(k) { delete s[k]; },
        raw: s,
    };
}

const SGBY = SAVE_PROFILES['baye/SGBY'];
const WHXF = SAVE_PROFILES['baye/whxf'];
const SCMOD = SAVE_PROFILES['baye/sc-mod'];

// ---------- baye profile 结构 ----------

test('baye 每个版本是独立 profile，slotKeys 带 @libId 后缀', () => {
    assert.deepEqual(SGBY.slotKeys(0), ['baye//data//sango0.sav@SGBY', 'baye//data//sango1.sav@SGBY']);
    assert.deepEqual(WHXF.slotKeys(1), ['baye//data//sango2.sav@whxf', 'baye//data//sango3.sav@whxf']);
    assert.deepEqual(SCMOD.slotKeys(2), ['baye//data//sango4.sav@sc-mod', 'baye//data//sango5.sav@sc-mod']);
});

test('baye legacySlotKeys 为旧的无后缀共享 key', () => {
    assert.deepEqual(SGBY.legacySlotKeys(0), ['baye//data//sango0.sav', 'baye//data//sango1.sav']);
});

test('三个 baye 版本对应三个独立 profile', () => {
    assert.equal(B.BAYE_LIBS.length, 3);
    assert.deepEqual(B.BAYE_LIBS.map((l) => l.id), ['SGBY', 'whxf', 'sc-mod']);
});

// ---------- baye 导出 ----------

test('baye 导出：game 标注来源版本，payload 不再迁移版本元数据', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'AAA',
        'baye//data//sango1.sav@SGBY': 'BBB',
    });
    const payload = B.buildExportPayload(SGBY, 0, store.get);
    assert.equal(payload.app, 'bbk-games');
    assert.equal(payload.type, 'bbk-save-slot');
    assert.equal(payload.ver, 2);
    assert.equal(payload.game, 'baye/SGBY');
    assert.equal(payload.gameName, '三国霸业-原版精修');
    assert.equal(payload.slot, 0);
    assert.deepEqual(payload.files, ['AAA', 'BBB']);
    assert.equal(payload.version, undefined);
});

test('baye 空槽不导出', () => {
    const store = makeStore({});
    assert.equal(B.buildExportPayload(SGBY, 1, store.get), null);
});

test('baye 三版本存档互不可见', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'SGBY-0',
        'baye//data//sango1.sav@SGBY': 'SGBY-1',
        'baye//data//sango0.sav@whxf': 'WHXF-0',
        'baye//data//sango1.sav@whxf': 'WHXF-1',
    });
    assert.deepEqual(B.buildExportPayload(SGBY, 0, store.get).files, ['SGBY-0', 'SGBY-1']);
    assert.deepEqual(B.buildExportPayload(WHXF, 0, store.get).files, ['WHXF-0', 'WHXF-1']);
});

test('baye 导出回退：版本空间为空时读取旧共享存档', () => {
    const store = makeStore({
        'baye//data//sango0.sav': 'LEGACY-A',
        'baye//data//sango1.sav': 'LEGACY-B',
    });
    assert.deepEqual(B.buildExportPayload(SGBY, 0, store.get).files, ['LEGACY-A', 'LEGACY-B']);
});

test('导出不使用旧存档覆盖当前空间中的显式空值', () => {
    const store = makeStore({
        'sav/伏魔记/fmjsave0': '',
        'sav/fmjsave0': 'LEGACY',
    });

    assert.equal(
        B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get),
        null
    );
});

// ---------- baye 还原（严格版本匹配）----------

test('baye 往返：还原到另一槽，仅写入同一版本空间', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'AAA',
        'baye//data//sango1.sav@SGBY': 'BBB',
    });
    const payload = B.buildExportPayload(SGBY, 0, store.get);
    delete store.raw['baye//data//sango0.sav@SGBY'];
    delete store.raw['baye//data//sango1.sav@SGBY'];

    const parsed = B.parseBackup(payload);
    assert.equal(parsed.profileId, 'baye/SGBY');
    assert.equal(B.applyRestore(SGBY, 2, parsed.files, parsed.version, store.set), true);

    assert.equal(store.raw['baye//data//sango4.sav@SGBY'], 'AAA');
    assert.equal(store.raw['baye//data//sango5.sav@SGBY'], 'BBB');
    // 不污染其他版本空间，也不写无后缀的旧 key
    assert.equal(store.raw['baye//data//sango4.sav@whxf'], undefined);
    assert.equal(store.raw['baye//data//sango4.sav'], undefined);
});

test('canRestore：baye 备份严格匹配版本，跨版本被拒绝', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'X',
        'baye//data//sango1.sav@SGBY': 'Y',
    });
    const parsed = B.parseBackup(B.buildExportPayload(SGBY, 0, store.get));
    assert.equal(B.canRestore(parsed, SGBY), true);
    assert.equal(B.canRestore(parsed, WHXF), false);
    assert.equal(B.canRestore(parsed, SCMOD), false);
});

test('canRestore：baye 备份不能还原到 fmj 游戏，反之亦然', () => {
    const bayeStore = makeStore({
        'baye//data//sango0.sav@SGBY': 'X',
        'baye//data//sango1.sav@SGBY': 'Y',
    });
    const bayeParsed = B.parseBackup(B.buildExportPayload(SGBY, 0, bayeStore.get));
    assert.equal(B.canRestore(bayeParsed, SAVE_PROFILES['fmj/伏魔记']), false);

    const fmjStore = makeStore({ 'sav/伏魔记/fmjsave0': 'Z' });
    const fmjParsed = B.parseBackup(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, fmjStore.get));
    assert.equal(B.canRestore(fmjParsed, SGBY), false);
});

// ---------- baye legacy 兼容 ----------

test('legacy sango-save-slot 带 libpath：识别版本并严格匹配', () => {
    const legacy = {
        app: 'bbk-games', type: 'sango-save-slot', ver: 1,
        libname: '霸哥自制版', libpath: 'libs/sc-mod.lib',
        slot: 0, files: ['AAA', 'BBB'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, 'baye/sc-mod');
    assert.equal(B.canRestore(parsed, SCMOD), true);
    assert.equal(B.canRestore(parsed, SGBY), false);

    const store = makeStore({});
    B.applyRestore(SCMOD, 1, parsed.files, parsed.version, store.set);
    assert.equal(store.raw['baye//data//sango2.sav@sc-mod'], 'AAA');
    assert.equal(store.raw['baye//data//sango3.sav@sc-mod'], 'BBB');
});

test('legacy sango-save-slot 无 libpath：允许还原到任意 baye 版本', () => {
    const legacy = {
        app: 'bbk-games', type: 'sango-save-slot', ver: 1,
        slot: 0, files: ['AAA', 'BBB'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, B.LEGACY_BAYE_ID);
    assert.equal(B.canRestore(parsed, SGBY), true);
    assert.equal(B.canRestore(parsed, WHXF), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), false);
});

test('legacy baye 备份（game=baye + version.libpath）识别版本', () => {
    const legacy = {
        app: 'bbk-games', type: 'bbk-save-slot', ver: 2,
        game: 'baye', gameName: '三国霸业',
        slot: 0,
        version: { 'baye/libname': '无痕修复版', 'baye/libpath': 'libs/whxf.lib' },
        files: ['AAA', 'BBB'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, 'baye/whxf');
    assert.equal(B.canRestore(parsed, WHXF), true);
    assert.equal(B.canRestore(parsed, SGBY), false);
});

test('legacy baye 备份无 version：允许还原到任意 baye 版本', () => {
    const legacy = {
        app: 'bbk-games', type: 'bbk-save-slot', ver: 2,
        game: 'baye', slot: 0, files: ['AAA', 'BBB'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, B.LEGACY_BAYE_ID);
    assert.equal(B.canRestore(parsed, SGBY), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), false);
});

// ---------- fmj（保留，验证未回归）----------

test('fmj 导出：按游戏隔离的单文件存档', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'FMJ-DATA' });
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get);
    assert.equal(payload.game, 'fmj/伏魔记');
    assert.equal(payload.gameName, '伏魔记');
    assert.deepEqual(payload.files, ['FMJ-DATA']);
    assert.equal(payload.version, undefined);
});

test('fmj 五个游戏各自独立，互不可见', () => {
    const store = makeStore({ 'sav/金庸群侠传/fmjsave0': 'JYX-DATA' });
    assert.equal(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get), null);
    assert.deepEqual(B.buildExportPayload(SAVE_PROFILES['fmj/金庸群侠传'], 0, store.get).files, ['JYX-DATA']);
});

test('fmj 导出回退：游戏空间为空时读取旧共享存档', () => {
    const store = makeStore({ 'sav/fmjsave1': 'LEGACY' });
    assert.deepEqual(B.buildExportPayload(SAVE_PROFILES['fmj/侠客行'], 1, store.get).files, ['LEGACY']);
});

test('fmj 空槽不导出', () => {
    assert.equal(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, makeStore().get), null);
});

test('fmj 往返：还原到另一槽，写入游戏独立空间', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'FMJ1' });
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get);
    delete store.raw['sav/伏魔记/fmjsave0'];

    const parsed = B.parseBackup(payload);
    assert.equal(parsed.profileId, 'fmj/伏魔记');
    assert.equal(parsed.version, null);
    assert.equal(B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 2, parsed.files, parsed.version, store.set), true);
    assert.equal(store.raw['sav/伏魔记/fmjsave2'], 'FMJ1');
    assert.equal(store.raw['sav/fmjsave2'], undefined);
});

test('向后兼容：旧 fmj 共享存档备份可还原到任意 fmj 游戏', () => {
    const legacy = {
        app: 'bbk-games', type: 'bbk-save-slot', ver: 2,
        game: 'fmj', gameName: 'RPG（伏魔记等）',
        slot: 0, files: ['OLD-FMJ'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, 'fmj');
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/金庸群侠传']), true);
    assert.equal(B.canRestore(parsed, SGBY), false);

    const store = makeStore({});
    B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 0, parsed.files, parsed.version, store.set);
    assert.equal(store.raw['sav/伏魔记/fmjsave0'], 'OLD-FMJ');
});

// ---------- 通用解析 / canRestore / 文件名 ----------

test('canRestore：不同游戏 / 不同组的备份被拒绝', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'X' });
    const parsed = B.parseBackup(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get));
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/金庸群侠传']), false);
    assert.equal(B.canRestore(parsed, SGBY), false);
    assert.equal(B.canRestore(parsed, null), false);
    assert.equal(B.canRestore(null, SAVE_PROFILES['fmj/伏魔记']), false);
});

test('非法 / 不匹配的备份不被解析', () => {
    assert.equal(B.parseBackup(null), null);
    assert.equal(B.parseBackup({ type: 'unknown' }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'unknown', files: ['x'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', files: [] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'fmj/伏魔记', files: [] }), null);
    assert.equal(B.parseBackup({ type: 'sango-save-slot', files: ['only-one'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', slot: -1, files: ['x', 'y'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', slot: 3, files: ['x', 'y'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', slot: 1.5, files: ['x', 'y'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', files: ['only-one'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', files: ['x', 'y', 'extra'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye/SGBY', files: ['x', {}] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'fmj/伏魔记', files: ['x', 'extra'] }), null);
});

test('备份可跨任意 Unicode 内容无损往返', () => {
    const tricky = '含.点号/斜杠"引号"及 emoji🎮 与换行\n的数据';
    const store = makeStore({
        'baye//data//sango2.sav@sc-mod': tricky,
        'baye//data//sango3.sav@sc-mod': 'XYZ',
    });
    const payload = B.buildExportPayload(SCMOD, 1, store.get);
    delete store.raw['baye//data//sango2.sav@sc-mod'];
    delete store.raw['baye//data//sango3.sav@sc-mod'];

    B.applyRestore(SCMOD, 1, B.parseBackup(payload).files, null, store.set);
    assert.equal(store.raw['baye//data//sango2.sav@sc-mod'], tricky);
    assert.equal(store.raw['baye//data//sango3.sav@sc-mod'], 'XYZ');
});

test('fileName 含游戏 id 与槽位，id 中的斜杠转为横杠', () => {
    assert.equal(B.fileName(SGBY, 0, '20260724'), 'bbk-baye-SGBY-save-1-20260724.json');
    assert.equal(B.fileName(SCMOD, 2, '20260724'), 'bbk-baye-sc-mod-save-3-20260724.json');
    assert.equal(
        B.fileName(SAVE_PROFILES['fmj/伏魔记'], 2, '20260724'),
        'bbk-fmj-伏魔记-save-3-20260724.json'
    );
});

test('还原写入失败时中止并返回 false', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'X' });
    const parsed = B.parseBackup(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get));
    const failWrite = () => false;
    assert.equal(
        B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 1, parsed.files, parsed.version, failWrite),
        false
    );
});

test('还原第二个文件失败时回滚第一个文件', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'OLD-A',
        'baye//data//sango1.sav@SGBY': 'OLD-B',
    });
    let failed = false;
    function failSecondKey(key, value) {
        if (key.endsWith('sango1.sav@SGBY') && value === 'NEW-B' && !failed) {
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
            ['NEW-A', 'NEW-B'],
            null,
            failSecondKey,
            store.get,
            store.remove
        ),
        false
    );
    assert.equal(store.raw['baye//data//sango0.sav@SGBY'], 'OLD-A');
    assert.equal(store.raw['baye//data//sango1.sav@SGBY'], 'OLD-B');
});

test('还原到空槽失败时移除已写入的新文件', () => {
    const store = makeStore({});
    function failSecondKey(key, value) {
        if (key.endsWith('sango1.sav@SGBY')) return false;
        store.set(key, value);
        return true;
    }

    assert.equal(
        B.applyRestore(
            SGBY,
            0,
            ['NEW-A', 'NEW-B'],
            null,
            failSecondKey,
            store.get,
            store.remove
        ),
        false
    );
    assert.equal(store.raw['baye//data//sango0.sav@SGBY'], undefined);
    assert.equal(store.raw['baye//data//sango1.sav@SGBY'], undefined);
});

test('applyRestore 直接拒绝非法槽位和文件结构', () => {
    const store = makeStore({});
    assert.equal(B.applyRestore(SGBY, -1, ['A', 'B'], null, store.set), false);
    assert.equal(B.applyRestore(SGBY, 0, ['A'], null, store.set), false);
    assert.equal(B.applyRestore(SGBY, 0, ['A', {}], null, store.set), false);
    assert.deepEqual(store.raw, {});
});

test('libIdFromPath 从 lib 路径推导版本标识', () => {
    assert.equal(B.libIdFromPath('libs/SGBY.lib'), 'SGBY');
    assert.equal(B.libIdFromPath('libs/whxf.lib'), 'whxf');
    assert.equal(B.libIdFromPath('libs/sc-mod.lib'), 'sc-mod');
    assert.equal(B.libIdFromPath(''), '');
    assert.equal(B.libIdFromPath(undefined), '');
});
