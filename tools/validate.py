#!/usr/bin/env python3
"""Validate data/*.json against data/schemas/, then run cross-file checks.

Each data/<name>.json is validated against data/schemas/<name>.schema.json.
This implements the subset of JSON Schema (draft 2020-12) that our schemas use.
Any other keyword in a schema is an error, so a schema can never silently check
less than it appears to. Editors like VS Code still validate the same files
with full JSON Schema through each file's "$schema" key.

Supported keywords: type, properties, required, additionalProperties,
propertyNames, items, minItems, maxItems, minimum, maximum, exclusiveMinimum,
exclusiveMaximum, enum, const, pattern, and $ref (within a schema file or to
another file in data/schemas).

Cross-file checks:
    - the player's weapons and starting weapon exist in weapons.json
    - weapon slots are unique
    - enemy classnames are defined in the TrenchBroom FGD
    - hull mins are below maxs on every axis

Usage:
    python tools/validate.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SCHEMA_DIR = DATA_DIR / "schemas"
FGD_PATH = REPO_ROOT / "maps" / "trenchbroom" / "hollowcoil.fgd"

VALIDATION_KEYWORDS = {
    "type", "properties", "required", "additionalProperties", "propertyNames", "items", "minItems", "maxItems",
    "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "enum", "const", "pattern", "$ref",
}
ANNOTATION_KEYWORDS = {"$schema", "$id", "$defs", "$comment", "title", "description", "default", "examples"}


class SchemaError(Exception):
    """A problem with a schema itself, as opposed to the data it checks."""


def json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "integer" if float(value).is_integer() else "number"
    return {dict: "object", list: "array", str: "string"}.get(type(value), type(value).__name__)


def is_type(value: Any, expected: str) -> bool:
    actual = json_type(value)
    return actual == expected or (expected == "number" and actual == "integer")


def is_number(value: Any) -> bool:
    return json_type(value) in ("integer", "number")


class Validator:
    def __init__(self, schema_dir: Path = SCHEMA_DIR) -> None:
        self.schema_dir = schema_dir
        self.files: dict[str, dict] = {}

    def load(self, name: str) -> dict:
        if name not in self.files:
            path = self.schema_dir / name
            if not path.is_file():
                raise SchemaError(f"schema file not found: {path.name}")
            self.files[name] = json.loads(path.read_text(encoding="utf-8"))
            self.check_schema(self.files[name], name)
        return self.files[name]

    def check_schema(self, schema: Any, where: str) -> None:
        """Reject keywords outside the supported subset, anywhere in a schema."""
        if not isinstance(schema, dict):
            raise SchemaError(f"{where}: a schema must be an object")
        unknown = set(schema) - VALIDATION_KEYWORDS - ANNOTATION_KEYWORDS
        if unknown:
            raise SchemaError(f"{where}: unsupported schema keyword(s): {', '.join(sorted(unknown))}")
        for key in ("properties", "$defs"):
            for name, sub in schema.get(key, {}).items():
                self.check_schema(sub, f"{where}/{key}/{name}")
        for key in ("items", "propertyNames", "additionalProperties"):
            if isinstance(schema.get(key), dict):
                self.check_schema(schema[key], f"{where}/{key}")

    def resolve(self, ref: str, base: str) -> tuple[dict, str]:
        file_part, _, pointer = ref.partition("#")
        target = file_part or base
        node: Any = self.load(target)
        for part in filter(None, pointer.split("/")):
            if not isinstance(node, dict) or part not in node:
                raise SchemaError(f"{base}: cannot resolve $ref {ref!r}")
            node = node[part]
        return node, target

    def validate(self, instance: Any, schema_file: str) -> list[str]:
        errors: list[str] = []
        self._validate(instance, self.load(schema_file), schema_file, "$", errors)
        return errors

    def _validate(self, value: Any, schema: dict, base: str, path: str, errors: list[str]) -> None:
        if "$ref" in schema:
            target, target_base = self.resolve(schema["$ref"], base)
            self._validate(value, target, target_base, path, errors)

        if "type" in schema:
            types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
            if not any(is_type(value, t) for t in types):
                errors.append(f"{path}: expected {' or '.join(types)}, got {json_type(value)}")
                return

        if "enum" in schema and value not in schema["enum"]:
            errors.append(f"{path}: {value!r} is not one of {schema['enum']}")
        if "const" in schema and value != schema["const"]:
            errors.append(f"{path}: expected {schema['const']!r}")

        if is_number(value):
            if "minimum" in schema and value < schema["minimum"]:
                errors.append(f"{path}: {value} is below the minimum {schema['minimum']}")
            if "maximum" in schema and value > schema["maximum"]:
                errors.append(f"{path}: {value} is above the maximum {schema['maximum']}")
            if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
                errors.append(f"{path}: {value} must be greater than {schema['exclusiveMinimum']}")
            if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
                errors.append(f"{path}: {value} must be less than {schema['exclusiveMaximum']}")

        if isinstance(value, str) and "pattern" in schema and not re.search(schema["pattern"], value):
            errors.append(f"{path}: {value!r} does not match {schema['pattern']}")

        if isinstance(value, list):
            if "minItems" in schema and len(value) < schema["minItems"]:
                errors.append(f"{path}: needs at least {schema['minItems']} items, has {len(value)}")
            if "maxItems" in schema and len(value) > schema["maxItems"]:
                errors.append(f"{path}: allows at most {schema['maxItems']} items, has {len(value)}")
            if "items" in schema:
                for i, item in enumerate(value):
                    self._validate(item, schema["items"], base, f"{path}[{i}]", errors)

        if isinstance(value, dict):
            for key in schema.get("required", []):
                if key not in value:
                    errors.append(f"{path}: missing required property {key!r}")
            properties = schema.get("properties", {})
            extra = schema.get("additionalProperties", True)
            for key, item in value.items():
                if key in properties:
                    self._validate(item, properties[key], base, f"{path}.{key}", errors)
                elif extra is False:
                    errors.append(f"{path}: unexpected property {key!r}")
                elif isinstance(extra, dict):
                    self._validate(item, extra, base, f"{path}.{key}", errors)
                if "propertyNames" in schema:
                    self._validate(key, schema["propertyNames"], base, f"{path} (property name {key!r})", errors)


def fgd_classnames(fgd_path: Path = FGD_PATH) -> set[str]:
    return set(re.findall(r"^@\w+Class\b[^=]*=\s*(\w+)", fgd_path.read_text(encoding="utf-8"), re.MULTILINE))


def check_hull(hull: dict, where: str) -> list[str]:
    if all(hull["mins"][i] < hull["maxs"][i] for i in range(3)):
        return []
    return [f"{where}: hull mins must be below maxs on every axis"]


def cross_check(data: dict[str, Any], classnames: set[str]) -> list[str]:
    """Checks that span files. Assumes every file already passed its schema."""
    errors: list[str] = []
    player, weapons, enemies = data["player"], data["weapons"]["weapons"], data["enemies"]["enemies"]

    for weapon_id in player["weapons"]:
        if weapon_id not in weapons:
            errors.append(f"player.json: weapon {weapon_id!r} is not defined in weapons.json")
    if player["starting_weapon"] not in player["weapons"]:
        errors.append(f"player.json: starting_weapon {player['starting_weapon']!r} is not in the player's weapons")
    errors += check_hull(player["hull"], "player.json")

    slots: dict[int, str] = {}
    for weapon_id, weapon in weapons.items():
        if weapon["slot"] in slots:
            errors.append(f"weapons.json: {weapon_id!r} and {slots[weapon['slot']]!r} both use slot {weapon['slot']}")
        slots[weapon["slot"]] = weapon_id

    for enemy_id, enemy in enemies.items():
        if enemy["classname"] not in classnames:
            errors.append(f"enemies.json: {enemy_id!r} classname {enemy['classname']!r} is not defined in the FGD")
        errors += check_hull(enemy["hull"], f"enemies.json: {enemy_id!r}")
    return errors


def main() -> int:
    validator = Validator()
    data: dict[str, Any] = {}
    failed = False
    for path in sorted(DATA_DIR.glob("*.json")):
        name = path.stem
        label = f"data/{path.name}"
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            errors = validator.validate(value, f"{name}.schema.json")
        except json.JSONDecodeError as e:
            errors = [f"invalid JSON: {e}"]
        except SchemaError as e:
            errors = [f"schema problem: {e}"]
        print(f"{'ok  ' if not errors else 'FAIL'}  {label}")
        for error in errors:
            print(f"        {error}")
        failed |= bool(errors)
        if not errors:
            data[name] = value

    missing = {"player", "weapons", "enemies"} - set(data)
    if failed or missing:
        if missing and not failed:
            print(f"FAIL  missing data files: {', '.join(sorted(missing))}")
        print("cross-file checks skipped until every file is valid")
        return 1

    errors = cross_check(data, fgd_classnames())
    print(f"{'ok  ' if not errors else 'FAIL'}  cross-file checks")
    for error in errors:
        print(f"        {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
