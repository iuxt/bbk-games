import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const lcdSource = readFileSync(new URL('../js/lcd.js', import.meta.url), 'utf8');

function loadLcd(storageValues = {}) {
    const localStorage = {
        ...storageValues,
        getItem(key) {
            return this[key] ?? null;
        },
        setItem(key, value) {
            this[key] = String(value);
        },
        removeItem(key) {
            delete this[key];
        },
    };
    const chain = {
        css() { return this; },
        removeAttr() { return this; },
        hide() { return this; },
        show() { return this; },
        html() { return this; },
        attr() { return this; },
        is() { return false; },
    };
    const window = {
        localStorage,
        location: { href: '' },
        innerWidth: 1000,
        innerHeight: 600,
    };
    const context = {
        window,
        document: {
            getElementById() { return null; },
        },
        navigator: { userAgent: 'Desktop' },
        Storage: function Storage() {},
        alert() {},
        console: { log() {} },
        $() { return chain; },
    };

    vm.runInNewContext(lcdSource, context);
    context.context = context;
    context.storage = localStorage;
    return context;
}

test('redirect sends users without a selected version to the sanguobaye index', () => {
    const context = loadLcd();

    context.redirect();

    assert.equal(context.window.location.href, 'index.html');
});

test('redirect preserves the existing desktop launch when a version is selected', () => {
    const context = loadLcd({
        'baye/libname': '步步高原版',
        'baye/libpath': 'libs/SGBY.lib',
    });

    context.redirect();

    assert.equal(context.window.location.href, 'pc.html?name=步步高原版');
});

test('bayeMain redirects direct visits without loading a version', () => {
    const context = loadLcd();
    let loaded = false;
    context.loadLibFromUrl = () => {
        loaded = true;
    };

    context.bayeMain();

    assert.equal(context.window.location.href, 'index.html');
    assert.equal(loaded, false);
});

test('bayeMain keeps loading the selected version', () => {
    const context = loadLcd({
        'baye/libpath': 'libs/SGBY.lib',
    });
    let loadedPath;
    context.loadLibFromUrl = (path) => {
        loadedPath = path;
    };

    context.bayeMain();

    assert.equal(loadedPath, 'libs/SGBY.lib');
});

test('bayeMain reports a ROM loading failure', () => {
    const context = loadLcd({
        'baye/libpath': 'libs/SGBY.lib',
    });
    const errorElement = { textContent: '', hidden: true };
    context.document.getElementById = () => errorElement;
    context.loadLibFromUrl = (path, success, failure) => failure();

    context.bayeMain();

    assert.equal(errorElement.hidden, false);
    assert.match(errorElement.textContent, /游戏数据载入失败/);
});

test('ajaxGet reports non-success responses', () => {
    const context = loadLcd();
    let failed = false;
    context.XMLHttpRequest = class {
        open() {}
        send() {
            this.status = 404;
            this.onload();
        }
    };

    context.ajaxGet('missing.lib', () => {
        assert.fail('success callback should not run');
    }, () => {
        failed = true;
    });

    assert.equal(failed, true);
});

test('lcdInit always uses the fixed game resolution', () => {
    const context = loadLcd({
        'baye/resolution': '1',
    });
    let size = null;
    context.bayeResizeScreen = (width, height) => {
        size = [width, height];
    };

    context.lcdInit();

    assert.deepEqual(size, [160, 96]);
});

test("chooseLib stores the new version before launching", () => {
    const { context, storage } = loadLcd({
        "baye/libname": "旧版本",
        "baye/libpath": "libs/old.lib",
    });
    let pathAtRedirect = null;
    context.redirect = () => {
        pathAtRedirect = storage["baye/libpath"];
    };

    context.chooseLib("步步高原版", "libs/SGBY.lib", {});

    assert.equal(storage["baye/libname"], "步步高原版");
    assert.equal(storage["baye/libpath"], "libs/SGBY.lib");
    assert.equal(pathAtRedirect, "libs/SGBY.lib");
});

