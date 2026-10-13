/**
 * @description The <strong>render.js</strong> module turns documents into PNG previews, final PNG
 * exports, sprite sheets, animated GIFs and DataPixels program code.
 * @module
 *
 */
import { createCanvas } from "@napi-rs/canvas";
import gifenc from "gifenc";
import { TRANSPARENT, flattenFrame, hexToRgb } from "./document.js";

export {

    autoScale,
    exportCode,
    renderFinal,
    renderGif,
    renderPreview,
    renderSheet,
    renderStrip
};

const { GIFEncoder } = gifenc;
const AUTO_TARGET = 512;
const RULER = 30;

/**
 * @description A scale that makes the longest side of the art about 512px (at least 1).
 * @public
 *
 */
function autoScale(doc, target = AUTO_TARGET) {

    return Math.max(1, Math.round(target / Math.max(doc.width, doc.height)));
}

function colorOf(doc, symbol) {

    const hex = doc.palette[symbol];

    if (!hex) throw new Error(`Symbol "${symbol}" is not in the palette.`);

    return hexToRgb(hex);
}

function checkSize(doc, scale) {

    if (doc.width * scale > 8192 || doc.height * scale > 8192) {

        throw new Error(`Output would be ${doc.width * scale}x${doc.height * scale}px; lower --scale (max side 8192).`);
    }
}

function drawFrame(context, doc, frameIndex, scale, ox = 0, oy = 0) {

    const flat = flattenFrame(doc, frameIndex);

    for (let y = 0; y < doc.height; y++) {

        for (let x = 0; x < doc.width; x++) {

            const symbol = flat[y][x];

            if (symbol === TRANSPARENT) continue;

            const [r, g, b] = colorOf(doc, symbol);

            context.fillStyle = `rgb(${r},${g},${b})`;
            context.fillRect(ox + x * scale, oy + y * scale, scale, scale);
        }
    }
}

function drawChecker(context, width, height, ox, oy, size = 8) {

    for (let y = 0; y < height; y += size) {

        for (let x = 0; x < width; x += size) {

            context.fillStyle = ((x / size + y / size) % 2 === 0) ? "#767676" : "#8a8a8a";
            context.fillRect(ox + x, oy + y, Math.min(size, width - x), Math.min(size, height - y));
        }
    }
}

function drawGrid(context, doc, scale, ox, oy) {

    if (scale < 4) return;

    for (let x = 0; x <= doc.width; x++) {

        context.fillStyle = (x % 8 === 0) ? "rgba(255,0,200,0.55)" : "rgba(0,0,0,0.28)";
        context.fillRect(ox + x * scale, oy, 1, doc.height * scale);
    }

    for (let y = 0; y <= doc.height; y++) {

        context.fillStyle = (y % 8 === 0) ? "rgba(255,0,200,0.55)" : "rgba(0,0,0,0.28)";
        context.fillRect(ox, oy + y * scale, doc.width * scale, 1);
    }
}

function drawRulers(context, doc, scale) {

    const step = [1, 2, 4, 5, 8, 10, 16].find((s) => s * scale >= 26) || 16;

    context.fillStyle = "#262626";
    context.fillRect(0, 0, RULER + doc.width * scale, RULER);
    context.fillRect(0, 0, RULER, RULER + doc.height * scale);
    context.fillStyle = "#cfcfcf";
    context.font = "11px sans-serif";
    context.textBaseline = "middle";
    context.textAlign = "center";

    for (let x = 0; x < doc.width; x += step) {

        context.fillText(String(x), RULER + x * scale + scale / 2, RULER / 2);
    }

    context.textAlign = "right";

    for (let y = 0; y < doc.height; y += step) {

        context.fillText(String(y), RULER - 6, RULER + y * scale + scale / 2);
    }
}

