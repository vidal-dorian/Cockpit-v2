import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "./test-decisions.ts";
import { historyText, rows, userWithToken, withProject } from "./test-mcp.ts";
import {
  admin,
  enter,
  generate,
  get,
  inDays,
  planOf,
  revoke,
  travel,
} from "./test-plans.ts";

// Slice 13.2 (decision 077 H, I, J, the contract is in test-plans.ts): the Pro codes, from their generation by the administrator to their revocation.

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Listed = {
  id: number;
  note: string;
  state: string;
  until: string | null;
  createdAt: string;
  expiresAt: string;
  login: string | null;
};

async function setup() {
  const ctx = await withProject();
  return { ...ctx, boss: await admin(ctx.db) };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const listed = async (ctx: Ctx) =>
  (
    (await (
      await get(ctx.app, ctx.boss.cookie, "/api/settings/pro-codes")
    ).json()) as { codes: Listed[] }
  ).codes;

const entries = (ctx: Ctx, action: string) =>
  rows(ctx.db, sql`action = ${action}`);

describe("077 I: generating a code", () => {
  it("given the administrator, when a code is generated, then 201 with the secret once, the list shows it free with its note, no end and an enterable window of 30 days, and the secret is neither listed nor stored in clear", async () => {
    const ctx = await setup();

    const made = await generate(ctx.app, ctx.boss.cookie, {
      note: "pour Karim",
    });

    expect(made.res.status).toBe(201);
    expect(made.secret.length).toBeGreaterThanOrEqual(16);
    const [code, ...others] = await listed(ctx);
    expect(others).toHaveLength(0);
    expect(code).toMatchObject({
      id: made.id,
      note: "pour Karim",
      state: "free",
      until: null,
      login: null,
    });
    expect(
      Date.parse(code?.expiresAt as string) -
        Date.parse(code?.createdAt as string),
    ).toBe(30 * 86_400_000);
    expect(JSON.stringify(await listed(ctx))).not.toContain(made.secret);
    const stored = await ctx.db.execute(sql`select * from pro_codes`);
    expect(JSON.stringify(stored)).not.toContain(made.secret);
    const [entry, ...more] = await entries(ctx, "create_pro_code");
    expect(more).toHaveLength(0);
    expect(entry).toMatchObject({
      user_id: ctx.boss.id,
      actor: "human",
      origin: "ui",
      result: "ok",
      args: { codeId: made.id },
    });
    const history = await historyText(ctx.db);
    expect(history).not.toContain(made.secret);
    expect(history).not.toContain("pour Karim");
  });

  it.each([
    ["a note that is empty", { note: "   " }],
    ["a note of 81 characters", { note: "x".repeat(81) }],
    ["an end in the past", { until: inDays(-1) }],
    ["an end that is not a date", { until: "bientôt" }],
  ])(
    "given %s, when a code is generated, then 400 and no code exists",
    async (_name, body) => {
      const ctx = await setup();

      const made = await generate(ctx.app, ctx.boss.cookie, body);

      expect(made.res.status).toBe(400);
      expect(await listed(ctx)).toHaveLength(0);
    },
  );

  it("given a note of 80 characters and an end in 40 days, when a code is generated, then it is accepted and the end is kept", async () => {
    const ctx = await setup();
    const until = inDays(40);

    const made = await generate(ctx.app, ctx.boss.cookie, {
      note: "x".repeat(80),
      until,
    });

    expect(made.res.status).toBe(201);
    expect((await listed(ctx))[0]).toMatchObject({ until });
  });

  it("given a plain account, when it generates, lists, changes or revokes codes, then 403 on each and the administrator's code is untouched", async () => {
    const ctx = await setup();
    const { id } = await generate(ctx.app, ctx.boss.cookie);
    const { cookie } = ctx.alice;

    const answers = [
      await generate(ctx.app, cookie),
      await get(ctx.app, cookie, "/api/settings/pro-codes"),
      await send(ctx.app, cookie, "PATCH", `/api/settings/pro-codes/${id}`, {
        until: null,
      }),
      await revoke(ctx.app, cookie, id as number),
    ];

    expect(answers.map((a) => ("res" in a ? a.res : a).status)).toEqual([
      403, 403, 403, 403,
    ]);
    expect((await listed(ctx))[0]).toMatchObject({ state: "free" });
  });
});

describe("077 H: entering a code", () => {
  it("given a free code, when Alice enters it, then she is Pro by a code, the code is used and shows her login, and a second account cannot use it", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);

    const res = await enter(ctx.app, ctx.alice.cookie, made.secret);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plan: "pro", via: "code" });
    expect((await listed(ctx))[0]).toMatchObject({
      state: "used",
      login: "user1000",
    });
    const bob = await userWithToken(ctx.app, ctx.db, 2001);
    const again = await enter(ctx.app, bob.cookie, made.secret);
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_code" });
    expect((await planOf(ctx.app, bob.cookie)).plan).toBe("free");
    expect(await entries(ctx, "enter_pro_code")).toMatchObject([
      { user_id: ctx.alice.id, result: "ok", args: { codeId: made.id } },
      { user_id: bob.id, result: "refused", args: { codeId: made.id } },
    ]);
  });

  it("given a code nobody knows, when it is entered, then 400 invalid_code, one refused entry and the text typed is nowhere in the history", async () => {
    const ctx = await setup();

    const res = await enter(ctx.app, ctx.alice.cookie, "pas-un-vrai-code-42");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(await entries(ctx, "enter_pro_code")).toMatchObject([
      { user_id: ctx.alice.id, result: "refused" },
    ]);
    expect(await historyText(ctx.db)).not.toContain("pas-un-vrai-code-42");
    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("free");
  });

  it("given a Pro account by a first code, when it enters a second one that ends in 5 days, then the new one replaces the old", async () => {
    const ctx = await setup();
    await enter(
      ctx.app,
      ctx.alice.cookie,
      (await generate(ctx.app, ctx.boss.cookie)).secret,
    );
    const until = inDays(5);
    const second = await generate(ctx.app, ctx.boss.cookie, { until });

    const res = await enter(ctx.app, ctx.alice.cookie, second.secret);

    expect(res.status).toBe(200);
    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "pro",
      via: "code",
      until,
    });
  });

  it("given a code never entered, when 31 days pass, then it cannot be entered any more, and the list says expired", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);

    await travel(ctx.db, 29);
    expect((await listed(ctx)).map((c) => c.state)).toEqual(["free"]);
    await travel(ctx.db, 2);

    const res = await enter(ctx.app, ctx.alice.cookie, made.secret);
    expect(res.status).toBe(400);
    expect((await listed(ctx)).map((c) => c.state)).toEqual(["expired"]);
  });

  it("given a used code that ended, when the list is read, then its state is expired and it still shows the account", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie, {
      until: inDays(10),
    });
    await enter(ctx.app, ctx.alice.cookie, made.secret);

    await travel(ctx.db, 11);

    expect((await listed(ctx))[0]).toMatchObject({
      state: "expired",
      login: "user1000",
    });
  });
});

