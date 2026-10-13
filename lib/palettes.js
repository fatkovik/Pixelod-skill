/**
 * @description The <strong>palettes.js</strong> module contains preset palettes and color helpers
 * (nearest color, luminance, shading ramps).
 * @module
 *
 */
import { SYMBOL_ALPHABET, hexToRgb, normalizeHex, rgbToHex } from "./document.js";

export {

    PRESETS,
    colorDistance,
    luminance,
    makeRamp,
    nearestIndex,
    paletteFromPreset,
    presetNames
};

const PRESETS = {

    pico8: {

        description: "PICO-8, 16 colors",
        colors: ["000000", "1d2b53", "7e2553", "008751", "ab5236", "5f574f", "c2c3c7", "fff1e8", "ff004d", "ffa300", "ffec27", "00e436", "29adff", "83769c", "ff77a8", "ffccaa"]
    },
    sweetie16: {

        description: "Sweetie 16 by GrafxKid, 16 colors",
        colors: ["1a1c2c", "5d275d", "b13e53", "ef7d57", "ffcd75", "a7f070", "38b764", "257179", "29366f", "3b5dc9", "41a6f6", "73eff7", "f4f4f4", "94b0c2", "566c86", "333c57"]
    },
    db16: {

        description: "DawnBringer 16 colors",
        colors: ["140c1c", "442434", "30346d", "4e4a4e", "854c30", "346524", "d04648", "757161", "597dce", "d27d2c", "8595a1", "6daa2c", "d2aa99", "6dc2ca", "dad45e", "deeed6"]
    },
    endesga32: {

        description: "Endesga 32, 32 colors",
        colors: [

            "be4a2f", "d77643", "ead4aa", "e4a672", "b86f50", "733e39", "3e2731", "a22633",
            "e43b44", "f77622", "feae34", "fee761", "63c74d", "3e8948", "265c42", "193c3e",
            "124e89", "0099db", "2ce8f5", "ffffff", "c0cbdc", "8b9bb4", "5a6988", "3a4466",
            "262b44", "181425", "ff0044", "68386c", "b55088", "f6757a", "e8b796", "c28569"
        ]
    },
    gameboy: {

        description: "Game Boy, 4 greens",
        colors: ["0f380f", "306230", "8bac0f", "9bbc0f"]
    },
    mono: {

        description: "Black and white",
        colors: ["000000", "ffffff"]
    }
};

function presetNames() {

    return Object.keys(PRESETS);
}

/**
 * @description Builds a symbol -> color map from a preset, handing out symbols from SYMBOL_ALPHABET.
 * @param {string} name - Preset name.
 * @param {string[]} [reserved] - Symbols that must not be used.
 * @returns {Object}
 * @public
 *
 */
function paletteFromPreset(name, reserved = []) {

    const preset = PRESETS[name.toLowerCase()];

    if (!preset) {

        throw new Error(`Unknown palette "${name}". Available: ${presetNames().join(", ")}.`);
    }

    const symbols = [...SYMBOL_ALPHABET].filter((symbol) => !reserved.includes(symbol));
    const palette = {};

    preset.colors.forEach((hex, index) => {

        palette[symbols[index]] = `#${hex}`;
    });

    return palette;
}

function colorDistance(a, b) {

    // Weighted RGB ("redmean") is a cheap, decent perceptual approximation.
    const rMean = (a[0] + b[0]) / 2;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];

    return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
}

function luminance([r, g, b]) {

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * @description Index of the color in "colors" (array of [r, g, b]) closest to "color".
 * @public
 *
 */
function nearestIndex(color, colors) {

    let best = 0;
    let bestDistance = Infinity;

    colors.forEach((candidate, index) => {

        const distance = colorDistance(color, candidate);

        if (distance < bestDistance) {

            bestDistance = distance;
            best = index;
        }
    });

    return best;
}

function rgbToHsl([r, g, b]) {

    r /= 255; g /= 255; b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;

    if (max !== min) {

        const d = max - min;

        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;

        h /= 6;
    }

    return [h, s, l];
}

function hslToRgb([h, s, l]) {

    if (s === 0) return [l * 255, l * 255, l * 255];

    const hue = (p, q, t) => {

        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;

        return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

/**
 * @description Generates a shading ramp (dark -> light) from a base color.  Shadows are shifted toward
 * blue/purple and made a little less saturated-bright, highlights toward yellow, which is the usual
 * pixel art convention and avoids muddy "just darker" shades.
 * @param {string} base - "#rrggbb" mid tone.
 * @param {number} [steps = 4] - Number of shades (2..9).
 * @returns {string[]} Hex colors, darkest first.
 * @public
 *
 */
function makeRamp(base, steps = 4) {

    if (!Number.isInteger(steps) || steps < 2 || steps > 9) {

        throw new Error("Ramp steps must be an integer from 2 to 9.");
    }

    const [h, s, l] = rgbToHsl(hexToRgb(normalizeHex(base)));
    const mid = (steps - 1) / 2;
    const out = [];

    for (let i = 0; i < steps; i++) {

        const t = (i - mid) / Math.max(mid, 1);        // -1 (shadow) .. +1 (light)
        // Shadows lean toward blue-purple (260 degrees) along the shortest hue path: yellow goes through
        // orange, red toward magenta, green toward teal.  Highlights lean toward warm yellow (54 degrees).
        const hueShift = (t < 0 ? 0.72 - h : 0.15 - h);
        let nh = h + ((((hueShift + 0.5) % 1) + 1) % 1 - 0.5) * Math.abs(t) * 0.18;

        nh = ((nh % 1) + 1) % 1;

        const nl = Math.max(0.06, Math.min(0.94, l + t * 0.26));
        const ns = Math.max(0, Math.min(1, s * (1 - Math.abs(t) * 0.12)));

        out.push(rgbToHex(hslToRgb([nh, ns, nl])));
    }

    return out;
}
