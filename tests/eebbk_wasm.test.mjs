import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";

await import('../eebbk/glue.js');

const runtimeSource = fs.readFileSync("eebbk/gam4988.js", "utf8");
const wasmBytes = new Uint8Array(fs.readFileSync("eebbk/gam4988.wasm"));
const biosBytes = new Uint8Array(fs.readFileSync("eebbk/gam4988.data"));

async function createModule() {
  const factory = vm.runInThisContext(runtimeSource + ";Gam4988Module");
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
  assert.doesNotMatch(markup, /<script[^>]+gam4988\.js/);
  assert.doesNotMatch(runtimeSource, /MEMFS|FS_createDataFile|gam4988\.data/);
  assert.equal(biosBytes.byteLength, 13 * 0x200000, "A4988 数据包应包含 13 个 2 MiB 区段");
});

test("A4988 home system exposes and restores the complete 2 MiB Flash", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);

  assert.equal(mod._web_save_ram_size(), 0x200000);
  assert.equal(typeof mod._web_tick_rtc, "function");
  const savePtr = mod._malloc(0x200000);
  mod._web_save_ram(savePtr);
  const flash = new Uint8Array(mod.HEAPU8.buffer, savePtr, 0x200000);
  assert.deepEqual(flash.slice(0x8000, 0x8010), biosBytes.slice(0, 0x10));
  const changed = flash.slice();
  changed[0x12345] ^= 0xff;
  mod.HEAPU8.set(changed, savePtr);
  assert.equal(mod._web_load_save_ram(savePtr, 0x200000), 1);
  mod.HEAPU8.fill(0, savePtr, savePtr + 0x200000);
  mod._web_save_ram(savePtr);
  assert.equal(mod.HEAPU8[savePtr + 0x12345], changed[0x12345]);
  mod._free(savePtr);
});

test("EEBBK wasm initializes with complete A4988 ROMs and reports clean LCD frames", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);
  assert.ok(mod.HEAPU8.buffer.byteLength >= 64 * 1024 * 1024);

  const rom = new Uint8Array(fs.readFileSync("eebbk/roms/伏魔记怀旧终曲v1.0(原版精修).gam"));
  const romPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, romPtr);
  assert.equal(mod._web_load_game(romPtr, rom.byteLength), 1);
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

test("EEBBK wasm delivers rapid keys in order instead of overwriting the pending key", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);

  const rom = new Uint8Array(fs.readFileSync("eebbk/roms/伏魔记怀旧终曲v1.0(原版精修).gam"));
  const romPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, romPtr);
  assert.equal(mod._web_load_game(romPtr, rom.byteLength), 1);
  mod._free(romPtr);
  for (let i = 0; i < 600; i += 1) mod._web_run_frame();

  const statePtr = mod._malloc(mod._web_save_size());
  const delivered = [];
  mod._web_keydown(0x2a);
  mod._web_keydown(0x2d);
  for (let i = 0; i < 30 && delivered.length < 2; i += 1) {
    mod._web_run_frame();
    mod._web_save(statePtr);
    const key = mod.HEAPU8[statePtr + 0x2008 + 0x0f];
    if (key && delivered[delivered.length - 1] !== key) delivered.push(key);
  }
  mod._free(statePtr);

  assert.deepEqual(delivered, [0x2a, 0x2d], "查找必须先于删除交给游戏固件");
});

test("EEBBK wasm rejects malformed ROMs without replacing the running game", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);

  const tooShort = new Uint8Array([0x47, 0x41, 0x4d, 0x00]);
  const shortPtr = mod._malloc(tooShort.byteLength);
  mod.HEAPU8.set(tooShort, shortPtr);
  assert.equal(mod._web_load_game(shortPtr, tooShort.byteLength), 0);
  mod._free(shortPtr);

  const badHeader = new Uint8Array(0x46);
  const badPtr = mod._malloc(badHeader.byteLength);
  mod.HEAPU8.set(badHeader, badPtr);
  assert.equal(mod._web_load_game(badPtr, badHeader.byteLength), 0);
  mod._free(badPtr);

  const rom = new Uint8Array(fs.readFileSync("eebbk/roms/伏魔记怀旧终曲v1.0(原版精修).gam"));
  const romPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, romPtr);
  assert.equal(mod._web_load_game(romPtr, rom.byteLength), 1);
  mod._free(romPtr);
});

test("EEBBK wasm native save RAM round-trips the 80 KiB libretro layout", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);

  const rom = new Uint8Array(fs.readFileSync("eebbk/roms/伏魔记怀旧终曲v1.0(原版精修).gam"));
  const romPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, romPtr);
  assert.equal(mod._web_load_game(romPtr, rom.byteLength), 1);
  mod._free(romPtr);

  const saveSize = mod._web_save_ram_size();
  assert.equal(saveSize, 0x14000);
  assert.equal(mod._web_save_ram_revision(), 0);

  const savePtr = mod._malloc(saveSize);
  mod._web_save_ram(savePtr);
  const original = new Uint8Array(mod.HEAPU8.buffer, savePtr, saveSize).slice();
  const changed = original.slice();
  changed[0] ^= 0xff;
  changed[saveSize - 1] ^= 0xff;
  mod.HEAPU8.set(changed, savePtr);
  assert.equal(mod._web_load_save_ram(savePtr, saveSize - 1), 0, "截断存档必须拒绝");
  assert.equal(mod._web_load_save_ram(savePtr, saveSize), 1);

  mod.HEAPU8.fill(0, savePtr, savePtr + saveSize);
  mod._web_save_ram(savePtr);
  assert.deepEqual(
    new Uint8Array(mod.HEAPU8.buffer, savePtr, saveSize),
    changed,
    "导入后再次导出须逐字节一致"
  );
  assert.equal(mod._web_save_ram_revision(), 0, "恢复存档本身不应触发自动写回");

  const reloadPtr = mod._malloc(rom.byteLength);
  mod.HEAPU8.set(rom, reloadPtr);
  assert.equal(mod._web_load_game(reloadPtr, rom.byteLength), 1);
  mod._free(reloadPtr);
  mod._web_save_ram(savePtr);
  assert.deepEqual(
    new Uint8Array(mod.HEAPU8.buffer, savePtr, saveSize),
    original,
    "热切换 ROM 时不得继承上一个游戏的 Flash 存档"
  );
  mod._free(savePtr);
});