describe("077 I: changing the duration of a used code", () => {
  it("given a used code with no end, when the administrator sets an end in 5 days, then only that account changes, the entry is journaled with the code id and 6 days later she is Free", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);
    await enter(ctx.app, ctx.alice.cookie, made.secret);
    const until = inDays(5);

    const res = await send(
      ctx.app,
      ctx.boss.cookie,
      "PATCH",
      `/api/settings/pro-codes/${made.id}`,
      { until },
    );

    expect(res.status).toBe(200);
    expect(await planOf(ctx.app, ctx.alice.cookie)).toMatchObject({
      plan: "pro",
      until,
    });
    expect(await entries(ctx, "change_pro_code")).toMatchObject([
      { user_id: ctx.boss.id, result: "ok", args: { codeId: made.id } },
    ]);
    await travel(ctx.db, 6);
    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("free");
  });

  it("given a code never entered, when the administrator changes its duration, then 409 not_used and nothing changes", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);

    const res = await send(
      ctx.app,
      ctx.boss.cookie,
      "PATCH",
      `/api/settings/pro-codes/${made.id}`,
      { until: inDays(5) },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_used" });
    expect((await listed(ctx))[0]).toMatchObject({ until: null });
  });
});

describe("077 I: revoking a code", () => {
  it("given a free code, when it is revoked, then the list says revoked, it cannot be entered and the entry is journaled with the code id", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);

    const res = await revoke(ctx.app, ctx.boss.cookie, made.id as number);

    expect(res.status).toBe(200);
    expect((await listed(ctx))[0]).toMatchObject({ state: "revoked" });
    expect((await enter(ctx.app, ctx.alice.cookie, made.secret)).status).toBe(
      400,
    );
    expect(await entries(ctx, "revoke_pro_code")).toMatchObject([
      { user_id: ctx.boss.id, result: "ok", args: { codeId: made.id } },
    ]);
  });

  it("given a used code, when it is revoked, then the account is Free at once and the code keeps its login; revoking again is a 409", async () => {
    const ctx = await setup();
    const made = await generate(ctx.app, ctx.boss.cookie);
    await enter(ctx.app, ctx.alice.cookie, made.secret);

    await revoke(ctx.app, ctx.boss.cookie, made.id as number);

    expect((await planOf(ctx.app, ctx.alice.cookie)).plan).toBe("free");
    expect((await listed(ctx))[0]).toMatchObject({
      state: "revoked",
      login: "user1000",
    });
    const again = await revoke(ctx.app, ctx.boss.cookie, made.id as number);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_revoked" });
  });

  it("given an unknown code id, when it is revoked or changed, then 404", async () => {
    const ctx = await setup();

    expect((await revoke(ctx.app, ctx.boss.cookie, 9999)).status).toBe(404);
    expect(
      (
        await send(
          ctx.app,
          ctx.boss.cookie,
          "PATCH",
          "/api/settings/pro-codes/9999",
          { until: null },
        )
      ).status,
    ).toBe(404);
  });
});
