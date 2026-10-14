(function () {
    "use strict";

    var dialog = document.getElementById("about");
    var opener = document.getElementById("about-open");
    var tablist = document.querySelector(".about-tabs");
    var tabs = Array.from(tablist.querySelectorAll(".about-tab"));
    var panels = tabs.map(function (tab) {
        return document.getElementById(tab.hash.slice(1));
    });

    // 无脚本时两个内容区都可阅读；加载后再启用完整的 Tab 语义。
    tablist.setAttribute("role", "tablist");
    tabs.forEach(function (tab, index) {
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", panels[index].id);
        panels[index].setAttribute("role", "tabpanel");
        panels[index].setAttribute("aria-labelledby", tab.id);
        panels[index].tabIndex = 0;
    });

    function selectTab(index) {
        tabs.forEach(function (tab, i) {
            var selected = i === index;
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            panels[i].hidden = !selected;
        });
    }

    function selectFromHash() {
        var index = tabs.findIndex(function (tab) { return tab.hash === location.hash; });
        selectTab(index < 0 ? 0 : index);
    }

    function activateTab(index) {
        if (!dialog && location.hash !== tabs[index].hash) {
            history.pushState(null, "", tabs[index].hash);
        }
        selectTab(index);
    }

    tabs.forEach(function (tab, index) {
        tab.addEventListener("click", function (event) {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            activateTab(index);
        });
        tab.addEventListener("keydown", function (event) {
            var next;
            if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
            else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = tabs.length - 1;
            else if (event.key === " ") next = index;
            else return;
            event.preventDefault();
            activateTab(next);
            tabs[next].focus();
        });
    });

    if (dialog && opener) {
        opener.addEventListener("click", function () {
            selectTab(0);
            dialog.showModal();
            dialog.scrollTop = 0;
        });
        dialog.addEventListener("click", function (event) {
            if (event.target !== dialog) return;
            var bounds = dialog.getBoundingClientRect();
            if (event.clientX < bounds.left || event.clientX > bounds.right ||
                event.clientY < bounds.top || event.clientY > bounds.bottom) {
                dialog.close();
            }
        });
        dialog.addEventListener("close", function () { opener.focus(); });
        selectTab(0);
    } else {
        window.addEventListener("hashchange", selectFromHash);
        window.addEventListener("popstate", selectFromHash);
        selectFromHash();
    }
})();
