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

    function readSlotFiles(profile, slot, readKey) {
        var keys = profile.slotKeys(slot);
        var legacyKeys = profile.legacySlotKeys ? profile.legacySlotKeys(slot) : null;
        var files = [];
        for (var i = 0; i < keys.length; i++) {
            var value = readKey(keys[i]);
            if ((!value || !value.length) && legacyKeys && legacyKeys[i] !== keys[i]) {
                // 新存档空间还没有数据时，回退读取旧的共享存档
                value = readKey(legacyKeys[i]);
            }
            files.push(value || "");
        }
        return files;
    }

    function isSlotEmpty(files) {
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

    function slotNumberOf(data) {
        return typeof data.slot === "number" ? data.slot : 0;
    }

    // 解析上传的备份 JSON → { profileId, slot, version, files } | null
    // 识别新通用格式，以及旧 fmj 共享存档 / 旧 baye（sango-save-slot 与 game=baye）格式
    function parseBackup(data) {
        if (!data || typeof data !== "object") return null;

        if (data.type === PAYLOAD_TYPE) {
            if (!Array.isArray(data.files) || !data.files.length) return null;

            // 旧 fmj 共享存档备份：无法得知来源游戏，标记为 legacy id，
            // 由还原方允许写入任意 fmj 游戏并提示用户确认
            if (data.game === LEGACY_FMJ_ID) {
                return {
                    profileId: LEGACY_FMJ_ID,
                    slot: slotNumberOf(data),
                    version: null,
                    files: data.files
                };
            }

            // 旧 baye 备份（game=baye，未标注具体版本）：尝试用 version.libpath
            // 推导版本；推导不出则标记为 legacy，允许还原到任意 baye 版本
            if (data.game === LEGACY_BAYE_ID) {
                var libId = libIdFromVersion(data.version);
                return {
                    profileId: libId ? "baye/" + libId : LEGACY_BAYE_ID,
                    slot: slotNumberOf(data),
                    version: null,
                    files: data.files
                };
            }

            // 新通用格式：game 已含版本/游戏标识，严格按其匹配
            if (!SAVE_PROFILES[data.game]) return null;
            return {
                profileId: data.game,
                slot: slotNumberOf(data),
                version: data.version || null,
                files: data.files
            };
        }

        // 向后兼容：更老的 baye 单槽备份（libname/libpath → 推导版本）
        if (data.type === LEGACY_TYPE) {
            if (!Array.isArray(data.files) || data.files.length < 2) return null;
            var legacyLibId = libIdFromPath(data.libpath);
            return {
                profileId: legacyLibId ? "baye/" + legacyLibId : LEGACY_BAYE_ID,
                slot: slotNumberOf(data),
                version: null,
                files: data.files
            };
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

    // 应用还原：files 写入目标槽（版本/游戏标识固化在 profile 的 slotKeys 里）
    // writeKey 返回 false 表示写入失败（如配额超限）→ 立即中止并返回 false
    function applyRestore(profile, slot, files, version, writeKey) {
        var keys = profile.slotKeys(slot);
        for (var i = 0; i < keys.length; i++) {
            if (writeKey(keys[i], files[i] || "") === false) return false;
        }
        if (version) {
            for (var k in version) {
                if (!Object.prototype.hasOwnProperty.call(version, k)) continue;
                if (writeKey(k, version[k]) === false) return false;
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
