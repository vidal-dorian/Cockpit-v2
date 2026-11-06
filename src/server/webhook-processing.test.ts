import { createHmac } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Ctx, withStory } from "./test-decisions.ts";
import {
  deliveryRow,
  divergenceOf,
  entriesOf,
  issuesPayload,
  NOT_DIVERGED,
  type Published,
  pass,
  publishedStory,
  readInstanceOf,
  seedDelivery,
} from "./test-issue-edit.ts";
import { historyText } from "./test-mcp.ts";
import { processDeliveries, scheduleDeliveries } from "./webhooks.ts";

// Decision 025 A (slice 5.2): the processing of the recorded deliveries. The pinned names, signatures and columns are
// listed at the top of test-issue-edit.ts.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A pending delivery that edits the issue of `s` with a human's text. */
const edit = (s: Published, over: Parameters<typeof seedDelivery>[1] = {}) =>
  seedDelivery(s.db, {
    event: "issues",
    action: "edited",
    repoId: 1,
    payload: issuesPayload({
      number: s.number,
      title: s.github.title,
      body: `${s.github.body}\n\nAjout humain`,
    }),
    ...over,
  });

const diverged = async (s: Published) =>
  (await divergenceOf(s.db, s.id)).issue_diverged_at !== null;
const divergedEntries = (s: Ctx) => entriesOf(s.db, "issue_diverged");

/** Polls with the real clock: `vi.waitFor` would advance the fake timers of the scheduler tests. */
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the condition never became true");
}

describe("criterion A: a pass handles the pending deliveries", () => {
  it("given a pending issues.edited delivery of a tracked issue, when a pass runs, then it is handled (the story diverges) and gets a processed_at date", async () => {
    const s = await publishedStory();
    const id = await edit(s);

    await pass(s.db);

    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    expect(await diverged(s)).toBe(true);
    expect(await divergedEntries(s)).toHaveLength(1);
  });

  it.each([
    ["ping", null],
    ["issues", "opened"],
    ["issue_comment", "edited"],
    ["pull_request", "opened"],
  ])(
    "given a pending %s delivery (action %s) that nothing handles, when a pass runs, then it is marked processed and nothing is written",
    async (event, action) => {
      const s = await publishedStory();
      const before = await historyText(s.db);
      const id = await edit(s, { event, action });

      await pass(s.db);

      expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
      expect(await divergenceOf(s.db, s.id)).toMatchObject(NOT_DIVERGED);
      expect(await historyText(s.db)).toBe(before);
    },
  );

  it("given a delivery already processed, when a pass runs, then it is not handled again", async () => {
    const s = await publishedStory();
    await edit(s, { processedAgo: 3_600 });

    await pass(s.db);

    expect(await diverged(s)).toBe(false);
    expect(await divergedEntries(s)).toEqual([]);
  });

  it("given a pending delivery, when two passes run at once, then it is handled once", async () => {
    const s = await publishedStory();
    const id = await edit(s);
    const deps = { readInstance: readInstanceOf(s.db) };

    await Promise.all([
      processDeliveries(s.db, deps),
      processDeliveries(s.db, deps),
    ]);

    expect(await divergedEntries(s)).toHaveLength(1);
    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
  });

  it("given a delivery claimed less than a minute ago, when a pass runs, then it is skipped: not handled, not processed, no attempt counted", async () => {
    const s = await publishedStory();
    const id = await edit(s, { claimedAgo: 10 });

    await pass(s.db);

    expect(await divergedEntries(s)).toEqual([]);
    expect(await deliveryRow(s.db, id)).toMatchObject({
      processed_at: null,
      attempts: 0,
    });
  });

  it("given a delivery claimed more than a minute ago (a pass that died), when a pass runs, then it is taken again and handled", async () => {
    const s = await publishedStory();
    const id = await edit(s, { claimedAgo: 90 });

    await pass(s.db);

    expect(await divergedEntries(s)).toHaveLength(1);
    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
  });
});

