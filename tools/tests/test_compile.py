"""Tests for tools/compile.py. Needs ericw-tools installed (python tools/setup.py)."""

from __future__ import annotations

import shutil
import struct
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS_DIR))

import compile as compiler  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@unittest.skipUnless(compiler.tools_installed(), "ericw-tools not installed; run python tools/setup.py")
class CompileMapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.out = Path(tempfile.mkdtemp(prefix="hc-compile-"))
        self.addCleanup(shutil.rmtree, self.out, ignore_errors=True)

    def compile(self, name: str, mode: str = "check") -> compiler.Result:
        return compiler.compile_map(FIXTURES / f"{name}.map", self.out, mode=mode)

    def test_sealed_room_compiles_to_lit_quake2_bsp(self) -> None:
        result = self.compile("room")
        self.assertTrue(result.ok, result.problems)
        data = (self.out / "room.bsp").read_bytes()
        magic, version = struct.unpack_from("<4si", data, 0)
        self.assertEqual((magic, version), (b"IBSP", 38))
        lighting_offset, lighting_length = struct.unpack_from("<ii", data, 8 + 7 * 8)
        self.assertGreater(lighting_length, 0, "light did not write lightmaps")

    def test_release_mode_compiles(self) -> None:
        result = self.compile("room", mode="release")
        self.assertTrue(result.ok, result.problems)
        self.assertTrue((self.out / "room.bsp").is_file())

    def test_leak_fails_and_names_the_entity(self) -> None:
        result = self.compile("leak")
        self.assertFalse(result.ok)
        self.assertEqual(len(result.problems), 1, result.problems)
        self.assertIn("leak", result.problems[0])
        self.assertIn("info_player_start", result.problems[0])
        self.assertFalse((self.out / "leak.bsp").exists())
        self.assertTrue((self.out / "leak.pts").exists(), "leak point file should be kept for TrenchBroom")

    def test_missing_texture_fails_and_leaves_no_bsp(self) -> None:
        result = self.compile("missing_texture")
        self.assertFalse(result.ok)
        self.assertEqual(result.problems, ["missing texture: dev/not_a_texture"])
        self.assertFalse((self.out / "missing_texture.bsp").exists())

    def test_recompiling_after_a_fix_clears_stale_failure_files(self) -> None:
        shutil.copy(FIXTURES / "leak.map", self.out / "fixme.map")
        self.assertFalse(compiler.compile_map(self.out / "fixme.map", self.out / "build").ok)
        shutil.copy(FIXTURES / "room.map", self.out / "fixme.map")
        result = compiler.compile_map(self.out / "fixme.map", self.out / "build")
        self.assertTrue(result.ok, result.problems)
        self.assertFalse((self.out / "build" / "fixme.pts").exists())

    def test_output_next_to_the_map_never_deletes_the_map(self) -> None:
        shutil.copy(FIXTURES / "room.map", self.out / "room.map")
        result = compiler.compile_map(self.out / "room.map", self.out)
        self.assertTrue(result.ok, result.problems)
        self.assertTrue((self.out / "room.map").is_file())
        self.assertTrue((self.out / "room.bsp").is_file())


class FindMapsTests(unittest.TestCase):
    def test_unknown_map_name_is_an_error(self) -> None:
        with self.assertRaises(FileNotFoundError):
            compiler.find_maps(["definitely_not_a_map"])


if __name__ == "__main__":
    unittest.main()
