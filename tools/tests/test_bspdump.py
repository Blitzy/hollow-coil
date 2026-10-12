"""Tests for tools/bspdump.py. The compile-based tests need ericw-tools installed."""

from __future__ import annotations

import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS_DIR))

import bspdump  # noqa: E402
import compile as compiler  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class ParseEntitiesTests(unittest.TestCase):
    def test_parses_blocks_in_order(self) -> None:
        text = '{\n"classname" "worldspawn"\n"message" "Hi"\n}\n{\n"classname" "light"\n"origin" "0 0 96"\n}\n'
        self.assertEqual(
            bspdump.parse_entities(text),
            [{"classname": "worldspawn", "message": "Hi"}, {"classname": "light", "origin": "0 0 96"}],
        )

    def test_braces_and_empty_values_inside_strings(self) -> None:
        self.assertEqual(bspdump.parse_entities('{ "message" "{weird}" "target" "" }'), [{"message": "{weird}", "target": ""}])

    def test_malformed_input_raises(self) -> None:
        for text in ('{ "classname" "light"', '{ "key" }', '}', '{ { }'):
            with self.subTest(text=text), self.assertRaises(bspdump.BspError):
                bspdump.parse_entities(text)


class BspHeaderTests(unittest.TestCase):
    def test_rejects_non_quake2_files(self) -> None:
        with self.assertRaises(bspdump.BspError):
            bspdump.Bsp(b"\x1d\x00\x00\x00" + b"\0" * 200)  # a Quake 1 BSP29 header

    def test_cli_reports_missing_file(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(bspdump.main(["definitely/not/here.bsp"]), 1)
        self.assertIn("here.bsp", stderr.getvalue())


@unittest.skipUnless(compiler.tools_installed(), "ericw-tools not installed; run python tools/setup.py")
class DumpCompiledMapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.out = Path(tempfile.mkdtemp(prefix="hc-bspdump-"))
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)

    def compile(self, map_path: Path) -> Path:
        result = compiler.compile_map(map_path, self.out)
        self.assertTrue(result.ok, result.problems)
        return self.out / f"{map_path.stem}.bsp"

    def test_room_contents(self) -> None:
        info = bspdump.dump(self.compile(FIXTURES / "room.map"))
        self.assertEqual(info["entity_classes"], {"info_player_start": 1, "light": 1, "worldspawn": 1})
        self.assertIn({"classname": "light", "origin": "0 0 96", "light": "200"}, info["entities"])
        self.assertEqual(set(info["textures"]), {"dev/grid_grey", "dev/grid_light", "dev/grid_orange"})
        self.assertEqual(info["counts"]["brushes"], 6)
        self.assertGreater(info["counts"]["faces"], 0)

        lightmaps = info["lightmaps"]
        self.assertTrue(lightmaps["sizes_consistent"])
        self.assertEqual(lightmaps["lit_faces"], info["counts"]["faces"])
        self.assertEqual(lightmaps["faces_per_style"], {"0": info["counts"]["faces"]})
        self.assertGreater(lightmaps["mean_rgb"][0], 0)

    def test_light_style_adds_a_second_lightmap_per_face(self) -> None:
        styled = self.out / "styled.map"
        text = (FIXTURES / "room.map").read_text(encoding="utf-8")
        styled.write_text(text.replace('"light" "200"', '"light" "200"\n"style" "10"'), encoding="utf-8", newline="\n")
        info = bspdump.dump(self.compile(styled))
        lightmaps = info["lightmaps"]
        self.assertTrue(lightmaps["sizes_consistent"])
        self.assertIn("10", lightmaps["faces_per_style"])

    def test_no_entities_option(self) -> None:
        info = bspdump.dump(self.compile(FIXTURES / "room.map"), include_entities=False)
        self.assertNotIn("entities", info)
        self.assertIn("entity_classes", info)


if __name__ == "__main__":
    unittest.main()
