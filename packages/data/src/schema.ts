// Validates JSON against the subset of JSON Schema (draft 2020-12) that our
// schemas use. Any other keyword in a schema is an error, so a schema can never
// silently check less than it appears to. Editors like VS Code still validate
// the same files with full JSON Schema, through each file's "$schema" key.
//
// Supported keywords: type, properties, required, additionalProperties,
// propertyNames, items, minItems, maxItems, minimum, maximum, exclusiveMinimum,
// exclusiveMaximum, enum, const, pattern, and $ref (within a schema file or to
// another file in the same schemas folder).
//
// No file access: the caller supplies a function that loads a schema by file
// name, so this runs the same in Node (tools) and the browser (editors).

const VALIDATION_KEYWORDS = new Set([
  "type", "properties", "required", "additionalProperties", "propertyNames", "items", "minItems", "maxItems",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "enum", "const", "pattern", "$ref",
]);
const ANNOTATION_KEYWORDS = new Set(["$schema", "$id", "$defs", "$comment", "title", "description", "default", "examples"]);

/** A problem with a schema itself, as opposed to the data it checks. */
export class SchemaError extends Error {
  override name = "SchemaError";
}

type Schema = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The JSON Schema type of a parsed JSON value. Whole numbers count as integers. */
export function jsonType(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (isObject(value)) return "object";
  return typeof value;
}

const isType = (value: unknown, expected: string): boolean => {
  const actual = jsonType(value);
  return actual === expected || (expected === "number" && actual === "integer");
};

/** A value as it appears in messages: strings quoted, arrays in brackets. */
export function show(value: unknown): string {
  if (typeof value === "string") return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map(show).join(", ")}]`;
  if (isObject(value)) return JSON.stringify(value);
  return String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

export class SchemaValidator {
  private readonly files = new Map<string, Schema>();
  private readonly loadSchema: (name: string) => unknown;

  /** loadSchema returns a schema file's parsed JSON by name, or undefined if there is no such file. */
  constructor(loadSchema: (name: string) => unknown) {
    this.loadSchema = loadSchema;
  }

  /** Errors found in value against the named schema file, as "$.path: problem" lines. Throws SchemaError for a bad schema. */
  validate(value: unknown, schemaFile: string): string[] {
    const errors: string[] = [];
    this.check(value, this.load(schemaFile), schemaFile, "$", errors);
    return errors;
  }

  private load(name: string): Schema {
    let schema = this.files.get(name);
    if (!schema) {
      const loaded = this.loadSchema(name);
      if (loaded === undefined) throw new SchemaError(`schema file not found: ${name}`);
      checkSchema(loaded, name);
      schema = loaded as Schema;
      this.files.set(name, schema);
    }
    return schema;
  }

  private resolve(ref: string, base: string): [Schema, string] {
    const hash = ref.indexOf("#");
    const filePart = hash < 0 ? ref : ref.slice(0, hash);
    const pointer = hash < 0 ? "" : ref.slice(hash + 1);
    const target = filePart || base;
    let node: unknown = this.load(target);
    for (const part of pointer.split("/").filter((p) => p !== "")) {
      if (!isObject(node) || !Object.hasOwn(node, part)) throw new SchemaError(`${base}: cannot resolve $ref '${ref}'`);
      node = node[part];
    }
    return [node as Schema, target];
  }

  private check(value: unknown, schema: Schema, base: string, path: string, errors: string[]): void {
    if (typeof schema.$ref === "string") {
      const [target, targetBase] = this.resolve(schema.$ref, base);
      this.check(value, target, targetBase, path, errors);
    }

    if (schema.type !== undefined) {
      const types = (Array.isArray(schema.type) ? schema.type : [schema.type]) as string[];
      if (!types.some((t) => isType(value, t))) {
        errors.push(`${path}: expected ${types.join(" or ")}, got ${jsonType(value)}`);
        return;
      }
    }

    if (Array.isArray(schema.enum) && !schema.enum.some((option) => deepEqual(option, value))) {
      errors.push(`${path}: ${show(value)} is not one of ${show(schema.enum)}`);
    }
    if (Object.hasOwn(schema, "const") && !deepEqual(value, schema.const)) errors.push(`${path}: expected ${show(schema.const)}`);

    if (typeof value === "number") {
      const n = (key: string): number | undefined => (typeof schema[key] === "number" ? (schema[key] as number) : undefined);
      const min = n("minimum");
      const max = n("maximum");
      const exclusiveMin = n("exclusiveMinimum");
      const exclusiveMax = n("exclusiveMaximum");
      if (min !== undefined && value < min) errors.push(`${path}: ${value} is below the minimum ${min}`);
      if (max !== undefined && value > max) errors.push(`${path}: ${value} is above the maximum ${max}`);
      if (exclusiveMin !== undefined && value <= exclusiveMin) errors.push(`${path}: ${value} must be greater than ${exclusiveMin}`);
      if (exclusiveMax !== undefined && value >= exclusiveMax) errors.push(`${path}: ${value} must be less than ${exclusiveMax}`);
    }

    if (typeof value === "string" && typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) {
      errors.push(`${path}: ${show(value)} does not match ${schema.pattern}`);
    }

    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) {
        errors.push(`${path}: needs at least ${schema.minItems} items, has ${value.length}`);
      }
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
        errors.push(`${path}: allows at most ${schema.maxItems} items, has ${value.length}`);
      }
      if (isObject(schema.items)) value.forEach((item, i) => this.check(item, schema.items as Schema, base, `${path}[${i}]`, errors));
    }

    if (isObject(value)) {
      for (const key of (schema.required as string[] | undefined) ?? []) {
        if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required property '${key}'`);
      }
      const properties = isObject(schema.properties) ? schema.properties : {};
      const extra = schema.additionalProperties ?? true;
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(properties, key)) this.check(item, properties[key] as Schema, base, `${path}.${key}`, errors);
        else if (extra === false) errors.push(`${path}: unexpected property '${key}'`);
        else if (isObject(extra)) this.check(item, extra, base, `${path}.${key}`, errors);
        if (isObject(schema.propertyNames)) this.check(key, schema.propertyNames, base, `${path} (property name '${key}')`, errors);
      }
    }
  }
}

/** Rejects keywords outside the supported subset, anywhere in a schema, even in definitions nothing references. */
function checkSchema(schema: unknown, where: string): void {
  if (!isObject(schema)) throw new SchemaError(`${where}: a schema must be an object`);
  const unknown = Object.keys(schema).filter((k) => !VALIDATION_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k)).sort();
  if (unknown.length > 0) throw new SchemaError(`${where}: unsupported schema keyword(s): ${unknown.join(", ")}`);
  for (const key of ["properties", "$defs"]) {
    const group = schema[key];
    if (isObject(group)) for (const [name, sub] of Object.entries(group)) checkSchema(sub, `${where}/${key}/${name}`);
  }
  for (const key of ["items", "propertyNames", "additionalProperties"]) {
    if (isObject(schema[key])) checkSchema(schema[key], `${where}/${key}`);
  }
}
