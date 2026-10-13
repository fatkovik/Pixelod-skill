# CLI reference

```
node pixelart.js <command> [arguments] [options]
node pixelart.js help [ops | <command>]
node pixelart.js <command> --help
```

Every command prints the paths of the files it wrote. Errors start with `Error:` and exit with code 1.

## Common concepts

**Documents** are `<name>.pixel.json` files (format: [documents.md](documents.md)). Wherever a command takes
`<name>`, you can pass:

- a bare name such as `knight`, which means `<working folder>/knight/knight.pixel.json`, or
- a path to a `.pixel.json` file anywhere.

**Working folder** for documents, in priority order: `--dir <folder>`, the `PIXELART_DIR` environment variable,
or the `output` folder next to `pixelart.js`. Every piece gets its own subfolder `<name>/` with the document, its
script (by convention), the preview and the strip. Documents saved flat (`<working folder>/<name>.pixel.json`) by
older versions are still found.

**Final folder** for exports (`export`, `convert`), in priority order: `--out <folder>`, the `PIXELART_FINAL_DIR`
environment variable, or the `final-output` folder next to `pixelart.js`. It only ever receives finished files.

**Overwriting**: `new`, `import` and `convert` refuse to replace an existing document without `--force`.
`build` replaces a document only if it was built from the same script (or with `--force`).

**Sizes and scales**: art is measured in art pixels (`--size 32x32`). `--scale n` means each art pixel becomes
n×n output pixels. When no scale is given, final PNGs are about 512 px on the long side.

---

## build

Recreate a document from a draw script. This is the recommended way to work: the script is the source of truth,
and every build starts from a clean canvas.

```
node pixelart.js build <script> [--name n] [--size 32x32] [--palette none|<preset>] [--colors "k=#000,..."]
                       [--frame n] [--quiet] [--force] [--dir folder]
```

| Option | Default | Meaning |
|---|---|---|
| `--name` | script file name without extension | Document name |
| `--size` | `32x32` | Starting canvas size (a `canvas w h` line in the script overrides it) |
| `--palette` | `none` | Starting palette; usually the script defines its own colors |
| `--colors` | | Extra `symbol=#hex` colors, comma separated |
| `--frame` | `0` | Frame shown in the zoomed preview |
| `--quiet` | off | Skip previews and lint output |
| `--force` | off | Replace a document that was not built from this script |

Writes `<name>.pixel.json`, `<name>.preview.png` (zoomed frame with grid and rulers) and, for animations,
`<name>.strip.png`, then prints lint warnings (infos are counted but hidden).

## new

Create an empty document.

```
node pixelart.js new <name> [--size WxH | --width n --height n] [--palette <preset>|none] [--colors "k=#000,w=#fff"]
                     [--frames n] [--force]
```

- Default size `32x32`, default palette `sweetie16`. With `--colors` only, the palette is just those colors.
- `--palette` and `--colors` combine: the preset first, then your colors (taking their symbols).
- Prints the palette legend (symbol, hex).

## import

Convert an image into an editable document. Details and tips: [importing.md](importing.md).

```
node pixelart.js import <image> [--name n] [--grid 48] [--grid-height n] [--colors n | --palette <preset>]
                        [--dither] [--resample box|nearest] [--preview] [--force]
```

| Option | Default | Meaning |
|---|---|---|
| `--name` | image file name | Document name |
| `--grid` | `48` | Width of the art in pixels |
| `--grid-height` | keep aspect ratio | Height of the art |
| `--colors` | keep all if ≤ 64, else 32 | Maximum palette size (median cut) |
| `--palette` | | Snap colors to a preset instead |
| `--dither` | off | Ordered (Bayer) dithering while reducing colors |
| `--resample` | `box` | `box` averages each cell (photos); `nearest` samples the center (sources that are already pixel art) |
| `--preview` | off | Also write the zoomed preview |

Supported inputs: PNG, JPEG, GIF (first frame), WebP. Pixels that are more than half transparent become transparent.

## draw (alias: edit)

Run drawing commands on an existing document. Commands: [scripting.md](scripting.md).

```
node pixelart.js draw <name> ["command" ...] [--script file] [--stdin] [--frame n] [--layer name] [--preview] [--onion]
```

- Commands come from positional arguments (one command each), a `--script` file and/or `--stdin`, in that order.
- `--frame` / `--layer` set where drawing starts (default frame 0, first layer).
- The document is saved only if every command succeeds; on an error nothing changes.
- `--preview` writes the zoomed preview (and the strip for animations); `--onion` adds the previous frame as a ghost.

Examples:

```
node pixelart.js draw knight "palette set e #2050c0" "palette set f #3070e0"
node pixelart.js draw knight --frame 2 --layer upper "shift 0 1" --preview
type fixes.txt | node pixelart.js draw knight --stdin          (Windows)
cat fixes.txt | node pixelart.js draw knight --stdin           (macOS/Linux)
```

## render

Write a PNG for looking at the art (not a final export).

```
node pixelart.js render <name> [--frame n | --all | --tag t] [--scale n] [--grid] [--rulers] [--onion]
                        [--bg checker|none|#hex] [--out file]
```

| Option | Meaning |
|---|---|
| `--frame n` | Frame to show (default 0) |
| `--all` / `--tag t` | Frame strip of all frames / of one tag, with index and duration labels (wraps after 8 frames) |
| `--scale n` | Zoom; default fits about 480 px (between 4 and 24) |
| `--grid` | Pixel grid; every 8th line is highlighted |
| `--rulers` | Coordinate labels along the top and left edges |
| `--onion` | Previous frame (wrapping to the last) drawn faintly underneath |
| `--bg` | Background: `checker` (default), `none` (transparent) or a color |
| `--out` | Output file (default `<name>.preview.png`, or `<name>.strip.png` for strips) |

