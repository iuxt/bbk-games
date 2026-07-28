import test from "node:test";
import assert from "node:assert/strict";

await import("../bbk-games/app.js");

const Simulator = globalThis.BBKSimulator;

test("simulator converts ROM bytes to uppercase hexadecimal", () => {
    const bytes = Uint8Array.from([0, 1, 15, 16, 127, 128, 255]);

    assert.equal(
        Simulator.arrayBufferToHex(bytes.buffer),
        "00010F107F80FF"
    );
});

test("simulator handles an empty ROM buffer", () => {
    assert.equal(Simulator.arrayBufferToHex(new ArrayBuffer(0)), "");
});
