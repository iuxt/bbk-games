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

test('redirect sends users without a selected version to choose.html', () => {
    const context = loadLcd();

    context.redirect();

    assert.equal(context.window.location.href, 'choose.html');
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

    assert.equal(context.window.location.href, 'choose.html');
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
