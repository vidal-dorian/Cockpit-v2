// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "./secrets.ts";
import { send } from "./test-decisions.ts";
import { stubGitHub } from "./test-github.ts";
import { TEST_KEY } from "./test-instance.ts";
import {
  answerStatus,
  BRANCH,
  type Ctx,
  connectBody,
  connectLauncher,
  FIRE_ANSWER,
  FIRE_URL,
  launch,
  readLauncher,
  ready,
  setup,
  TOKEN,
  tick,
} from "./test-launcher.ts";
import {
  archiveProject,
  callTool,
  dataOf,
  rows,
  type StoryStatus,
  seedProject,
  userWithToken,
} from "./test-mcp.ts";

// Slice 14.1 (decision 054 C, D, E, I, J): the launcher of a user, the projects ticked for it, the launch of a story
// and the cloud of a run.
//
// Choices fixed here, where the decision leaves them open (the developer may not weaken them):
// - The outbound `/fire` call is the same `AppOptions.fireRoutine` as the write-US routine (022), `AppOptions.now`
//   (milliseconds) is the clock of the routes (the 15 minutes of `launch_pending`).
// - GET /api/me/launcher -> { connected, needsReconnect, prompt, projectIds }; PUT { fireUrl, token } answers 200 with
//   the same object; DELETE answers 204. The token and the address are never rendered.
// - PUT /api/projects/:id/launcher { inLauncher } answers 200 { inLauncher }.
// - POST /api/stories/:id/launch answers 201 { launchId, sessionUrl } or 409/502 { error: <code> }, 400 { error }.
// - Tables `cloud_launchers` (the sealed token, "v1:...") and `cloud_launches` (run_id).
// - A refusal writes one `launch_story` entry: human / ui, result `refused`, detail { reason: <code> }, with the story.

afterEach(() => {
  vi.unstubAllGlobals();
});

const setStatus = (ctx: Ctx, status: StoryStatus) =>
  ctx.db.execute(
    sql`update user_stories set status = ${status} where id = ${ctx.storyId}`,
  );
const launchEntries = (ctx: Ctx) => rows(ctx.db, sql`action = 'launch_story'`);

async function expectRefusal(ctx: Ctx, code: string) {
  const before = ctx.calls.length;
  const res = await launch(ctx);
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ error: code });
  expect(ctx.calls, "/fire is not called").toHaveLength(before);
  const found = (await launchEntries(ctx)).filter(
    (e) => e.result === "refused",
  );
  expect(found.at(-1)).toMatchObject({
    actor: "human",
    origin: "ui",
    user_id: ctx.alice.id,
    detail: { reason: code },
  });
}

describe("criterion 1: the launcher of the user (C)", () => {
  it("given a valid fire URL and a token, when the user PUTs them, then GET answers { connected: true, needsReconnect: false, prompt, projectIds: [] } and never the token or the address", async () => {
    const ctx = await setup();

    const put = await connectLauncher(ctx);

    expect(put.status).toBe(200);
    const got = await readLauncher(ctx);
    expect(got).toEqual({
      connected: true,
      needsReconnect: false,
      prompt: expect.any(String),
      projectIds: [],
      missingProjectIds: [],
    });
    const text = JSON.stringify(got) + (await put.clone().text());
    for (const secret of [TOKEN, "trig_01LAUNCHER"])
      expect(text).not.toContain(secret);
  });

  it.each([
    ["another host", "https://example.com/v1/claude_code/routines/x/fire"],
    ["a query", "https://api.anthropic.com/v1/claude_code/routines/x/fire?a=1"],
  ])(
    "given %s as fire URL, when it is PUT, then 400 and nothing is connected",
    async (_name, fireUrl) => {
      const ctx = await setup();

      const res = await connectLauncher(ctx, connectBody({ fireUrl }));

      expect(res.status).toBe(400);
      expect((await readLauncher(ctx)).connected).toBe(false);
    },
  );

  it("given a connected launcher, when the user DELETEs it, then connected is false again", async () => {
    const ctx = await setup();
    await connectLauncher(ctx);

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "DELETE",
      "/api/me/launcher",
    );

    expect(res.status).toBe(204);
    expect((await readLauncher(ctx)).connected).toBe(false);
  });

  it("given connect then disconnect, when the history is read, then connect_launcher and disconnect_launcher have args {} and no secret anywhere", async () => {
    const ctx = await setup();
    await connectLauncher(ctx);
    await send(ctx.app, ctx.alice.cookie, "DELETE", "/api/me/launcher");

    for (const action of ["connect_launcher", "disconnect_launcher"]) {
      const found = await rows(ctx.db, sql`action = ${action}`);
      expect(found, action).toHaveLength(1);
      expect(found[0]).toMatchObject({
        user_id: ctx.alice.id,
        actor: "human",
        origin: "ui",
        args: {},
        result: "ok",
      });
    }
    const text = JSON.stringify(await rows(ctx.db));
    for (const secret of [TOKEN, "trig_01LAUNCHER", "api.anthropic.com"])
      expect(text).not.toContain(secret);
  });

  it("given a connected launcher, when cloud_launchers is read, then the token is not in clear and decrypts to the token", async () => {
    const ctx = await setup();
    await connectLauncher(ctx);

    const result = await ctx.db.execute(sql`select * from cloud_launchers`);
    const found = (result as unknown as { rows: Record<string, unknown>[] })
      .rows;

    expect(found).toHaveLength(1);
    expect(JSON.stringify(found)).not.toContain(TOKEN);
    const sealed = Object.values(found[0] ?? {}).filter(
      (v): v is string => typeof v === "string" && v.startsWith("v1:"),
    );
    expect(sealed).toHaveLength(1);
    expect(decrypt(TEST_KEY, sealed[0] as string)).toBe(TOKEN);
  });
});

