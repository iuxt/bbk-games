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
        raw: s,
    };
}

test('baye 导出：槽 0 序列化为标准 payload（双文件 + 版本）', () => {
    const store = makeStore({
        'baye//data//sango0.sav': 'AAA',
        'baye//data//sango1.sav': 'BBB',
        'baye/libname': '霸哥自制版',
        'baye/libpath': 'libs/sc-mod.lib',
    });
    const payload = B.buildExportPayload(SAVE_PROFILES.baye, 0, store.get);
    assert.equal(payload.app, 'bbk-games');
    assert.equal(payload.type, 'bbk-save-slot');
    assert.equal(payload.ver, 2);
    assert.equal(payload.game, 'baye');
    assert.equal(payload.gameName, '三国霸业');
    assert.equal(payload.slot, 0);
    assert.deepEqual(payload.files, ['AAA', 'BBB']);
    assert.deepEqual(payload.version, {
        'baye/libname': '霸哥自制版',
        'baye/libpath': 'libs/sc-mod.lib',
    });
});

test('baye 空槽不导出', () => {
    const store = makeStore({});
    assert.equal(B.buildExportPayload(SAVE_PROFILES.baye, 1, store.get), null);
});

test('baye 按 lib 版本隔离：ctx 决定读写的 key', () => {
    const store = makeStore({
        'baye//data//sango0.sav@SGBY': 'SGBY-DATA',
        'baye//data//sango1.sav@SGBY': 'SGBY-DATA-2',
        'baye//data//sango0.sav@whxf': 'WHXF-DATA',
        'baye//data//sango1.sav@whxf': 'WHXF-DATA-2',
    });
    const p1 = B.buildExportPayload(SAVE_PROFILES.baye, 0, store.get, 'SGBY');
    const p2 = B.buildExportPayload(SAVE_PROFILES.baye, 0, store.get, 'whxf');
    assert.deepEqual(p1.files, ['SGBY-DATA', 'SGBY-DATA-2']);
    assert.deepEqual(p2.files, ['WHXF-DATA', 'WHXF-DATA-2']);
});

test('baye 导出回退：版本空间为空时读取旧共享存档', () => {
    const store = makeStore({
        'baye//data//sango0.sav': 'LEGACY-A',
        'baye//data//sango1.sav': 'LEGACY-B',
    });
    const payload = B.buildExportPayload(SAVE_PROFILES.baye, 0, store.get, 'SGBY');
    assert.deepEqual(payload.files, ['LEGACY-A', 'LEGACY-B']);
});

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
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/金庸群侠传'], 0, store.get);
    assert.deepEqual(payload.files, ['JYX-DATA']);
});

test('fmj 导出回退：游戏空间为空时读取旧共享存档', () => {
    const store = makeStore({ 'sav/fmjsave1': 'LEGACY' });
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/侠客行'], 1, store.get);
    assert.deepEqual(payload.files, ['LEGACY']);
});

test('fmj 空槽不导出', () => {
    const store = makeStore({});
    assert.equal(B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get), null);
});

test('baye 往返：导出后还原到另一槽，存档与版本均恢复', () => {
    const store = makeStore({
        'baye//data//sango0.sav': 'AAA',
        'baye//data//sango1.sav': 'BBB',
        'baye/libname': '霸哥自制版',
        'baye/libpath': 'libs/sc-mod.lib',
    });
    const payload = B.buildExportPayload(SAVE_PROFILES.baye, 0, store.get);

    // 模拟换设备：清空原槽
    delete store.raw['baye//data//sango0.sav'];
    delete store.raw['baye//data//sango1.sav'];

    // 还原到槽 2（sango4 / sango5）
    const parsed = B.parseBackup(payload);
    assert.equal(parsed.profileId, 'baye');
    const ok = B.applyRestore(SAVE_PROFILES.baye, 2, parsed.files, parsed.version, store.set);
    assert.equal(ok, true);
    assert.equal(store.raw['baye//data//sango4.sav'], 'AAA');
    assert.equal(store.raw['baye//data//sango5.sav'], 'BBB');
    assert.equal(store.raw['baye/libname'], '霸哥自制版');
    assert.equal(store.raw['baye/libpath'], 'libs/sc-mod.lib');
});

test('baye 还原写入版本隔离的 key（带 ctx）', () => {
    const store = makeStore({});
    const ok = B.applyRestore(SAVE_PROFILES.baye, 0, ['A', 'B'], null, store.set, 'SGBY');
    assert.equal(ok, true);
    assert.equal(store.raw['baye//data//sango0.sav@SGBY'], 'A');
    assert.equal(store.raw['baye//data//sango1.sav@SGBY'], 'B');
    assert.equal(store.raw['baye//data//sango0.sav'], undefined);
});

