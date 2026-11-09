import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeGitRepoOptions, githubCalls } from "./test-github.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  historyText,
  listedTools,
  mcpRows,
  type Row,
  rows,
  rpc,
  userWithToken,
  withProject,
} from "./test-mcp.ts";

// Slice 12.4 (decision 067 E and F): Claude proposes a change of a workflow, the human commits or ignores it.
//
// Contract assumed where the decision leaves it open:
// - MCP tool `propose_workflow_change`, input { project_id: number, path: string, content: string, reason: string } (all four required, English description). It answers
//   the JSON { proposal_id: number, replaced: boolean } (`replaced` is true when it took the place of a pending proposal on the same path). A refusal is a tool result with
//   isError and a text "Refused: ...", journaled with detail { reason }: `invalid_arguments` (path not `.github/workflows/<name>.yml|.yaml` with <name> in a-z, 0-9, `-` and not
//   starting with `-`; content over 1 MiB = 1,048,576 characters; reason over 2,000 characters), `no_change` (content equal to the file), `not_found` (not a member),
//   `project_archived`. A call that fits is journaled propose_workflow_change, claude / mcp, args { path }, never the content or the reason. Nothing is ever written to GitHub.
//   The server accepts a body of 1 MiB of content on this tool (the 256 KiB of the other calls is not enough for it).
// - GET /api/projects/:id/workflows (workflows.test.ts) also gives `proposal`: null, or the OLDEST pending one { id, path, reason, before, content, createdAt } (`before` null for a new file).
// - POST /api/workflow-proposals/:id/commit answers 200 { commitSha, pullRequest? } like claude-config/apply; POST /api/workflow-proposals/:id/ignore answers 200.
//   Refusals are 409 { error } (`repo_changed`, `already_decided`, `workflows_forbidden`) and 404 for a proposal of a project the user is not a member of.
//   Entries: commit_workflow_change (github_effects { commitSha, pullRequest }) and ignore_workflow_change, human / ui, args { path }; a refusal of a commit is one refused entry with detail { reason }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const CI = ".github/workflows/ci.yml";
const BEFORE = "name: CI\non: push\njobs: {}\n";
const AFTER = "name: CI\non: [push, pull_request]\njobs: {}\n";
const NEW_PATH = ".github/workflows/deploy.yml";

type Ctx = Awaited<ReturnType<typeof ready>>;

async function ready(repo: FakeGitRepoOptions = {}) {
  const ctx = await withProject({
    gitRepos: {
      [REPO]: { files: { "README.md": "# app\n", [CI]: BEFORE }, ...repo },
    },
  });
  return { ...ctx, git: ctx.fetchMock.git(REPO) };
}

const propose = (ctx: Ctx, over: Record<string, unknown> = {}) =>
  callTool(ctx.app, ctx.alice.secret, "propose_workflow_change", {
    project_id: ctx.projectId,
    path: CI,
    content: AFTER,
    reason: "Run the tests on pull requests too.",
    ...over,
  });
/** A proposal that was accepted, its id. */
async function proposed(ctx: Ctx, over: Record<string, unknown> = {}) {
  return dataOf<{ proposal_id: number }>(await propose(ctx, over)).proposal_id;
}
const call = (
  ctx: Pick<Ctx, "app">,
  cookie: string,
  path: string,
  method: "GET" | "POST",
) =>
  ctx.app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
  });
const pending = async (ctx: Ctx) =>
  (
    (await (
      await call(
        ctx,
        ctx.alice.cookie,
        `/api/projects/${ctx.projectId}/workflows`,
        "GET",
      )
    ).json()) as { proposal: Record<string, unknown> | null }
  ).proposal;
const decide = (
  ctx: Ctx,
  id: number,
  what: "commit" | "ignore",
  cookie = ctx.alice.cookie,
) => call(ctx, cookie, `/api/workflow-proposals/${id}/${what}`, "POST");
const writes = (ctx: Ctx) =>
  githubCalls(ctx.fetchMock).filter(
    (c) => c.path.startsWith("/repos/") && c.method !== "GET",
  );
