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

  /* ---------- 电子词典（home）作为可启动条目的纯逻辑 ---------- */
  const HOME_ROM_ID = '__home__';
  const HOME_ROM_NAME = '电子词典系统';
  const HOME_ROM = {
    id: HOME_ROM_ID,
    name: HOME_ROM_NAME,
    py: 'dianzicidianxitong',
    initial: 'dzcdxt',
    isSystem: true
  };

  /* 置顶推荐系列：紧跟「电子词典系统」之后展示，便于快速进入经典 RPG/策略。
     命中即置顶；组间按 PINNED_KEYS 给定顺序，组内保持 catalog 原相对顺序。
     其余游戏仍按 catalog（拼音）序排在最后。 */
  const PINNED_KEYS = ["伏魔", "三国霸业", "魔塔"];

  function pinnedKeyIndex(name) {
    if (!name) return -1;
    for (let i = 0; i < PINNED_KEYS.length; i++) {
      if (name.indexOf(PINNED_KEYS[i]) !== -1) return i;
    }
    return -1;
  }

  function buildPickerGames(catalogGames) {
    const list = Array.isArray(catalogGames) ? catalogGames : [];
    const buckets = PINNED_KEYS.map(function () { return []; });
    const rest = [];
    list.forEach(function (g) {
      const idx = pinnedKeyIndex(g && g.name);
      if (idx >= 0) buckets[idx].push(g);
      else rest.push(g);
    });
    const pinned = [];
    buckets.forEach(function (b) { Array.prototype.push.apply(pinned, b); });
    return [HOME_ROM].concat(pinned, rest);
  }

  /* 启动决策：pending（关机态热切换指令）优先；否则按记住的 currentRomId。
     本地导入 rom（local-*）无法跨 reload 恢复，回落到占位画面。 */
  function decideLaunch(opts) {
    const pendingId = opts && opts.pendingId ? opts.pendingId : '';
    const currentRomId = opts && opts.currentRomId ? opts.currentRomId : '';
    const hasAutosave = !!(opts && opts.hasAutosave);
    if (pendingId) {
      if (pendingId === HOME_ROM_ID) return { action: 'home' };
      return { action: 'rom', id: pendingId, applyAutosave: false };
    }
    if (currentRomId === HOME_ROM_ID) return { action: 'home' };
    if (!currentRomId) return { action: 'placeholder' };
    if (currentRomId.indexOf('local-') === 0) return { action: 'placeholder' };
    return { action: 'rom', id: currentRomId, applyAutosave: hasAutosave };
  }

  /* 在 picker 里选中「电子词典系统」时，按当前设备状态决定如何进入。 */
  function decideHomeLaunch(opts) {
    const exited = !!(opts && opts.exited);
    const started = !!(opts && opts.started);
    if (exited) return 'pending-reload';   // 内核已销毁：写 pending + reload
    if (!started) return 'start';           // 占位画面：直接开机进主屏
    return 'autosave-reload';               // 运行游戏中切换：先 autosave 再 reload
  }

  function saveManagerEnabledFor(id) {
    return !!id && id !== HOME_ROM_ID;
  }

  /* 电子词典系统（home）才需要 目录/输入法/删除 功能键；游戏运行时替换为 R 键。 */
  function isDictionarySystem(id) {
    return id === HOME_ROM_ID;
  }

  function shouldAutosave(id) {
    if (!id) return false;
    if (id === HOME_ROM_ID) return false;
    if (id.indexOf('local-') === 0) return false;
    return true;
  }

  /* 固定逻辑帧步进决策（纯函数，便于单测）。
     web_run_frame 每次代表 1/60 秒硬件时间（见 wasm sys_step），故逻辑帧须恒为 60fps。
     裸 requestAnimationFrame 跟随显示器刷新率：120Hz 屏会把游戏跑成约 2 倍速。
     本函数按墙钟增量累积，每凑满 1000/60 ms 产出一步，从而与刷新率解耦。
     - deltaMs 为负（系统时间回退）按 0 处理。
     - deltaMs 过大时由 maxSteps 触顶并清零余量，避免标签页切回后追帧螺旋。 */
  function planLogicSteps(deltaMs, prevAcc, opts) {
    const STEP_MS = 1000 / 60;
    const maxSteps = (opts && opts.maxSteps) || 6;
    let acc = (prevAcc || 0) + (deltaMs > 0 ? deltaMs : 0);
    let steps = 0;
    while (acc >= STEP_MS && steps < maxSteps) {
      acc -= STEP_MS;
      steps += 1;
    }
    if (steps >= maxSteps) acc = 0;   /* 触顶：丢弃过期时间 */
    return { steps: steps, acc: acc };
  }

  global.BBK4980Glue = {
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    isValidBase64: isValidBase64,
    romStorageId: romStorageId,
    slotKey: slotKey,
    autosaveKey: autosaveKey,
    buildSavePayload: buildSavePayload,
    parseSavePayload: parseSavePayload,
    HOME_ROM_ID: HOME_ROM_ID,
    HOME_ROM: HOME_ROM,
    buildPickerGames: buildPickerGames,
    decideLaunch: decideLaunch,
    decideHomeLaunch: decideHomeLaunch,
    saveManagerEnabledFor: saveManagerEnabledFor,
    isDictionarySystem: isDictionarySystem,
    shouldAutosave: shouldAutosave,
    planLogicSteps: planLogicSteps
  };

  /* ---------- 以下依赖 DOM / wasm，仅在浏览器执行 ---------- */
  if (!global.document) return;

  /* ---------- DOM refs ---------- */
  const canvas    = document.getElementById('screen');
  const ctx       = canvas.getContext('2d');
  const wrapper   = document.getElementById('screen-wrapper');
  const placeholder = document.getElementById('placeholder');
  const errorOverlay = document.getElementById('error-overlay');
  const errorTitle   = document.getElementById('error-title');
  const errorDetail  = document.getElementById('error-detail');
  const restartBtn   = document.getElementById('restart-btn');
  const gamePicker       = document.getElementById('game-picker');
  const gamePickerOpen   = document.getElementById('game-picker-open');
  const gamePickerClose  = document.getElementById('game-picker-close');
  const gamePickerUse    = document.getElementById('game-picker-use');
  const gameList         = document.getElementById('game-list');
  const gameCount        = document.getElementById('game-count');
  const gamePickerError  = document.getElementById('game-picker-error');
  const gamePickerBusy   = document.getElementById('game-picker-busy');
  const gamePickerSearch = document.getElementById('game-picker-search');
  const fileInput        = document.getElementById('file-input');
  const saveManager      = document.getElementById('save-manager');
  const saveManagerOpen  = document.getElementById('save-manager-open');
  const saveManagerClose = document.getElementById('save-manager-close');
  const saveGameName     = document.getElementById('save-game-name');
  const saveSlotList     = document.getElementById('save-slot-list');
  const saveManagerErr   = document.getElementById('save-manager-error');
  const saveManagerStat  = document.getElementById('save-manager-status');
  const saveInput        = document.getElementById('save-input');
  const currentGameName  = document.getElementById('current-game-name');
  const dictRow          = document.getElementById('dict-row');
  const gameRow          = document.getElementById('game-row');

  /* ---------- state ---------- */
  let Module = null;
  let running = false;   /* rAF loop active */
  let started = false;   /* emulator powered on (home UI or game) */
  let gameLoaded = false;
  let exited = false;    /* runtime has exited (power-off / fatal error) */
  let animId = 0;

  const BBK = global.BBK4980Glue;   // 复用已导出的纯函数

  const picker = {
    games: [],
    filtered: [],
    query: '',
    selectedId: '',
    opener: null
  };
  let composing = false;   // 中文输入法组合中，避免拼音过程中误过滤
  let currentRom = { id: '', name: '' };

  /* ---------- LocalStorage helpers ---------- */
  function readLS(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function writeLS(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function removeLS(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function setCurrentRom(id, name) {
    currentRom = { id: id || '', name: name || '电子词典模拟器' };
    writeLS('currentRomId', currentRom.id);
    writeLS('currentRomName', currentRom.name);
    currentGameName.textContent = currentRom.name;
    saveManagerOpen.disabled = !BBK.saveManagerEnabledFor(currentRom.id);
    syncTouchpadMode();
  }

  /* 目录/输入法/删除 仅在运行电子词典系统时显示；游戏（含占位）只保留一个 R 键。 */
  function syncTouchpadMode() {
    const dictMode = BBK.isDictionarySystem(currentRom.id);
    if (dictRow) dictRow.hidden = !dictMode;
    if (gameRow) gameRow.hidden = dictMode;
  }

  function restoreCurrentRomFromStorage() {
    const id = readLS('currentRomId');
    const name = readLS('currentRomName');
    // local-* 来源为已导入的 .gam，重载后无法重新拉取，故不恢复，保持占位画面默认标题。
    if (id && id.indexOf('local-') !== 0) setCurrentRom(id, name || id);
  }

  /* ---------- Picker error / busy ---------- */
  function setPickerError(msg) {
    gamePickerError.textContent = msg || '';
    gamePickerError.hidden = !msg;
  }
  function setPickerBusy(busy, msg) {
    gamePickerBusy.querySelector('span').textContent = msg || '游戏载入中…';
    gamePickerBusy.hidden = !busy;
  }

  /* ---------- Catalog rendering ---------- */
  function updateSelection() {
    const cards = gameList.querySelectorAll('.rom-card');
    Array.prototype.forEach.call(cards, function (card) {
      const sel = card.dataset.romId === picker.selectedId;
      card.classList.toggle('is-selected', sel);
      card.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
    gamePickerUse.disabled = !picker.selectedId;
  }

  function gameMatches(game, q) {
    if (!q) return true;
    if (game.name && game.name.toLowerCase().indexOf(q) !== -1) return true;
    if (game.py && game.py.indexOf(q) !== -1) return true;
    if (game.initial && game.initial.indexOf(q) !== -1) return true;
    return false;
  }

  function applyFilter() {
    const q = picker.query;
    picker.filtered = q
      ? picker.games.filter(function (g) { return gameMatches(g, q); })
      : picker.games;
    renderGames(picker.filtered);
    gameCount.textContent = q
      ? picker.filtered.length + ' / ' + picker.games.length + ' GAMES'
      : picker.games.length + ' GAMES / 点击卡片后选择使用';
  }

  function renderGames(games) {
    gameList.textContent = '';
    if (!games.length) {
      const empty = document.createElement('p');
      empty.className = 'loading-card';
      empty.textContent = picker.query ? '无匹配游戏' : '暂无游戏';
      gameList.appendChild(empty);
      updateSelection();
      return;
    }
    const frag = document.createDocumentFragment();
    games.forEach(function (game, index) {
      const card = document.createElement('button');
      const num = document.createElement('span');
      const name = document.createElement('strong');
      card.type = 'button';
      card.className = 'rom-card';
      card.dataset.romId = game.id;
      card.setAttribute('aria-pressed', 'false');
      card.addEventListener('click', function () {
        picker.selectedId = game.id;
        setPickerError('');
        updateSelection();
      });
      num.className = 'rom-number';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(index + 1).padStart(2, '0');
      name.className = 'rom-name';
      name.textContent = game.name;
      card.appendChild(num);
      card.appendChild(name);
      if (game.isSystem) {
        const tag = document.createElement('span');
        tag.className = 'rom-tag';
        tag.textContent = '系统';
        card.appendChild(tag);
      }
      frag.appendChild(card);
    });
    gameList.appendChild(frag);
    updateSelection();
  }

  function loadCatalog() {
    fetch('roms/catalog.json')
      .then(function (r) { if (!r.ok) throw new Error('目录读取失败'); return r.json(); })
      .then(function (games) {
        picker.games = BBK.buildPickerGames(games);
        picker.query = '';
        if (gamePickerSearch) gamePickerSearch.value = '';
        picker.selectedId = currentRom.id && picker.games.some(function (g) { return g.id === currentRom.id; })
          ? currentRom.id : '';
        applyFilter();
      })
      .catch(function () {
        gameList.innerHTML = '<p class="loading-card">游戏目录读取失败，请刷新后重试</p>';
        gameCount.textContent = '目录载入失败';
      });
  }

  /* ---------- Hot-switch + power-off fallback ---------- */
  function autosaveCurrent() {
    if (!BBK.shouldAutosave(currentRom.id)) return;  // home / local / 空 都不持久化
    const cap = captureState();
    if (!cap) return;
    writeLS(BBK.autosaveKey(currentRom.id), cap.b64);
    writeLS(BBK.autosaveKey(currentRom.id) + '.ts', String(Date.now()));
  }

  function launchHome() {
    const mode = BBK.decideHomeLaunch({ exited: exited, started: started });
    if (mode === 'pending-reload') {
      setPickerBusy(true, '切换中…');
      writeLS('pendingRomId', BBK.HOME_ROM_ID);
      writeLS('pendingRomName', BBK.HOME_ROM.name);
      location.reload();
      return;
    }
    if (mode === 'start') {
      setCurrentRom(BBK.HOME_ROM_ID, BBK.HOME_ROM.name);
      startEmulator();
      setPickerBusy(false);
      closePicker();
      return;
    }
    // autosave-reload：运行游戏中切换回词典
    setPickerBusy(true, '切换中…');
    autosaveCurrent();
    setCurrentRom(BBK.HOME_ROM_ID, BBK.HOME_ROM.name);
    location.reload();
  }

  function useSelectedGame() {
    if (!picker.selectedId) return;
    if (picker.selectedId === BBK.HOME_ROM_ID) { launchHome(); return; }
    const game = picker.games.find(function (g) { return g.id === picker.selectedId; });
    const name = game ? game.name : picker.selectedId;
    setPickerError('');
    setPickerBusy(true, '游戏载入中…');
    gamePickerUse.disabled = true;

    fetch('roms/' + encodeURIComponent(picker.selectedId) + '.gam')
      .then(function (r) { if (!r.ok) throw new Error('ROM 下载失败'); return r.arrayBuffer(); })
      .then(function (buf) {
        if (exited) {
          writeLS('pendingRomId', picker.selectedId);
          writeLS('pendingRomName', name);
          location.reload();
          return;
        }
        autosaveCurrent();
        loadGame(buf, name);
        setCurrentRom(picker.selectedId, name);
        setPickerBusy(false);
        closePicker();
      })
      .catch(function () {
        setPickerBusy(false);
        updateSelection();
        setPickerError('游戏载入失败，请检查网络后重试。');
      });
  }

  /* ---------- Dialog open/close + focus ---------- */
  function openPicker() {
    setPickerBusy(false);
    setPickerError('');
    if (picker.games.length) {
      picker.selectedId = picker.games.some(function (g) { return g.id === currentRom.id; })
        ? currentRom.id : '';
      picker.query = '';
      if (gamePickerSearch) gamePickerSearch.value = '';
      applyFilter();
    }
    picker.opener = document.activeElement;
    gamePicker.hidden = false;
    gamePickerOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('dialog-open');
    /* 不自动聚焦搜索框：移动端一打开 picker 就弹软键盘会遮挡游戏列表。
       焦点落到对话框容器（tabindex=-1），保留 dialog 焦点管理；键盘用户按 Tab 即进入搜索框。 */
    gamePicker.querySelector('.game-picker-dialog').focus();
  }
  function closePicker() {
    gamePicker.hidden = true;
    gamePickerOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('dialog-open');
    if (picker.opener && picker.opener.focus) picker.opener.focus();
  }

  function isMappedGameKey(event) {
    const k = event && (event.keyCode || event.which);
    return k === 13 || k === 27 || k === 32 || k === 37 || k === 38 || k === 39 || k === 40;
  }

  /* ---------- Save manager: status messages ---------- */
  function setSaveMsg(type, msg) {
    saveManagerErr.textContent = type === 'error' ? msg : '';
    saveManagerErr.hidden = type !== 'error' || !msg;
    saveManagerStat.textContent = type === 'status' ? msg : '';
    saveManagerStat.hidden = type !== 'status' || !msg;
  }

  /* ---------- Save manager: slot rendering ---------- */
  function makeSlotBtn(label, action, slot, disabled) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'slot-action' + ((action === 'save' || action === 'load') ? ' slot-action-primary' : '');
    b.dataset.saveAction = action;
    b.dataset.slot = String(slot);
    b.textContent = label;
    b.disabled = !!disabled;
    return b;
  }

  function fmtSize(b64) {
    const bytes = Math.floor(b64.length * 3 / 4);
    return (bytes / 1024).toFixed(0) + ' KB';
  }

  function renderSaveSlots() {
    saveGameName.textContent = currentRom.name || '尚未选择游戏';
    const frag = document.createDocumentFragment();
    saveSlotList.textContent = '';
    for (let slot = 0; slot < 3; slot += 1) {
      const data = readSlot(slot);
      const ts = readSlotTs(slot);
      const card = document.createElement('article');
      const num = document.createElement('span');
      const copy = document.createElement('span');
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      const actions = document.createElement('span');
      card.className = 'save-slot-card' + (data ? ' has-save' : '');
      num.className = 'save-slot-number';
      num.textContent = String(slot + 1).padStart(2, '0');
      copy.className = 'save-slot-copy';
      title.textContent = '存档槽 ' + (slot + 1);
      detail.textContent = data
        ? '已有存档 · ' + fmtSize(data) + (ts ? ' · ' + new Date(Number(ts)).toLocaleString('zh-CN', {hour12:false}) : '')
        : '空档案';
      actions.className = 'save-slot-actions';
      actions.appendChild(makeSlotBtn('保存', 'save', slot, false));
      actions.appendChild(makeSlotBtn('读取', 'load', slot, !data));
      actions.appendChild(makeSlotBtn('导出', 'export', slot, !data));
      actions.appendChild(makeSlotBtn('导入', 'import', slot, false));
      copy.appendChild(title);
      copy.appendChild(detail);
      card.appendChild(num);
      card.appendChild(copy);
      card.appendChild(actions);
      frag.appendChild(card);
    }
    saveSlotList.appendChild(frag);
  }

  /* ---------- Save manager: slot actions ---------- */
  function saveToSlot(slot) {
    const cap = captureState();
    if (!cap) { setSaveMsg('error', '没有可保存的游戏进度。'); return; }
    if (readSlot(slot) && !confirm('覆盖存档槽 ' + (slot + 1) + ' 的现有存档？')) return;
    writeSlot(slot, cap.b64, String(Date.now()));
    renderSaveSlots();
    setSaveMsg('status', '当前进度已保存到槽位 ' + (slot + 1) + '。');
  }

  function loadFromSlot(slot) {
    const b64 = readSlot(slot);
    if (!b64) return;
    if (restoreState(b64)) {
      setSaveMsg('status', '已读取槽位 ' + (slot + 1) + ' 的存档。');
    } else {
      setSaveMsg('error', '读取失败：设备未运行。');
    }
  }

  function safeFilePart(value) {
    return String(value || 'game').replace(/[^0-9A-Za-z㐀-鿿_-]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
  }

  function exportSlot(slot) {
    const b64 = readSlot(slot);
    if (!b64) return;
    try {
      const payload = BBK.buildSavePayload(currentRom.id, currentRom.name, slot, b64);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bbk-' + safeFilePart(currentRom.name) + '-save-' + (slot + 1) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSaveMsg('status', '槽位 ' + (slot + 1) + ' 已导出。');
    } catch (e) {
      setSaveMsg('error', e && e.message ? e.message : '导出失败。');
    }
  }

  let importSlotTarget = null;
  function chooseImport(slot) {
    importSlotTarget = slot;
    setSaveMsg('', '');
    saveInput.value = '';
    saveInput.click();
  }

  function importSaveFile(file) {
    if (!file || importSlotTarget === null) return;
    file.text().then(function (src) {
      const parsed = BBK.parseSavePayload(src, currentRom.id);
      if (!parsed.ok) throw new Error(parsed.error);
      writeSlot(importSlotTarget, parsed.payload.data, String(Date.now()));
      renderSaveSlots();
      setSaveMsg('status', '备份已导入到槽位 ' + (importSlotTarget + 1) + '。');
    }).catch(function (e) {
      setSaveMsg('error', e && e.message ? e.message : '导入失败。');
    }).finally(function () { importSlotTarget = null; });
  }

  /* ---------- Save manager: dialog open/close ---------- */
  function openSaveManager() {
    if (!currentRom.id) return;
    picker.opener = document.activeElement;
    setSaveMsg('', '');
    renderSaveSlots();
    saveManager.hidden = false;
    saveManagerOpen.setAttribute('aria-expanded', 'true');
    document.body.classList.add('dialog-open');
    saveManagerClose.focus();
  }
  function closeSaveManager() {
    saveManager.hidden = true;
    saveManagerOpen.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('dialog-open');
    importSlotTarget = null;
    if (picker.opener && picker.opener.focus) picker.opener.focus();
  }

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

  /* ---------- Canvas rendering ----------
     RGB565→RGBA 转换已移入 wasm（_web_get_framebuffer_rgba），这里只做一次整块拷贝；
     ImageData 复用同一份缓冲，避免每帧 createImageData 分配引发 GC。 */
  let fbW = 0;
  let fbH = 0;
  let screenImg = null;

  function render() {
    const ptr = Module._web_get_framebuffer_rgba();
    if (!screenImg) screenImg = ctx.createImageData(fbW, fbH);
    screenImg.data.set(new Uint8Array(Module.HEAPU8.buffer, ptr, fbW * fbH * 4));
    ctx.putImageData(screenImg, 0, 0);
  }

  /* ---------- Power on: show canvas + start the frame loop ---------- */
  function startEmulator() {
    if (started) return;
    started = true;
    fbW = Module._web_get_fb_width();
    fbH = Module._web_get_fb_height();
    canvas.width  = fbW;
    canvas.height = fbH;
    placeholder.classList.remove('show');
    canvas.classList.add('show');
    if (!running) {
      running = true;
      animId = requestAnimationFrame(frame);
    }
  }

  /* ---------- Main loop ----------
     固定 60fps 逻辑步进：按墙钟时间累积，每满 1000/60 ms 才调一次 web_run_frame，
     与 requestAnimationFrame 的显示器刷新率解耦（否则 120Hz 屏会跑成约 2 倍速）。
     render() 仍每个 rAF 帧都执行，保持画面平滑。 */
  let lastFrameTs = 0;
  let frameAcc = 0;
  function frame(ts) {
    if (!running || !started) return;
    if (!lastFrameTs) lastFrameTs = ts;
    const plan = planLogicSteps(ts - lastFrameTs, frameAcc);
    lastFrameTs = ts;
    frameAcc = plan.acc;
    for (let i = 0; i < plan.steps; i += 1) {
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
    }
    // 帧缓冲只在 web_run_frame 里变化：没有逻辑步进的 rAF（例如 120Hz 屏的偶数帧）
    // 直接跳过绘制，按 LCD 的 60fps 节奏渲染即可，减少高刷屏上的重复绘制。
    if (plan.steps > 0) render();
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

  /* ---------- Save/Load state (via wasm _web_save / _web_load) ---------- */
  function captureState() {
    if (exited || !gameLoaded || !Module) return null;
    const size = Module._web_save_size();
    const ptr = Module._malloc(size);
    Module._web_save(ptr);
    const bytes = new Uint8Array(Module.HEAPU8.buffer, ptr, size).slice();
    Module._free(ptr);
    return { b64: BBK.bytesToBase64(bytes), size: size };
  }

  function restoreState(b64) {
    if (exited || !Module) return false;
    const bytes = BBK.base64ToBytes(b64);
    const ptr = Module._malloc(bytes.byteLength);
    Module.HEAPU8.set(bytes, ptr);
    Module._web_load(ptr, bytes.byteLength);
    Module._free(ptr);
    return true;
  }

  function readSlot(slot) {
    return currentRom.id ? readLS(BBK.slotKey(currentRom.id, slot)) : '';
  }
  function writeSlot(slot, b64, ts) {
    writeLS(BBK.slotKey(currentRom.id, slot), b64);
    writeLS(BBK.slotKey(currentRom.id, slot) + '.ts', ts);
  }
  function readSlotTs(slot) {
    return readLS(BBK.slotKey(currentRom.id, slot) + '.ts');
  }

  /* ---------- Event bindings ---------- */
  gamePickerOpen.addEventListener('click', openPicker);
  gamePickerClose.addEventListener('click', closePicker);
  gamePickerUse.addEventListener('click', useSelectedGame);

  if (gamePickerSearch) {
    gamePickerSearch.addEventListener('input', function () {
      if (composing) return;
      picker.query = gamePickerSearch.value.trim().toLowerCase();
      applyFilter();
    });
    gamePickerSearch.addEventListener('compositionstart', function () { composing = true; });
    gamePickerSearch.addEventListener('compositionend', function () {
      composing = false;
      picker.query = gamePickerSearch.value.trim().toLowerCase();
      applyFilter();
    });
  }

  gamePicker.addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closePicker();
  });
  gamePicker.addEventListener('keydown', function (e) {
    if (isMappedGameKey(e)) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closePicker(); }
  });
  [gamePickerOpen, gamePicker].forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  });

  saveManagerOpen.addEventListener('click', openSaveManager);
  saveManagerClose.addEventListener('click', closeSaveManager);
  saveManager.addEventListener('click', function (e) {
    if (e.target === e.currentTarget) closeSaveManager();
  });
  saveManager.addEventListener('keydown', function (e) {
    if (isMappedGameKey(e)) e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeSaveManager(); }
  });
  [saveManagerOpen, saveManager].forEach(function (el) {
    el.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    el.addEventListener('pointerup', function (e) { e.stopPropagation(); });
  });

  saveSlotList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-save-action]');
    if (!btn) return;
    const slot = Number(btn.dataset.slot);
    switch (btn.dataset.saveAction) {
      case 'save':   saveToSlot(slot); break;
      case 'load':   loadFromSlot(slot); break;
      case 'export': exportSlot(slot); break;
      case 'import': chooseImport(slot); break;
    }
  });

  saveInput.addEventListener('change', function () {
    if (saveInput.files.length) importSaveFile(saveInput.files[0]);
  });

  fileInput.addEventListener('change', function () {
    if (!fileInput.files.length) return;
    if (exited) { setPickerError('设备已关机，请重新开机后再导入。'); return; }
    const f = fileInput.files[0];
    const reader = new FileReader();
    reader.onload = function () {
      const bytes = new Uint8Array(reader.result);
      const id = BBK.romStorageId(bytes, '');
      loadGame(reader.result, f.name);
      setCurrentRom(id, f.name.replace(/\.gam$/i, ''));
      closePicker();
    };
    reader.readAsArrayBuffer(f);
  });

  restartBtn.addEventListener('click', function() { location.reload(); });

  function handleAutoSave() {
    if (!gameLoaded || exited) return;
    autosaveCurrent();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) handleAutoSave();
  });
  global.addEventListener('pagehide', handleAutoSave);

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
    reader.onload = function () {
      const bytes = new Uint8Array(reader.result);
      const id = BBK.romStorageId(bytes, '');
      loadGame(reader.result, f.name);
      setCurrentRom(id, f.name.replace(/\.gam$/i, ''));
    };
    reader.readAsArrayBuffer(f);
  });

  /* ---------- Touchpad (on-screen keys, touch / narrow screens) ---------- */
  const touchpad = document.getElementById('touchpad');

  touchpad.addEventListener('pointerdown', function(e) {
    if (!started || exited) return;
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const key = parseInt(btn.dataset.key, 10);
    if (isNaN(key)) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    /* 核心按键是事件型（无 keyup）：每次按下只触发一次，
       长按不会自动重复，必须抬起后再按下才会再次触发。 */
    Module._web_keydown(key);
  });

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
    /* 暴露运行时调节：残影强度 setGhosting(0=关闭，最锐利) 与底色 setLcdBg(r,g,b)，
       便于在 console 微调；默认值见 web_main.c 的 vars。 */
    global.BBK4980Glue.setGhosting = function (n) {
      if (Module && Module._web_set_lcd_ghosting) Module._web_set_lcd_ghosting((n | 0) & 0xff);
    };
    global.BBK4980Glue.setLcdBg = function (r, g, b) {
      if (Module && Module._web_set_lcd_bg) Module._web_set_lcd_bg((r | 0) & 0xff, (g | 0) & 0xff, (b | 0) & 0xff);
    };
    if (Module._web_init() !== 0) {
      fatalError('初始化失败', '缺少 8.BIN / E.BIN 固件文件，无法启动模拟器。');
      return;
    }
    restoreCurrentRomFromStorage();
    syncTouchpadMode();
    loadCatalog();

    const pendingId = readLS('pendingRomId');
    const pendingName = readLS('pendingRomName');
    const hasAuto = currentRom.id ? !!readLS(BBK.autosaveKey(currentRom.id)) : false;
    const decision = BBK.decideLaunch({
      pendingId: pendingId,
      currentRomId: currentRom.id,
      hasAutosave: hasAuto
    });

    if (decision.action === 'home') {
      if (pendingId) { removeLS('pendingRomId'); removeLS('pendingRomName'); }
      setCurrentRom(BBK.HOME_ROM_ID, pendingId ? (pendingName || BBK.HOME_ROM.name) : (currentRom.name || BBK.HOME_ROM.name));
      startEmulator();
    } else if (decision.action === 'rom') {
      const romId = decision.id;
      const romName = pendingId ? (pendingName || romId) : (currentRom.name || romId);
      if (pendingId) { removeLS('pendingRomId'); removeLS('pendingRomName'); }
      fetch('roms/' + encodeURIComponent(romId) + '.gam')
        .then(function (r) { if (!r.ok) throw new Error('ROM 下载失败'); return r.arrayBuffer(); })
        .then(function (buf) {
          // 先 _web_load_game 填充 flash，再（如有 autosave）_web_load 叠加 ram/cpu/bk_tab
          const rp = Module._malloc(buf.byteLength);
          Module.HEAPU8.set(new Uint8Array(buf), rp);
          Module._web_load_game(rp, buf.byteLength);
          Module._free(rp);
          if (decision.applyAutosave) {
            const auto = readLS(BBK.autosaveKey(romId));
            if (auto) {
              const bytes = BBK.base64ToBytes(auto);
              const ptr = Module._malloc(bytes.byteLength);
              Module.HEAPU8.set(bytes, ptr);
              Module._web_load(ptr, bytes.byteLength);
              Module._free(ptr);
            }
          }
          gameLoaded = true;
          startEmulator();
          setCurrentRom(romId, romName);
        })
        .catch(function (e) {
          console.warn('launch rom failed:', e);
          // ROM 拉取失败（如失效的游戏 id）：清掉记住的选择，停留占位画面
          if (!pendingId) {
            removeLS('currentRomId');
            removeLS('currentRomName');
            setCurrentRom('', '');  // 同步重置标题与存档管理按钮，匹配占位画面
          }
        });
    }
    // decision.action === 'placeholder'：什么都不做，占位画面保持可见
  }).catch(function(err) {
    fatalError('初始化失败', (err && err.message) ? err.message : String(err));
  });

}(typeof window !== "undefined" ? window : globalThis));
