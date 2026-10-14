// Reader for Quake 2 .bsp files (IBSP version 38), as written by ericw-tools'
// qbsp -q2bsp and light. Reads what rendering, collision, and entities need:
// planes, faces with their vertices, texture info, models, the lightmap lump,
// brushes with their sides, the node tree that says which brushes belong to
// which model, and the entity text (parse it with parseEntities()).
//
// Layouts follow Quake 2's qfiles.h. Lightmap extents follow CalcSurfaceExtents
// in Quake 2's gl_model.c (GPLv2 or later, id Software).

import { vec3, type Vec3 } from "../math/vec3.ts";

/** Lightmap samples are one per 16 texels in Quake 2. */
export const LUXEL_SIZE = 16;
/** Quake 2 surface flags, from texinfo flags (qfiles.h). */
export const SURF = {
  LIGHT: 0x1,
  SLICK: 0x2,
  SKY: 0x4,
  WARP: 0x8,
  TRANS33: 0x10,
  TRANS66: 0x20,
  FLOWING: 0x40,
  NODRAW: 0x80,
} as const;

/** Marks an unused slot in a face's four light styles. */
const NO_STYLE = 255;
const MAX_STYLES = 4;

/** The 19 lumps of a Quake 2 .bsp, in header order (qfiles.h). */
export const BSP_LUMP_NAMES = [
  "entities", "planes", "vertices", "visibility", "nodes", "texinfo", "faces", "lighting", "leafs",
  "leaf_faces", "leaf_brushes", "edges", "surface_edges", "models", "brushes", "brush_sides", "pop",
  "areas", "area_portals",
] as const;
const HEADER_LUMPS = BSP_LUMP_NAMES.length;
const LUMP = {
  entities: 0, planes: 1, vertices: 2, nodes: 4, texinfo: 5, faces: 6, lighting: 7, leafs: 8, leafBrushes: 10,
  edges: 11, surfaceEdges: 12, models: 13, brushes: 14, brushSides: 15,
} as const;

/** Where a lump's bytes are in the file. */
export interface BspLump {
  readonly offset: number;
  readonly length: number;
}

export interface BspPlane {
  readonly normal: Vec3;
  readonly dist: number;
}

/** Texture projection: texel s = dot(point, s.axis) + s.offset, likewise t. */
export interface BspTexinfo {
  readonly s: { readonly axis: Vec3; readonly offset: number };
  readonly t: { readonly axis: Vec3; readonly offset: number };
  /** Quake 2 surface flags (SURF_*). */
  readonly flags: number;
  readonly value: number;
  readonly texture: string;
}

export interface BspFace {
  readonly plane: number;
  /** True if the face points away from its plane's normal. */
  readonly back: boolean;
  /** Polygon vertices in file order (clockwise seen from the front). */
  readonly vertices: readonly Vec3[];
  readonly texinfo: number;
  /** Light styles in use, in lightmap order; empty if the face has no lightmap. */
  readonly styles: readonly number[];
  /** Byte offset of the face's lightmap in the lighting lump, or -1 if none. */
  readonly lightOffset: number;
}

export interface BspModel {
  readonly mins: Vec3;
  readonly maxs: Vec3;
  readonly origin: Vec3;
  /** Root of the model's node tree, as a child reference (see BspNode). */
  readonly headNode: number;
  readonly firstFace: number;
  readonly numFaces: number;
}

/** A node of the BSP tree. A child of 0 or more is a node index; a negative child c is leaf -(c + 1). */
export interface BspNode {
  readonly plane: number;
  readonly children: readonly [number, number];
}

export interface BspLeaf {
  readonly contents: number;
  /** Indices of the brushes that touch this leaf. */
  readonly brushes: readonly number[];
}

/** One side of a brush. qbsp's bevel planes are sides too. */
export interface BspBrushSide {
  /** The side's plane, facing out of the brush. */
  readonly plane: number;
  /** The side's texinfo, or -1 if it has none. */
  readonly texinfo: number;
}

