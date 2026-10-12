"""Tests for tools/validate.py."""

from __future__ import annotations

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS_DIR))

import validate  # noqa: E402


def load_real(name: str) -> dict:
    return json.loads((validate.DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


class SchemaKeywordTests(unittest.TestCase):
    """The validator subset, exercised with small schemas in a temporary folder."""

    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="hc-schema-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def check(self, schema: dict, value, extra_files: dict | None = None) -> list[str]:
        (self.dir / "test.schema.json").write_text(json.dumps(schema), encoding="utf-8")
        for name, content in (extra_files or {}).items():
            (self.dir / name).write_text(json.dumps(content), encoding="utf-8")
        return validate.Validator(self.dir).validate(value, "test.schema.json")

    def test_types(self) -> None:
        self.assertEqual(self.check({"type": "integer"}, 3), [])
        self.assertEqual(self.check({"type": "integer"}, 3.0), [])  # JSON Schema: 3.0 is an integer
        self.assertTrue(self.check({"type": "integer"}, 3.5))
        self.assertTrue(self.check({"type": "number"}, True))  # booleans are not numbers
        self.assertTrue(self.check({"type": "string"}, 1))
        self.assertEqual(self.check({"type": ["string", "null"]}, None), [])

    def test_numeric_bounds(self) -> None:
        schema = {"type": "number", "minimum": 0, "maximum": 10}
        self.assertEqual(self.check(schema, 0), [])
        self.assertTrue(self.check(schema, -1))
        self.assertTrue(self.check(schema, 11))
        self.assertTrue(self.check({"exclusiveMinimum": 0}, 0))
        self.assertTrue(self.check({"exclusiveMaximum": 1}, 1))

    def test_objects(self) -> None:
        schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}
        self.assertEqual(self.check(schema, {"a": 1}), [])
        self.assertEqual(self.check(schema, {}), ["$: missing required property 'a'"])
        self.assertEqual(self.check(schema, {"a": 1, "b": 2}), ["$: unexpected property 'b'"])
        self.assertEqual(self.check(schema, {"a": "x"}), ["$.a: expected integer, got string"])

    def test_map_values_and_key_names(self) -> None:
        schema = {"type": "object", "propertyNames": {"pattern": "^[a-z]+$"}, "additionalProperties": {"type": "integer"}}
        self.assertEqual(self.check(schema, {"ok": 1}), [])
        self.assertEqual(len(self.check(schema, {"Bad": 1})), 1)
        self.assertEqual(self.check(schema, {"ok": "x"}), ["$.ok: expected integer, got string"])

    def test_arrays_enum_const_pattern(self) -> None:
        schema = {"type": "array", "items": {"enum": ["a", "b"]}, "minItems": 1, "maxItems": 2}
        self.assertEqual(self.check(schema, ["a"]), [])
        self.assertTrue(self.check(schema, []))
        self.assertTrue(self.check(schema, ["a", "b", "a"]))
        self.assertEqual(len(self.check(schema, ["c"])), 1)
        self.assertTrue(self.check({"const": 5}, 6))
        self.assertTrue(self.check({"type": "string", "pattern": "^monster_"}, "item_x"))

    def test_refs_within_and_across_files(self) -> None:
        schema = {"$defs": {"pos": {"type": "number", "minimum": 0}},
                  "properties": {"a": {"$ref": "#/$defs/pos"}, "b": {"$ref": "other.schema.json#/$defs/name"}}}
        other = {"$defs": {"name": {"type": "string"}}}
        self.assertEqual(self.check(schema, {"a": 1, "b": "x"}, {"other.schema.json": other}), [])
        errors = self.check(schema, {"a": -1, "b": 2}, {"other.schema.json": other})
        self.assertEqual(len(errors), 2, errors)

    def test_unsupported_keywords_are_rejected_anywhere(self) -> None:
        with self.assertRaises(validate.SchemaError):
            self.check({"type": "string", "format": "email"}, "x")
        with self.assertRaises(validate.SchemaError):
            self.check({"$defs": {"unused": {"oneOf": []}}}, "x")  # even in definitions nothing references


class RealDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = validate.Validator()

    def test_every_data_file_is_valid(self) -> None:
        for name in ("player", "weapons", "enemies"):
            with self.subTest(name=name):
                self.assertEqual(self.validator.validate(load_real(name), f"{name}.schema.json"), [])

    def test_real_schemas_catch_mistakes(self) -> None:
        cases = [
            ("weapons", lambda d: d["weapons"]["pistol"]["hitscan"].__setitem__("damage", "14"),
             "$.weapons.pistol.hitscan.damage: expected number, got string"),
            ("weapons", lambda d: d["weapons"]["shotgun"].__setitem__("fire_intervall", 0.9),
             "$.weapons.shotgun: unexpected property 'fire_intervall'"),
            ("weapons", lambda d: d["switching"].__setitem__("raise_time", 0),
             "$.switching.raise_time: 0 must be greater than 0"),
            ("enemies", lambda d: d["enemies"]["shotgunner"].pop("think_interval"),
             "$.enemies.shotgunner: missing required property 'think_interval'"),
            ("enemies", lambda d: d["enemies"]["shotgunner"]["pain"].__setitem__("chance", 1.5),
             "$.enemies.shotgunner.pain.chance: 1.5 is above the maximum 1"),
            ("player", lambda d: d["hull"].__setitem__("mins", [-16, -16]),
             "$.hull.mins: needs at least 3 items, has 2"),
        ]
        for name, mutate, expected in cases:
            with self.subTest(expected=expected):
                data = load_real(name)
                mutate(data)
                self.assertIn(expected, self.validator.validate(data, f"{name}.schema.json"))


class CrossCheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.data = {name: load_real(name) for name in ("player", "weapons", "enemies")}
        self.classnames = validate.fgd_classnames()

    def errors_after(self, mutate) -> list[str]:
        data = copy.deepcopy(self.data)
        mutate(data)
        return validate.cross_check(data, self.classnames)

    def test_real_data_passes(self) -> None:
        self.assertEqual(validate.cross_check(self.data, self.classnames), [])

    def test_fgd_classnames(self) -> None:
        self.assertTrue({"monster_shotgunner", "info_player_start", "info_marker", "light"} <= self.classnames)

    def test_unknown_weapon(self) -> None:
        errors = self.errors_after(lambda d: d["player"]["weapons"].append("railgun"))
        self.assertEqual(errors, ["player.json: weapon 'railgun' is not defined in weapons.json"])

    def test_starting_weapon_not_carried(self) -> None:
        errors = self.errors_after(lambda d: d["player"]["weapons"].remove("pistol"))
        self.assertIn("player.json: starting_weapon 'pistol' is not in the player's weapons", errors)

    def test_duplicate_slots(self) -> None:
        errors = self.errors_after(lambda d: d["weapons"]["weapons"]["shotgun"].__setitem__("slot", 1))
        self.assertEqual(errors, ["weapons.json: 'shotgun' and 'pistol' both use slot 1"])

    def test_unknown_classname(self) -> None:
        errors = self.errors_after(lambda d: d["enemies"]["enemies"]["shotgunner"].__setitem__("classname", "monster_ogre"))
        self.assertEqual(errors, ["enemies.json: 'shotgunner' classname 'monster_ogre' is not defined in the FGD"])

    def test_inverted_hull(self) -> None:
        errors = self.errors_after(lambda d: d["player"]["hull"].__setitem__("maxs", [16, 16, -30]))
        self.assertEqual(errors, ["player.json: hull mins must be below maxs on every axis"])


if __name__ == "__main__":
    unittest.main()
