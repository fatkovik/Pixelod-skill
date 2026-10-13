# Drawing script language

Scripts are plain text, one command per line. They are used by `build <script>`, `draw --script`, `draw --stdin`
and inline as `draw <name> "command" "command"`. `node pixelart.js help ops` prints the short reference.

```
canvas 24 24                        # size first
palette add k #1b1030               # outline color
palette ramp #5ccf5c abcd           # green ramp, a = darkest ... d = lightest
ellipse 3 6 18 15 b                 # body
ellipse 6 7 9 6 c                   # lit area
px 8 9 d                            # highlight
outline k
```

## Basics

- **Coordinates** are 0-based: `x` grows to the right, `y` grows down. `0 0` is the top-left pixel.
- **Colors** are palette symbols: one character each, defined with `palette add`, `palette ramp`, a preset or
  `--colors`. `.` is transparent (erases).
- **Comments**: lines starting with `#` or `//`, and anything after ` # ` or ` // ` at the end of a line.
  Hex colors such as `#ff8800` are not comments.
- **Clipping**: shapes may extend past the canvas; only the visible part is drawn.
- **Current frame and layer**: drawing commands work on the current layer of the current frame (frame 0 and the
  first layer, `main`, unless `--frame`/`--layer` or `frame`/`layer` commands change it).
- **Errors** stop the script and name the line (and row/column inside `put`/`blit` blocks). With `draw`, nothing
  is saved when an error occurs.

## Drawing

| Command | Effect |
|---|---|
| `px x y c` | One pixel |
| `line x0 y0 x1 y1 c` | 1 px line (Bresenham) |
| `lines c x1 y1 x2 y2 ...` | Connected lines through the points (open) |
| `rect x y w h c` | Filled rectangle |
| `box x y w h c` | Rectangle outline |
| `ellipse x y w h c` | Filled ellipse inside the box `x y w h` |
| `ring x y w h c` | Ellipse outline inside the box |
| `poly c x1 y1 x2 y2 x3 y3 ...` | Filled polygon; every point is a pixel on its outline |
| `fill x y c` | Flood fill (4-connected) from `x y`, replacing that color |
| `dither x y w h a b [pattern]` | Two-color pattern: `checker` (default), `rows`, `cols`, or `bayer N` with density N = 0…16 |

### Stamping rows of pixels

`put` and `blit` stamp a block of rows at `x y`. The rows follow on the next lines and end with a line `end`:

```
put 8 2
..kkkk..
.kbbbbk.
kbccccbk
.kbbbbk.
..kkkk..
end
```

- `put`: every character is written, so `.` erases.
- `blit`: `.` is skipped, so what is underneath stays (useful for overlays).

Writing rows is the most precise way to draw small details, faces and hand-tuned curves.

### Editing pixels

| Command | Effect |
|---|---|
| `clear` / `clear x y w h` | Erase the layer, or a region |
| `copy x y w h tx ty` | Copy a region to `tx ty` |
| `move x y w h dx dy` | Move a region by `dx dy` (transparent pixels in the region are not pasted) |
| `replace a b` / `replace a b x y w h` | Change color `a` to `b` on this layer, optionally only inside a region |
| `mirror left\|right\|top\|bottom` | Copy that half onto the opposite half, mirrored (symmetry) |
| `outline c [4\|8] [all]` | Surround shapes with color `c` (4-connected by default, `8` includes diagonals). `all` traces the combined silhouette of all visible layers, drawing on the current layer |
| `shift dx dy [wrap]` | Move all pixels of the layer; `wrap` wraps around the edges |
| `flip h\|v layer` | Mirror only the current layer of the current frame |

## Whole document (all frames and layers)

| Command | Effect |
|---|---|
| `flip h` / `flip v` | Mirror horizontally / vertically |
| `rotate 90\|180\|270` | Rotate clockwise; 90 and 270 swap width and height |
| `crop x y w h` | Keep only a region |
| `canvas w h [anchor]` | Resize the canvas without scaling; anchor `tl t tr l c r bl b br` (default `tl`) |
| `scale n` | Nearest-neighbor upscale by 1…8 |
| `recolor a b` | Change every `a` pixel to `b` everywhere |

## Palette

| Command | Effect |
|---|---|
| `palette add c #hex` | Add a color (fails if `c` exists) |
| `palette set c #hex` | Add or change a color; every `c` pixel changes with it |
| `palette del c` | Remove a color; its pixels become transparent |
| `palette load <preset>` | Replace the palette with a preset (`pico8 sweetie16 db16 endesga32 gameboy mono`) |
| `palette remap <preset>` | Snap every used color to the nearest preset color and switch to the preset's symbols |
| `palette ramp #hex symbols` | Add a hue-shifted shading ramp, one shade per symbol, darkest first: `palette ramp #c0392b efgh` |

Ramp symbols must be unused; the command refuses to overwrite existing colors. Symbols are single characters
other than space, `.`, `#`, `"` and `\`; letters keep scripts readable.

## Layers

| Command | Effect |
|---|---|
| `layer <name>` | Select a layer; creates it on top (in every frame) if missing |
| `layer hide <name>` / `layer show <name>` | Toggle visibility (hidden layers are not rendered or exported) |
| `layer del <name>` | Delete a layer from every frame |

Layers are composited in creation order, later layers on top. Every frame has the same layers.

## Frames and animation

| Command | Effect |
|---|---|
| `frame <n>` | Select frame n |
| `frame add [copy]` | Append a frame (empty, or a copy of the current frame) and select it |
| `frames <n> [copy]` | Add frames until there are n (empty, or copies of the current frame) |
| `frame del [n]` | Delete frame n (default: current); tags are adjusted |
| `frame dur <ms>` / `frame dur <n> <ms>` / `frame dur all <ms>` | Frame duration |
| `tag <name> <from> <to>` | Name a frame range as an animation (replaces a tag with that name) |
| `tag del <name>` | Remove a tag |

More in [animation.md](animation.md).

## Patterns that work well

**Script as source of truth.** Keep the whole drawing in one script and rebuild it with `build` after every
change. Fixing an early mistake is then one edit, not a pile of corrections.

**Symmetric characters.** Draw the left half with `put` rows, then `mirror left`, then break the symmetry
(a sword in one hand, a lock of hair).

**Lighting.** After mirroring, darken the side away from the light by replacing colors in a region, darkest
first so shades do not cascade:

```
replace b a 18 0 14 32
replace c b 18 0 14 32
replace d c 18 0 14 32
```

**Outlines last.** Draw shapes without outlines, then `outline k` (one layer) or `outline k all` (whole
silhouette) at the end.

**Parts on layers.** Put parts that move independently (a cape, an arm, a head) on their own layers so frames can
`shift`, `move` or `flip h layer` them.

## Complete examples

- [`examples/knight.pixelscript`](../examples/knight.pixelscript): 32×32 character, three layers, ramps, mirroring,
  region lighting, 4-frame idle with a tag.
- [`examples/slime.pixelscript`](../examples/slime.pixelscript): 16×16 squash-and-stretch bounce.
