# Pixelod Skill

CLI pixel art toolbox plus the `/pixelart` Claude Code skill (no Playground UI). User docs: `README.md` and `docs/`.

## Making pixel art

Prefer the `/pixelart` skill (`skill/pixelart/SKILL.md`; installed for this repo at `../.claude/skills/pixelart`).
The loop is **write a `.pixelscript` -> `build` (writes preview, strip and lint) -> view the PNG -> critique ->
fix the script -> `build` ... -> `export`**. Never deliver pixel art without having looked at a render.

```
node pixelart.js build output/<name>.pixelscript               # recreate <name>.pixel.json + previews + lint warnings
node pixelart.js draw <name> "px 1 2 a" ... [--preview]        # small one-off edits
node pixelart.js render <name> [--all|--tag t|--frame n --onion] --grid --rulers
node pixelart.js lint <name>
node pixelart.js export <name> --format png|gif|sheet|frames|code|json [--tag t]
node pixelart.js import <image> --grid 32 --colors 12 --preview  # photo -> editable document
node pixelart.js help ops                                       # drawing command reference
```

Default folder for documents and exports: `output/` (next to `pixelart.js`) (override with `--dir` / `--out` or `$PIXELART_DIR`).

## Architecture

- `pixelart.js`: command dispatcher (`build new draw render lint info import export convert palettes ramp config install-skill help`).
- `lib/document.js`: `.pixel.json` model (palette symbol -> hex, frames, layers, rows of symbols, tags, source; `.` transparent).
- `lib/ops.js`: the script engine behind `build`/`draw`; its `HELP` text is the single source for `help ops`.
- `lib/render.js`: preview (checker/grid/rulers/onion), strip, final PNG (through `lib/DataPixels.js`), sheet (Aseprite JSON), GIF (gifenc), code export.
- `lib/importer.js`: image -> document (pre-shrink, box/nearest resample, median cut or preset palette, Bayer dither).
- `lib/lint.js`: checks. `lib/palettes.js`: presets + `makeRamp` (hue-shifted ramps).
- `lib/config.js`: settings in `pixelart.config.json` (`config` command). `iterations` = critique-and-fix rounds the skill does (`auto` default).
- `lib/environment.js` shims `document`, `Image`, `ImageData` (via `@napi-rs/canvas`) so `DataPixels.js` runs under Node.
- `lib/DataPixels.js` is a copy of `../resources/source/js/dataPixels/DataPixels.js`; keep them in sync.

## Rules

- ESM, Node >= 20. Run `npm install` in this folder; `npm test` must pass after changes (`node --test test/pixelart.test.js`).
- When you add or change a draw command: update `HELP` in `lib/ops.js`, `docs/scripting.md` and `skill/pixelart/SKILL.md`,
  add a test, then run `node pixelart.js install-skill --dest ..` so the installed copy refreshes.
- Loops in draw commands must stay clipped to the canvas (`eachVisibleCell`/`clip`); coordinates are capped at +-4096.
- Never spread large arrays into `Math.max/min` (stack overflow on big imports); use loops.
- `convert` / `.js` input executes the file as code; only do that for files the user supplied or that live in this repo.
- Do not run any git operation unless the user explicitly asks (see the root `CLAUDE.md`).