describe("criterion 2: the projects of the launcher (D)", () => {
  it("given an active project, when a member PUTs inLauncher true, then GET lists it in projectIds and the entry set_launcher_project has args { projectId, inLauncher }", async () => {
    const ctx = await setup();

    const res = await tick(ctx);

    expect(res.status).toBe(200);
    expect((await readLauncher(ctx)).projectIds).toEqual([ctx.projectId]);
    const found = await rows(ctx.db, sql`action = 'set_launcher_project'`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      actor: "human",
      origin: "ui",
      args: { projectId: ctx.projectId, inLauncher: true },
      result: "ok",
    });
  });

  it("given a project of someone else, when I PUT inLauncher, then 404 and nothing changes", async () => {
    const ctx = await setup();
    stubGitHub({ account: 1000 });
    const bob = await userWithToken(ctx.app, ctx.db, 2000);
    const bobsProject = await seedProject(ctx.db, bob.id, {
      githubRepoId: 2,
      fullName: "user2000/app",
    });

    const res = await tick(ctx, bobsProject);

    expect(res.status).toBe(404);
    const theirs = await send(ctx.app, bob.cookie, "GET", "/api/me/launcher");
    expect(
      ((await theirs.json()) as { projectIds: number[] }).projectIds,
    ).toEqual([]);
  });

  it("given an archived project, when a member PUTs inLauncher true, then 409 project_archived", async () => {
    const ctx = await setup();
    await archiveProject(ctx.db, ctx.projectId);

    const res = await tick(ctx);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "project_archived" });
  });
});

describe("criterion 3: launching a story (E)", () => {
  it("given a connected launcher, a ticked project and a ready story, when the user launches, then /fire is called once with the token, the two headers, the body { text: launch_id: <id> } only and no redirect, and the answer is 201 { launchId, sessionUrl }", async () => {
    const ctx = await ready();

    const res = await launch(ctx, {
      branch: BRANCH,
      comment: "SECRET-COMMENT",
    });

    expect(res.status).toBe(201);
    const answer = (await res.json()) as {
      launchId: number;
      sessionUrl: string;
    };
    expect(answer).toEqual({
      launchId: expect.anything(),
      sessionUrl: FIRE_ANSWER.claude_code_session_url,
    });
    expect(ctx.calls).toHaveLength(1);
    const [call] = ctx.calls;
    expect(call?.url).toBe(FIRE_URL);
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("anthropic-beta")).toBe(
      "experimental-cc-routine-2026-04-01",
    );
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("error");
    expect(call?.body).toEqual({ text: `launch_id: ${answer.launchId}` });
    expect(String(call?.init.body)).not.toContain("SECRET-COMMENT");
    expect(String(call?.init.body)).not.toContain(BRANCH);
  });

  it.each([["another host of claude.ai", "https://evil.example.com/code/s"]])(
    "given /fire answers %s as session address, when the user launches, then sessionUrl is null",
    async (_name, url) => {
      const ctx = await ready(() =>
        Response.json({ ...FIRE_ANSWER, claude_code_session_url: url }),
      );

      const res = await launch(ctx);

      expect(res.status).toBe(201);
      expect(
        ((await res.json()) as { sessionUrl: unknown }).sessionUrl,
      ).toBeNull();
    },
  );

  it("given a launch, when the history is read, then launch_story is human / ui with args { storyId, launchId, sessionId }, ok, and no token or comment", async () => {
    const ctx = await ready();
    const { launchId } = (await (
      await launch(ctx, { branch: BRANCH, comment: "SECRET-COMMENT" })
    ).json()) as { launchId: number };

    const found = await launchEntries(ctx);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      user_id: ctx.alice.id,
      project_id: ctx.projectId,
      story_id: ctx.storyId,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: {
        storyId: ctx.storyId,
        launchId,
        sessionId: FIRE_ANSWER.claude_code_session_id,
      },
    });
    const text = JSON.stringify(await rows(ctx.db));
    for (const secret of [TOKEN, "SECRET-COMMENT", "trig_01LAUNCHER"])
      expect(text).not.toContain(secret);
  });
});

