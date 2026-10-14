import { describe, expect, it } from "vitest";
import { MapParseError, parseEntities, parseMap } from "@mandreljs/sim/map/parse";

const SAMPLE = `// Game: Mandrel.js Example
// Format: Quake2 (Valve)
// entity 0
{
"classname" "worldspawn"
"message" "Sample { with braces }"
// brush 0
{
( 0 0 0 ) ( 0 64 0 ) ( 0 0 64 ) dev/grid_grey [ 0 1 0 8 ] [ 0 0 -1 -4 ] 15 0.5 2 65536 4 7
( 64 0 0 ) ( 64 0 64 ) ( 64 64 0 ) {fence 16 32 0 1 1
( -1.5 2 3e1 ) ( 1 2 3 ) ( 4 5 6 ) *water [ 1 0 0 0 ] [ 0 -1 0 0 ] 0 1 1
}
}
// entity 1
{
"classname" "info_marker"
"name" "finish"
"origin" "2336 -208 56"
}
`;

describe("parseMap", () => {
  const entities = parseMap(SAMPLE);

  it("reads entities, properties, and brushes", () => {
    expect(entities).toHaveLength(2);
    expect(entities[0]!.properties).toEqual({ classname: "worldspawn", message: "Sample { with braces }" });
    expect(entities[0]!.brushes).toHaveLength(1);
    expect(entities[0]!.brushes[0]).toHaveLength(3);
    expect(entities[1]!.properties.name).toBe("finish");
    expect(entities[1]!.brushes).toHaveLength(0);
  });

  it("reads Valve 220 faces with Quake 2 fields", () => {
    const face = entities[0]!.brushes[0]![0]!;
    expect(face.points).toEqual([{ x: 0, y: 0, z: 0 }, { x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 64 }]);
    expect(face.texture).toBe("dev/grid_grey");
    expect(face.projection).toEqual({ kind: "valve", u: [0, 1, 0, 8], v: [0, 0, -1, -4] });
    expect(face.rotation).toBe(15);
    expect(face.scale).toEqual([0.5, 2]);
    expect([face.contents, face.surfaceFlags, face.value]).toEqual([65536, 4, 7]);
  });

  it("reads standard-format faces and odd texture names", () => {
    const face = entities[0]!.brushes[0]![1]!;
    expect(face.texture).toBe("{fence");
    expect(face.projection).toEqual({ kind: "standard", offset: [16, 32] });
    expect([face.contents, face.surfaceFlags, face.value]).toEqual([0, 0, 0]);
  });

  it("reads decimals and exponents in points", () => {
    const face = entities[0]!.brushes[0]![2]!;
    expect(face.texture).toBe("*water");
    expect(face.points[0]).toEqual({ x: -1.5, y: 2, z: 30 });
  });

  it("reports the line of a syntax error", () => {
    const broken = '{\n"classname" "worldspawn"\n{\n( 0 0 0 ) ( 0 64 0 ) oops\n}\n}\n';
    expect(() => parseMap(broken)).toThrow(MapParseError);
    expect(() => parseMap(broken)).toThrow(/line 4/);
  });

  it("rejects unterminated entities", () => {
    expect(() => parseMap('{\n"classname" "worldspawn"\n')).toThrow(/unterminated entity/);
  });
});

describe("parseEntities", () => {
  it("reads .bsp-style entity text", () => {
    expect(parseEntities('{\n"classname" "worldspawn"\n}\n{\n"classname" "light"\n"light" "300"\n}\n')).toEqual([
      { classname: "worldspawn" },
      { classname: "light", light: "300" },
    ]);
  });
});