test("EEBBK wasm only restores complete quick snapshots", async () => {
  const mod = await createModule();
  const biosPtr = mod._malloc(biosBytes.byteLength);
  mod.HEAPU8.set(biosBytes, biosPtr);
  assert.equal(mod._web_init(biosPtr, biosBytes.byteLength), 0);
  mod._free(biosPtr);

  const size = mod._web_save_size();
  const ptr = mod._malloc(size + 1);
  mod._web_save(ptr);
  assert.equal(mod._web_load(ptr, size - 1), 0, "截断快照必须拒绝");
  assert.equal(mod._web_load(ptr, size + 1), 0, "超长快照必须拒绝");
  assert.equal(mod._web_load(ptr, size), 1, "完整快照应成功恢复");
  mod._free(ptr);
});

test('终曲 search toggles visible coordinates and delete opens the encounter dialog', async () => {
  const mod = await createModule();
  function load(bytes, fn) {
    const ptr = mod._malloc(bytes.length);
    mod.HEAPU8.set(bytes, ptr);
    const result = fn(ptr, bytes.length);
    mod._free(ptr);
    return result;
  }
  assert.equal(load(biosBytes, mod._web_init), 0);
  const rom = fs.readFileSync('eebbk/roms/伏魔记怀旧终曲v1.0(原版精修).gam');
  assert.equal(load(rom, mod._web_load_game), 1);
  const G = globalThis.BBK4988Glue;
  const fingerprint = G.romStorageId(rom);
  const frames = count => { for (let i = 0; i < count; i++) mod._web_run_frame(); };
  function key(code) {
    for (const native of G.gameKeySequence(code, fingerprint)) mod._web_keydown(native);
    frames(120);
  }
  const enters = count => { for (let i = 0; i < count; i++) key(0x2f); };
  function pixels() {
    const ptr = mod._web_get_framebuffer_rgba();
    return Uint8Array.from({ length: 159 * 96 }, (_, i) => mod.HEAPU8[ptr + i * 4] === 0 ? 1 : 0);
  }
  function dialogHash() {
    return createHash('sha256').update(pixels().slice(159 * 64)).digest('hex');
  }
  const coordinateBox = () => pixels().slice(0, 159 * 12);

  // Replay a new game, choosing “需要” for both encounter and coordinate switches.
  // This exercises the real game/firmware rather than merely checking its key mailbox.
  frames(600);
  enters(2);
  frames(6000);
  enters(11);
  key(0x38);
  enters(5);
  key(0x38);
  enters(16);
  frames(600);
  enters(10);
  const hidden = coordinateBox();
  const initialState = mod._malloc(mod._web_save_size());
  mod._web_save(initialState);

  key(0x2a);
  // Visually verified LCD text: “请选择是否开启地图坐标。”
  assert.equal(dialogHash(), '7e4102f79ec3dca81b119e6a9a7597f7a714d049f53b753509a67b43c77d2db3');
  key(0x2f);
  key(0x38);
  enters(2);
  assert.notDeepEqual(coordinateBox(), hidden, '地图左上角应显示坐标');
  key(0x2a);
  // Visually verified LCD text: “请选择是否关闭地图坐标。”
  assert.equal(dialogHash(), 'aace8f295caa4620f4bc8521b21b2f782cfccc606ffdbe3da4c8c566ad6f6c98');
  key(0x2f);
  key(0x38);
  enters(2);
  // The ROM leaves the old coordinate pixels until the map next redraws. Reopening
  // the dialog verifies that its setting really switched back off.
  key(0x2a);
  assert.equal(dialogHash(), '7e4102f79ec3dca81b119e6a9a7597f7a714d049f53b753509a67b43c77d2db3');
  key(0x2f);
  key(0x2f);

  key(0x2d);
  // Visually verified LCD text: “请选择是否关闭随机遇敌。”
  assert.equal(dialogHash(), 'b4c47b862dde15d6eb57c865c60c727bc42629341857aaca60238106163f8e9c',
    '删除键应直接弹出遇敌菜单，不应留下等待下一方向键的 Shift');

  // Independently verify the standalone Shift button from the same map state.
  assert.equal(mod._web_load(initialState, mod._web_save_size()), 1);
  mod._free(initialState);
  key(0x28);
  key(0x38);
  assert.equal(dialogHash(), '7e4102f79ec3dca81b119e6a9a7597f7a714d049f53b753509a67b43c77d2db3');
});