describe("criterion A: a failing handler", () => {
  /** An instance reader that fails the first `failures` times. */
  const flaky = (s: Published, failures: number) => {
    const real = readInstanceOf(s.db);
    let calls = 0;
    return Object.assign(
      async () => {
        if (++calls <= failures) throw new Error("secret-boom-text");
        return real();
      },
      { forget: () => {} },
    );
  };
  const releaseClaim = (s: Published) =>
    s.db.execute(sql`update webhook_deliveries set claimed_at = null`);

  it("given a handler that fails, when a pass runs, then processed_at stays null, one attempt is counted and nothing is written to the history", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await publishedStory();
    const id = await edit(s);
    const before = await historyText(s.db);

    await processDeliveries(s.db, { readInstance: flaky(s, 99) });

    expect(await deliveryRow(s.db, id)).toMatchObject({
      processed_at: null,
      attempts: 1,
    });
    expect(await historyText(s.db)).toBe(before);
    expect(await diverged(s)).toBe(false);
  });

  it("given a delivery that failed once, when the next pass works, then it is handled once and processed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await publishedStory();
    const id = await edit(s);
    const readInstance = flaky(s, 1);
    await processDeliveries(s.db, { readInstance });
    await releaseClaim(s);

    await processDeliveries(s.db, { readInstance });

    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    expect(await divergedEntries(s)).toHaveLength(1);
    expect(await entriesOf(s.db, "process_webhook")).toEqual([]);
  });

  it("given a delivery that failed four times, when it fails a fifth time, then it is marked processed and exactly one process_webhook error entry is written (no text of the error)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = await publishedStory();
    const id = await edit(s);
    const readInstance = flaky(s, 99);

    for (let attempt = 1; attempt <= 4; attempt++) {
      await processDeliveries(s.db, { readInstance });
      await releaseClaim(s);
      expect(
        await deliveryRow(s.db, id),
        `after attempt ${attempt}`,
      ).toMatchObject({ processed_at: null, attempts: attempt });
      expect(await entriesOf(s.db, "process_webhook")).toEqual([]);
    }
    await processDeliveries(s.db, { readInstance });

    expect(await deliveryRow(s.db, id)).toMatchObject({ attempts: 5 });
    expect((await deliveryRow(s.db, id)).processed_at).not.toBeNull();
    const entries = await entriesOf(s.db, "process_webhook");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: "github",
      origin: "webhook",
      user_id: s.alice.id,
      project_id: s.projectId,
      result: "error",
      detail: { reason: "error" },
      args: { deliveryId: id },
    });
    expect(Object.keys(entries[0]?.args ?? {})).toEqual(["deliveryId"]);
    expect(await historyText(s.db)).not.toContain("secret-boom-text");

    // Processed for good: a further pass neither retries nor writes a second entry.
    await releaseClaim(s);
    await processDeliveries(s.db, { readInstance });
    expect(await entriesOf(s.db, "process_webhook")).toHaveLength(1);
    expect(await deliveryRow(s.db, id)).toMatchObject({ attempts: 5 });
  });
});

describe("criterion A: when a pass runs", () => {
  it("given a signed issues.edited delivery posted to the route, when the 202 is answered, then the delivery gets processed without waiting for the minute", async () => {
    const s = await publishedStory();
    const body = JSON.stringify(
      issuesPayload({
        number: s.number,
        title: s.github.title,
        body: `${s.github.body}\n\nAjout humain`,
      }),
    );

    const res = await s.app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", "webhook-secret").update(body).digest("hex")}`,
        "x-github-delivery": "post-202",
        "x-github-event": "issues",
      },
      body,
    });

    expect(res.status).toBe(202);
    await vi.waitFor(async () => {
      expect((await deliveryRow(s.db, "post-202")).processed_at).not.toBeNull();
    });
    expect(await diverged(s)).toBe(true);
  });

  it("given a scheduled processing, when a minute passes, then a pending delivery is processed, and not a millisecond earlier; the timer is unref'd", async () => {
    const s = await withStory("ready");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const timer = scheduleDeliveries(s.db, {
      readInstance: readInstanceOf(s.db),
    });
    expect(timer.hasRef()).toBe(false);
    // Whatever a first run at start-up does is over before the delivery is recorded.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const id = await seedDelivery(s.db, { event: "ping" });

    await vi.advanceTimersByTimeAsync(59_999);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await deliveryRow(s.db, id)).processed_at).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    await until(
      async () => (await deliveryRow(s.db, id)).processed_at !== null,
    );
    clearInterval(timer);
  });
});
