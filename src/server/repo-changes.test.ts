// Acceptance tests of slice E2, decision 030 E: `applyRepoChanges` of the GitHub client replaces, removes or adds files, each only if it is still exactly what the caller showed.
// Tested straight on the client against the fake GitHub that keeps a Git history (a removal is a tree entry with `sha: null`).
//
// Pinned where the decision leaves it open:
// - A success is `{ commitSha, changed: [path...] }` (changes in input order) plus `pullRequest: { number, url }` only when the branch was protected.
// - A refusal is RETURNED, `{ refused: "<code>" }`, as `applyRepoWrite` does.
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubClient } from "./github.ts";
import {
  type FakeGitRepoOptions,
  githubAppConfig,
  githubCalls,
  INSTALLATION_ID,
  stubGitHub,
} from "./test-github.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "octocat/app";
const DEV = ".claude/agents/developer.md";
const T =
  "---\nname: developer\ndescription: Builds\nmodel: sonnet\n---\nPrompt é ✓\n";
const T2 = T.replace("model: sonnet", "model: opus");
const MESSAGE = "feat: update the agent developer (Cockpit)";
const PROTECTED = {
  status: 403,
  message: "Protected branch update failed for refs/heads/trunk.",
};

function setup(repo: FakeGitRepoOptions = {}) {
  const fetchMock = stubGitHub({
    account: 1,
    gitRepos: {
      [REPO]: {
        defaultBranch: "trunk",
        files: { "README.md": "# app\n", [DEV]: T },
        ...repo,
      },
    },
  });
  const client = githubClient(githubAppConfig);
  return {
    fetchMock,
    git: fetchMock.git(REPO),
    apply: (
      changes: { path: string; before: string | null; after: string | null }[],
      message = MESSAGE,
    ) =>
      (
        client as unknown as {
          applyRepoChanges: (
            installationId: number,
            fullName: string,
            changes: unknown,
            message: string,
          ) => Promise<Record<string, unknown>>;
        }
      ).applyRepoChanges(INSTALLATION_ID, REPO, changes, message),
  };
}

const writeCalls = (fetchMock: ReturnType<typeof stubGitHub>) =>
  githubCalls(fetchMock).filter(
    (call) => call.method !== "GET" && call.path.startsWith("/repos/"),
  );
