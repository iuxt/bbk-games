(function (global) {
    "use strict";

    function imageFor(frameHeader, images) {
        if (!frameHeader || !images) {
            return null;
        }

        var imageIndex = frameHeader[4];
        if (imageIndex < 0 || imageIndex >= images.length) {
            return null;
        }

        return images[imageIndex] || null;
    }

    function addRecord(records, frameHeader, images, index, start) {
        var image = imageFor(frameHeader, images);
        var show = frameHeader[2];

        if (!image || show <= 0 || image.width <= 0 || image.height <= 0) {
            return;
        }

        records.push({
            index: index,
            start: start,
            end: start + show,
            frameHeader: frameHeader,
            image: image,
        });
    }

    function compute(frameHeaders, images) {
        if (!frameHeaders || !images || frameHeaders.length === 0) {
            return { x: 0, y: 0 };
        }

        var records = [];
        var start = 0;

        for (var i = 0; i < frameHeaders.length; i += 1) {
            var frameHeader = frameHeaders[i];
            if (!frameHeader) {
                break;
            }

            if (i > 0) {
                var previous = frameHeaders[i - 1];
                var previousShow = previous[2];
                var nextShow = previous[3];

                // ResSrs.update only creates the next key while the previous
                // key is still alive and its nshow counter reaches zero.
                if (nextShow <= 0 || nextShow > previousShow) {
                    break;
                }
                start += nextShow;
            }

            addRecord(records, frameHeader, images, i, start);
        }

        // Damaged ROMs can contain an invalid first chain but valid drawable
        // records later. Keep a stable fallback instead of failing to load.
        if (records.length === 0) {
            for (var fallbackIndex = 0;
                fallbackIndex < frameHeaders.length;
                fallbackIndex += 1) {
                var fallbackHeader = frameHeaders[fallbackIndex];
                var fallbackImage = imageFor(fallbackHeader, images);
                if (fallbackImage && fallbackHeader[2] > 0) {
                    return {
                        x: fallbackHeader[0] + (fallbackImage.width / 2 | 0),
                        y: fallbackHeader[1] + (fallbackImage.height / 2 | 0),
                    };
                }
            }
            return { x: 0, y: 0 };
        }

        // The impact point is the area-weighted visual centre of every visible
        // frame: each frame contributes its own bounding-box centre, scaled by
        // how much screen area it occupies. Localised bursts stay put, while
        // projectiles and travelling waves settle on the middle of their
        // dominant body so drawAtTarget lands the effect on the target instead
        // of the raw ROM position (which sits over the player party).
        var sumX = 0;
        var sumY = 0;
        var totalArea = 0;

        for (var recordIndex = 0;
            recordIndex < records.length;
            recordIndex += 1) {
            var record = records[recordIndex];
            var width = record.image.width;
            var height = record.image.height;
            var area = width * height;

            sumX += (record.frameHeader[0] + (width / 2 | 0)) * area;
            sumY += (record.frameHeader[1] + (height / 2 | 0)) * area;
            totalArea += area;
        }

        return totalArea > 0
            ? { x: sumX / totalArea | 0, y: sumY / totalArea | 0 }
            : { x: 0, y: 0 };
    }

    // Geometric centre of a combat formation (Monster$Companion.arr_0 for the
    // enemy side, Combat$Companion.sPlayerPos for the player side). Unlike
    // averaging the *living* targets' positions, this stays put as combatants
    // die: an all-target spell still lands mid-formation whether one or three
    // foes remain. `slots` may be [x,y] arrays (Int32Array) or {x,y} points.
    // The sprite-size adjustment mirrors Monster.setOriginalCombatPos so the
    // anchor lands mid-body; with the full formation alive it is pixel-identical
    // to the old living-centroid, so nothing changes at 3-vs-3.
    function formationCenter(slots, width, height) {
        if (!slots || slots.length === 0) {
            return { x: 0, y: 0 };
        }

        var sumX = 0;
        var sumY = 0;

        for (var i = 0; i < slots.length; i += 1) {
            var slot = slots[i];
            var baseX = (slot && typeof slot.x === "number") ? slot.x : slot[0];
            var baseY = (slot && typeof slot.y === "number") ? slot.y : slot[1];

            sumX += baseX - (width / 6 | 0) + (width / 2 | 0);
            sumY += baseY - (height / 10 | 0) + (height / 2 | 0);
        }

        return {
            x: (sumX / slots.length) | 0,
            y: (sumY / slots.length) | 0,
        };
    }

    global.BBKSrsAnchor = {
        compute: compute,
        imageFor: imageFor,
        formationCenter: formationCenter,
    };
})(typeof window !== "undefined" ? window : globalThis);