## lint

Objective quality report for all frames.

```
node pixelart.js lint <name> [--max-colors 16] [--json]
```

| Code | Level | Meaning |
|---|---|---|
| `empty` | warn | A frame has no visible pixels |
| `orphan` | info/warn | Pixels with no same-colored neighbor, grouped by color (eyes and glints are fine) |
| `hole` | info | Transparent pixels enclosed by the shape |
| `outline` | info | No single color dominates the silhouette edge |
| `edge` | info | The art touches the canvas border |
| `palette-size` | warn | More colors used than `--max-colors` |
| `unused-colors` | info | Palette entries that no pixel uses |
| `near-colors` | info | Two used colors are almost identical |
| `low-contrast` | warn | The brightness range is too narrow for the form to read |
| `baseline` | info | The lowest pixel row moves between frames (feet sliding) |
| `duplicate-frame` | warn | A frame is identical to the previous one |
| `size-jump` | info | The silhouette size changes a lot between two frames |

`--json` prints `{ findings: [{ level, code, frame, message }], stats }`.

## info

```
node pixelart.js info <name>
```

Prints size, frame count, layers, durations, tags, the source script (for built documents), the frame 0
bounding box and the palette legend with pixel counts.

## export

Write final files.

```
node pixelart.js export <name> [--format png|gif|sheet|frames|code|json] [--frame n] [--tag t] [--scale n]
                        [--cols n] [--filename base] [--out folder]
```

| Format | Output | Default scale |
|---|---|---|
| `png` (default) | `<base>.png`, one frame (default the first frame of the tag, or frame 0) | ~512 px long side |
| `gif` | `<base>.gif`, animated, transparent, loops forever | ~256 px long side |
| `sheet` | `<base>.sheet.png` + `<base>.sheet.json` (Aseprite layout) | 1 (native pixels) |
| `frames` | `<base>-00.png`, `<base>-01.png`, ... | ~512 px long side |
| `code` | `<base>.js`, a DataPixels program (with a player for animations) | ~256 px long side |
| `json` | `<base>.pixel.json`, a copy of the document | |

- `--tag t` limits `gif`, `sheet`, `frames` and `png` to that animation; the base name becomes `<name>-<tag>`.
- `--cols n` sets the sprite sheet columns (default: one row).
- `--filename` overrides the base name; `--out` the folder (default: the final folder).

Sheet JSON details: [animation.md](animation.md#sprite-sheets).

## convert

One-shot conversion, kept for quick use and backwards compatibility.

```
node pixelart.js convert <image> [--grid 48] [--colors n] [--palette p] [--dither] [--resample box|nearest]
                         [--scale n] [--code] [--name n] [--out folder] [--force]
node pixelart.js convert <program.js> [--name n] [--out folder]
node pixelart.js <image or program.js> [options]           (same as convert)
```

- For images: writes `<name>-pixel.png` (and with `--code` a DataPixels program) to the final folder, and the
  editable `<name>-pixel.pixel.json` to its work folder `<working folder>/<name>-pixel/`. `--size` is accepted as an old name for `--scale`.
- For `.js` files: runs a DataPixels program (like the Playground examples) and saves everything it appends to
  the page as PNG. **This executes the file as code; only use files you trust.** CSS styling is ignored.

## palettes

```
node pixelart.js palettes            # list presets
node pixelart.js palettes pico8      # symbols and colors of one preset
```

Presets: `pico8` (16), `sweetie16` (16), `db16` (16), `endesga32` (32), `gameboy` (4), `mono` (2).

## ramp

```
node pixelart.js ramp "#c0392b" 5
```

Prints a hue-shifted shading ramp from dark to light: shadows lean toward blue-purple along the shortest hue
path (yellow shadows go through orange, not green), highlights toward warm yellow. Inside scripts use
`palette ramp #hex symbols`.

## config

Show or change settings. Settings are stored in `pixelart.config.json` in the Pixelod Skill folder, or in the file named by the
`PIXELART_CONFIG` environment variable. The file only holds values that differ from the defaults; it is deleted
when everything is back to default.

```
node pixelart.js config                         # all settings with descriptions and the config file path
node pixelart.js config <key>                   # one setting
node pixelart.js config <key> <value>           # change a setting
node pixelart.js config <key> default           # restore one setting
node pixelart.js config reset                   # restore all settings
```

| Setting | Default | Values | Meaning |
|---|---|---|---|
| `iterations` | `auto` | `auto`, or `1`…`20` | Critique-and-fix rounds the `/pixelart` skill does after the first build. `auto`: at least 2, usually 3, stopping when no concrete problems are left. A number: exactly that many rounds |

Settings are shared by every project that uses this Pixelod Skill folder (also with a global skill install).
The CLI commands themselves do not change behavior with `iterations`; it is read by the skill
(see [skill.md](skill.md#iterations)).

## install-skill

```
node pixelart.js install-skill --dest <project folder>
node pixelart.js install-skill --global
```

See [skill.md](skill.md).

## Limits

| Limit | Value |
|---|---|
| Canvas size | 1024 × 1024 art pixels |
| Script coordinates and sizes | −4096 … 4096 |
| Frames (`frames n`) | 256 |
| Frame duration | 10 … 60000 ms |
| `scale` script command | 1 … 8 |
| Any output image side | 8192 px |
| GIF palette | 255 colors |
| Palette symbols | one character; not space, `.`, `#`, `"` or `\` |
