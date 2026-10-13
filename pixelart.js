#!/usr/bin/env node
/**
 * @description ClaudePackage pixel art toolbox (CLI).  Run `node pixelart.js help` for the commands.
 *
 * The loop for good pixel art: build/draw -> render -> (look at the PNG) -> lint -> fix ... -> export.
 * @module
 *
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { SETTINGS, configPath, describeSetting, loadConfig, resetConfig, setConfig } from "./lib/config.js";
import { EXTENSION, createDocument, loadDocument, normalizeHex, resolveDocumentPath, saveDocument, tagFrames } from "./lib/document.js";
import { createDocument as setupEnvironment } from "./lib/environment.js";
import { importImage } from "./lib/importer.js";
import { documentStats, lintDocument } from "./lib/lint.js";
import { HELP as OPS_HELP, runScript } from "./lib/ops.js";
import { PRESETS, makeRamp, paletteFromPreset, presetNames } from "./lib/palettes.js";
import { renderProgram } from "./lib/program.js";
import { autoScale, exportCode, renderFinal, renderGif, renderPreview, renderSheet, renderStrip } from "./lib/render.js";
import { installSkill } from "./lib/skill.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = process.env.PIXELART_DIR ? path.resolve(process.env.PIXELART_DIR) : path.join(HERE, "output");

const USAGE = `ClaudePackage pixelart - pixel art toolbox

  node pixelart.js <command> [arguments] [options]        node pixelart.js help <command>

CREATE
  build <script>          rebuild a document from a draw script (recommended)  --name n --size 32x32 --palette none --quiet --force
  new <name>              create an empty document          --size 32x32 --palette sweetie16|pico8|...|none --colors "k=#111111,w=#ffffff" --frames 1
  import <image>          photo/image -> pixel art document  --name n --grid 48 --colors 16 --palette pico8 --dither --resample box|nearest
EDIT
  draw <name> [ops...]    run drawing/editing commands       --script file | --stdin | "px 1 1 k" "rect 0 0 4 4 w"   --frame n --layer name --preview --onion
  edit                    alias of draw
LOOK
  render <name>           write a preview PNG to look at     --frame n | --all [--tag t]  --scale n  --grid --rulers --onion  --bg checker|none|#hex  --out file
  lint <name>             objective quality report           --max-colors 16 --json
  info <name>             size, frames, tags, palette legend, bounding box
EXPORT
  export <name>           --format png|gif|sheet|frames|code|json   --frame n --tag t --scale n --cols n --filename base --out dir
  convert <file>          one shot: image -> pixel art PNG (or render a DataPixels .js)   --grid --colors --scale --code --force ...
TOOLS
  palettes [name]         list preset palettes or show one
  ramp <#hex> [steps]     shading ramp (dark -> light) for a base color
  config [key [value]]    show or change settings, e.g. "config iterations 4", "config iterations auto", "config reset"
  install-skill           install the /pixelart skill   --dest <project dir> | --global
  help [ops|<command>]    this text, the draw/edit command reference, or one command

Documents live in --dir (default: ${DEFAULT_DIR}, or $PIXELART_DIR) as <name>${EXTENSION}.
A <name> may also be a path to a ${EXTENSION} file.  Every command prints the files it wrote.
`;

class UsageError extends Error {}

function fail(message) {

    console.error(`Error: ${message}`);
    process.exit(1);
}

function options(args, spec, { positionals = true } = {}) {

    const common = { dir: { type: "string" } };
    const result = parseArgs({ args, allowPositionals: positionals, options: { ...common, ...spec } });

    return { ...result.values, _: result.positionals };
}

function intOption(value, label, min = 1) {

    if (value === undefined) return undefined;

    const number = Number(value);

    if (!Number.isInteger(number) || number < min) throw new UsageError(`--${label} must be an integer >= ${min}.`);

    return number;
}

function workDir(o) {

    return path.resolve(o.dir || DEFAULT_DIR);
}

function docPath(o, name) {

    if (!name) throw new UsageError("Missing document name.");

    return resolveDocumentPath(name, workDir(o));
}

function docName(name) {

    return path.basename(name).replace(EXTENSION, "");
}

function legend(doc, frameIndex = 0) {

    const { counts } = documentStats(doc, frameIndex);
    const lines = Object.entries(doc.palette).map(([symbol, hex]) => {

        const count = counts[symbol];

        return `  ${symbol}  ${hex}${count ? `  (${count} px in frame ${frameIndex})` : ""}`;
    });

    return lines.length ? lines.join("\n") : "  (empty palette - use `palette add` or --palette/--colors)";
}

function writePng(canvas, file) {

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, canvas.toBuffer("image/png"));

    return file;
}

function parseSize(text) {

    const match = /^(\d+)\s*[x,]\s*(\d+)$/i.exec(text);

    if (!match) throw new UsageError(`--size must look like 32x32, got "${text}".`);

    return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

function parseColors(text) {

    const palette = {};

    for (const part of text.split(",")) {

        const match = /^\s*(\S)\s*=\s*(#?[0-9a-fA-F]{3,6})\s*$/.exec(part);

        if (!match) throw new UsageError(`Bad --colors entry "${part}". Use symbol=#hex, e.g. k=#1a1c2c,s=#e8b796.`);

        palette[match[1]] = normalizeHex(match[2]);
    }

    return palette;
}

/**
 * @description Palette for a new document: a preset (default sweetie16, or "none"), with --colors added on top.
 *
 */
