// biome-ignore-all lint/suspicious/noThenProperty: "then" is a Given/When/Then field of the stories (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bobsStory, withStory } from "./test-decisions.ts";
import {
  archiveProject,
  type StoryStatus,
  seedProject,
  seedStory,
  seedTicket,
  type TestDb,
  withProject,
} from "./test-mcp.ts";

// Slice 8.1 (decision 040 A to D): GET /api/home, for the session user, over their non-archived projects.
//
// Pinned shapes (the decision leaves them open; `project.name` is the full name of the repo):
//   GET /api/home -> 200 { forYou: Item[], claudeWorks: Work[], projects: Row[] }, 401 { error: "Unauthorized" }
//   Item = { kind: "answer", questionId, question, suggestedAnswers: string[] | null, runId, storyId, iWant, project }
//        | { kind: "validate", storyId, iWant, project }
//        | { kind: "review", storyId, iWant, prNumber, prCiState: "pending" | "success" | "failure" | null, project }
//        | { kind: "check", storyId, iWant, runId, reasons: string[] (codes of 039 C), project }
//   Work = { runId, storyId, iWant, project, step: string | null }   (agent of the last open step)
//   Row  = { id, name, state: "for_you" | "claude" | "idle" }
//   project = { id, name }

afterEach(() => {
  vi.unstubAllGlobals();
});

type Ctx = Awaited<ReturnType<typeof withProject>>;
type Project = { id: number; name: string };
type Item = { kind: string; project: Project } & Record<string, unknown>;
type Home = {
  forYou: Item[];
  claudeWorks: ({ project: Project } & Record<string, unknown>)[];
  projects: { id: number; name: string; state: string }[];
};

async function home(ctx: Ctx, cookie: string | undefined = ctx.alice.cookie) {
  return ctx.app.request("/api/home", cookie ? { headers: { cookie } } : {});
}
async function readHome(ctx: Ctx) {
  const res = await home(ctx);
  expect(res.status).toBe(200);
  return (await res.json()) as Home;
}

const rowsOf = async <T>(db: TestDb, q: ReturnType<typeof sql>) =>
  ((await db.execute(q)) as unknown as { rows: T[] }).rows;

async function story(
  ctx: Ctx,
  status: StoryStatus,
  iWant: string,
  over: { pr?: number; ci?: string; projectId?: number } = {},
) {
  const ticketId = await seedTicket(
    ctx.db,
    over.projectId ?? ctx.projectId,
    `t-${iWant}`,
  );
  const id = await seedStory(ctx.db, ticketId, { status, iWant });
  if (over.pr !== undefined)
    await ctx.db.execute(
      sql`update user_stories set pr_number = ${over.pr}, pr_ci_state = ${over.ci ?? null} where id = ${id}`,
    );
  return id;
}

async function run(
  ctx: Ctx,
  storyId: number,
  status: string,
  userId = ctx.alice.id,
) {
  const [r] = await rowsOf<{ id: number }>(
    ctx.db,
    sql`insert into runs (story_id, user_id, status, model_actual, finished_at)
        values (${storyId}, ${userId}, ${status}, 'claude-x', ${status === "running" ? null : new Date().toISOString()}::timestamptz) returning id`,
  );
  return (r as { id: number }).id;
}

const step = (ctx: Ctx, runId: number, agent: string, status: string) =>
  ctx.db.execute(
    sql`insert into run_steps (run_id, agent, status) values (${runId}, ${agent}, ${status})`,
  );

const ask = (
  ctx: Ctx,
  runId: number,
  question: string,
  suggested: string[] | null,
) =>
  ctx.db.execute(
    sql`insert into questions (run_id, question, suggested_answers) values (${runId}, ${question}, ${suggested === null ? null : JSON.stringify(suggested)}::jsonb)`,
  );

describe("criterion 1: GET /api/home is for the session user", () => {
  it("given no session, when I read /api/home, then 401", async () => {
    const ctx = await withProject();

    // No cookie at all: home(ctx, undefined) would fall back to the default cookie.
    expect((await ctx.app.request("/api/home")).status).toBe(401);
  });

  it("given Bob with his own story, when he reads it, then he sees only his story", async () => {
    const ctx = await withStory("to_validate");
    const bob = await bobsStory(ctx);

    const res = await ctx.app.request("/api/home", {
      headers: { cookie: bob.bob.cookie },
    });
    const body = (await res.json()) as Home;

    expect(res.status).toBe(200);
    expect(body.forYou.map((i) => i.storyId)).toEqual([bob.storyId]);
  });

  it("given another user's project and an archived project of mine, when I read it, then they contribute nothing", async () => {
    const ctx = await withProject();
    await bobsStory(ctx); // Bob's story to_validate
    const archived = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/old",
    });
    const old = await story(ctx, "to_validate", "vieille-us", {
      projectId: archived,
    });
    const oldRun = await run(
      ctx,
      await story(ctx, "in_progress", "vieux-run", { projectId: archived }),
      "running",
    );
    await ask(ctx, oldRun, "Question archivée ?", null);
    await archiveProject(ctx.db, archived);
    const mine = await story(ctx, "to_validate", "ma-us");

    const body = await readHome(ctx);

    expect(old).toBeGreaterThan(0);
    expect(body.forYou.map((i) => i.storyId)).toEqual([mine]);
    expect(body.claudeWorks).toEqual([]);
    expect(body.projects).toEqual([
      { id: ctx.projectId, name: "user1000/app", state: "for_you" },
    ]);
  });
});

