# @mandreljs/toolchain

Node-only code shared by the command-line tools, the dev server, and tests: where things are in the repo, the pinned ericw-tools, and map compiling. The tools in `tools/` are thin command-line wrappers around it.

- `src/layout.ts`: the repo layout: the repo root, `packages/defs`, game directories (a folder holding `data/game.json`; `example/` by default), and where a game's maps compile to (`build/<game>/`).
- `src/setup.ts`: installs the pinned third-party tools into `.tools/` and finds them. `npm run setup` runs it.
- `versions.json`: the pinned versions and checksums. Bump versions here, never by hand-installing a different build.
- `src/zip.ts`: the small zip reader `setup` unpacks downloads with.
- `src/compile.ts`: compiles a map with qbsp and light, and reports leaks, missing textures, and compiler errors. `npm run compile` runs it, and the dev server compiles stale maps with it.
- `tests/`: the tests. `compile.test.ts` compiles small maps in `tests/fixtures/`, and `compiled-maps.test.ts` checks that every example map loads the same from its `.bsp` as from its `.map`. Both need ericw-tools, and skip without it.
