import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

await import('../eebbk/glue.js');
const G = globalThis.BBK4980Glue;
const source = fs.readFileSync(new URL('../eebbk/glue.js', import.meta.url), 'utf8');

function harness() {
  const storage = new Map();
  const timers = new Map();
  const work = [];
  let timerId = 0;
  const state = new Uint8Array([1, 2, 3, 4]);
  const context = vm.createContext({
    BBK: { ...G, bytesToBase64(bytes) { work.push('encode'); return G.bytesToBase64(bytes); } },
    currentRom: { id: 'test-game' }, currentRomFingerprint: '', recoveryCheckpointReady: true,
    recoveryHasRendered: false, recoveryNeedsInitialCheckpoint: false,
    readLS(key) { work.push('read'); return storage.get(key) || ''; },
    writeLS(key, value) { work.push('write'); storage.set(key, value); },
    removeLS: key => storage.delete(key),
    setTimeout(fn, delay) { assert.equal(delay, 250); timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    captureStateBytes() { work.push('capture'); return { bytes: state.slice(), size: state.length }; },
    captureState: () => null,
    Module: { _web_keydown() { work.push('key'); state[0]++; } },
  });
  vm.runInContext(source.slice(source.indexOf('  /* ---------- Hot-switch'), source.indexOf('  function launchHome()')), context);
  return { context, storage, timers, work, state, run: code => vm.runInContext(code, context) };
}

test('input captures pre-key bytes without encoding/storage, and batches the latest two distinct checkpoints', () => {
  const h = harness();
  h.run('sendEmulatorKey(53)');
  assert.deepEqual(h.work, ['capture', 'key']);
  assert.equal(h.timers.size, 1);
  h.run('sendEmulatorKey(53)');
  assert.deepEqual(h.work, ['capture', 'key', 'key'], 'no new capture until LCD changes');
  h.run('recoveryCheckpointReady = true; sendEmulatorKey(53)');
  h.run('recoveryCheckpointReady = true; sendEmulatorKey(53)');
  assert.equal(h.timers.size, 1, 'rapid presses must not create a write queue or extend the deadline');
  h.run('flushRecoveryCheckpoints()');
  assert.equal(h.timers.size, 0);
  assert.deepEqual([...G.base64ToBytes(h.storage.get(G.recoveryCheckpointKey('test-game')))], [4, 2, 3, 4]);
  assert.deepEqual([...G.base64ToBytes(h.storage.get(G.recoveryCheckpointBackupKey('test-game')))], [3, 2, 3, 4]);
  assert.equal(h.work.filter(x => x === 'write').length, 3);
});

test('duplicate snapshots retain a distinct backup, and deferred timer persists detached bytes', () => {
  const h = harness();
  h.storage.set(G.recoveryCheckpointKey('test-game'), G.bytesToBase64(new Uint8Array([0, 2, 3, 4])));
  h.run('checkpointBeforeInput(); recoveryCheckpointReady = true; checkpointBeforeInput()');
  h.state.fill(9);
  [...h.timers.values()][0]();
  assert.deepEqual([...G.base64ToBytes(h.storage.get(G.recoveryCheckpointKey('test-game')))], [1, 2, 3, 4]);
  assert.deepEqual([...G.base64ToBytes(h.storage.get(G.recoveryCheckpointBackupKey('test-game')))], [0, 2, 3, 4]);
  assert.equal(h.work.filter(x => x === 'encode').length, 1);
});

test('autosave flushes pending recovery, switch keeps the original ROM key, and reset cancels delayed writes', () => {
  const h = harness();
  h.run('checkpointBeforeInput(); autosaveCurrent()');
  assert.ok(h.storage.has(G.recoveryCheckpointKey('test-game')));
  h.run('recoveryCheckpointReady = true; sendEmulatorKey(53)');
  h.run("currentRom.id = 'other-game'; resetRecoveryTracking('other-game')");
  assert.equal(h.storage.has(G.recoveryCheckpointKey('other-game')), false);
  h.run('recoveryCheckpointReady = true; checkpointBeforeInput()');
  h.run("clearResumeSnapshots('other-game'); flushRecoveryCheckpoints()");
  assert.equal(h.storage.has(G.recoveryCheckpointKey('other-game')), false);
  assert.equal(h.timers.size, 0);
});
