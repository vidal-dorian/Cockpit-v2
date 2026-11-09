import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import {
  type Ctx,
  connectLauncher,
  FIRE_ANSWER,
  finishLaunched,
  launch,
  pay,
  ready,
  setBudgets,
  setup,
} from "./test-launcher.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  rows,
  userWithToken,
} from "./test-mcp.ts";

// Slice 12.4 (decision 067 G): « Demander à Claude » on a red workflow, a cloud launch through the launcher of decision 054.
//
// Contract assumed where the decision leaves it open:
// - POST /api/projects/:id/workflows/ask takes { path } (a `.github/workflows/<name>.yml|.yaml`, 400 otherwise) and answers 201 { launchId, sessionUrl } like POST /api/stories/:id/launch;
//   /fire is called once with { text: "launch_id: <id>" }, the instructions travel through get_launch. The route does not read GitHub.
// - get_launch of such a launch answers { launch_id, kind: "workflow", project: { id, full_name, default_branch }, path, instructions }; the instructions name the workflow path,
//   the repository, the tool propose_workflow_change and the tool finish_launch, and say to never commit or push a workflow.
// - The refusals are those of 054, as 409 { error } (`launcher_not_connected`, `project_not_in_launcher`, `project_archived`, `monthly_budget_reached`), nothing is fired,
//   one refused entry with detail { reason }; a project of another user is 404.
// - The entry `ask_workflow_help` is human / ui with args { path } and nothing else (no token, no instructions).

afterEach(() => {
  vi.unstubAllGlobals();
});

const PATH = ".github/workflows/nightly.yml";
const ask = (
  ctx: Ctx,
  body: unknown = { path: PATH },
  cookie = ctx.alice.cookie,
  id: number = ctx.projectId,
) => send(ctx.app, cookie, "POST", `/api/projects/${id}/workflows/ask`, body);
const askEntries = (ctx: Ctx) =>
  rows(ctx.db, sql`action = 'ask_workflow_help'`);

describe("decision 067 G: Demander à Claude", () => {
  it("given a connected launcher and a ticked project, when a member asks Claude about a workflow, then one cloud launch is fired and get_launch gives instructions that name the workflow, propose_workflow_change and finish_launch and forbid committing", async () => {
    const ctx = await ready();

    const res = await ask(ctx);

    expect(res.status).toBe(201);
    const { launchId, sessionUrl } = (await res.json()) as {
      launchId: number;
      sessionUrl: string;
    };
    expect(sessionUrl).toBe(FIRE_ANSWER.claude_code_session_url);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.body).toEqual({ text: `launch_id: ${launchId}` });
    const data = dataOf<{
      kind: string;
      project: unknown;
      path: string;
      instructions: string;
    }>(
      await callTool(ctx.app, ctx.alice.secret, "get_launch", {
        launch_id: launchId,
      }),
    );
    expect(data).toMatchObject({
      kind: "workflow",
      project: { id: ctx.projectId, full_name: "user1000/app" },
      path: PATH,
    });
    for (const part of [
      PATH,
      "user1000/app",
      "propose_workflow_change",
      "finish_launch",
    ])
      expect(data.instructions).toContain(part);
    expect(data.instructions).toMatch(/never commit/i);
  });

  it("given a launch, when the history is read, then ask_workflow_help is human / ui with the path only", async () => {
    const ctx = await ready();

    await ask(ctx);

    expect(await askEntries(ctx)).toMatchObject([
      {
        user_id: ctx.alice.id,
        project_id: ctx.projectId,
        actor: "human",
        origin: "ui",
        args: { path: PATH },
        result: "ok",
      },
    ]);
  });

  it.each([
    ["no launcher", "launcher_not_connected", () => setup()],
    [
      "a project that is not ticked",
      "project_not_in_launcher",
      async () => {
        const ctx = await setup();
        await connectLauncher(ctx);
        return ctx;
      },
    ],
    [
      "an archived project",
      "project_archived",
      async () => {
        const ctx = await ready();
        await archiveProject(ctx.db, ctx.projectId);
        return ctx;
      },
    ],
    [
      "a monthly budget that is reached",
      "monthly_budget_reached",
      async () => {
        const ctx = await ready();
        expect((await launch(ctx)).status, "a first launch").toBe(201);
        await finishLaunched(ctx, "failed");
        await pay(ctx, 1);
        await setBudgets(ctx, { monthUsd: 1 });
        return ctx;
      },
    ],
  ] as [string, string, () => Promise<Ctx>][])(
    "given %s, when a member asks Claude, then 409 %s, nothing is fired and the refusal is recorded",
    async (_name, code, arrange) => {
      const ctx = await arrange();
      const fired = ctx.calls.length;

      const res = await ask(ctx);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: code });
      expect(ctx.calls).toHaveLength(fired);
      expect(await askEntries(ctx)).toMatchObject([
        { result: "refused", detail: { reason: code } },
      ]);
    },
  );

  it.each([
    ["no path", {}],
    ["a path that is not a workflow", { path: "README.md" }],
  ])(
    "given %s, when a member asks Claude, then 400 and nothing is fired",
    async (_name, body) => {
      const ctx = await ready();

      expect((await ask(ctx, body)).status).toBe(400);
      expect(ctx.calls).toEqual([]);
    },
  );

  it("given another user's project, when someone asks Claude, then 404 and nothing is fired", async () => {
    const ctx = await ready();
    expect((await ask(ctx)).status).toBe(201);
    const bob = await userWithToken(ctx.app, ctx.db, 2000);

    expect((await ask(ctx, { path: PATH }, bob.cookie)).status).toBe(404);
    expect(ctx.calls).toHaveLength(1);
  });
});
