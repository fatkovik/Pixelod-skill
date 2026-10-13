/**
 * @description The <strong>importer.js</strong> module converts raster images (photos, drawings, existing
 * sprites) to pixel art documents: downscale to a grid, reduce the palette (median cut or a preset),
 * optionally dither.
 * @module
 *
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { SYMBOL_ALPHABET, TRANSPARENT, createDocument, hexToRgb, rgbToHex } from "./document.js";
import { PRESETS, luminance, nearestIndex } from "./palettes.js";

export {

    importImage
};

const ALPHA_THRESHOLD = 128;
const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const MAX_AUTO_COLORS = 64;
const AUTO_COLORS = 32;
const PRESHRINK = 8;

/**
 * @description Weighted median cut.
 * @param {Map<string, {rgb: number[], count: number}>} histogram
 * @param {number} target
 * @returns {number[][]} Palette colors.
 *
 */
function medianCut(histogram, target) {

    let boxes = [[...histogram.values()]];

    while (boxes.length < target) {

        let pick = -1;
        let channel = 0;
        let best = 0;

        boxes.forEach((box, index) => {

            if (box.length < 2) return;

            // Plain loops: spreading a big box into Math.max() overflows the call stack.
            const low = [255, 255, 255];
            const high = [0, 0, 0];
            let weight = 0;

            for (const item of box) {

                weight += item.count;

                for (let c = 0; c < 3; c++) {

                    if (item.rgb[c] < low[c]) low[c] = item.rgb[c];
                    if (item.rgb[c] > high[c]) high[c] = item.rgb[c];
                }
            }

            for (let c = 0; c < 3; c++) {

                const score = (high[c] - low[c]) * Math.sqrt(weight);

                if (score > best) {

                    best = score;
                    pick = index;
                    channel = c;
                }
            }
        });

        if (pick < 0) break;

        const box = boxes[pick].sort((a, b) => a.rgb[channel] - b.rgb[channel]);
        const total = box.reduce((sum, item) => sum + item.count, 0);
        let running = 0;
        let split = 1;

        for (let i = 0; i < box.length - 1; i++) {

            running += box[i].count;

            if (running >= total / 2) {

                split = i + 1;
                break;
            }

            split = i + 1;
        }

        boxes.splice(pick, 1, box.slice(0, split), box.slice(split));
    }

    return boxes.map((box) => {

        const total = box.reduce((sum, item) => sum + item.count, 0);
        const sum = box.reduce((acc, item) => acc.map((v, i) => v + item.rgb[i] * item.count), [0, 0, 0]);

        return sum.map((v) => Math.round(v / total));
    });
}

/**
 * @description Converts an image file to a document.
 * @param {string} filePath
 * @param {Object} options
 * @param {string} options.name - Document name.
 * @param {number} [options.grid = 48] - Output width in pixels.
 * @param {number} [options.gridHeight] - Output height; keeps aspect ratio when omitted.
 * @param {number} [options.colors] - Maximum colors (median cut).  Default: keep all up to 64, else 32.
 * @param {string} [options.palette] - Preset palette name to snap to instead.
 * @param {boolean} [options.dither] - Ordered (Bayer) dithering while mapping to the palette.
 * @param {string} [options.resample = "box"] - "box" (area average) or "nearest" (best for sources that already are pixel art).
 * @returns {Promise<Object>} The document.
 * @public
 *
 */
