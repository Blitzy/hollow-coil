#!/usr/bin/env python3
"""Print a compiled Quake 2 .bsp's contents as JSON.

Reports entities, element counts, textures used, and lightmap stats. Lightmap
sizes are computed from face geometry the way Quake 2 does (one luxel per 16
texels) and checked against the lighting data: each face's lightmap must fit
in the space before the next face's data. This catches both parsing mistakes
and compiler settings that change the luxel size.

ericw-tools pads each face's lightmap to a multiple of 4 samples, so faces are
not packed back to back. Always locate a face's lightmap by its offset.

Usage:
    python tools/bspdump.py build/test_movement.bsp
    python tools/bspdump.py build/test_movement.bsp --no-entities
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
from collections import Counter
from pathlib import Path

LUMP_NAMES = [
    "entities", "planes", "vertices", "visibility", "nodes", "texinfo", "faces", "lighting", "leafs",
    "leaf_faces", "leaf_brushes", "edges", "surface_edges", "models", "brushes", "brush_sides", "pop",
    "areas", "area_portals",
]
LUMP = {name: i for i, name in enumerate(LUMP_NAMES)}

# Bytes per element, for lumps that are arrays of fixed-size records.
RECORD_SIZES = {
    "planes": 20, "vertices": 12, "nodes": 28, "texinfo": 76, "faces": 20, "leafs": 28, "leaf_faces": 2,
    "leaf_brushes": 2, "edges": 4, "surface_edges": 4, "models": 48, "brushes": 12, "brush_sides": 4,
    "areas": 8, "area_portals": 8,
}

LUXEL_SIZE = 16  # texels per lightmap sample in Quake 2
NO_STYLE = 255


class BspError(Exception):
    pass


def parse_entities(text: str) -> list[dict[str, str]]:
    """Parse the entity lump: a list of { "key" "value" ... } blocks."""
    entities: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    pending_key: str | None = None
    i = 0
    while i < len(text):
        c = text[i]
        if c == "{":
            if current is not None:
                raise BspError(f"nested '{{' at offset {i}")
            current, pending_key = {}, None
        elif c == "}":
            if current is None or pending_key is not None:
                raise BspError(f"unexpected '}}' at offset {i}")
            entities.append(current)
            current = None
        elif c == '"':
            end = text.find('"', i + 1)
            if end < 0 or current is None:
                raise BspError(f"bad string at offset {i}")
            token = text[i + 1 : end]
            if pending_key is None:
                pending_key = token
            else:
                current[pending_key] = token
                pending_key = None
            i = end
        i += 1
    if current is not None:
        raise BspError("unterminated entity")
    return entities


class Bsp:
    def __init__(self, data: bytes) -> None:
        if len(data) < 8 + 19 * 8:
            raise BspError("file too small to be a .bsp")
        magic, version = struct.unpack_from("<4si", data, 0)
        if magic != b"IBSP" or version != 38:
            raise BspError(f"not a Quake 2 .bsp (magic {magic!r}, version {version})")
        self.data = data
        self.lumps = [struct.unpack_from("<ii", data, 8 + i * 8) for i in range(19)]

    def lump(self, name: str) -> bytes:
        offset, length = self.lumps[LUMP[name]]
        return self.data[offset : offset + length]

    def count(self, name: str) -> int:
        return len(self.lump(name)) // RECORD_SIZES[name]

    def bspx_lumps(self) -> dict[str, int]:
        """Extra BSPX lumps after the standard ones, as {name: bytes}."""
        end = (max(offset + length for offset, length in self.lumps) + 3) & ~3
        if self.data[end : end + 4] != b"BSPX":
            return {}
        (count,) = struct.unpack_from("<I", self.data, end + 4)
        result = {}
        for i in range(count):
            name, _, length = struct.unpack_from("<24sII", self.data, end + 8 + i * 32)
            result[name.split(b"\0")[0].decode("ascii", "replace")] = length
        return result

    def texinfos(self) -> list[tuple[tuple[float, ...], tuple[float, ...], int, str]]:
        """Per texinfo: (s vector + offset, t vector + offset, surface flags, texture name)."""
        raw = self.lump("texinfo")
        out = []
        for i in range(0, len(raw), 76):
            values = struct.unpack_from("<8f", raw, i)
            flags, _value = struct.unpack_from("<ii", raw, i + 32)
            name = raw[i + 40 : i + 72].split(b"\0")[0].decode("ascii", "replace")
            out.append((values[0:4], values[4:8], flags, name))
        return out

    def face_vertices(self, first_edge: int, num_edges: int) -> list[tuple[float, float, float]]:
        surface_edges = self.lump("surface_edges")
        edges = self.lump("edges")
        vertices = self.lump("vertices")
        out = []
        for i in range(first_edge, first_edge + num_edges):
            (edge,) = struct.unpack_from("<i", surface_edges, i * 4)
            v0, v1 = struct.unpack_from("<HH", edges, abs(edge) * 4)
            out.append(struct.unpack_from("<3f", vertices, (v0 if edge >= 0 else v1) * 12))
        return out


def lightmap_size(points, s_axis, t_axis) -> tuple[int, int]:
    """Luxel width and height for a face, matching Quake 2's surface extents."""
    size = []
    for axis in (s_axis, t_axis):
        values = [p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2] + axis[3] for p in points]
        low = math.floor(min(values) / LUXEL_SIZE)
        high = math.ceil(max(values) / LUXEL_SIZE)
        size.append(high - low + 1)
    return size[0], size[1]


