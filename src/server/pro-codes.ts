import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { act, type Entry, Refused } from "./action.ts";
import { currentUser, sha256 } from "./auth.ts";
import type { Db } from "./db/db.ts";
import { proCodes, users } from "./db/schema.ts";
import { FREE_LIMIT, ownedRepos, planOf } from "./plans.ts";
import { isDatabaseId } from "./projects.ts";

const THIRTY_DAYS = 30 * 86_400_000;

// An end is a future instant or null (no end); a NUL cannot be stored by PostgreSQL.
const until = z
  .string()
  .nullable()
  .refine((v) => v === null || Date.parse(v) > Date.now())
  .transform((v) => (v === null ? null : new Date(v)));
const createBody = z.object({
  note: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((note) => !note.includes("\0")),
  until,
});
const changeBody = z.object({ until });

const selectCodes = (db: Db) =>
  db
    .select({ code: proCodes, login: users.login })
    .from(proCodes)
    .leftJoin(users, eq(users.id, proCodes.userId))
    .orderBy(desc(proCodes.id));

/** Never the hash. The state is computed from the clock, so an ended code is `expired` with no task in between. */
const present = ({
  code,
  login,
}: {
  code: typeof proCodes.$inferSelect;
  login: string | null;
}) => {
  const now = new Date();
  const ended = code.userId
    ? code.until !== null && code.until <= now
    : code.expiresAt <= now;
  return {
    id: code.id,
    note: code.note,
    state: code.revokedAt
      ? ("revoked" as const)
      : ended
        ? ("expired" as const)
        : code.userId
          ? ("used" as const)
          : ("free" as const),
    until: code.until,
    createdAt: code.createdAt,
    expiresAt: code.expiresAt,
    login,
  };
};

type Env = { Variables: { adminId: number } };

/** The account's plan, the code it enters (decision 077 H). */
export function planRoutes(db: Db) {
  const body = async (userId: number) => {
    const plan = await planOf(db, userId);
    return {
      ...plan,
      repos: await ownedRepos(db, userId),
      limit: plan.plan === "pro" ? null : FREE_LIMIT,
    };
  };
  return new Hono()
    .get("/api/me/plan", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      return c.json(await body(user.userId));
    })
    .post("/api/me/pro-code", async (c) => {
      const user = await currentUser(db, c);
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const typed = z
        .object({ code: z.string() })
        .safeParse(await c.req.json().catch(() => null));
      const entry: Entry = {
        userId: user.userId,
        actor: "human",
        origin: "ui",
        action: "enter_pro_code",
        args: {},
      };
      try {
        await act(db, entry, async (tx) => {
          const [found] = typed.success
            ? await tx
                .select()
                .from(proCodes)
                .where(eq(proCodes.codeHash, sha256(typed.data.code)))
                .for("update")
            : [];
          if (found) entry.args = { codeId: found.id };
          // One answer for every reason: the code is free, not revoked and not past its 30 days.
          if (
            !found ||
            found.userId !== null ||
            found.revokedAt ||
            found.expiresAt <= new Date()
          )
            throw new Refused("invalid_code");
          await tx
            .update(proCodes)
            .set({ userId: user.userId, usedAt: new Date() })
            .where(eq(proCodes.id, found.id));
        });
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        return c.json({ error: "invalid_code" }, 400);
      }
      return c.json(await body(user.userId));
    });
}

/** The administrator's codes (decision 077 I); mounted behind the `adminOnly` of `accountRoutes`. */
export function proCodeRoutes(db: Db) {
  const one = async (id: number) => {
    const [row] = (await selectCodes(db)).filter((r) => r.code.id === id);
    return row && present(row);
  };

  /** Locks the code, applies `change` in a journaled action, answers the code (404, 409 for a refusal). */
  const change = async (
    c: Context<Env>,
    action: string,
    work: (
      code: typeof proCodes.$inferSelect,
    ) => Partial<typeof proCodes.$inferInsert>,
  ) => {
    const id = Number(c.req.param("id"));
    if (!isDatabaseId(id)) return c.json({ error: "Not found" }, 404);
    const entry: Entry = {
      userId: c.get("adminId"),
      actor: "human",
      origin: "ui",
      action,
      args: { codeId: id },
    };
    try {
      await act(db, entry, async (tx) => {
        const [code] = await tx
          .select()
          .from(proCodes)
          .where(eq(proCodes.id, id))
          .for("update");
        if (!code) throw new Refused("not_found");
        await tx.update(proCodes).set(work(code)).where(eq(proCodes.id, id));
      });
    } catch (error) {
      if (!(error instanceof Refused)) throw error;
      return error.message === "not_found"
        ? c.json({ error: "Not found" }, 404)
        : c.json({ error: error.message }, 409);
    }
    return c.json({ code: await one(id) });
  };

  return new Hono<Env>()
    .get("/api/settings/pro-codes", async (c) =>
      c.json({ codes: (await selectCodes(db)).map(present) }),
    )
    .post("/api/settings/pro-codes", async (c) => {
      const parsed = createBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      const secret = `pro_${randomBytes(24).toString("base64url")}`;
      const now = new Date();
      const entry: Entry = {
        userId: c.get("adminId"),
        actor: "human",
        origin: "ui",
        action: "create_pro_code",
        args: {},
      };
      const id = await act(db, entry, async (tx) => {
        const [row] = await tx
          .insert(proCodes)
          .values({
            codeHash: sha256(secret),
            note: parsed.data.note,
            until: parsed.data.until,
            createdAt: now,
            expiresAt: new Date(now.getTime() + THIRTY_DAYS),
          })
          .returning({ id: proCodes.id });
        if (!row) throw new Error("code not created");
        entry.args = { codeId: row.id };
        return row.id;
      });
      return c.json({ code: await one(id), secret }, 201);
    })
    .patch("/api/settings/pro-codes/:id", async (c) => {
      const parsed = changeBody.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: "Bad request" }, 400);
      return change(c, "change_pro_code", (code) => {
        if (!code.userId) throw new Refused("not_used");
        return { until: parsed.data.until };
      });
    })
    .post("/api/settings/pro-codes/:id/revoke", (c) =>
      change(c, "revoke_pro_code", (code) => {
        if (code.revokedAt) throw new Refused("already_revoked");
        return { revokedAt: new Date() };
      }),
    );
}
