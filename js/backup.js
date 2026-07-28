// 通用存档备份 / 还原引擎
//
// 每个 SAVE_PROFILES 条目描述一个游戏（或游戏的一个版本）的存档布局：
//   - group           归属的游戏组（baye / fmj），用于页面分组与旧格式兼容
//   - slots           存档槽位数
//   - slotKeys(n)     槽 n（从 0 起）对应的全部 localStorage key；版本/游戏标识
//                     已固化进 profile（baye 的版本后缀、fmj 的游戏子目录）
//   - legacySlotKeys  旧的共享存档 key（可空），导出时对新 key 为空的文件逐个回退读取
//
// 三国霸业的三个版本各自是一个独立 profile（baye/<libId>），与 RPG 的
// fmj/<游戏> 同构：备份文件标注来源版本，还原时严格匹配版本，互不干扰。
//
// 全部为纯逻辑，不依赖 DOM / jQuery / lcd.js，便于在 node 里单测。
// DOM 与下载交互仍留在各页面的胶水脚本里。

(function (global) {
    "use strict";

    var FMJ_GAMES = ["伏魔记", "金庸群侠传", "赤壁之战之乱世枭雄", "赤壁之战之谁与争锋", "侠客行"];

    // 三国霸业的三个版本（与 libs.json 对应）。id 取 lib 文件名（去 .lib），
    // 作为存档 key 的版本后缀（见 lcd.js 的 bayeSaveKey），让三版本存档彼此隔离。
    var BAYE_LIBS = [
        { id: "SGBY",   name: "三国霸业-原版精修", path: "libs/SGBY.lib" },
        { id: "whxf",   name: "无痕修复版",        path: "libs/whxf.lib" },
        { id: "sc-mod", name: "霸哥自制版",        path: "libs/sc-mod.lib" }
    ];

    // fmj 引擎游戏：每个游戏独立的存档空间 sav/<游戏>/fmjsave{n}；
    // 旧版五个游戏共用 sav/fmjsave{n}，作为 legacy 回退读取
    function fmjProfile(game) {
        return {
            id: "fmj/" + game,
            group: "fmj",
            name: game,
            slots: 3,
            slotKeys: function (slot) {
                return ["sav/" + game + "/fmjsave" + slot];
            },
            legacySlotKeys: function (slot) {
                return ["sav/fmjsave" + slot];
            },
            versionKeys: []
        };
    }

    // 三国霸业：每个版本独立的存档空间 baye//data//sangoN.sav@<libId>，
    // 与 lcd.js 的 bayeSaveKey 一致；旧共享 key（无后缀）作为 legacy 回退
    function bayeProfile(lib) {
        var libId = lib.id;
        return {
            id: "baye/" + libId,
            group: "baye",
            name: lib.name,
            libId: libId,
            slots: 3,
            slotKeys: function (slot) {
                return [
                    "baye//data//sango" + (slot * 2) + ".sav@" + libId,
                    "baye//data//sango" + (slot * 2 + 1) + ".sav@" + libId
                ];
            },
            legacySlotKeys: function (slot) {
                return [
                    "baye//data//sango" + (slot * 2) + ".sav",
                    "baye//data//sango" + (slot * 2 + 1) + ".sav"
                ];
            },
            versionKeys: []
        };
    }

    var SAVE_PROFILES = {};
    for (var b = 0; b < BAYE_LIBS.length; b++) {
        SAVE_PROFILES["baye/" + BAYE_LIBS[b].id] = bayeProfile(BAYE_LIBS[b]);
    }
    for (var f = 0; f < FMJ_GAMES.length; f++) {
        SAVE_PROFILES["fmj/" + FMJ_GAMES[f]] = fmjProfile(FMJ_GAMES[f]);
    }

    var PAYLOAD_TYPE = "bbk-save-slot";
    var LEGACY_TYPE = "sango-save-slot"; // 更老的 baye 单槽备份，仍允许还原
    var LEGACY_FMJ_ID = "fmj";           // 旧版 fmj 共享存档备份的 game id
    var LEGACY_BAYE_ID = "baye";         // 旧版 baye 备份的 game id（未标注具体版本）

    // 从 lib 路径推导版本标识（"libs/SGBY.lib" → "SGBY"）
    function libIdFromPath(path) {
        if (!path) return "";
        return path.split("/").pop().replace(/\.lib$/i, "");
    }

    // 旧 baye 备份把版本写在 version（{ "baye/libpath": "libs/SGBY.lib" }），据此推导 libId
    function libIdFromVersion(version) {
        if (!version) return "";
        return libIdFromPath(version["baye/libpath"]);
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
        for (var i = 0; i < files.length; i++) {
            if (typeof files[i] !== "string") return false;
        }
        return true;
    }

    function readSlotFiles(profile, slot, readKey) {
        if (!isValidSlot(profile, slot) || typeof readKey !== "function") return null;
        var keys = profile.slotKeys(slot);
        var legacyKeys = profile.legacySlotKeys ? profile.legacySlotKeys(slot) : null;
        var files = [];
        for (var i = 0; i < keys.length; i++) {
            var value = readKey(keys[i]);
            if ((value === null || value === undefined) &&
                    legacyKeys && legacyKeys[i] !== keys[i]) {
                // 新存档空间还没有数据时，回退读取旧的共享存档
                value = readKey(legacyKeys[i]);
            }
            files.push(value || "");
        }
        return files;
    }

    function isSlotEmpty(files) {
        if (!files) return true;
        for (var i = 0; i < files.length; i++) {
            if (files[i] && files[i].length) return false;
        }
        return true;
    }

    function readVersion(profile, readKey) {
        if (!profile.versionKeys.length) return null;
        var v = {};
        var hasAny = false;
        for (var i = 0; i < profile.versionKeys.length; i++) {
            var val = readKey(profile.versionKeys[i]);
            if (val) { v[profile.versionKeys[i]] = val; hasAny = true; }
        }
        return hasAny ? v : null;
    }

    // 构造导出 payload；空槽返回 null
    function buildExportPayload(profile, slot, readKey) {
        if (!isValidSlot(profile, slot)) return null;
        var files = readSlotFiles(profile, slot, readKey);
        if (isSlotEmpty(files)) return null;
        var payload = {
            app: "bbk-games",
            type: PAYLOAD_TYPE,
            ver: 2,
            game: profile.id,
            gameName: profile.name,
            slot: slot,
            files: files
        };
        var version = readVersion(profile, readKey);
        if (version) payload.version = version;
        return payload;
    }

    function slotNumberOf(data, slots) {
        if (!Object.prototype.hasOwnProperty.call(data, "slot")) return 0;
        var slot = data.slot;
        return typeof slot === "number" &&
            isFinite(slot) &&
            Math.floor(slot) === slot &&
            slot >= 0 &&
            slot < slots ? slot : null;
    }

    function parsedBackup(profileId, profile, data, fileCount) {
        var slots = profile ? profile.slots : 3;
        var slot = slotNumberOf(data, slots);
        if (slot === null || !areValidFiles(data.files, fileCount)) return null;
        return {
            profileId: profileId,
            slot: slot,
            version: null,
            files: data.files.slice()
        };
    }

    // 解析上传的备份 JSON → { profileId, slot, version, files } | null
    // 识别新通用格式，以及旧 fmj 共享存档 / 旧 baye（sango-save-slot 与 game=baye）格式
    function parseBackup(data) {
        if (!data || typeof data !== "object") return null;

        if (data.type === PAYLOAD_TYPE) {
            // 旧 fmj 共享存档备份：无法得知来源游戏，标记为 legacy id，
            // 由还原方允许写入任意 fmj 游戏并提示用户确认
            if (data.game === LEGACY_FMJ_ID) {
                return parsedBackup(LEGACY_FMJ_ID, null, data, 1);
            }

            // 旧 baye 备份（game=baye，未标注具体版本）：尝试用 version.libpath
            // 推导版本；推导不出则标记为 legacy，允许还原到任意 baye 版本
            if (data.game === LEGACY_BAYE_ID) {
                var libId = libIdFromVersion(data.version);
                var legacyProfileId = libId ? "baye/" + libId : LEGACY_BAYE_ID;
                return parsedBackup(legacyProfileId, SAVE_PROFILES[legacyProfileId], data, 2);
            }

            // 新通用格式：game 已含版本/游戏标识，严格按其匹配
            var profile = SAVE_PROFILES[data.game];
            if (!profile) return null;
            return parsedBackup(data.game, profile, data, expectedFileCount(profile));
        }

        // 向后兼容：更老的 baye 单槽备份（libname/libpath → 推导版本）
        if (data.type === LEGACY_TYPE) {
            var legacyLibId = libIdFromPath(data.libpath);
            var oldProfileId = legacyLibId ? "baye/" + legacyLibId : LEGACY_BAYE_ID;
            return parsedBackup(oldProfileId, SAVE_PROFILES[oldProfileId], data, 2);
        }

        return null;
    }

    // 判断解析出的备份能否还原到目标 profile
    function canRestore(parsed, profile) {
        if (!parsed || !profile) return false;
        if (parsed.profileId === profile.id) return true;
        // 旧 baye 备份无法识别版本 → 允许还原到任意 baye 版本（提示用户确认）
        if (parsed.profileId === LEGACY_BAYE_ID && profile.group === "baye") return true;
        // 旧 fmj 共享存档 → 允许还原到任意 fmj 游戏
        return parsed.profileId === LEGACY_FMJ_ID && profile.group === "fmj";
    }

    function restorePrevious(entries, completed, previous, writeKey, removeKey) {
        for (var i = completed - 1; i >= 0; i--) {
            try {
                if (previous[i] === null && typeof removeKey === "function") {
                    removeKey(entries[i].key);
                } else if (previous[i] !== null) {
                    writeKey(entries[i].key, previous[i]);
                }
            } catch (error) {
                // 尽最大努力回滚；调用方仍会收到 false 并提示还原失败
            }
        }
    }

    // 应用还原：files 写入目标槽（版本/游戏标识固化在 profile 的 slotKeys 里）。
    // 提供 readKey/removeKey 时会先保存旧值，并在任一写入失败后回滚已写项目。
    function applyRestore(profile, slot, files, version, writeKey, readKey, removeKey) {
        if (!isValidSlot(profile, slot) ||
            !areValidFiles(files, expectedFileCount(profile)) ||
            typeof writeKey !== "function") {
            return false;
        }

        var keys = profile.slotKeys(slot);
        var entries = [];
        for (var i = 0; i < keys.length; i++) {
            entries.push({ key: keys[i], value: files[i] });
        }

        // 只允许写 profile 明确声明的版本键，拒绝备份文件注入任意 localStorage key。
        if (version && typeof version === "object" && profile.versionKeys) {
            for (var v = 0; v < profile.versionKeys.length; v++) {
                var versionKey = profile.versionKeys[v];
                if (typeof version[versionKey] === "string") {
                    entries.push({ key: versionKey, value: version[versionKey] });
                }
            }
        }

        var previous = [];
        if (typeof readKey === "function") {
            try {
                for (var r = 0; r < entries.length; r++) {
                    previous.push(readKey(entries[r].key));
                }
            } catch (error) {
                return false;
            }
        }

        for (var w = 0; w < entries.length; w++) {
            try {
                if (writeKey(entries[w].key, entries[w].value) === false) {
                    if (previous.length) {
                        restorePrevious(entries, w, previous, writeKey, removeKey);
                    }
                    return false;
                }
            } catch (error) {
                if (previous.length) {
                    restorePrevious(entries, w, previous, writeKey, removeKey);
                }
                return false;
            }
        }
        return true;
    }

    // 备份文件名：bbk-{game}-save-{slot+1}-{stamp}.json（id 中的 / 转为 -）
    function fileName(profile, slot, stamp) {
        var id = profile.id.replace(/\//g, "-");
        return "bbk-" + id + "-save-" + (slot + 1) + "-" + stamp + ".json";
    }

    global.BBKBackup = {
        SAVE_PROFILES: SAVE_PROFILES,
        FMJ_GAMES: FMJ_GAMES,
        BAYE_LIBS: BAYE_LIBS,
        PAYLOAD_TYPE: PAYLOAD_TYPE,
        LEGACY_TYPE: LEGACY_TYPE,
        LEGACY_FMJ_ID: LEGACY_FMJ_ID,
        LEGACY_BAYE_ID: LEGACY_BAYE_ID,
        getProfile: getProfile,
        isValidSlot: isValidSlot,
        areValidFiles: areValidFiles,
        libIdFromPath: libIdFromPath,
        readSlotFiles: readSlotFiles,
        isSlotEmpty: isSlotEmpty,
        readVersion: readVersion,
        buildExportPayload: buildExportPayload,
        parseBackup: parseBackup,
        canRestore: canRestore,
        applyRestore: applyRestore,
        fileName: fileName
    };
})(typeof window !== "undefined" ? window : globalThis);
