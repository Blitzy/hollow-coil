# game-client

The game client: plays a game directory in the browser. It loads a map, runs the sim, and draws it. Run it with `npm run dev` from the repo root, and build a release with `npm run build` (see Commands in the [README](../../README.md#commands)); the client alone builds to `apps/game-client/dist`.

In the browser, click to capture the mouse, then move with WASD, look with the mouse, and jump with space. Click to fire; the 1 and 2 keys or the mouse wheel switch weapons (wheel up is the next weapon, as in Quake 3). The overlay shows your health, the weapon, and what it's doing. Shots leave short-lived marks where they hit walls, and red ones where they hit someone (placeholders until real effects). As in Quake, getting hurt flashes the screen red and kicks the view toward the shot, and when you die the view drops to the floor and rolls over; after a second, let go of everything and then click or jump to start the level over. R records a demo: the level starts over, and R again (or starting over) saves it as a download for `demos/` (see `demos/README.md`). The dev server (the Vite plugin in `tools/src/dev-server.ts`) serves each game directory's `maps/`, `textures/`, and `data/` folders at `/games/<game>/`, with its compiled maps from its `build/` folder at `/games/<game>/build/`, so saving a map in TrenchBroom and reloading the page picks it up. The page title is the game's name, from its `data/game.json`. A release from `npm run build` puts the game's data, textures, and compiled maps at the same paths, so it runs on any static host.

A level loads from one file: the compiled `.bsp`, which gives the drawing with its baked lighting, the collision, and the entities. When the page asks for a compiled map and the `.map` is newer, the dev server compiles it first in check mode (with `tools/src/compile.ts`) (about a tenth of a second), so lighting stays current. If the compile fails or ericw-tools isn't installed, the page falls back to the `.map` for everything, unlit, and shows why in the overlay; the full report is in the browser console and the dev server's output. The overlay's first line names the file the level came from. Both files give the same collision and entities (`tools/tests/compiled-maps.test.ts` checks every example map). Lights with a `style` animate using the engine's patterns in `packages/defs/lightstyles.json`, built into the game, stepped on sim ticks.

## URL options

Combine them as a query string, such as `http://localhost:5173/?map=greybox_01&rawinput=off`.

| Option | Default | Effect |
|---|---|---|
| `game=<dir>` | the game the server was started for (`example` from the repo root) | Plays another game directory the server offers: one in the repo root, holding `data/game.json`. The client asks the server's `/games/index.json` which game to play when the URL doesn't say. |
| `map=<name>` | the game's `start_map` (`test_movement` in the example) | Loads the map, from its compiled `build/<name>.bsp` in the game directory (or the game's `maps/<name>.map` without one). |
| `lighting=off` | on | Loads the unlit `.map` instead of the lit `.bsp`, for drawing, collision, and entities. |
| `brightness=<n>` | `1.5` | Lightmap brightness, for comparison only. The default stays fixed so light values mean the same in every map (see `example/maps/README.md`). While playing, `[` and `]` adjust it. |
| `rawinput=off` | on | Uses the OS's accelerated mouse instead of raw input. Raw input (no pointer acceleration) is used where the browser supports it. |

## Layout

- `src/main.ts`: the entry point that ties the sim and rendering together
- `src/game/`: browser input (with raw mouse input), input commands, weapon selection with the mouse wheel, and the fixed-step loop
- `tests/`: tests, mirroring `src/`
- `vite.config.ts`: the Vite setup, with the dev server plugin from `tools/`
