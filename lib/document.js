/**
 * @description The <strong>document.js</strong> module defines the editable pixel art document
 * (".pixel.json") and its in-memory helpers.
 *
 * File format (version 1):
 *
 *     {
 *         "version": 1,
 *         "name": "knight",
 *         "width": 32,
 *         "height": 32,
 *         "palette": { "k": "#1a1c2c", "s": "#e8b796" },      // one character per color, "." is transparent
 *         "frames": [
 *             {
 *                 "duration": 100,                              // milliseconds
 *                 "layers": [
 *                     { "name": "main", "visible": true, "rows": ["....kk....", "..."] }
 *                 ]
 *             }
 *         ]
 *     }
 *
 * In memory every layer carries a "grid" (array of arrays of single characters) instead of "rows".
 * @module
 *
 */
import fs from "node:fs";
import path from "node:path";

export {

    TRANSPARENT,
    SYMBOL_ALPHABET,
    EXTENSION,
    cloneFrame,
    createDocument,
    emptyGrid,
    findLayer,
    flattenFrame,
    hexToRgb,
    loadDocument,
    normalizeHex,
    resolveDocumentPath,
    rgbToHex,
    saveDocument,
    tagFrames,
    validateSymbol
};

const TRANSPARENT = ".";
const EXTENSION = ".pixel.json";
const DEFAULT_DURATION = 100;

/**
 * @description Characters handed out to colors that do not have a chosen symbol.  Letters first, so that
 * the generated pixel rows stay readable.  "." (transparent) and "#" (comment) are never used.
 *
 */
const SYMBOL_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@$%&*+=-:;?!~^<>/|_(){}[]";

/**
 * @description Checks that a palette symbol is a single usable character.
 * @param {string} symbol
 * @returns {string} The symbol.
 * @public
 *
 */
function validateSymbol(symbol) {

    if (typeof symbol !== "string" || [...symbol].length !== 1 || /\s/.test(symbol)) {

        throw new Error(`Palette symbol must be a single non-space character, got "${symbol}".`);
    }

    if (symbol === TRANSPARENT || symbol === "#" || symbol === "\"" || symbol === "\\") {

        throw new Error(`Palette symbol "${symbol}" is reserved.`);
    }

    return symbol;
}

/**
 * @description Normalizes "#abc" / "abc" / "#AABBCC" to "#aabbcc".
 * @param {string} value
 * @returns {string}
 * @public
 *
 */
function normalizeHex(value) {

    let hex = String(value).trim().replace(/^#/, "").toLowerCase();

    if (/^[0-9a-f]{3}$/.test(hex)) {

        hex = hex.split("").map((c) => c + c).join("");
    }

    if (!/^[0-9a-f]{6}$/.test(hex)) {

        throw new Error(`Invalid color "${value}". Use #rgb or #rrggbb.`);
    }

    return `#${hex}`;
}

function hexToRgb(hex) {

    const value = normalizeHex(hex).slice(1);

    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]) {

    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function emptyGrid(width, height) {

    return Array.from({ length: height }, () => Array(width).fill(TRANSPARENT));
}

function createLayer(name, width, height) {

    return { name, visible: true, grid: emptyGrid(width, height) };
}

/**
 * @description Creates a new, empty document.
 * @param {Object} options
 * @param {string} options.name
 * @param {number} options.width
 * @param {number} options.height
 * @param {Object} [options.palette] - Map of symbol -> "#rrggbb".
 * @param {number} [options.frames = 1]
 * @returns {Object} The document.
 * @public
 *
 */
function createDocument({ name, width, height, palette = {}, frames = 1 }) {

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {

        throw new Error(`Invalid size ${width}x${height}.`);
    }

    if (width > 1024 || height > 1024) {

        throw new Error("Maximum canvas size is 1024x1024.");
    }

    const normalized = {};

    for (const [symbol, color] of Object.entries(palette)) {

        normalized[validateSymbol(symbol)] = normalizeHex(color);
    }

    return {

        version: 1,
        name,
        width,
        height,
        palette: normalized,
        tags: [],
        frames: Array.from({ length: Math.max(1, frames) }, () => ({

            duration: DEFAULT_DURATION,
            layers: [createLayer("main", width, height)]
        }))
    };
}

function cloneFrame(frame) {

    return {

        duration: frame.duration,
        layers: frame.layers.map((layer) => ({

            name: layer.name,
            visible: layer.visible,
            grid: layer.grid.map((row) => row.slice())
        }))
    };
}

function findLayer(frame, name) {

    return frame.layers.find((layer) => layer.name === name);
}

/**
 * @description Composites the visible layers of a frame into one grid of symbols.
 * @param {Object} doc
 * @param {number} frameIndex
 * @returns {string[][]}
 * @public
 *
 */
function flattenFrame(doc, frameIndex) {

    const frame = doc.frames[frameIndex];

    if (!frame) {

        throw new Error(`Frame ${frameIndex} does not exist (document has ${doc.frames.length}).`);
    }

    const out = emptyGrid(doc.width, doc.height);

    for (const layer of frame.layers) {

        if (!layer.visible) continue;

        for (let y = 0; y < doc.height; y++) {

            for (let x = 0; x < doc.width; x++) {

                const symbol = layer.grid[y][x];

                if (symbol !== TRANSPARENT) out[y][x] = symbol;
            }
        }
    }

    return out;
}

/**
 * @description Resolves a document argument to a file path.  A bare name lives in its own project folder
 * inside the working directory (the --dir option, $PIXELART_DIR, or the output folder next to pixelart.js):
 * <workDir>/<name>/<name>.pixel.json, next to its script, preview and strip.  A document saved flat in the
 * working directory by an older version is still found.
 * @public
 *
 */
function resolveDocumentPath(nameOrPath, workDir) {

    const asGiven = path.resolve(nameOrPath);

    if (nameOrPath.endsWith(EXTENSION) || (fs.existsSync(asGiven) && fs.statSync(asGiven).isFile())) {

        return asGiven;
    }

    const nested = path.join(workDir, nameOrPath, `${path.basename(nameOrPath)}${EXTENSION}`);
    const flat = path.join(workDir, `${nameOrPath}${EXTENSION}`);

    return (!fs.existsSync(nested) && fs.existsSync(flat)) ? flat : nested;
}

/**
 * @description Frame indexes of a named animation tag, or of all frames when no tag is given.
 * @param {Object} doc
 * @param {string} [tagName]
 * @returns {number[]}
 * @public
 *
 */
function tagFrames(doc, tagName) {

    if (!tagName) return doc.frames.map((frame, index) => index);

    const tag = (doc.tags || []).find((candidate) => candidate.name === tagName);

    if (!tag) {

        const names = (doc.tags || []).map((candidate) => candidate.name).join(", ") || "none";

        throw new Error(`No tag named "${tagName}" (tags: ${names}). Create one with the draw command "tag ${tagName} <from> <to>".`);
    }

    return Array.from({ length: tag.to - tag.from + 1 }, (value, index) => tag.from + index);
}

function saveDocument(doc, filePath) {

    const frames = doc.frames.map((frame) => ({

        duration: frame.duration,
        layers: frame.layers.map((layer) => ({

            name: layer.name,
            visible: layer.visible,
            rows: layer.grid.map((row) => row.join(""))
        }))
    }));

    const body = {

        version: doc.version,
        name: doc.name,
        width: doc.width,
        height: doc.height,
        palette: doc.palette,
        tags: doc.tags || [],
        ...(doc.source ? { source: doc.source } : {}),
        frames
    };

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    // One row per line keeps the file readable and the diffs small.
    const text = JSON.stringify(body, null, 2).replace(/\[\s+("[^"\]]*"(?:,\s+"[^"\]]*")*)\s+\]/g, (match, inner) => {

        return "[\n" + inner.split(/,\s+/).map((item) => `            ${item}`).join(",\n") + "\n          ]";
    });

    fs.writeFileSync(filePath, text + "\n");
}

