import { describe, expect, it } from "vitest";
import { history } from "./db/schema.ts";
import {
  actions,
  ask,
  base,
  setup,
  type TestDb,
  userWithSession,
} from "./test-history.ts";

// Decision 053 C (slice 11.1): the search `q` of GET /api/history.
//
// Pinned choices (the decision leaves them open):
// - `q` is 1 to 100 characters, else 400 { "error": "invalid_filter" } (100 is accepted, 101 is not). No trimming is expected.
// - A number is `q` made of digits only, with or without one leading `#` (the client sends `%2342` for `#42`). It matches the entries whose ticketId, storyId or runId equals it,
//   or one of whose `args` values is that JSON number (args are flat, decision 010 D). `42` never matches 142, 420 or 4.2, and a string value "42" is not required to match.
// - Any other `q` is a text: it matches the entries whose action contains it, or whose `detail.reason` contains it, ignoring case. `%` and `_` are plain characters.
// - A number is searched as a number only: it does not look in the action names.

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

async function seed(db: TestDb, userId: number, rows: object[]) {
  await db.insert(history).values(
    rows.map((row, i) => ({
      ...base,
      userId,
      at: at(i),
      ...row,
    })) as (typeof history.$inferInsert)[],
  );
}

describe("GET /api/history, a number search (decision 053 C)", () => {
  it.each(["42", "%2342"])(
    "given entries of ticket 42, story 42, run 42, args {pr: 42} and others, when q=%s, then exactly those four come back",
    async (q) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);
      await seed(db, a.id, [
        { action: "by_ticket", ticketId: 42 },
        { action: "by_story", storyId: 42 },
        { action: "by_run", runId: 42 },
        { action: "by_arg", args: { pr: 42 } },
        { action: "other_ticket", ticketId: 43 },
        { action: "other_arg", args: { pr: 43 } },
        { action: "plain" },
      ]);

      expect(await actions(app, a.cookie, `?q=${q}`)).toEqual([
        "by_arg",
        "by_run",
        "by_story",
        "by_ticket",
      ]);
    },
  );

  it("given numbers that only contain 42 (142, 420, 4.2, 42 as the digits of a larger number), when q=42, then they do not match", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "ticket_142", ticketId: 142 },
      { action: "story_420", storyId: 420 },
      { action: "run_2420", runId: 2420 },
      { action: "arg_142", args: { pr: 142 } },
      { action: "arg_420", args: { pr: 420 } },
      { action: "arg_decimal", args: { ratio: 4.2 } },
      { action: "arg_exact", args: { pr: 42 } },
    ]);

    expect(await actions(app, a.cookie, "?q=42")).toEqual(["arg_exact"]);
  });

  it("given an arg whose number sits under any key, when q is that number, then it matches whatever the key", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "first_key", args: { run_id: 7, other: "x" } },
      { action: "second_key", args: { anything: true, number: 7 } },
      { action: "no_number", args: { text: "7 days" } },
    ]);

    expect(await actions(app, a.cookie, "?q=7")).toEqual([
      "second_key",
      "first_key",
    ]);
  });

  it("given entries of another user with the same number, when q is that number, then only the caller's entries come back", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    const b = await userWithSession(db, 2);
    await seed(db, a.id, [{ action: "mine", ticketId: 5 }]);
    await seed(db, b.id, [{ action: "theirs", ticketId: 5 }]);

    expect(await actions(app, a.cookie, "?q=5")).toEqual(["mine"]);
  });
});

describe("GET /api/history, a text search (decision 053 C)", () => {
  it("given actions that contain ticket, when q=ticket, then they come back and the others do not", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "create_ticket" },
      { action: "login" },
      { action: "update_ticket" },
    ]);

    expect(await actions(app, a.cookie, "?q=ticket")).toEqual([
      "update_ticket",
      "create_ticket",
    ]);
  });

  it("given an action in lower case, when q is in upper case or mixed case, then it still matches", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [{ action: "create_ticket" }, { action: "login" }]);

    expect(await actions(app, a.cookie, "?q=TICKET")).toEqual([
      "create_ticket",
    ]);
    expect(await actions(app, a.cookie, "?q=TiCkEt")).toEqual([
      "create_ticket",
    ]);
  });

  it("given a refusal whose detail.reason is criterion_incomplete, when q=CRITERION, then the entry matches on its code, case-insensitively", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      {
        action: "create_user_stories",
        result: "refused",
        detail: { reason: "criterion_incomplete" },
      },
      { action: "create_user_stories", detail: null },
    ]);

    const res = await ask(app, a.cookie, "?q=CRITERION");

    const body = (await res.json()) as { entries: { result: string }[] };
    expect(body.entries.map((e) => e.result)).toEqual(["refused"]);
  });

  it("given a text, when q looks for it, then it is not searched in the ids or the args", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "plain", ticketId: 5, args: { agent: "reviewer" } },
    ]);

    expect(await actions(app, a.cookie, "?q=reviewer")).toEqual([]);
  });

  it("given % and _ in the search, when they are searched, then they are plain characters, not wildcards", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "create_ticket" },
      { action: "createXticket" },
      { action: "login" },
      {
        action: "refused_tool",
        result: "refused",
        detail: { reason: "100%_sure" },
      },
    ]);

    // `%` alone would match everything as a LIKE pattern; only the reason holds one.
    expect(await actions(app, a.cookie, "?q=%25")).toEqual(["refused_tool"]);
    // `_` would match any character: createXticket must not come back for create_ticket.
    expect(await actions(app, a.cookie, "?q=create_ticket")).toEqual([
      "create_ticket",
    ]);
    expect(await actions(app, a.cookie, "?q=e_t")).toEqual(["create_ticket"]);
    expect(await actions(app, a.cookie, "?q=0%25_")).toEqual(["refused_tool"]);
    expect(await actions(app, a.cookie, "?q=%25%25")).toEqual([]);
  });

  it("given a search and other filters, when they are given together, then they combine", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);
    await seed(db, a.id, [
      { action: "create_ticket", actor: "claude" },
      { action: "update_ticket" },
      { action: "login", actor: "claude" },
    ]);

    expect(await actions(app, a.cookie, "?q=ticket&actor=claude")).toEqual([
      "create_ticket",
    ]);
  });
});

describe("GET /api/history, the length of the search (decision 053 C)", () => {
  it("given q of 100 characters, when the history is requested, then it answers 200", async () => {
    const { app, db } = await setup();
    const a = await userWithSession(db, 1);

    const res = await ask(app, a.cookie, `?q=${"a".repeat(100)}`);

    expect(res.status).toBe(200);
  });

  it.each([
    ["empty", ""],
    ["101 characters", "a".repeat(101)],
  ])(
    "given q that is %s, when the history is requested, then it answers 400 invalid_filter",
    async (_name, q) => {
      const { app, db } = await setup();
      const a = await userWithSession(db, 1);

      const res = await ask(app, a.cookie, `?q=${q}`);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_filter" });
    },
  );
});
