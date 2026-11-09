import { describe, expect, it } from "vitest";
import { BRANCH, link, REPO } from "./test-criteria.ts";
import { send } from "./test-decisions.ts";
import { finishLaunched, planned, ready, START } from "./test-launcher.ts";
import { dataOf, seedStory } from "./test-mcp.ts";
import {
  device,
  deviceRows,
  outbox,
  pass,
  pushDouble,
  pushError,
  subscribe,
} from "./test-push.ts";
import { asked, finish, running, tool } from "./test-questions.ts";
import { runRoute } from "./test-run-controls.ts";

// Slice 15.2 (decision 072 B, C, E, F): the events write the outbox, the pass of the minute sends it.

const NOON = new Date("2026-11-09T12:00:00Z");
const later = (from: Date, minutes: number) =>
  new Date(from.getTime() + minutes * 60_000);

/** A running run of Alice, with one subscribed device and a double that records the pushes. */
async function withDevice() {
  const ctx = await running();
  const push = pushDouble();
  expect((await subscribe(ctx, ctx.alice.cookie)).status, "subscribing").toBe(
    204,
  );
  return { ...ctx, push };
}

type Running = Awaited<ReturnType<typeof withDevice>>;

/** The story gets a run on `branch` and a linked PR: it goes in_review. */
async function reviewed(
  s: Running,
  storyId: number,
  branch: string,
  pr: number,
) {
  const { run_id } = dataOf<{ run_id: number }>(
    await tool(s, "start_run", {
      story_id: storyId,
      branch,
      model: "claude-x",
    }),
  );
  s.fetchMock.addPull(REPO, pr, branch);
  dataOf(await link(s, { run_id, pr_number: pr }));
}

describe("slice 15.2: the question", () => {
  it("given a subscribed device, when Claude asks a question with three suggested answers and the pass runs, then one push carries the question, the run page and two buttons, and the outbox is empty", async () => {
    const s = await withDevice();
    await asked(s, {
      question: "Quel nom pour le bouton ?",
      suggested_answers: ["Valider", "Envoyer", "Annuler"],
    });

    await pass(s.db, NOON, s.push.fn);

    expect(s.push.calls).toHaveLength(1);
    const { subscription, payload } = s.push.calls[0] ?? {};
    expect(subscription?.endpoint).toBe(device(1).endpoint);
    expect(`${payload?.title} ${payload?.body}`).toContain(
      "Quel nom pour le bouton ?",
    );
    expect(payload?.url).toBe(`/runs/${s.runId}`);
    expect(payload?.actions?.map((a) => a.title)).toEqual([
      "Valider",
      "Envoyer",
    ]);
    expect(await outbox(s.db)).toBe(0);
  });

  it("given the quiet hours, when a question is asked and the passes run during then after them, then no push is ever sent and the outbox is empty", async () => {
    const s = await withDevice();
    await asked(s);

    await pass(s.db, new Date("2026-11-09T23:00:00Z"), s.push.fn);
    await pass(s.db, NOON, s.push.fn);

    expect(s.push.calls).toHaveLength(0);
    expect(await outbox(s.db)).toBe(0);
  });

  it("given the question switch is off, when a question is asked and the pass runs, then nothing is sent and the outbox is empty", async () => {
    const s = await withDevice();
    const off = await send(
      s.app,
      s.alice.cookie,
      "PUT",
      "/api/me/notifications",
      { question: false },
    );
    expect(off.status, "switching off").toBe(200);
    await asked(s);

    await pass(s.db, NOON, s.push.fn);

    expect(s.push.calls).toHaveLength(0);
    expect(await outbox(s.db)).toBe(0);
  });
});

describe("slice 15.2: the run that fails", () => {
  it("given a subscribed device, when a run finishes failed and the pass runs, then one push says the run failed and points to a page", async () => {
    const s = await withDevice();
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    await pass(s.db, NOON, s.push.fn);

    expect(s.push.calls).toHaveLength(1);
    const payload = s.push.calls[0]?.payload;
    expect(`${payload?.title} ${payload?.body}`).toMatch(/échec/i);
    expect(payload?.url).toMatch(/^\/(runs|us)\/\d+$/);
  });

  it("given a subscribed device, when the user stops a run and it ends, then no push is sent", async () => {
    const s = await withDevice();
    expect(
      (await runRoute(s.app, s.alice.cookie, s.runId, "stop")).status,
    ).toBe(200);
    dataOf(
      await finish(s, { run_id: s.runId, outcome: "failed", summary: "x" }),
    );

    await pass(s.db, NOON, s.push.fn);

    expect(s.push.calls).toHaveLength(0);
    expect(await outbox(s.db)).toBe(0);
  });
});

describe("slice 15.2: the pull requests to review", () => {
  it("given a review push sent at noon, when two more stories go in_review within the hour, then nothing is sent before the hour is up and one push says 2 PR at the next pass", async () => {
    const s = await withDevice();
    s.fetchMock.addPull(REPO, 12, BRANCH);
    dataOf(await link(s, { run_id: s.runId, pr_number: 12 }));
    await pass(s.db, NOON, s.push.fn);
    expect(s.push.calls, "the first PR goes out alone").toHaveLength(1);
    s.push.calls.length = 0;
    await reviewed(s, s.base, "us/43-b", 13);
    await reviewed(
      s,
      await seedStory(s.db, s.ticketId, { status: "ready" }),
      "us/44-c",
      14,
    );

    await pass(s.db, later(NOON, 30), s.push.fn);
    expect(s.push.calls, "before the hour is up").toHaveLength(0);
    await pass(s.db, later(NOON, 61), s.push.fn);

    expect(s.push.calls).toHaveLength(1);
    const payload = s.push.calls[0]?.payload;
    expect(`${payload?.title} ${payload?.body}`).toContain(
      "2 PR prêtes à relire",
    );
    expect(payload?.url).toBe("/");
    expect(await outbox(s.db)).toBe(0);
  });
});

describe("slice 15.2: the recap of the night", () => {
  it("given a night that delivered a story, when the pass finishes it during the quiet hours, then one recap push is sent and the PR push of the quiet hours is not", async () => {
    const ctx = await ready();
    await planned(ctx, 1);
    const push = pushDouble();
    expect((await subscribe(ctx, ctx.alice.cookie)).status).toBe(204);
    const tick = (at: Date) => {
      ctx.clock.now = at.getTime();
      return pass(ctx.db, at, push.fn);
    };
    await tick(START);
    await finishLaunched(ctx, "succeeded");

    await tick(later(START, 5));

    expect(push.calls).toHaveLength(1);
    const payload = push.calls[0]?.payload;
    expect(`${payload?.title} ${payload?.body}`).toMatch(/Cette nuit/);
    expect(payload?.url).toBe("/");
    expect(await outbox(ctx.db)).toBe(0);
  });
});

describe("slice 15.2: a push service that forgets a device", () => {
  it.each([404, 410])(
    "given a subscribed device, when the push service answers %i, then its subscription is deleted",
    async (status) => {
      const s = await withDevice();
      await asked(s);
      s.push.state.fail = pushError(status);

      await pass(s.db, NOON, s.push.fn);

      expect(s.push.calls).toHaveLength(1);
      expect(await deviceRows(s.db)).toEqual([]);
    },
  );
});
