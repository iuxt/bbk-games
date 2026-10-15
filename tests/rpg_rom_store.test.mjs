import test from 'node:test';
import assert from 'node:assert/strict';
await import('../rpg/rom-store.js');
const { create } = globalThis.BBKRomStore;

function harness(initial = {}) {
  const values = new Map(Object.entries(initial));
  const roms = new Map();
  const requests = [];
  const h = { failTransaction: false, failMetadata: false };
  const storage = {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem(key, value) {
      if (h.failMetadata) { h.failMetadata = false; throw new Error('quota'); }
      values.set(key, value);
    },
  };
  const indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = {
        close() {},
        transaction() {
          const tx = { objectStore: () => ({
            put(bytes, id) {
              const op = { result: id };
              queueMicrotask(() => {
                if (h.failTransaction) { tx.error = new Error('disk full'); tx.onabort(); }
                else { roms.set(id, structuredClone(bytes)); tx.oncomplete(); }
              });
              return op;
            },
            get(id) {
              const op = { result: structuredClone(roms.get(id)) };
              queueMicrotask(() => tx.oncomplete());
              return op;
            },
          }) };
          return tx;
        },
      };
      request.onsuccess();
    });
    return request;
  } };
  const options = { storage, indexedDB, fetch: async url => {
    requests.push(url);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  } };
  Object.assign(h, { values, roms, requests, options, store: create(options) });
  return h;
}

test('built-in ROMs persist only identity and reload through the resource cache', async () => {
  const h = harness({ gameRom: 'legacy', gameRomStorageId: 'old' });
  const store = create({ ...h.options, indexedDB: null });
  await store.save(null, 'new-game', 'new-game', '新游戏');
  assert.equal(h.values.has('gameRom'), false);
  assert.equal(h.values.get('gameRomId'), 'new-game');
  assert.equal(h.roms.size, 0);
  assert.deepEqual([...new Uint8Array(await store.load())], [1, 2, 3]);
  assert.deepEqual(h.requests, ['roms/new-game.lib']);
});

test('local imports persist binary data, survive reload and keep save namespaces', async () => {
  const h = harness();
  await h.store.save(new Uint8Array([3, 2, 1]).buffer, 'local-3-hash', '', '本地游戏');
  assert.equal(h.values.has('gameRom'), false);
  assert.equal(h.values.has('gameRomId'), false);
  assert.equal(h.values.get('gameRomStorageId'), 'local-3-hash');
  assert.deepEqual([...new Uint8Array(await create(h.options).load())], [3, 2, 1]);
  assert.equal(h.requests.length, 0);
});

test('failed binary transactions and metadata writes retain the previous ROM selection', async () => {
  const initial = { gameRom: '0102', gameRomId: 'old', gameRomStorageId: 'old', gameRomName: '旧游戏' };
  const h = harness(initial);
  h.failTransaction = true;
  await assert.rejects(h.store.save(new ArrayBuffer(2), 'local', '', 'new'), /disk full/);
  assert.deepEqual(Object.fromEntries(h.values), initial);
  h.failMetadata = true;
  await assert.rejects(h.store.save(null, 'new', 'new', 'new'), /游戏选择保存失败/);
  assert.deepEqual(Object.fromEntries(h.values), initial);
});

test('legacy local ROM migration preserves the original size-based save identity', async () => {
  const h = harness({ gameRom: '0102FF', gameRomName: '旧本地游戏' });
  assert.deepEqual([...new Uint8Array(await h.store.load())], [1, 2, 255]);
  assert.equal(h.values.has('gameRom'), false);
  assert.equal(h.values.get('gameRomStorageId'), '6');
  assert.deepEqual([...new Uint8Array(h.roms.get('6'))], [1, 2, 255]);
});

test('failed migration leaves legacy ROM playable and does not remove its data', async () => {
  const h = harness({ gameRom: '0102FF', gameRomStorageId: 'local-old' });
  const store = create({ ...h.options, indexedDB: null });
  assert.deepEqual([...new Uint8Array(await store.load())], [1, 2, 255]);
  assert.equal(h.values.get('gameRom'), '0102FF');
  assert.equal(h.values.get('gameRomStorageId'), 'local-old');
  await assert.rejects(store.save(new ArrayBuffer(2), 'new', '', 'new'), /IndexedDB/);
});

test('offline legacy built-in ROMs remain available until a successful fetch', async () => {
  const h = harness({ gameRom: '0102FF', gameRomId: 'old' });
  const store = create({ ...h.options, fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual([...new Uint8Array(await store.load())], [1, 2, 255]);
  assert.equal(h.values.get('gameRom'), '0102FF');
  await h.store.load();
  assert.equal(h.values.has('gameRom'), false);
});

test('missing ROMs report an actionable error without clearing metadata', async () => {
  const h = harness({ gameRomStorageId: 'local-missing' });
  await assert.rejects(h.store.load(), /本地 ROM 不存在/);
  assert.equal(h.values.get('gameRomStorageId'), 'local-missing');
});
