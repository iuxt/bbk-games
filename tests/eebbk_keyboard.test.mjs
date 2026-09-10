import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

await import('../eebbk/glue.js');
const { pcKeyToEmuKey } = globalThis.BBK4980Glue;
const source = fs.readFileSync(new URL('../eebbk/glue.js', import.meta.url), 'utf8');

test('physical shortcuts match the seven device function keys', () => {
  const keys = {
    F9: 41, F10: 42, F11: 43, Insert: 43, F12: 44,
    Delete: 45, Backspace: 45, Escape: 46, Enter: 47,
    ArrowUp: 53, ArrowLeft: 55, ArrowDown: 56, ArrowRight: 57,
    PageUp: 58, PageDown: 59, ' ': 54, r: 19, R: 19,
  };
  for (const [key, code] of Object.entries(keys)) {
    assert.equal(pcKeyToEmuKey({ key }), code, key);
  }
  // Unknown multi-character key names must never become their first letter.
  for (const key of ['Tab', 'Home', 'End', 'Control', 'Meta', 'Dead', 'Unidentified', '']) {
    assert.equal(pcKeyToEmuKey({ key }), 0, key);
  }
});

function inputHarness() {
  const events = () => ({ handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
  const pressed = new Set();
  const button = {
    dataset: { key: '41' },
    classList: { toggle(name, value) { if (value) pressed.add(name); else pressed.delete(name); } },
    blur() {},
  };
  const touchpad = Object.assign(events(), {
    querySelectorAll: () => [button], contains: node => node === button,
  });
  const document = Object.assign(events(), { getElementById: () => touchpad });
  const sent = [];
  const context = {
    global: events(), document, started: true, exited: false,
    gamePicker: { hidden: true }, saveManager: { hidden: true },
    sendEmulatorKey: key => sent.push(key), pcKeyToEmuKey,
  };
  vm.runInNewContext(source.slice(
    source.indexOf('  /* ---------- Touchpad + physical keyboard ---------- */'),
    source.indexOf('  /* ---------- Bootstrap ----------'),
  ), context);
  const keydown = (extra = {}) => {
    const event = {
      key: 'F9', code: 'F9', target: { closest: () => null },
      preventDefault() { this.defaultPrevented = true; }, ...extra,
    };
    document.handlers.keydown(event);
    return event;
  };
  return { context, sent, pressed, button, touchpad, document, keydown };
}

test('keyboard respects dialogs, native controls and shortcuts, and clears pressed state', () => {
  const h = inputHarness();
  assert.equal(h.keydown().defaultPrevented, true);
  assert.deepEqual(h.sent, [41]);
  assert.ok(h.pressed.has('is-pressed'));
  h.document.handlers.keyup({ code: 'F9' });
  assert.equal(h.pressed.size, 0);
  for (const extra of [
    { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
    { target: { isContentEditable: true } },
    { target: { closest: () => ({ tagName: 'INPUT' }) } },
    { key: 'Enter', target: { closest: selector => selector.startsWith('button') ? {} : null } },
  ]) h.keydown(extra);
  for (const modal of [h.context.gamePicker, h.context.saveManager]) {
    modal.hidden = false;
    h.keydown();
    modal.hidden = true;
  }
  h.context.exited = true;
  h.keydown();
  h.context.exited = false;
  assert.deepEqual(h.sent, [41]);
  h.keydown();
  h.context.global.handlers.blur();
  assert.equal(h.pressed.size, 0);
});

test('a keycap label click sends one device key, including keyboard activation', () => {
  const h = inputHarness();
  const event = { target: { closest: () => h.button }, detail: 1 };
  h.touchpad.handlers.click(event);
  h.touchpad.handlers.click({ ...event, detail: 0 });
  assert.deepEqual(h.sent, [41, 41]);
  h.context.gamePicker.hidden = false;
  h.touchpad.handlers.click(event);
  assert.deepEqual(h.sent, [41, 41]);
});

test('full keyboard covers every supported non-power device key', () => {
  const markup = fs.readFileSync(new URL('../eebbk/index.html', import.meta.url), 'utf8');
  const codes = new Set([...markup.matchAll(/data-key="(\d+)"/g)].map(match => Number(match[1])));
  assert.deepEqual([...codes].sort((a, b) => a - b), Array.from({ length: 59 }, (_, i) => i + 1));
  for (const [, code, label] of markup.matchAll(/data-key="(\d+)" aria-label="([A-Z0-9])"/g)) {
    assert.equal(pcKeyToEmuKey({ key: label }), Number(code), label);
  }
});

test('mobile layout switch preserves dictionary/game extras without sending emulator input', () => {
  const buttons = ['game', 'full'].map(layout => ({
    dataset: { keyboardLayout: layout },
    addEventListener(name, fn) { this.click = fn; },
    setAttribute(name, value) { this[name] = value; },
  }));
  const fullPanel = { hidden: true };
  const context = vm.createContext({
    fullKeyboard: false,
    currentRom: { id: 'game' },
    BBK: globalThis.BBK4980Glue,
    dictRow: {}, gameRow: {},
    document: {
      getElementById: () => fullPanel,
      querySelectorAll: () => buttons,
    },
    clearPressedKeys() {},
    sendEmulatorKey() { assert.fail('layout switching must not send a device key'); },
  });
  const syncFunction = source.match(/  function syncTouchpadMode\(\) \{[\s\S]*?\n  \}/)[0];
  vm.runInContext(syncFunction + source.slice(
    source.indexOf('  /* ---------- Mobile keyboard layout ---------- */'),
    source.indexOf('  /* ---------- Touchpad + physical keyboard ---------- */'),
  ), context);
  buttons[1].click();
  assert.equal(fullPanel.hidden, false);
  assert.equal(buttons[1]['aria-pressed'], 'true');
  assert.equal(context.dictRow.hidden, false);
  assert.equal(context.gameRow.hidden, true);
  buttons[0].click();
  assert.equal(fullPanel.hidden, true);
  assert.equal(buttons[1]['aria-pressed'], 'false');
  assert.equal(context.dictRow.hidden, true);
  assert.equal(context.gameRow.hidden, false);
  context.currentRom.id = globalThis.BBK4980Glue.HOME_ROM_ID;
  buttons[1].click();
  buttons[0].click();
  assert.equal(context.dictRow.hidden, false);
  assert.equal(context.gameRow.hidden, true);
});
