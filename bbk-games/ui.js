(function () {
    "use strict";

    var hiddenLabels = {
        "金手指（作弊工具）": true,
        "切换横屏": true,
        "下载APP": true
    };
    var keyLabels = {
        "1": "方向上",
        "2": "方向下",
        "3": "方向左",
        "4": "方向右",
        "5": "L 键",
        "6": "R 键",
        "7": "A 键，确认",
        "8": "B 键，返回"
    };

    function setInactiveFeatures() {
        try {
            localStorage.setItem("enableAudio", "false");
            localStorage.setItem("enableVibrate", "false");
            localStorage.removeItem("renderPeixel");
        } catch (error) {
            // 隐私模式下 localStorage 可能不可用，不影响模拟器主体。
        }
    }

    function makeButton(element, label) {
        if (!element || element.dataset.bbkButtonReady) {
            return;
        }
        element.dataset.bbkButtonReady = "true";
        element.setAttribute("role", "button");
        element.setAttribute("tabindex", "0");
        if (label) {
            element.setAttribute("aria-label", label);
        }
        element.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                element.click();
            }
        });
    }

    function enhanceControls() {
        Object.keys(keyLabels).forEach(function (id) {
            makeButton(document.getElementById(id), keyLabels[id]);
        });

        var toolButtons = document.querySelectorAll('[class*="src_toolButton"]');
        Array.prototype.forEach.call(toolButtons, function (button) {
            makeButton(button, button.textContent.trim());
        });

        var gameButtons = document.querySelectorAll('[class*="game-center_game__"]');
        Array.prototype.forEach.call(gameButtons, function (button) {
            var name = button.querySelector('[class*="game-center_name"]');
            makeButton(button, "选择游戏：" + (name ? name.textContent.trim() : ""));
            button.setAttribute(
                "aria-pressed",
                button.getAttribute("style").indexOf("169") !== -1 ? "true" : "false"
            );
            if (!button.dataset.bbkSelectionReady) {
                button.dataset.bbkSelectionReady = "true";
                button.addEventListener("click", function () {
                    window.setTimeout(updateSelectedGame, 0);
                });
            }
        });

        var dialogActions = document.querySelectorAll(
            '[class*="game-center_button"], [class*="alert_okButton"]'
        );
        Array.prototype.forEach.call(dialogActions, function (button) {
            makeButton(button, button.textContent.trim());
        });

        var gameDialog = document.querySelector('[class*="game-center_container"]');
        if (gameDialog) {
            gameDialog.setAttribute("role", "dialog");
            gameDialog.setAttribute("aria-modal", "true");
            gameDialog.setAttribute("aria-label", "选择电子词典游戏");
        }

        var canvas = document.getElementById("canvas");
        if (canvas) {
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", "电子词典游戏画面");
        }
    }

    function updateSelectedGame() {
        var gameButtons = document.querySelectorAll('[class*="game-center_game__"]');
        Array.prototype.forEach.call(gameButtons, function (button) {
            button.setAttribute(
                "aria-pressed",
                button.getAttribute("style").indexOf("169") !== -1 ? "true" : "false"
            );
        });
    }

    function hideInactiveFeatures() {
        var nodes = document.querySelectorAll("div, span, button, a, li");
        Array.prototype.forEach.call(nodes, function (element) {
            if (element.children.length) {
                return;
            }
            var label = element.textContent && element.textContent.trim();
            if (hiddenLabels[label]) {
                element.hidden = true;
                element.style.display = "none";
            }
        });

        var settings = document.querySelectorAll('[class*="setting_settingIcon"]');
        Array.prototype.forEach.call(settings, function (element) {
            element.hidden = true;
            element.style.display = "none";
        });
    }

    function refresh() {
        hideInactiveFeatures();
        enhanceControls();
    }

    function start() {
        setInactiveFeatures();
        refresh();
        new MutationObserver(refresh).observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
}());
