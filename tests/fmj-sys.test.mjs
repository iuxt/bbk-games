import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const sysSource = readFileSync(new URL('../fm/js/sys.js', import.meta.url), 'utf8');

// sys.js 依赖 TextDecoder/TextEncoder('GBK')，node 的 TextEncoder 只支持 utf-8，用桩替代
function loadSys(pathname, initial = {}) {
    const localStorage = { ...initial };
    const context = {
        window: {
            localStorage,
            location: { pathname },
        },
        TextDecoder: class { decode() { return ''; } },
        TextEncoder: class { encode() { return new Uint8Array(); } },
        console: { warn() {}, log() {} },
        alert() {},
        clearInterval() {},
    };
    vm.createContext(context);
    vm.runInContext(sysSource, context);
    return { context, localStorage };
}

test('sysStorageSet 按游戏隔离存档 key', () => {
    const { context, localStorage } = loadSys('/fm/games/%E4%BC%8F%E9%AD%94%E8%AE%B0/pc.html');

    context.sysStorageSet('sav/fmjsave0', 'SAVE-A');

    assert.equal(localStorage['sav/伏魔记/fmjsave0'], 'SAVE-A');
    assert.equal(localStorage['sav/fmjsave0'], undefined);
});

test('不同游戏的存档互不可见', () => {
    const shared = {};
    const fumo = loadSys('/fm/games/%E4%BC%8F%E9%AD%94%E8%AE%B0/pc.html', shared);
    Object.assign(shared, fumo.localStorage);
    const jyx = loadSys('/fm/games/%E9%87%91%E5%BA%B8%E7%BE%A4%E4%BE%A0%E4%BC%A0/m.html', shared);

    fumo.context.sysStorageSet('sav/fmjsave0', 'FUMO');
    Object.assign(shared, fumo.localStorage);
    jyx.context.sysStorageSet('sav/fmjsave0', 'JYX');

    assert.equal(fumo.context.sysStorageGet('sav/fmjsave0'), 'FUMO');
    assert.equal(jyx.context.sysStorageGet('sav/fmjsave0'), 'JYX');
});

test('sysStorageGet 回退读取旧的共享存档', () => {
    const { context } = loadSys('/fm/games/%E4%BE%A0%E5%AE%A2%E8%A1%8C/pc.html', {
        'sav/fmjsave1': 'LEGACY',
    });

    assert.equal(context.sysStorageGet('sav/fmjsave1'), 'LEGACY');
    assert.equal(context.sysStorageHas('sav/fmjsave1'), true);
    assert.equal(context.sysStorageHas('sav/fmjsave2'), false);
});

test('游戏空间已有数据时优先于旧共享存档', () => {
    const { context } = loadSys('/fm/games/%E4%BE%A0%E5%AE%A2%E8%A1%8C/pc.html', {
        'sav/fmjsave1': 'LEGACY',
        'sav/侠客行/fmjsave1': 'NEW',
    });

    assert.equal(context.sysStorageGet('sav/fmjsave1'), 'NEW');
});

test('非存档路径仍读写 fmj.rom', () => {
    const { context } = loadSys('/fm/games/%E4%BC%8F%E9%AD%94%E8%AE%B0/pc.html');

    context.sysStorageSet('DAT.LIB', 'ROM-DATA');

    assert.equal(context.fmj.rom['DAT.LIB'], 'ROM-DATA');
    assert.equal(context.sysStorageGet('DAT.LIB'), 'ROM-DATA');
});

test('无法识别游戏路径时不做隔离', () => {
    const { context, localStorage } = loadSys('/fm/index.html');

    context.sysStorageSet('sav/fmjsave0', 'X');

    assert.equal(localStorage['sav/fmjsave0'], 'X');
});
