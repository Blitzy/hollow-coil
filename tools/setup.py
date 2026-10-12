#!/usr/bin/env python3
"""Download and install pinned third-party tools.

Installs, at the versions and checksums pinned in tools/versions.json, so every
machine and CI use the same builds:
    - ericw-tools (qbsp, light, vis, bsputil, bspinfo) into .tools/
    - the gdUnit4 test framework into godot/addons/gdUnit4 (gitignored)

Usage:
    python tools/setup.py             install anything missing
    python tools/setup.py gdunit4     only the named tools (ericw-tools, gdunit4)
    python tools/setup.py --check     verify installs; exit 1 if anything is missing
    python tools/setup.py --force     reinstall even if already installed
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VERSIONS_FILE = REPO_ROOT / "tools" / "versions.json"
TOOLS_DIR = REPO_ROOT / ".tools"
DOWNLOADS_DIR = TOOLS_DIR / "downloads"

# Written last during install, holding the archive checksum. Its absence means
# the install is missing or incomplete.
MARKER = ".installed"

ERICW_BINARIES = ("qbsp", "light", "vis", "bsputil", "bspinfo")


class SetupError(Exception):
    pass


def platform_key() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    if sys.platform == "darwin":
        return "macos"
    raise SetupError(f"unsupported platform: {sys.platform}")


def exe_name(name: str) -> str:
    return name + ".exe" if sys.platform == "win32" else name


def load_versions() -> dict:
    with VERSIONS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def ericw_dir(versions: dict | None = None) -> Path:
    """Directory holding the pinned ericw-tools binaries."""
    versions = versions or load_versions()
    return TOOLS_DIR / "ericw-tools" / versions["ericw-tools"]["version"]


def ericw_tool(name: str, versions: dict | None = None) -> Path:
    """Path to one ericw-tools binary, such as "qbsp" or "light"."""
    return ericw_dir(versions) / exe_name(name)


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: Path, expected_sha256: str) -> None:
    if dest.is_file() and sha256_of(dest) == expected_sha256:
        print(f"  using cached {dest.name}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".partial")
    print(f"  downloading {url}")
    try:
        with urllib.request.urlopen(url, timeout=60) as response, partial.open("wb") as out:
            shutil.copyfileobj(response, out, 1 << 20)
    except OSError as e:
        partial.unlink(missing_ok=True)
        raise SetupError(f"download failed: {e}") from e
    actual = sha256_of(partial)
    if actual != expected_sha256:
        partial.unlink()
        raise SetupError(
            f"checksum mismatch for {dest.name}\n"
            f"  expected {expected_sha256}\n"
            f"  got      {actual}"
        )
    partial.replace(dest)


def extract(archive: Path, dest: Path) -> None:
    """Extract a zip, refusing paths that escape dest and restoring executable bits."""
    dest_resolved = dest.resolve()
    with zipfile.ZipFile(archive) as z:
        for info in z.infolist():
            target = (dest / info.filename).resolve()
            if not target.is_relative_to(dest_resolved):
                raise SetupError(f"refusing to extract {info.filename!r}: path escapes {dest}")
            z.extract(info, dest)
            # zipfile drops Unix permissions, so put the executable bits back.
            mode = info.external_attr >> 16
            if sys.platform != "win32" and not info.is_dir() and mode & 0o111:
                target.chmod(target.stat().st_mode | (mode & 0o111))


def verify_ericw(install_dir: Path, version: str) -> None:
    missing = [n for n in ERICW_BINARIES if not (install_dir / exe_name(n)).is_file()]
    if missing:
        raise SetupError(f"ericw-tools install is missing: {', '.join(missing)}")

    # Run with no arguments, qbsp prints a banner like
    # "---- qbsp / ericw-tools 2.0.0-alpha11 ----".
    qbsp = install_dir / exe_name("qbsp")
    try:
        result = subprocess.run(
            [str(qbsp)], capture_output=True, text=True, errors="replace", timeout=30
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise SetupError(f"could not run {qbsp}: {e}") from e
    lines = (result.stdout + result.stderr).splitlines()
    banner = lines[0] if lines else "(no output)"
    expected = f"ericw-tools {version}"
    if expected not in banner:
        raise SetupError(f"unexpected qbsp banner {banner!r}, expected it to mention {expected!r}")


def install_ericw(versions: dict, force: bool) -> Path:
    entry = versions["ericw-tools"]
    version = entry["version"]
    plat = entry["platforms"].get(platform_key())
    if plat is None:
        raise SetupError(f"no ericw-tools build listed for {platform_key()} in {VERSIONS_FILE.name}")

    install_dir = ericw_dir(versions)
    marker = install_dir / MARKER
    if not force and marker.is_file() and marker.read_text(encoding="utf-8").strip() == plat["sha256"]:
        print(f"ericw-tools {version}: already installed")
        return install_dir

    print(f"ericw-tools {version}: installing")
    archive = DOWNLOADS_DIR / plat["file"]
    download(entry["url"].format(version=version, file=plat["file"]), archive, plat["sha256"])

    # Extract and verify in a staging directory, then swap it in, so an
    # interrupted install never looks complete.
    staging = install_dir.with_name(install_dir.name + ".partial")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    extract(archive, staging)
    verify_ericw(staging, version)
    (staging / MARKER).write_text(plat["sha256"] + "\n", encoding="utf-8")
    shutil.rmtree(install_dir, ignore_errors=True)
    staging.rename(install_dir)

    print(f"  installed to {install_dir.relative_to(REPO_ROOT).as_posix()}")
    return install_dir


def check_ericw(versions: dict) -> bool:
    version = versions["ericw-tools"]["version"]
    install_dir = ericw_dir(versions)
    if not (install_dir / MARKER).is_file():
        print(f"ericw-tools {version}: not installed (run python tools/setup.py)")
        return False
    try:
        verify_ericw(install_dir, version)
    except SetupError as e:
        print(f"ericw-tools {version}: broken install: {e}")
        return False
    print(f"ericw-tools {version}: ok")
    return True


def gdunit_dir(versions: dict | None = None) -> Path:
    """Where the gdUnit4 addon is installed inside the Godot project."""
    versions = versions or load_versions()
    return REPO_ROOT / versions["gdunit4"]["install_dir"]


def extract_subdir(archive: Path, prefix: str, dest: Path) -> None:
    """Extract only the archive entries under prefix/, with that prefix removed."""
    prefix = prefix.rstrip("/") + "/"
    dest_resolved = dest.resolve()
    with zipfile.ZipFile(archive) as z:
        members = [info for info in z.infolist() if info.filename.startswith(prefix) and info.filename != prefix]
        if not members:
            raise SetupError(f"{archive.name} has nothing under {prefix}")
        for info in members:
            target = (dest / info.filename[len(prefix):]).resolve()
            if not target.is_relative_to(dest_resolved):
                raise SetupError(f"refusing to extract {info.filename!r}: path escapes {dest}")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as src, target.open("wb") as out:
                shutil.copyfileobj(src, out)


def verify_gdunit(install_dir: Path, version: str) -> None:
    plugin = install_dir / "plugin.cfg"
    if not plugin.is_file():
        raise SetupError(f"gdUnit4 install is missing {plugin.name}")
    if f'version="{version}"' not in plugin.read_text(encoding="utf-8"):
        raise SetupError(f"{plugin.name} does not say version {version}")


def install_gdunit(versions: dict, force: bool) -> Path:
    entry = versions["gdunit4"]
    version = entry["version"]
    install_dir = gdunit_dir(versions)
    marker = install_dir / MARKER
    if not force and marker.is_file() and marker.read_text(encoding="utf-8").strip() == entry["sha256"]:
        print(f"gdUnit4 {version}: already installed")
        return install_dir

    print(f"gdUnit4 {version}: installing")
    archive = DOWNLOADS_DIR / entry["file"]
    download(entry["url"].format(version=version), archive, entry["sha256"])

    staging = install_dir.with_name(install_dir.name + ".partial")
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(parents=True)
    extract_subdir(archive, entry["archive_dir"], staging)
    verify_gdunit(staging, version)
    (staging / MARKER).write_text(entry["sha256"] + "\n", encoding="utf-8")
    shutil.rmtree(install_dir, ignore_errors=True)
    staging.rename(install_dir)

    print(f"  installed to {install_dir.relative_to(REPO_ROOT).as_posix()}")
    return install_dir


def check_gdunit(versions: dict) -> bool:
    version = versions["gdunit4"]["version"]
    install_dir = gdunit_dir(versions)
    if not (install_dir / MARKER).is_file():
        print(f"gdUnit4 {version}: not installed (run python tools/setup.py)")
        return False
    try:
        verify_gdunit(install_dir, version)
    except SetupError as e:
        print(f"gdUnit4 {version}: broken install: {e}")
        return False
    print(f"gdUnit4 {version}: ok")
    return True


# Each tool by its versions.json key: (install, check).
TOOLS = {
    "ericw-tools": (install_ericw, check_ericw),
    "gdunit4": (install_gdunit, check_gdunit),
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install pinned third-party tools.")
    parser.add_argument("tools", nargs="*", metavar="tool",
                        help=f"tools to install or check: {', '.join(TOOLS)} (default: all)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="verify installs without changing anything")
    mode.add_argument("--force", action="store_true", help="reinstall even if already installed")
    args = parser.parse_args(argv)
    unknown = [name for name in args.tools if name not in TOOLS]
    if unknown:
        parser.error(f"unknown tool(s): {', '.join(unknown)} (choose from {', '.join(TOOLS)})")
    selected = args.tools or list(TOOLS)

    try:
        versions = load_versions()
        if args.check:
            results = [TOOLS[name][1](versions) for name in selected]
            return 0 if all(results) else 1
        for name in selected:
            TOOLS[name][0](versions, args.force)
    except KeyError as e:
        print(f"setup failed: {VERSIONS_FILE.name} is missing key {e}", file=sys.stderr)
        return 1
    except (SetupError, OSError) as e:
        print(f"setup failed: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
