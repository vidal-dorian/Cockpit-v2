// Acceptance tests of slice 6.1, decision 026: write into a repo without overwriting anything.
// Tested straight on the GitHub client (no route, no screen, no history entry), against the fake GitHub that keeps a Git history (`gitRepos` of test-github.ts).
//
// What these tests pin, where the decision leaves it open:
// - A refusal (decision 026 C and E) is RETURNED, never thrown, like the other "not there" answers of the client (`null`, `{ unchanged: true }`):
//   `planRepoWrite` and `applyRepoWrite` return `{ refused: "<code>" }` with the code `empty_repo`, `repo_unreachable`, `repo_changed` or `branch_protected`.
//   A success has no `refused` key. The caller (6.2) turns it into a `Refused` of its own. An invalid plan (D) or any other GitHub error is a thrown error.
// - The plan is `{ baseSha, files }` (it may carry more); `files` keeps the order of the input, and each entry is
//   `{ path, content, status }` with `content` the proposed text and `status` `create`, `same` or `exists`; an `exists` entry also holds `current`, the text in the repo.
// - `applyRepoWrite` returns `{ commitSha, created }` and nothing else, `created` being the paths of the `create` entries in plan order.
// - Which endpoints are called is the one the decision names (B), as the fake serves them: the repo (default branch), `git/ref/heads/<branch>`, `git/commits/<sha>`, `git/trees/<commit sha>:<dir>` (the root is
//   `<commit sha>` or `<commit sha>:`), `contents/<path>?ref=<sha>` (regular files only), `git/trees`, `git/commits`, `git/refs/heads/<branch>`; any other call fails the test as "Unexpected fetch".
// - Anything at the path that is not a plain file (a directory, a symlink, a submodule, a file too large to read) or under a parent that is not a real directory is `exists` WITHOUT `current` (decision 026 A, B);
//   `applyRepoWrite` re-reads every `create` file at the head, even when the head did not move, with the same rules (C).
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
const SKILL = ".claude/skills/dev-us/SKILL.md";
const INITIAL = {
  "README.md": "# app\n",
  "same.txt": "Même contenu ✓\n",
  "mine.txt": "theirs\n",
};
const FILES = [
  { path: SKILL, content: "skill é ✓\n" },
  { path: "same.txt", content: INITIAL["same.txt"] },
  { path: "mine.txt", content: "ours\n" },
  { path: "docs/new.md", content: "# new\n" },
];
const CREATED = [SKILL, "docs/new.md"];
const MESSAGE = "feat: prepare the repo for Claude";

/** A repo whose default branch is `trunk` (never "main"), and the two calls under test. */
function setup(
  repo: FakeGitRepoOptions = {},
  more: Partial<Parameters<typeof stubGitHub>[0]> = {},
) {
  const fetchMock = stubGitHub({
    account: 1,
    gitRepos: {
      [REPO]: { defaultBranch: "trunk", files: INITIAL, ...repo },
    },
    ...more,
  });
  const client = githubClient(githubAppConfig);
  return {
    fetchMock,
    git: fetchMock.git(REPO),
    client,
    /** The plan of `files`, which must not be refused. */
    async plan(files: { path: string; content: string }[] = FILES) {
      const plan = await client.planRepoWrite(INSTALLATION_ID, REPO, files);
      if ("refused" in plan) throw new Error(`refused: ${plan.refused}`);
      return plan;
    },
    apply: (
      plan: Parameters<typeof client.applyRepoWrite>[2],
      message = MESSAGE,
    ) => client.applyRepoWrite(INSTALLATION_ID, REPO, plan, message),
  };
}

/** The calls that write into a repo (the installation token request is not one). */
const writeCalls = (fetchMock: ReturnType<typeof stubGitHub>) =>
  githubCalls(fetchMock).filter(
    (call) => call.method !== "GET" && call.path.startsWith("/repos/"),
  );

