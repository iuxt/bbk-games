import test from "node:test";
import assert from "node:assert/strict";

await import("../js/game-page.js");

const GamePage = globalThis.BBKGamePage;
const iPhoneSafari =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 " +
    "Mobile/15E148 Safari/604.1";

test("pull-to-refresh guard recognizes iPhone Safari", () => {
    assert.equal(GamePage.isIPhoneSafari({ userAgent: iPhoneSafari }), true);
});

test("pull-to-refresh guard ignores other iPhone browsers and desktop Safari", () => {
    assert.equal(
        GamePage.isIPhoneSafari({
            userAgent: iPhoneSafari.replace("Version/18.0", "CriOS/138.0")
        }),
        false
    );
    assert.equal(
        GamePage.isIPhoneSafari({
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
                "AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15"
        }),
        false
    );
});

test("guard blocks a page-top pull but keeps nested list scrolling", () => {
    const listeners = {};
    const root = {
        classList: { add() {} },
        scrollTop: 0
    };
    const body = {
        nodeType: 1,
        parentElement: root,
        scrollHeight: 600,
        clientHeight: 600,
        scrollTop: 0
    };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalScrollY = Object.getOwnPropertyDescriptor(globalThis, "scrollY");

    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: {
            body,
            documentElement: root,
            addEventListener(type, listener, options) {
                listeners[type] = { listener, options };
            }
        }
    });
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { userAgent: iPhoneSafari }
    });
    Object.defineProperty(globalThis, "scrollY", {
        configurable: true,
        value: 0
    });

    try {
        assert.equal(GamePage.installPullToRefreshGuard(), true);
        assert.equal(listeners.touchmove.options.passive, false);

        let prevented = false;
        listeners.touchstart.listener({ touches: [{ clientY: 100 }] });
        listeners.touchmove.listener({
            target: body,
            touches: [{ clientY: 120 }],
            preventDefault() { prevented = true; }
        });
        assert.equal(prevented, true);

        const list = {
            nodeType: 1,
            parentElement: body,
            scrollHeight: 500,
            clientHeight: 200,
            scrollTop: 20
        };
        prevented = false;
        listeners.touchstart.listener({ touches: [{ clientY: 100 }] });
        listeners.touchmove.listener({
            target: list,
            touches: [{ clientY: 120 }],
            preventDefault() { prevented = true; }
        });
        assert.equal(prevented, false);
    } finally {
        for (const [name, descriptor] of [
            ["document", originalDocument],
            ["navigator", originalNavigator],
            ["scrollY", originalScrollY]
        ]) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                delete globalThis[name];
            }
        }
    }
});
