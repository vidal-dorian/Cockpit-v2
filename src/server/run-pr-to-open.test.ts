// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the tool (decision 004)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliveryRow, pass, seedDelivery } from "./test-issue-edit.ts";
import { dataOf } from "./test-mcp.ts";
import {
  all,
  BRANCH,
  type Ctx,
  finish,
  reportStep,
  running,
  runRoute,
  runRow,
  stepRows,
  storyRow,
} from "./test-run-controls.ts";

// Decision 094: a run whose pull request could not be opened ends `pr_to_open`, not `failed`.

afterEach(() => {
  vi.unstubAllGlobals();
});

type Note = { type: string; title: string; body: string; url: string };
const notes = (db: Ctx["db"]) =>
  all<Note>(
    db,
    sql`select type, title, body, url from notifications order by id`,
  );
const iWant = async (db: Ctx["db"], id: number) =>
  (
    await all<{ i_want: string }>(
      db,
      sql`select i_want from user_stories where id = ${id}`,
    )
  )[0]?.i_want;

const toOpen = async () => {
  const s = await running();
  dataOf(
    await finish(s, { run_id: s.runId, outcome: "pr_to_open", summary: "x" }),
  );
  return s;
};

const opened = (s: Ctx, number: number, ref: string, action = "opened") =>
  seedDelivery(s.db, {
    event: "pull_request",
    action,
    repoId: 1,
    payload: {
      action,
      number,
      repository: { id: 1 },
      pull_request: { number, head: { ref } },
    },
  });

describe("criterion C: finish_run with outcome pr_to_open", () => {
  it("given a running run with an open step, when finish_run is called with pr_to_open, then the run is pr_to_open, the story stays in_progress, the step is closed failed, a question notification « PR à ouvrir » is queued and no run_failed", async () => {
    const s = await running();
    dataOf(await reportStep(s, s.runId));

    const data = dataOf(
      await finish(s, {
        run_id: s.runId,
        outcome: "pr_to_open",
        summary: "branch pushed",
      }),
    );

    expect(data).toEqual({ run_id: s.runId, status: "pr_to_open" });
    expect((await runRow(s.db, s.runId))?.status).toBe("pr_to_open");
    expect((await storyRow(s.db, s.id))?.status).toBe("in_progress");
    const steps = await stepRows(s.db, s.runId);
    expect(steps.map((x) => x.status)).toEqual(["failed"]);
    expect(steps[0]?.finished_at).not.toBeNull();
    const rows = await notes(s.db);
    expect(rows.some((n) => n.type === "run_failed")).toBe(false);
    expect(rows.filter((n) => n.title === "PR à ouvrir")).toEqual([
      {
        type: "question",
        title: "PR à ouvrir",
        body: await iWant(s.db, s.id),
        url: `/runs/${s.runId}`,
      },
    ]);
  });
});

describe("criterion D: the opened pull request is linked", () => {
  it("given a story whose latest run is pr_to_open, when a pull_request opened delivery for its branch arrives, then the story has the PR and is in_review, the run succeeded and « PR prête à relire » is queued", async () => {
    const s = await toOpen();
    const id = await opened(s, 31, BRANCH);

    await pass(s.db);

    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_review",
      pr_number: 31,
    });
    expect((await runRow(s.db, s.runId))?.status).toBe("succeeded");
    expect(
      (await notes(s.db)).filter((n) => n.title === "PR prête à relire"),
    ).toHaveLength(1);
  });

  it("given a pr_to_open run, when a PR opened on another branch arrives, then nothing changes", async () => {
    const s = await toOpen();
    await opened(s, 31, "us/other");

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      pr_number: null,
    });
    expect((await runRow(s.db, s.runId))?.status).toBe("pr_to_open");
  });

  it("given a story whose latest run is not pr_to_open, when a PR opened on its branch arrives, then nothing changes", async () => {
    const s = await running();
    await opened(s, 31, BRANCH);

    await pass(s.db);

    expect(await storyRow(s.db, s.id)).toEqual({
      status: "in_progress",
      pr_number: null,
    });
    expect((await runRow(s.db, s.runId))?.status).toBe("running");
    expect(
      (await notes(s.db)).filter((n) => n.title === "PR prête à relire"),
    ).toEqual([]);
  });
});

describe("criterion E: closing a pr_to_open run by hand", () => {
  it("given a pr_to_open run, when the member closes it by hand, then 200, closed_manually and the story is ready", async () => {
    const s = await toOpen();

    const res = await runRoute(s.app, s.alice.cookie, s.runId, "close");

    expect(res.status).toBe(200);
    expect((await runRow(s.db, s.runId))?.status).toBe("closed_manually");
    expect(await storyRow(s.db, s.id)).toEqual({
      status: "ready",
      pr_number: null,
    });
  });
});