describe("planRepoWrite", () => {
  it("given a repo whose default branch is trunk and a mix of new, identical and different files, when it is planned, then each file is create, same or exists and the base is the head of trunk", async () => {
    const { fetchMock, git, plan } = setup();

    const result = await plan();

    expect(result).toMatchObject({
      baseSha: git.head,
      files: [
        { path: SKILL, content: FILES[0]?.content, status: "create" },
        { path: "same.txt", content: INITIAL["same.txt"], status: "same" },
        {
          path: "mine.txt",
          content: "ours\n",
          status: "exists",
          current: "theirs\n",
        },
        { path: "docs/new.md", content: "# new\n", status: "create" },
      ],
    });
    // Planning reads, never writes.
    expect(writeCalls(fetchMock)).toEqual([]);
    expect(git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
  });

  it("given a file that differs from the repo's only by its line ending, when it is planned, then it is exists (never same)", async () => {
    const { plan } = setup();

    const result = await plan([
      { path: "same.txt", content: "Même contenu ✓" },
    ]);

    expect(result.files).toMatchObject([
      { path: "same.txt", status: "exists", current: "Même contenu ✓\n" },
    ]);
  });
});

describe("applyRepoWrite", () => {
  it("given a plan with files to create, when it is applied, then ONE commit on the base adds exactly the create files, as UTF-8 blobs of mode 100644 on the base commit's tree", async () => {
    const { git, plan, apply } = setup();
    const planned = await plan();
    const base = git.head;
    const baseFiles = git.filesAt(base);

    await apply(planned);

    expect(git.created.commits).toHaveLength(1);
    expect(git.created.commits[0]).toMatchObject({
      message: MESSAGE,
      parents: [base],
    });
    expect(git.created.trees).toHaveLength(1);
    const [tree] = git.created.trees;
    expect(tree?.baseTree).toBe(git.commit(base)?.tree);
    expect(
      [...(tree?.entries ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1)),
    ).toEqual([
      {
        path: SKILL,
        mode: "100644",
        type: "blob",
        content: "skill é ✓\n",
      },
      { path: "docs/new.md", mode: "100644", type: "blob", content: "# new\n" },
    ]);
    // The new head is that commit; the same and exists files are exactly as they were.
    expect(git.created.commits[0]?.sha).toBe(git.head);
    expect(git.filesAt(git.head)).toEqual({
      ...baseFiles,
      [SKILL]: "skill é ✓\n",
      "docs/new.md": "# new\n",
    });
  });

  it("given a plan with files to create, when it is applied, then it returns { commitSha, created } and nothing else", async () => {
    const { git, plan, apply } = setup();

    const result = await apply(await plan());

    expect(result).toEqual({ commitSha: git.head, created: CREATED });
    expect(Object.keys(result).sort()).toEqual(["commitSha", "created"]);
    expect(git.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("given a plan with files to create, when it is applied, then the branch is advanced with force false, once", async () => {
    const { git, plan, apply } = setup();

    const result = await apply(await plan());

    expect(git.created.refUpdates).toEqual([
      {
        branch: "trunk",
        sha: "commitSha" in result ? result.commitSha : "",
        force: false,
      },
    ]);
  });

  it.each([
    ["only same files", [FILES[1]]],
    ["only same and exists files", [FILES[1], FILES[2]]],
  ])(
    "given a plan with %s, when it is applied, then nothing is written and created is empty",
    async (_name, files) => {
      const { fetchMock, git, plan, apply } = setup();
      const planned = await plan(files as typeof FILES);

      const result = await apply(planned);

      expect(result).toMatchObject({ created: [] });
      expect(writeCalls(fetchMock)).toEqual([]);
      expect(git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
    },
  );
});

describe("applyRepoWrite when the repo changed since the plan", () => {
  it("given an unrelated push after the plan and every create file still absent, when it is applied, then the commit is made on the new head and the unrelated change is kept", async () => {
    const { git, plan, apply } = setup();
    const planned = await plan();
    const pushed = git.push({ "other/unrelated.txt": "not ours\n" });

    const result = await apply(planned);

    expect(result).toEqual({ commitSha: git.head, created: CREATED });
    expect(git.created.commits).toHaveLength(1);
    expect(git.created.commits[0]?.parents).toEqual([pushed]);
    expect(git.created.trees[0]?.baseTree).toBe(git.commit(pushed)?.tree);
    expect(git.filesAt(git.head)).toEqual({
      ...INITIAL,
      "other/unrelated.txt": "not ours\n",
      [SKILL]: "skill é ✓\n",
      "docs/new.md": "# new\n",
    });
  });

  it("given a push after the plan that adds one of the create files, when it is applied, then it is refused repo_changed and nothing is written", async () => {
    const { fetchMock, git, plan, apply } = setup();
    const planned = await plan();
    const pushed = git.push({ "docs/new.md": "someone else's text\n" });

    const result = await apply(planned);

    expect(result).toEqual({ refused: "repo_changed" });
    expect(writeCalls(fetchMock)).toEqual([]);
    expect(git.head).toBe(pushed);
    expect(git.filesAt(git.head)).toEqual({
      ...INITIAL,
      "docs/new.md": "someone else's text\n",
    });
  });

  it("given a push after the plan that changes the same and exists files, when it is applied, then they are neither re-read nor written and the commit is made", async () => {
    const { fetchMock, git, plan, apply } = setup();
    const planned = await plan();
    git.push({ "same.txt": "changed\n", "mine.txt": "changed too\n" });
    const callsBefore = githubCalls(fetchMock).length;

    const result = await apply(planned);

    expect(result).toEqual({ commitSha: git.head, created: CREATED });
    // Decision 026 C: the create files are read again (their directories, now), the same and exists files never.
    const reread = githubCalls(fetchMock)
      .slice(callsBefore)
      .filter((call) => /\/(contents|git\/trees)\//.test(call.path))
      .map((call) => decodeURIComponent(call.path));
    expect(reread.length).toBeGreaterThan(0);
    for (const path of ["same.txt", "mine.txt"])
      expect(reread.some((read) => read.includes(path))).toBe(false);
    expect(git.filesAt(git.head)).toMatchObject({
      "same.txt": "changed\n",
      "mine.txt": "changed too\n",
      "docs/new.md": "# new\n",
    });
  });

  it.each([
    ["the branch did not move before", false],
    ["the branch had already moved before", true],
  ])(
    "given a push landing between the re-read and the update of the branch (%s), when it is applied, then it is refused repo_changed after ONE attempt, with no retry",
    async (_name, moved) => {
      const { fetchMock, git, plan, apply } = setup();
      const planned = await plan();
      if (moved) git.push({ "other/unrelated.txt": "not ours\n" });
      let late = "";
      git.beforeRefUpdate(() => {
        late = git.push({ "late.txt": "too late\n" });
      });

      const result = await apply(planned);

      expect(result).toEqual({ refused: "repo_changed" });
      expect(git.created.refUpdates).toHaveLength(1);
      expect(git.created.commits).toHaveLength(1);
      expect(
        writeCalls(fetchMock).filter((call) => call.method === "PATCH"),
      ).toHaveLength(1);
      // The late push is the head; none of our files was written.
      expect(git.head).toBe(late);
      expect(git.filesAt(git.head)).not.toHaveProperty(SKILL);
      expect(git.filesAt(git.head)).not.toHaveProperty("docs/new.md");
    },
  );
});

describe("planRepoWrite with an invalid plan", () => {
  const long = (length: number) => "a".repeat(length);
  const small = (path: string) => ({ path, content: "x" });
  it.each([
    ["an absolute path", [small("/etc/passwd")]],
    ["an empty path", [small("")]],
    ["an empty segment", [small("a//b")]],
    ["a trailing slash", [small("a/")]],
    ["the segment .", [small(".")]],
    ["a dot segment inside", [small("a/./b")]],
    ["the segment ..", [small("..")]],
    ["a .. segment inside", [small("a/../b")]],
    ["a path under .git", [small(".git/config")]],
    ["a nested .git segment", [small("x/.git/y")]],
    ["an upper case .GIT segment", [small(".GIT/x")]],
    ["a mixed case nested .Git segment", [small("x/.Git/y")]],
    ["a NUL character", [small("a\u0000b")]],
    ["a newline in the path", [small("a\nb")]],
    ["a DEL character", [small("a\u007fb")]],
    ["a path of 256 characters", [small(long(256))]],
    [
      "51 files",
      Array.from({ length: 51 }, (_, i) => small(`dir/file-${i}.txt`)),
    ],
    ["one file over 1 MiB", [{ path: "big.txt", content: long(1_048_577) }]],
    [
      "two files over 1 MiB together",
      [
        { path: "a.txt", content: long(600_000) },
        { path: "b.txt", content: long(600_000) },
      ],
    ],
    [
      "a content over 1 MiB in UTF-8 bytes (but fewer characters)",
      [{ path: "bytes.txt", content: "é".repeat(524_289) }],
    ],
    ["a path given twice", [small("a.txt"), small("a.txt")]],
    [
      "a path given twice with two contents",
      [small("a.txt"), { path: "a.txt", content: "y" }],
    ],
  ])(
    "given %s, when it is planned, then it throws (a programming error, not a refusal)",
    async (_name, files) => {
      const { client } = setup();

      await expect(
        client.planRepoWrite(INSTALLATION_ID, REPO, files),
      ).rejects.toThrow();
    },
  );

  it.each([
    ["a nested dot directory", SKILL],
    ["a name starting with .git", ".gitignore"],
    ["a name ending with .git", "x.git"],
    ["the .github directory", ".github/workflows/ci.yml"],
    ["a name with spaces and accents", "docs/Guide d'été.md"],
    ["a path of 255 characters", "a".repeat(255)],
  ])(
    "given a valid path (%s), when it is planned, then it is planned as create",
    async (_name, path) => {
      const { plan } = setup();

      const result = await plan([{ path, content: "x" }]);

      expect(result.files).toMatchObject([{ path, status: "create" }]);
    },
  );

  it.each([
    [
      "50 files",
      Array.from({ length: 50 }, (_, i) => ({
        path: `dir/file-${i}.txt`,
        content: "x",
      })),
    ],
    ["exactly 1 MiB", [{ path: "big.txt", content: "a".repeat(1_048_576) }]],
  ])(
    "given %s, when it is planned, then it is accepted",
    async (_name, files) => {
      const { plan } = setup();

      const result = await plan(files);

      expect(result.files).toHaveLength(files.length);
    },
  );
});

describe("refusals", () => {
  it("given a repo without any commit, when it is planned, then it is refused empty_repo", async () => {
    const { fetchMock, client } = setup({ empty: true });

    const result = await client.planRepoWrite(INSTALLATION_ID, REPO, FILES);

    expect(result).toEqual({ refused: "empty_repo" });
    expect(writeCalls(fetchMock)).toEqual([]);
  });

  it("given a repo the App can no longer reach, when it is planned, then it is refused repo_unreachable", async () => {
    const { fetchMock, client } = setup({ unreachable: true });

    const result = await client.planRepoWrite(INSTALLATION_ID, REPO, FILES);

    expect(result).toEqual({ refused: "repo_unreachable" });
    expect(writeCalls(fetchMock)).toEqual([]);
  });

  it("given a repo the App lost access to after the plan, when it is applied, then it is refused repo_unreachable and nothing is written", async () => {
    const { fetchMock, git, plan, apply } = setup();
    const planned = await plan();
    git.unreachable = true;

    const result = await apply(planned);

    expect(result).toEqual({ refused: "repo_unreachable" });
    expect(writeCalls(fetchMock)).toEqual([]);
  });

  it.each([
    [403, "Protected branch update failed for refs/heads/trunk."],
    [
      403,
      "Repository rule violations found\n\nChanges must be made through a pull request.\n\n",
    ],
    [
      422,
      "Repository rule violations found\n\nChanges must be made through a pull request.\n\n",
    ],
    [
      422,
      "Protected branch update failed for refs/heads/trunk: changes must be made through a pull request.",
    ],
  ])(
    "given a default branch that refuses direct pushes (%s), when it is applied, then it is refused branch_protected and the branch is untouched",
    async (status, message) => {
      const { git, plan, apply } = setup({
        refUpdateFailure: { status, message },
      });
      const planned = await plan();
      const base = git.head;

      const result = await apply(planned);

      expect(result).toEqual({ refused: "branch_protected" });
      expect(git.created.refUpdates).toHaveLength(1);
      expect(git.head).toBe(base);
    },
  );

  it("given a 403 on the update of the branch that does not speak of protection, when it is applied, then the GitHub error propagates", async () => {
    const { git, plan, apply } = setup({
      refUpdateFailure: {
        status: 403,
        message: "Resource not accessible by integration",
      },
    });
    const planned = await plan();

    await expect(apply(planned)).rejects.toMatchObject({ status: 403 });
    expect(git.created.refUpdates).toHaveLength(1);
  });

  it.each([
    ["the repo", "GET", /^\/repos\/octocat\/app$/],
    ["the branch", "GET", /\/git\/ref\//],
    ["a file", "GET", /\/contents\//],
  ])(
    "given GitHub failing with 500 on the read of %s, when it is planned, then the error propagates",
    async (_name, method, path) => {
      const { fetchMock, client } = setup();
      fetchMock.update({
        failOn: (call) => call.method === method && path.test(call.path),
      });

      await expect(
        client.planRepoWrite(INSTALLATION_ID, REPO, FILES),
      ).rejects.toMatchObject({ status: 500 });
    },
  );

  it.each([
    ["the tree", "POST", /\/git\/trees$/],
    ["the commit", "POST", /\/git\/commits$/],
    ["the update of the branch", "PATCH", /\/git\/refs\//],
  ])(
    "given GitHub failing with 500 on %s, when it is applied, then the error propagates and the branch is untouched",
    async (_name, method, path) => {
      const { fetchMock, git, plan, apply } = setup();
      const planned = await plan();
      const base = git.head;
      fetchMock.update({
        failOn: (call) => call.method === method && path.test(call.path),
      });

      await expect(apply(planned)).rejects.toMatchObject({ status: 500 });
      expect(git.head).toBe(base);
    },
  );
});

/** An entry of the repo that is not a plain file, or a plain file, at `path` (a directory is a file under it). */
const NOT_A_FILE: [string, FakeGitRepoOptions][] = [
  ["a directory", { files: { "target/inner.md": "x\n" } }],
  ["a symlink", { entries: { target: { kind: "symlink" } } }],
  ["a submodule", { entries: { target: { kind: "submodule" } } }],
  ["a file too large to read", { entries: { target: { kind: "large" } } }],
];
const AGENT = ".claude/agents/developer.md";
/** A repo where a parent of `AGENT` is not a real directory. */
const BAD_PARENT: [string, FakeGitRepoOptions][] = [
  [
    "a submodule as the first parent",
    { entries: { ".claude": { kind: "submodule" } } },
  ],
  [
    "a symlink as the first parent",
    { entries: { ".claude": { kind: "symlink" } } },
  ],
  [
    "a regular file as the first parent",
    { files: { ".claude": "not a dir\n" } },
  ],
  [
    "a symlink as a deeper parent under a real directory",
    {
      files: { ".claude/settings.json": "{}\n" },
      entries: { ".claude/agents": { kind: "symlink" } },
    },
  ],
  [
    "a submodule as a deeper parent under a real directory",
    {
      files: { ".claude/settings.json": "{}\n" },
      entries: { ".claude/agents": { kind: "submodule" } },
    },
  ],
];

/** What a plan says of one path: `exists`, and no `current` key at all. */
function expectExistsWithoutCurrent(file: { status: string } | undefined) {
  expect(file).toMatchObject({ status: "exists" });
  expect(Object.keys(file ?? {})).not.toContain("current");
}

describe("planRepoWrite on entries that are not plain files (decision 026 A, B)", () => {
  it.each(NOT_A_FILE)(
    "given %s at the path, when it is planned, then it is exists without current",
    async (_name, repo) => {
      const { plan } = setup({ files: INITIAL, ...repo });

      const result = await plan([{ path: "target", content: "ours\n" }]);

      expectExistsWithoutCurrent(result.files[0]);
    },
  );

  it.each(NOT_A_FILE)(
    "given %s at the path whose text equals the proposed one, when it is planned, then it is still exists, never same",
    async (_name, repo) => {
      const { plan } = setup({ files: INITIAL, ...repo });

      const result = await plan([{ path: "target", content: "" }]);

      expectExistsWithoutCurrent(result.files[0]);
    },
  );

  it.each(BAD_PARENT)(
    "given %s, when a file under it is planned, then it is exists without current",
    async (_name, repo) => {
      const { plan } = setup({ ...repo, files: { ...INITIAL, ...repo.files } });

      const result = await plan([{ path: AGENT, content: "agent\n" }]);

      expectExistsWithoutCurrent(result.files[0]);
    },
  );

  it("given a bad parent for one file and a good place for another, when they are planned, then only the first is exists", async () => {
    const { plan } = setup({ entries: { ".claude": { kind: "symlink" } } });

    const result = await plan([
      { path: AGENT, content: "agent\n" },
      { path: "docs/new.md", content: "# new\n" },
    ]);

    expect(result.files).toMatchObject([
      { path: AGENT, status: "exists" },
      { path: "docs/new.md", status: "create" },
    ]);
  });

  it("given a missing parent whose nearest existing ancestor is a real directory, when a file under it is planned, then it is create", async () => {
    const { plan } = setup({
      files: { ...INITIAL, ".claude/settings.json": "{}\n" },
    });

    const result = await plan([{ path: AGENT, content: "agent\n" }]);

    expect(result.files).toMatchObject([{ path: AGENT, status: "create" }]);
  });

  it("given a parent chain missing up to the root, when a file under it is planned, then it is create", async () => {
    const { plan } = setup();

    const result = await plan([{ path: "a/b/c/d.md", content: "d\n" }]);

    expect(result.files).toMatchObject([
      { path: "a/b/c/d.md", status: "create" },
    ]);
  });

  it("given an executable file (mode 100755), when it is planned with the same or another text, then it is a plain file: same, or exists with its current text", async () => {
    const { plan } = setup({
      entries: { "run.sh": { kind: "executable", content: "#!/bin/sh\n" } },
    });

    const result = await plan([
      { path: "run.sh", content: "#!/bin/sh\n" },
      { path: "run.sh.bak", content: "x" },
    ]);
    const other = await plan([{ path: "run.sh", content: "echo\n" }]);

    expect(result.files).toMatchObject([
      { path: "run.sh", status: "same" },
      { path: "run.sh.bak", status: "create" },
    ]);
    expect(other.files).toMatchObject([
      { path: "run.sh", status: "exists", current: "#!/bin/sh\n" },
    ]);
  });
});

describe("applyRepoWrite re-reads every create file, even when the head did not move (decision 026 C)", () => {
  /** A plan whose `files` are all sent back as `create`, as a caller that relabelled them would. */
  const relabelled = (
    base: string,
    files: { path: string; content: string }[],
  ) => ({
    baseSha: base,
    files: files.map((file) => ({ ...file, status: "create" as const })),
  });

  const cases: [string, string, FakeGitRepoOptions][] = [
    ...NOT_A_FILE.map(([name, repo]): [string, string, FakeGitRepoOptions] => [
      name,
      "target",
      repo,
    ]),
    ...BAD_PARENT.map(([name, repo]): [string, string, FakeGitRepoOptions] => [
      name,
      AGENT,
      repo,
    ]),
    ["a different regular file", "mine.txt", {}],
    ["an identical regular file", "same.txt", {}],
  ];
  it.each(cases)(
    "given %s relabelled create by a caller, when it is applied on an unmoved head, then it is refused repo_changed and nothing is written",
    async (_name, path, repo) => {
      const { fetchMock, git, apply } = setup({
        ...repo,
        files: { ...INITIAL, ...repo.files },
      });
      const base = git.head;

      const result = await apply(
        relabelled(base, [
          { path, content: "ours\n" },
          { path: "docs/new.md", content: "# new\n" },
        ]),
      );

      expect(result).toEqual({ refused: "repo_changed" });
      expect(writeCalls(fetchMock)).toEqual([]);
      expect(git.created).toEqual({ trees: [], commits: [], refUpdates: [] });
      expect(git.head).toBe(base);
    },
  );

  it.each(NOT_A_FILE)(
    "given %s relabelled create by a caller, when it is applied after an unrelated push, then it is refused repo_changed and nothing is written",
    async (_name, repo) => {
      const { fetchMock, git, apply } = setup({
        files: { ...INITIAL, ...repo.files },
        entries: repo.entries,
      });
      const base = git.head;
      git.push({ "other/unrelated.txt": "not ours\n" });

      const result = await apply(
        relabelled(base, [{ path: "target", content: "ours\n" }]),
      );

      expect(result).toEqual({ refused: "repo_changed" });
      expect(writeCalls(fetchMock)).toEqual([]);
    },
  );

  it.each([
    ["a symlink", { kind: "symlink" }],
    ["a submodule", { kind: "submodule" }],
  ] as const)(
    "given a push after the plan that makes a parent of a create file %s, when it is applied, then it is refused repo_changed and nothing is written",
    async (_name, entry) => {
      const { fetchMock, git, plan, apply } = setup();
      const planned = await plan([{ path: AGENT, content: "agent\n" }]);
      expect(planned.files[0]?.status).toBe("create");
      const pushed = git.push({}, "swap the parent", { ".claude": entry });

      const result = await apply(planned);

      expect(result).toEqual({ refused: "repo_changed" });
      expect(writeCalls(fetchMock)).toEqual([]);
      expect(git.head).toBe(pushed);
    },
  );

  it("given create files whose parents are missing or real directories, when it is applied on an unmoved head, then the commit is made", async () => {
    const { git, apply } = setup({
      files: { ...INITIAL, ".claude/settings.json": "{}\n" },
    });
    const base = git.head;

    const result = await apply(
      relabelled(base, [
        { path: AGENT, content: "agent\n" },
        { path: "a/b/c.md", content: "c\n" },
      ]),
    );

    expect(result).toEqual({
      commitSha: git.head,
      created: [AGENT, "a/b/c.md"],
    });
    expect(git.commit(git.head)?.parents).toEqual([base]);
  });
});
