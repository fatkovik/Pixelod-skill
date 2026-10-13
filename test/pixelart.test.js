import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDocument, flattenFrame, loadDocument, saveDocument } from "../lib/document.js";
import { createDocument as setupEnvironment } from "../lib/environment.js";
import { lintDocument } from "../lib/lint.js";
import { runScript } from "../lib/ops.js";
import { exportCode, renderFinal, renderGif, renderSheet } from "../lib/render.js";

setupEnvironment();

function make(width = 8, height = 8) {

    return createDocument({ name: "t", width, height, palette: { k: "#101010", w: "#ffffff", r: "#ff0000" } });
}

const rows = (doc, frame = 0) => flattenFrame(doc, frame).map((row) => row.join(""));

test("rect, px and clipping", () => {

    const doc = make(4, 4);

    runScript(doc, "rect 1 1 2 2 k\npx 0 0 w\npx 99 99 w\nrect 3 3 5 5 r");
    assert.deepEqual(rows(doc), ["w...", ".kk.", ".kk.", "...r"]);
});

test("unknown symbol and unknown command report the line", () => {

    const doc = make();

    assert.throws(() => runScript(doc, "px 1 1 k\npx 2 2 z"), /Line 2.*Unknown color "z"/);
    assert.throws(() => runScript(doc, "bogus 1 2"), /Line 1.*Unknown command/);
});

test("flood fill stays inside its region", () => {

    const doc = make(5, 3);

    runScript(doc, "rect 2 0 1 3 k\nfill 0 0 r");
    assert.deepEqual(rows(doc), ["rrk..", "rrk..", "rrk.."]);
});

test("rotate 90 swaps size and is clockwise", () => {

    const doc = make(3, 2);

    runScript(doc, "px 0 0 k\nrotate 90");
    assert.equal(doc.width, 2);
    assert.equal(doc.height, 3);
    assert.deepEqual(rows(doc), [".k", "..", ".."]);
});

test("flip, mirror, crop, canvas, scale", () => {

    const doc = make(4, 2);

    runScript(doc, "px 0 0 k\nflip h");
    assert.deepEqual(rows(doc), ["...k", "...."]);
    runScript(doc, "mirror right");
    assert.deepEqual(rows(doc), ["k..k", "...."]);
    runScript(doc, "crop 0 0 2 1\nscale 2");
    assert.equal(doc.width, 4);
    assert.equal(doc.height, 2);
    assert.deepEqual(rows(doc), ["kk..", "kk.."]);
    runScript(doc, "canvas 6 4 c");
    assert.equal(rows(doc).length, 4);
    assert.equal(rows(doc)[1].length, 6);
});

test("outline wraps shapes", () => {

    const doc = make(5, 5);

    runScript(doc, "px 2 2 w\noutline k");
    assert.deepEqual(rows(doc), [".....", "..k..", ".kwk.", "..k..", "....."]);
});

test("frames, layers and durations", () => {

    const doc = make(2, 2);

    runScript(doc, "px 0 0 k\nframes 3 copy\nframe 1\npx 1 1 r\nframe dur 2 250\nlayer top\npx 0 1 w");
    assert.equal(doc.frames.length, 3);
    assert.equal(doc.frames[2].duration, 250);
    assert.deepEqual(rows(doc, 1), ["k.", "wr"]);
    assert.ok(doc.frames.every((frame) => frame.layers.some((layer) => layer.name === "top")));
});

test("palette ramp refuses to overwrite existing symbols", () => {

    const doc = make();

    assert.throws(() => runScript(doc, "palette ramp #3366cc ak"), /already in the palette/);
    runScript(doc, "palette ramp #3366cc abc");
    assert.equal(Object.keys(doc.palette).length, 6);
});

test("save/load round trip", () => {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelart-"));
    const file = path.join(dir, "t.pixel.json");
    const doc = make(3, 2);

    runScript(doc, "px 1 1 r\nframes 2 copy");
    saveDocument(doc, file);

    const loaded = loadDocument(file);

    assert.deepEqual(rows(loaded, 1), ["...", ".r."]);
    assert.equal(loaded.frames.length, 2);
    fs.rmSync(dir, { recursive: true });
});

test("lint finds orphans and duplicate frames", () => {

    const doc = make(8, 8);

    runScript(doc, "rect 1 1 3 3 k\npx 6 6 r\nframes 2 copy");

    const codes = lintDocument(doc).findings.map((finding) => finding.code);

    assert.ok(codes.includes("orphan"));
    assert.ok(codes.includes("duplicate-frame"));
});

test("exports: png scale, gif header, sheet, code", async () => {

    const doc = make(4, 4);

    runScript(doc, "rect 0 0 2 2 k\nframes 2 copy\nframe 1\npx 3 3 r");

    const canvas = await renderFinal(doc, 0, 3);

    assert.equal(canvas.width, 12);

    const gif = renderGif(doc, { scale: 2 });

    assert.equal(gif.subarray(0, 6).toString(), "GIF89a");

    const { canvas: sheet, meta } = await renderSheet(doc, { scale: 2, cols: 2 });

    assert.equal(sheet.width, 16);
    assert.equal(meta.frames.length, 2);
    assert.match(exportCode(doc, { scale: 5 }), /frames\.map/);
});

test("poly fill has no holes between fill and edges", () => {

    const doc = make(16, 16);

    runScript(doc, "poly k 8 1 14 6 8 15 2 6");

    const findings = lintDocument(doc).findings.map((finding) => finding.code);

    assert.ok(!findings.includes("hole"));

    const grid = flattenFrame(doc, 0);

    for (let y = 1; y <= 15; y++) {

        const filled = grid[y].map((s, x) => (s === "k" ? x : -1)).filter((x) => x >= 0);
        const span = filled[filled.length - 1] - filled[0] + 1;

        assert.equal(filled.length, span, `row ${y} has a gap`);
    }
});

