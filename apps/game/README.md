# game

The game itself: the browser entry point that loads a map, runs the sim, and draws it. From the repo root:

```
npm install          # once, or after any package.json changes
npm run dev          # play at http://localhost:5173/?map=test_movement
npm run build        # type-check, then build to apps/game/dist
```

Tests and type-checking run for the whole repo from the root (`npm test`, `npm run typecheck`).

In the browser, click to capture the mouse, then move with WASD, look with the mouse, and jump with space. The dev server (the `@hollow-coil/dev-server` plugin) serves the repo's `maps/`, `textures/`, `data/`, and `build/` folders at `/game/`, so saving a map in TrenchBroom and reloading the page picks it up. (A production build doesn't bundle those files yet.)

The world is drawn from the compiled `.bsp` with its baked lighting. When the page asks for `build/<name>.bsp` and the `.map` is newer, the dev server compiles it first with `tools/compile.py` in check mode (about a tenth of a second), so lighting stays current. If the compile fails or ericw-tools isn't installed, the page falls back to the unlit `.map` and shows why in the overlay; the full report is in the browser console and the dev server's output. The sim always loads collision and entities from the `.map`. Lights with a `style` animate using the patterns in `data/lightstyles.json`, stepped on sim ticks.

The dev server runs `python` on Windows and `python3` elsewhere; set `PYTHON` to override. Pass Vite options after `--`, such as `npm run dev -- --port 5199`.

## URL options

Combine them as a query string, such as `http://localhost:5173/?map=greybox_01&rawinput=off`.

| Option | Default | Effect |
|---|---|---|
| `map=<name>` | `test_movement` | Loads `maps/<name>.map` (and its compiled `.bsp` for lighting). |
| `lighting=off` | on | Draws the unlit `.map` instead of the lit `.bsp`. |
| `brightness=<n>` | `1.5` | Lightmap brightness, for comparison only. The default stays fixed so light values mean the same in every map (see `maps/README.md`). While playing, `[` and `]` adjust it. |
| `rawinput=off` | on | Uses the OS's accelerated mouse instead of raw input. Raw input (no pointer acceleration) is used where the browser supports it. |

## Layout

- `src/main.ts`: the entry point that ties the sim and rendering together
- `src/game/`: browser input (with raw mouse input), input commands, and the fixed-step loop
- `vite.config.ts`: the Vite setup, with the shared dev-server plugin
