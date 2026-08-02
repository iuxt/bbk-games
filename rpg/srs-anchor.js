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

        var best = null;

        // The impact point is the visual climax: the moment with the largest
        // combined drawable area. This preserves projectile movement, chooses
        // the endpoint when frames tie, and centers composite bursts as a group.
        for (var eventIndex = 0; eventIndex < records.length; eventIndex += 1) {
            var time = records[eventIndex].start;
            var score = 0;
            var left = Infinity;
            var top = Infinity;
            var right = -Infinity;
            var bottom = -Infinity;

            for (var recordIndex = 0;
                recordIndex < records.length;
                recordIndex += 1) {
                var record = records[recordIndex];
                if (record.start > time || record.end <= time) {
                    continue;
                }

                var x = record.frameHeader[0];
                var y = record.frameHeader[1];
                var width = record.image.width;
                var height = record.image.height;

                score += width * height;
                left = Math.min(left, x);
                top = Math.min(top, y);
                right = Math.max(right, x + width);
                bottom = Math.max(bottom, y + height);
            }

            if (score > 0 &&
                    (!best || score > best.score ||
                    (score === best.score && time >= best.time))) {
                best = {
                    score: score,
                    time: time,
                    x: (left + right) / 2 | 0,
                    y: (top + bottom) / 2 | 0,
                };
            }
        }

        return best ? { x: best.x, y: best.y } : { x: 0, y: 0 };
    }

    global.BBKSrsAnchor = {
        compute: compute,
        imageFor: imageFor,
    };
})(typeof window !== "undefined" ? window : globalThis);
