// Reader for Quake 2 .bsp files (IBSP version 38), as written by ericw-tools'
// qbsp -q2bsp and light. Reads what rendering and entities need: planes, faces
// with their vertices, texture info, models, the lightmap lump, and the entity
// text (parse it with parseEntities()). Brushes for collision come later.
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

const HEADER_LUMPS = 19;
const LUMP = { entities: 0, planes: 1, vertices: 2, texinfo: 5, faces: 6, lighting: 7, edges: 11, surfaceEdges: 12, models: 13 } as const;

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
  readonly firstFace: number;
  readonly numFaces: number;
}

export interface Bsp {
  /** Entity lump text, in the same key/value form as a .map's entities. */
  readonly entities: string;
  readonly planes: readonly BspPlane[];
  readonly texinfo: readonly BspTexinfo[];
  readonly faces: readonly BspFace[];
  /** Model 0 is the world; the rest are brush entities. */
  readonly models: readonly BspModel[];
  /** RGB lightmap samples, three bytes each. */
  readonly lighting: Uint8Array;
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
        firstFace: view.getInt32(at + 40, true),
        numFaces: view.getInt32(at + 44, true),
      });
    }
  }

  const bsp: Bsp = { entities: ascii(lumps.raw(LUMP.entities)), planes, texinfo, faces, models, lighting };
  faces.forEach((face, i) => {
    if (face.lightOffset < 0) return;
    const { width, height } = lightmapExtents(bsp, face);
    if (face.lightOffset + width * height * face.styles.length * 3 > lighting.byteLength) {
      throw new BspError(`face ${i}'s lightmap runs past the end of the lighting lump`);
    }
  });
  return bsp;
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
    const [s, t] = texelCoords(info, v);
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
