
;(function(global) {
    var gbkDecoder = new TextDecoder('GBK');
    var gbkEncoder = new TextEncoder('GBK', { NONSTANDARD_allowLegacyEncoding: true });

    var KEY_UP = 1
    var KEY_DOWN = 2
    var KEY_LEFT = 3
    var KEY_RIGHT = 4
    var KEY_PAGEUP = 5
    var KEY_PAGEDOWN = 6
    var KEY_ENTER = 7
    var KEY_CANCEL = 8

    function transCode(k) {
        switch (k) {
            case 13:
                return KEY_ENTER;
            case 32:
                return KEY_CANCEL;
            case 27:
                return KEY_CANCEL;
            case 38:
                return KEY_UP;
            case 40:
                return KEY_DOWN;
            case 37:
                return KEY_LEFT;
            case 39:
                return KEY_RIGHT;
            case 219:
                return KEY_PAGEUP;
            case 221:
                return KEY_PAGEDOWN;
            default:
                return 255;
        }
    };

    function getLCD() {
        var canvas = document.getElementById('lcd');
        var ctx = canvas.getContext('2d');
        return ctx;
    }

    function imagePixel(img, i, color)
    {
        img.data[i] = color.r;
        img.data[i+1] = color.g;
        img.data[i+2] = color.b;
        img.data[i+3] = color.a;
    }

    function imageDot(img, x, y, lineSize, color)
    {
        var ind = lineSize*y + x;
        imagePixel(img, ind*4, color);
    }

    // 从页面路径推导游戏标识（/fm/games/伏魔记/pc.html → 伏魔记），
    // 让每个游戏拥有独立的存档空间；无法识别时不做隔离
    function gameId() {
        var m = window.location.pathname.match(/\/games\/([^\/]+)\//);
        if (!m) return "";
        try {
            return decodeURIComponent(m[1]);
        } catch (e) {
            return m[1];
        }
    }

    // sav/fmjsave0 → sav/<游戏>/fmjsave0
    function saveKey(path) {
        var id = gameId();
        return id ? "sav/" + id + "/" + path.slice(4) : path;
    }

    global.sysStorageGet = function(path) {
        try {
            if (!path.startsWith("sav/")) {
                return fmj.rom[path];
            }
            var key = saveKey(path);
            var value = window.localStorage[key];
            if (value == null && key !== path) {
                // 兼容旧的跨游戏共享存档
                value = window.localStorage[path];
            }
            return value;
        } catch (e) {
            console.warn("sysStorageGet failed: " + e);
            return null;
        }
    };

    global.sysStorageSet = function(path, value) {
        try {
            if (path.startsWith("sav/")) {
                return window.localStorage[saveKey(path)] = value;
            }
            return fmj.rom[path] = value;
        } catch (e) {
            // 隐私模式/配额超限/存储被禁用时，吞掉异常避免抛回 Kotlin 调用栈导致游戏循环崩溃
            console.warn("sysStorageSet failed: " + e);
            return null;
        }
    };

    global.sysStorageHas = function(path) {
        try {
            if (!path.startsWith("sav/")) {
                return fmj.rom[path] != null;
            }
            var key = saveKey(path);
            return window.localStorage[key] != null ||
                (key !== path && window.localStorage[path] != null);
        } catch (e) {
            return false;
        }
    };

    global.sysGbkEncode = function(str) {
        return gbkEncoder.encode(str);
    };

    global.sysGbkDecode = function(data) {
        return gbkDecoder.decode(new Int8Array(data));
    };

    global.sysRandom = Math.random;

    function call(f, a) {
        try {
            f(a);
        } catch (e) {
            throw new Error(e + "\n" + e.stack);
        }
    }

    global.sysAddKeyDownListener = function(callback) {
        $('body').keydown(function(e){
            var key = transCode(e.keyCode);
            // 已映射的游戏按键阻止默认行为，避免方向键/空格滚动页面
            if (key !== 255) e.preventDefault();
            call(callback, key);
        });
    };

    global.sysAddKeyUpListener = function(callback) {
        $('body').keyup(function(e){
            call(callback, transCode(e.keyCode));
        });
    };

    global.sysSetInterval = function(interval, callback) {
        fmj.updateInterval = setInterval(function(){
            call(callback);
        }, interval);
        return fmj.updateInterval;
    };

    global.sysDrawScreen = function(buffer, wid, hgt) {
        var lcd = getLCD();
        var w = wid;
        var h = hgt;

        var img = lcd.createImageData(wid, hgt);

        for (var y = 0; y < h; y += 1) {
            for (var x = 0; x < w; x += 1) {
                var ind = w*y + x;
                var pixel = buffer[ind];
                imageDot(img, x, y, w, pixel);
            }
        }
        lcd.imageSmoothingEnabled = false;
        lcd.putImageData(img, 0, 0);
    };

    global.sysExit = function() {
        console.log("Exit");
    };

    global.fmj = {rom: {}};
})(this);


window.onerror = function(msg, url, line, col, error) {
    clearInterval(fmj.updateInterval);
    alert(msg + " at " + line);
    return false;
};
