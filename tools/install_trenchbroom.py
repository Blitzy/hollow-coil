#!/usr/bin/env python3
"""Link the Hollow Coil game config into TrenchBroom.

Creates <TrenchBroom user dir>/games/HollowCoil pointing at maps/trenchbroom, so
TrenchBroom always reads the repo's current config and FGD. On Windows this is
a directory junction (no admin rights needed); elsewhere it is a symlink.

After installing, set the game path in TrenchBroom under
Preferences > Games > Hollow Coil to the repo root (the folder holding maps/ and textures/).

Usage:
    python tools/install_trenchbroom.py              create the link
    python tools/install_trenchbroom.py --uninstall  remove the link (the repo files are untouched)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO_ROOT / "maps" / "trenchbroom"
LINK_NAME = "HollowCoil"


class InstallError(Exception):
    pass


def trenchbroom_user_dir() -> Path:
    if sys.platform == "win32":
        return Path(os.environ["APPDATA"]) / "TrenchBroom"
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "TrenchBroom"
    return Path.home() / ".TrenchBroom"


def normalize(path: str | Path) -> str:
    text = str(path)
    if text.startswith("\\\\?\\"):
        text = text[4:]
    return os.path.normcase(os.path.abspath(text))


def link_target(path: Path) -> str | None:
    """Where a symlink or junction points, or None if path is not a link."""
    try:
        return os.readlink(path)
    except (OSError, ValueError):
        return None


def create_link(link: Path, target: Path) -> None:
    link.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        result = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True
        )
        if result.returncode != 0:
            raise InstallError(f"mklink failed: {(result.stdout + result.stderr).strip()}")
    else:
        os.symlink(target, link, target_is_directory=True)


def remove_link(link: Path) -> None:
    # A junction or directory symlink on Windows is removed with rmdir; this
    # removes only the link, never the files it points to.
    if sys.platform == "win32":
        os.rmdir(link)
    else:
        os.unlink(link)


def install(link: Path) -> None:
    current = link_target(link)
    if current is not None:
        if normalize(current) == normalize(CONFIG_DIR):
            print(f"already installed: {link} -> {CONFIG_DIR}")
            return
        raise InstallError(f"{link} already links to {current}; run with --uninstall first")
    if link.exists():
        raise InstallError(f"{link} exists and is not a link; move or delete it first")
    create_link(link, CONFIG_DIR)
    print(f"installed: {link} -> {CONFIG_DIR}")
    print(f"Next, in TrenchBroom: Preferences > Games > Hollow Coil, set the game path to {REPO_ROOT}")


def uninstall(link: Path) -> None:
    if link_target(link) is None:
        if link.exists():
            raise InstallError(f"{link} is not a link; not touching it")
        print(f"not installed: {link} does not exist")
        return
    remove_link(link)
    print(f"removed: {link}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Link the Hollow Coil game config into TrenchBroom.")
    parser.add_argument("--uninstall", action="store_true", help="remove the link")
    args = parser.parse_args(argv)

    link = trenchbroom_user_dir() / "games" / LINK_NAME
    try:
        if args.uninstall:
            uninstall(link)
        else:
            install(link)
    except (InstallError, OSError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
