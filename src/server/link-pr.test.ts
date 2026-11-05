// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BRANCH,
  type Ctx,
  finish,
  link,
  REPO,
  running,
  storyRow,
} from "./test-criteria.ts";
import { validate, withStory } from "./test-decisions.ts";
import { githubCalls } from "./test-github.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  expectRefused,
  listedTools,
  mcpRows,
  textOf,
  userWithToken,
} from "./test-mcp.ts";

// Slice 7.3 (decision 035 C, D, G): link_pull_request and the new rule of finish_run.
// Pinned: the fake GitHub serves a PR seeded with `fetchMock.addPull(fullName, number, branch, headRepo?)`.

afterEach(() => {
  vi.unstubAllGlobals();
});

const PR = 12;
const withPr = async () => {
  const s = await running();
  s.fetchMock.addPull(REPO, PR, BRANCH);
  return s;
};

describe("criterion 3: link_pull_request links the PR", () => {
  it("given an in_progress story on its branch and a PR of that branch, when Claude links it, then the story has pr_number and is in_review, and the answer is { pr_number, story_status }", async () => {
    const s = await withPr();

    const data = dataOf(await link(s, { run_id: s.runId, pr_number: PR }));

    expect(data).toEqual({ pr_number: PR, story_status: "in_review" });
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });

  it("given a story with a PR already linked, when another PR is linked, then it replaces the first", async () => {
    const s = await withPr();
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));
    // The first PR was closed: the story is in progress again with a new run.
    await s.db.execute(
      sql`update user_stories set status = 'in_progress' where id = ${s.id}`,
    );
    s.fetchMock.addPull(REPO, 13, BRANCH);

    dataOf(await link(s, { run_id: s.runId, pr_number: 13 }));

    expect((await storyRow(s.db, s.id))?.pr_number).toBe(13);
  });

  it("given a published story, when its PR is linked, then the issue is resynced to the in_review label, after the PR was read", async () => {
    const s = await withStory("to_validate");
    expect((await validate(s.app, s.alice.cookie, s.id)).status).toBe(200);
    const { run_id } = dataOf<{ run_id: number }>(
      await callTool(s.app, s.alice.secret, "start_run", {
        story_id: s.id,
        branch: BRANCH,
        model: "claude-x",
      }),
    );
    s.fetchMock.addPull(REPO, PR, BRANCH);
    expect(s.fetchMock.issues(REPO)[0]?.labels).toEqual(["cockpit: en cours"]);
    const before = githubCalls(s.fetchMock).length;

    dataOf(await link(s, { run_id, pr_number: PR }));

    expect(s.fetchMock.issues(REPO)[0]?.labels).toEqual(["cockpit: en revue"]);
    const calls = githubCalls(s.fetchMock)
      .slice(before)
      .map((c) => `${c.method} ${c.path}`);
    const read = calls.findIndex(
      (c) => c.startsWith("GET ") && c.includes("/pulls/"),
    );
    const firstWrite = calls.findIndex((c) => /^(PATCH|POST|DELETE) /.test(c));
    expect(read).toBeGreaterThanOrEqual(0);
    expect(read).toBeLessThan(firstWrite);
  });

  it("given the server, when tools/list is called, then link_pull_request is listed with run_id and pr_number", async () => {
    const s = await running();

    const tool = (await listedTools(s.app, s.alice.secret)).find(
      (t) => t.name === "link_pull_request",
    );

    expect(Object.keys(tool?.inputSchema?.properties ?? {}).sort()).toEqual([
      "pr_number",
      "run_id",
    ]);
  });
});