/** A convex brush as qbsp compiled it: its sides, bevels included, and its Quake 2 contents bits. */
export interface BspBrush {
  readonly sides: readonly BspBrushSide[];
  readonly contents: number;
}

export interface Bsp {
  /** Entity lump text, in the same key/value form as a .map's entities. */
  readonly entities: string;
  readonly planes: readonly BspPlane[];
  readonly texinfo: readonly BspTexinfo[];
  readonly faces: readonly BspFace[];
  /** Model 0 is the world; the rest are brush entities. */
  readonly models: readonly BspModel[];
  readonly nodes: readonly BspNode[];
  readonly leafs: readonly BspLeaf[];
  /** Every model's brushes. modelBrushes() says which belong to a model. */
  readonly brushes: readonly BspBrush[];
  /** RGB lightmap samples, three bytes each. */
  readonly lighting: Uint8Array;
  /** The header's lump table, in BSP_LUMP_NAMES order. Every lump is checked to lie inside the file. */
  readonly lumps: readonly BspLump[];
}

/** A face's lightmap in luxels, with the texel coordinates of its first luxel. */
export interface LightmapExtents {
  readonly minS: number;
  readonly minT: number;
  readonly width: number;
  readonly height: number;
}

export class BspError extends Error {
  override name = "BspError";
}

/** Bytes as text, one character per byte, stopping at the first NUL. */
function ascii(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

class Lumps {
  readonly bytes: Uint8Array;
  private readonly view: DataView;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 8 + HEADER_LUMPS * 8) throw new BspError("file too small to be a .bsp");
    const magic = ascii(bytes.subarray(0, 4));
    const version = this.view.getInt32(4, true);
    if (magic !== "IBSP" || version !== 38) throw new BspError(`not a Quake 2 .bsp (magic "${magic}", version ${version})`);
  }

  /** A lump as a view, with its record count for the given record size. */
  lump(index: number, recordSize = 1): { view: DataView; offset: number; count: number } {
    const offset = this.view.getInt32(8 + index * 8, true);
    const length = this.view.getInt32(12 + index * 8, true);
    if (offset < 0 || length < 0 || offset + length > this.bytes.byteLength) throw new BspError(`lump ${index} is out of bounds`);
    if (length % recordSize !== 0) throw new BspError(`lump ${index} is not a whole number of ${recordSize}-byte records`);
    return { view: this.view, offset, count: length / recordSize };
  }

  raw(index: number): Uint8Array {
    const { offset, count } = this.lump(index);
    return this.bytes.subarray(offset, offset + count);
  }
}

const readVec3 = (view: DataView, at: number): Vec3 =>
  vec3(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true));