const entries = (ctx: Ctx, action: string) =>
  rows(ctx.db, sql`action = ${action}`) as Promise<
    (Row & { github_effects: unknown })[]
  >;

describe("decision 067 E: the tool propose_workflow_change", () => {
  it("given the tool list, when Claude lists the tools, then propose_workflow_change takes project_id, path, content and reason, all required", async () => {
    const ctx = await ready();

    const tool = (await listedTools(ctx.app, ctx.alice.secret)).find(
      (t) => t.name === "propose_workflow_change",
    );

    expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([
      "content",
      "path",
      "project_id",
      "reason",
    ]);
    expect(tool?.inputSchema?.required?.slice().sort()).toEqual([
      "content",
      "path",
      "project_id",
      "reason",
    ]);
  });

  it("given a workflow of the repo, when a member's Claude proposes a change, then the proposal keeps the text read on GitHub as before, nothing is written to GitHub and the entry holds only the path", async () => {
    const ctx = await ready();

    const data = dataOf<{ proposal_id: number; replaced: boolean }>(
      await propose(ctx),
    );

    expect(data.replaced).toBe(false);
    expect(await pending(ctx)).toEqual({
      id: data.proposal_id,
      path: CI,
      reason: "Run the tests on pull requests too.",
      before: BEFORE,
      content: AFTER,
      createdAt: expect.any(String),
    });
    expect(writes(ctx)).toEqual([]);
    expect(ctx.git.created.commits).toEqual([]);
    expect(await mcpRows(ctx.db)).toMatchObject([
      {
        user_id: ctx.alice.id,
        token_id: ctx.alice.tokenId,
        project_id: ctx.projectId,
        actor: "claude",
        origin: "mcp",
        action: "propose_workflow_change",
        args: { path: CI },
        result: "ok",
      },
    ]);
    const text = await historyText(ctx.db);
    expect(text).not.toContain("pull_request");
    expect(text).not.toContain("Run the tests");
  });

  it.each([NEW_PATH, ".github/workflows/release-please.yaml"])(
    "given the new file %s, when Claude proposes it, then before is null",
    async (path) => {
      const ctx = await ready();

      await proposed(ctx, { path });

      expect(await pending(ctx)).toMatchObject({ path, before: null });
    },
  );

  it.each([
    ["a name with an upper case letter", ".github/workflows/Bad.yml"],
    ["a dot in the name", ".github/workflows/a.b.yml"],
    ["a name starting with a dash", ".github/workflows/-x.yml"],
    ["an empty name", ".github/workflows/.yml"],
    ["a sub directory", ".github/workflows/sub/x.yml"],
    ["a climbing path", ".github/workflows/../x.yml"],
    ["another extension", ".github/workflows/x.txt"],
    ["another directory", ".github/actions/x.yml"],
    ["a path outside .github", "ci.yml"],
  ])(
    "given %s, when Claude proposes it, then it is refused invalid_arguments and nothing is kept",
    async (_name, path) => {
      const ctx = await ready();

      expectRefused(await propose(ctx, { path }));

      expect((await mcpRows(ctx.db)).at(-1)).toMatchObject({
        result: "refused",
        detail: { reason: "invalid_arguments" },
      });
      expect(await pending(ctx)).toBeNull();
    },
  );

  it("given a content of exactly 1 MiB, when Claude proposes it, then it is kept; one character more is not", async () => {
    const ctx = await ready();
    await proposed(ctx, { content: "x".repeat(1_048_576) });

    const over = await rpc(
      ctx.app,
      "tools/call",
      {
        name: "propose_workflow_change",
        arguments: {
          project_id: ctx.projectId,
          path: NEW_PATH,
          content: "x".repeat(1_048_577),
          reason: "Too long",
        },
      },
      `Bearer ${ctx.alice.secret}`,
    );

    // Refused by the tool, or by the size of the request: either way nothing is kept.
    if (over.status === 200)
      expect(
        ((await over.json()) as { result: { isError?: boolean } }).result
          .isError,
      ).toBe(true);
    else expect(over.status).toBe(413);
    expect((await pending(ctx))?.path).toBe(CI);
  });

  it("given a reason of 2,000 characters, when Claude proposes, then it is kept; at 2,001 it is refused invalid_arguments", async () => {
    const ctx = await ready();
    await proposed(ctx, { reason: "r".repeat(2000) });

    expectRefused(
      await propose(ctx, { path: NEW_PATH, reason: "r".repeat(2001) }),
    );

    expect((await mcpRows(ctx.db)).at(-1)?.detail?.reason).toBe(
      "invalid_arguments",
    );
    expect((await pending(ctx))?.path).toBe(CI);
  });

  it("given a content equal to the file on GitHub, when Claude proposes it, then it is refused no_change and nothing is kept", async () => {
    const ctx = await ready();

    expectRefused(await propose(ctx, { content: BEFORE }));

    expect((await mcpRows(ctx.db)).at(-1)).toMatchObject({
      result: "refused",
      detail: { reason: "no_change" },
    });
    expect(await pending(ctx)).toBeNull();
  });

  it("given a pending proposal on a file, when Claude proposes again on the same file, then the new one replaces it and no other stays pending", async () => {
    const ctx = await ready();
    await proposed(ctx, { reason: "First idea" });

    const second = dataOf<{ proposal_id: number; replaced: boolean }>(
      await propose(ctx, {
        content: `${AFTER}# more\n`,
        reason: "Second idea",
      }),
    );

    expect(second.replaced).toBe(true);
    expect(await pending(ctx)).toMatchObject({
      id: second.proposal_id,
      reason: "Second idea",
    });
    expect((await decide(ctx, second.proposal_id, "ignore")).status).toBe(200);
    expect(await pending(ctx)).toBeNull();
  });

  it("given someone who is not a member, when their Claude proposes on the project, then it is refused not_found and nothing is kept", async () => {
    const ctx = await ready();
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expectRefused(
      await callTool(ctx.app, bob.secret, "propose_workflow_change", {
        project_id: ctx.projectId,
        path: CI,
        content: AFTER,
        reason: "Not mine",
      }),
    );

    expect((await mcpRows(ctx.db)).at(-1)?.detail?.reason).toBe("not_found");
    expect(await pending(ctx)).toBeNull();
  });

  it("given an archived project, when Claude proposes, then it is refused project_archived and nothing is kept", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);

    expectRefused(await propose(ctx));

    expect((await mcpRows(ctx.db)).at(-1)?.detail?.reason).toBe(
      "project_archived",
    );
    expect(await pending(ctx)).toBeNull();
  });
});

