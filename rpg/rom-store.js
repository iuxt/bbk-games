(function (global) {
    "use strict";

    function create(options) {
        var storage = options.storage;

        function read(key) {
            try { return storage.getItem(key) || ""; }
            catch (_) { return ""; }
        }

        function localRom(id, bytes) {
            return new Promise(function (resolve, reject) {
                if (!options.indexedDB) {
                    reject(new Error("浏览器不支持本地 ROM 存储（IndexedDB）"));
                    return;
                }
                var request = options.indexedDB.open("bbk-rpg-roms", 1);
                var finished = false;
                function fail(error) {
                    finished = true;
                    reject(error || new Error("本地 ROM 存储不可用"));
                }
                request.onupgradeneeded = function () {
                    var db = request.result;
                    if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms");
                };
                request.onerror = function () { fail(request.error); };
                request.onblocked = function () { fail(new Error("本地 ROM 数据库被其他页面占用")); };
                request.onsuccess = function () {
                    var db = request.result;
                    if (finished) { db.close(); return; }
                    try {
                        var tx = db.transaction("roms", bytes ? "readwrite" : "readonly");
                        var store = tx.objectStore("roms");
                        var operation = bytes ? store.put(bytes, id) : store.get(id);
                        tx.oncomplete = function () { db.close(); resolve(operation.result); };
                        tx.onabort = tx.onerror = function () { db.close(); fail(tx.error); };
                    } catch (error) { db.close(); fail(error); }
                };
            });
        }

        function select(id, catalogId, name) {
            // 移除旧的大型 hex 后再写少量元数据；任何失败都恢复原选择。
            var keys = ["gameRom", "gameRomStorageId", "gameRomId", "gameRomName"];
            var values = [null, id, catalogId || null, name || "本地 ROM"];
            var previous = keys.map(function (key) { return storage.getItem(key); });
            try {
                keys.forEach(function (key, i) {
                    if (values[i] === null) storage.removeItem(key);
                    else storage.setItem(key, values[i]);
                });
            } catch (error) {
                try {
                    keys.forEach(function (key) { storage.removeItem(key); });
                    keys.forEach(function (key, i) {
                        if (previous[i] !== null) storage.setItem(key, previous[i]);
                    });
                } catch (rollbackError) { console.warn("ROM 选择恢复失败:", rollbackError); }
                throw new Error("游戏选择保存失败：浏览器存储空间不足或存储被禁用。");
            }
        }

        function decodeLegacy(hex) {
            if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) {
                throw new Error("旧版 ROM 数据不完整，请重新选择或导入游戏。");
            }
            var bytes = new Uint8Array(hex.length / 2);
            for (var i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
            return bytes.buffer;
        }

        async function load() {
            var catalogId = read("gameRomId");
            var id = read("gameRomStorageId") || catalogId;
            var legacy = read("gameRom");
            if (catalogId) {
                try {
                    var response = await options.fetch("roms/" + encodeURIComponent(catalogId) + ".lib");
                    if (!response.ok) throw new Error("ROM 下载失败，请检查网络后重试。");
                    var bytes = await response.arrayBuffer();
                    try { storage.removeItem("gameRom"); } catch (_) {}
                    return bytes;
                } catch (error) {
                    // 老用户首次离线升级时仍可使用尚未进入 HTTP/离线缓存的 ROM。
                    if (legacy) return decodeLegacy(legacy);
                    throw error;
                }
            }
            if (!id && !legacy) return null;
            try {
                if (id) {
                    var saved = await localRom(id);
                    if (saved) return saved;
                }
                if (!legacy) throw new Error("本地 ROM 不存在，请重新导入文件。");
                var migrated = decodeLegacy(legacy);
                // 最早版本按 hex 长度隔离存档，迁移时沿用该标识。
                id = id || String(legacy.length);
                await localRom(id, migrated);
                select(id, "", read("gameRomName"));
                return migrated;
            } catch (error) {
                if (!legacy) throw error;
                console.warn("旧版 ROM 暂未迁移，保留原数据:", error);
                return decodeLegacy(legacy);
            }
        }

        async function save(buffer, id, catalogId, name) {
            if (!catalogId) await localRom(id, buffer);
            select(id, catalogId, name);
        }

        return { load: load, save: save };
    }

    global.BBKRomStore = { create: create };
}(typeof window !== "undefined" ? window : globalThis));