/**
 * @description Renders a frame for inspection: checkerboard behind transparency, optional pixel grid
 * (every 8th line highlighted), coordinate rulers so pixels can be addressed precisely, and optional
 * onion skin (the previous frame, faded) for animation work.
 * @param {Object} doc
 * @param {number} frameIndex
 * @param {Object} [options]
 * @param {number} [options.scale]
 * @param {boolean} [options.grid]
 * @param {boolean} [options.rulers]
 * @param {boolean} [options.onion] - Draw the previous frame (wrapping to the last one) at low opacity underneath.
 * @param {string} [options.bg] - "checker" (default), "none" or "#hex".
 * @returns {Object} Canvas.
 * @public
 *
 */
function renderPreview(doc, frameIndex, { scale = autoScale(doc), grid = false, rulers = false, onion = false, bg = "checker" } = {}) {

    checkSize(doc, scale);

    if (!doc.frames[frameIndex]) throw new Error(`Frame ${frameIndex} does not exist (document has ${doc.frames.length}).`);

    const margin = rulers ? RULER : 0;
    const canvas = createCanvas(doc.width * scale + margin, doc.height * scale + margin);
    const context = canvas.getContext("2d");

    context.imageSmoothingEnabled = false;

    if (bg === "checker") drawChecker(context, doc.width * scale, doc.height * scale, margin, margin);
    else if (bg !== "none") {

        const [r, g, b] = hexToRgb(bg);

        context.fillStyle = `rgb(${r},${g},${b})`;
        context.fillRect(margin, margin, doc.width * scale, doc.height * scale);
    }

    if (onion && doc.frames.length > 1) {

        context.globalAlpha = 0.3;
        drawFrame(context, doc, (frameIndex - 1 + doc.frames.length) % doc.frames.length, scale, margin, margin);
        context.globalAlpha = 1;
    }

    drawFrame(context, doc, frameIndex, scale, margin, margin);

    if (grid) drawGrid(context, doc, scale, margin, margin);
    if (rulers) drawRulers(context, doc, scale);

    return canvas;
}

/**
 * @description Frames side by side (wrapping after "columns") with index and duration labels, for
 * reviewing an animation.
 * @param {Object} doc
 * @param {Object} [options]
 * @param {number[]} [options.frames] - Frame indexes to show (default all).
 * @public
 *
 */
function renderStrip(doc, { scale, grid = false, bg = "checker", frames, columns = 8 } = {}) {

    const indexes = frames || doc.frames.map((frame, index) => index);
    const chosen = scale || Math.max(1, Math.min(autoScale(doc, 256), 16));
    const gap = 10;
    const label = 20;
    const cols = Math.max(1, Math.min(columns, indexes.length));
    const rows = Math.ceil(indexes.length / cols);
    const cellW = doc.width * chosen;
    const cellH = doc.height * chosen;
    const width = cols * cellW + (cols + 1) * gap;
    const height = rows * (cellH + label) + (rows + 1) * gap;

    if (width > 8192 || height > 8192) throw new Error("Frame strip would exceed 8192px; lower --scale.");

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    context.fillStyle = "#262626";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = "12px sans-serif";
    context.textBaseline = "middle";

    indexes.forEach((f, n) => {

        const x = gap + (n % cols) * (cellW + gap);
        const y = gap + Math.floor(n / cols) * (cellH + label + gap);

        context.drawImage(renderPreview(doc, f, { scale: chosen, grid, bg }), x, y + label);
        context.fillStyle = "#cfcfcf";
        context.fillText(`#${f}  ${doc.frames[f].duration}ms`, x, y + label / 2);
    });

    return canvas;
}

/**
 * @description Final, clean export of one frame (transparent background, nearest-neighbor scale),
 * rendered through the DataPixels class.
 * @returns {Object} Canvas.
 * @public
 *
 */
async function renderFinal(doc, frameIndex, scale) {

    checkSize(doc, scale);

    const { default: DataPixels } = await import("./DataPixels.js");
    const flat = flattenFrame(doc, frameIndex);

    if (flat.every((row) => row.every((symbol) => symbol === TRANSPARENT))) {

        // DataPixels needs at least one pixel; an empty frame is just transparent.
        return createCanvas(doc.width * scale, doc.height * scale);
    }

    const pixelData = flat.map((row) => row.map((symbol) => {

        if (symbol === TRANSPARENT) return "0, 0, 0, 0";

        const [r, g, b] = colorOf(doc, symbol);

        return `${r}, ${g}, ${b}, 255`;
    }));

    return new DataPixels(pixelData, scale).canvas;
}