async function importImage(filePath, { name, grid = 48, gridHeight, colors, palette, dither = false, resample = "box" } = {}) {

    if (resample !== "box" && resample !== "nearest") throw new Error(`--resample must be box or nearest, got "${resample}".`);

    const image = await loadImage(filePath);
    const width = Math.max(1, Math.min(grid, image.width));
    const height = Math.max(1, Math.min(gridHeight || Math.round(width * image.height / image.width), image.height));

    // Box averaging only needs a few source pixels per cell: shrink big photos first (with smoothing) so a
    // 24 MP image is not decoded into a 100 MB pixel buffer.  Nearest sampling keeps the original pixels.
    const shrink = (resample === "box") ? Math.min(1, (width * PRESHRINK) / image.width, (height * PRESHRINK) / image.height) : 1;
    const sw = Math.max(width, Math.round(image.width * shrink));
    const sh = Math.max(height, Math.round(image.height * shrink));

    const canvas = createCanvas(sw, sh);
    const context = canvas.getContext("2d");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, sw, sh);

    const source = context.getImageData(0, 0, sw, sh).data;
    const cells = new Array(width * height);

    for (let y = 0; y < height; y++) {

        const y0 = Math.floor(y * sh / height);
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / height));

        for (let x = 0; x < width; x++) {

            const x0 = Math.floor(x * sw / width);
            const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / width));

            if (resample === "nearest") {

                const i = (Math.floor((y0 + y1 - 1) / 2) * sw + Math.floor((x0 + x1 - 1) / 2)) * 4;

                cells[y * width + x] = (source[i + 3] < ALPHA_THRESHOLD) ? null : [source[i], source[i + 1], source[i + 2]];

                continue;
            }

            let r = 0, g = 0, b = 0, a = 0;

            for (let sy = y0; sy < y1; sy++) {

                for (let sx = x0; sx < x1; sx++) {

                    const i = (sy * sw + sx) * 4;
                    const alpha = source[i + 3];

                    r += source[i] * alpha;
                    g += source[i + 1] * alpha;
                    b += source[i + 2] * alpha;
                    a += alpha;
                }
            }

            const count = (y1 - y0) * (x1 - x0);

            cells[y * width + x] = (a === 0 || a / count < ALPHA_THRESHOLD) ? null : [Math.round(r / a), Math.round(g / a), Math.round(b / a)];
        }
    }

    // Decide the target palette.
    const histogram = new Map();

    cells.forEach((cell) => {

        if (!cell) return;

        const key = cell.join(",");
        const entry = histogram.get(key);

        if (entry) entry.count++;
        else histogram.set(key, { rgb: cell, count: 1 });
    });

    let colorsOut;
    let exact = false;

    if (palette) {

        if (!PRESETS[palette.toLowerCase()]) throw new Error(`Unknown palette "${palette}".`);

        colorsOut = PRESETS[palette.toLowerCase()].colors.map((hex) => hexToRgb(hex));
    }
    else {

        const limit = colors || (histogram.size > MAX_AUTO_COLORS ? AUTO_COLORS : histogram.size);

        if (limit >= histogram.size) {

            colorsOut = [...histogram.values()].map((item) => item.rgb);
            exact = true;
        }
        else {

            colorsOut = medianCut(histogram, limit);
        }
    }

    if (colorsOut.length > SYMBOL_ALPHABET.length) {

        throw new Error(`Too many colors (${colorsOut.length}); pass --colors ${SYMBOL_ALPHABET.length} or fewer.`);
    }

    // Map every cell to the palette (with optional ordered dithering).
    const exactIndex = new Map(exact ? colorsOut.map((color, index) => [color.join(","), index]) : []);
    const nearest = new Map();
    const mapped = cells.map((cell, index) => {

        if (!cell) return -1;
        if (exact) return exactIndex.get(cell.join(","));

        let sample = cell;

        if (dither) {

            const x = index % width;
            const y = Math.floor(index / width);
            const offset = (BAYER_4[y % 4][x % 4] / 16 - 0.47) * 56;

            sample = cell.map((v) => Math.max(0, Math.min(255, Math.round(v + offset))));
        }

        // Many cells share a color: remember each nearest-color search.
        const key = sample.join(",");
        let found = nearest.get(key);

        if (found === undefined) {

            found = nearestIndex(sample, colorsOut);
            nearest.set(key, found);
        }

        return found;
    });

    // Keep only palette entries that are used, ordered dark -> light, with letter symbols.
    const usedIndexes = [...new Set(mapped.filter((i) => i >= 0))].sort((a, b) => luminance(colorsOut[a]) - luminance(colorsOut[b]));
    const symbolFor = new Map(usedIndexes.map((colorIndex, i) => [colorIndex, SYMBOL_ALPHABET[i]]));
    const documentPalette = {};

    usedIndexes.forEach((colorIndex) => { documentPalette[symbolFor.get(colorIndex)] = rgbToHex(colorsOut[colorIndex]); });

    const doc = createDocument({ name, width, height, palette: documentPalette });
    const target = doc.frames[0].layers[0].grid;

    mapped.forEach((colorIndex, index) => {

        target[Math.floor(index / width)][index % width] = (colorIndex < 0) ? TRANSPARENT : symbolFor.get(colorIndex);
    });

    return doc;
}
