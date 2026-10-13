/**
 * @description The <strong>skill.js</strong> module installs the /pixelart Claude Code skill into a
 * project (.claude/skills) or globally (~/.claude/skills), pointing it at this package's CLI.
 * @module
 *
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export {

    installSkill
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..");
const SKILL_SOURCE = path.join(PACKAGE_ROOT, "skill", "pixelart", "SKILL.md");

/**
 * @description Copies the skill, replacing {{CLI}} with the absolute path of pixelart.js and
 * {{OUTPUT}} / {{FINAL}} with the default work and final-output folders.
 * @param {Object} options
 * @param {string} [options.dest] - Project folder; the skill goes to <dest>/.claude/skills/pixelart.
 * @param {boolean} [options.global] - Install into ~/.claude/skills/pixelart.
 * @returns {string} The installed SKILL.md path.
 * @public
 *
 */
function installSkill({ dest, global = false } = {}) {

    if (!fs.existsSync(SKILL_SOURCE)) throw new Error(`Skill source missing: ${SKILL_SOURCE}`);

    const base = global ? path.join(os.homedir(), ".claude", "skills") : path.join(path.resolve(dest || process.cwd()), ".claude", "skills");
    const target = path.join(base, "pixelart");
    const cli = path.join(PACKAGE_ROOT, "pixelart.js").replace(/\\/g, "/");
    const output = path.join(PACKAGE_ROOT, "output").replace(/\\/g, "/");
    const final = path.join(PACKAGE_ROOT, "final-output").replace(/\\/g, "/");

    const text = fs.readFileSync(SKILL_SOURCE, "utf8").replaceAll("{{CLI}}", cli).replaceAll("{{OUTPUT}}", output).replaceAll("{{FINAL}}", final);

    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), text);

    return path.join(target, "SKILL.md");
}
