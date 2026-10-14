// Static level data built from a map: the collision world, named markers, and
// the player start. Levels don't change during play, so they aren't part of the
// sim state or its snapshots.

import { buildBrush, type Brush } from "./collision/brush.ts";
import type { CollisionWorld } from "./collision/trace.ts";
import { vec3, type Vec3 } from "./math/vec3.ts";
import { parseMap, type MapEntity } from "./map/parse.ts";

export interface Level {
  readonly world: CollisionWorld;
  /** World brushes with face windings, for rendering. */
  readonly brushes: readonly Brush[];
  readonly entities: readonly MapEntity[];
  /** info_marker origins by name. */
  readonly markers: ReadonlyMap<string, Vec3>;
  readonly playerStart: { readonly origin: Vec3; readonly angle: number } | null;
}

export class LevelError extends Error {
  override name = "LevelError";
}

function parseOrigin(text: string | undefined): Vec3 {
  const parts = (text ?? "0 0 0").trim().split(/\s+/).map(Number);
  return vec3(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

export function levelFromMap(text: string): Level {
  const entities = parseMap(text);
  const worldspawn = entities[0];
  if (!worldspawn || worldspawn.properties.classname !== "worldspawn") throw new LevelError("the first entity must be worldspawn");

  const brushes: Brush[] = [];
  worldspawn.brushes.forEach((faces, i) => {
    const brush = buildBrush(faces);
    if (!brush) throw new LevelError(`world brush ${i} does not enclose a volume`);
    brushes.push(brush);
  });

  const markers = new Map<string, Vec3>();
  let playerStart: Level["playerStart"] = null;
  for (const entity of entities) {
    const p = entity.properties;
    if (p.classname === "info_marker" && p.name !== undefined) markers.set(p.name, parseOrigin(p.origin));
    if (p.classname === "info_player_start" && !playerStart) playerStart = { origin: parseOrigin(p.origin), angle: Number(p.angle ?? 0) };
  }
  return { world: { brushes }, brushes, entities, markers, playerStart };
}
