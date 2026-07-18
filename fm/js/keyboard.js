
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


function onKeyDown(key)
{
    switch(key){
    	case 1:
    		sendKey(KEY_UP);
    		break;
    	case 2:
    		sendKey(KEY_DOWN);
    		break;
    	case 3:
    		sendKey(KEY_LEFT);
    		break;
    	case 4:
    		sendKey(KEY_RIGHT);
    		break;
    	case 5:
    		sendKey(KEY_PAGEUP);
    		break;
    	case 6:
    		sendKey(KEY_PAGEDOWN);
    		break;
    	case 7:
    		sendKey(KEY_ENTER);
    		break;
    	case 8:
    		sendKey(KEY_CANCEL);
    		break;
    }
}

