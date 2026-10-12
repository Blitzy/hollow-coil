#!/usr/bin/env python3
"""Fail if any tracked file is larger than MAX_BYTES.

Large binaries belong in Git LFS (not set up yet; see docs/DECISIONS.md if it
becomes needed). Catching them in CI keeps them out of history, where they
would stay forever.

Usage:
    python tools/check_files.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 2 * 1024 * 1024


def mb(n: int) -> str:
    return f"{n / (1024 * 1024):.2f} MB"


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO_ROOT, capture_output=True, check=True
    ).stdout
    return [REPO_ROOT / name for name in out.decode("utf-8").split("\0") if name]


def main() -> int:
    too_big = []
    for path in tracked_files():
        if path.is_file() and path.stat().st_size > MAX_BYTES:
            too_big.append(path)

    if too_big:
        print(f"Files larger than {mb(MAX_BYTES)}:")
        for path in too_big:
            print(f"  {path.relative_to(REPO_ROOT).as_posix()}  {mb(path.stat().st_size)}")
        return 1

    print(f"ok: no tracked file is larger than {mb(MAX_BYTES)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
