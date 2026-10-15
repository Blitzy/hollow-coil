# mandreljs

Mandrel.js is a web engine for first-person shooters in the spirit of mid-90s shooters like Doom and Quake. This package is the engine for a game made with it: the `mandrel` command, which plays, checks, compiles, and builds your game.

A game is a folder of content (no code), laid out like a Quake game directory:

```
mygame/
  package.json        { "devDependencies": { "mandreljs": "..." } }
  data/               game.json (name, start map), player.json, weapons.json, enemies.json
  maps/               TrenchBroom maps (.map)
  textures/           PNG textures, as <folder>/<name>.png
  trenchbroom/        your TrenchBroom game config and FGD
```

## Commands

Run them inside your game's folder, with Node.js 24 or newer:

| Command | What it does |
|---|---|
| `npx mandrel setup` | Installs the pinned map compiler (ericw-tools) into a per-user cache. Run it once. |
| `npx mandrel install-trenchbroom` | Links your game's config into TrenchBroom, and checks TrenchBroom's game path for it. |
| `npx mandrel dev` | Plays your game at http://localhost:5173, compiling maps as you save them. |
| `npx mandrel validate` | Checks your game's data and TrenchBroom setup against the engine's definitions. |
| `npx mandrel compile` | Compiles your maps into `build/`. |
| `npx mandrel build` | Builds a release in `dist/` for any static web host. |
| `npx mandrel bspdump <file>` | Prints a compiled map's contents as JSON. |

`npx mandrel help` lists them, and `npx mandrel <command> --help` shows a command's options. Add `build/` and `dist/` to your `.gitignore`.

## The engine's definitions

Your game is checked against files in this package:

- `defs/schemas/`: a JSON Schema for each data file. Point your data files at them for checking as you type, such as `"$schema": "../node_modules/mandreljs/defs/schemas/player.schema.json"` in `data/player.json`.
- `defs/trenchbroom/mandrel.fgd`: the entities every game shares. Start your FGD with `@include "mandrel/mandrel.fgd"`; `mandrel install-trenchbroom` links that folder into your `trenchbroom/` folder as `mandrel/` (gitignore `trenchbroom/mandrel`).

## License

The engine is licensed under the GNU General Public License v3.0 or later, with an additional permission for linking with platform SDKs such as Steamworks; see `LICENSE` and `LICENSE-EXCEPTION.md`. Your game's content is yours: it's data the engine loads, not code, so you choose its license.
