#!/usr/bin/env python3
"""Compile maps with the pinned ericw-tools (qbsp, then light).

Compiles every .map in maps/ (or the ones named) to build/<name>.bsp in the
Quake 2 formats. A map fails if it leaks, references a texture that doesn't
exist, or if qbsp or light exits with an error. A failed map leaves no .bsp
behind, so a stale or broken build is never mistaken for a good one.

Modes:
    check    fast lighting; the default, used by CI and for quick iteration
    release  full-quality lighting (-extra4)

Usage:
    python tools/compile.py                       compile every map in maps/
    python tools/compile.py test_movement         compile maps/test_movement.map
    python tools/compile.py --mode release        full-quality lighting
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from setup import ericw_tool

REPO_ROOT = Path(__file__).resolve().parent.parent
# The game root holds maps/ and textures/ side by side, the standard Quake layout.
GAME_DIR = REPO_ROOT
MAPS_DIR = REPO_ROOT / "maps"
BUILD_DIR = REPO_ROOT / "build"

QBSP_ARGS = ["-q2bsp", "-leaktest", "-noverbose"]
LIGHT_ARGS = {
    "check": [],
    "release": ["-extra4"],
}

LEAK = re.compile(r'Reached occupant "([^"]+)" at \(([^)]*)\)')
MISSING_TEXTURE = re.compile(r"Couldn't locate texture for (\S+)")
WARNING = re.compile(r"^WARNING: (.*)$", re.MULTILINE)

# Everything qbsp and light write next to the .bsp, cleared before each compile.
OUTPUT_SUFFIXES = (".bsp", ".log", "-light.log", ".prt", ".leak.prt", ".pts", ".texinfo.json", ".content.json")

# qbsp adds a "skip" texture internally and warns about it on every compile.
IGNORED_MISSING_TEXTURES = {"skip"}
# Warnings that are expected and say nothing about the map's health.
IGNORED_WARNINGS = (
    re.compile(r"^Couldn't locate texture for "),  # reported as problems instead
    re.compile(r"^Reached occupant "),  # reported as a leak instead
    re.compile(r"can't find meta data for "),  # optional .wal_json files
)


@dataclass
class Result:
    name: str
    problems: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    seconds: float = 0.0

    @property
    def ok(self) -> bool:
        return not self.problems


def tools_installed() -> bool:
    return ericw_tool("qbsp").is_file() and ericw_tool("light").is_file()


def run(cmd: list[str]) -> tuple[int, str]:
    result = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    return result.returncode, result.stdout + result.stderr


def error_line(output: str) -> str:
    """The most useful line from a failed tool run: the one after an ERROR banner, if any."""
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    for i, line in enumerate(lines):
        if "ERROR" in line:
            return lines[i + 1] if "****" in line and i + 1 < len(lines) else line
    return lines[-1] if lines else "(no output)"


def warnings_in(output: str) -> list[str]:
    return [w for w in WARNING.findall(output) if not any(p.search(w) for p in IGNORED_WARNINGS)]


def compile_map(map_path: Path, out_dir: Path = BUILD_DIR, mode: str = "check", game_dir: Path = GAME_DIR) -> Result:
    """Compile one map to out_dir/<name>.bsp. Side files (logs, .prt, .pts) land next to it."""
    result = Result(map_path.stem)
    start = time.monotonic()
    out_dir.mkdir(parents=True, exist_ok=True)
    for suffix in OUTPUT_SUFFIXES:
        (out_dir / f"{map_path.stem}{suffix}").unlink(missing_ok=True)
    bsp = out_dir / f"{map_path.stem}.bsp"
    # Passed explicitly because out_dir is not the maps/ folder qbsp would infer them from.
    paths = ["-basedir", str(game_dir), "-gamedir", str(game_dir)]

    rc, output = run([str(ericw_tool("qbsp")), *QBSP_ARGS, *paths, str(map_path), str(bsp)])
    leak = LEAK.search(output)
    if leak:
        pts = bsp.with_suffix(".pts")
        result.problems.append(
            f'leak: "{leak[1]}" at ({leak[2]}) can reach the outside of the map. '
            f"Load {pts.relative_to(REPO_ROOT).as_posix() if pts.is_relative_to(REPO_ROOT) else pts} "
            f"in TrenchBroom (File > Load Point File) to see the path."
        )
    for texture in MISSING_TEXTURE.findall(output):
        if texture not in IGNORED_MISSING_TEXTURES:
            result.problems.append(f"missing texture: {texture}")
    if rc != 0 and not leak:
        result.problems.append(f"qbsp failed (exit {rc}): {error_line(output)}")
    result.warnings += warnings_in(output)

    if result.ok:
        rc, output = run([str(ericw_tool("light")), *LIGHT_ARGS[mode], *paths, str(bsp)])
        if rc != 0:
            result.problems.append(f"light failed (exit {rc}): {error_line(output)}")
        result.warnings += warnings_in(output)

    if not result.ok:
        bsp.unlink(missing_ok=True)
    result.seconds = time.monotonic() - start
    return result


def find_maps(names: list[str]) -> list[Path]:
    if not names:
        return sorted(MAPS_DIR.glob("*.map"))
    paths = []
    for name in names:
        path = Path(name) if name.endswith(".map") else MAPS_DIR / f"{name}.map"
        if not path.is_file():
            raise FileNotFoundError(f"no such map: {path}")
        paths.append(path.resolve())
    return paths


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compile maps with the pinned ericw-tools.")
    parser.add_argument("maps", nargs="*", help="map names (as in maps/<name>.map) or paths; default: every map")
    parser.add_argument("--mode", choices=sorted(LIGHT_ARGS), default="check", help="lighting quality (default: check)")
    args = parser.parse_args(argv)

    if not tools_installed():
        print("ericw-tools is not installed; run: python tools/setup.py", file=sys.stderr)
        return 1
    try:
        maps = find_maps(args.maps)
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    if not maps:
        print(f"no maps found in {MAPS_DIR.relative_to(REPO_ROOT).as_posix()}/")
        return 0

    print(f"compiling {len(maps)} map(s) in {args.mode} mode -> {BUILD_DIR.relative_to(REPO_ROOT).as_posix()}/")
    width = max(len(m.stem) for m in maps)
    failed = 0
    for map_path in maps:
        result = compile_map(map_path, mode=args.mode)
        status = "ok  " if result.ok else "FAIL"
        note = f"  ({len(result.warnings)} warning{'s' if len(result.warnings) != 1 else ''})" if result.warnings else ""
        print(f"  {status}  {result.name:<{width}}  {result.seconds:5.1f}s{note}")
        for problem in result.problems:
            print(f"        {problem}")
        for warning in result.warnings:
            print(f"        warning: {warning}")
        failed += not result.ok

    print(f"{len(maps) - failed} ok, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