export function readBsp(data: ArrayBuffer | Uint8Array): Bsp {
  const lumps = new Lumps(data instanceof Uint8Array ? data : new Uint8Array(data));

  const planes: BspPlane[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.planes, 20);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 20;
      planes.push({ normal: readVec3(view, at), dist: view.getFloat32(at + 12, true) });
    }
  }

  const vertices: Vec3[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.vertices, 12);
    for (let i = 0; i < count; i++) vertices.push(readVec3(view, offset + i * 12));
  }

  const texinfo: BspTexinfo[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.texinfo, 76);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 76;
      texinfo.push({
        s: { axis: readVec3(view, at), offset: view.getFloat32(at + 12, true) },
        t: { axis: readVec3(view, at + 16), offset: view.getFloat32(at + 28, true) },
        flags: view.getInt32(at + 32, true),
        value: view.getInt32(at + 36, true),
        texture: ascii(lumps.bytes.subarray(at + 40, at + 72)),
      });
    }
  }

  const edges = lumps.lump(LUMP.edges, 4);
  const surfaceEdges = lumps.lump(LUMP.surfaceEdges, 4);
  const lighting = lumps.raw(LUMP.lighting);

  const faces: BspFace[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.faces, 20);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 20;
      const plane = view.getUint16(at, true);
      const firstEdge = view.getInt32(at + 4, true);
      const numEdges = view.getInt16(at + 8, true);
      const info = view.getInt16(at + 10, true);
      if (plane >= planes.length || info < 0 || info >= texinfo.length || numEdges < 3 || firstEdge < 0 || firstEdge + numEdges > surfaceEdges.count) {
        throw new BspError(`face ${i} has an out-of-range plane, texinfo, or edge`);
      }

      // A surface edge's sign says which way the edge runs; its first vertex is the polygon's next corner.
      const faceVertices: Vec3[] = [];
      for (let e = firstEdge; e < firstEdge + numEdges; e++) {
        const edge = surfaceEdges.view.getInt32(surfaceEdges.offset + e * 4, true);
        const index = Math.abs(edge);
        if (index >= edges.count) throw new BspError(`face ${i} uses missing edge ${index}`);
        const v = edges.view.getUint16(edges.offset + index * 4 + (edge >= 0 ? 0 : 2), true);
        const vertex = vertices[v];
        if (!vertex) throw new BspError(`face ${i} uses missing vertex ${v}`);
        faceVertices.push(vertex);
      }

      const styles: number[] = [];
      for (let s = 0; s < MAX_STYLES; s++) {
        const style = view.getUint8(at + 12 + s);
        if (style !== NO_STYLE) styles.push(style);
      }
      const lightOffset = view.getInt32(at + 16, true);
      const lit = lightOffset >= 0 && styles.length > 0;
      faces.push({
        plane,
        back: view.getInt16(at + 2, true) !== 0,
        vertices: faceVertices,
        texinfo: info,
        styles: lit ? styles : [],
        lightOffset: lit ? lightOffset : -1,
      });
    }
  }

  const models: BspModel[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.models, 48);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 48;
      models.push({
        mins: readVec3(view, at),
        maxs: readVec3(view, at + 12),
        origin: readVec3(view, at + 24),
        headNode: view.getInt32(at + 36, true),
        firstFace: view.getInt32(at + 40, true),
        numFaces: view.getInt32(at + 44, true),
      });
    }
  }

  const brushes: BspBrush[] = [];
  {
    const sides = lumps.lump(LUMP.brushSides, 4);
    const { view, offset, count } = lumps.lump(LUMP.brushes, 12);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 12;
      const firstSide = view.getInt32(at, true);
      const numSides = view.getInt32(at + 4, true);
      if (firstSide < 0 || numSides < 0 || firstSide + numSides > sides.count) throw new BspError(`brush ${i} has out-of-range sides`);
      const brushSides: BspBrushSide[] = [];
      for (let s = firstSide; s < firstSide + numSides; s++) {
        const plane = sides.view.getUint16(sides.offset + s * 4, true);
        const info = sides.view.getInt16(sides.offset + s * 4 + 2, true);
        if (plane >= planes.length || info < -1 || info >= texinfo.length) throw new BspError(`brush ${i} has a side with an out-of-range plane or texinfo`);
        brushSides.push({ plane, texinfo: info });
      }
      brushes.push({ sides: brushSides, contents: view.getInt32(at + 8, true) });
    }
  }

  const leafs: BspLeaf[] = [];
  {
    const leafBrushes = lumps.lump(LUMP.leafBrushes, 2);
    const { view, offset, count } = lumps.lump(LUMP.leafs, 28);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 28;
      const first = view.getUint16(at + 24, true);
      const num = view.getUint16(at + 26, true);
      if (first + num > leafBrushes.count) throw new BspError(`leaf ${i} has out-of-range brushes`);
      const leafBrushIndices: number[] = [];
      for (let b = first; b < first + num; b++) {
        const brush = leafBrushes.view.getUint16(leafBrushes.offset + b * 2, true);
        if (brush >= brushes.length) throw new BspError(`leaf ${i} uses missing brush ${brush}`);
        leafBrushIndices.push(brush);
      }
      leafs.push({ contents: view.getInt32(at, true), brushes: leafBrushIndices });
    }
  }

  const nodes: BspNode[] = [];
  {
    const { view, offset, count } = lumps.lump(LUMP.nodes, 28);
    for (let i = 0; i < count; i++) {
      const at = offset + i * 28;
      nodes.push({ plane: view.getInt32(at, true), children: [view.getInt32(at + 4, true), view.getInt32(at + 8, true)] });
    }
  }
  const validChild = (c: number): boolean => (c >= 0 ? c < nodes.length : -(c + 1) < leafs.length);
  nodes.forEach((node, i) => {
    if (node.plane < 0 || node.plane >= planes.length || !node.children.every(validChild)) throw new BspError(`node ${i} has an out-of-range plane or child`);
  });
  models.forEach((model, i) => {
    if (!validChild(model.headNode)) throw new BspError(`model ${i} has an out-of-range head node`);
  });

  const lumpTable: BspLump[] = [];
  for (let i = 0; i < HEADER_LUMPS; i++) {
    const { offset, count } = lumps.lump(i);
    lumpTable.push({ offset, length: count });
  }

  const bsp: Bsp = {
    entities: ascii(lumps.raw(LUMP.entities)), planes, texinfo, faces, models, nodes, leafs, brushes, lighting, lumps: lumpTable,
  };
  faces.forEach((face, i) => {
    if (face.lightOffset < 0) return;
    const { width, height } = lightmapExtents(bsp, face);
    if (face.lightOffset + width * height * face.styles.length * 3 > lighting.byteLength) {
      throw new BspError(`face ${i}'s lightmap runs past the end of the lighting lump`);
    }
  });
  return bsp;
}

