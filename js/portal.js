(function (global) {
    "use strict";

    function readStoredValue(storage, key, validValues) {
        try {
            var value = storage.getItem(key);
            return validValues.indexOf(value) !== -1 ? value : "0";
        } catch (error) {
            return "0";
        }
    }

    function writeStoredValue(storage, key, value) {
        try {
            storage.setItem(key, value);
            return true;
        } catch (error) {
            return false;
        }
    }

    function getSafeStorage(host) {
        try {
            return host.localStorage;
        } catch (error) {
            return null;
        }
    }

    function bindSettings(document, storage) {
        var controls = document.querySelectorAll("[data-storage-key]");
        Array.prototype.forEach.call(controls, function (control) {
            var validValues = Array.prototype.map.call(
                control.options,
                function (option) { return option.value; }
            );
            control.value = readStoredValue(
                storage,
                control.dataset.storageKey,
                validValues
            );
            control.addEventListener("change", function () {
                writeStoredValue(storage, control.dataset.storageKey, control.value);
            });
        });
    }

    function createDialogController(elements) {
        function open() {
            elements.overlay.hidden = false;
            elements.opener.setAttribute("aria-expanded", "true");
            elements.body.classList.add("dialog-open");
            elements.closeButton.focus();
        }

        function close() {
            elements.overlay.hidden = true;
            elements.opener.setAttribute("aria-expanded", "false");
            elements.body.classList.remove("dialog-open");
            elements.opener.focus();
        }

        return { open: open, close: close };
    }

    function launchWithFallback(event, launcher) {
        if (typeof launcher !== "function") {
            return false;
        }
        try {
            launcher();
            event.preventDefault();
            return true;
        } catch (error) {
            return false;
        }
    }

    function init(document, storage) {
        bindSettings(document, storage);

        var overlay = document.getElementById("settings-overlay");
        var opener = document.getElementById("settings-trigger");
        var closeButton = document.getElementById("settings-close");
        var startLink = document.getElementById("start-baye");
        var controller = createDialogController({
            overlay: overlay,
            opener: opener,
            closeButton: closeButton,
            body: document.body,
        });

        opener.addEventListener("click", controller.open);
        closeButton.addEventListener("click", controller.close);
        overlay.addEventListener("click", function (event) {
            if (event.target === overlay) {
                controller.close();
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !overlay.hidden) {
                controller.close();
            }
        });
        startLink.addEventListener("click", function (event) {
            launchWithFallback(event, global.redirect);
        });

        return controller;
    }

    global.BBKPortal = {
        readStoredValue: readStoredValue,
        writeStoredValue: writeStoredValue,
        getSafeStorage: getSafeStorage,
        bindSettings: bindSettings,
        createDialogController: createDialogController,
        launchWithFallback: launchWithFallback,
        init: init,
    };

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", function () {
                init(global.document, getSafeStorage(global));
            });
        } else {
            init(global.document, getSafeStorage(global));
        }
    }
}(typeof window !== "undefined" ? window : globalThis));
