// biome-ignore-all lint/suspicious/noThenProperty: "then" is the name of a Given/When/Then field of the API (decision 017)
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { rows } from "./test-mcp.ts";
import {
  created,
  criterionRows,
  ready,
  rule,
  sourceRows,
  storyOf,
  storyRows,
  ticketRows,
  withRules,
} from "./test-takeover.ts";

// Decision 047: a decision on a rule needs a story to validate and a live ticket; a takeover story is not sent back.

afterEach(() => {
  vi.unstubAllGlobals();
});

const EDIT = { summary: "s", given: "g", when: "w", then: "t" };
const call = (
  ctx: Awaited<ReturnType<typeof withRules>>,
  verb: string,
  id: number,
) =>
  verb === "edit"
    ? send(ctx.app, ctx.alice.cookie, "PATCH", `/api/criteria/${id}`, EDIT)
    : send(ctx.app, ctx.alice.cookie, "POST", `/api/criteria/${id}/${verb}`);

describe("decision 047: the decisions on a rule need a story to validate", () => {
  for (const verb of ["keep", "unkeep", "edit", "bug"]) {
    it(`given a ready story, when ${verb} is sent on one of its rules, then 409 wrong_status and nothing changes`, async () => {
      const ctx = await withRules();
      await ctx.db.execute(sql`update user_stories set status = 'ready'`);
      const before = await criterionRows(ctx.db);
      const tickets = await ticketRows(ctx.db);

      const res = await call(ctx, verb, ctx.ids[0] as number);

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "wrong_status" });
      expect(await criterionRows(ctx.db)).toEqual(before);
      expect(await ticketRows(ctx.db)).toEqual(tickets);
    });
  }

  it("given an abandoned ticket, when a rule is kept, then 409 ticket_abandoned", async () => {
    const ctx = await withRules();
    await ctx.db.execute(sql`update tickets set abandoned_at = now()`);

    const res = await call(ctx, "keep", ctx.ids[0] as number);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "ticket_abandoned" });
  });
});

describe("decision 047: a bug on the last rule", () => {
  it("given a story with one rule, when it is a bug, then the story is abandoned, the title is cut on whole characters and the permalinks are autolinks", async () => {
    const ctx = await ready();
    await created(ctx, [storyOf(1, [rule(1, { summary: "😀".repeat(300) })])]);
    const id = (await criterionRows(ctx.db))[0]?.id as number;

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/criteria/${id}/bug`,
    );

    expect(res.status).toBe(200);
    const bug = (await ticketRows(ctx.db)).find((t) =>
      t.title.startsWith("Bug : "),
    );
    expect(Array.from(bug?.title ?? "")).toHaveLength(200);
    expect(bug?.description_md).toMatch(
      /- <https:\/\/github\.com\/.*#L\d+(-L\d+)?>/,
    );
    // The rule's sources are gone; the copies go to the bug finding (decision 051 H).
    expect(
      (await sourceRows(ctx.db)).filter((s) => s.criterion_id !== null),
    ).toEqual([]);
  });
});

describe("decision 047: a takeover story is not sent back", () => {
  it("given a takeover story to validate, when it is sent back, then 409 takeover_story, the story stays to_validate and the refusal is journaled", async () => {
    const ctx = await withRules();
    const id = ctx.stories[0]?.id as number;

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      `/api/stories/${id}/send-back`,
      {
        comment: "refais",
      },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "takeover_story" });
    expect((await storyRows(ctx.db)).map((r) => r.status)).toEqual([
      "to_validate",
      "to_validate",
    ]);
    const entries = await rows(ctx.db, sql`action = 'send_back_story'`);
    expect(entries.map((e) => e.result)).toEqual(["refused"]);
  });
});
