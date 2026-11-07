import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isTestPath } from "./pr-files.ts";
import { BRANCH, link, REPO, running, storyRow } from "./test-criteria.ts";
import { appFiles, asTakeover, seedAppFiles } from "./test-freeze.ts";
import { dataOf } from "./test-mcp.ts";
import { followed, PR } from "./test-pr-follow.ts";

// Slice R4 review fixes (decision 050 D, E): renames, snapshots, relinking, closed PRs.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision 050 D: snapshots and renames", () => {
  it.each([
    "src/__snapshots__/a.test.ts.snap",
    "src/a.test.ts.snap",
    "snapshots/a.snap",
  ])("given the snapshot path %s, then it is a test", (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it("given a PR renaming src/legacy.ts to tests/legacy.ts, when the member refreshes, then src/legacy.ts is among the app files", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, [
      { filename: "tests/legacy.ts", previous_filename: "src/legacy.ts" },
    ]);

    await s.app.request(`/api/stories/${s.id}/pr/refresh`, {
      method: "POST",
      headers: { cookie: s.alice.cookie },
    });

    expect(await appFiles(s.db, s.id)).toEqual({
      files: ["src/legacy.ts"],
      count: 1,
    });
  });
});

describe("decision 050 E: stale and unread files", () => {
  it("given a takeover story with app files, when another PR is linked, then the app files are cleared", async () => {
    const s = await running();
    s.fetchMock.addPull(REPO, PR, BRANCH);
    await asTakeover(s.db, s.id);
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));
    await seedAppFiles(s.db, s.id, ["src/a.ts"]);
    await s.db.execute(
      sql`update user_stories set status = 'in_progress' where id = ${s.id}`,
    );
    s.fetchMock.addPull(REPO, 13, BRANCH);

    dataOf(await link(s, { run_id: s.runId, pr_number: 13 }));

    expect((await storyRow(s.db, s.id))?.pr_number).toBe(13);
    expect(await appFiles(s.db, s.id)).toEqual({ files: null, count: null });
  });

  it("given a takeover PR closed without merge, when the member refreshes, then its files are not read", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.ts"]);
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });

    await s.app.request(`/api/stories/${s.id}/pr/refresh`, {
      method: "POST",
      headers: { cookie: s.alice.cookie },
    });

    const { githubCalls } = await import("./test-github.ts");
    expect(
      githubCalls(s.fetchMock).filter((c) => c.path.endsWith("/files")),
    ).toEqual([]);
  });
});
