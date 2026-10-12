"""Tests for tools/setup.py helpers that don't need network access."""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS_DIR))

import setup  # noqa: E402


class ExtractSubdirTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="hc-setup-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.archive = self.dir / "archive.zip"
        self.dest = self.dir / "out"

    def make_archive(self, files: dict[str, str]) -> None:
        with zipfile.ZipFile(self.archive, "w") as z:
            for name, content in files.items():
                z.writestr(name, content)

    def test_extracts_only_the_prefix_and_strips_it(self) -> None:
        self.make_archive({
            "pkg-1.0/addons/tool/plugin.cfg": 'version="1.0"',
            "pkg-1.0/addons/tool/src/a.gd": "a",
            "pkg-1.0/README.md": "readme",
        })
        setup.extract_subdir(self.archive, "pkg-1.0/addons/tool", self.dest)
        self.assertEqual(sorted(p.relative_to(self.dest).as_posix() for p in self.dest.rglob("*") if p.is_file()),
                         ["plugin.cfg", "src/a.gd"])

    def test_refuses_paths_that_escape(self) -> None:
        self.make_archive({"pkg/tool/../../../evil.txt": "x"})
        with self.assertRaises(setup.SetupError):
            setup.extract_subdir(self.archive, "pkg/tool", self.dest)
        self.assertFalse((self.dir / "evil.txt").exists())

    def test_reports_a_missing_prefix(self) -> None:
        self.make_archive({"other/file.txt": "x"})
        with self.assertRaisesRegex(setup.SetupError, "nothing under pkg/tool/"):
            setup.extract_subdir(self.archive, "pkg/tool", self.dest)

    def test_verify_gdunit_checks_the_version(self) -> None:
        (self.dest).mkdir()
        (self.dest / "plugin.cfg").write_text('[plugin]\nversion="6.2.0"\n', encoding="utf-8")
        with self.assertRaisesRegex(setup.SetupError, "version 6.2.1"):
            setup.verify_gdunit(self.dest, "6.2.1")
        setup.verify_gdunit(self.dest, "6.2.0")


if __name__ == "__main__":
    unittest.main()
