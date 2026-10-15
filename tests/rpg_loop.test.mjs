import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('RPG pauses while hidden or in the back-forward cache, then resumes exactly one fixed-step loop', () => {
  const source = fs.readFileSync('fmj_kt/glue/head.js', 'utf8');
  const code = source.slice(source.indexOf('  var updateCallback ='), source.indexOf('  // Reuse the canvas context'));
  const timers = new Map(); const events = {};
  let next = 0, ticks = 0;
  const document = { hidden: false, addEventListener(name, fn) { events[name] = fn; } };
  const global = { addEventListener(name, fn) { events[name] = fn; } };
  const context = { global, document, game: {}, call: fn => fn(),
    setInterval(fn, delay) { assert.equal(delay, 40); timers.set(++next, fn); return next; },
    clearInterval: id => timers.delete(id),
  };
  vm.runInNewContext(code, context);
  global.sysSetInterval(40, () => ticks++);
  [...timers.values()][0](); assert.equal(ticks, 1);
  document.hidden = true; events.visibilitychange(); assert.equal(timers.size, 0);
  document.hidden = false; events.visibilitychange(); events.visibilitychange();
  assert.equal(timers.size, 1);
  events.pagehide(); assert.equal(timers.size, 0);
  events.visibilitychange(); assert.equal(timers.size, 0);
  events.pageshow(); assert.equal(timers.size, 1);
  [...timers.values()][0](); assert.equal(ticks, 2, 'resume must not replay elapsed background time');
});

test('automatic map loading does not encode a discarded full-map PNG', () => {
  const source = fs.readFileSync('rpg/core.js', 'utf8');
  const start = source.indexOf('  ScreenMainGame.prototype.loadMap_');
  assert.ok(start >= 0);
  const body = source.slice(start, source.indexOf('  ScreenMainGame.prototype.generateMapBase64', start));
  assert.doesNotMatch(body, /this\.generateMapBase64\(/);
});
