/**
 * @description The <strong>ops.js</strong> module is the drawing/editing engine.  It executes a small
 * line based script ("DSL") against a document.  Every `draw`/`edit` CLI call is a script.
 *
 * Run `node pixelart.js help ops` for the command reference (generated from HELP below).
 * @module
 *
 */
import {

    TRANSPARENT,
    cloneFrame,
    emptyGrid,
    findLayer,
    flattenFrame,
    hexToRgb,
    normalizeHex,
    validateSymbol
} from "./document.js";
import { makeRamp, nearestIndex, paletteFromPreset } from "./palettes.js";

export {

    HELP,
    runScript,
    validateDocument
};

const BAYER_4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const MAX_COORDINATE = 4096;

const HELP = `Coordinates are 0-based; x grows right, y grows down. Colors are palette symbols ("." = transparent/erase).
Comments: lines starting with # or //, and anything after " # " or " // " on a line. Shapes are clipped to the canvas.

DRAW (current frame + layer)
  px x y c                     one pixel
  line x0 y0 x1 y1 c           1px line (Bresenham)
  rect x y w h c               filled rectangle         box x y w h c     outline rectangle
  ellipse x y w h c            filled ellipse in bbox   ring x y w h c    outline ellipse in bbox
  poly c x1 y1 x2 y2 ...       filled polygon (3+ points); each point is a pixel that is part of the outline
  lines c x1 y1 x2 y2 ...      connected 1px lines (open polyline)
  fill x y c                   flood fill (4-connected) from x,y
  put x y                      stamp rows below (overwrites, "." erases), ends with a line: end
  blit x y                     same but "." leaves the canvas untouched
  clear [x y w h]             erase whole layer or a region
  copy x y w h tx ty           copy a region of the layer to tx,ty
  move x y w h dx dy           move a region of the layer by dx,dy (animation: nudge a limb)
  replace a b [x y w h]        swap one symbol for another on this layer (optionally only inside a region)
  mirror left|right|top|bottom copy that half onto the opposite half, mirrored (symmetry)
  outline c [4|8] [all]        surround the layer's shapes with color c (default 4-connected);
                               "all" traces the silhouette of all visible layers, drawing on this layer
  dither x y w h a b [checker|rows|cols|bayer N]   two color pattern fill (bayer density N=0..16)
  shift dx dy [wrap]           move the layer's pixels

  flip h|v layer               mirror only the current layer of the current frame

WHOLE DOCUMENT (all frames and layers)
  flip h|v      rotate 90|180|270 (clockwise)      crop x y w h
  canvas w h [tl|t|tr|l|c|r|bl|b|br]   resize canvas without scaling (anchor default tl)
  scale n       integer nearest-neighbor upscale (1-8)
  recolor a b   change every a pixel to b

PALETTE
  palette add c #hex          palette set c #hex          palette del c
  palette load <preset>       replace palette with a preset (pico8 sweetie16 db16 endesga32 gameboy mono)
  palette remap <preset>      snap every color in the art to the preset and use its symbols
  palette ramp #base symbols  add a hue-shifted shading ramp, darkest -> lightest, e.g.  palette ramp #c0392b abcd

LAYERS / FRAMES
  layer <name>                select the layer (created on top in every frame if missing)
  layer hide|show|del <name>
  frame <n>                   select frame n (0-based)
  frame add [copy]            append a frame (copy of the current one with "copy") and select it
  frames <n> [copy]           make sure there are n frames; extra ones are empty or copies of current
  frame del [n]               delete frame n (default current)
  frame dur [all|n] <ms>      frame duration in milliseconds (current frame, all frames, or frame n)
  tag <name> <from> <to>      name a frame range as one animation (idle 0 3, walk 4 9); tag del <name>
                              export/render take --tag <name>; sprite sheets list all tags
`;

/**
 * @description Runs a script against a document (mutating it).
 * @param {Object} doc - The document.
 * @param {string} text - The script.
 * @param {Object} [start] - Starting context: { frame, layer }.
 * @returns {{commands: number}} Execution summary.
 * @public
 *
 */
