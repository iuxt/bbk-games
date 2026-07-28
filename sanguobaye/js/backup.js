// 三国霸业当前版本的存档备份 / 还原逻辑。
// 只处理现行的按版本隔离格式，不兼容已下线游戏或历史备份格式。

(function (global) {
    "use strict";

    var BAYE_LIBS = [
        { id: "SGBY", name: "三国霸业-原版精修" },
        { id: "whxf", name: "无痕修复版" },
        { id: "sc-mod", name: "霸哥自制版" }
    ];
    var PAYLOAD_TYPE = "bbk-save-slot";
    var PAYLOAD_VERSION = 2;

    function bayeProfile(lib) {
        var libId = lib.id;
        return {
            id: "baye/" + libId,
            name: lib.name,
            slots: 3,
            slotKeys: function (slot) {
                return [
                    "baye//data//sango" + (slot * 2) + ".sav@" + libId,
                    "baye//data//sango" + (slot * 2 + 1) + ".sav@" + libId
                ];
            }
        };
    }

    var SAVE_PROFILES = {};
    for (var index = 0; index < BAYE_LIBS.length; index++) {
        var lib = BAYE_LIBS[index];
        SAVE_PROFILES["baye/" + lib.id] = bayeProfile(lib);
    }

    function libIdFromPath(path) {
        if (!path) return "";
        return path.split("/").pop().replace(/\.lib$/i, "");
    }

    function getProfile(id) {
        return SAVE_PROFILES[id] || null;
    }

    function isValidSlot(profile, slot) {
        return !!profile &&
            typeof slot === "number" &&
            isFinite(slot) &&
            Math.floor(slot) === slot &&
            slot >= 0 &&
            slot < profile.slots;
    }

    function expectedFileCount(profile) {
        return profile && profile.slotKeys ? profile.slotKeys(0).length : 0;
    }

    function areValidFiles(files, count) {
        if (!Array.isArray(files) || files.length !== count) return false;
        for (var index = 0; index < files.length; index++) {
            if (typeof files[index] !== "string") return false;
        }
        return true;
    }

    function readSlotFiles(profile, slot, readKey) {
        if (!isValidSlot(profile, slot) || typeof readKey !== "function") {
            return null;
        }

        var keys = profile.slotKeys(slot);
        var files = [];
        for (var index = 0; index < keys.length; index++) {
            files.push(readKey(keys[index]) || "");
        }
        return files;
    }

    function isSlotEmpty(files) {
        if (!files) return true;
        for (var index = 0; index < files.length; index++) {
            if (files[index].length) return false;
        }
        return true;
    }

    function buildExportPayload(profile, slot, readKey) {
        if (!isValidSlot(profile, slot)) return null;
        var files = readSlotFiles(profile, slot, readKey);
        if (isSlotEmpty(files)) return null;

        return {
            app: "bbk-games",
            type: PAYLOAD_TYPE,
            ver: PAYLOAD_VERSION,
            game: profile.id,
            gameName: profile.name,
            slot: slot,
            files: files
        };
    }

    function parseBackup(data) {
        if (!data ||
                typeof data !== "object" ||
                data.app !== "bbk-games" ||
                data.type !== PAYLOAD_TYPE ||
                data.ver !== PAYLOAD_VERSION) {
            return null;
        }

        var profile = SAVE_PROFILES[data.game];
        if (!isValidSlot(profile, data.slot) ||
                !areValidFiles(data.files, expectedFileCount(profile))) {
            return null;
        }

        return {
            profileId: profile.id,
            slot: data.slot,
            files: data.files.slice()
        };
    }

    function canRestore(parsed, profile) {
        return !!parsed && !!profile && parsed.profileId === profile.id;
    }

    function restorePrevious(entries, completed, previous, writeKey, removeKey) {
        for (var index = completed - 1; index >= 0; index--) {
            try {
                if (previous[index] === null && typeof removeKey === "function") {
                    removeKey(entries[index].key);
                } else if (previous[index] !== null) {
                    writeKey(entries[index].key, previous[index]);
                }
            } catch (error) {
                // 回滚只能尽力完成；调用方仍会收到失败结果。
            }
        }
    }

    function applyRestore(profile, slot, files, writeKey, readKey, removeKey) {
        if (!isValidSlot(profile, slot) ||
                !areValidFiles(files, expectedFileCount(profile)) ||
                typeof writeKey !== "function") {
            return false;
        }

        var keys = profile.slotKeys(slot);
        var entries = [];
        for (var index = 0; index < keys.length; index++) {
            entries.push({ key: keys[index], value: files[index] });
        }

        var previous = [];
        if (typeof readKey === "function") {
            try {
                for (var readIndex = 0; readIndex < entries.length; readIndex++) {
                    previous.push(readKey(entries[readIndex].key));
                }
            } catch (error) {
                return false;
            }
        }

        for (var writeIndex = 0; writeIndex < entries.length; writeIndex++) {
            try {
                if (writeKey(entries[writeIndex].key, entries[writeIndex].value) === false) {
                    if (previous.length) {
                        restorePrevious(
                            entries,
                            writeIndex,
                            previous,
                            writeKey,
                            removeKey
                        );
                    }
                    return false;
                }
            } catch (error) {
                if (previous.length) {
                    restorePrevious(
                        entries,
                        writeIndex,
                        previous,
                        writeKey,
                        removeKey
                    );
                }
                return false;
            }
        }
        return true;
    }

    function fileName(profile, slot, stamp) {
        var id = profile.id.replace(/\//g, "-");
        return "bbk-" + id + "-save-" + (slot + 1) + "-" + stamp + ".json";
    }

    global.BBKBackup = {
        BAYE_LIBS: BAYE_LIBS,
        getProfile: getProfile,
        libIdFromPath: libIdFromPath,
        buildExportPayload: buildExportPayload,
        parseBackup: parseBackup,
        canRestore: canRestore,
        applyRestore: applyRestore,
        fileName: fileName
    };
})(typeof window !== "undefined" ? window : globalThis);
