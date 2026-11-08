import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { history } from "./db/schema.ts";
import {
  actions,
  ask,
  base,
  type Page,
  project,
  setup,
  userWithSession,
} from "./test-history.ts";

// Decision 053 A and B (slice 11.1): the filters of GET /api/history and what an entry carries.
//
// Pinned choices (the decision leaves them open):
// - Filters: `project` (a positive integer id that fits a PostgreSQL integer), `action` (exact name, never empty), `actor`, `origin`,
//   `result` (comma list of ok|refused|error, no empty item), `since` (ISO 8601 with a time zone; an entry is kept when `at >= since`, so the instant itself matches),
//   `q` (see history-search.test.ts). Every one is optional and they combine with AND. An empty value (`?action=`, `?result=`, `?since=`) is invalid, not "absent".
// - An unknown action is not invalid: it matches nothing. Any other bad value is 400 { "error": "invalid_filter" }; an invalid `before` is still 400 invalid_cursor (decision 028 F).
// - `before` works with the filters: the next page holds the following entries *of the filtered set*, and `hasMore` is about that set too.
// - An entry answers { id, at, actor, origin, action, result, project (full name or null), projectId, ticketId, storyId, runId, args, detail } (the ids and `detail` are null when none; `args` is {} when none),
//   plus `retry` for result refused and error only (an ok entry has no `retry` key), and still `event` for receive_webhook.

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