function startPalette(presetName, colors, defaultPreset) {

    const preset = (presetName || defaultPreset).toLowerCase();
    const base = (preset === "none") ? {} : paletteFromPreset(preset, colors ? Object.keys(parseColors(colors)) : []);

    return { ...base, ...(colors ? parseColors(colors) : {}) };
}

function previewScale(doc) {

    return Math.max(4, Math.min(24, autoScale(doc, 480)));
}

function lintSummary(doc, { warnOnly = false } = {}) {

    const report = lintDocument(doc);
    const shown = report.findings.filter((finding) => !warnOnly || finding.level === "warn");
    const infos = report.findings.length - shown.length;
    const lines = shown.map((finding) => {

        const where = (finding.frame === null || doc.frames.length === 1) ? "" : ` [frame ${finding.frame}]`;

        return `${finding.level.toUpperCase().padEnd(4)} ${finding.code}${where}: ${finding.message}`;
    });

    if (warnOnly && infos) lines.push(`(${infos} info finding(s) hidden; run lint for all)`);

    return { report, text: lines.join("\n") };
}

function writePreviews(doc, file, frame, { onion = false } = {}) {

    const written = [];
    const previewFile = path.join(path.dirname(file), `${doc.name}.preview.png`);

    written.push(writePng(renderPreview(doc, frame, { scale: previewScale(doc), grid: true, rulers: true, onion }), previewFile));

    if (doc.frames.length > 1) {

        written.push(writePng(renderStrip(doc), path.join(path.dirname(file), `${doc.name}.strip.png`)));
    }

    return written;
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

const commands = {

    async build(args) {

        const o = options(args, {

            name: { type: "string" }, size: { type: "string" }, palette: { type: "string" }, colors: { type: "string" },
            quiet: { type: "boolean" }, force: { type: "boolean" }, frame: { type: "string" }
        });

        const script = o._[0];

        if (!script) throw new UsageError("Usage: build <script file> [--name n] [--size 32x32]");
        if (!fs.existsSync(script)) throw new UsageError(`Script not found: ${path.resolve(script)}`);

        const scriptPath = path.resolve(script);
        const name = o.name || path.basename(script).replace(/\.[^.]+$/, "");
        const file = docPath(o, name);

        if (fs.existsSync(file) && !o.force) {

            const existing = loadDocument(file);

            if (existing.source !== scriptPath) {

                throw new UsageError(`${file} exists and was not built from ${scriptPath}; use --force to replace it or --name for a new document.`);
            }
        }

        const [width, height] = parseSize(o.size || "32x32");
        const doc = createDocument({ name: docName(name), width, height, palette: startPalette(o.palette, o.colors, "none") });

        doc.source = scriptPath;

        const { commands: count } = runScript(doc, fs.readFileSync(scriptPath, "utf8"));

        saveDocument(doc, file);
        console.log(`${file}\nok: ${count} command(s); ${doc.width}x${doc.height}, ${doc.frames.length} frame(s), ${Object.keys(doc.palette).length} color(s).`);

        if (!o.quiet) {

            const frame = intOption(o.frame, "frame", 0) ?? 0;

            console.log(writePreviews(doc, file, frame).join("\n"));

            const { text } = lintSummary(doc, { warnOnly: true });

            if (text) console.log(text);
        }
    },

    async new(args) {

        const o = options(args, {

            size: { type: "string" }, width: { type: "string" }, height: { type: "string" },
            palette: { type: "string" }, colors: { type: "string" }, frames: { type: "string" }, force: { type: "boolean" }
        });

        const name = o._[0];
        const file = docPath(o, name);

        if (fs.existsSync(file) && !o.force) throw new UsageError(`${file} already exists (use --force to overwrite).`);

        const [width, height] = o.size ? parseSize(o.size) : [intOption(o.width, "width") || 32, intOption(o.height, "height") || intOption(o.width, "width") || 32];
        const palette = startPalette(o.palette, o.colors, o.colors ? "none" : "sweetie16");
        const doc = createDocument({ name: docName(name), width, height, palette, frames: intOption(o.frames, "frames") || 1 });

        saveDocument(doc, file);
        console.log(`${file}\n${width}x${height}, ${doc.frames.length} frame(s). Palette:\n${legend(doc)}`);
    },

    async draw(args) {

        const o = options(args, {

            script: { type: "string" }, stdin: { type: "boolean" }, frame: { type: "string" }, layer: { type: "string" },
            preview: { type: "boolean" }, onion: { type: "boolean" }
        });

        const name = o._[0];
        const file = docPath(o, name);
        const doc = loadDocument(file);
        const parts = [];

        if (o.script) parts.push(fs.readFileSync(path.resolve(o.script), "utf8"));
        if (o.stdin) parts.push(fs.readFileSync(0, "utf8"));
        if (o._.length > 1) parts.push(o._.slice(1).join("\n"));

        if (!parts.length) throw new UsageError("Nothing to do. Pass commands, --script <file> or --stdin. See `help ops`.");

        const frame = intOption(o.frame, "frame", 0) ?? 0;

        if (!doc.frames[frame]) throw new UsageError(`Frame ${frame} does not exist (document has ${doc.frames.length}).`);

        const { commands: count } = runScript(doc, parts.join("\n"), { frame, layer: o.layer });

        saveDocument(doc, file);
        console.log(`${file}\nok: ${count} command(s); ${doc.width}x${doc.height}, ${doc.frames.length} frame(s).`);

        if (o.preview) console.log(writePreviews(doc, file, frame, { onion: o.onion }).join("\n"));
    },

    async render(args) {

        const o = options(args, {

            frame: { type: "string" }, all: { type: "boolean" }, tag: { type: "string" }, scale: { type: "string" },
            grid: { type: "boolean" }, rulers: { type: "boolean" }, onion: { type: "boolean" }, bg: { type: "string" }, out: { type: "string" }
        });

        const file = docPath(o, o._[0]);
        const doc = loadDocument(file);
        const strip = o.all || o.tag !== undefined;
        const out = o.out ? path.resolve(o.out) : path.join(path.dirname(file), `${doc.name}.${strip ? "strip" : "preview"}.png`);
        const scale = intOption(o.scale, "scale");
        const bg = o.bg || "checker";

        if (strip) {

            writePng(renderStrip(doc, { scale, grid: o.grid, bg, frames: tagFrames(doc, o.tag) }), out);
        }
        else {

            const frame = intOption(o.frame, "frame", 0) ?? 0;

            writePng(renderPreview(doc, frame, { scale: scale || previewScale(doc), grid: o.grid, rulers: o.rulers, onion: o.onion, bg }), out);
        }

        console.log(out);
    },

    async lint(args) {

        const o = options(args, { "max-colors": { type: "string" }, json: { type: "boolean" } });
        const doc = loadDocument(docPath(o, o._[0]));
        const report = lintDocument(doc, { maxColors: intOption(o["max-colors"], "max-colors") || 16 });

        if (o.json) {

            console.log(JSON.stringify(report, null, 2));

            return;
        }

        console.log(`${doc.name}: ${report.stats.size}, ${report.stats.frames} frame(s), ${report.stats.colors} color(s)`);

        if (!report.findings.length) console.log("No findings.");

        for (const finding of report.findings) {

            const where = (finding.frame === null || doc.frames.length === 1) ? "" : ` [frame ${finding.frame}]`;

            console.log(`${finding.level.toUpperCase().padEnd(4)} ${finding.code}${where}: ${finding.message}`);
        }
    },

    async info(args) {

        const o = options(args, {});
        const doc = loadDocument(docPath(o, o._[0]));

        console.log(`${doc.name}  ${doc.width}x${doc.height}  ${doc.frames.length} frame(s)${doc.source ? `  (built from ${doc.source})` : ""}`);
        console.log(`layers: ${doc.frames[0].layers.map((layer) => `${layer.name}${layer.visible ? "" : " (hidden)"}`).join(", ")}`);
        console.log(`durations (ms): ${doc.frames.map((frame) => frame.duration).join(" ")}`);

        if (doc.tags.length) console.log(`tags: ${doc.tags.map((tag) => `${tag.name} ${tag.from}-${tag.to}`).join(", ")}`);

        const stats = documentStats(doc, 0);

        console.log(stats.bbox ? `frame 0 content: x=${stats.bbox.x} y=${stats.bbox.y} w=${stats.bbox.w} h=${stats.bbox.h} (${stats.filled}/${stats.total} px)` : "frame 0 is empty");
        console.log(`palette:\n${legend(doc)}`);
    },

    async import(args) {

        const o = options(args, {

            name: { type: "string" }, grid: { type: "string" }, "grid-height": { type: "string" }, colors: { type: "string" },
            palette: { type: "string" }, dither: { type: "boolean" }, resample: { type: "string" }, force: { type: "boolean" },
            preview: { type: "boolean" }
        });

        const image = o._[0];

        if (!image) throw new UsageError("Missing image path.");
        if (!fs.existsSync(image)) throw new UsageError(`File not found: ${path.resolve(image)}`);

        const name = o.name || path.parse(image).name;
        const file = docPath(o, name);

        if (fs.existsSync(file) && !o.force) throw new UsageError(`${file} already exists (use --force to overwrite, or --name).`);

        const doc = await importImage(path.resolve(image), {

            name: docName(name),
            grid: intOption(o.grid, "grid") || 48,
            gridHeight: intOption(o["grid-height"], "grid-height"),
            colors: intOption(o.colors, "colors"),
            palette: o.palette,
            dither: o.dither,
            resample: o.resample || "box"
        });

        saveDocument(doc, file);
        console.log(`${file}\n${doc.width}x${doc.height}. Palette:\n${legend(doc)}`);

        if (o.preview) console.log(writePreviews(doc, file, 0).join("\n"));
    },

    async export(args) {

        const o = options(args, {

            format: { type: "string" }, frame: { type: "string" }, tag: { type: "string" }, scale: { type: "string" },
            cols: { type: "string" }, filename: { type: "string" }, out: { type: "string" }
        });

        const file = docPath(o, o._[0]);
        const doc = loadDocument(file);
        const outDir = path.resolve(o.out || path.dirname(file));
        const format = (o.format || "png").toLowerCase();
        const base = o.filename || (o.tag ? `${doc.name}-${o.tag}` : doc.name);
        const written = [];
        const scaleOption = intOption(o.scale, "scale");
        const frame = intOption(o.frame, "frame", 0);
        const frames = tagFrames(doc, o.tag);

        if (frame !== undefined && !doc.frames[frame]) throw new UsageError(`Frame ${frame} does not exist (document has ${doc.frames.length}).`);

        fs.mkdirSync(outDir, { recursive: true });

        if (format === "png") {

            const chosen = frame ?? frames[0];
            const canvas = await renderFinal(doc, chosen, scaleOption || autoScale(doc));
            const note = (doc.frames.length > 1 && frame === undefined) ? `, frame ${chosen} of ${doc.frames.length}: use --format gif|sheet|frames for the animation` : "";

            written.push(writePng(canvas, path.join(outDir, `${base}.png`)) + `  (${canvas.width}x${canvas.height}${note})`);
        }
        else if (format === "frames") {

            for (const f of (frame !== undefined ? [frame] : frames)) {

                written.push(writePng(await renderFinal(doc, f, scaleOption || autoScale(doc)), path.join(outDir, `${base}-${String(f).padStart(2, "0")}.png`)));
            }
        }
        else if (format === "sheet") {

            const { canvas, meta } = await renderSheet(doc, { scale: scaleOption || 1, cols: intOption(o.cols, "cols"), frames });
            const sheetFile = path.join(outDir, `${base}.sheet.png`);
            const metaFile = path.join(outDir, `${base}.sheet.json`);

            meta.meta.image = path.basename(sheetFile);
            writePng(canvas, sheetFile);
            fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
            written.push(`${sheetFile}  (${canvas.width}x${canvas.height}, ${meta.meta.columns}x${meta.meta.rows} cells of ${doc.width * (scaleOption || 1)}x${doc.height * (scaleOption || 1)})`, `${metaFile}  (Aseprite-style JSON)`);
        }
        else if (format === "gif") {

            const gifFile = path.join(outDir, `${base}.gif`);

            fs.writeFileSync(gifFile, renderGif(doc, { scale: scaleOption || autoScale(doc, 256), frames }));
            written.push(`${gifFile}  (${frames.length} frame(s))`);
        }
        else if (format === "code") {

            const codeFile = path.join(outDir, `${base}.js`);

            fs.writeFileSync(codeFile, exportCode(doc, { scale: scaleOption || Math.max(1, Math.round(256 / Math.max(doc.width, doc.height))), frame }));
            written.push(codeFile);
        }
        else if (format === "json") {

            const jsonFile = path.join(outDir, `${base}${EXTENSION}`);

            if (path.resolve(jsonFile) !== path.resolve(file)) saveDocument(doc, jsonFile);

            written.push(jsonFile);
        }
        else {

            throw new UsageError("--format must be png, gif, sheet, frames, code or json.");
        }

        console.log(written.join("\n"));
    },

    async convert(args) {

        const o = options(args, {

            out: { type: "string", short: "o" }, name: { type: "string", short: "n" }, grid: { type: "string", short: "g" },
            "grid-height": { type: "string" }, colors: { type: "string", short: "c" }, scale: { type: "string", short: "s" },
            size: { type: "string" }, palette: { type: "string" }, dither: { type: "boolean" }, resample: { type: "string" },
            code: { type: "boolean" }, force: { type: "boolean" }
        });

        const input = o._[0];

        if (!input) throw new UsageError("Missing input file.");
        if (!fs.existsSync(input)) throw new UsageError(`File not found: ${path.resolve(input)}`);

        const outDir = path.resolve(o.out || DEFAULT_DIR);
        const base = o.name || `${path.parse(input).name}-pixel`;
        const scale = intOption(o.scale ?? o.size, "scale");          // --size is the old name of --scale

        fs.mkdirSync(outDir, { recursive: true });

        if (path.extname(input).toLowerCase() === ".js") {

            const outputs = await renderProgram(path.resolve(input));

            outputs.forEach((png, index) => {

                const file = path.join(outDir, `${base}${outputs.length > 1 ? `-${index + 1}` : ""}.png`);

                fs.writeFileSync(file, png);
                console.log(file);
            });

            return;
        }

        const docFile = path.join(outDir, `${base}${EXTENSION}`);

        if (fs.existsSync(docFile) && !o.force) throw new UsageError(`${docFile} already exists (use --force to overwrite, or --name).`);

        const doc = await importImage(path.resolve(input), {

            name: base,
            grid: intOption(o.grid, "grid") || 48,
            gridHeight: intOption(o["grid-height"], "grid-height"),
            colors: intOption(o.colors, "colors"),
            palette: o.palette,
            dither: o.dither,
            resample: o.resample || "box"
        });

        const finalScale = scale || autoScale(doc);
        const canvas = await renderFinal(doc, 0, finalScale);

        console.log(`${writePng(canvas, path.join(outDir, `${base}.png`))}  (${doc.width}x${doc.height} art, ${canvas.width}x${canvas.height} px)`);

        if (o.code) {

            const codeFile = path.join(outDir, `${base}.js`);

            fs.writeFileSync(codeFile, exportCode(doc, { scale: finalScale }));
            console.log(codeFile);
        }

        saveDocument(doc, docFile);
        console.log(`${docFile}  (editable: node pixelart.js draw "${docFile}" ...)`);
    },

    async palettes(args) {

        const o = options(args, {});
        const name = o._[0];

        if (!name) {

            for (const key of presetNames()) console.log(`${key.padEnd(10)} ${PRESETS[key].description}`);

            return;
        }

        const palette = paletteFromPreset(name);

        for (const [symbol, hex] of Object.entries(palette)) console.log(`${symbol}  ${hex}`);
    },

    async ramp(args) {

        const o = options(args, {});

        if (!o._[0]) throw new UsageError("Usage: ramp <#hex> [steps]");

        const steps = intOption(o._[1], "steps", 2) || 4;

        makeRamp(o._[0], steps).forEach((hex, i) => console.log(`${i}  ${hex}${i === 0 ? "  (darkest)" : i === steps - 1 ? "  (lightest)" : ""}`));
    },

    async config(args) {

        const o = options(args, {});
        const [key, value] = o._;

        if (!key) {

            const config = loadConfig();

            console.log(Object.keys(SETTINGS).map((name) => describeSetting(name, config[name])).join("\n"));
            console.log(`\nfile: ${configPath()}`);

            return;
        }

        if (key === "reset") {

            resetConfig();
            console.log("All settings restored to their defaults.");

            return;
        }

        if (!SETTINGS[key]) throw new UsageError(`Unknown setting "${key}". Settings: ${Object.keys(SETTINGS).join(", ")}.`);

        if (value === undefined) {

            console.log(describeSetting(key, loadConfig()[key]));

            return;
        }

        const stored = setConfig(key, value);
        const where = (stored === SETTINGS[key].default) ? "back to the default" : `saved: ${configPath()}`;

        console.log(`${describeSetting(key, stored)}\n${where}`);
    },

    async "install-skill"(args) {

        const o = options(args, { global: { type: "boolean" }, dest: { type: "string" } }, { positionals: false });

        console.log(installSkill({ dest: o.dest, global: o.global }));
    },

    async help(args) {

        const topic = args[0];

        if (topic === "ops") {

            console.log(OPS_HELP);

            return;
        }

        if (topic) {

            const lines = USAGE.split("\n").filter((line) => new RegExp(`^  ${topic}\\b`).test(line));

            if (!lines.length) throw new UsageError(`No help for "${topic}". Commands: ${Object.keys(commands).join(", ")}.`);

            console.log(lines.join("\n") + (topic === "draw" || topic === "edit" || topic === "build" ? "\n\nDrawing commands: node pixelart.js help ops" : ""));

            return;
        }

        console.log(USAGE);
    }
};

async function main() {

    const [first, ...rest] = process.argv.slice(2);

    if (!first || first === "-h" || first === "--help") {

        console.log(USAGE);

        return;
    }

    const alias = { edit: "draw" };
    const name = alias[first] || first;

    if (!commands[name]) {

        // Backwards compatible: `pixelart.js <file> [options]` behaves like `convert`.
        if (fs.existsSync(first)) {

            setupEnvironment();
            await commands.convert([first, ...rest]);

            return;
        }

        throw new UsageError(`Unknown command "${first}". Run \`node pixelart.js help\`.`);
    }

    if (rest.includes("-h") || rest.includes("--help")) {

        await commands.help([name]);

        return;
    }

    setupEnvironment();
    await commands[name](rest);
}

main().catch((error) => {

    fail(error.message);
});
