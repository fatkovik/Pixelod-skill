/**
 * @description The <strong>lint.js</strong> module inspects a document and reports objective pixel art
 * quality problems, so they can be fixed without relying on eyeballing alone.
 * @module
 *
 */
import { TRANSPARENT, flattenFrame, hexToRgb } from "./document.js";
import { colorDistance, luminance } from "./palettes.js";

export {

    lintDocument,
    documentStats
};

const NEIGHBORS_8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const NEIGHBORS_4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];

function sample(list, limit = 8) {

    const shown = list.slice(0, limit).map(([x, y]) => `(${x},${y})`).join(" ");

    return list.length > limit ? `${shown} ... +${list.length - limit} more` : shown;
}

/**
 * @description Content statistics of one frame: color usage and bounding box.
 * @public
 *
 */
function documentStats(doc, frameIndex) {

    const flat = flattenFrame(doc, frameIndex);
    const counts = {};
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, filled = 0;

    flat.forEach((row, y) => row.forEach((symbol, x) => {

        if (symbol === TRANSPARENT) return;

        counts[symbol] = (counts[symbol] || 0) + 1;
        filled++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }));

    return {

        counts,
        filled,
        total: doc.width * doc.height,
        bbox: filled ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null
    };
}

/**
 * @description Lints every frame of the document.
 * @param {Object} doc
 * @param {Object} [options]
 * @param {number} [options.maxColors = 16] - Warn if the art uses more distinct colors.
 * @returns {{findings: Object[], stats: Object}} Findings are { level: "warn"|"info", code, frame, message }.
 * @public
 *
 */
