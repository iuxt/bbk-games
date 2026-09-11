(function (global) {
    "use strict";

    function isIPhoneSafari(navigatorObject) {
        var userAgent = navigatorObject && navigatorObject.userAgent || "";
        var otherIOSBrowser = /(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i;

        return /iPhone/i.test(userAgent) &&
            /Version\/[\d.]+.*Safari/i.test(userAgent) &&
            !otherIOSBrowser.test(userAgent);
    }

    function installPullToRefreshGuard() {
        var documentObject = global.document;
        var lastTouchY = null;

        if (!documentObject || !isIPhoneSafari(global.navigator)) {
            return false;
        }

        documentObject.documentElement.classList.add("no-pull-to-refresh");

        function pageCanScrollUp() {
            return (global.scrollY || global.pageYOffset ||
                documentObject.documentElement.scrollTop ||
                documentObject.body && documentObject.body.scrollTop || 0) > 0;
        }

        function scrollableAncestorCanScrollUp(target) {
            var element = target && target.nodeType === 1 ?
                target : target && target.parentElement;

            while (element &&
                   element !== documentObject.body &&
                   element !== documentObject.documentElement) {
                if (element.scrollHeight > element.clientHeight && element.scrollTop > 0) {
                    return true;
                }
                element = element.parentElement;
            }
            return pageCanScrollUp();
        }

        function resetTouch() {
            lastTouchY = null;
        }

        documentObject.addEventListener("touchstart", function (event) {
            lastTouchY = event.touches.length === 1 ? event.touches[0].clientY : null;
        }, { passive: true });

        documentObject.addEventListener("touchmove", function (event) {
            var currentTouchY;
            var isPullingDown;

            if (lastTouchY === null || event.touches.length !== 1) {
                return;
            }

            currentTouchY = event.touches[0].clientY;
            isPullingDown = currentTouchY > lastTouchY;
            lastTouchY = currentTouchY;

            if (isPullingDown && !scrollableAncestorCanScrollUp(event.target)) {
                event.preventDefault();
            }
        }, { passive: false });

        documentObject.addEventListener("touchend", resetTouch, { passive: true });
        documentObject.addEventListener("touchcancel", resetTouch, { passive: true });
        return true;
    }

    function installVirtualKeyPressFeedback(documentObject) {
        var pressedPointers = Object.create(null);
        var selector = "#touchpad .btn, .device-key";

        documentObject = documentObject || global.document;
        if (!documentObject || !documentObject.addEventListener) {
            return false;
        }

        function findKey(target) {
            var element = target && target.nodeType === 1 ?
                target : target && target.parentElement;
            return element && element.closest ? element.closest(selector) : null;
        }

        function press(event) {
            var key;

            if (event.button !== undefined && event.button !== 0) {
                return;
            }
            key = findKey(event.target);
            if (!key || key.disabled) {
                return;
            }
            pressedPointers[event.pointerId] = key;
            key.classList.add("is-pointer-pressed");
        }

        function release(event) {
            var key = pressedPointers[event.pointerId];
            var pointerId;

            if (!key) {
                return;
            }
            delete pressedPointers[event.pointerId];
            for (pointerId in pressedPointers) {
                if (pressedPointers[pointerId] === key) {
                    return;
                }
            }
            key.classList.remove("is-pointer-pressed");
        }

        function releaseAll() {
            var pointerId;

            for (pointerId in pressedPointers) {
                pressedPointers[pointerId].classList.remove("is-pointer-pressed");
                delete pressedPointers[pointerId];
            }
        }

        documentObject.addEventListener("pointerdown", press, true);
        documentObject.addEventListener("pointerup", release, true);
        documentObject.addEventListener("pointercancel", release, true);
        documentObject.addEventListener("visibilitychange", function () {
            if (documentObject.hidden) {
                releaseAll();
            }
        });
        if (global.addEventListener) {
            global.addEventListener("blur", releaseAll);
        }
        return true;
    }

    global.BBKGamePage = {
        isIPhoneSafari: isIPhoneSafari,
        installPullToRefreshGuard: installPullToRefreshGuard,
        installVirtualKeyPressFeedback: installVirtualKeyPressFeedback
    };

    installPullToRefreshGuard();
    installVirtualKeyPressFeedback();
}(typeof window !== "undefined" ? window : globalThis));
