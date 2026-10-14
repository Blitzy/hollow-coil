# @mandreljs/dev-server

The Vite plugin every app uses in development (`gameFiles()` in its `vite.config.ts`). It serves the repo's game directories, the same files the tools use:

- `/games/<game>/maps/`, `/textures/`, and `/data/`: a game directory, a folder in the repo root holding `data/game.json`
- `/games/<game>/build/`: `build/<game>/`, where the game's maps compile to

A request for `/games/<game>/build/<name>.bsp` compiles the map first, in check mode, when its `.map` is newer, so saving in TrenchBroom and reloading shows new lighting. If the compile fails, the response is the compiler's report with status 422. Files are served uncached, so a reload always gets the latest save.
