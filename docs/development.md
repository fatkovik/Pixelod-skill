# Development

ES modules, Node.js 20+, no build step. Dependencies: `@napi-rs/canvas` (canvas, image decoding, PNG encoding)
and `gifenc` (GIF encoding).

```
npm install
npm test          # node --test test/pixelart.test.js
```

## Architecture

```
pixelart.js            command dispatcher: argument parsing, file paths, printing
lib/document.js        document model: create, load/validate, save, flatten layers, tags, colors
lib/ops.js             script engine: tokenizer, command table, all drawing/editing commands, HELP text
lib/render.js          previews (checker, grid, rulers, onion), strips, final PNG, sprite sheet, GIF, code export
lib/importer.js        image -> document: pre-shrink, resample, median cut / preset palette, dithering
lib/lint.js            quality checks and statistics
lib/palettes.js        preset palettes, color distance, luminance, hue-shifted ramps
lib/config.js          user settings (pixelart.config.json): defaults, validation, load/save
lib/DataPixels.js      copy of ../resources/source/js/dataPixels/DataPixels.js (used for final PNGs)
lib/environment.js     Node shims for document, Image and ImageData so DataPixels.js runs unchanged
lib/program.js         runs DataPixels .js programs and collects what they append to the page
lib/skill.js           installs skill/pixelart/SKILL.md with the CLI path filled in
```

Data flow: the CLI loads a document (`lib/document.js`), mutates it with a script (`lib/ops.js`), saves it, then
renders or exports it (`lib/render.js`). In memory every layer has a `grid` (array of rows of symbols); on disk
it is `rows` of strings.

## Adding a drawing command

1. Add a function to `COMMANDS` in `lib/ops.js`. It receives `(doc, ctx, args)`; `ctx.frame` and `ctx.layer` are the
   current frame index and layer name.
2. Use the helpers: `need()` for argument counts, `int()` for bounded integers, `color()` to validate symbols,
   `layerOf()` for the current grid, `clip()`/`eachVisibleCell()` so loops stay inside the canvas, `set()` for
   single pixels, `eachLayer()` for whole-document transforms.
3. Add the command to `HELP` in `lib/ops.js` (the source of `help ops`).
4. Document it in `docs/scripting.md` and, if Claude should use it, in `skill/pixelart/SKILL.md`.
5. Add a test in `test/pixelart.test.js`.
6. Run `npm test` and `node pixelart.js install-skill --dest ..` to refresh the installed skill.

## Adding a setting

1. Add an entry to `SETTINGS` in `lib/config.js`: `default`, `description` and a `parse(value)` that validates and
   returns the stored value (throw with a helpful message on bad input).
2. Read it where needed with `loadConfig().<key>`; skill-only settings are read by Claude via
   `node pixelart.js config <key>`, so describe how to use the value in `skill/pixelart/SKILL.md`.
3. Document it in the `config` table in `docs/cli.md`, add a test, reinstall the skill.

Tests set `PIXELART_CONFIG` to a temporary file so they never touch the real settings.

## Rules

- Loops in drawing commands must be clipped to the canvas; coordinates are capped at ±4096 by `int()`.
- Never spread large arrays into `Math.max`/`Math.min` (stack overflow on big images); use loops.
- Scripts are all-or-nothing: `draw` saves only if every command succeeds, so commands may throw freely.
- Commands that write documents must not overwrite user work silently (`--force`, or `build`'s `source` check).
- Keep `lib/DataPixels.js` in sync with the Playground's copy if the class changes.

## Tests

`test/pixelart.test.js` covers the drawing commands, transforms, frames/layers/tags, palette ramps, save/load,
lint checks, exports (PNG scale, GIF header, sheet metadata, code) and the importer with many colors. Tests use
temporary folders and never touch `output/`.