test('fmj 往返：导出后还原到另一槽，写入游戏独立空间', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'FMJ1' });
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get);
    delete store.raw['sav/伏魔记/fmjsave0'];

    const parsed = B.parseBackup(payload);
    assert.equal(parsed.profileId, 'fmj/伏魔记');
    assert.equal(parsed.version, null);
    const ok = B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 2, parsed.files, parsed.version, store.set);
    assert.equal(ok, true);
    assert.equal(store.raw['sav/伏魔记/fmjsave2'], 'FMJ1');
    // 不写入旧的共享 key
    assert.equal(store.raw['sav/fmjsave2'], undefined);
});

test('向后兼容：旧 sango-save-slot 文件可还原到 baye', () => {
    const store = makeStore({});
    const legacy = {
        app: 'bbk-games',
        type: 'sango-save-slot',
        ver: 1,
        libname: '霸哥自制版',
        libpath: 'libs/sc-mod.lib',
        slot: 0,
        files: ['AAA', 'BBB'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, 'baye');
    assert.deepEqual(parsed.version, {
        'baye/libname': '霸哥自制版',
        'baye/libpath': 'libs/sc-mod.lib',
    });
    const ok = B.applyRestore(SAVE_PROFILES.baye, 1, parsed.files, parsed.version, store.set);
    assert.equal(ok, true);
    assert.equal(store.raw['baye//data//sango2.sav'], 'AAA');
    assert.equal(store.raw['baye//data//sango3.sav'], 'BBB');
    assert.equal(store.raw['baye/libname'], '霸哥自制版');
});

test('向后兼容：旧 fmj 共享存档备份可还原到任意 fmj 游戏', () => {
    const legacy = {
        app: 'bbk-games',
        type: 'bbk-save-slot',
        ver: 2,
        game: 'fmj',
        gameName: 'RPG（伏魔记等）',
        slot: 0,
        files: ['OLD-FMJ'],
    };
    const parsed = B.parseBackup(legacy);
    assert.equal(parsed.profileId, 'fmj');
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/金庸群侠传']), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES.baye), false);

    const store = makeStore({});
    B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 0, parsed.files, parsed.version, store.set);
    assert.equal(store.raw['sav/伏魔记/fmjsave0'], 'OLD-FMJ');
});

test('canRestore：不同游戏 / 不同组的备份被拒绝', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'X' });
    const parsed = B.parseBackup(
        B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get)
    );
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/伏魔记']), true);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES['fmj/金庸群侠传']), false);
    assert.equal(B.canRestore(parsed, SAVE_PROFILES.baye), false);
    assert.equal(B.canRestore(parsed, null), false);
    assert.equal(B.canRestore(null, SAVE_PROFILES['fmj/伏魔记']), false);
});

test('非法 / 不匹配的备份不被解析', () => {
    assert.equal(B.parseBackup(null), null);
    assert.equal(B.parseBackup({ type: 'unknown' }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'unknown', files: ['x'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye', files: [] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'fmj/伏魔记', files: [] }), null);
    assert.equal(B.parseBackup({ type: 'sango-save-slot', files: ['only-one'] }), null);
});

test('备份可跨任意 Unicode 内容无损往返', () => {
    const tricky = '含.点号/斜杠"引号"及 emoji🎮 与换行\n的数据';
    const store = makeStore({
        'baye//data//sango2.sav': tricky,
        'baye//data//sango3.sav': 'XYZ',
    });
    const payload = B.buildExportPayload(SAVE_PROFILES.baye, 1, store.get);
    delete store.raw['baye//data//sango2.sav'];
    delete store.raw['baye//data//sango3.sav'];

    const parsed = B.parseBackup(payload);
    B.applyRestore(SAVE_PROFILES.baye, 1, parsed.files, parsed.version, store.set);
    assert.equal(store.raw['baye//data//sango2.sav'], tricky);
    assert.equal(store.raw['baye//data//sango3.sav'], 'XYZ');
});

test('fileName 含游戏 id 与槽位，id 中的斜杠转为横杠', () => {
    assert.equal(B.fileName(SAVE_PROFILES.baye, 0, '20260724'), 'bbk-baye-save-1-20260724.sav');
    assert.equal(
        B.fileName(SAVE_PROFILES['fmj/伏魔记'], 2, '20260724'),
        'bbk-fmj-伏魔记-save-3-20260724.sav'
    );
});

test('还原写入失败时中止并返回 false', () => {
    const store = makeStore({ 'sav/伏魔记/fmjsave0': 'X' });
    const payload = B.buildExportPayload(SAVE_PROFILES['fmj/伏魔记'], 0, store.get);
    const parsed = B.parseBackup(payload);
    const failWrite = () => false;
    assert.equal(
        B.applyRestore(SAVE_PROFILES['fmj/伏魔记'], 1, parsed.files, parsed.version, failWrite),
        false
    );
});
