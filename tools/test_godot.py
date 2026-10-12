#!/usr/bin/env python3
"""Run the Godot project's gdUnit4 tests headless.

Finds Godot through the GODOT environment variable (the path to the Godot 4.7
executable; on Windows, the _console.exe so output reaches the terminal), or
`godot` on PATH. Imports the project first so Godot knows every script's
class_name, then runs gdUnit4 (installed by tools/setup.py).

Usage:
    python tools/test_godot.py                       every suite in godot/tests
    python tools/test_godot.py res://tests/sim/map   one folder or suite
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECT = REPO_ROOT / "godot"
sys.path.insert(0, str(REPO_ROOT / "tools"))
from setup import gdunit_dir  # noqa: E402

GDUNIT_TOOL = "res://addons/gdUnit4/bin/GdUnitCmdTool.gd"


def find_godot() -> str | None:
    path = os.environ.get("GODOT")
    if path:
        return path if Path(path).is_file() else None
    return shutil.which("godot")


def main(argv: list[str] | None = None) -> int:
    targets = (argv if argv is not None else sys.argv[1:]) or ["res://tests"]
    godot = find_godot()
    if not godot:
        print("Godot not found: set GODOT to the Godot 4.7 executable, or put `godot` on PATH", file=sys.stderr)
        return 1
    if not (gdunit_dir() / "plugin.cfg").is_file():
        print("gdUnit4 is not installed; run: python tools/setup.py", file=sys.stderr)
        return 1

    # Import builds .godot/, including the global class_name cache that test scripts rely on.
    imported = subprocess.run([godot, "--headless", "--path", str(PROJECT), "--import"])
    if imported.returncode != 0:
        print(f"project import failed (exit {imported.returncode})", file=sys.stderr)
        return imported.returncode

    # --remote-debug to an unbound port keeps Godot from dropping into its interactive
    # debugger on a script error, as gdUnit4's own runtest scripts do.
    command = [godot, "--headless", "--path", str(PROJECT), "-s", "-d", "--remote-debug", "tcp://127.0.0.1:0",
               GDUNIT_TOOL, "--ignoreHeadlessMode", "-c"]
    for target in targets:
        command += ["-a", target]
    return subprocess.run(command).returncode


if __name__ == "__main__":
    sys.exit(main())