/**
 * @description Sprite sheet PNG plus Aseprite-compatible JSON metadata ("array" format: frame rectangles,
 * durations and frameTags), which Phaser, Godot/Unity importers and most engines read.
 * @param {Object} doc
 * @param {Object} [options]
 * @param {number} [options.scale = 1]
 * @param {number} [options.cols] - Columns (default: all frames in one row).
 * @param {number[]} [options.frames] - Frame indexes to include (default all).
 * @returns {Promise<{canvas: Object, meta: Object}>}
 * @public
 *
 */
async function renderSheet(doc, { scale = 1, cols, frames } = {}) {

    const indexes = frames || doc.frames.map((frame, index) => index);
    const count = indexes.length;
    const columns = Math.max(1, Math.min(cols || count, count));
    const rows = Math.ceil(count / columns);
    const cellW = doc.width * scale;
    const cellH = doc.height * scale;

    if (cellW * columns > 8192 || cellH * rows > 8192) throw new Error("Sprite sheet would exceed 8192px; lower --scale or set --cols.");

    const canvas = createCanvas(cellW * columns, cellH * rows);
    const context = canvas.getContext("2d");
    const entries = [];

    for (let n = 0; n < count; n++) {

        const f = indexes[n];
        const x = (n % columns) * cellW;
        const y = Math.floor(n / columns) * cellH;

        context.drawImage(await renderFinal(doc, f, scale), x, y);
        entries.push({

            filename: `${doc.name} ${f}.png`,
            frame: { x, y, w: cellW, h: cellH },
            rotated: false,
            trimmed: false,
            spriteSourceSize: { x: 0, y: 0, w: cellW, h: cellH },
            sourceSize: { w: cellW, h: cellH },
            duration: doc.frames[f].duration
        });
    }

    // Tags are rebased onto the exported frames; tags that fall outside the selection are dropped.
    const position = new Map(indexes.map((f, n) => [f, n]));
    const frameTags = (doc.tags || [])
        .filter((tag) => position.has(tag.from) && position.has(tag.to))
        .map((tag) => ({ name: tag.name, from: position.get(tag.from), to: position.get(tag.to), direction: "forward" }));

    return {

        canvas,
        meta: {

            frames: entries,
            meta: {

                app: "Pixelod Skill",
                version: "1.0",
                image: "",
                format: "RGBA8888",
                size: { w: canvas.width, h: canvas.height },
                scale: String(scale),
                frameTags,
                columns,
                rows
            }
        }
    };
}

/**
 * @description Animated GIF (transparent background, loops forever).
 * @param {Object} doc
 * @param {Object} [options]
 * @param {number} [options.scale = 1]
 * @param {number[]} [options.frames] - Frame indexes to include (default all).
 * @returns {Buffer}
 * @public
 *
 */
function renderGif(doc, { scale = 1, frames } = {}) {

    checkSize(doc, scale);

    const indexes = frames || doc.frames.map((frame, index) => index);
    const symbols = Object.keys(doc.palette);

    if (symbols.length > 255) throw new Error("GIF supports at most 255 palette colors.");

    const palette = [[0, 0, 0], ...symbols.map((symbol) => colorOf(doc, symbol))];
    const indexOf = Object.fromEntries(symbols.map((symbol, i) => [symbol, i + 1]));
    const width = doc.width * scale;
    const height = doc.height * scale;
    const gif = GIFEncoder();

    indexes.forEach((f, n) => {

        const flat = flattenFrame(doc, f);
        const index = new Uint8Array(width * height);

        for (let y = 0; y < height; y++) {

            const row = flat[Math.floor(y / scale)];

            for (let x = 0; x < width; x++) {

                const symbol = row[Math.floor(x / scale)];

                index[y * width + x] = (symbol === TRANSPARENT) ? 0 : indexOf[symbol];
            }
        }

        gif.writeFrame(index, width, height, {

            palette: (n === 0) ? palette : undefined,
            delay: doc.frames[f].duration,
            transparent: true,
            transparentIndex: 0,
            dispose: 2,
            repeat: 0
        });
    });

    gif.finish();

    return Buffer.from(gif.bytes());
}

