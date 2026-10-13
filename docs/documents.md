# Document format (`.pixel.json`)

A document is a readable JSON file. Pixels are stored as rows of one-character palette symbols, so documents
are easy to inspect, diff and even edit by hand.

```json
{
  "version": 1,
  "name": "gem",
  "width": 4,
  "height": 3,
  "palette": {
    "k": "#1d1431",
    "b": "#3b9be0"
  },
  "tags": [
    { "name": "shine", "from": 0, "to": 1 }
  ],
  "source": "D:\\Projects\\pixelod-skill\\output\\gem.pixelscript",
  "frames": [
    {
      "duration": 100,
      "layers": [
        {
          "name": "main",
          "visible": true,
          "rows": [
            ".kk.",
            "kbbk",
            ".kk."
          ]
        }
      ]
    }
  ]
}
```

## Fields

| Field | Type | Meaning |
|---|---|---|
| `version` | number | Always `1` |
| `name` | string | Document name (used for output file names) |
| `width`, `height` | integers | Canvas size in art pixels, 1…1024 |
| `palette` | object | Symbol → `#rrggbb`. Order is kept. |
| `tags` | array | Optional. `{ name, from, to }` frame ranges (inclusive) |
| `source` | string | Optional. Absolute path of the script that `build` created this document from |
| `frames` | array | At least one frame |
| `frames[].duration` | integer | Milliseconds, 10…60000 |
| `frames[].layers` | array | Bottom to top; every frame has the same layer names in the same order |
| `layers[].visible` | boolean | Hidden layers are not rendered or exported |
| `layers[].rows` | string[] | `height` strings of `width` symbols each |

## Symbols

- `.` is transparent.
- Every other symbol must be a palette key: one character, not a space, `.`, `#`, `"` or `\`.
- Imported images and presets use letters first (`a`, `b`, ...), then digits and punctuation.

## Validation

Loading checks the size, the row and column counts of every layer, that all frames share the same layers, that
tags point at existing frames, and that palette symbols are valid. After every script run, every pixel must use a
symbol that exists in the palette. Errors name the frame, layer and row.

## Editing by hand

You can edit `rows` directly (keep the row length), change colors in `palette`, or change durations. Run
`node pixelart.js info <name>` afterwards to check that it still loads. If the document has a `source` script,
prefer editing the script and running `build`, otherwise the next build replaces your hand edits.
