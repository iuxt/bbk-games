var lcdWidth = 16*10;
var lcdHeight = 16*6;
var dotSize = 2;

function getLCD() {
    var canvas = document.getElementById('lcd');
    if (canvas.getContext === undefined) {
        alert("你的浏览器不支持HTML5");
    }
    var ctx = canvas.getContext('2d');
    return ctx;
}

function lcdInit()
{
    var width = 16*10;
    var height = 16*6;

    bayeResizeScreen(width, height);

    if (window.localStorage["baye/debug"] == '1') {
        _bayeSetDebug(1);
    }
}

function bayeResizeScreen(width, height) {
    lcdWidth = width;
    lcdHeight = height;
    var canvas = document.getElementById('lcd');
    canvas.width = width * dotSize;
    canvas.height = height * dotSize
    _bayeSetLcdSize(lcdWidth, lcdHeight);
}

function imagePixel(img, i)
{
    img.data[i] = 0;
    img.data[i+1] = 0;
    img.data[i+2] = 0;
    img.data[i+3] = 255;
}

function imageDot(img, x, y, lineSize)
{
    var ind = lineSize*y + x;
    imagePixel(img, ind*4);
}

function lcdSetDotSize(s)
{
    dotSize = s;
}

function lcdFlushBuffer(buffer) {
    var lcd = getLCD();
    var w = lcdWidth*dotSize;
    var h = lcdHeight*dotSize

    var img = lcd.createImageData(lcdWidth*dotSize, lcdHeight*dotSize);

    for (var y = 0; y < h; y += 1) {
        for (var x = 0; x < w; x += 1) {
            var ind = w*y + x;
            var pixel = getValue(buffer + ind, "i8");
            if (pixel != 0) {
                imageDot(img, x, y, w);
            }
        }
    }
    lcd.imageSmoothingEnabled = false;
    lcd.putImageData(img, 0, 0);
}

function sendKey(key) {
    _bayeSendKey(key);
}

var 		VK_UP	=			0x22;
var 		VK_DOWN	=			0x23;
var 		VK_LEFT	=			0x24;
var 		VK_RIGHT=			0x25;
var 		VK_HELP	=			0x26;
var 		VK_ENTER=			0x27;
var 		VK_EXIT	=			0x28;

var 		VK_SEARCH	=		0x33;

function onKeyDown(e) {
    var event = e?e:window.event;

    switch (event.keyCode) {
        case 13:
            sendKey(VK_ENTER);
            break;
        case 72:
            sendKey(VK_HELP);
            break;
        case 70:
            sendKey(VK_SEARCH);
            break;
        case 83:
            sendKey(VK_SEARCH);
            break;
        case 32:
            sendKey(VK_EXIT);
            break;
        case 27:
            sendKey(VK_EXIT);
            break;
        case 38:
            sendKey(VK_UP);
            break;
        case 40:
            sendKey(VK_DOWN);
            break;
        case 37:
            sendKey(VK_LEFT);
            break;
        case 39:
            sendKey(VK_RIGHT);
            break;
        default:
            return;
    }

    // 已映射的游戏按键阻止默认行为，避免方向键/空格滚动页面
    if (event.preventDefault) event.preventDefault();
    return false;
}

function bin2hex (s) {

  var i, l, o = "", n;

  s += "";

  for (i = 0, l = s.length; i < l; i++) {
    n = s.charCodeAt(i).toString(16)
    o += n.length < 2 ? "0" + n : n;
  }

  return o;
}

function getLibPath() {
    return window.localStorage['baye/libpath'] || "";
}

// 当前版本的标识（如 "libs/SGBY.lib" → "SGBY"），用于隔离不同版本的存档
function getLibId() {
    var path = getLibPath();
    if (!path) return "";
    return path.split("/").pop().replace(/\.lib$/i, "");
}

// 存档按版本隔离：引擎的固定文件名映射为带版本后缀的 localStorage key，
// 让三个版本各自拥有独立的存档空间；版本设置项（baye/libname 等）不受影响
function bayeSaveKey(filename) {
    var libId = getLibId();
    if (!libId || filename.indexOf("baye//data//") !== 0) return filename;
    return filename + "@" + libId;
}

function clearLibData() {
    window.localStorage.removeItem('baye//data/dat.lib');
    window.localStorage.removeItem('baye/libname');
    window.localStorage.removeItem('baye/libpath');
}

function getLibName() {
    return window.localStorage['baye/libname'] || "步步高原版";
}

if (typeof(Storage) === "undefined") {
    alert("你的浏览器不支持存档");
}


String.prototype.format = function(args) {
    var result = this;
    if (arguments.length > 0) {
        if (arguments.length == 1 && typeof (args) == "object") {
            for (var key in args) {
                if(args[key]!=undefined){
                    var reg = new RegExp("({" + key + "})", "g");
                    result = result.replace(reg, args[key]);
                }
            }
        }
        else {
            for (var i = 0; i < arguments.length; i++) {
                if (arguments[i] != undefined) {
                    var reg = new RegExp("({[" + i + "]})", "g");
                    result = result.replace(reg, arguments[i]);
                }
            }
        }
    }
    return result;
}