describe("GET /api/history, the filters (decision 053 A)", () => {
  it("given entries on two projects, when the history is requested with project=<id>, then only the entries of that project come back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const one = await project(db, 1, "octocat/one");
    const two = await project(db, 2, "octocat/two");
    await db.insert(history).values([
      { ...base, userId: a.id, action: "on_one", at: at(1), projectId: one },
      { ...base, userId: a.id, action: "on_two", at: at(2), projectId: two },
      { ...base, userId: a.id, action: "on_none", at: at(3) },
    ]);

    expect(await actions(app, a.cookie, `?project=${one}`)).toEqual(["on_one"]);
    expect(await actions(app, a.cookie, `?project=${two}`)).toEqual(["on_two"]);
  });

  it("given a project and entries of another user on it, when the history is requested with that project, then the other user's entries never appear", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    const theirs = await project(db, 1, "octocat/theirs");
    await db.insert(history).values([
      {
        ...base,
        userId: b.id,
        action: "b_entry",
        at: at(1),
        projectId: theirs,
      },
      { ...base, userId: null, action: "nobody", at: at(2), projectId: theirs },
    ]);

    const res = await ask(app, a.cookie, `?project=${theirs}`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], hasMore: false });
  });

  it("given entries of several actions, when the history is requested with action=login, then only the exact action comes back (not login_extra nor logout)", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(
      ["login", "login_extra", "logout", "login"].map((action, i) => ({
        ...base,
        userId: a.id,
        action,
        at: at(i),
      })),
    );

    expect(await actions(app, a.cookie, "?action=login")).toEqual([
      "login",
      "login",
    ]);
  });

  it.each(["human", "claude", "github", "system"] as const)(
    "given entries of the four actors, when the history is requested with actor=%s, then only that actor's entries come back",
    async (actor) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db.insert(history).values(
        (["human", "claude", "github", "system"] as const).map((who, i) => ({
          ...base,
          actor: who,
          userId: a.id,
          action: `by_${who}`,
          at: at(i),
        })),
      );

      expect(await actions(app, a.cookie, `?actor=${actor}`)).toEqual([
        `by_${actor}`,
      ]);
    },
  );

  it.each(["ui", "mcp", "webhook", "system"] as const)(
    "given entries of the four origins, when the history is requested with origin=%s, then only that origin's entries come back",
    async (origin) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db.insert(history).values(
        (["ui", "mcp", "webhook", "system"] as const).map((from, i) => ({
          ...base,
          origin: from,
          userId: a.id,
          action: `from_${from}`,
          at: at(i),
        })),
      );

      expect(await actions(app, a.cookie, `?origin=${origin}`)).toEqual([
        `from_${origin}`,
      ]);
    },
  );

  it("given entries ok, refused and error, when the history is requested with result=refused, then only the refused come back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(
      (["ok", "refused", "error"] as const).map((result, i) => ({
        ...base,
        result,
        userId: a.id,
        action: `was_${result}`,
        at: at(i),
      })),
    );

    expect(await actions(app, a.cookie, "?result=refused")).toEqual([
      "was_refused",
    ]);
  });

  it("given entries ok, refused and error, when the history is requested with result=refused,error, then both come back and the ok one does not", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values(
      (["ok", "refused", "error"] as const).map((result, i) => ({
        ...base,
        result,
        userId: a.id,
        action: `was_${result}`,
        at: at(i),
      })),
    );

    expect(await actions(app, a.cookie, "?result=refused,error")).toEqual([
      "was_error",
      "was_refused",
    ]);
  });

  it("given entries before and after an instant, when the history is requested with since=<that instant>, then the entries at or after it come back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      { ...base, userId: a.id, action: "before", at: at(9) },
      { ...base, userId: a.id, action: "exactly", at: at(10) },
      { ...base, userId: a.id, action: "after", at: at(11) },
    ]);

    expect(
      await actions(app, a.cookie, `?since=${at(10).toISOString()}`),
    ).toEqual(["after", "exactly"]);
  });

  it("given a since with a +02:00 offset, when the history is requested, then it is read as that instant (10:00 UTC for 12:00+02:00)", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      {
        ...base,
        userId: a.id,
        action: "at_0959",
        at: new Date("2026-01-01T09:59:00Z"),
      },
      {
        ...base,
        userId: a.id,
        action: "at_1000",
        at: new Date("2026-01-01T10:00:00Z"),
      },
    ]);

    expect(
      await actions(app, a.cookie, "?since=2026-01-01T12:00:00%2B02:00"),
    ).toEqual(["at_1000"]);
  });

  it("given entries that differ on every field, when all the filters are given together, then only the entry that matches all of them comes back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const p = await project(db, 1, "octocat/hello");
    const other = await project(db, 2, "octocat/other");
    const wanted = {
      userId: a.id,
      projectId: p,
      actor: "claude",
      origin: "mcp",
      result: "refused",
      action: "create_user_stories",
      at: at(30),
    } as const;
    await db
      .insert(history)
      .values([
        { ...wanted },
        { ...wanted, action: "wanted_but_project", projectId: other },
        { ...wanted, action: "wanted_but_actor", actor: "human" },
        { ...wanted, action: "wanted_but_origin", origin: "ui" },
        { ...wanted, action: "wanted_but_result", result: "ok" },
        { ...wanted, action: "create_user_stories", at: at(5) },
      ]);

    expect(
      await actions(
        app,
        a.cookie,
        `?project=${p}&action=create_user_stories&actor=claude&origin=mcp&result=refused,error&since=${at(10).toISOString()}`,
      ),
    ).toEqual(["create_user_stories"]);
  });

  it("given 26 entries of Claude older than 20 of the user, when the pages are followed with actor=claude and before, then the next page keeps the filter and hasMore is about the filtered entries", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values([
      ...Array.from({ length: 26 }, (_, i) => ({
        ...base,
        actor: "claude" as const,
        userId: a.id,
        action: "by_claude",
        at: at(i),
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        ...base,
        userId: a.id,
        action: "by_human",
        at: at(100 + i),
      })),
    ]);

    const one = (await (
      await ask(app, a.cookie, "?actor=claude")
    ).json()) as Page;
    const last = one.entries[24];
    assert(last);
    const two = (await (
      await ask(app, a.cookie, `?actor=claude&before=${last.id}`)
    ).json()) as Page;

    expect(one.entries).toHaveLength(25);
    expect(one.hasMore).toBe(true);
    expect(two.entries.map((e) => e.action)).toEqual(["by_claude"]);
    expect(two.hasMore).toBe(false);
  });

  it("given entries of two users, when A filters, then B's entries never appear whatever the filter", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    await db.insert(history).values([
      { ...base, userId: a.id, action: "mine", at: at(1) },
      { ...base, userId: b.id, action: "theirs", at: at(2) },
    ]);

    for (const query of [
      "?actor=human",
      "?origin=ui",
      "?result=ok",
      "?result=ok,refused,error",
      `?since=${at(0).toISOString()}`,
    ])
      expect(await actions(app, a.cookie, query), query).toEqual(["mine"]);
  });

  it("given no session, when the history is requested with a filter, then it answers 401", async () => {
    const { app } = await setup();

    expect((await app.request("/api/history?actor=claude")).status).toBe(401);
  });
});

