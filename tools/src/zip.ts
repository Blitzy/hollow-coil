// A small zip reader on Node's zlib, for unpacking pinned tool downloads (and,
// later, user level packages). Supports stored and deflated entries, checks
// each entry's CRC-32, and refuses entries that would land outside the target
// folder. No Zip64 or encryption, which our archives don't use.

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

export class ZipError extends Error {
  override name = "ZipError";
}

export interface ZipEntry {
  /** Path inside the archive, with forward slashes; directories end in "/". */
  readonly name: string;
  /** Unix permission bits, if the archive recorded them (0 otherwise). */
  readonly mode: number;
  /** The entry's contents (empty for directories). */
  read(): Uint8Array;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const UNIX_HOST = 3;

/** The entries of a zip archive, in central directory order. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number): number => view.getUint16(at, true);
  const u32 = (at: number): number => view.getUint32(at, true);

  // The end record sits in the last 22 bytes plus up to 64 KB of comment.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new ZipError("not a zip archive (no end of central directory)");
  const count = u16(end + 10);
  const directoryOffset = u32(end + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new ZipError("Zip64 archives aren't supported");

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== CENTRAL_HEADER) throw new ZipError(`bad central directory entry ${i}`);
    const host = u16(at + 4) >> 8;
    const flags = u16(at + 8);
    const method = u16(at + 10);
    const crc = u32(at + 16);
    const compressedSize = u32(at + 20);
    const size = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    const externalAttributes = u32(at + 38);
    const localOffset = u32(at + 42);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "latin1").decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipError(`${name}: encrypted entries aren't supported`);
    if (method !== 0 && method !== 8) throw new ZipError(`${name}: unsupported compression method ${method}`);
    entries.push({
      name,
      mode: host === UNIX_HOST ? (externalAttributes >>> 16) & 0o7777 : 0,
      read(): Uint8Array {
        if (localOffset + 30 > bytes.length || u32(localOffset) !== LOCAL_HEADER) throw new ZipError(`${name}: bad local header`);
        const start = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
        const raw = bytes.subarray(start, start + compressedSize);
        if (raw.length !== compressedSize) throw new ZipError(`${name}: truncated`);
        const data = method === 0 ? raw : new Uint8Array(inflateRawSync(raw));
        if (data.length !== size) throw new ZipError(`${name}: expected ${size} bytes, got ${data.length}`);
        if (crc32(data) >>> 0 !== crc) throw new ZipError(`${name}: checksum mismatch`);
        return data;
      },
    });
  }
  return entries;
}

/** Extracts every entry under dest, refusing paths that escape it and restoring executable bits off Windows. */
export function extractZip(bytes: Uint8Array, dest: string): void {
  const root = resolve(dest);
  for (const entry of readZip(bytes)) {
    const target = resolve(root, entry.name);
    if (target !== root && !target.startsWith(root + sep)) throw new ZipError(`refusing to extract '${entry.name}': path escapes ${dest}`);
    if (entry.name.endsWith("/")) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.read());
    if (process.platform !== "win32" && entry.mode & 0o111) chmodSync(target, 0o644 | (entry.mode & 0o777));
  }
}
