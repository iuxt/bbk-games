import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

await import("../rpg/app.js");
const { extractLibFromGam } = globalThis.BBKSimulator;

// 用仓库内的真实 lib 合成一个 .gam：GAM\0 头 + 内嵌 LIB 段。
function synthGam(libBytes, headerLen, headerFill = 0) {
    const header = Buffer.alloc(headerLen, headerFill);
    header[0] = 0x47; // G
    header[1] = 0x41; // A
    header[2] = 0x4d; // M
    header[3] = 0x00; // \0
    return Buffer.concat([header, libBytes]);
}

const lib = readFileSync(new URL("../rpg/roms/fmj_zsb.lib", import.meta.url));

test("extracts the embedded lib from a synthetic .gam verbatim", () => {
    const gam = synthGam(lib, 0x48000);
    const out = extractLibFromGam(gam);
    assert.equal(out.length, lib.length);
    assert.equal(Buffer.from(out).equals(lib), true);
});

test("locates the embedded lib regardless of header length", () => {
    // 动态定位：不依赖固定偏移 0x48000
    for (const headerLen of [0x1000, 0x2000, 0x12345, 0x48000]) {
        const out = extractLibFromGam(synthGam(lib, headerLen, (headerLen * 7) & 0xff));
        assert.equal(Buffer.from(out).equals(lib), true, `headerLen=0x${headerLen.toString(16)}`);
    }
});

test("ignores a stray LIB byte sequence that is not a valid lib", () => {
    // 头部里塞一个假的 "LIB" 字串，但后续结构非法，应被跳过，提取真正的内嵌 lib
    const header = Buffer.alloc(0x2000, 0);
    header[0] = 0x47; header[1] = 0x41; header[2] = 0x4d; header[3] = 0x00;
    header[100] = 0x4c; header[101] = 0x49; header[102] = 0x42; // 假 LIB
    header[0x10 + 100] = 0x00; // resType=0 非法 → validate 失败
    const gam = Buffer.concat([header, lib]);
    const out = extractLibFromGam(gam);
    assert.equal(Buffer.from(out).equals(lib), true);
});

test("rejects a .gam without an embedded lib", () => {
    assert.throws(() => extractLibFromGam(Buffer.alloc(100, 0)), /未找到|fmj/);
});

test("rejects a GAM\\0 header followed by too little data", () => {
    const tiny = Buffer.alloc(0x10, 0);
    tiny[0] = 0x47; tiny[1] = 0x41; tiny[2] = 0x4d; tiny[3] = 0x00;
    assert.throws(() => extractLibFromGam(tiny), /未找到|fmj/);
});