test("bayeSaveKey namespaces save files per lib version", () => {
    const context = loadLcd({ "baye/libpath": "libs/SGBY.lib" });

    assert.equal(
        context.bayeSaveKey("baye//data//sango0.sav"),
        "baye//data//sango0.sav@SGBY"
    );
    // 版本设置项不做隔离
    assert.equal(context.bayeSaveKey("baye/libname"), "baye/libname");
});

test("bayeSaveKey leaves keys untouched without a selected version", () => {
    const context = loadLcd();

    assert.equal(
        context.bayeSaveKey("baye//data//sango0.sav"),
        "baye//data//sango0.sav"
    );
});

test("save and load use the versioned key of the current lib", () => {
    const { context, storage } = loadLcd({
        "baye/libpath": "libs/SGBY.lib",
    });

    context.bayeSaveFileContent("baye//data//sango0.sav", "save-data");

    assert.equal(storage["baye//data//sango0.sav@SGBY"], "save-data");
    assert.equal(storage["baye//data//sango0.sav"], undefined);
    assert.equal(context.bayeLoadFileContent("baye//data//sango0.sav"), "save-data");
});

test("different lib versions have isolated save slots", () => {
    const { context, storage } = loadLcd({ "baye/libpath": "libs/SGBY.lib" });
    context.bayeSaveFileContent("baye//data//sango0.sav", "sgby-save");

    // 模拟切换到另一个版本
    storage["baye/libpath"] = "libs/whxf.lib";
    context.bayeSaveFileContent("baye//data//sango0.sav", "whxf-save");

    assert.equal(storage["baye//data//sango0.sav@SGBY"], "sgby-save");
    assert.equal(storage["baye//data//sango0.sav@whxf"], "whxf-save");

    storage["baye/libpath"] = "libs/SGBY.lib";
    assert.equal(context.bayeLoadFileContent("baye//data//sango0.sav"), "sgby-save");
    storage["baye/libpath"] = "libs/whxf.lib";
    assert.equal(context.bayeLoadFileContent("baye//data//sango0.sav"), "whxf-save");
});

test("bayeExit navigates home by default", () => {
    const { context } = loadLcd();

    context.bayeExit();

    assert.equal(context.window.location.href, "../index.html");
});

test("bayeExit can stay inside games that use exit as a cancel key", () => {
    const { context } = loadLcd();
    context.window.bayeExitToHome = false;

    context.bayeExit();

    assert.equal(context.window.location.href, "");
});

test("lcdBlitMono maps source bytes to monochrome RGBA (byte-equivalent to old imageDot)", () => {
    const context = loadLcd();
    // 边界值含 signed i8 下为负的字节（0x80、0xFF），均应判为「亮」。
    const cases = [0, 1, 2, 0x7F, 0x80, 0xFE, 0xFF];
    const len = cases.length;
    const data = new Uint8ClampedArray(len * 4);    // 模拟 ImageData.data
    const rgba32 = new Uint32Array(data.buffer);
    const src = new Uint8Array(cases);

    context.lcdBlitMono(src, rgba32, len);

    for (let i = 0; i < len; i += 1) {
        const on = cases[i] !== 0;
        assert.equal(data[i * 4],     0,                "R 恒为 0");
        assert.equal(data[i * 4 + 1], 0,                "G 恒为 0");
        assert.equal(data[i * 4 + 2], 0,                "B 恒为 0");
        assert.equal(data[i * 4 + 3], on ? 255 : 0,     "A：亮=不透明 255，灭=透明 0");
    }
});

test("lcdBlitMono overwrites every pixel (no cross-frame residue when ImageData is reused)", () => {
    const context = loadLcd();
    const len = 4;
    const data = new Uint8ClampedArray(len * 4);
    data.fill(255);                                  // 预置上一帧不透明残影
    const rgba32 = new Uint32Array(data.buffer);
    const src = new Uint8Array([0, 0xFF, 0, 0xFF]);  // 交替 灭/亮

    context.lcdBlitMono(src, rgba32, len);

    assert.equal(data[0 * 4 + 3], 0,   "灭像素必须被清成透明，复用 ImageData 不留残影");
    assert.equal(data[1 * 4 + 3], 255, "亮像素不透明");
    assert.equal(data[2 * 4 + 3], 0,   "灭像素透明");
    assert.equal(data[3 * 4 + 3], 255, "亮像素不透明");
});
