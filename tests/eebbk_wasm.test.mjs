import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const runtimeSource = fs.readFileSync("eebbk/gam4980.js", "utf8");
const wasmBytes = new Uint8Array(fs.readFileSync("eebbk/gam4980.wasm"));
const biosBytes = new Uint8Array(fs.readFileSync("eebbk/gam4980.data"));

async function createModule() {
  const factory = vm.runInThisContext(runtimeSource + ";Gam4980Module");
  return factory({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) => receive(instance));
      return {};
    },
    print() {},
    printErr() {},
  });
}

test("EEBBK runtime stays lazy and excludes the MEMFS preload runtime", () => {
  const markup = fs.readFileSync("eebbk/index.html", "utf8");
  assert.doesNotMatch(markup, /<script[^>]+gam4980\.js/);
  assert.doesNotMatch(runtimeSource, /MEMFS|FS_createDataFile|gam4980\.data/);
});

test("EEBBK wasm initializes in 16 MiB and reports clean LCD frames", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);
  assert.equal(mod.HEAPU8.buffer.byteLength, 16 * 1024 * 1024);

  const rom = new Uint8Array(fs.readFileSync("eebbk/roms/伏魔记.gam"));
  const romPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, romPtr);
  mod._web_load_game(romPtr, rom.byteLength);
  mod._free(romPtr);

  let dirtyFrames = 0;
  let cleanFrames = 0;
  for (let i = 0; i < 600; i += 1) {
    if (mod._web_run_frame()) dirtyFrames += 1;
    else cleanFrames += 1;
  }
  assert.ok(dirtyFrames > 0, "启动过程中应产生 LCD 更新");
  assert.ok(cleanFrames > 0, "静止画面应被脏帧检测跳过");

  const framePtr = mod._web_get_framebuffer_rgba();
  const frame = new Uint8Array(mod.HEAPU8.buffer, framePtr, 159 * 96 * 4);
  assert.equal(frame.length, 159 * 96 * 4);
  assert.equal(frame[3], 255);
});
