# Converting images to pixel art

```
node pixelart.js import <image> --name cat --grid 32 --colors 12 --preview
```

`import` creates an editable document; `convert` does the same and immediately writes a PNG (for quick results
without touch-up).

## How it works

1. **Load** the image (PNG, JPEG, GIF first frame, WebP).
2. **Shrink** large images to about 8× the target grid with smooth scaling (fast, and avoids huge memory use).
3. **Resample** to the grid: `box` averages all source pixels in each cell (default, best for photos);
   `nearest` takes the center pixel (best when the source already is pixel art, e.g. an upscaled sprite).
4. **Transparency**: a cell that is more than half transparent becomes transparent.
5. **Reduce colors**:
   - `--palette <preset>` snaps every cell to the nearest preset color, or
   - `--colors n` builds an n-color palette with weighted median cut, or
   - by default, keeps every color when there are at most 64, otherwise reduces to 32.
6. **Dither** (`--dither`): ordered 4×4 Bayer dithering while mapping to the palette, which turns gradients into
   patterns instead of flat bands.
7. **Symbols** are assigned by brightness: `a` is the darkest color, then `b`, `c`, ...

## Choosing settings

| Source | Suggested settings |
|---|---|
| Portrait, pet, object photo | `--grid 32` to `64`, `--colors 10-16` |
| Landscape, sky, gradients | `--grid 64`, `--colors 12-16 --dither` |
| Logo, icon, flat illustration | `--grid 16` to `32`, `--colors 4-8` |
| A specific look | `--palette pico8`, `gameboy`, `endesga32`, ... |
| Upscaled pixel art or a screenshot of a sprite | `--grid <original sprite width> --resample nearest` |

Smaller grids and fewer colors read more like pixel art; large grids with many colors look like a blurry photo.
Crop the source to the subject before importing: background detail wastes pixels.

## Cleaning up (the step that makes it look good)

An automatic conversion is a starting point. Typical touch-ups with `draw`:

```
node pixelart.js render cat --grid --rulers              # find coordinates
node pixelart.js draw cat "outline a all"                # outline the silhouette with the darkest color
node pixelart.js draw cat "px 12 9 l" "px 19 9 l"         # restore eye highlights
node pixelart.js draw cat "replace e d 0 20 32 12"        # merge noisy shades in a region
node pixelart.js draw cat "palette set f #d98c4a"         # adjust a color everywhere
node pixelart.js lint cat                                 # orphans = noise to remove
```

Then `export` as usual. The `/pixelart` skill does this cleanup for you when you ask it to convert an image.

## Known limitations

- Photos from phones may carry an EXIF rotation that is not applied; rotate afterwards with `draw <name> "rotate 90"`.
- Animated GIFs: only the first frame is imported.
- Color matching uses a weighted RGB distance, which is fast and good, but not perceptually perfect.
