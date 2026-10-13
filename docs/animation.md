# Animation

A document holds one or more **frames**. Each frame has the same **layers**, its own pixels, and a **duration**
in milliseconds. **Tags** name frame ranges, so one document can hold several animations (idle, walk, attack).

## Workflow

1. **Finish frame 0** completely: the pose, colors, outline. Put parts that move on their own layers.
2. **Copy it** into the other frames: `frames 4 copy`.
3. **Change only what moves**, frame by frame:
   ```
   frame 1
   layer upper
   shift 0 1                  # body down 1 px (breathing)
   frame 2
   layer arm
   move 20 14 4 6 1 -1        # nudge a region
   frame 3
   layer cape
   flip h layer               # mirror just this layer
   ```
4. **Timing**: `frame dur all 150`, then hold extremes longer, e.g. `frame dur 2 220`.
5. **Tag** the animation: `tag idle 0 3`.
6. **Review**: `build` writes `<name>.strip.png` with every frame and its duration. Use
   `render <name> --frame 2 --onion` to see frame 2 over a ghost of frame 1.
7. **Lint**: `duplicate-frame`, `baseline` (feet moving) and `size-jump` (popping) are animation checks.
8. **Export** a GIF to watch it, and a sprite sheet for a game.

## Timing guide

| Animation | Frames | Duration per frame |
|---|---|---|
| Idle / breathing | 2–4 | 150–250 ms |
| Walk | 4–8 | 100–140 ms |
| Run | 6–8 | 70–100 ms |
| Attack | 3–5 | anticipation 100–150, impact 50–80, recovery 120–200 ms |
| Looping effect (fire, water, coin) | 4–8 | 60–120 ms |

Principles: keep the feet (baseline) fixed unless the character leaves the ground; move the body 1–2 px, not 5;
squash on landing, stretch in the air; the last frame must lead back into frame 0.

## Several animations in one document

```
frames 4 copy          # 0-3: idle
...
frames 10 copy         # 4-9: walk (copies of the current frame)
...
tag idle 0 3
tag walk 4 9
```

Deleting a frame (`frame del n`) shifts the tags so they keep pointing at the same frames.

`--tag <name>` works on `render` (strip of that tag) and on `export` with `png`, `gif`, `sheet` and `frames`.
The exported files are named `<name>-<tag>.*`.

## GIF

```
node pixelart.js export knight --format gif [--tag idle] [--scale 8]
```

Transparent background, loops forever, per-frame durations. Default size is about 256 px on the long side.
Browsers treat delays below 20 ms as slower than written, so keep durations ≥ 20 ms.

## Sprite sheets

```
node pixelart.js export knight --format sheet [--scale 1] [--cols 4] [--tag walk]
```

Writes `<name>.sheet.png` (frames left to right, top to bottom; default one row, native pixel size) and
`<name>.sheet.json` in the Aseprite "array" layout:

```json
{
  "frames": [
    {
      "filename": "knight 0.png",
      "frame": { "x": 0, "y": 0, "w": 32, "h": 32 },
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 32, "h": 32 },
      "sourceSize": { "w": 32, "h": 32 },
      "duration": 200
    }
  ],
  "meta": {
    "app": "ClaudePackage pixelart",
    "image": "knight.sheet.png",
    "format": "RGBA8888",
    "size": { "w": 128, "h": 32 },
    "scale": "1",
    "frameTags": [ { "name": "idle", "from": 0, "to": 3, "direction": "forward" } ],
    "columns": 4,
    "rows": 1
  }
}
```

With `--tag`, only that tag's frames are included and `frameTags` is rebased to the exported frames.

### Using the sheet in an engine

- **Phaser 3**: `this.load.atlas("knight", "knight.sheet.png", "knight.sheet.json")` (JSON-array atlas: every
  frame by its `filename`). Phaser's `load.aseprite` / `anims.createFromAseprite` read this layout and its
  `frameTags` too (not tested here).
- **Godot 4**: in an `AnimatedSprite2D`'s `SpriteFrames`, use *Add frames from sprite sheet* with
  `meta.columns` × `meta.rows` cells, or a `Sprite2D` with `hframes`/`vframes`. Godot does not read the JSON
  itself; take the durations from it.
- **Unity**: import the PNG as *Sprite (2D) → Multiple*, slice by cell size (frame `w`×`h`), set filter mode
  *Point* and compression *None* to keep pixels crisp.
- **Anything else**: the PNG is a regular grid; `frames[].frame` gives every rectangle and `duration` the timing.

Keep pixel art sharp: nearest-neighbor / point filtering, no mipmaps, integer scaling.

## Numbered frames

```
node pixelart.js export knight --format frames [--tag idle] [--scale 8]
```

Writes `knight-00.png`, `knight-01.png`, ... (frame index numbers).

## DataPixels code

```
node pixelart.js export knight --format code
```

Writes a DataPixels program with a `frames` array, `durations`, and a tiny player that cycles the frames in a
browser. Paste it into the Data Pixels Playground, or use it with the `data-pixels` npm package.