describe("criterion 2: forYou, in the order of the verbs", () => {
  it("given one story of each kind, when I read it, then the items are answer, validate, review, check, with their data", async () => {
    const ctx = await withProject();
    const checkId = await story(ctx, "ready", "à-vérifier");
    const checkRun = await run(ctx, checkId, "failed");
    const reviewId = await story(ctx, "in_review", "à-relire", {
      pr: 7,
      ci: "failure",
    });
    const validateId = await story(ctx, "to_validate", "à-valider");
    const answerStory = await story(ctx, "in_progress", "à-répondre");
    const answerRun = await run(ctx, answerStory, "running");
    await ask(ctx, answerRun, "Quel nom ?", ["Valider", "Envoyer"]);
    const [q] = await rowsOf<{ id: number }>(
      ctx.db,
      sql`select id from questions`,
    );

    const { forYou } = await readHome(ctx);

    expect(forYou.map((i) => i.kind)).toEqual([
      "answer",
      "validate",
      "review",
      "check",
    ]);
    const project = { id: ctx.projectId, name: "user1000/app" };
    expect(forYou[0]).toMatchObject({
      kind: "answer",
      questionId: (q as { id: number }).id,
      question: "Quel nom ?",
      suggestedAnswers: ["Valider", "Envoyer"],
      runId: answerRun,
      storyId: answerStory,
      iWant: "à-répondre",
      project,
    });
    expect(forYou[1]).toMatchObject({
      kind: "validate",
      storyId: validateId,
      iWant: "à-valider",
      project,
    });
    expect(forYou[2]).toMatchObject({
      kind: "review",
      storyId: reviewId,
      prNumber: 7,
      prCiState: "failure",
      project,
    });
    expect(forYou[3]).toMatchObject({
      kind: "check",
      storyId: checkId,
      runId: checkRun,
      project,
    });
    expect((forYou[3] as unknown as { reasons: string[] }).reasons).toContain(
      "run_not_succeeded",
    );
  });

  it("given items of each kind, when I read it, then they carry their criteria count and the time they have waited since", async () => {
    const ctx = await withProject();
    const validateId = await story(ctx, "to_validate", "à-valider");
    await story(ctx, "in_review", "à-relire", { pr: 7 });
    const answerRun = await run(
      ctx,
      await story(ctx, "in_progress", "à-répondre"),
      "running",
    );
    await ask(ctx, answerRun, "Quel nom ?", null);
    const [count] = await rowsOf<{ n: number }>(
      ctx.db,
      sql`select count(*)::int as n from acceptance_criteria where story_id = ${validateId}`,
    );

    const { forYou } = await readHome(ctx);

    const [answer, validate, review] = forYou as unknown as {
      askedAt?: string;
      updatedAt?: string;
      criteriaCount?: number;
    }[];
    expect(Number.isNaN(Date.parse(answer?.askedAt ?? ""))).toBe(false);
    expect(validate?.criteriaCount).toBe((count as { n: number }).n);
    expect(Number.isNaN(Date.parse(validate?.updatedAt ?? ""))).toBe(false);
    expect(Number.isNaN(Date.parse(review?.updatedAt ?? ""))).toBe(false);
  });

  it("given a question without suggested answers, when I read it, then suggestedAnswers is null", async () => {
    const ctx = await withProject();
    const r = await run(ctx, await story(ctx, "in_progress", "x"), "running");
    await ask(ctx, r, "Libre ?", null);

    const { forYou } = await readHome(ctx);

    expect(forYou[0]).toMatchObject({ kind: "answer", suggestedAnswers: null });
  });

  it("given an answered question, when I read it, then it is not in forYou", async () => {
    const ctx = await withProject();
    const r = await run(ctx, await story(ctx, "in_progress", "x"), "running");
    await ask(ctx, r, "Déjà répondu ?", null);
    await ctx.db.execute(
      sql`update questions set answer = 'oui', answered_at = now()`,
    );

    expect((await readHome(ctx)).forYou).toEqual([]);
  });

  it("given an in_review story without PR number, a done and an abandoned story, when I read it, then none is in forYou", async () => {
    const ctx = await withProject();
    await story(ctx, "in_review", "sans-pr");
    await story(ctx, "done", "finie");
    await story(ctx, "abandoned", "abandonnée");

    expect((await readHome(ctx)).forYou).toEqual([]);
  });

  it("given a ready story with no run, when I read it, then it is not in forYou", async () => {
    const ctx = await withProject();
    await story(ctx, "ready", "prête");

    expect((await readHome(ctx)).forYou).toEqual([]);
  });

  it("given a ready story whose latest run is acceptable, when I read it, then it is not in forYou", async () => {
    const ctx = await withProject();
    const id = await story(ctx, "ready", "acceptable", {
      pr: 5,
      ci: "success",
    });
    const r = await run(ctx, id, "succeeded");
    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'passed', evidence = 'ok', result_run_id = ${r} where story_id = ${id}`,
    );

    expect((await readHome(ctx)).forYou).toEqual([]);
  });

  it("given a ready story whose latest run is still running, when I read it, then it is not a check item", async () => {
    const ctx = await withProject();
    const id = await story(ctx, "ready", "en-cours");
    await run(ctx, id, "running");

    expect(
      (await readHome(ctx)).forYou.filter((i) => i.kind === "check"),
    ).toEqual([]);
  });

  it("given a ready story with an old failed run and a newer acceptable one, when I read it, then only the latest run counts", async () => {
    const ctx = await withProject();
    const id = await story(ctx, "ready", "deux-runs", { pr: 5, ci: "success" });
    await run(ctx, id, "failed");
    const latest = await run(ctx, id, "succeeded");
    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'passed', evidence = 'ok', result_run_id = ${latest} where story_id = ${id}`,
    );

    expect((await readHome(ctx)).forYou).toEqual([]);
  });

  it("given a ready story whose latest run succeeded but CI fails, when I read it, then it is a check item with its reasons", async () => {
    const ctx = await withProject();
    const id = await story(ctx, "ready", "ci-rouge", { pr: 5, ci: "failure" });
    const r = await run(ctx, id, "succeeded");
    await ctx.db.execute(
      sql`update acceptance_criteria set result = 'passed', evidence = 'ok', result_run_id = ${r} where story_id = ${id}`,
    );

    const { forYou } = await readHome(ctx);

    expect(forYou).toHaveLength(1);
    expect(forYou[0]).toMatchObject({
      kind: "check",
      runId: r,
      reasons: ["ci_failing"],
    });
  });

  it("given a story to_validate whose ticket has other stories, when I read it, then each story appears once", async () => {
    const ctx = await withStory("to_validate");

    const ids = (await readHome(ctx)).forYou.map((i) => i.storyId);

    expect(ids).toEqual([ctx.id]);
  });
});

