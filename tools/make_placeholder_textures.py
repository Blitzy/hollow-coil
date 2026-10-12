#!/usr/bin/env python3
"""Generate the placeholder textures in textures/dev/.

Grid textures are 64x64 with a line every 16 texels and a darker line on the
tile edge, so at the default scale of 1 they show 16- and 64-unit measurements
in the world. Solid textures are flat colors. The generated PNGs are committed;
rerun this script after changing the lists below.

Usage:
    python tools/make_placeholder_textures.py
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = REPO_ROOT / "textures" / "dev"
SIZE = 64
MINOR_STEP = 16

# name: (base, minor line, major line)
GRIDS = {
    "grid_grey": ((150, 150, 150), (118, 118, 118), (72, 72, 72)),
    "grid_light": ((200, 200, 200), (165, 165, 165), (110, 110, 110)),
    "grid_dark": ((80, 80, 80), (62, 62, 62), (36, 36, 36)),
    "grid_orange": ((168, 108, 58), (138, 86, 44), (88, 54, 26)),
    "grid_blue": ((72, 104, 172), (54, 80, 138), (32, 48, 92)),
    "grid_green": ((84, 140, 76), (64, 112, 58), (38, 70, 34)),
    "grid_red": ((168, 64, 56), (136, 48, 42), (88, 28, 24)),
}

SOLIDS = {
    "solid_white": (235, 235, 235),
    "solid_black": (20, 20, 20),
    "solid_red": (200, 40, 40),
    "solid_green": (40, 170, 60),
    "solid_blue": (40, 80, 200),
    "solid_yellow": (230, 200, 40),
}

Color = tuple[int, int, int]


def grid_pixels(base: Color, minor: Color, major: Color) -> list[Color]:
    pixels = []
    for y in range(SIZE):
        for x in range(SIZE):
            if x == 0 or y == 0:
                pixels.append(major)
            elif x % MINOR_STEP == 0 or y % MINOR_STEP == 0:
                pixels.append(minor)
            else:
                pixels.append(base)
    return pixels


def png_bytes(width: int, height: int, pixels: list[Color]) -> bytes:
    """Encode 8-bit RGB pixels as a PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = bytearray()
    for y in range(height):
        rows.append(0)  # filter type: none
        for color in pixels[y * width : (y + 1) * width]:
            rows.extend(color)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    textures = {name: grid_pixels(*colors) for name, colors in GRIDS.items()}
    textures |= {name: [color] * (SIZE * SIZE) for name, color in SOLIDS.items()}
    for name, pixels in textures.items():
        (OUT_DIR / f"{name}.png").write_bytes(png_bytes(SIZE, SIZE, pixels))
    print(f"wrote {len(textures)} textures to {OUT_DIR.relative_to(REPO_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
