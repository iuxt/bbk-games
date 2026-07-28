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

    global.BBKGamePage = {
        isIPhoneSafari: isIPhoneSafari,
        installPullToRefreshGuard: installPullToRefreshGuard
    };

    installPullToRefreshGuard();
}(typeof window !== "undefined" ? window : globalThis));
