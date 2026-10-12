#!/usr/bin/env python3
"""Validate data and test scenarios against their schemas, then run cross-file checks.

Each data/<name>.json is validated against data/schemas/<name>.schema.json, and
each spec/<name>.json scenario against spec/schemas/scenario.schema.json.
This implements the subset of JSON Schema (draft 2020-12) that our schemas use.
Any other keyword in a schema is an error, so a schema can never silently check
less than it appears to. Editors like VS Code still validate the same files
with full JSON Schema through each file's "$schema" key.

Supported keywords: type, properties, required, additionalProperties,
propertyNames, items, minItems, maxItems, minimum, maximum, exclusiveMinimum,
exclusiveMaximum, enum, const, pattern, and $ref (within a schema file or to
another file in the same schemas folder).

Cross-file checks:
    - the player's weapons and starting weapon exist in weapons.json
    - weapon slots are unique
    - enemy classnames are defined in the TrenchBroom FGD
    - the FGD's light style choices match lightstyles.json, number and name
    - hull mins are below maxs on every axis
    - each scenario's map exists, and every marker it names is an info_marker in
      that map (marker names must be unique within a map)
    - scenario input segments are in order and fit the duration; checks happen
      within the duration; position and velocity checks have a tolerance
    - scenario weapon selections are real weapon slots

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
SPEC_DIR = REPO_ROOT / "spec"
SPEC_SCHEMA_DIR = SPEC_DIR / "schemas"
MAPS_DIR = REPO_ROOT / "maps"
FGD_PATH = MAPS_DIR / "trenchbroom" / "hollowcoil.fgd"

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


def fgd_style_choices(fgd_path: Path = FGD_PATH) -> dict[int, str]:
    """The light entity's style choices in the FGD, as {number: name}."""
    text = fgd_path.read_text(encoding="utf-8")
    block = re.search(r"\bstyle\(choices\)[^\[]*\[(.*?)\]", text, re.DOTALL)
    if not block:
        return {}
    return {int(n): name for n, name in re.findall(r'^\s*(\d+)\s*:\s*"([^"]*)"', block[1], re.MULTILINE)}


def lightstyle_check(lightstyles: dict, choices: dict[int, str]) -> list[str]:
    """The FGD offers exactly the styles lightstyles.json defines, under the same names."""
    defined = {int(n): style["name"] for n, style in lightstyles["styles"].items()}
    errors = []
    for n in sorted(defined.keys() | choices.keys()):
        if n not in choices:
            errors.append(f"lightstyles.json: style {n} ({defined[n]!r}) is not a style choice in the FGD")
        elif n not in defined:
            errors.append(f"FGD: light style choice {n} ({choices[n]!r}) is not defined in lightstyles.json")
        elif defined[n] != choices[n]:
            errors.append(f"lightstyles.json: style {n} is named {defined[n]!r} but the FGD calls it {choices[n]!r}")
    return errors


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


def map_markers(map_path: Path) -> tuple[dict[str, list[float]], list[str]]:
    """info_marker origins by name from a .map file, plus any problems (such as duplicate names)."""
    markers: dict[str, list[float]] = {}
    problems: list[str] = []
    depth, entity = 0, {}
    for line in map_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("//"):
            continue
        if line == "{":
            depth += 1
            if depth == 1:
                entity = {}
        elif line == "}":
            if depth == 1 and entity.get("classname") == "info_marker":
                name = entity.get("name", "")
                if name in markers:
                    problems.append(f"{map_path.name}: marker name {name!r} is used more than once")
                markers[name] = [float(v) for v in entity.get("origin", "0 0 0").split()]
            depth -= 1
        elif depth == 1 and line.startswith('"'):
            match = re.fullmatch(r'"([^"]*)"\s+"([^"]*)"', line)
            if match:
                entity[match[1]] = match[2]
    return markers, problems


def scenario_check(name: str, scenario: dict, weapon_slots: set[int], maps_dir: Path = MAPS_DIR) -> list[str]:
    """Checks on one scenario that its schema can't express. Assumes it passed the schema."""
    label = f"spec/{name}.json"
    errors: list[str] = []
    map_path = maps_dir / f"{scenario['map']}.map"
    if not map_path.is_file():
        return [f"{label}: map {scenario['map']!r} not found ({map_path.name})"]
    markers, problems = map_markers(map_path)
    errors += problems

    named = [scenario["start"]["marker"]] + [e["near_marker"]["name"] for e in scenario["expect"] if "near_marker" in e]
    for marker in named:
        if marker not in markers:
            errors.append(f"{label}: marker {marker!r} is not an info_marker in {map_path.name}")

    duration = scenario["duration"]
    previous = 0.0
    for i, segment in enumerate(scenario["inputs"]):
        if segment["until"] <= previous:
            errors.append(f"{label}: inputs[{i}].until ({segment['until']}) must be after {previous}")
        previous = segment["until"]
        if segment.get("weapon", 0) and segment["weapon"] not in weapon_slots:
            errors.append(f"{label}: inputs[{i}].weapon {segment['weapon']} is not a weapon slot in weapons.json")
    if previous > duration:
        errors.append(f"{label}: inputs run until {previous}, past the duration {duration}")

    for i, expectation in enumerate(scenario["expect"]):
        if expectation["at"] > duration:
            errors.append(f"{label}: expect[{i}].at ({expectation['at']}) is past the duration {duration}")
        if ("position" in expectation or "velocity" in expectation) and "tolerance" not in expectation:
            errors.append(f"{label}: expect[{i}] checks position or velocity but has no tolerance")
    return errors


def validate_files(paths: list[Path], label_dir: str, validator: Validator, schema_for) -> tuple[dict[str, Any], bool]:
    """Validate each file against its schema, printing results. Returns the valid files by name and whether any failed."""
    valid: dict[str, Any] = {}
    failed = False
    for path in paths:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            errors = validator.validate(value, schema_for(path))
        except json.JSONDecodeError as e:
            errors = [f"invalid JSON: {e}"]
        except SchemaError as e:
            errors = [f"schema problem: {e}"]
        print(f"{'ok  ' if not errors else 'FAIL'}  {label_dir}/{path.name}")
        for error in errors:
            print(f"        {error}")
        failed |= bool(errors)
        if not errors:
            valid[path.stem] = value
    return valid, failed


def main() -> int:
    data, data_failed = validate_files(
        sorted(DATA_DIR.glob("*.json")), "data", Validator(SCHEMA_DIR), lambda p: f"{p.stem}.schema.json")
    scenarios, spec_failed = validate_files(
        sorted(SPEC_DIR.glob("*.json")), "spec", Validator(SPEC_SCHEMA_DIR), lambda p: "scenario.schema.json")

    missing = {"player", "weapons", "enemies", "lightstyles"} - set(data)
    if data_failed or spec_failed or missing:
        if missing and not data_failed:
            print(f"FAIL  missing data files: {', '.join(sorted(missing))}")
        print("cross-file checks skipped until every file is valid")
        return 1

    errors = cross_check(data, fgd_classnames())
    errors += lightstyle_check(data["lightstyles"], fgd_style_choices())
    slots = {weapon["slot"] for weapon in data["weapons"]["weapons"].values()}
    for name, scenario in scenarios.items():
        errors += scenario_check(name, scenario, slots)
    print(f"{'ok  ' if not errors else 'FAIL'}  cross-file checks")
    for error in errors:
        print(f"        {error}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
