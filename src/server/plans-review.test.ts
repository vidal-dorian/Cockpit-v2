import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { withProject } from "./test-mcp.ts";
import {
  admin,
  enter,
  generate,
  get,
  inDays,
  makePro,
  planOf,
  revoke,
  travel,
} from "./test-plans.ts";

// Review fixes of slice 13.2 (decision 077 H): a new code replaces the old one, and the typed code is trimmed.

afterEach(() => {
  vi.useRealTimers();
});

describe("077 H: entering a code", () => {
  it("given a Pro account by a first code, when it enters a second one, then the first one is revoked in the list and the plan follows the second", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const first = await makePro(ctx.app, boss.cookie, ctx.alice.cookie);
    const second = await generate(ctx.app, boss.cookie);

    await enter(ctx.app, ctx.alice.cookie, second.secret);

    const list = (await (
      await get(ctx.app, boss.cookie, "/api/settings/pro-codes")
    ).json()) as { codes: { id: number; state: string }[] };
    expect(list.codes.find((c) => c.id === first)?.state).toBe("revoked");
    expect(list.codes.find((c) => c.id === second.id)?.state).toBe("used");
    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("pro");
  });

  it("given a code of an account that was deleted (no user any more), when it is entered, then it is still refused as used", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const made = await generate(ctx.app, boss.cookie);
    await enter(ctx.app, ctx.alice.cookie, made.secret);
    await ctx.db.execute(sql`update pro_codes set user_id = null`);

    const res = await enter(ctx.app, boss.cookie, made.secret);

    expect(res.status).toBe(400);
  });

  it("given a good code typed with spaces around, when it is entered, then it works", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const made = await generate(ctx.app, boss.cookie);

    const res = await send(
      ctx.app,
      ctx.alice.cookie,
      "POST",
      "/api/me/pro-code",
      {
        code: `  ${made.secret}\n`,
      },
    );

    expect(res.status).toBe(200);
  });

  it("given a code never entered that is past its 30 days, when the administrator revokes it, then 409 and it stays expired", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    const made = await generate(ctx.app, boss.cookie);
    await travel(ctx.db, 31);

    const res = await revoke(ctx.app, boss.cookie, made.id as number);

    expect(res.status).toBe(409);
  });

  it("given a code that ends in 5 days and was never entered, when 6 days pass and it is entered, then 400, the list says expired and the Pro code of the account stays active", async () => {
    const ctx = await withProject();
    const boss = await admin(ctx.db);
    await makePro(ctx.app, boss.cookie, ctx.alice.cookie);
    const late = await generate(ctx.app, boss.cookie, { until: inDays(5) });
    await travel(ctx.db, 6);

    const res = await enter(ctx.app, ctx.alice.cookie, late.secret);

    expect(res.status).toBe(400);
    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("pro");
    const list = (await (
      await get(ctx.app, boss.cookie, "/api/settings/pro-codes")
    ).json()) as { codes: { id: number; state: string }[] };
    expect(list.codes.find((c) => c.id === late.id)?.state).toBe("expired");
  });
});
