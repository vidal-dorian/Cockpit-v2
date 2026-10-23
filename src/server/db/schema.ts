import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  // Identity values are never reused, so history entries keep pointing at the right account.
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // GitHub ids can exceed 2^31, which an integer column cannot hold.
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  // The SHA-256 of the cookie value, so a leaked database gives no usable session (decision 009).
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable("projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // One repo, one project for the whole instance (decision 008); GitHub ids can exceed 2^31.
  githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull().unique(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull(),
  installationId: bigint("installation_id", { mode: "number" }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** Who works on a project: the one place access lives (decisions 002 and 008). */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["owner"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    // Enforces one member per project until sharing (decision 008).
    uniqueIndex("project_members_project_id_idx").on(t.projectId),
    check("project_members_role_check", sql`${t.role} in ('owner')`),
  ],
);

/** Append-only (triggers in the history_append_only migration); no foreign keys, so entries outlive what they point at (decision 010). */
export const history = pgTable(
  "history",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    userId: integer("user_id"),
    projectId: integer("project_id"),
    actor: text("actor", {
      enum: ["human", "claude", "github", "system"],
    }).notNull(),
    origin: text("origin", {
      enum: ["ui", "mcp", "webhook", "system"],
    }).notNull(),
    action: text("action").notNull(),
    args: jsonb("args").notNull().default({}).$type<HistoryArgs>(),
    result: text("result", { enum: ["ok", "error", "refused"] }).notNull(),
    detail: jsonb("detail").$type<Record<string, string>>(),
  },
  (t) => [
    check(
      "history_actor_check",
      sql`${t.actor} in ('human', 'claude', 'github', 'system')`,
    ),
    check(
      "history_origin_check",
      sql`${t.origin} in ('ui', 'mcp', 'webhook', 'system')`,
    ),
    check(
      "history_result_check",
      sql`${t.result} in ('ok', 'error', 'refused')`,
    ),
  ],
);

/** Ids, closed values and numbers only: never free text or personal data (decision 010 D). */
export type HistoryArgs = Record<string, string | number | boolean | null>;
