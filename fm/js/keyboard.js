
	var KEY_UP = 1
    var KEY_DOWN = 2
    var KEY_LEFT = 3
    var KEY_RIGHT = 4
    var KEY_PAGEUP = 5
    var KEY_PAGEDOWN = 6
    var KEY_ENTER = 7
    var KEY_CANCEL = 8

function sysAddKeyDownListener(callback) {
    window.fmjSendKeyDown = callback;
}

function sysAddKeyUpListener(callback) {
    window.fmjSendKeyUp = callback;
}

function sendKey(key) {
    // fmjSendKeyDown/Up 在 fmj.core.js 调用 sysAddKey*Listener 之后才注册，
    // 引擎加载完成前点击按钮需静默忽略，避免 ReferenceError 吞键
    if (typeof fmjSendKeyDown === 'function') fmjSendKeyDown(key);
    if (typeof fmjSendKeyUp === 'function') fmjSendKeyUp(key);
}


function normalizeKey(input) {
    if (typeof input === "number" && input >= KEY_UP && input <= KEY_CANCEL) {
        return input;
    }

    var key = input && input.key;
    var keyCode = input && input.keyCode;
    switch (key) {
        case "ArrowUp":
            return KEY_UP;
        case "ArrowDown":
            return KEY_DOWN;
        case "ArrowLeft":
            return KEY_LEFT;
        case "ArrowRight":
            return KEY_RIGHT;
        case "[":
        case "PageUp":
            return KEY_PAGEUP;
        case "]":
        case "PageDown":
            return KEY_PAGEDOWN;
        case "Enter":
            return KEY_ENTER;
        case " ":
        case "Spacebar":
        case "Escape":
            return KEY_CANCEL;
    }

    switch (keyCode) {
        case 38:
            return KEY_UP;
        case 40:
            return KEY_DOWN;
        case 37:
            return KEY_LEFT;
        case 39:
            return KEY_RIGHT;
        case 219:
        case 33:
            return KEY_PAGEUP;
        case 221:
        case 34:
            return KEY_PAGEDOWN;
        case 13:
            return KEY_ENTER;
        case 32:
        case 27:
            return KEY_CANCEL;
        default:
            return null;
    }
}

function onKeyDown(input)
{
    var key = normalizeKey(input);
    if (key === null) return;

    sendKey(key);
    if (input && typeof input.preventDefault === "function") {
        input.preventDefault();
    }
    return false;
}
