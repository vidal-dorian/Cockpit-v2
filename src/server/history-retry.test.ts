import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { history } from "./db/schema.ts";
import {
  ask,
  base,
  type Page,
  project,
  setup,
  userWithSession,
} from "./test-history.ts";

// Decision 053 D (slice 11.1): the retry of a refused or failed entry.
//
// Pinned choices (the decision leaves them open):
// - `retry` is { id, at, result } of the first later entry (ordered by at, then id) of the same user, actor, action and project (a null project matches a null project only),
//   no more than one hour after the entry (59 minutes counts, 61 does not; the exact hour is not tested). Its result is whatever it is: ok, refused or error.
// - The retry is looked up among all the entries of the user, not among the page or the filtered ones: with result=refused the retry (an ok entry) is still found.
// - `at` is an ISO 8601 string like the one of the entry.

const T = Date.UTC(2026, 0, 1, 8, 40, 0);
const later = (minutes: number) => new Date(T + minutes * 60_000);

const refusal = {
  ...base,
  actor: "claude",
  origin: "mcp",
  result: "refused",
  action: "create_user_stories",
  at: new Date(T),
} as const;

async function retryOf(
  rows: (typeof history.$inferInsert)[],
  options: { query?: string } = {},
) {
  const { app, db } = await setup();
  const a = await userWithSession(db, 1);
  const p = await project(db, 1, "octocat/hello");
  await db.insert(history).values(
    rows.map((row) => ({
      userId: a.id,
      projectId: p,
      ...row,
    })),
  );
  const body = (await (await ask(app, a.cookie, options.query)).json()) as Page;
  const entry = body.entries.find((e) => e.at === new Date(T).toISOString());
  assert(entry);
  return { entry, body };
}

describe("GET /api/history, the retry (decision 053 D)", () => {
  it("given a refusal and the same action by the same actor on the same project 90 seconds later, when the history is requested, then the refusal has retry { id, at, result } of that entry", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const p = await project(db, 1, "octocat/hello");
    const [first, second] = await db
      .insert(history)
      .values([
        { ...refusal, userId: a.id, projectId: p },
        {
          ...refusal,
          userId: a.id,
          projectId: p,
          result: "ok",
          at: new Date(T + 90_000),
        },
      ])
      .returning({ id: history.id });
    assert(first && second);

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    const refused = body.entries.find((e) => e.id === first.id);
    expect(refused?.retry).toEqual({
      id: second.id,
      at: new Date(T + 90_000).toISOString(),
      result: "ok",
    });
  });

  it("given an error followed by a retry that is refused again, when the history is requested, then the error has retry with result refused", async () => {
    const { entry } = await retryOf([
      { ...refusal, result: "error" },
      { ...refusal, at: later(2) },
    ]);

    expect(entry.retry).toMatchObject({ result: "refused" });
  });

  it("given two later entries of the same kind, when the history is requested, then the retry is the first of them", async () => {
    const { entry, body } = await retryOf([
      refusal,
      { ...refusal, result: "ok", at: later(5) },
      { ...refusal, result: "ok", at: later(2) },
    ]);

    const second = body.entries.find((e) => e.at === later(2).toISOString());
    assert(second);
    expect(entry.retry?.id).toBe(second.id);
    expect(entry.retry?.at).toBe(later(2).toISOString());
  });

  it("given a later entry 59 minutes after, when the history is requested, then it is the retry", async () => {
    const { entry } = await retryOf([
      refusal,
      { ...refusal, result: "ok", at: later(59) },
    ]);

    expect(entry.retry?.at).toBe(later(59).toISOString());
  });

  it("given a later entry 61 minutes after, when the history is requested, then there is no retry (null)", async () => {
    const { entry } = await retryOf([
      refusal,
      { ...refusal, result: "ok", at: later(61) },
    ]);

    expect(entry.retry).toBeNull();
  });

  it("given a later entry of another action, when the history is requested, then there is no retry", async () => {
    const { entry } = await retryOf([
      refusal,
      { ...refusal, result: "ok", action: "create_ticket", at: later(1) },
    ]);

    expect(entry.retry).toBeNull();
  });

  it("given a later entry of another actor, when the history is requested, then there is no retry", async () => {
    const { entry } = await retryOf([
      refusal,
      { ...refusal, result: "ok", actor: "human", at: later(1) },
    ]);

    expect(entry.retry).toBeNull();
  });

  it("given a later entry on another project or on none, when the history is requested, then there is no retry", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const p = await project(db, 1, "octocat/hello");
    const other = await project(db, 2, "octocat/other");
    await db.insert(history).values([
      { ...refusal, userId: a.id, projectId: p },
      {
        ...refusal,
        userId: a.id,
        projectId: other,
        result: "ok",
        at: later(1),
      },
      { ...refusal, userId: a.id, result: "ok", at: later(2) },
    ]);

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    const refused = body.entries.find(
      (e) => e.at === new Date(T).toISOString(),
    );
    expect(refused?.retry).toBeNull();
  });

  it("given a refusal on no project and a later entry on no project, when the history is requested, then it is the retry (null matches null)", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      { ...refusal, userId: a.id },
      { ...refusal, userId: a.id, result: "ok", at: later(3) },
    ]);

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    const refused = body.entries.find(
      (e) => e.at === new Date(T).toISOString(),
    );
    expect(refused?.retry?.at).toBe(later(3).toISOString());
  });

  it("given a later entry of another user, when the history is requested, then there is no retry", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    const p = await project(db, 1, "octocat/hello");
    await db.insert(history).values([
      { ...refusal, userId: a.id, projectId: p },
      { ...refusal, userId: b.id, projectId: p, result: "ok", at: later(1) },
    ]);

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.retry).toBeNull();
  });

  it("given a retry that the filter result=refused leaves out, when the history is requested with it, then the refusal still shows its retry", async () => {
    const { entry, body } = await retryOf(
      [refusal, { ...refusal, result: "ok", at: later(1) }],
      { query: "?result=refused" },
    );

    expect(body.entries).toHaveLength(1);
    expect(entry.retry?.result).toBe("ok");
  });

  it("given an entry that is ok and a later one of the same kind, when the history is requested, then the ok entry has no retry", async () => {
    const { body } = await retryOf([
      { ...refusal, result: "ok" },
      { ...refusal, result: "ok", at: later(1) },
    ]);

    for (const entry of body.entries) expect("retry" in entry).toBe(false);
  });
});
