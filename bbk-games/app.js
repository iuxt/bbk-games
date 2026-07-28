(function (global) {
    "use strict";

    var state = {
        games: [],
        selectedId: "",
        opener: null
    };

    function byId(id) {
        return global.document.getElementById(id);
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

    function migrateLegacySaves(storage, storageId, legacyNamespace) {
        if (!storage || !storageId || !legacyNamespace) {
            return false;
        }

        var markerKey = "gameRomSaveMigration:" + legacyNamespace;
        var migrated = false;
        var foundLegacy = false;

        try {
            var owner = storage.getItem(markerKey);
            if (owner && owner !== storageId) {
                return false;
            }

            for (var slot = 0; slot < 3; slot += 1) {
                var baseKey = "sav/gamesave" + slot;
                var legacyKey = baseKey + "-" + legacyNamespace;
                var targetKey = baseKey + "-" + storageId;
                var value = storage.getItem(legacyKey);

                if (value === null) {
                    continue;
                }
                foundLegacy = true;
                if (storage.getItem(targetKey) === null) {
                    storage.setItem(targetKey, value);
                    migrated = true;
                }
            }

            if (foundLegacy && !owner) {
                // 同长度 ROM 的旧存档无法反推出来源，只迁移给升级时当前打开的游戏。
                storage.setItem(markerKey, storageId);
            }
        } catch (error) {
            return false;
        }
        return migrated;
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
        state.opener = global.document.activeElement;
        overlay.hidden = false;
        byId("game-picker-open").setAttribute("aria-expanded", "true");
        global.document.body.classList.add("dialog-open");
        byId("game-search").focus();
    }

    function closePicker() {
        byId("game-picker").hidden = true;
        byId("game-picker-open").setAttribute("aria-expanded", "false");
        global.document.body.classList.remove("dialog-open");
        if (state.opener && typeof state.opener.focus === "function") {
            state.opener.focus();
        }
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

    function importRom(file) {
        if (!file) {
            return;
        }
        setError("");
        setBusy(true, "正在导入 ROM…");
        file.arrayBuffer()
            .then(function (buffer) {
                storeRom(buffer, "", file.name.replace(/\.lib$/i, ""));
            })
            .catch(function () {
                setBusy(false);
                setError("ROM 导入失败，请确认文件格式后重试。");
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

    function loadCore() {
        var status = byId("screen-status");
        var script = global.document.createElement("script");
        var storedRom = readStorage("gameRom");
        var storageId = readStorage("gameRomStorageId") || readStorage("gameRomId");
        var storage = null;

        try {
            storage = global.localStorage;
        } catch (error) {
            storage = null;
        }
        migrateLegacySaves(storage, storageId, storedRom.length);

        global.renderPeixel = [1, 1, 1];
        script.src = "core.js?v=2";
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

        pickerOpen.addEventListener("click", openPicker);
        byId("game-picker-close").addEventListener("click", closePicker);
        byId("game-picker-use").addEventListener("click", useSelectedGame);
        byId("game-search").addEventListener("input", function (event) {
            filterGames(event.target.value);
        });
        byId("rom-input").addEventListener("change", function (event) {
            importRom(event.target.files && event.target.files[0]);
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
        picker.addEventListener("click", function (event) {
            if (event.target === event.currentTarget) {
                closePicker();
            }
        });
        picker.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closePicker();
            }
        });

        bindControlKeyboard();
        loadCatalog();
        loadCore();
    }

    global.BBKSimulator = {
        arrayBufferToHex: arrayBufferToHex,
        romStorageId: romStorageId,
        migrateLegacySaves: migrateLegacySaves
    };

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", init);
        } else {
            init();
        }
    }
}(typeof window !== "undefined" ? window : globalThis));
