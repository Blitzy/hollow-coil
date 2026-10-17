// Where a level's files are in a game directory, and why one won't load: the
// compiled .bsp under build/ (which the dev server compiles when it's stale), or
// the .map source under maps/ (which a release doesn't have).

/** A level file's URL, under a game directory's URL. */
export const levelUrl = (game: string, map: string, level: "bsp" | "map"): string => (level === "bsp" ? `${game}/build/${map}.bsp` : `${game}/maps/${map}.map`);

/** The line of a failed request's report that says why (a compile failure, a leak, missing tools), or its status. */
export function failureLine(report: string, response: Pick<Response, "status" | "statusText">): string {
  return report.split("\n").find((line) => /FAIL|error|leak|missing|not installed/i.test(line))?.trim() ?? `${response.status} ${response.statusText}`;
}

/**
 * Why a level file won't load, or null if it will: checked before the page reloads onto it, so a demo for a map that
 * isn't there says so instead of leaving a page that can't start. Only the response's headers are waited for on success.
 */
export async function levelProblem(game: string, map: string, level: "bsp" | "map", fetchFile: typeof fetch = fetch): Promise<string | null> {
  const file = `${map}.${level}`;
  try {
    const response = await fetchFile(levelUrl(game, map, level));
    if (response.ok) {
      void response.body?.cancel();
      return null;
    }
    if (response.status === 404) return `this game has no ${file}`;
    return `${file} didn't load: ${failureLine(await response.text(), response)}`;
  } catch (error) {
    return `${file} didn't load: ${error instanceof Error ? error.message : String(error)}`;
  }
}