const nothingWritten = (
  fetchMock: ReturnType<typeof stubGitHub>,
  git: ReturnType<ReturnType<typeof stubGitHub>["git"]>,
) => {
  expect(writeCalls(fetchMock)).toEqual([]);
  expect(git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
  expect(git.refsCreated).toEqual([]);
  expect(git.pullRequests).toEqual([]);
};

describe("decision 030 E: applyRepoChanges", () => {
  it("given a file with text T, when it is called with { before: T, after: T2 }, then one commit on the default branch replaces it, the branch is advanced without force and the result is { commitSha, changed }", async () => {
    const { git, apply } = setup();
    const base = git.head;

    const result = await apply([{ path: DEV, before: T, after: T2 }]);

    expect(git.created.commits).toHaveLength(1);
    expect(git.created.commits[0]).toMatchObject({
      message: MESSAGE,
      parents: [base],
    });
    expect(result).toEqual({ commitSha: git.head, changed: [DEV] });
    expect(git.created.commits[0]?.sha).toBe(git.head);
    expect(git.filesAt(git.head)).toEqual({
      "README.md": "# app\n",
      [DEV]: T2,
    });
    expect(git.created.refUpdates).toEqual([
      { branch: "trunk", sha: git.head, force: false },
    ]);
  });

  it("given a file with text T, when it is called with { before: T, after: null }, then one commit removes the file with a tree entry whose sha is null", async () => {
    const { git, apply } = setup();

    const result = await apply([{ path: DEV, before: T, after: null }]);

    expect(result).toEqual({ commitSha: git.head, changed: [DEV] });
    expect(git.created.commits).toHaveLength(1);
    expect(git.created.trees).toHaveLength(1);
    expect(git.created.trees[0]?.entries).toMatchObject([
      { path: DEV, sha: null },
    ]);
    expect(git.filesAt(git.head)).toEqual({ "README.md": "# app\n" });
  });

  it("given an absent path, when it is called with { before: null, after: T }, then the file is added", async () => {
    const { git, apply } = setup();
    const path = ".claude/agents/doc-writer.md";

    const result = await apply([{ path, before: null, after: T }]);

    expect(result).toEqual({ commitSha: git.head, changed: [path] });
    expect(git.filesAt(git.head)).toEqual({
      "README.md": "# app\n",
      [DEV]: T,
      [path]: T,
    });
  });

  it.each([
    [
      "other text",
      { before: T, after: T2 },
      (git: ReturnType<typeof setup>["git"]) => git.push({ [DEV]: "theirs\n" }),
      {},
    ],
    [
      "absent when before is a text",
      { before: T, after: T2 },
      () => {},
      { files: { "README.md": "# app\n" } },
    ],
    ["present when before is null", { before: null, after: T2 }, () => {}, {}],
    [
      "a directory",
      { before: T, after: T2 },
      () => {},
      { files: { "README.md": "# app\n", [`${DEV}/inside.txt`]: "x\n" } },
    ],
    [
      "a symlink",
      { before: T, after: T2 },
      () => {},
      {
        files: { "README.md": "# app\n" },
        entries: { [DEV]: { kind: "symlink" as const } },
      },
    ],
  ])(
    "given the file at the head being %s, when it is called, then it returns { refused: repo_changed } and nothing is written",
    async (_name, change, mutate, repo: FakeGitRepoOptions) => {
      const { fetchMock, git, apply } = setup(repo);
      mutate(git);
      const pushed = git.head;
      const before = git.created.commits.length;

      const result = await apply([{ path: DEV, ...change }]);

      expect(result).toEqual({ refused: "repo_changed" });
      expect(git.head).toBe(pushed);
      expect(git.created.commits).toHaveLength(before);
      expect(writeCalls(fetchMock)).toEqual([]);
      expect(git.created.trees).toEqual([]);
      expect(git.created.refUpdates).toEqual([]);
    },
  );

  it("given two changes of which one is stale, when it is called, then nothing is written for either", async () => {
    const { fetchMock, git, apply } = setup();

    const result = await apply([
      { path: DEV, before: T, after: T2 },
      { path: "README.md", before: "other\n", after: "x\n" },
    ]);

    expect(result).toEqual({ refused: "repo_changed" });
    nothingWritten(fetchMock, git);
  });

  it("given a protected default branch, when it is called, then the commit goes to cockpit/<7>, a pull request is opened and the default branch is untouched", async () => {
    const { git, apply } = setup({ refUpdateFailure: PROTECTED });
    const base = git.head;

    const result = await apply([{ path: DEV, before: T, after: T2 }]);

    const sha = git.created.commits[0]?.sha as string;
    expect(result).toEqual({
      commitSha: sha,
      changed: [DEV],
      pullRequest: { number: 1, url: "https://github.com/octocat/app/pull/1" },
    });
    expect(git.head).toBe(base);
    expect(git.branch(`cockpit/${sha.slice(0, 7)}`)).toBe(sha);
    expect(git.pullRequests).toHaveLength(1);
    expect(git.pullRequests[0]).toMatchObject({
      head: `cockpit/${sha.slice(0, 7)}`,
      base: "trunk",
      title: MESSAGE,
    });
  });

  it.each([
    ["empty_repo", { empty: true }],
    ["repo_unreachable", { unreachable: true }],
  ])(
    "given a repo for which the write is refused with %s, when it is called, then it returns that refusal and nothing is written",
    async (code, repo) => {
      const { fetchMock, apply } = setup(repo);

      const result = await apply([{ path: DEV, before: T, after: T2 }]);

      expect(result).toEqual({ refused: code });
      expect(writeCalls(fetchMock)).toEqual([]);
    },
  );

  it("given a protected branch and an App without Pull requests: write, when it is called, then it is refused pull_request_forbidden", async () => {
    const { git, apply } = setup({
      refUpdateFailure: PROTECTED,
      pullRequestFailure: {
        status: 403,
        message: "Resource not accessible by integration",
      },
    });
    const base = git.head;

    const result = await apply([{ path: DEV, before: T, after: T2 }]);

    expect(result).toEqual({ refused: "pull_request_forbidden" });
    expect(git.head).toBe(base);
    expect(git.pullRequests).toEqual([]);
  });
});
