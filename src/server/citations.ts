import type { githubClient } from "./github.ts";

/** A claim "these lines of this file"; `where` is the location a refusal names, for whoever must fix it (decision 043 B). */
export type Citation = {
  where: string;
  path: string;
  start_line: number;
  end_line: number;
};

/** The number of lines of a text: a final newline does not start another one. */
const countLines = (text: string) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

/**
 * Checks on GitHub that every citation points at real lines of a regular file at `commitSha` (decision 043 C). Each distinct file is read once, with the
 * reading of decision 026. Answers the line count of each file, or the first citation (in the order given) that cannot be accepted; the commit
 * being unknown to GitHub counts as such. Only a GitHub failure is thrown.
 */
export async function verifyCitations(
  github: ReturnType<typeof githubClient>,
  installationId: number,
  fullName: string,
  commitSha: string,
  citations: Citation[],
  // A reader already built for this repo, so that the folders read before are kept (decision 043 C).
  reader?: Awaited<ReturnType<ReturnType<typeof githubClient>["fileReader"]>>,
): Promise<{ lineCounts: Record<string, number> } | { refused: string }> {
  // A Map: a path such as `constructor` or `__proto__` is not a name of Object.prototype here.
  const counts = new Map<string, number>();
  if (citations.length === 0) return { lineCounts: {} };
  const { inspect } =
    reader ?? (await github.fileReader(installationId, fullName));
  for (const { where, path, start_line, end_line } of citations) {
    if (!counts.has(path)) {
      let found: Awaited<ReturnType<typeof inspect>>;
      try {
        found = await inspect(path, commitSha);
      } catch (error) {
        // The root of an unknown commit answers 404; anything else is GitHub failing.
        if ((error as { status?: number }).status !== 404) throw error;
        return { refused: `${where}: commit ${commitSha} not found on GitHub` };
      }
      if (!found)
        return { refused: `${where}: ${path} does not exist at this commit` };
      if (found.text === undefined)
        return {
          refused: `${where}: ${path} is not a readable file (a directory, a link, a submodule or a file too large)`,
        };
      counts.set(path, countLines(found.text));
    }
    const count = counts.get(path) as number;
    if (end_line > count)
      return {
        refused: `${where}: lines ${start_line} to ${end_line} are past the end of ${path}, which has ${count} lines`,
      };
  }
  return { lineCounts: Object.fromEntries(counts) };
}
