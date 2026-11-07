import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCitations } from "./citations.ts";
import { githubClient } from "./github.ts";
import {
  githubAppConfig,
  githubCalls,
  INSTALLATION_ID,
  stubGitHub,
} from "./test-github.ts";

// Slice R1 (decision 043 C): `verifyCitations` of src/server/citations.ts, tested straight on the GitHub client against the fake GitHub
// that keeps a Git history (like repo-write.test.ts). R2 and R5 reuse it.
//
// Pinned where the decision leaves it open (the developer follows these):
// - `verifyCitations(github, installationId, fullName, commitSha, citations)`: `github` is a `githubClient(config)`, `citations` is a list of
//   `{ where, path, start_line, end_line }` where `where` is the location a refusal names (`modules[1].objects[3].citation`).
// - It RETURNS (never throws, for a refusal): `{ lineCounts }` (the number of lines of each distinct file, by path) or `{ refused }`, a text that
//   contains the `where` of the FIRST citation, in the order given, that cannot be accepted. A GitHub failure other than "not there" is a thrown error.
// - A line count is the number of lines of the text: "a\nb\n" and "a\nb" both have 2 lines.
// - Each distinct file is read once (one Contents call, `ref` the commit), whatever the number of citations of it; each directory tree at most once;
//   no citation, no GitHub call.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "octocat/app";
const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `l${i + 1}\n`).join("");
const FILES = {
  "a.ts": lines(30),
  "src/b.ts": lines(10),
  "src/c.ts": lines(4),
  "src/deep/d.ts": "x\ny",
};
const at = (where: string, path: string, start_line = 1, end_line = 1) => ({
  where,
  path,
  start_line,
  end_line,
});

function setup() {
  const fetchMock = stubGitHub({
    account: 1,
    gitRepos: { [REPO]: { files: FILES } },
  });
  const sha = fetchMock.git(REPO).head;
  const verify = (citations: ReturnType<typeof at>[], commit = sha) =>
    verifyCitations(
      githubClient(githubAppConfig),
      INSTALLATION_ID,
      REPO,
      commit,
      citations,
    );
  const calls = () =>
    githubCalls(fetchMock).map((c) => ({
      ...c,
      path: decodeURIComponent(c.path),
    }));
  return { fetchMock, sha, verify, calls };
}

describe("decision 043 C: the line counts", () => {
  it("given citations of four files, one of them with a final newline missing, when they are verified, then the result is the line count of each distinct file", async () => {
    const { verify } = setup();

    const result = await verify([
      at("c[0]", "a.ts", 1, 30),
      at("c[1]", "src/b.ts", 2, 3),
      at("c[2]", "src/c.ts", 4, 4),
      at("c[3]", "src/deep/d.ts", 1, 2),
    ]);

    expect(result).toEqual({
      lineCounts: {
        "a.ts": 30,
        "src/b.ts": 10,
        "src/c.ts": 4,
        "src/deep/d.ts": 2,
      },
    });
  });

  it("given no citation, when they are verified, then the line counts are empty and GitHub is not called", async () => {
    const { verify, calls } = setup();

    expect(await verify([])).toEqual({ lineCounts: {} });
    expect(calls()).toEqual([]);
  });
});