describe("decision 067 F: the human decides", () => {
  it("given a proposal, when a member commits it, then one commit writes the proposed text, the entry records it and the proposal is no longer pending", async () => {
    const ctx = await ready();
    const id = await proposed(ctx);
    const base = ctx.git.head;

    const res = await decide(ctx, id, "commit");

    expect(res.status).toBe(200);
    const { commitSha } = (await res.json()) as { commitSha: string };
    expect(commitSha).toBe(ctx.git.head);
    expect(ctx.git.created.commits).toHaveLength(1);
    expect(ctx.git.created.commits[0]).toMatchObject({ parents: [base] });
    expect(ctx.git.filesAt(ctx.git.head)?.[CI]).toBe(AFTER);
    expect(await entries(ctx, "commit_workflow_change")).toMatchObject([
      {
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        args: { path: CI },
        result: "ok",
        github_effects: { commitSha, pullRequest: null },
      },
    ]);
    expect(await pending(ctx)).toBeNull();
  });

  it("given a proposal for a new file, when a member commits it, then the file is created", async () => {
    const ctx = await ready();
    const id = await proposed(ctx, { path: NEW_PATH });

    expect((await decide(ctx, id, "commit")).status).toBe(200);

    expect(ctx.git.filesAt(ctx.git.head)?.[NEW_PATH]).toBe(AFTER);
  });

  it.each([
    ["the file changed on GitHub", CI, { [CI]: "theirs\n" }],
    ["the new file now exists", NEW_PATH, { [NEW_PATH]: "theirs\n" }],
  ])(
    "given a proposal and %s since, when it is committed, then 409 repo_changed, nothing is written and one refused entry is recorded",
    async (_name, path, push) => {
      const ctx = await ready();
      const id = await proposed(ctx, { path });
      ctx.git.push(push);
      const head = ctx.git.head;

      const res = await decide(ctx, id, "commit");

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "repo_changed" });
      expect(ctx.git.head).toBe(head);
      expect(await entries(ctx, "commit_workflow_change")).toMatchObject([
        { result: "refused", detail: { reason: "repo_changed" } },
      ]);
    },
  );

  it("given GitHub that refuses the write for lack of the workflows permission, when a proposal is committed, then 409 workflows_forbidden and no pull request is opened", async () => {
    const ctx = await ready({
      refUpdateFailure: {
        status: 403,
        message: `refusing to allow a GitHub App to create or update workflow \`${CI}\` without \`workflows\` permission`,
      },
    });
    const id = await proposed(ctx);

    const res = await decide(ctx, id, "commit");

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "workflows_forbidden" });
    expect(ctx.git.pullRequests).toEqual([]);
    expect(ctx.git.refsCreated).toEqual([]);
  });

  it("given a proposal, when a member ignores it, then nothing is written, the entry holds the path and the proposal is no longer pending", async () => {
    const ctx = await ready();
    const id = await proposed(ctx);

    expect((await decide(ctx, id, "ignore")).status).toBe(200);

    expect(writes(ctx)).toEqual([]);
    expect(await entries(ctx, "ignore_workflow_change")).toMatchObject([
      {
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        args: { path: CI },
        result: "ok",
      },
    ]);
    expect(await pending(ctx)).toBeNull();
  });

  it.each([
    ["committed", "commit", "commit"],
    ["committed", "commit", "ignore"],
    ["ignored", "ignore", "commit"],
    ["ignored", "ignore", "ignore"],
  ] as const)(
    "given a proposal already %s, when it is decided again with %s then %s, then 409 already_decided and nothing more is written",
    async (_name, first, second) => {
      const ctx = await ready();
      const id = await proposed(ctx);
      await decide(ctx, id, first);
      const known = writes(ctx).length;

      const res = await decide(ctx, id, second);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "already_decided" });
      expect(writes(ctx)).toHaveLength(known);
    },
  );

  it("given two proposals on two files, when the first is ignored, then the oldest is the one shown first and the other comes next", async () => {
    const ctx = await ready();
    const first = await proposed(ctx, { reason: "Older" });
    await proposed(ctx, { path: NEW_PATH, reason: "Newer" });

    expect(await pending(ctx)).toMatchObject({ id: first, reason: "Older" });
    await decide(ctx, first, "ignore");

    expect(await pending(ctx)).toMatchObject({ reason: "Newer" });
  });

  it.each(["commit", "ignore"] as const)(
    "given a proposal of another user's project, when it is %s, then 404 and nothing is written",
    async (what) => {
      const ctx = await ready();
      const id = await proposed(ctx);
      const bob = await userWithToken(ctx.app, ctx.db, 2000);

      const res = await decide(ctx, id, what, bob.cookie);

      expect(res.status).toBe(404);
      expect(writes(ctx)).toEqual([]);
      expect((await pending(ctx))?.id).toBe(id);
    },
  );
});