describe("criterion 3: claudeWorks", () => {
  it("given running runs with and without an open step, when I read it, then each says its story, project and current step", async () => {
    const ctx = await withProject();
    const s1 = await story(ctx, "in_progress", "avec-étape");
    const r1 = await run(ctx, s1, "running");
    await step(ctx, r1, "test-writer", "succeeded");
    await step(ctx, r1, "developer", "running");
    const s2 = await story(ctx, "in_progress", "sans-étape");
    const r2 = await run(ctx, s2, "running");
    const s3 = await story(ctx, "in_progress", "étapes-fermées");
    const r3 = await run(ctx, s3, "running");
    await step(ctx, r3, "developer", "succeeded");
    const s4 = await story(ctx, "ready", "run-fini");
    await run(ctx, s4, "failed");

    const { claudeWorks } = await readHome(ctx);

    const by = (runId: number) =>
      claudeWorks.find((w) => w.runId === runId) as Record<string, unknown>;
    expect(claudeWorks).toHaveLength(3);
    expect(by(r1)).toMatchObject({
      storyId: s1,
      iWant: "avec-étape",
      project: { id: ctx.projectId, name: "user1000/app" },
      step: "developer",
    });
    expect(by(r2)).toMatchObject({ iWant: "sans-étape", step: null });
    expect(by(r3)).toMatchObject({ step: null });
  });
});

describe("criterion 4: the state of each project", () => {
  it("given three projects (for you, Claude works, idle), when I read it, then the states are for_you, claude and idle", async () => {
    const ctx = await withProject();
    const second = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 2,
      fullName: "user1000/two",
    });
    const third = await seedProject(ctx.db, ctx.alice.id, {
      githubRepoId: 3,
      fullName: "user1000/three",
    });
    await story(ctx, "to_validate", "pour-toi");
    await run(ctx, await story(ctx, "in_progress", "claude-1"), "running"); // project 1 also has a run: for_you wins
    await run(
      ctx,
      await story(ctx, "in_progress", "claude-2", { projectId: second }),
      "running",
    );

    const { projects } = await readHome(ctx);

    expect(projects).toEqual(
      expect.arrayContaining([
        { id: ctx.projectId, name: "user1000/app", state: "for_you" },
        { id: second, name: "user1000/two", state: "claude" },
        { id: third, name: "user1000/three", state: "idle" },
      ]),
    );
    expect(projects).toHaveLength(3);
  });
});
