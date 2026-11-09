import { and, asc, count, desc, eq } from "drizzle-orm";
import type { Db } from "./db/db.ts";
import { proCodes, projectMembers, projects, users } from "./db/schema.ts";

/** Repos a Free account owns, archived included (decision 077 B). */
export const FREE_LIMIT = 3;

/** Who is Pro, computed at every read from the clock (decision 077 A): an administrator, or the last code entered if neither revoked nor ended. */
export async function planOf(db: Db, userId: number) {
  const [user] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.isAdmin) return { plan: "pro", via: "admin", until: null } as const;
  const [code] = await db
    .select({ until: proCodes.until, revokedAt: proCodes.revokedAt })
    .from(proCodes)
    .where(eq(proCodes.userId, userId))
    .orderBy(desc(proCodes.usedAt), desc(proCodes.id))
    .limit(1);
  if (code && !code.revokedAt && (!code.until || code.until > new Date()))
    return { plan: "pro", via: "code", until: code.until } as const;
  return { plan: "free", via: null, until: null } as const;
}

const owned = (userId: number) =>
  and(eq(projectMembers.userId, userId), eq(projectMembers.role, "owner"));

/** The one count of the quota (decision 077 B). */
export async function ownedRepos(db: Db, userId: number) {
  const [row] = await db
    .select({ n: count() })
    .from(projectMembers)
    .where(owned(userId));
  return row?.n ?? 0;
}

/** Whether a Free account already has its 3 repos: the 4th is refused (decision 077 C). */
export async function overQuota(db: Db, userId: number) {
  return (
    (await planOf(db, userId)).plan === "free" &&
    (await ownedRepos(db, userId)) >= FREE_LIMIT
  );
}

/** The owner's plan and the ids of the projects it locks: those beyond its 3 oldest, archived included, once Free (decision 077 E). */
export async function planState(db: Db, ownerId: number) {
  const plan = await planOf(db, ownerId);
  const beyond =
    plan.plan === "pro"
      ? []
      : await db
          .select({ id: projects.id })
          .from(projectMembers)
          .innerJoin(projects, eq(projects.id, projectMembers.projectId))
          .where(owned(ownerId))
          .orderBy(asc(projects.createdAt), asc(projects.id))
          .offset(FREE_LIMIT);
  return { plan: plan.plan, locked: new Set(beyond.map((p) => p.id)) };
}
