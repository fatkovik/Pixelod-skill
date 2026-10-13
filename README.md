# Pixelod Skill — pixel art for the command line and Claude Code

Create, convert, edit and animate pixel art from a terminal, or just ask Claude for it with `/pixelart`.

- **Draw** with a small script language: shapes, stamped rows of pixels, symmetry, outlines, dithering, layers.
- **Convert** photos and images into clean, limited-palette pixel art.
- **Animate** with frames, layers, onion skinning and named animation tags.
- **Look and check**: zoomed previews with a pixel grid and coordinate rulers, frame strips, and a quality linter.
- **Export** PNG, animated GIF, sprite sheets with engine-ready JSON, numbered frames, or DataPixels code.
- **Claude Code skill** (`/pixelart`) that drives the tools in a draw → look → critique → fix loop, with a
  configurable number of iterations.

Final renders go through `DataPixels.js`, the same class used by the Data Pixels Playground in the
[Pixelod](https://github.com/fatkovik/Pixelod) project.

```
write script -> build (preview + lint) -> look -> fix script -> build ... -> export
```

---

## Requirements

- **Node.js 20 or newer** (tested on 22).
- Windows, macOS or Linux. The only native dependency, `@napi-rs/canvas`, ships prebuilt binaries, so no
  compiler, Python or Visual Studio is needed.
- For the `/pixelart` skill: [Claude Code](https://claude.com/claude-code).

## Installation

Open a terminal in the Pixelod Skill folder (the one containing `pixelart.js`) and run:

```
npm install
npm test            # optional: 22 tests, should all pass
```

Check that it works:

```
node pixelart.js help
node pixelart.js build examples/knight.pixelscript
```

The second command writes `output/knight.pixel.json`, `output/knight.preview.png` and `output/knight.strip.png`.

### Install the `/pixelart` skill

The skill is a single `SKILL.md` file. The installer copies it into a project, or into your user folder for every
project, and fills in the absolute path of the Pixelod Skill folder:

```
node pixelart.js install-skill --dest <project folder>     # -> <project>/.claude/skills/pixelart/SKILL.md
node pixelart.js install-skill --global                    # -> ~/.claude/skills/pixelart/SKILL.md
```

Start a new Claude Code session (or restart the current one) after installing so the skill is picked up.

> The installed skill calls `pixelart.js` by absolute path. If you move or rename the Pixelod Skill folder,
> run `install-skill` again.

### Optional: a global `pixelart` command

`package.json` declares a `pixelart` binary. To call it from anywhere:

```
npm link            # in the Pixelod Skill folder
pixelart help
```

---

## Usage with Claude Code

Open Claude Code in a project where the skill is installed and type `/pixelart` followed by what you want:

```
/pixelart a 32x32 knight with a red cape, 4-frame idle animation
/pixelart a 16x16 health potion icon in the pico8 palette
/pixelart convert D:\pics\cat.jpg 32 wide, 12 colors
/pixelart edit knight: make the cape blue and add a 6-frame walk cycle
/pixelart a 24x24 coin spin, 8 frames, export a sprite sheet for Godot
```

Claude picks a size and palette, writes a `.pixelscript`, builds it, looks at the preview, fixes what it sees
for the configured number of iterations, runs the linter and exports. You get the output paths at the end; the
document and its script stay in the `output` folder so you can ask for changes later. Asking in plain words
("make me pixel art of a slime") also works; `/pixelart` just guarantees the skill is used.

Claude Code asks for permission before running `node .../pixelart.js` and before writing scripts; choose
"always allow" for those to skip the prompts. More: [docs/skill.md](docs/skill.md).

### How many iterations Claude does

After the first build, Claude does a number of **critique-and-fix rounds** (look at the render, list problems,
fix, rebuild). By default (`auto`) that is at least 2, usually 3, stopping when nothing concrete is left. More
rounds give more polish and take longer; fewer are faster.

```
node pixelart.js config iterations 5        # always do exactly 5 rounds (1-20)
node pixelart.js config iterations 1        # quick drafts
node pixelart.js config iterations auto     # back to the default
node pixelart.js config                     # show all settings
```

You can also change it from Claude Code (`/pixelart set iterations to 5`) or for a single request only:
`/pixelart a 16x16 sword icon, 4 iterations`.

## Usage from the command line

All commands are `node pixelart.js <command> ...`, run from the Pixelod Skill folder.

### Draw something

Write a script, for example `output/gem.pixelscript`:

```
canvas 16 16
palette add k #1d1431              # outline
palette ramp #3b9be0 abcd          # blue ramp: a darkest ... d lightest
poly b 8 1 14 6 8 15 2 6           # gem body
line 8 1 8 15 d                    # highlight facet
replace b a 9 0 7 16               # shade the right side
outline k
```

Build it, look at the preview, export:

```
node pixelart.js build output/gem.pixelscript      # -> gem.pixel.json, gem.preview.png, lint warnings
node pixelart.js export gem --scale 16              # -> output/gem.png (256x256)
```

Edit the script and run `build` again until it looks right.

### Convert a photo or image

```
node pixelart.js import photo.jpg --name cat --grid 32 --colors 12 --preview
node pixelart.js draw cat "outline a all" --preview   # touch up by hand
node pixelart.js export cat --scale 16
```

Or in one step, without touching it up: `node pixelart.js convert photo.jpg --grid 32 --colors 12`.

### Animate

```
node pixelart.js build examples/slime.pixelscript              # 4-frame bounce, writes slime.strip.png
node pixelart.js render slime --frame 2 --onion                # frame 2 over a ghost of frame 1
node pixelart.js export slime --format gif                     # output/slime.gif
node pixelart.js export slime --format sheet --scale 4         # slime.sheet.png + slime.sheet.json
```

### Command overview

| Command | What it does |
|---|---|
| `build <script>` | Recreate a document from a script, write previews, print lint warnings |
| `new <name>` | Create an empty document |
| `import <image>` | Convert an image into an editable document |
| `draw <name> [cmds]` (alias `edit`) | Run drawing commands on an existing document |
| `render <name>` | Write a preview PNG (grid, rulers, onion skin, frame strip) |
| `lint <name>` | Report pixel art quality problems |
| `info <name>` | Size, frames, tags, layers, palette legend |
| `export <name>` | Write PNG, GIF, sprite sheet, frames, DataPixels code or JSON |
| `convert <file>` | One-shot image → PNG, or render a DataPixels `.js` program |
| `palettes [name]`, `ramp <#hex>` | Preset palettes and shading ramps |
| `config [key [value]]` | Show or change settings, e.g. `config iterations 4` |
| `install-skill` | Install the `/pixelart` skill |
| `help [ops\|<command>]` | Command help; `help ops` lists every drawing command |

Documents are stored as `<name>.pixel.json` in the `output` folder. Use `--dir <folder>` or the
`PIXELART_DIR` environment variable to keep them elsewhere, and `--out <folder>` to export somewhere else.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/cli.md](docs/cli.md) | Every command and option, defaults, settings, limits |
| [docs/scripting.md](docs/scripting.md) | The drawing script language: all commands, syntax and examples |
| [docs/animation.md](docs/animation.md) | Frames, layers, tags, onion skin, GIF and sprite sheet export, engine import |
| [docs/importing.md](docs/importing.md) | Turning photos and images into pixel art: options and tips |
| [docs/documents.md](docs/documents.md) | The `.pixel.json` file format |
| [docs/skill.md](docs/skill.md) | How the `/pixelart` skill works: installing, iterations, customizing |
| [docs/development.md](docs/development.md) | Architecture, tests, adding commands and settings |

## Folder layout

```
pixelart.js            CLI entry point
lib/                   engine: document model, script engine, renderer, importer, linter, palettes, settings
skill/pixelart/        source of the /pixelart skill (installed copies are generated from it)
examples/              knight.pixelscript, slime.pixelscript
docs/                  documentation
test/                  node:test suite
output/                default folder for documents, previews and exports (git-ignored)
pixelart.config.json   your settings, created by `config` only when you change something (git-ignored)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `/pixelart` is not offered in Claude Code | Install the skill for that project (or `--global`), then start a new session |
| The skill runs but `node` cannot find `pixelart.js` | The Pixelod Skill folder moved or was renamed: run `node pixelart.js install-skill ...` again |
| `Cannot find module '@napi-rs/canvas'` | Run `npm install` in the Pixelod Skill folder |
| `Document not found: ...output\name.pixel.json` | Check the name with `dir output` (`ls output`), or pass the full path to the `.pixel.json` |
| `... already exists (use --force ...)` | Commands never overwrite your work silently; add `--force` or choose another `--name` |
| `Line N "...": ...` | A script error; the message names the line (and row/column inside `put` blocks) |
| A converted photo looks muddy | Use fewer colors (`--colors 8-16`) or a preset palette, a smaller `--grid`, then clean up by hand |
| Claude stops too early or takes too long | Set the number of rounds: `node pixelart.js config iterations <1-20|auto>` |

## Credits and license

Built on [DataPixels.js](https://github.com/gmattie/Data-Pixels) by Geoffrey Mattie (MIT), included as
`lib/DataPixels.js`. Preset palettes: PICO-8 (Lexaloffle), Sweetie 16 (GrafxKid), DawnBringer 16, Endesga 32,
Game Boy. Uses [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) and
[`gifenc`](https://github.com/mattdesl/gifenc) (both MIT).
