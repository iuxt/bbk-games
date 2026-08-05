/* ---- glue.js — GAM4980 Web Emulator JS Glue ---- */

(function (global) {
  'use strict';

  /* ---------- 纯函数（供 node 单测，不依赖 DOM / wasm） ---------- */

  function bytesToBase64(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(str) {
    if (!str) return new Uint8Array(0);
    const binary = global.atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function isValidBase64(value) {
    return typeof value === 'string' && value.length > 0 && value.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  function romStorageId(bytes, catalogId) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (catalogId) return catalogId;
    let hash = 2166136261;
    for (let i = 0; i < bytes.length; i += 1) {
      hash ^= bytes[i];
      hash = Math.imul(hash, 16777619);
    }
    return 'local-' + bytes.length + '-' + (hash >>> 0).toString(16).padStart(8, '0');
  }

  function slotKey(storageId, slot) {
    if (!storageId || !Number.isInteger(slot) || slot < 0 || slot > 2) {
      throw new Error('无效的游戏或存档槽位');
    }
    return 'sav/gamesave' + slot + '-' + storageId;
  }

  function autosaveKey(storageId) {
    if (!storageId) throw new Error('无效的游戏');
    return 'sav/autosave-' + storageId;
  }

  function buildSavePayload(storageId, gameName, slot, base64Data, exportedAt) {
    if (!isValidBase64(base64Data)) {
      throw new Error('存档数据为空或不是合法 base64');
    }
    slotKey(storageId, slot);
    return {
      app: 'bbk-games',
      type: 'eebbk-save-slot',
      version: 1,
      romId: storageId,
      romName: gameName || storageId,
      slot: slot,
      data: base64Data,
      exportedAt: exportedAt || new Date().toISOString()
    };
  }

  function parseSavePayload(source, expectedStorageId) {
    let payload;
    try {
      payload = typeof source === 'string' ? JSON.parse(source) : source;
    } catch (e) {
      return { ok: false, error: '无法读取备份文件。' };
    }
    if (!payload ||
        payload.app !== 'bbk-games' ||
        payload.type !== 'eebbk-save-slot' ||
        payload.version !== 1 ||
        !Number.isInteger(payload.slot) ||
        payload.slot < 0 || payload.slot > 2 ||
        !isValidBase64(payload.data) ||
        typeof payload.romId !== 'string' || !payload.romId) {
      return { ok: false, error: '这不是有效的 EEBBK 存档。' };
    }
    if (expectedStorageId && payload.romId !== expectedStorageId) {
      return { ok: false, error: '该存档属于其他游戏，不能导入到当前游戏。' };
    }
    return { ok: true, payload: payload };
  }

  global.BBK4980Glue = {
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    isValidBase64: isValidBase64,
    romStorageId: romStorageId,
    slotKey: slotKey,
    autosaveKey: autosaveKey,
    buildSavePayload: buildSavePayload,
    parseSavePayload: parseSavePayload
  };

  /* ---------- 以下依赖 DOM / wasm，仅在浏览器执行 ---------- */
  if (!global.document) return;

  /* ---------- DOM refs ---------- */
  const canvas    = document.getElementById('screen');
  const ctx       = canvas.getContext('2d');
  const wrapper   = document.getElementById('screen-wrapper');
  const placeholder = document.getElementById('placeholder');
  const fileInput = document.getElementById('file-input');
  const loadBtn   = document.getElementById('load-btn');
  const saveBtn   = document.getElementById('save-btn');
  const loadStateBtn = document.getElementById('load-btn-state');
  const errorOverlay = document.getElementById('error-overlay');
  const errorTitle   = document.getElementById('error-title');
  const errorDetail  = document.getElementById('error-detail');
  const restartBtn   = document.getElementById('restart-btn');
  const stateFileInput = document.createElement('input');

  stateFileInput.type = 'file';
  stateFileInput.accept = '.sav';
  stateFileInput.style.display = 'none';
  document.body.appendChild(stateFileInput);

  /* ---------- state ---------- */
  let Module = null;
  let running = false;   /* rAF loop active */
  let started = false;   /* emulator powered on (home UI or game) */
  let gameLoaded = false;
  let exited = false;    /* runtime has exited (power-off / fatal error) */
  let animId = 0;

  /* ---------- PC key → emulator key mapping ---------- */
  const KEY_ENTER  = 0x2f;
  const KEY_EXIT   = 0x2e;
  const KEY_UP     = 0x35;
  const KEY_DOWN   = 0x38;
  const KEY_LEFT   = 0x37;
  const KEY_RIGHT  = 0x39;
  const KEY_PGUP   = 0x3a;
  const KEY_PGDN   = 0x3b;
  const KEY_HELP   = 0x29;
  const KEY_SEARCH = 0x2a;
  const KEY_INSERT = 0x2b;
  const KEY_MODIFY = 0x2c;
  const KEY_DEL    = 0x2d;
  const KEY_SPACE  = 0x36;
  const KEY_SHIFT  = 0x28;
  const KEY_INPUT  = 0x20;

  const KEY_ON_OFF    = 0x00;
  const KEY_HOME_MENU = 0x01;
  const KEY_EC_SJ     = 0x02;
  const KEY_EC_SW     = 0x03;
  const KEY_CE        = 0x04;
  const KEY_DLG       = 0x05;
  const KEY_DOWNLOAD  = 0x06;
  const KEY_SPK       = 0x07;

  function letterKey(ch) {
    const base = ch.toUpperCase().charCodeAt(0);
    if (base >= 65 && base <= 90) {
      const map = [0x18,0x25,0x23,0x1a,0x12,0x1b,0x1c,0x1d,  // A-H
                   0x17,0x1e,0x1f,0x34,0x27,0x26,0x32,0x33,   // I-P
                   0x10,0x13,0x19,0x14,0x16,0x24,0x11,0x22,   // Q-X
                   0x15,0x21];                                  // Y-Z
      return map[base - 65] || 0;
    }
    if (base >= 48 && base <= 57) {
      const map = [0x31,0x08,0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,0x30];
      return map[base - 48];
    }
    return 0;
  }

  function pcKeyToEmuKey(e) {
    switch (e.key) {
      case 'F1': return KEY_ON_OFF;
      case 'F2': return KEY_HOME_MENU;
      case 'F3': return KEY_EC_SJ;
      case 'F4': return KEY_EC_SW;
      case 'F5': return KEY_CE;
      case 'F6': return KEY_DLG;
      case 'F7': return KEY_DOWNLOAD;
      case 'F8': return KEY_SPK;
      case 'Enter':   return KEY_ENTER;
      case 'Escape':  return KEY_EXIT;
      case 'ArrowUp':    return KEY_UP;
      case 'ArrowDown':  return KEY_DOWN;
      case 'ArrowLeft':  return KEY_LEFT;
      case 'ArrowRight': return KEY_RIGHT;
      case 'PageUp':   return KEY_PGUP;
      case 'PageDown': return KEY_PGDN;
      case 'Backspace': case 'Delete': return KEY_DEL;
      case ' ': return KEY_SPACE;
      case 'Shift': return KEY_SHIFT;
      case 'CapsLock': return KEY_INPUT;
      default: return letterKey(e.key);
    }
  }

  /* ---------- Canvas rendering ---------- */
  function render() {
    const fbPtr = Module._web_get_framebuffer();
    const w     = Module._web_get_fb_width();
    const h     = Module._web_get_fb_height();
    const fbLen = (w + 1) * h;  // pitch includes +1 padding
    const fb16  = new Uint16Array(Module.HEAPU16.buffer, fbPtr, fbLen);

    const img = ctx.createImageData(w, h);
    const d   = img.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const rgb565 = fb16[y * (w + 1) + x];
        const r = ((rgb565 >> 11) & 0x1f) << 3;
        const g = ((rgb565 >>  5) & 0x3f) << 2;
        const b = ((rgb565 >>  0) & 0x1f) << 3;
        const off = (y * w + x) * 4;
        d[off]     = r;
        d[off + 1] = g;
        d[off + 2] = b;
        d[off + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- Power on: show canvas + start the frame loop ---------- */
  function startEmulator() {
    if (started) return;
    started = true;
    canvas.width  = Module._web_get_fb_width();
    canvas.height = Module._web_get_fb_height();
    placeholder.classList.remove('show');
    canvas.classList.add('show');
    if (!running) {
      running = true;
      animId = requestAnimationFrame(frame);
    }
  }

  /* ---------- Main loop ---------- */
  function frame() {
    if (!running || !started) return;
    try {
      Module._web_run_frame();
    } catch (e) {
      // 设备关机 / BRK 会触发 emscripten_force_exit，抛出 ExitStatus；其他异常也一并不再以
      // uncaught 形式打到控制台，统一在前端浮层提示。status===0 视为正常关机，其余按运行出错处理。
      if (e && e.name === 'ExitStatus' && e.status === 0) {
        fatalError('设备已关机', '模拟器已停止运行，点击下方按钮重新开机。');
      } else {
        fatalError('运行出错', (e && e.message) ? String(e.message) : String(e));
      }
      return;
    }
    render();
    animId = requestAnimationFrame(frame);
  }

  /* ---------- Fatal error / power-off: stop the loop and surface in the UI ---------- */
  function fatalError(title, detail) {
    if (exited) return;
    exited = true;
    running = false;
    started = false;
    if (animId) cancelAnimationFrame(animId);
    canvas.classList.remove('show');
    errorTitle.textContent = title;
    errorDetail.textContent = detail;
    errorOverlay.classList.add('show');
  }

  /* ---------- Load game from buffer ---------- */
  function loadGame(data, name) {
    if (exited) return;   /* runtime already torn down — ignore until reload */
    const size = data.byteLength;
    const ptr  = Module._malloc(size);
    Module.HEAPU8.set(new Uint8Array(data), ptr);
    Module._web_load_game(ptr, size);
    Module._free(ptr);

    gameLoaded = true;
    startEmulator();   /* power on if not already (loop keeps running) */
    console.log('Loaded game:', name, '(' + (size / 1024).toFixed(1) + ' KB)');
  }

  /* ---------- Save/Load state ---------- */
  function doSave() {
    if (exited || !gameLoaded) return;
    const size = Module._web_save_size();
    const ptr  = Module._malloc(size);
    Module._web_save(ptr);
    const buf = new Uint8Array(Module.HEAPU8.buffer, ptr, size).slice();
    Module._free(ptr);

    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'gam4980.sav';
    a.click();
    URL.revokeObjectURL(url);
  }

  function doLoadState(file) {
    if (exited) return;
    const reader = new FileReader();
    reader.onload = function() {
      const data = new Uint8Array(reader.result);
      const ptr  = Module._malloc(data.byteLength);
      Module.HEAPU8.set(data, ptr);
      Module._web_load(ptr, data.byteLength);
      Module._free(ptr);
      console.log('State loaded');
    };
    reader.readAsArrayBuffer(file);
  }

  /* ---------- Event bindings ---------- */
  loadBtn.addEventListener('click', function() { fileInput.click(); });

  fileInput.addEventListener('change', function() {
    if (!fileInput.files.length) return;
    const f = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = function() { loadGame(reader.result, f.name); };
    reader.readAsArrayBuffer(f);
  });

  saveBtn.addEventListener('click', doSave);

  restartBtn.addEventListener('click', function() { location.reload(); });

  loadStateBtn.addEventListener('click', function() { stateFileInput.click(); });

  stateFileInput.addEventListener('change', function() {
    if (stateFileInput.files.length) doLoadState(stateFileInput.files[0]);
  });

  /* ---------- Drag & drop ---------- */
  wrapper.addEventListener('dragover', function(e) {
    e.preventDefault();
    wrapper.classList.add('drag-over');
  });

  wrapper.addEventListener('dragleave', function() {
    wrapper.classList.remove('drag-over');
  });

  wrapper.addEventListener('drop', function(e) {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function() { loadGame(reader.result, f.name); };
    reader.readAsArrayBuffer(f);
  });

  /* ---------- Touchpad (on-screen keys, touch / narrow screens) ---------- */
  const touchpad = document.getElementById('touchpad');

  function releaseKey(btn) {
    if (btn && btn._timer) {
      clearInterval(btn._timer);
      btn._timer = 0;
    }
  }

  touchpad.addEventListener('pointerdown', function(e) {
    if (!started || exited) return;
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const key = parseInt(btn.dataset.key, 10);
    if (isNaN(key)) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    Module._web_keydown(key);
    /* 核心按键是事件型（无 keyup）：按住时周期重发，模拟键盘自动重复，
       这样触屏按住方向键才能持续移动。 */
    if (btn._timer) clearInterval(btn._timer);
    btn._timer = setInterval(function() { Module._web_keydown(key); }, 100);
  });

  touchpad.addEventListener('pointerup', function(e) { releaseKey(e.target.closest('.btn')); });
  touchpad.addEventListener('pointercancel', function(e) { releaseKey(e.target.closest('.btn')); });

  /* ---------- Keyboard ---------- */
  document.addEventListener('keydown', function(e) {
    if (!started) return;   /* accept keys whenever the device is powered on */
    const key = pcKeyToEmuKey(e);
    if (key !== undefined && key !== 0) {
      // Only prevent default for unmodified keys (don't break Ctrl+W, Alt+D, etc.)
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
      }
      Module._web_keydown(key);
    }
  });

  /* ---------- Bootstrap ---------- */
  Gam4980Module({
    print: function(text) { console.log('[C] ' + text); },
    printErr: function(text) {
      // 关机时 emscripten 会输出 "Program terminated with exit(0)"，属正常退出，
      // 已由前端浮层提示，这里不再打到控制台。
      if (typeof text === 'string' && text.indexOf('Program terminated with exit(') !== -1) return;
      console.warn('[C] ' + text);
    },
  }).then(function(mod) {
    Module = mod;
    if (Module._web_init() !== 0) {
      fatalError('初始化失败', '缺少 8.BIN / E.BIN 固件文件，无法启动模拟器。');
      return;
    }
    startEmulator();   /* power on → go straight to the device home screen */
  }).catch(function(err) {
    fatalError('初始化失败', (err && err.message) ? err.message : String(err));
  });

}(typeof window !== "undefined" ? window : globalThis));