def dump(path: Path, include_entities: bool = True) -> dict:
    bsp = Bsp(path.read_bytes())
    texinfos = bsp.texinfos()
    entities = parse_entities(bsp.lump("entities").split(b"\0")[0].decode("utf-8", "replace"))

    faces = bsp.lump("faces")
    lighting = bsp.lump("lighting")
    textures: Counter[str] = Counter()
    styles: Counter[int] = Counter()
    lit_faces = unlit_faces = used_samples = 0
    largest = (0, 0)
    blocks: list[tuple[int, int]] = []  # (byte offset, bytes needed) per lit face
    for i in range(0, len(faces), 20):
        _plane, _side, first_edge, num_edges, texinfo = struct.unpack_from("<HhihH", faces, i)
        face_styles = [s for s in faces[i + 12 : i + 16] if s != NO_STYLE]
        (light_offset,) = struct.unpack_from("<i", faces, i + 16)
        s_axis, t_axis, _flags, name = texinfos[texinfo]
        textures[name] += 1
        if light_offset < 0 or not face_styles:
            unlit_faces += 1
            continue
        lit_faces += 1
        styles.update(face_styles)
        width, height = lightmap_size(bsp.face_vertices(first_edge, num_edges), s_axis, t_axis)
        needed = width * height * len(face_styles)
        used_samples += needed
        blocks.append((light_offset, needed * 3))
        largest = max(largest, (width, height), key=lambda wh: wh[0] * wh[1])

    # Each face's lightmap must end before the next one starts, and inside the lump.
    blocks.sort()
    limits = [offset for offset, _ in blocks[1:]] + [len(lighting)]
    sizes_consistent = all(offset + size <= limit for (offset, size), limit in zip(blocks, limits))

    samples = len(lighting) // 3
    result = {
        "file": path.as_posix(),
        "format": "Quake 2 IBSP v38",
        "counts": {name: bsp.count(name) for name in (
            "faces", "models", "brushes", "brush_sides", "planes", "texinfo", "vertices", "nodes", "leafs")},
        "entity_classes": dict(sorted(Counter(e.get("classname", "") for e in entities).items())),
        "textures": dict(sorted(textures.items())),
        "lightmaps": {
            "bytes": len(lighting),
            "samples": samples,
            "used_samples": used_samples,
            "padding_samples": samples - used_samples,
            "sizes_consistent": sizes_consistent,
            "lit_faces": lit_faces,
            "unlit_faces": unlit_faces,
            "largest_face_luxels": list(largest),
            "faces_per_style": {str(k): v for k, v in sorted(styles.items())},
            "mean_rgb": [round(sum(lighting[c::3]) / samples, 1) for c in range(3)] if samples else [0, 0, 0],
            "max_rgb": [max(lighting[c::3]) for c in range(3)] if samples else [0, 0, 0],
        },
        "bspx_lumps": bsp.bspx_lumps(),
    }
    if include_entities:
        result["entities"] = entities
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print a Quake 2 .bsp's contents as JSON.")
    parser.add_argument("bsp", type=Path, help="path to a .bsp file")
    parser.add_argument("--no-entities", action="store_true", help="omit the full entity list")
    args = parser.parse_args(argv)
    try:
        result = dump(args.bsp, include_entities=not args.no_entities)
    except (BspError, OSError, struct.error) as e:
        print(f"error: {args.bsp}: {e}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
