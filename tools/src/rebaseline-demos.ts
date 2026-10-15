// Makes golden demos' hashes and keyframes again from their recorded inputs, for
// when the engine's behavior or the example game's content changes on purpose. The
// inputs are kept; what the sim did with them, and the hashes of the content they
// played on, are replaced. Say so in the commit message, and after a content
// change, play the demo back to check it still does what it should.
//
// Usage: node tools/src/rebaseline-demos.ts [demo ...]   (or npm run rebaseline-demos)
//   demo   a file in demos/ (such as greybox_01.demo.json) or a path; default: every demo

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { contentChanges, formatDemo, rebaselineDemo, replayDemo, upgradeDemo } from "@mandreljs/sim/demo";
import { isMain } from "./cli.ts";
import { DemoLevels } from "./demo-levels.ts";
import { displayPath, repoPath } from "./layout.ts";

/** The demo files to work on: those named (in demos/, or paths), or every demo. */
export function demoFiles(names: readonly string[]): string[] {
  if (names.length === 0) return readdirSync(repoPath("demos")).filter((f) => f.endsWith(".demo.json")).map((f) => repoPath("demos", f));
  return names.map((name) => (existsSync(name) ? resolve(name) : repoPath("demos", name)));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const files = demoFiles(argv);
  if (files.length === 0) {
    console.log("no demos to rebaseline");
    return 0;
  }
  const levels = new DemoLevels();
  const config = levels.data();
  let failed = 0;
  try {
    for (const file of files) {
      try {
        const demo = upgradeDemo(JSON.parse(readFileSync(file, "utf-8")));
        const level = await levels.level(demo);
        const changed = contentChanges(demo, level, config);
        const { divergence } = replayDemo(demo, level, config);
        if (divergence === null && changed.length === 0) {
          console.log(`ok    ${basename(file)}  unchanged`);
          continue;
        }
        writeFileSync(file, formatDemo(rebaselineDemo(demo, level, config)));
        const why = [
          ...(changed.length > 0 ? [`content changed (${changed.join(", ")}): play it back to check it still does what it should`] : []),
          divergence === null ? "plays the same" : `first differed at tick ${divergence.tick}`,
        ];
        console.log(`new   ${basename(file)}  ${why.join("; ")}`);
      } catch (error) {
        failed++;
        console.log(`FAIL  ${displayPath(file)}  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    levels.close();
  }
  return failed === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) process.exitCode = await main();
