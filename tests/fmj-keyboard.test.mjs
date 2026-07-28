import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const keyboardSource = readFileSync(
    new URL("../fm/js/keyboard.js", import.meta.url),
    "utf8"
);

function loadKeyboard() {
    const context = { down: [], up: [] };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(keyboardSource, context);
    context.fmjSendKeyDown = (key) => context.down.push(key);
    context.fmjSendKeyUp = (key) => context.up.push(key);
    return context;
}

test("mobile RPG virtual buttons still send a complete key press", () => {
    const context = loadKeyboard();

    context.onKeyDown(1);

    assert.deepEqual(context.down, [1]);
    assert.deepEqual(context.up, [1]);
});

test("mobile RPG maps physical KeyboardEvent values", () => {
    const context = loadKeyboard();
    let prevented = false;

    context.onKeyDown({
        key: "ArrowRight",
        preventDefault() { prevented = true; },
    });
    context.onKeyDown({
        key: "Enter",
        preventDefault() {},
    });

    assert.deepEqual(context.down, [4, 7]);
    assert.deepEqual(context.up, [4, 7]);
    assert.equal(prevented, true);
});
