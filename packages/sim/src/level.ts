// Static level data built from a map: the collision world, entities, named
// markers, and the player start. Levels don't change during play, so they
// aren't part of the sim state or its snapshots.
//
// A level loads from either file: the .map (no compile needed, for fast
// iteration and tests) or the compiled .bsp (what ships). Both give the same
// collision, since the .map loader adds qbsp's bevel planes itself.

import { buildBrush, type Brush } from "./collision/brush.ts";
import type { Plane } from "./collision/plane.ts";
import type { CollisionBrush, CollisionWorld } from "./collision/trace.ts";
import { component, vec3, type Vec3 } from "./math/vec3.ts";
import { modelBrushes, type Bsp } from "./map/bsp.ts";
import { parseEntities, parseMap } from "./map/parse.ts";

export type EntityProperties = Readonly<Record<string, string>>;

export interface Level {
  readonly world: CollisionWorld;
  /** Every entity's key/value pairs, worldspawn first. */
  readonly entities: readonly EntityProperties[];
  /** info_marker origins by name. */
  readonly markers: ReadonlyMap<string, Vec3>;
  readonly playerStart: { readonly origin: Vec3; readonly angle: number } | null;
}

/** A level loaded from a .map, which also has the world brushes' face windings for unlit rendering. */
export interface MapLevel extends Level {
  readonly brushes: readonly Brush[];
}

export class LevelError extends Error {
  override name = "LevelError";
}

/** An entity's "origin" key as a point; the world origin if it has none. */
export function entityOrigin(entity: EntityProperties): Vec3 {
  const parts = (entity.origin ?? "0 0 0").trim().split(/\s+/).map(Number);
  return vec3(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

function requireWorldspawn(entities: readonly EntityProperties[]): void {
  if (entities[0]?.classname !== "worldspawn") throw new LevelError("the first entity must be worldspawn");
}

function levelFromEntities(world: CollisionWorld, entities: readonly EntityProperties[]): Level {
  const markers = new Map<string, Vec3>();
  let playerStart: Level["playerStart"] = null;
  for (const p of entities) {
    if (p.classname === "info_marker" && p.name !== undefined) markers.set(p.name, entityOrigin(p));
    if (p.classname === "info_player_start" && !playerStart) playerStart = { origin: entityOrigin(p), angle: Number(p.angle ?? 0) };
  }
  return { world, entities, markers, playerStart };
}

export function levelFromMap(text: string): MapLevel {
  const entities = parseMap(text);
  const properties = entities.map((e) => e.properties);
  requireWorldspawn(properties);
  const brushes = entities[0]!.brushes.map((faces, i) => {
    const brush = buildBrush(faces);
    if (!brush) throw new LevelError(`world brush ${i} does not enclose a volume`);
    return brush;
  });
  return { ...levelFromEntities({ brushes }, properties), brushes };
}

/**
 * A brush's bounds, from its axial sides. qbsp gives every brush all six (as
 * bevels if the brush has no such face); a side missing from a malformed file
 * leaves that bound open, which only costs trace speed.
 */
function brushBounds(planes: readonly Plane[]): { mins: Vec3; maxs: Vec3 } {
  const mins = [-Infinity, -Infinity, -Infinity];
  const maxs = [Infinity, Infinity, Infinity];
  for (let axis = 0; axis < 3; axis++) {
    for (const p of planes) {
      if (component(p.normal, axis) === 1) maxs[axis] = p.dist;
      if (component(p.normal, axis) === -1) mins[axis] = 0 - p.dist;
    }
  }
  return { mins: vec3(mins[0]!, mins[1]!, mins[2]!), maxs: vec3(maxs[0]!, maxs[1]!, maxs[2]!) };
}

/** The world model's brushes (model 0), with qbsp's planes as they are, bevels included. See docs/MOVEMENT.md. */
export function levelFromBsp(bsp: Bsp): Level {
  const entities = parseEntities(bsp.entities);
  requireWorldspawn(entities);
  const brushes: CollisionBrush[] = modelBrushes(bsp, 0).map((index) => {
    const brush = bsp.brushes[index]!;
    const planes = brush.sides.map((side) => bsp.planes[side.plane]!);
    return { planes, contents: brush.contents, ...brushBounds(planes) };
  });
  return levelFromEntities({ brushes }, entities);
}
