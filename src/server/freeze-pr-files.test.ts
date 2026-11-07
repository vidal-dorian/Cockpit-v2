import { afterEach, describe, expect, it, vi } from "vitest";
import { appFiles, asTakeover, seedAppFiles } from "./test-freeze.ts";
import { githubCalls } from "./test-github.ts";
import { pass, REPO } from "./test-issue-edit.ts";
import { followed, PR, pullRequestDelivery } from "./test-pr-follow.ts";

// Slice R4 (decision 050 C, E): following the PR of a takeover story reads its files and keeps the paths outside the tests.
// Shapes pinned in src/server/test-freeze.ts.

afterEach(() => {
  vi.unstubAllGlobals();
});

type S = Awaited<ReturnType<typeof followed>>;
const refresh = (s: S) =>
  s.app.request(`/api/stories/${s.id}/pr/refresh`, {
    method: "POST",
    headers: { cookie: s.alice.cookie },
  });
const fileCalls = (s: S) =>
  githubCalls(s.fetchMock).filter((c) => c.path.endsWith("/files"));

describe("decision 050 E: the app files of a takeover PR", () => {
  it("given a takeover story whose PR changes tests, a config file and app code, when the member refreshes, then pr_app_files holds the non-test paths in order and pr_app_files_count their number", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, [
      "src/a.ts",
      "src/a.test.ts",
      "tests/x.ts",
      "vitest.config.ts",
    ]);

    expect((await refresh(s)).status).toBe(200);

    expect(await appFiles(s.db, s.id)).toEqual({
      files: ["src/a.ts", "vitest.config.ts"],
      count: 2,
    });
  });

  it("given a takeover story whose PR changes tests only, when the member refreshes, then pr_app_files is an empty list (not null) and the count 0", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.test.ts"]);

    await refresh(s);

    expect(await appFiles(s.db, s.id)).toEqual({ files: [], count: 0 });
  });

  it("given a takeover story and a pull_request delivery, when it is processed, then the app files are read the same way", async () => {
    const s = await followed("in_progress");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.ts", "src/a.test.ts"]);
    await pullRequestDelivery(s.db);

    await pass(s.db);

    expect(await appFiles(s.db, s.id)).toEqual({
      files: ["src/a.ts"],
      count: 1,
    });
  });

  it("given a takeover PR of 250 files, 125 of them app code, when the member refreshes, then all three pages of 100 are read, 20 paths are kept and the count is 125", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    const all = Array.from({ length: 250 }, (_, i) =>
      i % 2 === 0 ? `src/f${i}.ts` : `tests/f${i}.ts`,
    );
    s.fetchMock.setPullFiles(REPO, PR, all);

    await refresh(s);

    const kept = await appFiles(s.db, s.id);
    expect(kept.count).toBe(125);
    expect(kept.files).toEqual(all.filter((_, i) => i % 2 === 0).slice(0, 20));
    const pages = fileCalls(s).map((c) =>
      new URLSearchParams(c.search).get("page"),
    );
    expect(pages).toEqual(["1", "2", "3"]);
  });

  it("given a takeover PR merged, when the member refreshes, then the story is done and keeps the app files it read", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.ts"]);
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: true });

    await refresh(s);

    expect(await appFiles(s.db, s.id)).toEqual({
      files: ["src/a.ts"],
      count: 1,
    });
  });

  it("given a takeover PR closed without merge, when the member refreshes, then pr_app_files and its count are null again", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    await seedAppFiles(s.db, s.id, ["src/a.ts"]);
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.ts"]);
    s.fetchMock.setPull(REPO, PR, { state: "closed", merged: false });

    await refresh(s);

    expect(await appFiles(s.db, s.id)).toEqual({ files: null, count: null });
  });

  it("given an earlier read that found app code, when a new push leaves only tests, then the list is replaced by an empty one", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    await seedAppFiles(s.db, s.id, ["src/old.ts"]);
    s.fetchMock.setPullFiles(REPO, PR, ["src/old.test.ts"]);

    await refresh(s);

    expect(await appFiles(s.db, s.id)).toEqual({ files: [], count: 0 });
  });

  it("given an ordinary story, when the member refreshes, then the files of the PR are never read and nothing is stored", async () => {
    const s = await followed("in_review");
    s.fetchMock.setPullFiles(REPO, PR, ["src/a.ts"]);

    expect((await refresh(s)).status).toBe(200);

    expect(fileCalls(s)).toEqual([]);
    expect(await appFiles(s.db, s.id)).toEqual({ files: null, count: null });
  });

  it("given a takeover story and GitHub failing on the files, when the member refreshes, then 502 and the earlier list is untouched", async () => {
    const s = await followed("in_review");
    await asTakeover(s.db, s.id);
    await seedAppFiles(s.db, s.id, ["src/old.ts"]);
    s.fetchMock.setPullFiles(REPO, PR, ["src/new.ts"]);
    s.fetchMock.update({ failOn: (c) => c.path.endsWith("/files") });

    expect((await refresh(s)).status).toBe(502);

    expect(await appFiles(s.db, s.id)).toEqual({
      files: ["src/old.ts"],
      count: 1,
    });
  });
});
