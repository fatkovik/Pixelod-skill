/**
 * @description The <strong>config.js</strong> module stores user settings for the toolbox and the /pixelart
 * skill in pixelart.config.json (next to pixelart.js, or the file named by $PIXELART_CONFIG).
 * @module
 *
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export {

    SETTINGS,
    configPath,
    describeSetting,
    loadConfig,
    resetConfig,
    setConfig
};

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @description Known settings: default value, validation and a description for `config` output and docs.
 *
 */
const SETTINGS = {

    iterations: {

        default: "auto",
        description: "critique-and-fix rounds the /pixelart skill does after the first build: " +
                     "\"auto\" = at least 2, usually 3, stop when no concrete problems are left; " +
                     "a number 1-20 = exactly that many rounds",
        parse(value) {

            const text = String(value).trim().toLowerCase();

            if (text === "auto" || text === "default") return "auto";

            const number = Number(text);

            if (!Number.isInteger(number) || number < 1 || number > 20) {

                throw new Error(`iterations must be "auto" or a whole number from 1 to 20, got "${value}".`);
            }

            return number;
        }
    }
};

function configPath() {

    return process.env.PIXELART_CONFIG ? path.resolve(process.env.PIXELART_CONFIG) : path.join(HERE, "..", "pixelart.config.json");
}

/**
 * @description Current settings: defaults overlaid with the saved values (invalid saved values fall back to defaults).
 * @returns {Object}
 * @public
 *
 */
function loadConfig() {

    const config = Object.fromEntries(Object.entries(SETTINGS).map(([key, setting]) => [key, setting.default]));
    const file = configPath();

    if (!fs.existsSync(file)) return config;

    let saved;

    try {

        saved = JSON.parse(fs.readFileSync(file, "utf8"));
    }
    catch (error) {

        throw new Error(`${file} is not valid JSON; fix it or run "config reset".`);
    }

    for (const [key, value] of Object.entries(saved)) {

        if (!SETTINGS[key]) continue;

        try {

            config[key] = SETTINGS[key].parse(value);
        }
        catch {

            // Keep the default for a broken value rather than failing every command.
        }
    }

    return config;
}

/**
 * @description Validates and saves one setting.
 * @returns {*} The stored value.
 * @public
 *
 */
function setConfig(key, value) {

    const setting = SETTINGS[key];

    if (!setting) throw new Error(`Unknown setting "${key}". Settings: ${Object.keys(SETTINGS).join(", ")}.`);

    const parsed = setting.parse(value);
    const file = configPath();
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};

    if (parsed === setting.default) delete saved[key];
    else saved[key] = parsed;

    if (Object.keys(saved).length) fs.writeFileSync(file, JSON.stringify(saved, null, 2) + "\n");
    else if (fs.existsSync(file)) fs.rmSync(file);

    return parsed;
}

/**
 * @description Restores every setting to its default (deletes the config file).
 * @public
 *
 */
function resetConfig() {

    const file = configPath();

    if (fs.existsSync(file)) fs.rmSync(file);
}

function describeSetting(key, value) {

    const setting = SETTINGS[key];
    const marker = (value === setting.default) ? " (default)" : "";

    return `${key} = ${value}${marker}\n    ${setting.description}`;
}
