import { readRepoFile } from "@hollow-coil/testing";
import { describe, expect, it } from "vitest";
import { jsonType, SchemaError, SchemaValidator } from "@hollow-coil/data/schema";

/** Validates value against a schema given inline, with any other schema files it references. */
function check(schema: object, value: unknown, otherFiles: Record<string, object> = {}): string[] {
  const files: Record<string, object> = { "test.schema.json": schema, ...otherFiles };
  return new SchemaValidator((name) => files[name]).validate(value, "test.schema.json");
}

const loadData = (name: string): Record<string, any> => JSON.parse(readRepoFile(`data/${name}.json`));
const dataValidator = (): SchemaValidator => new SchemaValidator((name) => JSON.parse(readRepoFile(`data/schemas/${name}`)));

describe("schema keywords", () => {
  it("checks types, counting whole numbers as integers and booleans as not numbers", () => {
    expect(check({ type: "integer" }, 3)).toEqual([]);
    expect(check({ type: "integer" }, 3.5)).not.toEqual([]);
    expect(check({ type: "number" }, true)).not.toEqual([]);
    expect(check({ type: "string" }, 1)).not.toEqual([]);
    expect(check({ type: ["string", "null"] }, null)).toEqual([]);
    expect(jsonType(3)).toBe("integer");
  });

  it("checks numeric bounds", () => {
    const schema = { type: "number", minimum: 0, maximum: 10 };
    expect(check(schema, 0)).toEqual([]);
    expect(check(schema, -1)).not.toEqual([]);
    expect(check(schema, 11)).not.toEqual([]);
    expect(check({ exclusiveMinimum: 0 }, 0)).not.toEqual([]);
    expect(check({ exclusiveMaximum: 1 }, 1)).not.toEqual([]);
  });

  it("checks objects: required, unexpected, and nested properties", () => {
    const schema = { type: "object", properties: { a: { type: "integer" } }, required: ["a"], additionalProperties: false };
    expect(check(schema, { a: 1 })).toEqual([]);
    expect(check(schema, {})).toEqual(["$: missing required property 'a'"]);
    expect(check(schema, { a: 1, b: 2 })).toEqual(["$: unexpected property 'b'"]);
    expect(check(schema, { a: "x" })).toEqual(["$.a: expected integer, got string"]);
  });

  it("checks map values and key names", () => {
    const schema = { type: "object", propertyNames: { pattern: "^[a-z]+$" }, additionalProperties: { type: "integer" } };
    expect(check(schema, { ok: 1 })).toEqual([]);
    expect(check(schema, { Bad: 1 })).toHaveLength(1);
    expect(check(schema, { ok: "x" })).toEqual(["$.ok: expected integer, got string"]);
  });

  it("checks arrays, enum, const, and pattern", () => {
    const schema = { type: "array", items: { enum: ["a", "b"] }, minItems: 1, maxItems: 2 };
    expect(check(schema, ["a"])).toEqual([]);
    expect(check(schema, [])).not.toEqual([]);
    expect(check(schema, ["a", "b", "a"])).not.toEqual([]);
    expect(check(schema, ["c"])).toHaveLength(1);
    expect(check({ const: 5 }, 6)).not.toEqual([]);
    expect(check({ type: "string", pattern: "^monster_" }, "item_x")).not.toEqual([]);
  });

  it("follows $refs within a file and across files", () => {
    const schema = { $defs: { pos: { type: "number", minimum: 0 } }, properties: { a: { $ref: "#/$defs/pos" }, b: { $ref: "other.schema.json#/$defs/name" } } };
    const other = { $defs: { name: { type: "string" } } };
    expect(check(schema, { a: 1, b: "x" }, { "other.schema.json": other })).toEqual([]);
    expect(check(schema, { a: -1, b: 2 }, { "other.schema.json": other })).toHaveLength(2);
  });

  it("rejects unsupported keywords anywhere, even in definitions nothing references", () => {
    expect(() => check({ type: "string", format: "email" }, "x")).toThrow(SchemaError);
    expect(() => check({ $defs: { unused: { oneOf: [] } } }, "x")).toThrow(SchemaError);
  });

  it("reports a missing schema file", () => {
    expect(() => new SchemaValidator(() => undefined).validate(1, "nope.schema.json")).toThrow("schema file not found: nope.schema.json");
  });
});

describe("the real data schemas", () => {
  it("accept every data file", () => {
    const validator = dataValidator();
    for (const name of ["player", "weapons", "enemies", "lightstyles"]) {
      expect(validator.validate(loadData(name), `${name}.schema.json`), name).toEqual([]);
    }
  });

  it.each([
    ["weapons", (d: any) => (d.weapons.pistol.hitscan.damage = "14"), "$.weapons.pistol.hitscan.damage: expected number, got string"],
    ["weapons", (d: any) => (d.weapons.shotgun.fire_intervall = 0.9), "$.weapons.shotgun: unexpected property 'fire_intervall'"],
    ["weapons", (d: any) => (d.switching.raise_time = 0), "$.switching.raise_time: 0 must be greater than 0"],
    ["enemies", (d: any) => delete d.enemies.shotgunner.think_interval, "$.enemies.shotgunner: missing required property 'think_interval'"],
    ["enemies", (d: any) => (d.enemies.shotgunner.pain.chance = 1.5), "$.enemies.shotgunner.pain.chance: 1.5 is above the maximum 1"],
    ["player", (d: any) => (d.hull.mins = [-16, -16]), "$.hull.mins: needs at least 3 items, has 2"],
    ["lightstyles", (d: any) => (d.styles["1"].pattern = "mmNmm"), "$.styles.1.pattern: 'mmNmm' does not match ^[a-z]+$"],
    ["lightstyles", (d: any) => (d.styles["32"] = { name: "Switched", pattern: "m" }), "$.styles (property name '32'): '32' does not match ^([0-9]|[12][0-9]|3[01])$"],
  ])("%s: catches %#", (name, mutate, expected) => {
    const data = loadData(name);
    mutate(data);
    expect(dataValidator().validate(data, `${name}.schema.json`)).toContain(expected);
  });
});
