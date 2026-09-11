import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function renderingCode(file) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  return source.slice(source.indexOf('  // Reuse the canvas context'), source.indexOf('  global.sysExit'));
}

test('RPG renderer reuses storage, preserves clamped theme/alpha bytes and rebuilds after resize', () => {
  const code = renderingCode('../rpg/core.js');
  assert.equal(code, renderingCode('../fmj_kt/glue/head.js'), 'generated engine and host source must agree');
  let allocations = 0, lookups = 0;
  const frames = [];
  const ctx = {
    createImageData(width, height) { allocations++; return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(img) { frames.push(img); },
  };
  const context = { global: {}, renderPeixel: [0.5, 1.25, 0.75], getLCD() { lookups++; return ctx; } };
  vm.runInNewContext(code, context);
  const pixels = [{ r: 255, g: 240, b: 12, a: 255 }, { r: -5, g: 2, b: 999, a: 0 }];
  function expected(buffer) {
    return new Uint8ClampedArray(buffer.flatMap(p => [p.r * context.renderPeixel[0], p.g * context.renderPeixel[1], p.b * context.renderPeixel[2], p.a]));
  }
  context.global.sysDrawScreen(pixels, 2, 1);
  assert.deepEqual(frames[0].data, expected(pixels));
  context.renderPeixel = [1, 0.5, 0.5];
  context.global.sysDrawScreen(pixels.slice().reverse(), 2, 1);
  assert.equal(allocations, 1);
  assert.equal(lookups, 1);
  assert.equal(frames[0], frames[1]);
  assert.deepEqual(frames[1].data, expected(pixels.slice().reverse()));
  context.global.sysDrawScreen(pixels, 1, 2);
  assert.equal(allocations, 2);
  assert.notEqual(frames[1], frames[2]);
  assert.deepEqual(frames[2].data, expected(pixels));
});
