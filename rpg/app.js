(function (global) {
    "use strict";

    var state = {
        games: [],
        selectedId: "",
        opener: null,
        importSlot: null
    };

    function byId(id) {
        return global.document.getElementById(id);
    }

    function isMappedGameKey(event) {
        var keyCode = event && (event.keyCode || event.which);
        return keyCode === 82 ||
            keyCode === 13 ||
            keyCode === 27 ||
            keyCode === 32 ||
            keyCode === 37 ||
            keyCode === 38 ||
            keyCode === 39 ||
            keyCode === 40 ||
            keyCode === 219 ||
            keyCode === 221;
    }

    function readStorage(key) {
        try {
            return global.localStorage.getItem(key) || "";
        } catch (error) {
            return "";
        }
    }

    function writeStorage(key, value) {
        global.localStorage.setItem(key, value);
    }

    function romStorageId(buffer, catalogId) {
        if (catalogId) {
            return catalogId;
        }

        var bytes = new Uint8Array(buffer);
        var hash = 2166136261;
        for (var index = 0; index < bytes.length; index += 1) {
            hash ^= bytes[index];
            hash = Math.imul(hash, 16777619);
        }
        return "local-" + bytes.length + "-" +
            (hash >>> 0).toString(16).padStart(8, "0");
    }

    function arrayBufferToHex(buffer) {
        var bytes = new Uint8Array(buffer);
        var lookup = [];
        var result = "";
        var chunkSize = 32768;
        var index;

        for (index = 0; index < 256; index += 1) {
            lookup[index] = index.toString(16).padStart(2, "0").toUpperCase();
        }

        for (index = 0; index < bytes.length; index += chunkSize) {
            var end = Math.min(index + chunkSize, bytes.length);
            var chunk = "";
            for (var cursor = index; cursor < end; cursor += 1) {
                chunk += lookup[bytes[cursor]];
            }
            result += chunk;
        }
        return result;
    }

    function saveStorageKey(storageId, slot) {
        if (!storageId || !Number.isInteger(slot) || slot < 0 || slot > 2) {
            throw new Error("无效的游戏或存档槽位");
        }
        return "sav/gamesave" + slot + "-" + storageId;
    }

    function isValidSaveData(data) {
        return typeof data === "string" &&
            data.length > 0 &&
            data.length % 2 === 0 &&
            /^[0-9A-F]+$/i.test(data);
    }

    function buildSavePayload(storageId, gameName, slot, data, exportedAt) {
        if (!isValidSaveData(data)) {
            throw new Error("存档数据为空或格式不正确");
        }
        saveStorageKey(storageId, slot);
        return {
            app: "bbk-games",
            type: "dictionary-save-slot",
            version: 1,
            romId: storageId,
            romName: gameName || storageId,
            slot: slot,
            data: data,
            exportedAt: exportedAt || new Date().toISOString()
        };
    }

    function parseSavePayload(source, expectedStorageId) {
        var payload;
        try {
            payload = typeof source === "string" ? JSON.parse(source) : source;
        } catch (error) {
            return { ok: false, error: "无法读取备份文件。" };
        }

        if (!payload ||
                payload.app !== "bbk-games" ||
                payload.type !== "dictionary-save-slot" ||
                payload.version !== 1 ||
                !Number.isInteger(payload.slot) ||
                payload.slot < 0 ||
                payload.slot > 2 ||
                !isValidSaveData(payload.data) ||
                typeof payload.romId !== "string" ||
                !payload.romId) {
            return { ok: false, error: "这不是有效的 RPG 游戏存档。" };
        }

        if (expectedStorageId && payload.romId !== expectedStorageId) {
            return {
                ok: false,
                error: "该存档属于其他游戏，不能导入到当前游戏。"
            };
        }

        return { ok: true, payload: payload };
    }

    function activeStorageId() {
        return readStorage("gameRomStorageId") || readStorage("gameRomId");
    }

    function activeGameName() {
        return readStorage("gameRomName") || "RPG游戏";
    }

    function updateActiveGameUI() {
        var storageId = activeStorageId();
        var hasGame = !!storageId && !!readStorage("gameRom");
        var name = hasGame ? activeGameName() : "RPG游戏";
        var saveButton = byId("save-manager-open");

        byId("current-game-name").textContent = name;
        saveButton.disabled = !hasGame;
        saveButton.title = hasGame ? "导入或导出当前游戏存档" : "请先选择游戏";
    }

    function setError(message) {
        var error = byId("game-picker-error");
        error.textContent = message || "";
        error.hidden = !message;
    }

    function setBusy(isBusy, message) {
        var busy = byId("game-picker-busy");
        busy.querySelector("span").textContent = message || "游戏载入中…";
        busy.hidden = !isBusy;
    }

    function updateSelection() {
        var cards = byId("game-list").querySelectorAll(".rom-card");
        Array.prototype.forEach.call(cards, function (card) {
            var selected = card.dataset.romId === state.selectedId;
            card.classList.toggle("is-selected", selected);
            card.setAttribute("aria-pressed", selected ? "true" : "false");
        });
        byId("game-picker-use").disabled = !state.selectedId;
    }

    function selectGame(id) {
        state.selectedId = id;
        setError("");
        updateSelection();
    }

    function renderGames(games) {
        var list = byId("game-list");
        var fragment = global.document.createDocumentFragment();

        list.textContent = "";
        games.forEach(function (game, index) {
            var card = global.document.createElement("button");
            var number = global.document.createElement("span");
            var name = global.document.createElement("strong");

            card.type = "button";
            card.className = "rom-card";
            card.dataset.romId = game.id;
            card.setAttribute("aria-pressed", "false");
            card.addEventListener("click", function () {
                selectGame(game.id);
            });

            number.className = "rom-number";
            number.setAttribute("aria-hidden", "true");
            number.textContent = String(index + 1).padStart(2, "0");

            name.className = "rom-name";
            name.textContent = game.name;

            card.appendChild(number);
            card.appendChild(name);
            fragment.appendChild(card);
        });

        if (!games.length) {
            var empty = global.document.createElement("p");
            empty.className = "loading-card empty-result";
            empty.textContent = "没有找到匹配的游戏";
            fragment.appendChild(empty);
        }

        list.appendChild(fragment);
        updateSelection();
    }

    function filterGames(query) {
        var keyword = query.trim().toLocaleLowerCase("zh-CN");
        if (!keyword) {
            renderGames(state.games);
            return;
        }
        renderGames(state.games.filter(function (game) {
            return game.name.toLocaleLowerCase("zh-CN").indexOf(keyword) !== -1 ||
                game.id.toLowerCase().indexOf(keyword) !== -1;
        }));
    }

    function loadCatalog() {
        return global.fetch("roms/catalog.json")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("游戏目录读取失败");
                }
                return response.json();
            })
            .then(function (games) {
                state.games = games;
                state.selectedId = readStorage("gameRomId");
                byId("game-count").textContent = games.length + " GAMES / 点击卡片后选择使用";
                renderGames(games);
            })
            .catch(function () {
                byId("game-list").innerHTML = '<p class="loading-card">游戏目录读取失败，请刷新后重试</p>';
                byId("game-count").textContent = "目录载入失败";
            });
    }

    function openPicker() {
        var overlay = byId("game-picker");
        var dialog = overlay.querySelector(".game-picker-dialog");
        state.opener = global.document.activeElement;
        overlay.hidden = false;
        byId("game-picker-open").setAttribute("aria-expanded", "true");
        global.document.body.classList.add("dialog-open");
        dialog.focus();
    }

    function closePicker() {
        byId("game-picker").hidden = true;
        byId("game-picker-open").setAttribute("aria-expanded", "false");
        global.document.body.classList.remove("dialog-open");
        if (state.opener && typeof state.opener.focus === "function") {
            state.opener.focus();
        }
    }

    function setSaveMessage(type, message) {
        var error = byId("save-manager-error");
        var status = byId("save-manager-status");

        error.textContent = type === "error" ? message : "";
        error.hidden = type !== "error" || !message;
        status.textContent = type === "status" ? message : "";
        status.hidden = type !== "status" || !message;
    }

    function formatSaveSize(data) {
        var bytes = Math.ceil(data.length / 2);
        if (bytes < 1024) {
            return bytes + " B";
        }
        return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
    }

    function makeSaveButton(label, action, slot, disabled) {
        var button = global.document.createElement("button");
        button.type = "button";
        button.className = "slot-action" + (action === "import" ? " slot-action-primary" : "");
        button.dataset.saveAction = action;
        button.dataset.slot = String(slot);
        button.textContent = label;
        button.disabled = !!disabled;
        return button;
    }

    function renderSaveSlots() {
        var storageId = activeStorageId();
        var list = byId("save-slot-list");
        var fragment = global.document.createDocumentFragment();

        list.textContent = "";
        for (var slot = 0; slot < 3; slot += 1) {
            var data = storageId ? readStorage(saveStorageKey(storageId, slot)) : "";
            var card = global.document.createElement("article");
            var number = global.document.createElement("span");
            var copy = global.document.createElement("span");
            var title = global.document.createElement("strong");
            var detail = global.document.createElement("small");
            var actions = global.document.createElement("span");

            card.className = "save-slot-card" + (data ? " has-save" : "");
            number.className = "save-slot-number";
            number.textContent = String(slot + 1).padStart(2, "0");
            copy.className = "save-slot-copy";
            title.textContent = "存档槽 " + (slot + 1);
            detail.textContent = data ? "已有存档 · " + formatSaveSize(data) : "空档案";
            actions.className = "save-slot-actions";
            actions.appendChild(makeSaveButton("导出", "export", slot, !data));
            actions.appendChild(makeSaveButton("导入", "import", slot, false));
            copy.appendChild(title);
            copy.appendChild(detail);
            card.appendChild(number);
            card.appendChild(copy);
            card.appendChild(actions);
            fragment.appendChild(card);
        }
        list.appendChild(fragment);
    }

    function openSaveManager() {
        if (!activeStorageId() || !readStorage("gameRom")) {
            return;
        }
        state.opener = global.document.activeElement;
        byId("save-game-name").textContent = activeGameName();
        setSaveMessage("", "");
        renderSaveSlots();
        byId("save-manager").hidden = false;
        byId("save-manager-open").setAttribute("aria-expanded", "true");
        global.document.body.classList.add("dialog-open");
        byId("save-manager-close").focus();
    }

    function closeSaveManager() {
        byId("save-manager").hidden = true;
        byId("save-manager-open").setAttribute("aria-expanded", "false");
        global.document.body.classList.remove("dialog-open");
        state.importSlot = null;
        if (state.opener && typeof state.opener.focus === "function") {
            state.opener.focus();
        }
    }

    function safeFilePart(value) {
        return String(value || "game")
            .replace(/[^0-9A-Za-z\u3400-\u9FFF_-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "game";
    }

    function exportSave(slot) {
        var storageId = activeStorageId();
        var data = readStorage(saveStorageKey(storageId, slot));
        var payload;
        var blob;
        var url;
        var link;

        try {
            payload = buildSavePayload(storageId, activeGameName(), slot, data);
            blob = new global.Blob(
                [JSON.stringify(payload, null, 2)],
                { type: "application/json;charset=utf-8" }
            );
            url = global.URL.createObjectURL(blob);
            link = global.document.createElement("a");
            link.href = url;
            link.download = "bbk-" + safeFilePart(activeGameName()) +
                "-save-" + (slot + 1) + ".json";
            global.document.body.appendChild(link);
            link.click();
            link.remove();
            global.URL.revokeObjectURL(url);
            setSaveMessage("status", "存档槽 " + (slot + 1) + " 已导出。");
        } catch (error) {
            setSaveMessage("error", "存档导出失败，请稍后重试。");
        }
    }

    function chooseSaveImport(slot) {
        state.importSlot = slot;
        var input = byId("save-input");
        setSaveMessage("", "");
        input.value = "";
        input.click();
    }

    function importSave(file) {
        var targetSlot = state.importSlot;
        var storageId = activeStorageId();

        if (!file || targetSlot === null || !storageId) {
            return;
        }

        file.text()
            .then(function (source) {
                var parsed = parseSavePayload(source, storageId);
                if (!parsed.ok) {
                    throw new Error(parsed.error);
                }
                writeStorage(
                    saveStorageKey(storageId, targetSlot),
                    parsed.payload.data.toUpperCase()
                );
                renderSaveSlots();
                setSaveMessage(
                    "status",
                    "备份已导入到存档槽 " + (targetSlot + 1) + "。"
                );
            })
            .catch(function (error) {
                setSaveMessage(
                    "error",
                    error && error.message || "存档导入失败，请检查备份文件。"
                );
            })
            .finally(function () {
                state.importSlot = null;
            });
    }

    function storeRom(buffer, id, name) {
        writeStorage("gameRom", arrayBufferToHex(buffer));
        writeStorage("gameRomStorageId", romStorageId(buffer, id));
        if (id) {
            writeStorage("gameRomId", id);
        } else {
            global.localStorage.removeItem("gameRomId");
        }
        writeStorage("gameRomName", name || "本地 ROM");
        global.location.reload();
    }

    function useSelectedGame() {
        if (!state.selectedId) {
            return;
        }

        var game = state.games.find(function (item) {
            return item.id === state.selectedId;
        });
        setError("");
        setBusy(true, "游戏载入中…");

        global.fetch("roms/" + encodeURIComponent(state.selectedId) + ".lib")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("ROM 下载失败");
                }
                return response.arrayBuffer();
            })
            .then(function (buffer) {
                storeRom(buffer, state.selectedId, game ? game.name : state.selectedId);
            })
            .catch(function () {
                setBusy(false);
                setError("游戏载入失败，请检查网络后重试。");
            });
    }

    // ---- .gam -> .lib 提取 ----
    // 步步高原生 .gam 包内部内嵌了完整的 fmj 引擎 .lib 资源库，
    // 定位并截取它，使 rpg 页面可直接导入 .gam。lib 布局参考 fmj 引擎
    // DatLib：头部 0x10 字节；索引表 @0x10 每条 3 字节(resType,type,index)遇 0xff 止；
    // 偏移表 @0x2000 每条 3 字节(block,low,high)；定位 offset=block*0x4000+(high<<8|low)。
    function validateEmbeddedLib(u, base) {
        var libLen = u.length - base;
        if (libLen < 0x4000) {
            return false;
        }
        var i = base + 0x10;
        var j = base + 0x2000;
        var count = 0;
        while (i < u.length && u[i] !== 0xff) {
            var resType = u[i];
            if (resType < 1 || resType > 12) {
                return false;
            }
            i += 3;
            if (j + 3 > u.length) {
                return false;
            }
            var block = u[j];
            var low = u[j + 1];
            var high = u[j + 2];
            j += 3;
            if (block * 0x4000 + ((high << 8) | low) >= libLen) {
                return false;
            }
            count += 1;
            if (count > 10000) {
                return false;
            }
        }
        return count > 0;
    }

    function extractLibFromGam(buffer) {
        var u = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        for (var i = 4; i + 3 <= u.length; i += 1) {
            if (u[i] === 0x4c && u[i + 1] === 0x49 && u[i + 2] === 0x42 &&
                    validateEmbeddedLib(u, i)) {
                return u.slice(i);
            }
        }
        throw new Error("该 .gam 未内嵌有效的 lib，可能不是 fmj 引擎格式，无法转换。");
    }

    // 若传入的是 .gam（按扩展名或 GAM\0 头识别），提取内嵌 lib；否则原样返回。
    function normalizeRom(buffer, fileName) {
        var u = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        var looksLikeGam = (fileName && /\.gam$/i.test(fileName)) ||
            (u.length >= 4 && u[0] === 0x47 && u[1] === 0x41 && u[2] === 0x4d && u[3] === 0x00);
        return looksLikeGam ? extractLibFromGam(u) : buffer;
    }

    function importRom(file) {
        if (!file) {
            return;
        }
        setError("");
        setBusy(true, "正在导入 ROM…");
        file.arrayBuffer()
            .then(function (buffer) {
                return normalizeRom(buffer, file.name);
            })
            .then(function (buffer) {
                storeRom(buffer, "", file.name.replace(/\.(lib|gam)$/i, ""));
            })
            .catch(function (error) {
                setBusy(false);
                setError(
                    error && error.message
                        ? error.message
                        : "ROM 导入失败，请确认文件格式后重试。"
                );
            });
    }

    function bindControlKeyboard() {
        var controls = byId("touchpad").querySelectorAll(".btn");
        Array.prototype.forEach.call(controls, function (button) {
            button.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (typeof global.document.body.onpointerdown === "function") {
                    global.document.body.onpointerdown({ target: button });
                }
            });
            button.addEventListener("keyup", function (event) {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (typeof global.document.body.onpointerup === "function") {
                    global.document.body.onpointerup({ target: button });
                }
            });
        });
    }

    function bindGameKeyboard() {
        global.document.addEventListener("keydown", function (event) {
            if (byId("game-picker").hidden &&
                    byId("save-manager").hidden &&
                    isMappedGameKey(event)) {
                // 内核仍会收到按键；这里只阻止方向键和空格等触发页面滚动。
                event.preventDefault();
            }
        });
    }

    function loadCore() {
        var status = byId("screen-status");
        var script = global.document.createElement("script");

        global.renderPeixel = [1, 1, 1];
        script.src = "core.js?v=16";
        script.addEventListener("load", function () {
            if (global.game && global.game.rom && global.game.rom["GAME.ROM"]) {
                status.hidden = true;
            } else {
                status.textContent = "请选择游戏";
            }
        });
        script.addEventListener("error", function () {
            status.textContent = "模拟器内核加载失败";
        });
        global.document.body.appendChild(script);
    }

    function init() {
        var picker = byId("game-picker");
        var pickerOpen = byId("game-picker-open");
        var saveManager = byId("save-manager");

        pickerOpen.addEventListener("click", openPicker);
        byId("save-manager-open").addEventListener("click", openSaveManager);
        byId("save-manager-close").addEventListener("click", closeSaveManager);
        byId("game-picker-close").addEventListener("click", closePicker);
        byId("game-picker-use").addEventListener("click", useSelectedGame);
        byId("game-search").addEventListener("input", function (event) {
            filterGames(event.target.value);
        });
        byId("rom-input").addEventListener("change", function (event) {
            importRom(event.target.files && event.target.files[0]);
        });
        byId("save-input").addEventListener("change", function (event) {
            importSave(event.target.files && event.target.files[0]);
        });
        byId("save-slot-list").addEventListener("click", function (event) {
            var button = event.target.closest("[data-save-action]");
            var slot;
            if (!button) {
                return;
            }
            slot = Number(button.dataset.slot);
            if (button.dataset.saveAction === "export") {
                exportSave(slot);
            } else {
                chooseSaveImport(slot);
            }
        });
        picker.addEventListener("pointerdown", function (event) {
            event.stopPropagation();
        });
        picker.addEventListener("pointerup", function (event) {
            event.stopPropagation();
        });
        pickerOpen.addEventListener("pointerdown", function (event) {
            event.stopPropagation();
        });
        pickerOpen.addEventListener("pointerup", function (event) {
            event.stopPropagation();
        });
        byId("save-manager-open").addEventListener("pointerdown", function (event) {
            event.stopPropagation();
        });
        byId("save-manager-open").addEventListener("pointerup", function (event) {
            event.stopPropagation();
        });
        saveManager.addEventListener("pointerdown", function (event) {
            event.stopPropagation();
        });
        saveManager.addEventListener("pointerup", function (event) {
            event.stopPropagation();
        });
        picker.addEventListener("click", function (event) {
            if (event.target === event.currentTarget) {
                closePicker();
            }
        });
        saveManager.addEventListener("click", function (event) {
            if (event.target === event.currentTarget) {
                closeSaveManager();
            }
        });
        picker.addEventListener("keydown", function (event) {
            if (isMappedGameKey(event)) {
                // 搜索框与弹窗按钮自行处理键盘，不把按键传给游戏内核。
                event.stopPropagation();
            }
            if (event.key === "Escape") {
                event.preventDefault();
                closePicker();
            }
        });
        saveManager.addEventListener("keydown", function (event) {
            if (isMappedGameKey(event)) {
                event.stopPropagation();
            }
            if (event.key === "Escape") {
                event.preventDefault();
                closeSaveManager();
            }
        });

        bindControlKeyboard();
        bindGameKeyboard();
        updateActiveGameUI();
        loadCatalog();
        loadCore();
    }

    global.BBKSimulator = {
        arrayBufferToHex: arrayBufferToHex,
        romStorageId: romStorageId,
        isMappedGameKey: isMappedGameKey,
        saveStorageKey: saveStorageKey,
        buildSavePayload: buildSavePayload,
        parseSavePayload: parseSavePayload,
        extractLibFromGam: extractLibFromGam
    };

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }
}(typeof window !== "undefined" ? window : globalThis));
