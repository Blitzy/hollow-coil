# @mandreljs/render

Three.js presentation shared by the game and future editors, so tools show exactly what the game shows. Import modules by path, such as `import { buildBspMeshes } from "@mandreljs/render/bsp-mesh"`.

- `bsp-mesh.ts`: the lit world from a compiled `.bsp`, with a gamma-space lightmap shader
- `lightmap-atlas.ts`: packs face lightmaps into one atlas and composes light styles into it (no Three.js)
- `light-styles.ts`: animated light styles, from `@mandreljs/defs`'s `lightstyles.json`, built in
- `level-mesh.ts`: unlit meshes from a `.map`'s brushes, and texture loading
- `uv.ts`: texture projection for `.map` faces
- `impacts.ts`: fading marks where shots hit walls (placeholders until real effects)
- `enemies.ts`: placeholder enemies, boxes colored by what they're doing (until models)
- `coords.ts`: Quake-to-Three coordinates, camera angles, and field of view
- `layer2d.ts`: the 2D layer over the scene, for the console and later the HUD and menus: text and filled rectangles in virtual pixels
- `font.ts`: the engine's bitmap font, defined in code (no Three.js)
- `dispose.ts`: frees a level's meshes and textures when another replaces it

All in `src/`; tests are in `tests/`. The lightmap tests use the compiled fixture room from `packages/sim/tests/fixtures/bsp`.