function runScript(doc, text, start = {}) {

    const context = {

        frame: start.frame ?? 0,
        layer: start.layer ?? doc.frames[0].layers[0].name
    };

    const lines = text.split(/\r?\n/);
    let commands = 0;

    for (let i = 0; i < lines.length; i++) {

        const line = lines[i].trim();

        if (!line || line.startsWith("#") || line.startsWith("//")) continue;

        const tokens = stripComment(line.split(/\s+/));
        const name = tokens[0].toLowerCase();
        const args = tokens.slice(1);
        const lineNumber = i + 1;

        try {

            if (name === "put" || name === "blit") {

                const rows = [];

                for (i++; i < lines.length && lines[i].trim().toLowerCase() !== "end"; i++) {

                    rows.push({ text: lines[i].trim(), line: i + 1 });
                }

                if (i >= lines.length) throw new Error(`"${name}" block is missing its "end" line.`);

                stamp(doc, context, args, rows, name === "put");
            }
            else {

                const command = COMMANDS[name];

                if (!command) throw new Error(`Unknown command "${name}". Run "node pixelart.js help ops".`);

                command(doc, context, args);
            }

            commands++;
        }
        catch (error) {

            throw new Error(`Line ${lineNumber} "${line}": ${error.message}`);
        }
    }

    validateDocument(doc);

    return { commands };
}

/**
 * @description Drops a trailing comment: everything from a token that is "#", starts with "//", or starts
 * with "#" without being a hex color.
 *
 */
function stripComment(tokens) {

    const index = tokens.findIndex((token, i) => i > 0 && (token === "#" || token.startsWith("//") || (token.startsWith("#") && !HEX_COLOR.test(token))));

    return (index < 0) ? tokens : tokens.slice(0, index);
}

/**
 * @description Throws if any pixel uses a symbol that is not in the palette.
 * @public
 *
 */
function validateDocument(doc) {

    const unknown = new Map();

    doc.frames.forEach((frame, f) => frame.layers.forEach((layer) => layer.grid.forEach((row, y) => row.forEach((symbol, x) => {

        if (symbol !== TRANSPARENT && !(symbol in doc.palette) && !unknown.has(symbol)) {

            unknown.set(symbol, `frame ${f}, layer "${layer.name}", x=${x}, y=${y}`);
        }
    }))));

    if (unknown.size) {

        const list = [...unknown].map(([symbol, where]) => `"${symbol}" (first at ${where})`).join(", ");

        throw new Error(`Pixels use symbols that are not in the palette: ${list}. Add them with "palette add".`);
    }
}

// ---------------------------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------------------------

function int(token, label) {

    if (token === undefined || !/^-?\d+$/.test(token)) {

        throw new Error(`Expected an integer for ${label}, got "${token ?? ""}".`);
    }

    const value = parseInt(token, 10);

    if (Math.abs(value) > MAX_COORDINATE) throw new Error(`${label} ${value} is out of range (-${MAX_COORDINATE}..${MAX_COORDINATE}).`);

    return value;
}

/**
 * @description Intersects a rectangle with the canvas; returns [x0, y0, x1, y1) or null when empty.
 *
 */
function clip(doc, x, y, w, h) {

    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(doc.width, x + w);
    const y1 = Math.min(doc.height, y + h);

    return (x0 < x1 && y0 < y1) ? [x0, y0, x1, y1] : null;
}

function rectArgs(args) {

    return args.slice(0, 4).map((v, i) => int(v, ["x", "y", "w", "h"][i]));
}

function need(args, count, usage) {

    if (args.length < count) throw new Error(`Usage: ${usage}`);
}

function color(doc, token, label = "color") {

    if (token === undefined) throw new Error(`Missing ${label}.`);

    if (token !== TRANSPARENT && !(token in doc.palette)) {

        throw new Error(`Unknown ${label} "${token}". Palette: ${Object.keys(doc.palette).join("") || "(empty)"}`);
    }

    return token;
}

function layerOf(doc, context) {

    const frame = doc.frames[context.frame];
    const layer = findLayer(frame, context.layer);

    if (!layer) throw new Error(`Layer "${context.layer}" does not exist in frame ${context.frame}.`);

    return layer.grid;
}

function set(doc, grid, x, y, c) {

    if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) grid[y][x] = c;
}

