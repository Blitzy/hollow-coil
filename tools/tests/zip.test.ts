import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { extractZip, readZip, ZipError } from "../src/zip.ts";

interface TestEntry {
  name: string;
  data?: string;
  mode?: number;
  store?: boolean;
}

/** A minimal zip archive, written the standard way, for testing the reader. */
function makeZip(entries: TestEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const raw = Buffer.from(entry.data ?? "", "utf-8");
    const stored = entry.store || entry.name.endsWith("/");
    const body = stored ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw) >>> 0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made on Unix, so the mode bits count
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc32(raw) >>> 0, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe("zip", () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "mandrel-zip-"));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("reads stored and deflated entries", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello" }, { name: "dir/" }, { name: "dir/b.txt", data: "x".repeat(1000), store: true }]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "dir/", "dir/b.txt"]);
    expect(new TextDecoder().decode(entries[0]!.read())).toBe("hello");
    expect(entries[2]!.read()).toHaveLength(1000);
  });

  it("extracts files and folders, keeping executable bits off Windows", () => {
    const dest = tempDir();
    extractZip(makeZip([{ name: "bin/" }, { name: "bin/tool", data: "#!/bin/sh", mode: 0o755 }, { name: "readme.md", data: "hi" }]), dest);
    expect(readFileSync(join(dest, "readme.md"), "utf-8")).toBe("hi");
    expect(readFileSync(join(dest, "bin", "tool"), "utf-8")).toBe("#!/bin/sh");
    if (process.platform !== "win32") expect(statSync(join(dest, "bin", "tool")).mode & 0o111).not.toBe(0);
  });

  it("refuses entries that would land outside the target folder", () => {
    const dest = tempDir();
    expect(() => extractZip(makeZip([{ name: "../evil.txt", data: "x" }]), join(dest, "out"))).toThrow(/escapes/);
    expect(existsSync(join(dest, "evil.txt"))).toBe(false);
  });

  it("detects corrupt data and non-zip files", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello", store: true }]);
    zip[30 + "a.txt".length] ^= 0xff; // flip the first byte of the stored data
    expect(() => readZip(zip)[0]!.read()).toThrow(/checksum/);
    expect(() => readZip(new Uint8Array(100))).toThrow(ZipError);
  });
});