function loadDocument(filePath) {

    if (!fs.existsSync(filePath)) {

        throw new Error(`Document not found: ${filePath}`);
    }

    let raw;

    try {

        raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    catch (error) {

        throw new Error(`${filePath} is not a pixel art document (${EXTENSION} JSON). To turn an image into one, use: import <image>`);
    }

    if (raw.version !== 1) {

        throw new Error(`Unsupported document version ${raw.version}.`);
    }

    const { width, height } = raw;

    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {

        throw new Error(`${filePath}: invalid size ${width}x${height}.`);
    }

    if (!Array.isArray(raw.frames) || !raw.frames.length) {

        throw new Error(`${filePath}: document has no frames.`);
    }

    const layerNames = (frame) => frame.layers.map((layer) => layer.name).join("|");

    if (raw.frames.some((frame) => layerNames(frame) !== layerNames(raw.frames[0]))) {

        throw new Error(`${filePath}: every frame must have the same layers in the same order.`);
    }

    const tags = Array.isArray(raw.tags) ? raw.tags : [];

    for (const tag of tags) {

        if (!(Number.isInteger(tag.from) && Number.isInteger(tag.to) && tag.from >= 0 && tag.to >= tag.from && tag.to < raw.frames.length)) {

            throw new Error(`${filePath}: tag "${tag.name}" has an invalid frame range ${tag.from}..${tag.to}.`);
        }
    }

    const doc = {

        version: 1,
        name: raw.name || path.basename(filePath).replace(EXTENSION, ""),
        width,
        height,
        palette: raw.palette || {},
        tags,
        ...(raw.source ? { source: raw.source } : {}),
        frames: raw.frames.map((frame, f) => ({

            duration: frame.duration ?? DEFAULT_DURATION,
            layers: frame.layers.map((layer) => {

                if (layer.rows.length !== height) {

                    throw new Error(`Frame ${f}, layer "${layer.name}": expected ${height} rows, found ${layer.rows.length}.`);
                }

                const grid = layer.rows.map((row, y) => {

                    const cells = [...row];

                    if (cells.length !== width) {

                        throw new Error(`Frame ${f}, layer "${layer.name}", row ${y}: expected ${width} pixels, found ${cells.length}.`);
                    }

                    return cells;
                });

                return { name: layer.name, visible: layer.visible !== false, grid };
            })
        }))
    };

    for (const symbol of Object.keys(doc.palette)) validateSymbol(symbol);

    return doc;
}