function ajaxGet(path, callback, errorCallback) {
    var xhr = new XMLHttpRequest();
    var completed = false;

    function fail() {
        if (completed) return;
        completed = true;
        if (typeof errorCallback === "function") errorCallback();
    }

    xhr.open('GET', path, true);
    xhr.responseType = 'blob';
    xhr.timeout = 30000;

    xhr.onload = function(e) {
        if (this.status == 200) {
            completed = true;
            callback(this.response);
        } else {
            fail();
        }
    };
    xhr.onerror = fail;
    xhr.onabort = fail;
    xhr.ontimeout = fail;

    xhr.send();
}

var dynLib = null;

function loadLibFromUrl(url, then, errorCallback) {
    console.log("loading from " + url);
    ajaxGet(url, function(file){
        console.log("ajax ok");
        var reader = new FileReader();
        function failRead() {
            if (typeof errorCallback === "function") errorCallback();
        }
        reader.onload = function() {
            dynLib = bin2hex(reader.result);
            console.log("read ok");
            then();
        };
        reader.onerror = failRead;
        reader.onabort = failRead;
        try {
            reader.readAsBinaryString(file);
        } catch (error) {
            failRead();
        }
    }, errorCallback);
}

function showGameLoadError(message) {
    var element = document.getElementById("game-load-error");
    if (!element) {
        if (message) alert(message);
        return;
    }
    element.textContent = message || "";
    element.hidden = !message;
}

function bayeMain() {
    var url = getLibPath();
    if (!url) {
        window.location.href = "index.html";
        return;
    }
    showGameLoadError("");
    loadLibFromUrl(url, function(){
        _main();
    }, function() {
        showGameLoadError("游戏数据载入失败，请检查网络后刷新重试。");
    });
}

function chooseLib(title, path, self_) {
    var self = $(self_);
    self.attr("disabled", "disabled");

    clearLibData();
    if (path && path.length > 0) {
        window.localStorage['baye/libname'] = title;
        window.localStorage['baye/libpath'] = path;
    }
    redirect();
}


function loadDetail(id, path) {
    var e = $(id);
    if (e.is(":hidden")) {
        if (e.html().length > 0) {
            e.show();
        } else {
            $.get(path, {}, function(text) {
                e.html(text.replace(/(?:\r\n|\r|\n)/g, '<br />'));
                e.show();
            });
        }
    } else {
        e.hide();
    }
}

function loadLibLists(container) {

    $.ajax({
         type:"GET",
         url:"libs.json",
         dataType:"json",
     }).success(function(json) {
        var tpl = $("#item_temp").html();

        html = "";
        for (i in json) {
            html += tpl.format(
            {
             title: json[i]["title"],
             num: ("0" + (parseInt(i, 10) + 1)).slice(-2),
             libpath: json[i]["path"],
             descid: i,
             descpath: json[i]["path"]+'.txt',
            }
            );
        }
        $(container).html(html);
    });
}

function redirect(page) {
    if (!getLibPath()) {
        window.location.href = "index.html";
        return;
    }
    var isMobile = false;
    if(navigator.userAgent.match(/(iPhone|iPod|Android|ios|Mobile|ARM)/i)){
        // 移动端统一为 portal 虚拟按键页 m.html（与魔塔/RPG 同款），不再按操作模式分流
        page = page || "m.html";
        isMobile = true;
    } else {
        page = "pc.html";
        isMobile = false;
    }
    var now = new Date().getTime() / 1000;
    var name = getLibName();
    var hash = isMobile ? "#" + now : "";
    window.location.href = page + "?name=" + name + hash;
}

function goHome() {
    window.location.href = "../index.html";
}

// --------- Engine callbacks ---------

function bayeFlushLcdBuffer(buffer) {
    lcdFlushBuffer(buffer);
}

function bayeStart() {
    _bayeSetLcdSize(lcdWidth, lcdHeight);
}

function bayeExit() {
    // 某些独立游戏（如魔塔）会把 VK_EXIT 同时用于游戏内取消/返回。
    // 这些页面关闭自动导航后，按键仍会发送给引擎，但不会被带回门户首页。
    if (window.bayeExitToHome === false) return;
    goHome();
}

function bayeLoadFileContent(filename) {
    console.log("Loading " + filename);
    if (filename == 'baye//data/dat.lib') {
        return dynLib;
    }
    var key = bayeSaveKey(filename);
    var data = window.localStorage[key];
    if (data === undefined && key !== filename) {
        // 兼容旧的跨版本共享存档：版本空间还没有数据时回退到旧 key
        data = window.localStorage[filename];
    }
    return data;
}

function bayeSaveFileContent(filename, content) {
    console.log("Saving " + filename);
    try {
        window.localStorage[bayeSaveKey(filename)] = content;
    } catch (e) {
        // 配额超限/隐私模式/存储被禁用时吞掉异常，避免抛回引擎导致存档流程崩溃
        console.warn("bayeSaveFileContent failed: " + e);
    }
}

Module = {};
Module.memoryInitializerPrefixURL = "../baye-engine/";
Module.TOTAL_MEMORY = 16777216 * 3;
Module.noInitialRun = true;
