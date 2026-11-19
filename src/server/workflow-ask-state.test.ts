import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { stubGitHub } from "./test-github.ts";
import { type Ctx, ready } from "./test-launcher.ts";
import { callTool, dataOf } from "./test-mcp.ts";

// Story S12 (decision 085 B, E; prolongs 067 B, F, G): a Claude proposal is signalled, « Demander à Claude » survives a reload.
//
// Contract assumed where the decision leaves it open:
// - GET /api/projects/:id/workflows gives each workflow `claude`: null (never asked) or the LAST launch « Demander à Claude » of that path
//   { sessionUrl: string | null, startedAt: ISO, finishedAt: ISO | null, outcome: "succeeded" | "failed" | null, summary: string | null }.
// - POST /api/projects/:id/workflows/ask is refused 409 { error: "launch_running" } while a launch of the same path is not finished; nothing is fired.
// - GET /api/home lists a pending proposal in forYou as { kind: "workflow_proposal", proposalId, path, reason, project: { id, name } }.

afterEach(() => {
  vi.unstubAllGlobals();
});

const REPO = "user1000/app";
const PATH = ".github/workflows/nightly.yml";
const OTHER = ".github/workflows/ci.yml";
const TEXT = "name: Nightly\non: push\njobs: {}\n";

/** A launcher ready, then the GitHub stub replaced by one with a Git history for the repo. */
async function withRepo() {
  const ctx = await ready();
  const fm = stubGitHub({
    account: 1000,
    gitRepos: { [REPO]: { files: { "README.md": "# app\n", [PATH]: TEXT } } },
  });
  const failing = (path: string, name: string) => ({
    path,
    name,
    runs: [
      {
        conclusion: "failure" as const,
        seconds: 60,
        at: "2026-11-08T09:00:00Z",
      },
    ],
  });
  fm.git(REPO).workflows.push(failing(PATH, "Nightly"), failing(OTHER, "CI"));
  return ctx;
}
const ask = (ctx: Ctx, path = PATH) =>
  send(
    ctx.app,
    ctx.alice.cookie,
    "POST",
    `/api/projects/${ctx.projectId}/workflows/ask`,
    { path },
  );
type Claude = {
  sessionUrl: string | null;
  startedAt: string;
  finishedAt: string | null;
  outcome: string | null;
  summary: string | null;
} | null;
async function claudeOf(ctx: Ctx, path = PATH) {
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "GET",
    `/api/projects/${ctx.projectId}/workflows`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    workflows: { path: string; claude?: Claude }[];
  };
  return body.workflows.find((w) => w.path === path)?.claude;
}
const finish = (ctx: Ctx, launchId: number, summary: string) =>
  callTool(ctx.app, ctx.alice.secret, "finish_launch", {
    launch_id: launchId,
    outcome: "succeeded",
    summary,
  });

describe("S12 finding 2: « Demander à Claude » survives a reload", () => {
  it("given a launch in progress on a workflow, when GET /workflows is read again, then the workflow carries the running launch with its session url and no finish", async () => {
    const ctx = await withRepo();
    expect((await ask(ctx)).status).toBe(201);

    const claude = await claudeOf(ctx);

    expect(claude).toMatchObject({ finishedAt: null, summary: null });
    expect(claude?.sessionUrl).toMatch(/^https:\/\/claude\.ai\//);
    expect(typeof claude?.startedAt).toBe("string");
  });

  it("given a launch in progress, when a member asks again for the same workflow, then 409 launch_running and nothing more is fired", async () => {
    const ctx = await withRepo();
    expect((await ask(ctx)).status).toBe(201);
    const fired = ctx.calls.length;

    const res = await ask(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "launch_running" });
    expect(ctx.calls).toHaveLength(fired);
  });

  it("given a launch in progress on a workflow, when a member asks about another workflow, then it is launched", async () => {
    const ctx = await withRepo();
    expect((await ask(ctx)).status).toBe(201);

    expect((await ask(ctx, OTHER)).status).toBe(201);
  });

  it("given Claude finished with a summary and no proposal, when GET /workflows is read, then the workflow carries the summary and the finish, and asking again is allowed", async () => {
    const ctx = await withRepo();
    const { launchId } = (await (await ask(ctx)).json()) as {
      launchId: number;
    };
    dataOf(
      await finish(
        ctx,
        launchId,
        "La cause est un test instable, pas le workflow.",
      ),
    );

    const claude = await claudeOf(ctx);

    expect(claude).toMatchObject({
      outcome: "succeeded",
      summary: "La cause est un test instable, pas le workflow.",
    });
    expect(typeof claude?.finishedAt).toBe("string");
    expect((await ask(ctx)).status).toBe(201);
  });

  it("given a workflow never asked about, when GET /workflows is read, then claude is null", async () => {
    const ctx = await withRepo();

    expect(await claudeOf(ctx)).toBeNull();
  });
});

describe("S12 finding 1: a proposal is signalled on the home", () => {
  const propose = (ctx: Ctx) =>
    callTool(ctx.app, ctx.alice.secret, "propose_workflow_change", {
      project_id: ctx.projectId,
      path: PATH,
      content: "name: Nightly\non: [push, pull_request]\njobs: {}\n",
      reason: "Run on pull requests too.",
    });
  const forYou = async (ctx: Ctx) =>
    (
      (await (
        await ctx.app.request("/api/home", {
          headers: { cookie: ctx.alice.cookie },
        })
      ).json()) as {
        forYou: Record<string, unknown>[];
      }
    ).forYou;

  it("given a pending proposal, when the home is read, then forYou has a workflow_proposal item with its id, path, reason and project", async () => {
    const ctx = await withRepo();
    const { proposal_id } = dataOf<{ proposal_id: number }>(await propose(ctx));

    const items = (await forYou(ctx)).filter(
      (i) => i.kind === "workflow_proposal",
    );

    expect(items).toMatchObject([
      {
        proposalId: proposal_id,
        path: PATH,
        reason: "Run on pull requests too.",
        project: { id: ctx.projectId, name: REPO },
      },
    ]);
  });

  it("given no proposal, when the home is read, then forYou has no workflow_proposal item", async () => {
    const ctx = await withRepo();

    expect(
      (await forYou(ctx)).some((i) => i.kind === "workflow_proposal"),
    ).toBe(false);
  });
});