describe("criterion 4: link_pull_request refusals", () => {
  async function expectUntouched(s: Ctx, reason: string, status: string) {
    expect(await storyRow(s.db, s.id)).toEqual({ status, pr_number: null });
    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      action: "link_pull_request",
      result: "refused",
      detail: { reason },
    });
  }

  it("given a PR that GitHub does not know, when it is linked, then it is refused pr_not_found", async () => {
    const s = await running();

    expectRefused(await link(s, { run_id: s.runId, pr_number: 99 }));

    await expectUntouched(s, "pr_not_found", "in_progress");
  });

  it("given a PR from another branch, when it is linked, then it is refused pr_wrong_branch", async () => {
    const s = await running();
    s.fetchMock.addPull(REPO, PR, "us/other");

    expectRefused(await link(s, { run_id: s.runId, pr_number: PR }));

    await expectUntouched(s, "pr_wrong_branch", "in_progress");
  });

  it("given a PR from a fork with the same branch name, when it is linked, then it is refused pr_wrong_branch", async () => {
    const s = await running();
    s.fetchMock.addPull(REPO, PR, BRANCH, "forker/app");

    expectRefused(await link(s, { run_id: s.runId, pr_number: PR }));

    await expectUntouched(s, "pr_wrong_branch", "in_progress");
  });

  it("given a story that is not in_progress, when a PR is linked, then it is refused wrong_status", async () => {
    const s = await withPr();
    await s.db.execute(
      sql`update user_stories set status = 'ready' where id = ${s.id}`,
    );

    expectRefused(await link(s, { run_id: s.runId, pr_number: PR }));

    await expectUntouched(s, "wrong_status", "ready");
  });

  it("given a finished run, when a PR is linked, then it is refused run_finished", async () => {
    const s = await withPr();
    // By hand, so that the story stays in_progress and only the run can refuse.
    await s.db.execute(
      sql`update runs set status = 'failed', finished_at = now() where id = ${s.runId}`,
    );

    expectRefused(await link(s, { run_id: s.runId, pr_number: PR }));

    await expectUntouched(s, "run_finished", "in_progress");
  });

  it("given an archived project, when a PR is linked, then it is refused project_archived", async () => {
    const s = await withPr();
    await archiveProject(s.db, s.projectId);

    expectRefused(await link(s, { run_id: s.runId, pr_number: PR }));

    await expectUntouched(s, "project_archived", "in_progress");
  });

  it("given the run of someone else, when a PR is linked, then it is refused not_found", async () => {
    const s = await withPr();
    const bob = await userWithToken(s.app, s.db, 2000);

    expectRefused(
      await callTool(s.app, bob.secret, "link_pull_request", {
        run_id: s.runId,
        pr_number: PR,
      }),
    );

    await expectUntouched(s, "not_found", "in_progress");
  });

  it("given GitHub fails with 500, when a PR is linked, then it is an Error result and nothing changes", async () => {
    const s = await withPr();
    s.fetchMock.update({
      failOn: (c) => c.method === "GET" && c.path.includes("/pulls/"),
    });

    const result = await link(s, { run_id: s.runId, pr_number: PR });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Error: \S/);
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      pr_number: null,
    });
  });

  it.each([0, -1, 1.5, "12"])(
    "given the pr_number %j, when a PR is linked, then it is refused invalid_arguments",
    async (pr_number) => {
      const s = await withPr();

      expectRefused(await link(s, { run_id: s.runId, pr_number }));

      await expectUntouched(s, "invalid_arguments", "in_progress");
    },
  );
});

describe("history of link_pull_request (decision 035 G)", () => {
  it("given a linked PR, when the history is read, then the entry is an MCP entry of the run and the story", async () => {
    const s = await withPr();
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));

    const entry = (await mcpRows(s.db)).find(
      (e) => e.action === "link_pull_request",
    );

    expect(entry).toMatchObject({
      result: "ok",
      project_id: s.projectId,
      ticket_id: s.ticketId,
      story_id: s.id,
      run_id: s.runId,
    });
  });
});

describe("criterion 5: finish_run needs a pull request to succeed (decision 035 D)", () => {
  it("given a story without PR, when finish_run succeeded is called, then it is refused no_pull_request and the run still runs", async () => {
    const s = await running();

    expectRefused(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "x" }),
    );

    expect((await mcpRows(s.db)).at(-1)).toMatchObject({
      action: "finish_run",
      result: "refused",
      detail: { reason: "no_pull_request" },
    });
    const runs = (await s.db.execute(
      sql`select status from runs where id = ${s.runId}`,
    )) as unknown as { rows: { status: string }[] };
    expect(runs.rows).toEqual([{ status: "running" }]);
    expect((await storyRow(s.db, s.id))?.status).toBe("in_progress");
  });

  it("given a story without PR, when finish_run failed is called, then it still works and the story is ready again", async () => {
    const s = await running();

    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    expect((await storyRow(s.db, s.id))?.status).toBe("ready");
  });

  it("given a linked PR, when finish_run succeeded is called, then the run succeeded and the story stays in_review", async () => {
    const s = await withPr();
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));

    const data = dataOf(
      await finish(s, { run_id: s.runId, outcome: "succeeded", summary: "PR" }),
    );

    expect(data).toEqual({ run_id: s.runId, status: "succeeded" });
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: PR,
    });
  });
});

describe("criterion 6: get_user_story gives the PR", () => {
  it("given a linked PR, when get_user_story is called, then story.pr_number is the PR; before, it is null", async () => {
    const s = await withPr();
    const read = async () =>
      dataOf<{ story: { pr_number: number | null } }>(
        await callTool(s.app, s.alice.secret, "get_user_story", {
          story_id: s.id,
        }),
      ).story.pr_number;
    expect(await read()).toBeNull();

    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));

    expect(await read()).toBe(PR);
  });

  it("given a linked PR, when GET /api/stories/:id is called, then story.prNumber is the PR", async () => {
    const s = await withPr();
    dataOf(await link(s, { run_id: s.runId, pr_number: PR }));

    const body = (await (
      await s.app.request(`/api/stories/${s.id}`, {
        headers: { cookie: s.alice.cookie },
      })
    ).json()) as { story: { prNumber: number } };

    expect(body.story.prNumber).toBe(PR);
  });
});