describe("decision 043 C: each distinct file is read once", () => {
  it("given five citations of two files, when they are verified, then each file is read once by the Contents API at the cited commit", async () => {
    const { verify, calls, sha } = setup();

    await verify([
      at("c[0]", "src/b.ts", 1, 2),
      at("c[1]", "a.ts", 1, 1),
      at("c[2]", "src/b.ts", 3, 4),
      at("c[3]", "a.ts", 5, 9),
      at("c[4]", "src/b.ts", 9, 10),
    ]);

    const reads = calls().filter((c) => c.path.includes("/contents/"));
    expect(reads.map((c) => c.path.split("/contents/")[1]).sort()).toEqual([
      "a.ts",
      "src/b.ts",
    ]);
    expect(reads.every((c) => c.search === `?ref=${sha}`)).toBe(true);
  });

  it("given three files of the same directory, when they are verified, then each directory tree is read at most once", async () => {
    const { verify, calls } = setup();

    await verify([
      at("c[0]", "src/b.ts"),
      at("c[1]", "src/c.ts"),
      at("c[2]", "src/deep/d.ts"),
      at("c[3]", "a.ts"),
    ]);

    const trees = calls()
      .filter((c) => c.path.includes("/git/trees/"))
      .map((c) => c.path);
    expect(new Set(trees).size).toBe(trees.length);
    expect(trees.length).toBeGreaterThan(0);
  });

  it("given a refused citation first, when they are verified, then the refusal is returned without reading the files that come after it", async () => {
    const { verify, calls } = setup();

    const result = await verify([
      at("c[0]", "src/missing.ts"),
      at("c[1]", "a.ts"),
    ]);

    expect(result).toMatchObject({ refused: expect.stringContaining("c[0]") });
    expect(
      calls().filter((c) => c.path.endsWith("/contents/a.ts")),
    ).toHaveLength(0);
  });
});

describe("decision 043 C: the first refusal", () => {
  it.each([
    ["a file absent at that commit", at("c[1]", "src/missing.ts")],
    ["a directory", at("c[1]", "src")],
    ["a path under a file", at("c[1]", "a.ts/inside.ts")],
    ["lines past the end of the file", at("c[1]", "src/b.ts", 9, 11)],
    ["a start_line past the end of the file", at("c[1]", "src/c.ts", 5, 5)],
  ])(
    "given %s after a good citation, when they are verified, then { refused } names c[1] and is returned, not thrown",
    async (_name, bad) => {
      const { verify } = setup();

      const result = await verify([at("c[0]", "a.ts", 1, 30), bad]);

      expect(result).toMatchObject({
        refused: expect.stringContaining("c[1]"),
      });
      expect(result).not.toHaveProperty("lineCounts");
    },
  );

  it("given two bad citations, when they are verified, then only the first one in the order given is named", async () => {
    const { verify } = setup();

    const result = (await verify([
      at("c[0]", "a.ts"),
      at("c[1]", "src/b.ts", 11, 11),
      at("c[2]", "nowhere.ts"),
    ])) as { refused: string };

    expect(result.refused).toContain("c[1]");
    expect(result.refused).not.toContain("c[2]");
  });

  it("given a commit that GitHub does not know, when a citation is verified, then { refused } names the citation", async () => {
    const { verify } = setup();

    const result = await verify([at("c[0]", "a.ts")], "f".repeat(40));

    expect(result).toMatchObject({ refused: expect.stringContaining("c[0]") });
  });

  it("given a file of 30 lines, when line 30 is cited, then it is accepted, and line 31 is refused", async () => {
    const { verify } = setup();

    expect(await verify([at("c[0]", "a.ts", 30, 30)])).toEqual({
      lineCounts: { "a.ts": 30 },
    });
    expect(await verify([at("c[0]", "a.ts", 30, 31)])).toMatchObject({
      refused: expect.stringContaining("c[0]"),
    });
  });

  it("given GitHub failing with a 500, when a citation is verified, then the error is thrown (it is not a refusal)", async () => {
    const { verify, fetchMock } = setup();
    fetchMock.update({ failOn: (c) => c.path.includes("/git/trees/") });

    await expect(verify([at("c[0]", "a.ts")])).rejects.toBeInstanceOf(Error);
  });
});

describe("decision 043 C: names of Object.prototype are paths like any other", () => {
  it.each(["constructor", "toString", "__proto__"])(
    "given a citation of %s on a repo without such a file, when it is verified, then it is refused",
    async (path) => {
      const { verify } = setup();

      const result = await verify([at("c[0]", path)]);

      expect(result).toEqual({
        refused: expect.stringContaining("c[0]"),
      });
    },
  );
});
