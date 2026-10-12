# maps

TrenchBroom maps and everything the editor and compiler need. This folder is the game root: TrenchBroom's game path and qbsp's `-basedir` both point here.

- `*.map`: maps in Quake 2 (Valve) format. The `.map` file is the source of truth.
- `textures/<folder>/<name>.png`: textures, referenced by name (`<folder>/<name>`) from maps.
- `trenchbroom/`: the Hollow Coil game config and FGD (Phase 0.2).

Compiled `.bsp` files go to `/build`, never here.