describe("criterion 4: the refusals and the failures of /fire (E)", () => {
  it("given an archived project, when the user launches, then 409 project_archived", async () => {
    const ctx = await ready();
    await archiveProject(ctx.db, ctx.projectId);
    await expectRefusal(ctx, "project_archived");
  });

  it("given no launcher, when the user launches, then 409 launcher_not_connected", async () => {
    const ctx = await setup();
    await expectRefusal(ctx, "launcher_not_connected");
  });

  it("given a launcher that needs reconnecting, when the user launches, then 409 launcher_needs_reconnect", async () => {
    const ctx = await ready(answerStatus(401));
    expect((await launch(ctx)).status).toBe(502);
    expect((await readLauncher(ctx)).needsReconnect).toBe(true);
    await expectRefusal(ctx, "launcher_needs_reconnect");
  });

  it("given a project that is not ticked, when the user launches, then 409 project_not_in_launcher", async () => {
    const ctx = await setup();
    await connectLauncher(ctx);
    await expectRefusal(ctx, "project_not_in_launcher");
  });

  it("given a to_validate story, when the user launches, then 409 wrong_status", async () => {
    const ctx = await ready();
    await setStatus(ctx, "to_validate");
    await expectRefusal(ctx, "wrong_status");
  });

  it.each(["ready", "in_review"] as const)(
    "given a %s story with a running run, when the user launches, then 409 run_active",
    async (status) => {
      const ctx = await ready();
      dataOf(
        await callTool(ctx.app, ctx.alice.secret, "start_run", {
          story_id: ctx.storyId,
          branch: BRANCH,
          model: "claude-x",
        }),
      );
      await setStatus(ctx, status);
      await expectRefusal(ctx, "run_active");
    },
  );

  it("given a story that already has another branch, when the user launches on a new one, then 409 branch_mismatch", async () => {
    const ctx = await ready();
    await ctx.db.execute(
      sql`update user_stories set branch = 'us/other' where id = ${ctx.storyId}`,
    );
    await expectRefusal(ctx, "branch_mismatch");
  });

  it("given a launch of this story less than 15 minutes old with no run and no report, when the user launches again, then 409 launch_pending, and after 15 minutes it launches again", async () => {
    const ctx = await ready();
    expect((await launch(ctx)).status).toBe(201);
    ctx.clock.now += 14 * 60_000;

    await expectRefusal(ctx, "launch_pending");
    expect(ctx.calls).toHaveLength(1);

    ctx.clock.now += 61_000;
    expect((await launch(ctx)).status).toBe(201);
    expect(ctx.calls).toHaveLength(2);
  });
});

describe("criterion 6: the cloud of a run (I)", () => {
  async function runOf(ctx: Ctx, launchId?: unknown) {
    const { run_id } = dataOf<{ run_id: number }>(
      await callTool(ctx.app, ctx.alice.secret, "start_run", {
        story_id: ctx.storyId,
        branch: BRANCH,
        model: "claude-x",
        ...(launchId === undefined ? {} : { launch_id: launchId }),
      }),
    );
    return (await (
      await send(ctx.app, ctx.alice.cookie, "GET", `/api/runs/${run_id}`)
    ).json()) as { cloud: unknown };
  }

  it("given a run attached to a launch, when GET /api/runs/:id is read, then cloud is { sessionUrl }", async () => {
    const ctx = await ready();
    const { launchId } = (await (await launch(ctx)).json()) as {
      launchId: number;
    };

    expect((await runOf(ctx, launchId)).cloud).toEqual({
      sessionUrl: FIRE_ANSWER.claude_code_session_url,
    });
  });

  it("given a run started on this PC, when GET /api/runs/:id is read, then cloud is null", async () => {
    const ctx = await ready();

    expect((await runOf(ctx)).cloud).toBeNull();
  });
});
