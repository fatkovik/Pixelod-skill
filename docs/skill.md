# The `/pixelart` Claude Code skill

The skill turns Claude into a pixel artist that uses this toolbox. It is one file,
[`skill/pixelart/SKILL.md`](../skill/pixelart/SKILL.md), containing the workflow, the art rules and a short command
reference. Claude reads it when you type `/pixelart` (or ask for pixel art).

## Installing

```
node pixelart.js install-skill --dest <project folder>     # one project
node pixelart.js install-skill --global                    # every project, in ~/.claude/skills
```

The installer copies `SKILL.md` and replaces two placeholders:

- `{{CLI}}` → the absolute path of `pixelart.js`
- `{{OUTPUT}}` → the absolute path of the `output` folder (work folders)
- `{{FINAL}}` → the absolute path of the `final-output` folder (exports)

So the installed skill works from any project, as long as the Pixelod Skill folder stays where it was installed from.
Re-run the installer after moving the folder or after changing `skill/pixelart/SKILL.md`.

Start a new Claude Code session after installing. To remove the skill, delete the installed
`.claude/skills/pixelart` folder.

## Using it

```
/pixelart <what you want>
```

Good requests say the subject, and optionally the size, palette or style, animation, and where to export:

```
/pixelart a 16x16 sword icon, endesga32 palette
/pixelart a 32x32 wizard, 6-frame walk cycle, export a sprite sheet with 6 columns to D:\Game\sprites
/pixelart convert photo.jpg into 48-wide pixel art with 16 colors and clean it up
/pixelart edit wizard: the robe should be dark green and the hat taller
```

## What Claude does

1. Reads the `iterations` setting (`node pixelart.js config iterations`).
2. Decides the spec (size, palette, animation) without asking unless something is really ambiguous.
3. Writes `output/<name>/<name>.pixelscript` in the Pixelod Skill folder (one work folder per piece).
4. Runs `build`, which writes the zoomed preview (grid and coordinate rulers), the frame strip and lint warnings.
5. Looks at the preview image, lists concrete problems with coordinates, fixes the script and builds again,
   for the configured number of [iterations](#iterations).
6. Runs `lint`, fixes real problems, then exports (`png`, and `gif`/`sheet` for animations) to `final-output/`.
7. Reports what it made, how many iterations it did, and the file paths.

For images it runs `import`, looks at the result and cleans it up with `draw`. For edits it checks `info`: if the
document was built from a script, it edits the script and rebuilds.

## Iterations

An iteration is one critique-and-fix round: look at the render, list concrete problems, fix the script (or the
document), rebuild. More iterations give more polish and take longer.

| Setting | Behavior |
|---|---|
| `auto` (default) | At least 2 rounds, usually 3; Claude stops when it can no longer name a concrete problem |
| `1` … `20` | Exactly that many rounds. If the art is already good, the remaining rounds go to polish; if problems remain after the last round, Claude reports them |

Three ways to set it:

```
node pixelart.js config iterations 4          # permanent, from a terminal (auto to reset)
/pixelart set iterations to 4                 # permanent, from Claude Code (Claude runs the command above)
/pixelart a 24x24 treasure chest, 2 iterations   # this request only
```

The setting applies to every kind of job: new art, image clean-up, edits and animations. It is stored in
`pixelart.config.json` in the Pixelod Skill folder, so it is shared by every project using this installation. Details:
[cli.md](cli.md#config).

## Permissions

Claude Code asks before running shell commands and writing files. While using the skill you will see prompts for
`node .../pixelart.js ...` and for writing `.pixelscript` files in the `output` folder. Choose "always allow"
for them, or add a permission rule in your Claude Code settings, to skip the prompts.

## Customizing

Edit `skill/pixelart/SKILL.md`, then reinstall. Useful changes:

- Default sizes, palettes or export formats for your project (for example "always export a 4x scaled PNG and a
  sprite sheet to `D:\Game\art`").
- Your game's art rules (outline color, light direction, palette).
- The `description` line in the front matter controls when Claude uses the skill without `/pixelart`.

Keep the `{{CLI}}`, `{{OUTPUT}}` and `{{FINAL}}` placeholders; the installer fills them in.
