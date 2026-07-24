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

test('fmj 导出：槽 0 单文件、无版本', () => {
    const store = makeStore({ 'sav/fmjsave0': 'FMJ-DATA' });
    const payload = B.buildExportPayload(SAVE_PROFILES.fmj, 0, store.get);
    assert.equal(payload.game, 'fmj');
    assert.equal(payload.gameName, 'RPG（伏魔记等）');
    assert.deepEqual(payload.files, ['FMJ-DATA']);
    assert.equal(payload.version, undefined);
});

test('fmj 空槽不导出', () => {
    const store = makeStore({});
    assert.equal(B.buildExportPayload(SAVE_PROFILES.fmj, 0, store.get), null);
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

test('fmj 往返：导出后还原到另一槽', () => {
    const store = makeStore({ 'sav/fmjsave0': 'FMJ1' });
    const payload = B.buildExportPayload(SAVE_PROFILES.fmj, 0, store.get);
    delete store.raw['sav/fmjsave0'];

    const parsed = B.parseBackup(payload);
    assert.equal(parsed.profileId, 'fmj');
    assert.equal(parsed.version, null);
    const ok = B.applyRestore(SAVE_PROFILES.fmj, 2, parsed.files, parsed.version, store.set);
    assert.equal(ok, true);
    assert.equal(store.raw['sav/fmjsave2'], 'FMJ1');
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

test('非法 / 不匹配的备份不被解析', () => {
    assert.equal(B.parseBackup(null), null);
    assert.equal(B.parseBackup({ type: 'unknown' }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'unknown', files: ['x'] }), null);
    assert.equal(B.parseBackup({ type: 'bbk-save-slot', game: 'baye', files: [] }), null);
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

test('fileName 含游戏 id 与槽位', () => {
    assert.equal(B.fileName(SAVE_PROFILES.baye, 0, '20260724'), 'bbk-baye-save-1-20260724.sav');
    assert.equal(B.fileName(SAVE_PROFILES.fmj, 2, '20260724'), 'bbk-fmj-save-3-20260724.sav');
});

test('还原写入失败时中止并返回 false', () => {
    const store = makeStore({ 'sav/fmjsave0': 'X' });
    const payload = B.buildExportPayload(SAVE_PROFILES.fmj, 0, store.get);
    const parsed = B.parseBackup(payload);
    const failWrite = () => false;
    assert.equal(B.applyRestore(SAVE_PROFILES.fmj, 1, parsed.files, parsed.version, failWrite), false);
});
