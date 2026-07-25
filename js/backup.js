// 通用存档备份 / 还原引擎
//
// 每个 SAVE_PROFILES 条目描述一个游戏（或游戏的一个版本）的存档布局：
//   - group           归属的游戏组（baye / fmj），用于页面分组与旧格式兼容
//   - slots           存档槽位数
//   - slotKeys(n,ctx) 槽 n（从 0 起）对应的全部 localStorage key；
//                     ctx 为可选的版本标识（如 baye 的 lib id），实现按版本隔离
//   - legacySlotKeys  旧的共享存档 key（可空），导出时对新 key 为空的文件逐个回退读取
//   - versionKeys     随存档一起备份 / 还原的版本 key（可空，如 fmj 无版本）
//
// 全部为纯逻辑，不依赖 DOM / jQuery / lcd.js，便于在 node 里单测。
// DOM 与下载交互仍留在各页面的胶水脚本里。

(function (global) {
    "use strict";

    var FMJ_GAMES = ["伏魔记", "金庸群侠传", "赤壁之战之乱世枭雄", "赤壁之战之谁与争锋", "侠客行"];

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

    var SAVE_PROFILES = {
        // 三国霸业：3 槽，槽 n → sango(2n).sav + sango(2n+1).sav，附 lib 版本；
        // 存档按 lib 隔离（ctx = lib id），旧共享 key 作为 legacy 回退
        baye: {
            id: "baye",
            group: "baye",
            name: "三国霸业",
            slots: 3,
            slotKeys: function (slot, ctx) {
                var suffix = ctx ? "@" + ctx : "";
                return [
                    "baye//data//sango" + (slot * 2) + ".sav" + suffix,
                    "baye//data//sango" + (slot * 2 + 1) + ".sav" + suffix
                ];
            },
            legacySlotKeys: function (slot) {
                return [
                    "baye//data//sango" + (slot * 2) + ".sav",
                    "baye//data//sango" + (slot * 2 + 1) + ".sav"
                ];
            },
            versionKeys: ["baye/libname", "baye/libpath"]
        }
    };
    for (var i = 0; i < FMJ_GAMES.length; i++) {
        SAVE_PROFILES["fmj/" + FMJ_GAMES[i]] = fmjProfile(FMJ_GAMES[i]);
    }

    var PAYLOAD_TYPE = "bbk-save-slot";
    var LEGACY_TYPE = "sango-save-slot"; // 旧版 baye 单槽备份，仍允许还原
    var LEGACY_FMJ_ID = "fmj";           // 旧版 fmj 共享存档备份的 game id

    function getProfile(id) {
        return SAVE_PROFILES[id] || null;
    }

    function readSlotFiles(profile, slot, readKey, ctx) {
        var keys = profile.slotKeys(slot, ctx);
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
    function buildExportPayload(profile, slot, readKey, ctx) {
        var files = readSlotFiles(profile, slot, readKey, ctx);
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

    // 解析上传的备份 JSON → { profileId, slot, version, files } | null
    // 同时识别新通用格式、旧 fmj 共享存档格式与旧 sango-save-slot 格式
    function parseBackup(data) {
        if (!data || typeof data !== "object") return null;

        if (data.type === PAYLOAD_TYPE) {
            if (!Array.isArray(data.files) || !data.files.length) return null;
            // 旧 fmj 共享存档备份：无法得知来源游戏，标记为 legacy id，
            // 由还原方允许写入任意 fmj 游戏并提示用户确认
            if (data.game === LEGACY_FMJ_ID) {
                return {
                    profileId: LEGACY_FMJ_ID,
                    slot: typeof data.slot === "number" ? data.slot : 0,
                    version: null,
                    files: data.files
                };
            }
            if (!SAVE_PROFILES[data.game]) return null;
            return {
                profileId: data.game,
                slot: typeof data.slot === "number" ? data.slot : 0,
                version: data.version || null,
                files: data.files
            };
        }

        // 向后兼容：旧 baye 单槽备份（libname/libpath → version 映射）
        if (data.type === LEGACY_TYPE) {
            if (!Array.isArray(data.files) || data.files.length < 2) return null;
            var version = null;
            if (data.libname || data.libpath) {
                version = {};
                if (data.libname) version["baye/libname"] = data.libname;
                if (data.libpath) version["baye/libpath"] = data.libpath;
            }
            return {
                profileId: "baye",
                slot: typeof data.slot === "number" ? data.slot : 0,
                version: version,
                files: data.files
            };
        }

        return null;
    }

    // 判断解析出的备份能否还原到目标 profile
    function canRestore(parsed, profile) {
        if (!parsed || !profile) return false;
        if (parsed.profileId === profile.id) return true;
        // 旧 fmj 共享存档备份允许还原到任意 fmj 游戏
        return parsed.profileId === LEGACY_FMJ_ID && profile.group === "fmj";
    }

    // 应用还原：files 写入目标槽（含版本隔离），version 写回版本 key
    // writeKey 返回 false 表示写入失败（如配额超限）→ 立即中止并返回 false
    function applyRestore(profile, slot, files, version, writeKey, ctx) {
        var keys = profile.slotKeys(slot, ctx);
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

    // 备份文件名：bbk-{game}-save-{slot+1}-{stamp}.sav（id 中的 / 转为 -）
    function fileName(profile, slot, stamp) {
        var id = profile.id.replace(/\//g, "-");
        return "bbk-" + id + "-save-" + (slot + 1) + "-" + stamp + ".sav";
    }

    global.BBKBackup = {
        SAVE_PROFILES: SAVE_PROFILES,
        FMJ_GAMES: FMJ_GAMES,
        PAYLOAD_TYPE: PAYLOAD_TYPE,
        LEGACY_TYPE: LEGACY_TYPE,
        LEGACY_FMJ_ID: LEGACY_FMJ_ID,
        getProfile: getProfile,
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
