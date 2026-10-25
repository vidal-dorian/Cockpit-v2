import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
  isAdmin: boolean("is_admin").notNull().default(false),
  // Set by an administrator (decision 012 G): a blocked account cannot log in. Null when active.
  blockedAt: timestamp("blocked_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** The one row the start-up wizard fills (decision 012); the three secrets are AES-256-GCM values (secrets.ts), the key never enters the database. */
export const instanceSettings = pgTable(
  "instance_settings",
  {
    id: integer("id").primaryKey(),
    publicUrl: text("public_url").notNull(),
    // Text, not a number: GitHub's App ids are opaque to Cockpit.
    githubAppId: text("github_app_id").notNull(),
    githubAppSlug: text("github_app_slug").notNull(),
    githubClientId: text("github_client_id").notNull(),
    githubClientSecret: text("github_client_secret").notNull(),
    githubPrivateKey: text("github_private_key").notNull(),
    githubWebhookSecret: text("github_webhook_secret").notNull(),
    // The SHA-256 of the cookie that lets the person who ran the wizard become the first administrator; null once spent.
    adminClaimHash: text("admin_claim_hash"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [check("instance_settings_single_row", sql`${t.id} = 1`)],
);

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

/** A raw idea of a project (decision 014). No step column: it is computed (decision 002). */
export const tickets = pgTable("tickets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  descriptionMd: text("description_md").notNull().default(""),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/** A personal MCP token (decisions 002 and 015): only the SHA-256 of the secret is kept, the secret is shown once. */
export const mcpTokens = pgTable("mcp_tokens", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  lastFour: text("last_four").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
});

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
    ticketId: integer("ticket_id"),
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