/**
 * @description DataPixels program for the document: palette constants plus the pixelData rows.
 * Documents with more than one frame get a frames array and a small player for browsers.
 * @param {Object} doc
 * @param {Object} options
 * @param {number} options.scale - pixelSize passed to DataPixels.
 * @param {number} [options.frame] - Export only this frame.
 * @returns {string}
 * @public
 *
 */
function exportCode(doc, { scale, frame } = {}) {

    const used = new Set();
    const frameIndexes = (frame !== undefined) ? [frame] : doc.frames.map((f, i) => i);

    frameIndexes.forEach((f) => flattenFrame(doc, f).forEach((row) => row.forEach((symbol) => used.add(symbol))));

    const names = { [TRANSPARENT]: "_" };
    const taken = new Set(["_"]);
    let extra = 0;

    for (const symbol of Object.keys(doc.palette)) {

        if (!used.has(symbol)) continue;

        let id = /^[A-Za-z]$/.test(symbol) ? symbol : `c${extra++}`;

        while (taken.has(id)) id = `c${extra++}`;

        taken.add(id);
        names[symbol] = id;
    }

    const width = Math.max(...Object.values(names).map((id) => id.length));
    const lines = [];

    lines.push(`/**\n * @description ${doc.name} (${doc.width}x${doc.height}${doc.frames.length > 1 ? `, ${frameIndexes.length} frames` : ""}), generated by Pixelod Skill\n */`);
    lines.push(`import DataPixels from "./DataPixels.js";\n`);
    lines.push(`const ${names[TRANSPARENT]} = "0, 0, 0, 0";`);

    for (const [symbol, id] of Object.entries(names)) {

        if (symbol === TRANSPARENT) continue;

        const [r, g, b] = hexToRgb(doc.palette[symbol]);

        lines.push(`const ${id} = "${r}, ${g}, ${b}";`.padEnd(30) + `//${doc.palette[symbol]}`);
    }

    const rowsOf = (f) => flattenFrame(doc, f).map((row) => "    [" + row.map((symbol) => names[symbol].padEnd(width)).join(", ") + "]").join(",\n");
    const durations = frameIndexes.map((f) => doc.frames[f].duration);

    lines.push("");

    if (frameIndexes.length === 1) {

        lines.push(`const pixelData = [\n${rowsOf(frameIndexes[0])}\n];\n`);
        lines.push(`const pixelSize = ${scale};\n`);
        lines.push(`const image = new DataPixels(pixelData, pixelSize).image;\n`);
        lines.push(`document.body.appendChild(image);`);
    }
    else {

        lines.push(`const frames = [\n${frameIndexes.map((f) => `  [\n${rowsOf(f)}\n  ]`).join(",\n")}\n];\n`);
        lines.push(`const durations = [${durations.join(", ")}];  //milliseconds per frame\n`);
        lines.push(`const pixelSize = ${scale};\n`);
        lines.push(`const images = frames.map((pixelData) => new DataPixels(pixelData, pixelSize).image);\n`);
        lines.push(`const player = document.createElement("img");`);
        lines.push(`player.src = images[0].src;`);
        lines.push(`document.body.appendChild(player);\n`);
        lines.push(`if (typeof window !== "undefined") {\n`);
        lines.push(`    let current = 0;\n`);
        lines.push(`    const next = () => {\n`);
        lines.push(`        current = (current + 1) % images.length;`);
        lines.push(`        player.src = images[current].src;`);
        lines.push(`        setTimeout(next, durations[current]);`);
        lines.push(`    };\n`);
        lines.push(`    setTimeout(next, durations[0]);`);
        lines.push(`}`);
    }

    return lines.join("\n") + "\n";
}