test("shading ramps keep yellow shadows warm and replace works in a region", () => {

    const doc = make(4, 1);

    runScript(doc, "palette ramp #d9a521 abc");

    const [r, g, b] = [1, 3, 5].map((i) => parseInt(doc.palette.a.slice(i, i + 2), 16));

    assert.ok(r > g && g > b, `darkest gold should stay orange/brown, got ${doc.palette.a}`);

    runScript(doc, "rect 0 0 4 1 k\nreplace k r 2 0 2 1");
    assert.deepEqual(rows(doc), ["kkrr"]);
});

test("trailing comments are ignored, hex colors are not comments", () => {

    const doc = make(8, 8);

    runScript(doc, "poly k 1 1 6 1 3 6   # triangle\npalette add z #00ff00 // green\npx 0 0 z");
    assert.equal(doc.palette.z, "#00ff00");
    assert.equal(rows(doc)[0][0], "z");
});

test("put/blit errors name the row, line and column", () => {

    const doc = make(4, 4);

    assert.throws(() => runScript(doc, "px 0 0 k\nput 0 0\nkw\nkQ\nend"), /Line 2.*row 2 \(line 4, column 2\)/);
});

test("coordinates are bounded and big shapes are clipped cheaply", () => {

    const doc = make(4, 4);

    assert.throws(() => runScript(doc, "rect 0 0 99999 2 k"), /out of range/);
    runScript(doc, "ellipse -4000 -4000 4096 4096 k\nrect -10 -10 4096 4096 w");
    assert.deepEqual(rows(doc), ["wwww", "wwww", "wwww", "wwww"]);
});

test("move cuts and pastes a region; copy keeps the source", () => {

    const doc = make(4, 2);

    runScript(doc, "px 0 0 k\nmove 0 0 1 1 2 1");
    assert.deepEqual(rows(doc), ["....", "..k."]);
    runScript(doc, "copy 2 1 1 1 0 0");
    assert.deepEqual(rows(doc), ["k...", "..k."]);
});

test("outline all traces every visible layer onto the current layer", () => {

    const doc = make(5, 3);

    runScript(doc, "px 1 1 w\nlayer top\npx 3 1 r\noutline k all");
    assert.deepEqual(rows(doc), [".k.k.", "kwkrk", ".k.k."]);
    assert.ok(doc.frames[0].layers[0].grid[0].every((symbol) => symbol !== "k"), "outline went on the current layer only");
});

test("flip h layer flips only the current layer of the current frame", () => {

    const doc = make(3, 1);

    runScript(doc, "px 0 0 k\nframes 2 copy\nlayer top\npx 0 0 w\nflip h layer");
    assert.deepEqual(rows(doc, 0), ["k.w"]);
    assert.deepEqual(rows(doc, 1), ["k.."]);
});

test("tags: create, rebase on frame delete, export subsets", async () => {

    const doc = make(2, 2);

    runScript(doc, "px 0 0 k\nframes 6 copy\ntag idle 0 1\ntag walk 2 5");
    assert.throws(() => runScript(doc, "tag bad 4 9"), /invalid/);
    runScript(doc, "frame del 1");
    assert.deepEqual(doc.tags, [{ name: "idle", from: 0, to: 0 }, { name: "walk", from: 1, to: 4 }]);

    const { meta } = await renderSheet(doc, { frames: [1, 2, 3, 4] });

    assert.equal(meta.frames.length, 4);
    assert.deepEqual(meta.meta.frameTags.map((tag) => [tag.name, tag.from, tag.to]), [["walk", 0, 3]]);
});

test("import of an image with very many colors does not overflow the stack", async () => {

    const { createCanvas } = await import("@napi-rs/canvas");
    const { importImage } = await import("../lib/importer.js");
    const canvas = createCanvas(400, 400);
    const context = canvas.getContext("2d");
    const data = context.createImageData(400, 400);

    for (let i = 0; i < data.data.length; i += 4) {

        data.data[i] = (i * 7) % 256;
        data.data[i + 1] = (i * 13) % 256;
        data.data[i + 2] = (i / 4) % 256;
        data.data[i + 3] = 255;
    }

    context.putImageData(data, 0, 0);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelart-"));
    const file = path.join(dir, "noise.png");

    fs.writeFileSync(file, canvas.toBuffer("image/png"));

    const doc = await importImage(file, { name: "noise", grid: 400, colors: 8 });

    assert.equal(doc.width, 400);
    assert.ok(Object.keys(doc.palette).length <= 8);
    fs.rmSync(dir, { recursive: true });
});

test("config: iterations default, set, validate, reset", async () => {

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pixelart-"));

    process.env.PIXELART_CONFIG = path.join(dir, "config.json");

    const { loadConfig, setConfig, resetConfig } = await import("../lib/config.js");

    assert.equal(loadConfig().iterations, "auto");
    assert.equal(setConfig("iterations", "4"), 4);
    assert.equal(loadConfig().iterations, 4);
    assert.throws(() => setConfig("iterations", "0"), /1 to 20/);
    assert.throws(() => setConfig("nope", "1"), /Unknown setting/);
    assert.equal(setConfig("iterations", "auto"), "auto");
    assert.ok(!fs.existsSync(process.env.PIXELART_CONFIG), "default values are not stored");
    setConfig("iterations", "7");
    resetConfig();
    assert.equal(loadConfig().iterations, "auto");

    delete process.env.PIXELART_CONFIG;
    fs.rmSync(dir, { recursive: true });
});