function lintDocument(doc, { maxColors = 16 } = {}) {

    const findings = [];
    const add = (level, code, frame, message) => findings.push({ level, code, frame, message });
    const used = new Set();
    const bboxes = [];
    const flats = [];

    doc.frames.forEach((frame, f) => {

        const flat = flattenFrame(doc, f);
        const stats = documentStats(doc, f);

        flats.push(flat);
        bboxes.push(stats.bbox);
        Object.keys(stats.counts).forEach((symbol) => used.add(symbol));

        if (!stats.filled) {

            add("warn", "empty", f, "Frame has no visible pixels.");

            return;
        }

        // Lone pixels with no same-colored neighbor: usually stray mistakes (eyes/glints are fine).
        const orphans = [];

        for (let y = 0; y < doc.height; y++) {

            for (let x = 0; x < doc.width; x++) {

                const symbol = flat[y][x];

                if (symbol === TRANSPARENT) continue;

                const alone = NEIGHBORS_8.every(([ox, oy]) => {

                    const nx = x + ox;
                    const ny = y + oy;

                    return nx < 0 || ny < 0 || nx >= doc.width || ny >= doc.height || flat[ny][nx] !== symbol;
                });

                if (alone) orphans.push([x, y]);
            }
        }

        if (orphans.length) {

            // Grouped by color: a pair of "w" eye pixels is obviously intentional, scattered mid-tones are not.
            const byColor = new Map();

            orphans.forEach(([x, y]) => {

                const symbol = flat[y][x];

                if (!byColor.has(symbol)) byColor.set(symbol, []);

                byColor.get(symbol).push([x, y]);
            });

            const groups = [...byColor].map(([symbol, list]) => `"${symbol}" ${sample(list, 6)}`).join("; ");

            add(orphans.length > 3 ? "warn" : "info", "orphan", f, `${orphans.length} isolated pixel(s) with no same-color neighbor: ${groups}. Fine for eyes/glints/details, otherwise remove or connect.`);
        }

        // Transparent holes fully enclosed by the shape (often unintended gaps).
        const seen = Array.from({ length: doc.height }, () => Array(doc.width).fill(false));
        const stack = [];

        for (let x = 0; x < doc.width; x++) { stack.push([x, 0], [x, doc.height - 1]); }
        for (let y = 0; y < doc.height; y++) { stack.push([0, y], [doc.width - 1, y]); }

        while (stack.length) {

            const [x, y] = stack.pop();

            if (x < 0 || y < 0 || x >= doc.width || y >= doc.height || seen[y][x] || flat[y][x] !== TRANSPARENT) continue;

            seen[y][x] = true;
            NEIGHBORS_4.forEach(([ox, oy]) => stack.push([x + ox, y + oy]));
        }

        const holes = [];

        for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) if (flat[y][x] === TRANSPARENT && !seen[y][x]) holes.push([x, y]);

        if (holes.length) {

            add("info", "hole", f, `${holes.length} transparent pixel(s) enclosed by the shape: ${sample(holes)}. Intentional?`);
        }

        // Outline consistency: do boundary pixels share one dark color?
        const boundary = {};
        let boundaryCount = 0;

        for (let y = 0; y < doc.height; y++) {

            for (let x = 0; x < doc.width; x++) {

                const symbol = flat[y][x];

                if (symbol === TRANSPARENT) continue;

                const edge = NEIGHBORS_4.some(([ox, oy]) => {

                    const nx = x + ox;
                    const ny = y + oy;

                    return nx < 0 || ny < 0 || nx >= doc.width || ny >= doc.height || flat[ny][nx] === TRANSPARENT;
                });

                if (edge) {

                    boundary[symbol] = (boundary[symbol] || 0) + 1;
                    boundaryCount++;
                }
            }
        }

        const [topSymbol, topCount] = Object.entries(boundary).sort((a, b) => b[1] - a[1])[0];

        if (topCount / boundaryCount < 0.6) {

            add("info", "outline", f, `No dominant outline color (most common edge color "${topSymbol}" covers ${Math.round(100 * topCount / boundaryCount)}% of the silhouette edge). Fine for selective/colored outlines; otherwise add one with "outline".`);
        }

        // Content touching the canvas edge.
        const { bbox } = stats;

        if (bbox.x === 0 || bbox.y === 0 || bbox.x + bbox.w === doc.width || bbox.y + bbox.h === doc.height) {

            add("info", "edge", f, `Art touches the canvas edge (bounding box x=${bbox.x} y=${bbox.y} w=${bbox.w} h=${bbox.h} in ${doc.width}x${doc.height}).`);
        }
    });

    // Palette checks.
    if (used.size > maxColors) {

        add("warn", "palette-size", null, `${used.size} colors used (limit ${maxColors}). Consider "palette remap" or merging near-identical colors.`);
    }

    const unused = Object.keys(doc.palette).filter((symbol) => !used.has(symbol));

    if (unused.length) {

        add("info", "unused-colors", null, `Unused palette entries: ${unused.join("")}.`);
    }

    const usedList = [...used];

    for (let i = 0; i < usedList.length; i++) {

        for (let j = i + 1; j < usedList.length; j++) {

            const distance = colorDistance(hexToRgb(doc.palette[usedList[i]]), hexToRgb(doc.palette[usedList[j]]));

            if (distance < 600) {

                add("info", "near-colors", null, `Colors "${usedList[i]}" (${doc.palette[usedList[i]]}) and "${usedList[j]}" (${doc.palette[usedList[j]]}) are almost identical; merge them or make the shading step clearer.`);
            }
        }
    }

    if (usedList.length > 1) {

        const values = usedList.map((symbol) => luminance(hexToRgb(doc.palette[symbol])));
        const range = Math.max(...values) - Math.min(...values);

        if (range < 90) {

            add("warn", "low-contrast", null, `Brightness range is narrow (${Math.round(range)}/255). Use a darker shadow and a lighter highlight so the form reads.`);
        }
    }

    // Animation checks.
    const bottoms = bboxes.map((bbox) => (bbox ? bbox.y + bbox.h - 1 : null)).filter((value) => value !== null);

    if (doc.frames.length > 1 && bottoms.length > 1 && Math.max(...bottoms) !== Math.min(...bottoms)) {

        add("info", "baseline", null, `The lowest pixel row changes between frames (${bottoms.join(", ")}). Feet/ground contact usually stays fixed unless the character jumps.`);
    }

    for (let f = 1; f < doc.frames.length; f++) {

        const same = flats[f].every((row, y) => row.every((symbol, x) => symbol === flats[f - 1][y][x]));

        if (same) {

            add("warn", "duplicate-frame", f, `Frame ${f} is identical to frame ${f - 1}.`);
        }
        else if (bboxes[f] && bboxes[f - 1]) {

            const jump = Math.max(Math.abs(bboxes[f].w - bboxes[f - 1].w), Math.abs(bboxes[f].h - bboxes[f - 1].h));

            if (jump > Math.max(4, doc.width / 4)) {

                add("info", "size-jump", f, `Silhouette size changes by ${jump}px between frame ${f - 1} and ${f}; check for popping.`);
            }
        }
    }

    return {

        findings,
        stats: { colors: used.size, frames: doc.frames.length, size: `${doc.width}x${doc.height}` }
    };
}
