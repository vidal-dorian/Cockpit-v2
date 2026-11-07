import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { withRules } from "./test-takeover.ts";

// Slice R4 (decision 050 F): a rule is « figée » when its story is done and its criterion passed. A computed state, not a column: in GET /api/projects/:id/features
// the rule's `state` is "frozen" (the other values stay "pending" | "kept").

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Ctx = Awaited<ReturnType<typeof withRules>>;
const states = async (ctx: Ctx) => {
  const res = await send(
    ctx.app,
    ctx.alice.cookie,
    "GET",
    `/api/projects/${ctx.projectId}/features`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    features: { rules: { summary: string; state: string }[] }[];
  };
  return (body.features[0]?.rules ?? []).map((r) => [r.summary, r.state]);
};
const setStory = (ctx: Ctx, index: number, status: string) =>
  ctx.db.execute(
    sql`update user_stories set status = ${status} where id = ${ctx.stories[index]?.id}`,
  );
const setResult = (ctx: Ctx, index: number, result: string | null) =>
  ctx.db.execute(
    sql`update acceptance_criteria set result = ${result}, evidence = ${result ? "preuve" : null} where id = ${ctx.ids[index]}`,
  );
const keep = (ctx: Ctx, index: number) =>
  ctx.db.execute(
    sql`update acceptance_criteria set takeover_state = 'kept' where id = ${ctx.ids[index]}`,
  );

describe("decision 050 F: the state frozen in the features", () => {
  it("given a done takeover story whose first rule passed and second failed, when the features are read, then the first rule is frozen, the second is not, and the other story's rule is untouched", async () => {
    const ctx = await withRules();
    await keep(ctx, 0);
    await keep(ctx, 1);
    await setStory(ctx, 0, "done");
    await setResult(ctx, 0, "passed");
    await setResult(ctx, 1, "failed");

    expect(await states(ctx)).toEqual([
      ["règle-1", "frozen"],
      ["règle-2", "kept"],
      ["règle-3", "pending"],
    ]);
  });

  it("given a passed rule in a story that is not done, when the features are read, then it stays kept, never frozen", async () => {
    const ctx = await withRules();
    await keep(ctx, 2);
    await setStory(ctx, 1, "in_review");
    await setResult(ctx, 2, "passed");

    expect((await states(ctx))[2]).toEqual(["règle-3", "kept"]);
  });

  it("given a done story whose rule has no result, when the features are read, then it is not frozen", async () => {
    const ctx = await withRules();
    await keep(ctx, 0);
    await setStory(ctx, 0, "done");

    expect((await states(ctx))[0]).toEqual(["règle-1", "kept"]);
  });
});