describe("GET /api/history, a bad filter (decision 053 A)", () => {
  it.each([
    "project=abc",
    "project=0",
    "project=-1",
    "project=1.5",
    "project=2147483648",
    "project=",
    "action=",
    "actor=robot",
    "actor=",
    "actor=Claude",
    "origin=pigeon",
    "origin=",
    "result=nope",
    "result=ok,nope",
    "result=ok,",
    "result=",
    "since=yesterday",
    "since=",
    "since=2026-13-45T00:00:00Z",
    "since=not-a-date",
  ])(
    "given the filter %s, when the history is requested, then it answers 400 invalid_filter",
    async (filter) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db
        .insert(history)
        .values({ ...base, userId: a.id, action: "login", at: at(1) });

      const res = await ask(app, a.cookie, `?${filter}`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_filter" });
    },
  );

  it("given a valid filter next to a bad one, when the history is requested, then it still answers 400 invalid_filter", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);

    const res = await ask(app, a.cookie, "?actor=claude&origin=pigeon");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_filter" });
  });

  it("given an unknown action, when the history is requested, then it is not invalid: nothing matches", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db
      .insert(history)
      .values({ ...base, userId: a.id, action: "login", at: at(1) });

    const res = await ask(app, a.cookie, "?action=no_such_tool");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [], hasMore: false });
  });
});

describe("GET /api/history, what an entry carries (decision 053 B)", () => {
  it("given an entry with a project, ticket, story, run, args and a refusal code, when the history is requested, then all of them come back with retry null", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const p = await project(db, 1, "octocat/hello");
    await db.insert(history).values({
      ...base,
      userId: a.id,
      actor: "claude",
      origin: "mcp",
      result: "refused",
      action: "create_user_stories",
      at: at(1),
      projectId: p,
      ticketId: 7,
      storyId: 8,
      runId: 9,
      args: { ticket_id: 7, pr: 44, draft: true, step: "reviewer" },
      detail: { reason: "criterion_incomplete" },
    });

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    const [entry] = body.entries;
    assert(entry);
    expect(Object.keys(entry).sort()).toEqual([
      "action",
      "actor",
      "args",
      "at",
      "detail",
      "id",
      "origin",
      "project",
      "projectId",
      "result",
      "retry",
      "runId",
      "storyId",
      "ticketId",
    ]);
    expect(entry).toMatchObject({
      project: "octocat/hello",
      projectId: p,
      ticketId: 7,
      storyId: 8,
      runId: 9,
      args: { ticket_id: 7, pr: 44, draft: true, step: "reviewer" },
      detail: { reason: "criterion_incomplete" },
      retry: null,
    });
  });

  it("given an ok entry with nothing attached, when the history is requested, then its ids and detail are null, its args {} and it has no retry key", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db
      .insert(history)
      .values({ ...base, userId: a.id, action: "login", at: at(1) });

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    const [entry] = body.entries;
    assert(entry);
    expect(entry).toMatchObject({
      project: null,
      projectId: null,
      ticketId: null,
      storyId: null,
      runId: null,
      args: {},
      detail: null,
    });
    expect("retry" in entry).toBe(false);
  });

  it.each(["refused", "error"] as const)(
    "given a %s entry that nothing followed, when the history is requested, then it has retry: null and an ok entry next to it has no retry key",
    async (result) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await db.insert(history).values([
        { ...base, userId: a.id, action: "fine", at: at(1) },
        { ...base, userId: a.id, action: "failed", result, at: at(2) },
      ]);

      const body = (await (await ask(app, a.cookie)).json()) as Page;

      const failed = body.entries.find((e) => e.action === "failed");
      const fine = body.entries.find((e) => e.action === "fine");
      assert(failed && fine);
      expect(failed.retry).toBeNull();
      expect("retry" in failed).toBe(true);
      expect("retry" in fine).toBe(false);
    },
  );

  it("given a receive_webhook entry, when the history is requested, then it still names its event and now carries its args too", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await db.insert(history).values({
      ...base,
      userId: a.id,
      actor: "github",
      origin: "webhook",
      action: "receive_webhook",
      at: at(1),
      args: { event: "check_run", delivery: "abc" },
    });

    const body = (await (await ask(app, a.cookie)).json()) as Page;

    expect(body.entries[0]).toMatchObject({
      event: "check_run",
      args: { event: "check_run", delivery: "abc" },
    });
  });
});