/**
 * Indices of the brushes in a model, in file order: every brush in a leaf of
 * the model's node tree. Model 0 gives the world's brushes.
 */
export function modelBrushes(bsp: Bsp, model: number): number[] {
  const head = bsp.models[model]?.headNode;
  if (head === undefined) throw new BspError(`no model ${model}`);
  const found = new Set<number>();
  const visited = new Set<number>(); // guards against a malformed tree that loops
  const stack = [head];
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child < 0) {
      for (const brush of bsp.leafs[-(child + 1)]!.brushes) found.add(brush);
    } else if (!visited.has(child)) {
      visited.add(child);
      stack.push(...bsp.nodes[child]!.children);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** The face's normal, pointing out of its front side. */
export function faceNormal(bsp: Bsp, face: BspFace): Vec3 {
  const n = bsp.planes[face.plane]!.normal;
  return face.back ? vec3(0 - n.x, 0 - n.y, 0 - n.z) : n;
}

/** Texel coordinates of a point under a texinfo's projection. */
export function texelCoords(info: BspTexinfo, p: Vec3): [number, number] {
  const { s, t } = info;
  return [p.x * s.axis.x + p.y * s.axis.y + p.z * s.axis.z + s.offset, p.x * t.axis.x + p.y * t.axis.y + p.z * t.axis.z + t.offset];
}

/**
 * The face's lightmap size in luxels: one per 16 texels across the face's texel
 * bounds, rounded out to whole luxels, plus one. Each light style's samples are
 * width * height RGB triples, row by row, stored one style after another.
 */
export function lightmapExtents(bsp: Bsp, face: BspFace): LightmapExtents {
  const info = bsp.texinfo[face.texinfo]!;
  let minS = Infinity;
  let maxS = -Infinity;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const v of face.vertices) {
    // Rounded to 32-bit floats, as ericw-tools' light and Quake 2 store them. On a
    // rotated face a coordinate can land a hair off a luxel boundary (-191.99999509
    // for -192), and rounding decides whether that adds a whole row of luxels.
    const [s, t] = texelCoords(info, v).map(Math.fround) as [number, number];
    minS = Math.min(minS, s);
    maxS = Math.max(maxS, s);
    minT = Math.min(minT, t);
    maxT = Math.max(maxT, t);
  }
  const lowS = Math.floor(minS / LUXEL_SIZE);
  const lowT = Math.floor(minT / LUXEL_SIZE);
  return {
    minS: lowS * LUXEL_SIZE,
    minT: lowT * LUXEL_SIZE,
    width: Math.ceil(maxS / LUXEL_SIZE) - lowS + 1,
    height: Math.ceil(maxT / LUXEL_SIZE) - lowT + 1,
  };
}
