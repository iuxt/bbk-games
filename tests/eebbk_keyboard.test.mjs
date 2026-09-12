import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

await import('../eebbk/glue.js');
await import('../eebbk/device-skin.js');
const { pcKeyToEmuKey } = globalThis.BBK4980Glue;
const source = fs.readFileSync(new URL('../eebbk/glue.js', import.meta.url), 'utf8');
const skinCss = fs.readFileSync(new URL('../eebbk/style.css', import.meta.url), 'utf8');

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
  const realisticDevice = Object.assign(events(), {
    querySelectorAll: () => [button], contains: node => node === button,
  });
  const document = Object.assign(events(), { getElementById: () => touchpad });
  const sent = [];
  const context = {
    global: events(), document, realisticDevice, started: true, exited: false, deviceAsleep: false,
    toggleDevicePower() { context.deviceAsleep = !context.deviceAsleep; },
    resetDevice() {},
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
  return { context, sent, pressed, button, touchpad, realisticDevice, document, keydown };
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

test('pointer press sends immediately, release click is deduplicated, and keyboard click still works', () => {
  for (const surfaceName of ['touchpad', 'realisticDevice']) {
    const h = inputHarness();
    const surface = h[surfaceName];
    const event = { target: { closest: () => h.button }, button: 0, detail: 1, preventDefault() {} };
    surface.handlers.pointerdown(event);
    assert.deepEqual(h.sent, [41], 'input must arrive before releasing the finger');
    surface.handlers.click(event);
    assert.deepEqual(h.sent, [41], 'release must not send a second key');
    surface.handlers.click({ ...event, detail: 0 });
    assert.deepEqual(h.sent, [41, 41], 'keyboard/assistive activation stays supported');
    // A cancelled gesture has no click; it must not swallow the next press.
    surface.handlers.pointerdown(event);
    surface.handlers.pointerdown(event);
    surface.handlers.click(event);
    assert.deepEqual(h.sent, [41, 41, 41, 41]);
  }
});

test('pointer keys respect disabled controls, dialogs and device state; power waits for click', () => {
  const h = inputHarness();
  const event = { target: { closest: () => h.button }, button: 0, detail: 1, preventDefault() {} };
  h.touchpad.handlers.pointerdown({ ...event, button: 2 });
  h.button.disabled = true;
  h.touchpad.handlers.pointerdown(event);
  h.button.disabled = false;
  for (const [obj, prop, value] of [
    [h.context.gamePicker, 'hidden', false], [h.context.saveManager, 'hidden', false],
    [h.context, 'deviceAsleep', true], [h.context, 'exited', true], [h.context, 'started', false],
  ]) {
    const original = obj[prop];
    obj[prop] = value;
    h.touchpad.handlers.pointerdown(event);
    obj[prop] = original;
    h.touchpad.handlers.click(event);
  }
  assert.deepEqual(h.sent, []);
  h.button.dataset.deviceAction = 'power';
  h.touchpad.handlers.pointerdown(event);
  assert.equal(h.context.deviceAsleep, false);
  h.touchpad.handlers.click(event);
  assert.equal(h.context.deviceAsleep, true);
});

test('photo keyboard covers all sixty keys and stays inside the device without overlapping keys', () => {
  const skin = globalThis.BBK4980Skin;
  assert.ok(Math.abs(skin.photo.screen.width / skin.photo.screen.height - 159 / 96) < 1e-9,
    'the gameplay viewport must preserve the native 159:96 aspect ratio');
  assert.ok(skin.photo.screen.width < skin.photo.lcd.width * 0.8,
    'the gameplay viewport must not cover the LCD status margins');
  assert.ok(skin.photo.lcd.width > skin.photo.screen.width,
    'the LCD shell must leave room for ornaments on both sides');
  assert.deepEqual(skin.keys.map(key => key.code).sort((a, b) => a - b), Array.from({ length: 60 }, (_, i) => i));
  for (const key of skin.keys) {
    if (/^[A-Z0-9]$/.test(key.label)) assert.equal(pcKeyToEmuKey({ key: key.label }), key.code);
    const box = skin.position(key.rect);
    assert.ok(box.left >= 0 && box.top >= 0);
    assert.ok(box.left + box.width <= skin.photo.crop.width);
    assert.ok(box.top + box.height <= skin.photo.crop.height);
    for (const other of skin.keys.filter(other => other.code > key.code)) {
      const b = skin.position(other.rect);
      const overlap = Math.min(box.left + box.width, b.left + b.width) > Math.max(box.left, b.left)
        && Math.min(box.top + box.height, b.top + b.height) > Math.max(box.top, b.top);
      assert.equal(overlap, false, `${key.label} overlaps ${other.label}`);
    }
  }
  // Specific landmarks from the supplied photo, rather than a generic QWERTY layout.
  const byCode = code => skin.keys.find(key => key.code === code).rect;
  assert.ok(byCode(54)[0] > byCode(51)[0], 'space is to the right of P');
  assert.ok(byCode(58)[0] > byCode(53)[0], 'page up is to the right of up');
  assert.ok(byCode(59)[0] > byCode(56)[0], 'page down is to the right of down');
  assert.ok(byCode(47)[2] > byCode(46)[2], 'input uses the wide bottom key');
});

test('front-view skin uses the full image coordinate system without leveling transforms', () => {
  const skin = globalThis.BBK4980Skin;
  assert.deepEqual(skin.photo.crop, { x: 0, y: 0, width: 1184, height: 1328 });
  assert.equal(skin.photo.width, skin.photo.crop.width);
  assert.equal(skin.photo.height, skin.photo.crop.height);
  assert.doesNotMatch(skinCss, /--photo-leveling-rotation/);
});

test('settings move the same screen between interfaces, persist selection and mount the photo once', () => {
  const storage = new Map();
  const wrapper = { canvas: {} };
  const container = () => ({ appendChild(child) { child.parent = this; } });
  const gameScreenHost = container();
  const layer = container();
  let mounts = 0;
  const context = vm.createContext({
    interfaceToggle: { checked: false, addEventListener(name, fn) { this.change = fn; } },
    document: { documentElement: { classList: { toggle() {} } } },
    deviceSkin: null, wrapper, gameScreenHost, realisticDevice: {}, touchpad: {},
    global: { BBK4980Skin: { mount() { mounts++; return { layer, show() {} }; } } },
    writeLS: (key, value) => storage.set(key, value), clearPressedKeys() {},
  });
  vm.runInContext(source.slice(
    source.indexOf('  /* ---------- Display settings ---------- */'),
    source.indexOf('  /* ---------- Touchpad + physical keyboard ---------- */'),
  ), context);
  vm.runInContext("setInterfaceMode('');", context);
  assert.equal(context.interfaceToggle.checked, false);
  assert.equal(context.realisticDevice.hidden, true);
  assert.equal(wrapper.parent, gameScreenHost);
  for (let i = 0; i < 2; i++) {
    context.interfaceToggle.checked = true;
    context.interfaceToggle.change();
    assert.equal(wrapper.parent, layer);
    assert.equal(context.touchpad.hidden, true);
    assert.equal(context.realisticDevice.hidden, false);
    assert.equal(storage.get('bbk4980.interfaceMode'), 'realistic');
    context.interfaceToggle.checked = false;
    context.interfaceToggle.change();
    assert.equal(wrapper.parent, gameScreenHost);
    assert.equal(context.touchpad.hidden, false);
  }
  assert.equal(mounts, 1);
});

test('photo keys send the same input and F1 bypasses the asleep input gate without repeating', () => {
  const h = inputHarness();
  h.realisticDevice.handlers.click({ target: { closest: () => h.button }, detail: 1 });
  assert.deepEqual(h.sent, [41]);
  h.keydown({ key: 'F1' });
  assert.equal(h.context.deviceAsleep, true);
  h.keydown({ key: 'F1', repeat: true });
  assert.equal(h.context.deviceAsleep, true);
  h.keydown();
  assert.deepEqual(h.sent, [41]);
  h.button.dataset.deviceAction = 'power';
  h.button.dataset.key = '0';
  h.realisticDevice.handlers.click({ target: { closest: () => h.button }, detail: 1 });
  assert.equal(h.context.deviceAsleep, false);
  assert.deepEqual(h.sent, [41], 'power never sends ignored key zero to wasm');
});

test('power button suspends and resumes the same runtime and respects open dialogs', () => {
  const calls = [];
  let blank = false;
  const context = vm.createContext({
    started: true, exited: false, deviceAsleep: false, powerStarting: false,
    dialogIsOpen: () => false,
    wrapper: { classList: { toggle(name, value) { blank = value; } } },
    devicePowerStatus: {}, clearPressedKeys() {},
    pauseEmulator() { calls.push('pause'); },
    resumeEmulator() { calls.push('resume'); },
    handleAutoSave() { calls.push('save'); },
  });
  vm.runInContext(source.slice(source.indexOf('  function toggleDevicePower()'), source.indexOf('  function resetDevice()')), context);
  vm.runInContext('toggleDevicePower()', context);
  assert.equal(blank, true);
  assert.equal(context.started, true);
  assert.deepEqual(calls, ['pause', 'save']);
  vm.runInContext('toggleDevicePower()', context);
  assert.equal(blank, false);
  assert.deepEqual(calls, ['pause', 'save', 'resume']);
  context.dialogIsOpen = () => true;
  vm.runInContext('toggleDevicePower()', context);
  assert.equal(context.deviceAsleep, false);
});
