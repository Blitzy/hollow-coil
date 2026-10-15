# mandreljs

Mandrel.js is a web engine for first-person shooters in the spirit of mid-90s shooters like Doom and Quake. This package is the engine for a game made with it: the `mandreljs` command, which plays, checks, compiles, and builds your game.

A game is a folder of content (no code), laid out like a Quake game directory:

```
mygame/
  package.json        { "devDependencies": { "mandreljs": "..." } }
  data/               game.json (name, start map), player.json, weapons.json, enemies.json
  maps/               TrenchBroom maps (.map)
  textures/           PNG textures, as <folder>/<name>.png
  trenchbroom/        your TrenchBroom game config and FGD
```

## Starting a game

The quickest start is a copy of the engine's example game, [`example/`](https://github.com/mandreljs/mandrel.js/tree/main/example), in a new folder such as `mygame/`. Give the copy its own name in four places, or TrenchBroom and the engine will treat it as the example:

- `name` in `data/game.json`
- `name` in `trenchbroom/GameConfig.cfg`
- the `// Game:` line at the top of each map
- the FGD's file name, and its entry in `GameConfig.cfg` (TrenchBroom's link to your config is named after it)

Then, inside it:

```
npm install --save-dev mandreljs
npx mandreljs validate
npx mandreljs setup
npx mandreljs install-trenchbroom
npx mandreljs dev
```

`validate` points out anything that still doesn't match. The data files' `$schema` lines point into the engine's repo; point them at the package instead (see below) for checking as you type. The example's content is licensed under CC BY 4.0, so keep its `LICENSE.md` (which gives the credit) for as long as you use any of it.

## Commands

Run them inside your game's folder, with Node.js 24 or newer:

| Command | What it does |
|---|---|
| `npx mandreljs setup` | Installs the pinned map compiler (ericw-tools) into a per-user cache. Run it once. |
| `npx mandreljs install-trenchbroom` | Links your game's config into TrenchBroom, and checks TrenchBroom's game path for it. |
| `npx mandreljs dev` | Plays your game at http://localhost:5173, compiling maps as you save them. |
| `npx mandreljs validate` | Checks your game's data and TrenchBroom setup against the engine's definitions. |
| `npx mandreljs compile` | Compiles your maps into `build/`. |
| `npx mandreljs build` | Builds a release in `dist/` for any static web host. |
| `npx mandreljs bspdump <file>` | Prints a compiled map's contents as JSON. |

`npx mandreljs help` lists them, and `npx mandreljs <command> --help` shows a command's options. Add `build/` and `dist/` to your `.gitignore`.

A release from `mandreljs build` carries the engine's license and a `NOTICE.md` saying what's the engine's and what's yours. Put your content's license or credits in a `LICENSE`, `NOTICE`, `CREDITS`, or `COPYING` file at the top of your game's folder (any extension, such as `LICENSE.md`), and every release carries it too, linked from `NOTICE.md`. If you use assets under a license that requires credit, such as CC BY, credit them there.

## The engine's definitions

Your game is checked against files in this package:

- `defs/schemas/`: a JSON Schema for each data file. Point your data files at them for checking as you type, such as `"$schema": "../node_modules/mandreljs/defs/schemas/player.schema.json"` in `data/player.json`.
- `defs/trenchbroom/mandreljs.fgd`: the entities every game shares. Start your FGD with `@include "mandreljs/mandreljs.fgd"`; `mandreljs install-trenchbroom` links that folder into your `trenchbroom/` folder as `mandreljs/` (gitignore `trenchbroom/mandrel`).

## License

The engine is licensed under the GNU General Public License v3.0 or later, with an additional permission for linking with platform SDKs such as Steamworks; see `LICENSE` and `LICENSE-EXCEPTION.md`. Your game's content is yours: it's data the engine loads, not code, so you choose its license.
