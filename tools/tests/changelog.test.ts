import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bumpVersion, CHANGELOG_PATH, ChangelogError, extractSection, isPrerelease, main, NOT_FOUND_EXIT_CODE, SectionNotFoundError, stampChangelog, SUBHEADINGS, today } from "../src/changelog.ts";

const EMPTY_TBD = ["## TBD", "", ...SUBHEADINGS.flatMap((h) => [h, ""])].join("\n");

const CHANGELOG = `# Changelog

## TBD

### ✨ Added

- Add a thing. ([#3](https://github.com/mandreljs/mandrel.js/pull/3))
  - With a detail.

### 🔧 Changed

### 🐛 Fixed

- Fix a bug.

### 🗑️ Removed

## v0.0.1 - 2026-10-16

### ✨ Added

- The first things.
`;

describe("bumpVersion", () => {
  it("bumps major, minor, or patch", () => {
    expect(bumpVersion("0.4.2", "major")).toBe("1.0.0");
    expect(bumpVersion("0.4.2", "minor")).toBe("0.5.0");
    expect(bumpVersion("0.4.2", "patch")).toBe("0.4.3");
  });

  it("takes an explicit version, with or without a v, if it's newer", () => {
    expect(bumpVersion("0.4.2", "0.10.0")).toBe("0.10.0");
    expect(bumpVersion("0.4.2", "v1.0.0")).toBe("1.0.0");
    expect(() => bumpVersion("0.4.2", "0.4.2")).toThrow(/isn't newer/);
    expect(() => bumpVersion("0.4.2", "0.3.9")).toThrow(/isn't newer/);
  });

  it("takes an explicit pre-release, and moves on from one", () => {
    expect(bumpVersion("0.4.2", "0.5.0-rc.1")).toBe("0.5.0-rc.1");
    expect(bumpVersion("0.5.0-rc.1", "0.5.0-rc.2")).toBe("0.5.0-rc.2");
    expect(bumpVersion("0.5.0-rc.1", "0.5.0")).toBe("0.5.0");
    expect(() => bumpVersion("0.5.0", "0.5.0-rc.1")).toThrow(/isn't newer/);
    // A keyword can't say which release a pre-release leads to.
    expect(() => bumpVersion("0.5.0-rc.1", "patch")).toThrow(/give the next version explicitly/);
  });

  it("refuses anything else", () => {
    expect(() => bumpVersion("0.4.2", "huge")).toThrow(ChangelogError);
    expect(() => bumpVersion("0.4.2", "1.2")).toThrow(/not "1.2"/);
  });

  it("knows a pre-release", () => {
    expect(["1.2.0-rc.1", "1.2.0-beta+build.5", "1.2.0", "1.2.0+build-5"].map(isPrerelease)).toEqual([true, true, false, false]);
  });
});

describe("stampChangelog", () => {
  const stamped = stampChangelog(CHANGELOG, "0.0.2", "2026-10-20");

  it("releases the TBD section under the version and date, with a fresh empty TBD above it", () => {
    expect(stamped).toBe(`# Changelog

${EMPTY_TBD}
## v0.0.2 - 2026-10-20

### ✨ Added

- Add a thing. ([#3](https://github.com/mandreljs/mandrel.js/pull/3))
  - With a detail.

### 🐛 Fixed

- Fix a bug.

## v0.0.1 - 2026-10-16

### ✨ Added

- The first things.
`);
  });

  it("refuses a TBD section with nothing in it, or a version that's already released", () => {
    expect(() => stampChangelog(stamped, "0.0.3", "2026-10-21")).toThrow(/has no entries/);
    expect(() => stampChangelog(CHANGELOG, "0.0.1", "2026-10-21")).toThrow(/already has a section for v0.0.1/);
    expect(() => stampChangelog("# Changelog\n", "0.0.1", "2026-10-21")).toThrow(/no "## TBD" section/);
  });

  it("round-trips: the stamped section is what extract gives back", () => {
    expect(extractSection(stamped, "0.0.2")).toBe(
      "### ✨ Added\n\n- Add a thing. ([#3](https://github.com/mandreljs/mandrel.js/pull/3))\n  - With a detail.\n\n### 🐛 Fixed\n\n- Fix a bug.",
    );
  });

  it("reads a changelog with Windows line endings", () => {
    expect(stampChangelog(CHANGELOG.replace(/\n/g, "\r\n"), "0.0.2", "2026-10-20")).toBe(stamped);
  });
});

describe("extractSection", () => {
  it("gives a version's section without its heading, with or without a v", () => {
    expect(extractSection(CHANGELOG, "0.0.1")).toBe("### ✨ Added\n\n- The first things.");
    expect(extractSection(CHANGELOG, "v0.0.1")).toBe("### ✨ Added\n\n- The first things.");
  });

  it("finds a section whose heading has no date", () => {
    expect(extractSection("## v1.0.0\n\nNotes.\n\n## v0.9.0\n", "1.0.0")).toBe("Notes.");
  });

  it("counts an empty section as missing, so an empty release is never published", () => {
    expect(() => extractSection("## v1.0.0 - 2026-10-20\n\n## v0.9.0\n\n- Old.\n", "1.0.0")).toThrow(/is empty/);
  });

  it("doesn't take one version for another that starts the same way", () => {
    expect(() => extractSection("## v0.0.10 - 2026-10-30\n\nLater.\n", "0.0.1")).toThrow(SectionNotFoundError);
  });
});

describe("changelog extract", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints the repo's changelog section for a version", () => {
    const version = /^## v(\d+\.\d+\.\d+)/m.exec(readFileSync(CHANGELOG_PATH, "utf-8"))![1]!;
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(main(["extract", `v${version}`])).toBe(0);
    expect(String(out.mock.calls[0]![0])).toContain("### ✨ Added");
  });

  it("exits with its own status when there's no section for the version", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(main(["extract", "99.0.0"])).toBe(NOT_FOUND_EXIT_CODE);
  });

  it("knows its dates in UTC", () => {
    expect(today(new Date("2026-10-16T23:30:00-07:00"))).toBe("2026-10-17");
  });
});
