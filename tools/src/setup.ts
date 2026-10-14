// Downloads and installs the pinned third-party tools into .tools/, at the
// versions and checksums in packages/toolchain/versions.json:
//   - ericw-tools (qbsp, light, vis, bsputil, bspinfo)
//
// Usage: node tools/src/setup.ts [tool ...] [--check | --force]   (or npm run setup)
//   no options   install anything missing
//   tool names   only those (ericw-tools)
//   --check      verify installs; exit 1 if anything is missing
//   --force      reinstall even if already installed

import { parseArgs } from "node:util";
import { loadVersions, PINNED_TOOLS as TOOLS } from "@mandreljs/toolchain/setup";
import { isMain } from "./cli.ts";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { check: { type: "boolean" }, force: { type: "boolean" } },
    allowPositionals: true,
  });
  if (values.check && values.force) {
    console.error("setup: --check and --force can't be used together");
    return 2;
  }
  const unknown = positionals.filter((name) => !Object.hasOwn(TOOLS, name));
  if (unknown.length > 0) {
    console.error(`setup: unknown tool(s): ${unknown.join(", ")} (choose from ${Object.keys(TOOLS).join(", ")})`);
    return 2;
  }
  const selected = positionals.length > 0 ? positionals : Object.keys(TOOLS);

  try {
    const versions = loadVersions();
    if (values.check) return selected.map((name) => TOOLS[name]!.check(versions)).every(Boolean) ? 0 : 1;
    for (const name of selected) await TOOLS[name]!.install(versions, values.force ?? false);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`setup failed: ${error.message}`);
    return 1;
  }
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = await main();
