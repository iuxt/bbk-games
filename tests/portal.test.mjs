import test from "node:test";
import assert from "node:assert/strict";

await import("../js/portal.js");
const Portal = globalThis.BBKPortal;

function makeClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
    };
}

function makeFocusable() {
    return {
        focused: false,
        attributes: {},
        focus() { this.focused = true; },
        setAttribute(name, value) { this.attributes[name] = value; },
    };
}

test("readStoredValue accepts valid values and defaults invalid values", () => {
    const storage = { getItem: () => "2" };
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1", "2"]), "2");
    storage.getItem = () => "unexpected";
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1", "2"]), "0");
});

test("storage errors fall back without throwing", () => {
    const storage = {
        getItem() { throw new Error("blocked"); },
        setItem() { throw new Error("blocked"); },
    };
    assert.equal(Portal.readStoredValue(storage, "mode", ["0", "1"]), "0");
    assert.equal(Portal.writeStoredValue(storage, "mode", "1"), false);
});

test("bindSettings restores values and persists changes", () => {
    const saved = new Map([["baye/mpage", "1"]]);
    const storage = {
        getItem(key) { return saved.get(key) ?? null; },
        setItem(key, value) { saved.set(key, value); },
    };
    const select = {
        value: "",
        dataset: { storageKey: "baye/mpage" },
        options: [{ value: "0" }, { value: "1" }, { value: "2" }],
        addEventListener(type, handler) { this.changeHandler = handler; },
    };
    const document = { querySelectorAll: () => [select] };

    Portal.bindSettings(document, storage);
    assert.equal(select.value, "1");
    select.value = "2";
    select.changeHandler();
    assert.equal(saved.get("baye/mpage"), "2");
});

test("dialog controller opens, closes, locks scroll, and restores focus", () => {
    const overlay = { hidden: true };
    const opener = makeFocusable();
    const closeButton = makeFocusable();
    const body = { classList: makeClassList() };
    const controller = Portal.createDialogController({
        overlay,
        opener,
        closeButton,
        body,
    });

    controller.open();
    assert.equal(overlay.hidden, false);
    assert.equal(opener.attributes["aria-expanded"], "true");
    assert.equal(body.classList.contains("dialog-open"), true);
    assert.equal(closeButton.focused, true);

    controller.close();
    assert.equal(overlay.hidden, true);
    assert.equal(opener.attributes["aria-expanded"], "false");
    assert.equal(body.classList.contains("dialog-open"), false);
    assert.equal(opener.focused, true);
});
