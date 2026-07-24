import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 从 backup.html 提取内联 <script>（无 src 的那块），用 vm 执行真实代码
const html = readFileSync(new URL('../backup.html', import.meta.url), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(m, '未找到 backup.html 的内联脚本');
const scriptSource = m[1];

function setup(initial = {}) {
    const localStorage = {
        ...initial,
        getItem(key) { return key in this ? this[key] : null; },
        setItem(key, value) { this[key] = String(value); },
        removeItem(key) { delete this[key]; },
    };
    let lastBlob = null;
    class Blob { constructor(parts) { this.parts = parts; lastBlob = this; } }
    const document = {
        createElement: () => ({ click() {}, remove() {} }),
        body: { appendChild() {} },
    };
    class FileReader {
        readAsText(file) {
            this.result = file.content; // 真实浏览器完成后 reader.result 即文件文本
            this.onload({ target: { result: file.content } });
        }
    }
    const chain = {
        text() { return this; },
        addClass() { return this; },
        removeClass() { return this; },
        prop() { return this; },
        attr() { return this; },
        toggleClass() { return this; },
        html() { return this; },
        each() { return this; },
        data() { return null; },
    };
    const context = {
        window: { localStorage },
        localStorage,
        document,
        console: { log() {}, warn() {} },
        alert() {},
        Blob,
        URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
        FileReader,
        $: () => chain,
        getLibName: () => '霸哥自制版',
        getLibPath: () => 'libs/sc-mod.lib',
    };
    vm.runInNewContext(scriptSource, context);
    context.storage = localStorage;
    context.lastBlob = () => lastBlob;
    return context;
}

test('exportSlot 把存档槽序列化为标准 JSON', () => {
    const ctx = setup({
        'baye//data//sango0.sav': 'AAA',
        'baye//data//sango1.sav': 'BBB',
    });
    ctx.exportSlot(0);

    const blob = ctx.lastBlob();
    assert.ok(blob, '应生成下载 Blob');
    const data = JSON.parse(blob.parts[0]);
    assert.equal(data.app, 'bbk-games');
    assert.equal(data.type, 'sango-save-slot');
    assert.equal(data.ver, 1);
    assert.equal(data.slot, 0);
    assert.equal(data.libname, '霸哥自制版');
    assert.equal(data.libpath, 'libs/sc-mod.lib');
    assert.deepEqual(data.files, ['AAA', 'BBB']);
});

test('exportSlot 遇到空槽不生成下载', () => {
    const ctx = setup({});
    ctx.exportSlot(1);
    assert.equal(ctx.lastBlob(), null);
});

test('还原往返：导出后还原到另一槽，存档内容与版本均恢复', () => {
    const ctx = setup({
        'baye//data//sango0.sav': 'AAA',
        'baye//data//sango1.sav': 'BBB',
    });
    ctx.exportSlot(0);
    const json = ctx.lastBlob().parts[0];

    // 模拟换设备/清缓存：清空原槽
    delete ctx.storage['baye//data//sango0.sav'];
    delete ctx.storage['baye//data//sango1.sav'];

    // 上传文件 → 选目标槽 2（sango4/sango5）→ 还原
    ctx.onFilePicked({ files: [{ content: json }] });
    ctx.pickSlot(2);
    ctx.doRestore();

    assert.equal(ctx.storage['baye//data//sango4.sav'], 'AAA');
    assert.equal(ctx.storage['baye//data//sango5.sav'], 'BBB');
    assert.equal(ctx.storage['baye/libname'], '霸哥自制版');
    assert.equal(ctx.storage['baye/libpath'], 'libs/sc-mod.lib');
});

test('还原非法文件时不写入任何存档', () => {
    const ctx = setup({});
    ctx.onFilePicked({ files: [{ content: '不是存档' }] });
    ctx.doRestore();
    assert.equal(ctx.storage['baye//data//sango0.sav'], undefined);
});

test('备份文件可跨任意 Unicode 内容无损往返', () => {
    const tricky = '含.点号/斜杠"引号"及 emoji🎮 与换行\n的数据';
    const ctx = setup({
        'baye//data//sango2.sav': tricky,
        'baye//data//sango3.sav': 'XYZ',
    });
    ctx.exportSlot(1);
    const json = ctx.lastBlob().parts[0];

    delete ctx.storage['baye//data//sango2.sav'];
    delete ctx.storage['baye//data//sango3.sav'];

    ctx.onFilePicked({ files: [{ content: json }] });
    ctx.pickSlot(1);
    ctx.doRestore();

    assert.equal(ctx.storage['baye//data//sango2.sav'], tricky);
    assert.equal(ctx.storage['baye//data//sango3.sav'], 'XYZ');
});