function eachLayer(doc, fn) {

    doc.frames.forEach((frame) => frame.layers.forEach((layer) => {

        layer.grid = fn(layer.grid);
    }));
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

function drawLine(doc, grid, x0, y0, x1, y1, c) {

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;

    for (;;) {

        set(doc, grid, x0, y0, c);

        if (x0 === x1 && y0 === y1) break;

        const e2 = 2 * error;

        if (e2 >= dy) { error += dy; x0 += sx; }
        if (e2 <= dx) { error += dx; y0 += sy; }
    }
}

/**
 * @description Whether cell (i, j) of a w x h bounding box lies inside the inscribed ellipse.
 *
 */
function insideEllipse(i, j, w, h) {

    if (i < 0 || j < 0 || i >= w || j >= h) return false;

    const nx = (i + 0.5 - w / 2) / (w / 2);
    const ny = (j + 0.5 - h / 2) / (h / 2);

    return nx * nx + ny * ny <= 1;
}

/**
 * @description Calls fn(i, j) for every bounding box cell that is on the canvas (i, j relative to x, y).
 *
 */
function eachVisibleCell(doc, x, y, w, h, fn) {

    const area = clip(doc, x, y, w, h);

    if (!area) return;

    const [x0, y0, x1, y1] = area;

    for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) fn(gx - x, gy - y, gx, gy);
}

function fillPolygon(doc, grid, points, c) {

    const ys = points.map((p) => p[1]);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // Vertices are pixel coordinates (a vertex "x y" is the pixel at x,y), the same convention as the
    // Bresenham edges drawn below, so fill and edges meet without gaps.
    for (let y = minY; y <= maxY; y++) {

        const yc = y;
        const crossings = [];

        for (let i = 0; i < points.length; i++) {

            const [ax, ay] = points[i];
            const [bx, by] = points[(i + 1) % points.length];

            if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {

                crossings.push(ax + (yc - ay) * (bx - ax) / (by - ay));
            }
        }

        crossings.sort((a, b) => a - b);

        for (let k = 0; k + 1 < crossings.length; k += 2) {

            const from = Math.ceil(crossings[k] - 1e-9);
            const to = Math.floor(crossings[k + 1] + 1e-9);

            for (let x = from; x <= to; x++) set(doc, grid, x, y, c);
        }
    }

    // Make sure thin shapes keep their edges.
    for (let i = 0; i < points.length; i++) {

        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];

        drawLine(doc, grid, ax, ay, bx, by, c);
    }
}

function stamp(doc, context, args, rows, overwrite) {

    need(args, 2, `${overwrite ? "put" : "blit"} x y   (then rows, then a line "end")`);

    const grid = layerOf(doc, context);
    const x0 = int(args[0], "x");
    const y0 = int(args[1], "y");

    rows.forEach((row, j) => {

        [...row.text].forEach((symbol, i) => {

            if (symbol === TRANSPARENT && !overwrite) return;

            try {

                color(doc, symbol, "symbol");
            }
            catch (error) {

                throw new Error(`row ${j + 1} (line ${row.line}, column ${i + 1}): ${error.message}`);
            }

            set(doc, grid, x0 + i, y0 + j, symbol);
        });
    });
}

/**
 * @description Copies a region of a layer, optionally clearing the source, and pastes it at tx, ty.
 * Transparent source pixels are skipped when pasting with "keep" (blit semantics).
 *
 */
