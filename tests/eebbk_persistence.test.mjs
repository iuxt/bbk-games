import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
await import('../eebbk/glue.js');
const G = globalThis.BBK4988Glue;
const source = fs.readFileSync('eebbk/glue.js', 'utf8');
function fn(name) {
  const start = source.indexOf('  function ' + name + '(');
  let i = source.indexOf('{', start), depth = 1;
  for (i++; depth; i++) { if (source[i] === '{') depth++; else if (source[i] === '}') depth--; }
  return source.slice(start, i);
}

function harness(failKey) {
  const storage = new Map();
  const messages = [];
  let fail = true;
  const context = {
    BBK: G, currentRom: { id: 'game' }, Date, console: { warn() {} },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      removeItem: key => storage.delete(key),
      setItem(key, value) {
        if (key === failKey && fail) { fail = false; throw new Error('quota'); }
        storage.set(key, value);
      },
    },
    captureState: () => ({ b64: 'AQID' }), captureScreenPreview: () => '', confirm: () => true,
    renderSaveSlots() {}, setSaveMsg: (type, text) => messages.push({ type, text }),
  };
  vm.createContext(context);
  vm.runInContext(['readLS', 'writeLS', 'readSlot', 'writeSlot', 'saveToSlot'].map(fn).join('\n'), context);
  return { storage, messages, run: code => vm.runInContext(code, context) };
}

test('quota errors report failure and preserve the previous slot', () => {
  const key = G.slotKey('game', 0);
  for (const failedKey of [key, key + '.ts']) {
    const h = harness(failedKey);
    h.storage.set(key, 'BAUG'); h.storage.set(key + '.ts', '123');
    h.run('saveToSlot(0)');
    assert.equal(h.messages.at(-1).type, 'error');
    assert.match(h.messages.at(-1).text, /存档写入失败/);
    assert.equal(h.storage.get(key), 'BAUG');
    assert.equal(h.storage.get(key + '.ts'), '123');
  }
});

test('a successful save updates data and metadata before reporting success', () => {
  const h = harness(); h.run('saveToSlot(0)');
  assert.equal(h.storage.get(G.slotKey('game', 0)), 'AQID');
  assert.equal(h.messages.at(-1).type, 'status');
});

test('optional localStorage writes expose failure to their caller', () => {
  const h = harness('test');
  assert.equal(h.run("writeLS('test', 'value')"), false);
});

test('firmware parts write directly into wasm and release the allocation on truncated downloads', async () => {
  const start = source.indexOf('  async function loadFirmware(');
  const end = source.indexOf('  /* ---------- Hot-switch', start);
  for (const truncated of [false, true]) {
    let freed = false, initialized = false;
    const mod = {
      HEAPU8: new Uint8Array(28 * 1024 * 1024), _malloc: () => 8,
      _free(ptr) { assert.equal(ptr, 8); freed = true; },
      _web_init(ptr, size) {
        assert.equal(size, 26 * 1024 * 1024);
        assert.equal(mod.HEAPU8[ptr], 1); assert.equal(mod.HEAPU8[ptr + 14 * 1024 * 1024], 2);
        initialized = true; return 0;
      },
    };
    const context = vm.createContext({
      fetch: async url => ({ ok: true, arrayBuffer: async () => {
        const i = url.includes('data.0') ? 0 : 1;
        return new Uint8Array((i ? 12 : 14) * 1024 * 1024 - (truncated ? 1 : 0)).fill(i + 1).buffer;
      } }), mod,
    });
    vm.runInContext(source.slice(start, end), context);
    const pending = vm.runInContext('loadFirmware(mod)', context);
    if (truncated) await assert.rejects(pending, /固件数据不完整/);
    else await pending;
    assert.equal(initialized, !truncated); assert.ok(freed);
  }
});
