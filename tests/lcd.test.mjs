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