function transferRegion(doc, grid, [x, y, w, h], tx, ty, { cut = false, keep = false } = {}) {

    const buffer = [];

    for (let j = 0; j < h; j++) {

        const row = [];

        for (let i = 0; i < w; i++) {

            const inside = x + i >= 0 && y + j >= 0 && x + i < doc.width && y + j < doc.height;

            row.push(inside ? grid[y + j][x + i] : TRANSPARENT);

            if (cut && inside) grid[y + j][x + i] = TRANSPARENT;
        }

        buffer.push(row);
    }

    for (let j = 0; j < h; j++) {

        for (let i = 0; i < w; i++) {

            if (keep && buffer[j][i] === TRANSPARENT) continue;

            set(doc, grid, tx + i, ty + j, buffer[j][i]);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

const COMMANDS = {

    px(doc, ctx, args) {

        need(args, 3, "px x y c");
        set(doc, layerOf(doc, ctx), int(args[0], "x"), int(args[1], "y"), color(doc, args[2]));
    },

    line(doc, ctx, args) {

        need(args, 5, "line x0 y0 x1 y1 c");
        drawLine(doc, layerOf(doc, ctx), int(args[0], "x0"), int(args[1], "y0"), int(args[2], "x1"), int(args[3], "y1"), color(doc, args[4]));
    },

    rect(doc, ctx, args) {

        need(args, 5, "rect x y w h c");

        const [x, y, w, h] = rectArgs(args);
        const c = color(doc, args[4]);
        const grid = layerOf(doc, ctx);

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => { grid[gy][gx] = c; });
    },

    box(doc, ctx, args) {

        need(args, 5, "box x y w h c");

        const [x, y, w, h] = rectArgs(args);
        const c = color(doc, args[4]);
        const grid = layerOf(doc, ctx);

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => {

            if (i === 0 || j === 0 || i === w - 1 || j === h - 1) grid[gy][gx] = c;
        });
    },

    ellipse(doc, ctx, args) {

        need(args, 5, "ellipse x y w h c");

        const [x, y, w, h] = rectArgs(args);
        const c = color(doc, args[4]);
        const grid = layerOf(doc, ctx);

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => {

            if (insideEllipse(i, j, w, h)) grid[gy][gx] = c;
        });
    },

    ring(doc, ctx, args) {

        need(args, 5, "ring x y w h c");

        const [x, y, w, h] = rectArgs(args);
        const c = color(doc, args[4]);
        const grid = layerOf(doc, ctx);

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => {

            const inside = insideEllipse(i, j, w, h);
            const interior = insideEllipse(i - 1, j, w, h) && insideEllipse(i + 1, j, w, h) && insideEllipse(i, j - 1, w, h) && insideEllipse(i, j + 1, w, h);

            if (inside && !interior) grid[gy][gx] = c;
        });
    },

    poly(doc, ctx, args) {

        need(args, 7, "poly c x1 y1 x2 y2 x3 y3 ...");

        const c = color(doc, args[0]);
        const nums = args.slice(1).map((v, i) => int(v, `coordinate ${i + 1}`));

        if (nums.length % 2) throw new Error("poly needs x y pairs.");

        const points = [];

        for (let i = 0; i < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);

        fillPolygon(doc, layerOf(doc, ctx), points, c);
    },

    lines(doc, ctx, args) {

        need(args, 5, "lines c x1 y1 x2 y2 ...");

        const c = color(doc, args[0]);
        const nums = args.slice(1).map((v, i) => int(v, `coordinate ${i + 1}`));

        if (nums.length % 2) throw new Error("lines needs x y pairs.");

        const grid = layerOf(doc, ctx);

        for (let i = 0; i + 3 < nums.length; i += 2) {

            drawLine(doc, grid, nums[i], nums[i + 1], nums[i + 2], nums[i + 3], c);
        }
    },

    fill(doc, ctx, args) {

        need(args, 3, "fill x y c");

        const grid = layerOf(doc, ctx);
        const x = int(args[0], "x");
        const y = int(args[1], "y");
        const c = color(doc, args[2]);

        if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) throw new Error("fill start is outside the canvas.");

        const target = grid[y][x];

        if (target === c) return;

        const stack = [[x, y]];

        while (stack.length) {

            const [px, py] = stack.pop();

            if (px < 0 || py < 0 || px >= doc.width || py >= doc.height || grid[py][px] !== target) continue;

            grid[py][px] = c;
            stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
        }
    },

    clear(doc, ctx, args) {

        const grid = layerOf(doc, ctx);

        if (!args.length) {

            grid.forEach((row) => row.fill(TRANSPARENT));

            return;
        }

        need(args, 4, "clear [x y w h]");

        const [x, y, w, h] = rectArgs(args);

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => { grid[gy][gx] = TRANSPARENT; });
    },

    copy(doc, ctx, args) {

        need(args, 6, "copy x y w h tx ty");

        const region = rectArgs(args);

        transferRegion(doc, layerOf(doc, ctx), region, int(args[4], "tx"), int(args[5], "ty"));
    },

    move(doc, ctx, args) {

        need(args, 6, "move x y w h dx dy");

        const region = rectArgs(args);

        transferRegion(doc, layerOf(doc, ctx), region, region[0] + int(args[4], "dx"), region[1] + int(args[5], "dy"), { cut: true, keep: true });
    },

    replace(doc, ctx, args) {

        need(args, 2, "replace a b [x y w h]");

        const from = args[0];
        const to = color(doc, args[1]);
        const grid = layerOf(doc, ctx);
        const [x0, y0, w, h] = (args.length >= 6)
            ? args.slice(2, 6).map((v, i) => int(v, ["x", "y", "w", "h"][i]))
            : [0, 0, doc.width, doc.height];

        for (let y = Math.max(0, y0); y < Math.min(doc.height, y0 + h); y++) {

            for (let x = Math.max(0, x0); x < Math.min(doc.width, x0 + w); x++) {

                if (grid[y][x] === from) grid[y][x] = to;
            }
        }
    },

    mirror(doc, ctx, args) {

        need(args, 1, "mirror left|right|top|bottom");

        const grid = layerOf(doc, ctx);
        const w = doc.width;
        const h = doc.height;
        const side = args[0].toLowerCase();

        if (side === "left" || side === "right") {

            for (let y = 0; y < h; y++) {

                for (let x = 0; x < Math.floor(w / 2); x++) {

                    if (side === "left") grid[y][w - 1 - x] = grid[y][x];
                    else grid[y][x] = grid[y][w - 1 - x];
                }
            }
        }
        else if (side === "top" || side === "bottom") {

            for (let y = 0; y < Math.floor(h / 2); y++) {

                for (let x = 0; x < w; x++) {

                    if (side === "top") grid[h - 1 - y][x] = grid[y][x];
                    else grid[y][x] = grid[h - 1 - y][x];
                }
            }
        }
        else {

            throw new Error("mirror takes left, right, top or bottom.");
        }
    },

    outline(doc, ctx, args) {

        need(args, 1, "outline c [4|8] [all]");

        const c = color(doc, args[0]);
        const options = args.slice(1).map((value) => value.toLowerCase());
        const unknown = options.filter((value) => !["4", "8", "all"].includes(value));

        if (unknown.length) throw new Error(`outline options are 4, 8 and all, got "${unknown.join(" ")}".`);

        const grid = layerOf(doc, ctx);

        // "all" traces the silhouette of every visible layer in this frame, drawing on the current layer.
        const mask = options.includes("all") ? flattenFrame(doc, ctx.frame) : grid;
        const marks = [];
        const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        if (options.includes("8")) offsets.push([1, 1], [-1, -1], [1, -1], [-1, 1]);

        for (let y = 0; y < doc.height; y++) {

            for (let x = 0; x < doc.width; x++) {

                if (mask[y][x] !== TRANSPARENT) continue;

                const touches = offsets.some(([ox, oy]) => {

                    const nx = x + ox;
                    const ny = y + oy;

                    return nx >= 0 && ny >= 0 && nx < doc.width && ny < doc.height && mask[ny][nx] !== TRANSPARENT;
                });

                if (touches) marks.push([x, y]);
            }
        }

        marks.forEach(([x, y]) => { grid[y][x] = c; });
    },

    dither(doc, ctx, args) {

        need(args, 6, "dither x y w h a b [checker|rows|cols|bayer N]");

        const [x, y, w, h] = rectArgs(args);
        const a = color(doc, args[4], "color a");
        const b = color(doc, args[5], "color b");
        const mode = (args[6] || "checker").toLowerCase();
        const level = (mode === "bayer") ? int(args[7], "bayer level (0-16)") : 0;
        const grid = layerOf(doc, ctx);

        if (!["checker", "rows", "cols", "bayer"].includes(mode)) throw new Error("dither pattern must be checker, rows, cols or bayer N.");
        if (level < 0 || level > 16) throw new Error("bayer level must be 0..16.");

        eachVisibleCell(doc, x, y, w, h, (i, j, gx, gy) => {

            let useB;

            if (mode === "checker") useB = (gx + gy) % 2 !== 0;
            else if (mode === "rows") useB = gy % 2 !== 0;
            else if (mode === "cols") useB = gx % 2 !== 0;
            else useB = BAYER_4[gy % 4][gx % 4] < level;

            grid[gy][gx] = useB ? b : a;
        });
    },

    shift(doc, ctx, args) {

        need(args, 2, "shift dx dy [wrap]");

        const dx = int(args[0], "dx");
        const dy = int(args[1], "dy");
        const wrap = args[2] === "wrap";
        const grid = layerOf(doc, ctx);
        const source = grid.map((row) => row.slice());

        for (let y = 0; y < doc.height; y++) {

            for (let x = 0; x < doc.width; x++) {

                let sx = x - dx;
                let sy = y - dy;

                if (wrap) {

                    sx = ((sx % doc.width) + doc.width) % doc.width;
                    sy = ((sy % doc.height) + doc.height) % doc.height;
                }

                const inside = sx >= 0 && sy >= 0 && sx < doc.width && sy < doc.height;

                grid[y][x] = inside ? source[sy][sx] : TRANSPARENT;
            }
        }
    },

    // ---- whole document ---------------------------------------------------------------------

    flip(doc, ctx, args) {

        need(args, 1, "flip h|v [layer]");

        const axis = args[0].toLowerCase();
        const flipGrid = (axis === "h") ? (grid) => grid.map((row) => row.slice().reverse())
            : (axis === "v") ? (grid) => grid.slice().reverse()
            : null;

        if (!flipGrid) throw new Error("flip takes h or v.");

        if (args[1] === undefined) {

            eachLayer(doc, flipGrid);
        }
        else if (args[1].toLowerCase() === "layer") {

            // Only the current layer of the current frame, e.g. to turn one sprite part around.
            const layer = findLayer(doc.frames[ctx.frame], ctx.layer);

            if (!layer) throw new Error(`Layer "${ctx.layer}" does not exist in frame ${ctx.frame}.`);

            layer.grid = flipGrid(layer.grid);
        }
        else {

            throw new Error(`flip scope must be "layer" or nothing, got "${args[1]}".`);
        }
    },

    rotate(doc, ctx, args) {

        need(args, 1, "rotate 90|180|270");

        const degrees = int(args[0], "degrees");
        const w = doc.width;
        const h = doc.height;

        if (degrees === 180) {

            eachLayer(doc, (grid) => grid.slice().reverse().map((row) => row.slice().reverse()));
        }
        else if (degrees === 90 || degrees === 270) {

            eachLayer(doc, (grid) => {

                const out = emptyGrid(h, w);

                for (let y = 0; y < h; y++) {

                    for (let x = 0; x < w; x++) {

                        if (degrees === 90) out[x][h - 1 - y] = grid[y][x];
                        else out[w - 1 - x][y] = grid[y][x];
                    }
                }

                return out;
            });

            doc.width = h;
            doc.height = w;
        }
        else {

            throw new Error("rotate takes 90, 180 or 270.");
        }
    },

    crop(doc, ctx, args) {

        need(args, 4, "crop x y w h");

        const [x, y, w, h] = args.slice(0, 4).map((v, i) => int(v, ["x", "y", "w", "h"][i]));

        if (w < 1 || h < 1) throw new Error("crop size must be at least 1x1.");

        eachLayer(doc, (grid) => {

            const out = emptyGrid(w, h);

            for (let j = 0; j < h; j++) {

                for (let i = 0; i < w; i++) {

                    const sx = x + i;
                    const sy = y + j;

                    if (sx >= 0 && sy >= 0 && sx < doc.width && sy < doc.height) out[j][i] = grid[sy][sx];
                }
            }

            return out;
        });

        doc.width = w;
        doc.height = h;
    },

    canvas(doc, ctx, args) {

        need(args, 2, "canvas w h [anchor]");

        const w = int(args[0], "w");
        const h = int(args[1], "h");
        const anchor = (args[2] || "tl").toLowerCase();

        if (!["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"].includes(anchor)) throw new Error("anchor must be tl t tr l c r bl b br.");

        const ax = anchor.includes("l") ? 0 : anchor.includes("r") ? 1 : 0.5;
        const ay = anchor.includes("t") ? 0 : anchor.includes("b") ? 1 : 0.5;

        if (w < 1 || h < 1 || w > 1024 || h > 1024) throw new Error("canvas size must be 1..1024.");

        const ox = Math.floor((w - doc.width) * ax);
        const oy = Math.floor((h - doc.height) * ay);

        eachLayer(doc, (grid) => {

            const out = emptyGrid(w, h);

            for (let y = 0; y < doc.height; y++) {

                for (let x = 0; x < doc.width; x++) {

                    const tx = x + ox;
                    const ty = y + oy;

                    if (tx >= 0 && ty >= 0 && tx < w && ty < h) out[ty][tx] = grid[y][x];
                }
            }

            return out;
        });

        doc.width = w;
        doc.height = h;
    },

    scale(doc, ctx, args) {

        need(args, 1, "scale n");

        const n = int(args[0], "n");

        if (n < 1 || n > 8) throw new Error("scale must be 1..8.");
        if (doc.width * n > 1024 || doc.height * n > 1024) throw new Error("scaled canvas would exceed 1024px.");

        eachLayer(doc, (grid) => {

            const out = emptyGrid(doc.width * n, doc.height * n);

            for (let y = 0; y < out.length; y++) for (let x = 0; x < out[0].length; x++) out[y][x] = grid[Math.floor(y / n)][Math.floor(x / n)];

            return out;
        });

        doc.width *= n;
        doc.height *= n;
    },

    recolor(doc, ctx, args) {

        need(args, 2, "recolor a b");

        const to = color(doc, args[1]);

        eachLayer(doc, (grid) => grid.map((row) => row.map((symbol) => (symbol === args[0] ? to : symbol))));
    },

    // ---- palette ----------------------------------------------------------------------------

    palette(doc, ctx, args) {

        need(args, 1, "palette add|set|del|load|remap|ramp ...");

        const action = args[0].toLowerCase();

        if (action === "add" || action === "set") {

            need(args, 3, `palette ${action} c #hex`);

            const symbol = validateSymbol(args[1]);

            if (action === "add" && symbol in doc.palette) {

                throw new Error(`Symbol "${symbol}" already exists (${doc.palette[symbol]}). Use "palette set".`);
            }

            doc.palette[symbol] = normalizeHex(args[2]);
        }
        else if (action === "del") {

            need(args, 2, "palette del c");

            delete doc.palette[args[1]];
            eachLayer(doc, (grid) => grid.map((row) => row.map((symbol) => (symbol === args[1] ? TRANSPARENT : symbol))));
        }
        else if (action === "load") {

            need(args, 2, "palette load <preset>");

            doc.palette = paletteFromPreset(args[1]);
        }
        else if (action === "remap") {

            need(args, 2, "palette remap <preset>");

            const preset = paletteFromPreset(args[1]);
            const presetSymbols = Object.keys(preset);
            const presetColors = presetSymbols.map((symbol) => hexToRgb(preset[symbol]));
            const mapping = {};
            const used = new Set();

            for (const [symbol, hex] of Object.entries(doc.palette)) {

                mapping[symbol] = presetSymbols[nearestIndex(hexToRgb(hex), presetColors)];
            }

            eachLayer(doc, (grid) => grid.map((row) => row.map((symbol) => {

                if (symbol === TRANSPARENT) return symbol;

                used.add(mapping[symbol]);

                return mapping[symbol];
            })));

            doc.palette = Object.fromEntries([...used].map((symbol) => [symbol, preset[symbol]]));
        }
        else if (action === "ramp") {

            need(args, 3, "palette ramp #base symbols");

            const symbols = [...args[2]];
            const ramp = makeRamp(args[1], symbols.length);

            symbols.forEach((symbol) => {

                validateSymbol(symbol);

                if (symbol in doc.palette) {

                    throw new Error("Symbol \"" + symbol + "\" is already in the palette (" + doc.palette[symbol] + "). Pick unused symbols for the ramp.");
                }
            });

            symbols.forEach((symbol, index) => {

                doc.palette[symbol] = ramp[index];
            });
        }
        else {

            throw new Error("palette takes add, set, del, load, remap or ramp.");
        }
    },

    // ---- layers and frames ------------------------------------------------------------------

    layer(doc, ctx, args) {

        need(args, 1, "layer <name>  |  layer hide|show|del <name>");

        const verbs = ["hide", "show", "del"];

        if (verbs.includes(args[0].toLowerCase()) && args[1] !== undefined) {

            const verb = args[0].toLowerCase();
            const name = args[1];

            if (!doc.frames.every((frame) => findLayer(frame, name))) throw new Error(`Layer "${name}" does not exist.`);

            if (verb === "del") {

                if (doc.frames[0].layers.length === 1) throw new Error("Cannot delete the only layer.");

                doc.frames.forEach((frame) => { frame.layers = frame.layers.filter((layer) => layer.name !== name); });

                if (ctx.layer === name) ctx.layer = doc.frames[ctx.frame].layers[0].name;
            }
            else {

                doc.frames.forEach((frame) => { findLayer(frame, name).visible = (verb === "show"); });
            }

            return;
        }

        const name = args[0];

        if (!doc.frames.every((frame) => findLayer(frame, name))) {

            doc.frames.forEach((frame) => {

                if (!findLayer(frame, name)) frame.layers.push({ name, visible: true, grid: emptyGrid(doc.width, doc.height) });
            });
        }

        ctx.layer = name;
    },

    frame(doc, ctx, args) {

        need(args, 1, "frame <n> | add [copy] | del [n] | dur [all] <ms>");

        const head = args[0].toLowerCase();

        if (/^\d+$/.test(head)) {

            const index = parseInt(head, 10);

            if (index >= doc.frames.length) throw new Error(`Frame ${index} does not exist (document has ${doc.frames.length}). Use "frame add".`);

            ctx.frame = index;
        }
        else if (head === "add") {

            doc.frames.push(newFrame(doc, ctx, args[1] === "copy"));
            ctx.frame = doc.frames.length - 1;
        }
        else if (head === "del") {

            if (doc.frames.length === 1) throw new Error("Cannot delete the only frame.");

            const index = args[1] === undefined ? ctx.frame : int(args[1], "n");

            if (!doc.frames[index]) throw new Error(`Frame ${index} does not exist.`);

            doc.frames.splice(index, 1);

            if (index < ctx.frame) ctx.frame--;

            ctx.frame = Math.min(ctx.frame, doc.frames.length - 1);

            // Keep animation tags pointing at the same frames.
            doc.tags = (doc.tags || []).map((tag) => ({

                ...tag,
                from: tag.from > index ? tag.from - 1 : tag.from,
                to: tag.to >= index ? tag.to - 1 : tag.to
            })).filter((tag) => tag.to >= tag.from);
        }
        else if (head === "dur") {

            need(args, 2, "frame dur [all|n] <ms>");

            const all = args[1].toLowerCase() === "all";
            const target = (!all && args.length > 2) ? int(args[1], "n") : ctx.frame;
            const ms = int(args[all || args.length > 2 ? 2 : 1], "ms");

            if (ms < 10 || ms > 60000) throw new Error("duration must be 10..60000 ms.");
            if (!doc.frames[target]) throw new Error(`Frame ${target} does not exist.`);

            if (all) doc.frames.forEach((frame) => { frame.duration = ms; });
            else doc.frames[target].duration = ms;
        }
        else {

            throw new Error("frame takes a number, add, del or dur.");
        }
    },

    tag(doc, ctx, args) {

        need(args, 2, "tag <name> <from> <to>  |  tag del <name>");

        doc.tags = doc.tags || [];

        if (args[0].toLowerCase() === "del") {

            const before = doc.tags.length;

            doc.tags = doc.tags.filter((tag) => tag.name !== args[1]);

            if (doc.tags.length === before) throw new Error(`No tag named "${args[1]}".`);

            return;
        }

        need(args, 3, "tag <name> <from> <to>");

        const from = int(args[1], "from");
        const to = int(args[2], "to");

        if (from < 0 || to < from || to >= doc.frames.length) {

            throw new Error(`Tag range ${from}..${to} is invalid (frames 0..${doc.frames.length - 1}).`);
        }

        doc.tags = doc.tags.filter((tag) => tag.name !== args[0]).concat({ name: args[0], from, to });
    },

    frames(doc, ctx, args) {

        need(args, 1, "frames <n> [copy]");

        const count = int(args[0], "n");

        if (count < 1 || count > 256) throw new Error("frame count must be 1..256.");

        const copy = args[1] === "copy";

        while (doc.frames.length < count) doc.frames.push(newFrame(doc, ctx, copy));
    }
};

function newFrame(doc, ctx, copy) {

    const source = doc.frames[ctx.frame];

    if (copy) return cloneFrame(source);

    return {

        duration: source.duration,
        layers: source.layers.map((layer) => ({ name: layer.name, visible: layer.visible, grid: emptyGrid(doc.width, doc.height) }))
    };
}

// Re-exported for tests.
export { flattenFrame };
