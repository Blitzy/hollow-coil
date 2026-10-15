// Replays every golden demo in /demos on the example game, and fails if the map or
// data it was recorded on has changed, or at the first tick whose state differs
// from the recording. Demos recorded on a .bsp need ericw-tools to compile it, and
// skip without them; CI installs them.

import { readdirSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { DemoLevels } from "@mandreljs/tools/demo-levels";
import { readRepoFile, REPO_ROOT } from "@mandreljs/tools/testing";
import { contentChanges, replayDemo, upgradeDemo } from "@mandreljs/sim/demo";
import { join } from "node:path";

const files = readdirSync(join(REPO_ROOT, "demos")).filter((f) => f.endsWith(".demo.json"));
const demos = files.map((file) => [file, upgradeDemo(JSON.parse(readRepoFile(`demos/${file}`)))] as const);
const levels = new DemoLevels();
const config = levels.data();
afterAll(() => levels.close());

describe("golden demos", () => {
  if (demos.length === 0) it.skip("none recorded yet", () => {});

  for (const [file, demo] of demos) {
    it.skipIf(!levels.canLoad(demo))(`${file} (${demo.map}, ${demo.ticks} ticks)`, async () => {
      const level = await levels.level(demo);
      const changed = contentChanges(demo, level, config);
      const rebaseline = `npm run rebaseline-demos -- ${file}`;
      expect(changed, `${changed.map((c) => (c === "map" ? `${demo.map}'s map` : `${c}.json`)).join(" and ")} changed since this demo was recorded. If on purpose: ${rebaseline}, then play it back to check it still does what it should, or record it again.`).toEqual([]);
      const { divergence } = replayDemo(demo, level, config);
      const report =
        divergence === null
          ? ""
          : [
              `first differs at tick ${divergence.tick} (${(divergence.tick / demo.tick_rate).toFixed(2)}s); ${divergence.differences.length > 0 ? `at keyframe ${divergence.keyframe}:` : "evened out again before the next keyframe"}`,
              ...divergence.differences.map((line) => `  ${line}`),
              `If the behavior changed on purpose: ${rebaseline}, and say so in the commit message.`,
            ].join("\n");
      expect(divergence, report).toBeNull();
    }, 60_000);
  }
});
