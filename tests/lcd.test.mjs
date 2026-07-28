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
        "baye//data/dat.lib": "old cache",
        "baye/libname": "旧版本",
        "baye/libpath": "libs/old.lib",
    });
    let pathAtRedirect = null;
    context.redirect = () => {
        pathAtRedirect = storage["baye/libpath"];
    };

    context.chooseLib("步步高原版", "libs/SGBY.lib", {});

    assert.equal(storage["baye//data/dat.lib"], undefined);
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

test("load falls back to legacy shared key when versioned slot is empty", () => {
    const context = loadLcd({
        "baye/libpath": "libs/SGBY.lib",
        "baye//data//sango0.sav": "legacy-save",
    });

    assert.equal(context.bayeLoadFileContent("baye//data//sango0.sav"), "legacy-save");
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
