// 通用存档备份 / 还原引擎
//
// 每个 SAVE_PROFILES 条目描述一个游戏（或引擎）的存档布局：
//   - slots       存档槽位数
//   - slotKeys(n) 槽 n（从 0 起）对应的全部 localStorage key
//   - versionKeys 随存档一起备份 / 还原的版本 key（可空，如 fmj 无版本）
//
// 全部为纯逻辑，不依赖 DOM / jQuery / lcd.js，便于在 node 里单测。
// DOM 与下载交互仍留在各页面的胶水脚本里。

(function (global) {
    "use strict";

    var SAVE_PROFILES = {
        // 三国霸业：3 槽，槽 n → sango(2n).sav + sango(2n+1).sav，附 lib 版本
        baye: {
            id: "baye",
            name: "三国霸业",
            slots: 3,
            slotKeys: function (slot) {
                return [
                    "baye//data//sango" + (slot * 2) + ".sav",
                    "baye//data//sango" + (slot * 2 + 1) + ".sav"
                ];
            },
            versionKeys: ["baye/libname", "baye/libpath"]
        },
        // fmj 引擎（伏魔记 / 金庸群侠传 / 赤壁之战 / 侠客行等共用同一存档空间）：
        // 3 槽，槽 n → sav/fmjsave{n}，单文件，无版本（ROM 内嵌）
        fmj: {
            id: "fmj",
            name: "RPG（伏魔记等）",
            slots: 3,
            slotKeys: function (slot) {
                return ["sav/fmjsave" + slot];
            },
            versionKeys: []
        }
    };

    var PAYLOAD_TYPE = "bbk-save-slot";
    var LEGACY_TYPE = "sango-save-slot"; // 旧版 baye 单槽备份，仍允许还原

    function getProfile(id) {
        return SAVE_PROFILES[id] || null;
    }

    function readSlotFiles(profile, slot, readKey) {
        var keys = profile.slotKeys(slot);
        var files = [];
        for (var i = 0; i < keys.length; i++) {
            files.push(readKey(keys[i]) || "");
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

    // 解析上传的备份 JSON → { profileId, slot, version, files } | null
    // 同时识别新通用格式与旧 sango-save-slot 格式
    function parseBackup(data) {
        if (!data || typeof data !== "object") return null;

        if (data.type === PAYLOAD_TYPE) {
            if (!SAVE_PROFILES[data.game]) return null;
            if (!Array.isArray(data.files) || !data.files.length) return null;
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

    // 应用还原：files 写入目标槽，version 写回版本 key
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

    // 备份文件名：bbk-{game}-save-{slot+1}-{stamp}.sav
    function fileName(profile, slot, stamp) {
        return "bbk-" + profile.id + "-save-" + (slot + 1) + "-" + stamp + ".sav";
    }

    global.BBKBackup = {
        SAVE_PROFILES: SAVE_PROFILES,
        PAYLOAD_TYPE: PAYLOAD_TYPE,
        LEGACY_TYPE: LEGACY_TYPE,
        getProfile: getProfile,
        readSlotFiles: readSlotFiles,
        isSlotEmpty: isSlotEmpty,
        readVersion: readVersion,
        buildExportPayload: buildExportPayload,
        parseBackup: parseBackup,
        applyRestore: applyRestore,
        fileName: fileName
    };
})(typeof window !== "undefined" ? window : globalThis);
